// version: 1.3.1

// ======================
// 控制列注入器（穩定版）
// ======================
(function () {
    var ATTR = 'data-ov',
        STYLE = 'ov-style',
        UI_ID = 'ov-ui';

    // --- 移除舊的 UI / handler ---
    if (document.getElementById(UI_ID)) {
        try {
            document.getElementById(UI_ID).remove();
            if (window.__ovInterval) clearInterval(window.__ovInterval);

            if (window.__ovHandlers) {
                window.__ovHandlers.forEach(([t, f, tg]) =>
                    (tg || window).removeEventListener(t, f, true)
                );
            }

            if (window.__ovClickHandler) {
                document.removeEventListener('click', window.__ovClickHandler, true);
                window.__ovClickHandler = null;
            }

            if (window.__ovKeyBlocker) {
                window.removeEventListener('keydown', window.__ovKeyBlocker, true);
                window.__ovKeyBlocker = null;
            }

            if (window.__ovPlayPauseHandler) {
                window.removeEventListener('keydown', window.__ovPlayPauseHandler, true);
                window.__ovPlayPauseHandler = null;
            }
        } catch (e) {}

        console.log('♻️ 已清除舊控制列，重新建立中...');
    }

    // --- 插入 STYLE ---
    if (!document.getElementById(STYLE)) {
        const st = document.createElement('style');
        st.id = STYLE;
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
        `;
        document.head.appendChild(st);
    }

    // --- 找影片元素 ---
    function getVideo() {
        const v = [...document.querySelectorAll('video')]
            .filter(x => x.offsetWidth > 0 && x.offsetHeight > 0);

        if (!v.length) return null;

        v.sort((a, b) =>
            b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight
        );

        return v[0];
    }

    // --- 安裝「攔 原生」的 keydown（不攔自己的 handler） ---
    if (window.__ovKeyBlocker) {
        window.removeEventListener('keydown', window.__ovKeyBlocker, true);
        window.__ovKeyBlocker = null;
    }

    if (window.__ovPlayPauseHandler) {
        window.removeEventListener('keydown', window.__ovPlayPauseHandler, true);
        window.__ovPlayPauseHandler = null;
    }

    // 延遲一點時間，確保在原生播放器自己綁完 handler 之後再攔截
    setTimeout(() => {
        window.__ovKeyBlocker = function (e) {
            const keys = [' ', 'ArrowLeft', 'ArrowRight', 'k', 'K', 'j', 'J'];
            if (!keys.includes(e.key)) return;

            // 阻擋原生的 handler，不阻擋我們自己後面加的 handler
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener('keydown', window.__ovKeyBlocker, true);
        console.log('🎯 KeyBlocker installed AFTER Original handlers');
    }, 300);

    // --- API ---
    function getNF() {
        try {
            const c = window.netflix?.appContext?.state.playerApp.getAPI();
            const sid = c.videoPlayer.getAllPlayerSessionIds()[0];
            return c.videoPlayer.getVideoPlayerBySessionId(sid);
        } catch {
            return null;
        }
    }

    function fmt(t) {
        if (!isFinite(t) || t < 0) return '--:--';
        t |= 0;
        return ('0' + ((t / 60) | 0)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2);
    }

    function seekTo(sec) {
        const p = getNF(),
            v = getVideo();
        if (!v) return;

        const t = Math.max(0, Math.min(sec, v.duration)),
            was = v.paused;

        try {
            if (was) v.play();
            if (p && p.seek) p.seek(t * 1000);
            else v.currentTime = t;

            setTimeout(() => was && v.pause(), 200);
        } catch {
            v.currentTime = t;
        }
    }

    const ACTIVE = '#e50914',
        INACTIVE = '#555',
        VOL_MUTE = '#444';

    // --- 建 UI ---
    if (!document.getElementById(UI_ID)) {
        const box = document.createElement('div');
        box.id = UI_ID;
        Object.assign(box.style, {
            position: 'fixed',
            bottom: '6%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            transition: 'opacity .4s ease'
        });

        document.body.appendChild(box);

        const sh = box.attachShadow({ mode: 'open' });

        const btn = document.createElement('button');
        const rng = document.createElement('input');
        const tm = document.createElement('span');
        const ic = document.createElement('span');
        const vol = document.createElement('input');
        const fs = document.createElement('button');
        const tip = document.createElement('div');

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
        `;

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
        `;

        btn.textContent = '播放 ▶';
        btn.style.cssText =
            'all:unset;cursor:pointer;background:#111;color:#fff;padding:6px 10px;border-radius:6px;flex-shrink:0';

        rng.type = 'range';
        rng.min = 0;
        rng.max = 1000;
        rng.value = 0;
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
        `;

        tm.style.cssText =
            'color:#fff;margin:0 8px;flex-shrink:0;white-space:nowrap;';

        ic.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
                <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zm2.5 0c0 3.04-1.72 5.64-4.25 6.92l-.75 1.08C18.18 19.95 20 16.76 20 12s-1.82-7.95-5-8.99l.75 1.08C17.28 6.36 19 8.96 19 12z"/>
            </svg>`;

        ic.style.cssText =
            'width:18px;height:18px;cursor:pointer;margin-right:4px;transition:opacity .2s;flex-shrink:0';

        vol.type = 'range';
        vol.min = 0;
        vol.max = 100;
        vol.value = 100;
        vol.style.cssText = `
            width: 100px;
            height: 4px;
            appearance: none;
            background: linear-gradient(to right, ${ACTIVE} 100%, ${INACTIVE} 0%);
            border-radius: 3px;
            cursor: pointer;
            flex-shrink: 0;
        `;

        fs.textContent = '⛶';
        fs.style.cssText =
            'all:unset;cursor:pointer;background:#111;color:#fff;padding:6px 10px;border-radius:6px;flex-shrink:0';

        const bar = document.createElement('div');
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
        `;

        bar.append(btn, rng, tm, ic, vol, fs, tip);

        const sty = document.createElement('style');
        sty.textContent = styleThumb;
        sh.append(sty, bar);

        // --- 狀態 ---
        let hideTimer = null,
            lastVol = -1,
            lastMute = null,
            dragging = false;

        function setRangeGradient(el, percent) {
            el.style.background =
                `linear-gradient(to right, ${ACTIVE} ${percent * 100}%, ${INACTIVE} ${percent * 100}%)`;
        }

        function setVolGradientByValue(val, muted) {
            if (muted) {
                vol.style.background =
                    `linear-gradient(to right, ${VOL_MUTE} 0%, ${VOL_MUTE} 100%)`;
                return;
            }
            const p = Math.max(0, Math.min(100, val)) / 100;
            vol.style.background =
                `linear-gradient(to right, ${ACTIVE} ${p * 100}%, ${INACTIVE} ${p * 100}%)`;
        }

        function syncVol(v) {
            if (!v) return;

            const mute = v.muted,
                volVal = Math.round(v.volume * 100);

            if (mute !== lastMute || volVal !== lastVol) {
                ic.style.opacity = mute || volVal === 0 ? '0.4' : '1';
                ic.title = mute ? 'Muted' : `Volume: ${volVal}%`;

                vol.value = volVal;
                setVolGradientByValue(volVal, mute);

                lastVol = volVal;
                lastMute = mute;
            }
        }

        function update() {
            if (dragging) return;

            const v = getVideo();
            if (!v) return;

            const d = v.duration || 0;
            const c = v.currentTime || 0;

            const percent = isFinite(d) ? Math.min(1000, (c / d) * 1000) : 0;

            rng.value = percent;
            setRangeGradient(rng, percent / 1000);

            tm.textContent = `${fmt(c)} / ${fmt(d)}`;
            syncVol(v);

            if (v.paused) {
                if (btn.textContent !== '播放 ▶') btn.textContent = '播放 ▶';
            } else {
                if (btn.textContent !== '暫停 ⏸') btn.textContent = '暫停 ⏸';
            }
        }

        window.__ovInterval = setInterval(update, 500);

        function uiShow() {
            box.style.opacity = '1';
            box.style.pointerEvents = 'auto';
            document.body.style.cursor = 'default';
        }

        function uiHide() {
            box.style.opacity = '0';
            box.style.pointerEvents = 'none';
            const v = getVideo();
            if (v && !v.paused) document.body.style.cursor = 'none';
        }

        function resetHide() {
            clearTimeout(hideTimer);
            uiShow();
            hideTimer = setTimeout(uiHide, 3000);
        }

        const act = () => resetHide();

        window.__ovHandlers = [
            ['mousemove', act],
            ['keydown', act],
            ['click', act]
        ];

        const v0 = getVideo();
        if (v0) window.__ovHandlers.push(['mousemove', act, v0]);

        window.__ovHandlers.forEach(([t, f, tg]) =>
            (tg || window).addEventListener(t, f, true)
        );

        resetHide();

        ic.onclick = () => {
            const v = getVideo();
            if (v) {
                v.muted = !v.muted;
                syncVol(v);
            }
        };

        vol.oninput = () => {
            const player = document.querySelector('[data-uia="player"]');
            const old = window.__ovLastVolVal ?? 50;
            const newVal = parseFloat(vol.value);
            const delta = newVal - old;
            window.__ovLastVolVal = newVal;

            const dir = delta > 0 ? -100 : 100;

            setVolGradientByValue(newVal, false);

            player?.dispatchEvent(
                new WheelEvent('wheel', { deltaY: dir, bubbles: true })
            );
        };

        fs.onclick = () => {
            if (!document.fullscreenElement) {
                (getVideo()?.parentElement || document.documentElement)
                    .requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
        };

        btn.onclick = () => {
            btn.blur(); // 避免 button focus 讓空白鍵打到它

            const v = getVideo();
            if (!v) return;

            if (v.paused) {
                v.play();
                btn.textContent = '暫停 ⏸';
            } else {
                v.pause();
                btn.textContent = '播放 ▶';
            }
        };

        function setTipByPercent(p, dur) {
            const rectBar = bar.getBoundingClientRect();
            const rectR = rng.getBoundingClientRect();
            const x = rectR.left - rectBar.left + p * rectR.width;
            tip.style.left = x + 'px';
            tip.textContent = fmt(dur * p);
            tip.style.opacity = '1';
        }

        rng.addEventListener('input', () => {
            dragging = true;
            const v = getVideo();
            if (!v) return;

            const d = v.duration;
            if (!isFinite(d)) return;

            const p = rng.value / 1000;

            setRangeGradient(rng, p);
            setTipByPercent(p, d);

            tm.textContent = `${fmt(d * p)} / ${fmt(d)}`;
        });

        rng.addEventListener('change', () => {
            dragging = false;

            const v = getVideo();
            if (!v) return;

            const d = v.duration;
            if (!isFinite(d)) return;

            seekTo(d * (rng.value / 1000));
            update();
            tip.style.opacity = '0';
        });

        rng.addEventListener('mouseleave', () => {
            if (!dragging) tip.style.opacity = '0';
        });

        rng.addEventListener('mousemove', e => {
            const v = getVideo();
            if (!v) return;

            const d = v.duration;
            if (!isFinite(d)) return;

            const rect = rng.getBoundingClientRect();
            const p = Math.max(
                0,
                Math.min(1, (e.clientX - rect.left) / rect.width)
            );

            setTipByPercent(p, d);
        });

        // 影片區域單擊：播放 / 暫停
        window.__ovClickHandler = function (e) {
            const v = getVideo();
            const p = document.querySelector('[data-uia="player"]');

            if (!v || !p) return;

            if (p.contains(e.target) && !box.contains(e.target)) {
                e.preventDefault();

                if (v.paused) {
                    v.play();
                    btn.textContent = '暫停 ⏸';
                } else {
                    v.pause();
                    btn.textContent = '播放 ▶';
                }

                resetHide();
            }
        };

        document.addEventListener('click', window.__ovClickHandler, true);

        // 我自己的鍵盤控制 handler
        window.__ovPlayPauseHandler = function (e) {
            const v = getVideo();
            if (!v) return;

            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
            }

            let step = e.shiftKey ? 60 : 10;

            switch (e.key) {
                case ' ':
                case 'k':
                case 'K':
                    if (v.paused) {
                        v.play();
                        btn.textContent = '暫停 ⏸';
                    } else {
                        v.pause();
                        btn.textContent = '播放 ▶';
                    }
                    break;
                case 'ArrowRight':
                    seekTo(v.currentTime + step);
                    break;
                case 'ArrowLeft':
                    seekTo(v.currentTime - step);
                    break;
            }

            resetHide();
        };

        window.addEventListener('keydown', window.__ovPlayPauseHandler, true);

        document.addEventListener('fullscreenchange', () =>
            setTimeout(() => {
                if (document.fullscreenElement)
                    document.fullscreenElement.appendChild(box);
                else
                    document.body.appendChild(box);
            }, 200)
        );

        console.clear();
        console.log('%c🎬 控制列已載入 ✅', 'color:lime;font-weight:bold;');
        console.log('%c🖱 單擊影片：播放/暫停；雙擊：原生全螢幕', 'color:cyan;');
        console.log(
            'Space/K：播放/暫停 | ←/→：10s | Hover 顯示時間 | 音量雙色 | Shift+X：關閉控制列'
        );
    }

    // --- 隱藏阻擋的 overlay ---
    [...document.querySelectorAll(
        "div[data-no-focus-lock='true'], div[data-uia*='modal'], div[class*='interstitial'], div[class*='focus-trap'], div[role='dialog']"
    )].forEach(e => e.setAttribute(ATTR, '1'));
})();