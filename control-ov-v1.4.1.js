// ======================
// 控制列注入器 v1.4.1
// ======================
;(function () {
	var ATTR = 'data-ov'
	var STYLE = 'ov-style'
	var UI_ID = 'ov-ui'

	// --- 移除舊的 UI ---
	if (document.getElementById(UI_ID)) {
		try {
			document.getElementById(UI_ID).remove()
			if (window.__ovInterval) clearInterval(window.__ovInterval)

			// 移除所有 mousemove / keydown / click handler
			if (window.__ovHandlers) {
				window.__ovHandlers.forEach(([t, f, tg]) =>
					(tg || window).removeEventListener(t, f, true)
				)
			}

			// 移除上一輪的 click handler
			if (window.__ovClickHandler) {
				document.removeEventListener('click', window.__ovClickHandler, true)
				window.__ovClickHandler = null
			}
		} catch (e) {}

		console.log('♻️ 已清除舊控制列，重新建立中...')
	}

	// --- 插入 STYLE ---
	if (!document.getElementById(STYLE)) {
		const st = document.createElement('style')
		st.id = STYLE
		st.textContent = `
            [${ATTR}="1"] {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            .player-timedtext,
            .player-timedtext-text-container {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }
        `
		document.head.appendChild(st)
	}

	// --- 找影片元素 ---
	function getVideo() {
		const v = [...document.querySelectorAll('video')].filter(
			(x) => x.offsetWidth > 0 && x.offsetHeight > 0
		)

		if (!v.length) return null

		v.sort(
			(a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight
		)

		return v[0]
	}

	// --- 移除舊的 KeyBlocker ---
	if (window.__ovKeyBlocker) {
		window.removeEventListener('keydown', window.__ovKeyBlocker, true)
		window.__ovKeyBlocker = null
	}

	if (window.__ovPlayPauseHandler) {
		window.removeEventListener('keydown', window.__ovPlayPauseHandler, true)
		window.__ovPlayPauseHandler = null
	}

	// --- 延遲安裝空白鍵攔截器，確保覆蓋原生的 handler ---
	setTimeout(() => {
		window.__ovKeyBlocker = function (e) {
			const keys = [' ', 'ArrowLeft', 'ArrowRight', 'k', 'K', 'j', 'J']

			if (!keys.includes(e.key)) return

			e.preventDefault()
			e.stopPropagation()
		}

		window.addEventListener('keydown', window.__ovKeyBlocker, true)

		console.log('🎯 KeyBlocker installed AFTER Original handlers')
	}, 300)

	// --- Netflix API helper ---
	function getNF() {
		try {
			const c = window.netflix?.appContext?.state.playerApp.getAPI()
			const sid = c.videoPlayer.getAllPlayerSessionIds()[0]
			return c.videoPlayer.getVideoPlayerBySessionId(sid)
		} catch {
			return null
		}
	}

	// --- 時間格式化 (秒 → mm:ss) ---
	function fmt(t) {
		if (!isFinite(t) || t < 0) return '--:--'
		t |= 0
		return ('0' + ((t / 60) | 0)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2)
	}

	// --- 跳轉到指定秒數 ---
	function seekTo(sec) {
		const p = getNF()
		const v = getVideo()
		if (!v) return

		const t = Math.max(0, Math.min(sec, v.duration))
		const was = v.paused

		try {
			if (was) v.play()
			if (p && p.seek) p.seek(t * 1000)
			else v.currentTime = t

			setTimeout(() => was && v.pause(), 200)
		} catch {
			v.currentTime = t
		}
	}

	const ACTIVE = '#e50914'
	const INACTIVE = '#555'
	const VOL_MUTE = '#444'

	// ==============================
	// NFPlaybackState helpers
	// ==============================
	function getActivePlaybackState() {
		try {
			const raw = localStorage.getItem('NFPlaybackState')
			if (!raw) return null

			const data = JSON.parse(raw)
			if (!data || typeof data !== 'object') return null

			let best = null

			for (const key of Object.keys(data)) {
				const entry = data[key]
				if (!entry || typeof entry !== 'object') continue
				if (!Array.isArray(entry.timecodes)) continue

				// 使用 __writeTs 當作「最新」的一筆
				if (!best || (entry.__writeTs || 0) > (best.__writeTs || 0)) {
					best = entry
				}
			}

			return best || null
		} catch (e) {
			console.warn('NFPlaybackState 解析失敗', e)
			return null
		}
	}

	function getSkipSegmentFromPlayback(entry) {
		if (!entry || !Array.isArray(entry.timecodes)) return null

		const candidates = entry.timecodes.filter(
			(tc) =>
				tc &&
				(tc.type === 'skip_credits' ||
					tc.type === 'intro' ||
					tc.type === 'recap')
		)

		if (!candidates.length) {
			console.warn(
				'目前找不到可跳過的片段（NFPlaybackState 沒有 skip_credits / intro / recap）'
			)
			return null
		}

		let best = candidates[0]
		for (let i = 1; i < candidates.length; i++) {
			const cur = candidates[i]
			if (
				isFinite(cur.startOffsetMs) &&
				(!isFinite(best.startOffsetMs) ||
					cur.startOffsetMs < best.startOffsetMs)
			) {
				best = cur
			}
		}

		if (
			!isFinite(best.startOffsetMs) ||
			!isFinite(best.endOffsetMs) ||
			best.endOffsetMs <= best.startOffsetMs
		) {
			console.warn('找到的 timecode 資料不完整：', best)
			return null
		}

		return {
			type: best.type,
			startOffsetMs: best.startOffsetMs,
			endOffsetMs: best.endOffsetMs,
		}
	}

	// --- 建 UI ---
	if (!document.getElementById(UI_ID)) {
		const box = document.createElement('div')
		box.id = UI_ID
		Object.assign(box.style, {
			position: 'fixed',
			bottom: '6%',
			left: '50%',
			transform: 'translateX(-50%)',
			zIndex: 2147483647,
			transition: 'opacity .4s ease',
		})

		document.body.appendChild(box)

		const sh = box.attachShadow({ mode: 'open' })

		const btn = document.createElement('button')
		const rng = document.createElement('input')
		const tm = document.createElement('span')
		const ic = document.createElement('span')
		const vol = document.createElement('input')
		const fs = document.createElement('button')
		const tip = document.createElement('div')
		const skipIntroBtn = document.createElement('button')
		const homeBtn = document.createElement('button')
		const nextEpBtn = document.createElement('button')

		// --- Home / Next Ep button base style ---
		homeBtn.textContent = 'Home'
		homeBtn.style.cssText = `
            all: unset;
            cursor: pointer;
            background: #444;
            color: #fff;
            padding: 6px 10px;
            border-radius: 6px;
            flex-shrink: 0;
        `

		// 下一集功能 (API → fallback DOM → 最後用 URL +1 規則)
		nextEpBtn.textContent = 'Next ▶'
		nextEpBtn.style.cssText = `
            all: unset;
            cursor: pointer;
            background: #666;
            color: #fff;
            padding: 6px 10px;
            border-radius: 6px;
            flex-shrink: 0;
        `

		tip.style.cssText = `
            position: absolute;
            bottom: 28px;
            left: 0;
            color: #fff;
            background: rgba(0,0,0,.75);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            transform: translateX(-50%);
            pointer-events: none;
            opacity: 0;
            transition: opacity .1s ease;
            z-index: 9999;
        `

		const styleThumb = `
            ::-webkit-slider-thumb {
                appearance: none;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #fff;
                cursor: pointer;
            }
            ::-moz-range-thumb {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #fff;
                cursor: pointer;
            }
            ::-ms-thumb {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #fff;
                cursor: pointer;
            }
        `

		btn.textContent = '播放 ▶'
		btn.style.cssText =
			'all:unset;cursor:pointer;background:#111;color:#fff;padding:6px 10px;border-radius:6px;flex-shrink:0'

		rng.type = 'range'
		rng.min = 0
		rng.max = 1000
		rng.value = 0
		rng.style.cssText = `
            flex: 1;
            height: 4px;
            appearance: none;
            background: linear-gradient(to right, ${ACTIVE} 0%, ${INACTIVE} 0%);
            border-radius: 3px;
            cursor: pointer;
            min-width: 200px;
            max-width: 400px;
            position: relative;
        `

		tm.style.cssText =
			'color:#fff;margin:0 8px;flex-shrink:0;white-space:nowrap;'

		ic.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
                <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zm2.5 0c0 3.04-1.72 5.64-4.25 6.92l-.75 1.08C18.18 19.95 20 16.76 20 12s-1.82-7.95-5-8.99l.75 1.08C17.28 6.36 19 8.96 19 12z"/>
            </svg>`

		ic.style.cssText =
			'width:18px;height:18px;cursor:pointer;margin-right:4px;transition:opacity .2s;flex-shrink:0'

		vol.type = 'range'
		vol.min = 0
		vol.max = 100
		vol.value = 100
		vol.style.cssText = `
            width: 100px;
            height: 4px;
            appearance: none;
            background: linear-gradient(to right, ${ACTIVE} 100%, ${INACTIVE} 0%);
            border-radius: 3px;
            cursor: pointer;
            flex-shrink: 0;
        `

		fs.textContent = '⛶'
		fs.style.cssText =
			'all:unset;cursor:pointer;background:#111;color:#fff;padding:6px 10px;border-radius:6px;flex-shrink:0'

		skipIntroBtn.textContent = 'Skip Intro'
		skipIntroBtn.style.cssText = `
            all: unset;
            cursor: pointer;
            background: ${ACTIVE};
            color: #fff;
            padding: 6px 10px;
            border-radius: 6px;
            flex-shrink: 0;
            display: none;
        `

		const bar = document.createElement('div')
		bar.style.cssText = `
            position: relative;
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: rgba(0,0,0,.85);
            padding: 8px 12px;
            border-radius: 10px;
            white-space: nowrap;
            overflow: visible;
        `

		bar.append(
			homeBtn,
			btn,
			rng,
			tm,
			ic,
			vol,
			fs,
			skipIntroBtn,
			nextEpBtn,
			tip
		)

		const sty = document.createElement('style')
		sty.textContent = `${styleThumb}`
		sh.append(sty, bar)

		// ==========================
		// Skip Intro 狀態管理
		// ==========================
		let skipSegment = null
		let skipEndSec = null
		let triedInitSkip = false

		function ensureSkipSegment() {
			if (skipSegment && isFinite(skipEndSec)) return true

			const playback = getActivePlaybackState()
			if (!playback) {
				// 只 log 一次就好
				if (!triedInitSkip) {
					console.warn(
						'目前找不到可跳過的片段（NFPlaybackState 不存在或無有效 entry）'
					)
				}
				triedInitSkip = true
				return false
			}

			const seg = getSkipSegmentFromPlayback(playback)
			if (!seg) {
				if (!triedInitSkip) {
					console.warn(
						'目前找不到可跳過的片段（NFPlaybackState 沒有 skip_credits / intro / recap）'
					)
				}
				triedInitSkip = true
				return false
			}

			skipSegment = seg
			skipEndSec = seg.endOffsetMs / 1000
			triedInitSkip = true

			console.log(
				`⏭ 偵測到可跳片段 type=${seg.type}, start=${seg.startOffsetMs}ms, end=${
					seg.endOffsetMs
				}ms (~${(skipEndSec | 0)}s)`
			)

			return true
		}

		// --- Skip Intro 按鈕行為（手動觸發，讀 NFPlaybackState） ---
		skipIntroBtn.onclick = () => {
			if (!ensureSkipSegment()) {
				skipIntroBtn.textContent = 'No Skippable'
				setTimeout(() => (skipIntroBtn.textContent = 'Skip Intro'), 2000)
				return
			}

			seekTo(skipEndSec)

			// 按過後直接隱藏按鈕
			skipIntroBtn.style.display = 'none'
		}

		// ==========================
		// Home / Next Episode 行為
		// ==========================
		homeBtn.onclick = () => {
			window.location.href = 'https://www.netflix.com/browse'
		}

		async function checkNextEpisodeExists(nextId) {
			try {
				const res = await fetch(`https://www.netflix.com/watch/${nextId}`, {
					method: 'GET',
					mode: 'no-cors',
					cache: 'no-store',
				})

				// no-cors 會回 opaque response → res.type === "opaque"
				// 代表成功（影片存在）
				if (res.type === 'opaque') return true

				// 若不是 opaque，則 fallback 判斷 res.ok
				return res.ok
			} catch (e) {
				// 404 / DNS 會走到這裡
				return false
			}
		}

		nextEpBtn.onclick = async () => {
			try {
				const url = new URL(location.href)
				const current = Number(url.pathname.split('/watch/')[1])
				const next = current + 1

				// 檢查是否存在下一集
				const exists = await checkNextEpisodeExists(next)

				if (!exists) {
					nextEpBtn.textContent = 'No Next'
					setTimeout(() => (nextEpBtn.textContent = 'Next ▶'), 1500)
					return
				}

				// 跳轉下一集（沿用你發現的 +1 規則）
				location.href = `https://www.netflix.com/watch/${next}?trackId=14170289`
			} catch (err) {
				console.warn(err)
				nextEpBtn.textContent = 'Error'
				setTimeout(() => (nextEpBtn.textContent = 'Next ▶'), 1500)
			}
		}

		// --- 狀態 ---
		let hideTimer = null
		let lastVol = -1
		let lastMute = null
		let dragging = false

		function setRangeGradient(el, percent) {
			el.style.background = `linear-gradient(to right, ${ACTIVE} ${
				percent * 100
			}%, ${INACTIVE} ${percent * 100}%)`
		}

		function setVolGradientByValue(val, muted) {
			if (muted) {
				vol.style.background =
					'linear-gradient(to right, ' +
					VOL_MUTE +
					' 0%, ' +
					VOL_MUTE +
					' 100%)'
				return
			}
			const p = Math.max(0, Math.min(100, val)) / 100
			vol.style.background = `linear-gradient(to right, ${ACTIVE} ${
				p * 100
			}%, ${INACTIVE} ${p * 100}%)`
		}

		function syncVol(v) {
			if (!v) return

			const mute = v.muted
			const volVal = Math.round(v.volume * 100)

			if (mute !== lastMute || volVal !== lastVol) {
				ic.style.opacity = mute || volVal === 0 ? '0.4' : '1'
				ic.title = mute ? 'Muted' : `Volume: ${volVal}%`

				vol.value = volVal
				setVolGradientByValue(volVal, mute)

				lastVol = volVal
				lastMute = mute
			}
		}

		function update() {
			if (dragging) return

			const v = getVideo()
			if (!v) return

			const d = v.duration || 0
			const c = v.currentTime || 0

			const percent = isFinite(d) ? Math.min(1000, (c / d) * 1000) : 0

			rng.value = percent
			setRangeGradient(rng, percent / 1000)

			tm.textContent = `${fmt(c)} / ${fmt(d)}`
			syncVol(v)

			btn.textContent = v.paused ? '播放 ▶' : '暫停 ⏸'

			// 根據當前時間動態顯示 / 隱藏 Skip Intro
			if (ensureSkipSegment()) {
				if (v.currentTime >= skipEndSec - 0.2) {
					skipIntroBtn.style.display = 'none'
				} else {
					skipIntroBtn.style.display = 'inline-flex'
				}
			} else {
				skipIntroBtn.style.display = 'none'
			}
		}

		window.__ovInterval = setInterval(update, 500)

		function uiShow() {
			box.style.opacity = '1'
			box.style.pointerEvents = 'auto'
			document.body.style.cursor = 'default'
		}

		function uiHide() {
			box.style.opacity = '0'
			box.style.pointerEvents = 'none'
			const v = getVideo()
			if (v && !v.paused) document.body.style.cursor = 'none'
		}

		function resetHide() {
			clearTimeout(hideTimer)
			uiShow()
			hideTimer = setTimeout(uiHide, 3000)
		}

		const act = () => resetHide()

		window.__ovHandlers = [
			['mousemove', act],
			['keydown', act],
			['click', act],
		]

		const v0 = getVideo()
		if (v0) window.__ovHandlers.push(['mousemove', act, v0])

		window.__ovHandlers.forEach(([t, f, tg]) =>
			(tg || window).addEventListener(t, f, true)
		)

		resetHide()

		ic.onclick = () => {
			const v = getVideo()
			if (v) {
				v.muted = !v.muted
				syncVol(v)
			}
		}

		vol.oninput = () => {
			const v = getVideo()
			if (!v) return

			const newVal = parseFloat(vol.value)
			const volPercent = Math.max(0, Math.min(100, newVal))

			v.volume = volPercent / 100
			v.muted = volPercent === 0

			setVolGradientByValue(volPercent, v.muted)

			window.__ovLastVolVal = volPercent
		}

		fs.onclick = () => {
			!document.fullscreenElement
				? (
						getVideo()?.parentElement || document.documentElement
				  ).requestFullscreen?.()
				: document.exitFullscreen?.()
		}

		btn.onclick = () => {
			btn.blur()
			const v = getVideo()
			if (!v) return

			if (v.paused) {
				v.play()
				btn.textContent = '暫停 ⏸'
			} else {
				v.pause()
				btn.textContent = '播放 ▶'
			}
		}

		function setTipByPercent(p, dur) {
			const rectR = rng.getBoundingClientRect()
			const x = p * rectR.width

			tip.style.left = `${rectR.left + x - box.getBoundingClientRect().left}px`
			tip.textContent = fmt(dur * p)
			tip.style.opacity = '1'
		}

		rng.addEventListener('input', () => {
			dragging = true
			const v = getVideo()
			if (!v) return

			const d = v.duration
			if (!isFinite(d)) return

			const p = rng.value / 1000

			setRangeGradient(rng, p)
			setTipByPercent(p, d)

			tm.textContent = `${fmt(d * p)} / ${fmt(d)}`
		})

		rng.addEventListener('change', () => {
			dragging = false

			const v = getVideo()
			if (!v) return

			const d = v.duration
			if (!isFinite(d)) return

			seekTo(d * (rng.value / 1000))
			update()
			tip.style.opacity = '0'
		})

		rng.addEventListener('mouseleave', () => {
			if (!dragging) tip.style.opacity = '0'
		})

		rng.addEventListener('mousemove', (e) => {
			const v = getVideo()
			if (!v) return

			const d = v.duration
			if (!isFinite(d)) return

			const rect = rng.getBoundingClientRect()
			const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))

			setTipByPercent(p, d)
		})

		// 單擊播放/暫停不會被多次綁定的 handler 影響
		window.__ovClickHandler = function (e) {
			const v = getVideo()
			const p = document.querySelector('[data-uia="player"]')

			if (!v || !p) return

			if (p.contains(e.target) && !box.contains(e.target)) {
				e.preventDefault()

				if (v.paused) {
					v.play()
					btn.textContent = '暫停 ⏸'
				} else {
					v.pause()
					btn.textContent = '播放 ▶'
				}

				resetHide()
			}
		}

		document.addEventListener('click', window.__ovClickHandler, true)

		// 空白鍵 / K / ← → 控制（獨立 handler，確保可被清除）
		window.__ovPlayPauseHandler = function (e) {
			const v = getVideo()
			if (!v) return

			if (e.key === ' ') {
				e.preventDefault()
				e.stopPropagation()
			}

			let step = e.shiftKey ? 60 : 10

			switch (e.key) {
				case ' ':
				case 'k':
				case 'K':
					if (v.paused) {
						v.play()
						btn.textContent = '暫停 ⏸'
					} else {
						v.pause()
						btn.textContent = '播放 ▶'
					}
					break
				case 'ArrowRight':
					seekTo(v.currentTime + step)
					break
				case 'ArrowLeft':
					seekTo(v.currentTime - step)
					break
			}

			resetHide()
		}

		window.addEventListener('keydown', window.__ovPlayPauseHandler, true)

		// 全螢幕
		document.addEventListener('fullscreenchange', () =>
			setTimeout(() => {
				if (document.fullscreenElement)
					document.fullscreenElement.appendChild(box)
				else document.body.appendChild(box)
			}, 200)
		)

		console.clear()
		console.log('%c🎬 控制列已載入 v1.4.1 ✅', 'color:lime;font-weight:bold;')
		console.log('%c🖱 單擊影片：播放/暫停；雙擊：原生全螢幕', 'color:cyan;')
		console.log(
			'Space/K：播放/暫停 | ←/→：10s | Hover 顯示時間 | 音量雙色 | Skip Intro 讀 NFPlaybackState | Shift+X：關閉控制列（之後可加）'
		)
	}

	// --- 隱藏阻擋的 overlay ---
	;[
		...document.querySelectorAll(
			"div[data-no-focus-lock='true'], div[data-uia*='modal'], div[class*='interstitial'], div[class*='focus-trap'], div[role='dialog']"
		),
	].forEach((e) => e.setAttribute(ATTR, '1'))
})()