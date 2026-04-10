// Voice Swipe — Content Script
// Web Speech API + DOM control for YouTube Shorts / Instagram Reels

(() => {
  'use strict';

  const DEFAULT_CONFIG = {
    micEnabled: false,
    confidence: 0.5,
    language: 'ko-KR',
  };

  const COMMANDS = {
    next: ['다음', 'next'],
    previous: ['이전', 'back', '뒤로', 'previous'],
  };

  const state = {
    config: { ...DEFAULT_CONFIG },
    platform: 'unsupported',
    isListening: false,
    isPaused: false,
    recognition: null,
    lastCommandAt: 0,
    restartTimer: null,
    // Audio meter
    audioStream: null,
    audioContext: null,
    analyser: null,
    meterRAF: null,
    audioLevel: 0,
    // HUD
    hud: null,
    lastTranscript: '',
    lastConfidence: 0,
    lastMatched: false,
    errorText: '',
  };

  // ---------- Platform detection ----------
  function detectPlatform() {
    const url = window.location.href;
    if (/^https:\/\/www\.youtube\.com\/shorts\//.test(url)) {
      return 'youtube-shorts';
    }
    if (/^https:\/\/www\.instagram\.com\/reels\//.test(url)) {
      return 'instagram-reels';
    }
    return 'unsupported';
  }

  // ---------- DOM Actions ----------
  function dispatchKey(key) {
    const opts = {
      key,
      code: key,
      keyCode: key === 'ArrowDown' ? 40 : 38,
      which: key === 'ArrowDown' ? 40 : 38,
      bubbles: true,
      cancelable: true,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function scrollBy(direction) {
    window.scrollBy({
      top: direction * window.innerHeight,
      behavior: 'auto',
    });
  }

  function findAndClickButton(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  }

  // Find the active <video> element in viewport
  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    const viewportMid = window.innerHeight / 2;
    return videos.find((v) => {
      const rect = v.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top <= viewportMid &&
        rect.bottom >= viewportMid
      );
    });
  }

  // Walk up from an element to find its scrollable ancestor
  function findScrollContainer(el) {
    let current = el;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const snapType = style.scrollSnapType;
      const isScrollable =
        (overflowY === 'auto' || overflowY === 'scroll') &&
        current.scrollHeight > current.clientHeight;
      if (isScrollable || (snapType && snapType !== 'none')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function dispatchKeyToTargets(key, keyCode) {
    const targets = [
      document.querySelector('ytd-shorts'),
      document.querySelector('#shorts-container'),
      document.querySelector('ytd-reel-video-renderer[is-active]'),
      document.querySelector('ytd-player'),
      findActiveVideo(),
      document.body,
      document,
    ].filter(Boolean);

    const eventInit = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };

    targets.forEach((t) => {
      try {
        t.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        t.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        t.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      } catch (e) {}
    });
  }

  function dispatchWheelToTargets(direction) {
    const targets = [
      document.querySelector('#shorts-container'),
      document.querySelector('ytd-shorts'),
      findActiveVideo(),
    ].filter(Boolean);

    targets.forEach((t) => {
      try {
        t.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: direction * 120,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          })
        );
      } catch (e) {}
    });
  }

  function navigateYouTubeShorts(direction) {
    console.log('[VoiceSwipe] Navigate Shorts:', direction > 0 ? 'next' : 'prev');

    // Strategy 1: Keyboard events (YouTube's own shortcut path, not affected by scroll-snap revert)
    console.log('[VoiceSwipe] dispatch key events');
    dispatchKeyToTargets(
      direction > 0 ? 'ArrowDown' : 'ArrowUp',
      direction > 0 ? 40 : 38
    );

    // Strategy 2: Wheel events
    console.log('[VoiceSwipe] dispatch wheel events');
    dispatchWheelToTargets(direction);

    // Strategy 3: scrollIntoView on next ytd-reel-video-renderer sibling
    const renderers = document.querySelectorAll('ytd-reel-video-renderer');
    if (renderers.length > 1) {
      const viewportMid = window.innerHeight / 2;
      let currentIndex = -1;
      for (let i = 0; i < renderers.length; i++) {
        const rect = renderers[i].getBoundingClientRect();
        if (rect.top <= viewportMid && rect.bottom >= viewportMid) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex >= 0) {
        const targetIndex = currentIndex + direction;
        if (targetIndex >= 0 && targetIndex < renderers.length) {
          console.log('[VoiceSwipe] renderer scrollIntoView:', currentIndex, '->', targetIndex);
          // Use 'auto' (instant) — 'smooth' conflicts with YouTube's scroll-snap
          // and gets queued until tab loses focus
          renderers[targetIndex].scrollIntoView({ behavior: 'auto', block: 'start' });
          return true;
        }
      }
    }

    // Strategy 2: Direct scrollTop set on #shorts-container
    // (bypasses scroll-snap smoothing that ignores scrollBy)
    const shortsContainer =
      document.querySelector('#shorts-container') ||
      document.querySelector('ytd-shorts');
    if (shortsContainer) {
      const before = shortsContainer.scrollTop;
      const delta = direction * shortsContainer.clientHeight;
      shortsContainer.scrollTop = before + delta;
      console.log('[VoiceSwipe] direct scrollTop:', before, '->', shortsContainer.scrollTop);

      // Verify it worked — if not, try scrolling document.documentElement
      if (shortsContainer.scrollTop === before) {
        document.documentElement.scrollTop += delta;
        console.log('[VoiceSwipe] container scroll no-op, scrolled documentElement');
      }

      return true;
    }

    // Strategy 3: Walk up from active <video> to find scrollable ancestor
    const activeVideo = findActiveVideo();
    if (activeVideo) {
      const container = findScrollContainer(activeVideo);
      if (container) {
        const before = container.scrollTop;
        container.scrollTop = before + direction * container.clientHeight;
        console.log('[VoiceSwipe] walk-up scrollTop:', before, '->', container.scrollTop);
        return true;
      }
    }

    // Strategy 4: Dispatch key events to multiple targets
    console.log('[VoiceSwipe] fallback: dispatch keys');
    const key = direction > 0 ? 'ArrowDown' : 'ArrowUp';
    const keyCode = direction > 0 ? 40 : 38;
    const targets = [
      document,
      document.body,
      document.querySelector('ytd-shorts'),
      activeVideo,
    ].filter(Boolean);
    targets.forEach((t) => {
      try {
        t.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            code: key,
            keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
            composed: true,
          })
        );
      } catch (e) {}
    });
    return false;
  }

  function navigateInstagramReels(direction) {
    console.log('[VoiceSwipe] Navigate Reels:', direction > 0 ? 'next' : 'prev');

    // Strategy 1: Click navigation button (Instagram renders on-screen arrows)
    const nextSelectors = [
      'button[aria-label="Next"]',
      'button[aria-label="다음"]',
      'div[role="button"][aria-label="Next"]',
      'div[role="button"][aria-label="다음"]',
    ];
    const prevSelectors = [
      'button[aria-label="Back"]',
      'button[aria-label="Previous"]',
      'button[aria-label="이전"]',
      'div[role="button"][aria-label="Back"]',
      'div[role="button"][aria-label="Previous"]',
    ];
    if (findAndClickButton(direction > 0 ? nextSelectors : prevSelectors)) {
      console.log('[VoiceSwipe] Reels button click succeeded');
      return true;
    }

    // Strategy 2: Scroll the reels video into view
    // Instagram Reels uses <video> elements inside articles
    const videos = document.querySelectorAll('main video');
    if (videos.length > 0) {
      let currentIndex = -1;
      const viewportMid = window.innerHeight / 2;
      for (let i = 0; i < videos.length; i++) {
        const rect = videos[i].getBoundingClientRect();
        if (rect.top <= viewportMid && rect.bottom >= viewportMid) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex >= 0) {
        const targetIndex = currentIndex + direction;
        if (targetIndex >= 0 && targetIndex < videos.length) {
          console.log('[VoiceSwipe] Reels video scrollIntoView');
          videos[targetIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
          return true;
        }
      }
    }

    // Strategy 3: Keyboard + window scroll fallback
    console.warn('[VoiceSwipe] Reels fallback');
    dispatchKey(direction > 0 ? 'ArrowDown' : 'ArrowUp');
    window.scrollBy({ top: direction * window.innerHeight, behavior: 'auto' });
    return false;
  }

  function executeCommand(command) {
    const now = Date.now();
    if (now - state.lastCommandAt < 600) return;
    state.lastCommandAt = now;

    const direction = command === 'next' ? 1 : -1;

    // Briefly stop recognition to free main thread — onend handler auto-restarts
    try {
      if (state.recognition && state.isListening) {
        state.recognition.stop();
      }
    } catch (e) {}

    // Dispatch custom event to main-world script which has direct access
    // to YouTube's Polymer components and can click real buttons
    try {
      document.dispatchEvent(
        new CustomEvent('voice-swipe-nav', {
          detail: { direction },
          bubbles: true,
          composed: true,
        })
      );
    } catch (e) {}

    // Also run content-script fallback navigation in case main-world fails
    setTimeout(() => {
      if (state.platform === 'youtube-shorts') {
        navigateYouTubeShorts(direction);
      } else if (state.platform === 'instagram-reels') {
        navigateInstagramReels(direction);
      }
    }, 100);

    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      command,
      platform: state.platform,
    }).catch(() => {});
  }

  // ---------- Command matching ----------
  function matchCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    for (const [cmd, phrases] of Object.entries(COMMANDS)) {
      for (const phrase of phrases) {
        if (text === phrase || text.endsWith(' ' + phrase) || text.startsWith(phrase + ' ')) {
          return cmd;
        }
      }
    }
    return null;
  }

  // ---------- Audio Level Meter (Web Audio API) ----------
  async function setupAudioMeter() {
    if (state.audioContext) return true;

    try {
      state.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = state.audioContext.createMediaStreamSource(state.audioStream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 512;
      state.analyser.smoothingTimeConstant = 0.3;
      source.connect(state.analyser);

      startMeterLoop();
      return true;
    } catch (err) {
      console.warn('[VoiceSwipe] Audio meter setup failed:', err);
      state.errorText = '마이크 접근 실패: ' + err.message;
      updateHud();
      return false;
    }
  }

  function startMeterLoop() {
    if (!state.analyser) return;
    const data = new Uint8Array(state.analyser.frequencyBinCount);

    const loop = () => {
      if (!state.analyser) return;
      state.analyser.getByteFrequencyData(data);

      // Calculate RMS volume (normalized 0-1)
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
      }
      const rms = Math.sqrt(sum / data.length);
      state.audioLevel = Math.min(1, rms / 128);

      updateMeterBars();
      state.meterRAF = requestAnimationFrame(loop);
    };
    loop();
  }

  function stopAudioMeter() {
    if (state.meterRAF) {
      cancelAnimationFrame(state.meterRAF);
      state.meterRAF = null;
    }
    if (state.audioStream) {
      state.audioStream.getTracks().forEach((t) => t.stop());
      state.audioStream = null;
    }
    if (state.audioContext) {
      state.audioContext.close().catch(() => {});
      state.audioContext = null;
    }
    state.analyser = null;
    state.audioLevel = 0;
    updateMeterBars();
  }

  // ---------- HUD (floating debug overlay) ----------
  function createHud() {
    if (state.hud) return;

    const root = document.createElement('div');
    root.id = 'voice-swipe-hud';
    root.innerHTML = `
      <style>
        #voice-swipe-hud {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 2147483647;
          width: 240px;
          padding: 12px;
          background: rgba(18, 18, 18, 0.92);
          color: #f5f5f5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          user-select: none;
          pointer-events: auto;
          transition: opacity 0.2s ease;
        }
        #voice-swipe-hud.hidden { display: none; }
        .vs-hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .vs-hud-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: #9ca3af;
        }
        .vs-hud-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #6b7280;
          transition: background 0.2s ease;
        }
        .vs-hud-dot.listening {
          background: #4ade80;
          box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
          animation: vs-pulse 2s ease-in-out infinite;
        }
        .vs-hud-dot.error { background: #f87171; }
        @keyframes vs-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .vs-hud-close {
          cursor: pointer;
          color: #6b7280;
          font-size: 16px;
          line-height: 1;
          padding: 0 4px;
          background: none;
          border: none;
        }
        .vs-hud-close:hover { color: #f5f5f5; }

        .vs-hud-meter {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 40px;
          margin: 8px 0;
          padding: 6px;
          background: rgba(0, 0, 0, 0.35);
          border-radius: 6px;
        }
        .vs-hud-bar {
          flex: 1;
          background: #374151;
          border-radius: 2px;
          transition: background 0.05s linear, height 0.05s linear;
          min-height: 3px;
        }
        .vs-hud-bar.active { background: #4ade80; }
        .vs-hud-bar.hot { background: #facc15; }
        .vs-hud-bar.peak { background: #f87171; }

        .vs-hud-transcript {
          margin-top: 8px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.35);
          border-radius: 6px;
          font-size: 11px;
          min-height: 32px;
          line-height: 1.4;
        }
        .vs-hud-transcript-label {
          display: block;
          font-size: 9px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 3px;
        }
        .vs-hud-transcript-text {
          color: #f5f5f5;
          font-weight: 500;
          word-break: break-all;
        }
        .vs-hud-transcript-text.empty { color: #6b7280; font-style: italic; font-weight: 400; }
        .vs-hud-transcript-text.matched { color: #4ade80; }
        .vs-hud-transcript-text.below { color: #facc15; }

        .vs-hud-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
          font-size: 10px;
          color: #9ca3af;
          font-variant-numeric: tabular-nums;
        }

        .vs-hud-error {
          margin-top: 8px;
          padding: 6px 8px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 6px;
          color: #f87171;
          font-size: 10px;
          line-height: 1.3;
        }
      </style>
      <div class="vs-hud-header">
        <div class="vs-hud-title">
          <span class="vs-hud-dot" id="vs-hud-dot"></span>
          <span id="vs-hud-status">Voice Swipe</span>
        </div>
        <button class="vs-hud-close" id="vs-hud-close" title="숨기기">×</button>
      </div>
      <div class="vs-hud-meter" id="vs-hud-meter">
        ${Array.from({ length: 16 }).map(() => '<div class="vs-hud-bar"></div>').join('')}
      </div>
      <div class="vs-hud-transcript">
        <span class="vs-hud-transcript-label">들린 내용</span>
        <span class="vs-hud-transcript-text empty" id="vs-hud-transcript">—</span>
      </div>
      <div class="vs-hud-footer">
        <span id="vs-hud-lang">ko-KR</span>
        <span id="vs-hud-confidence">conf: —</span>
      </div>
      <div class="vs-hud-error" id="vs-hud-error" style="display:none"></div>
    `;

    document.documentElement.appendChild(root);
    state.hud = root;

    root.querySelector('#vs-hud-close').addEventListener('click', () => {
      root.classList.add('hidden');
    });
  }

  function removeHud() {
    if (state.hud) {
      state.hud.remove();
      state.hud = null;
    }
  }

  function updateMeterBars() {
    if (!state.hud) return;
    const bars = state.hud.querySelectorAll('.vs-hud-bar');
    const level = state.audioLevel;
    const activeCount = Math.round(level * bars.length);

    bars.forEach((bar, i) => {
      const isActive = i < activeCount;
      bar.className = 'vs-hud-bar';
      if (isActive) {
        if (i >= 13) bar.classList.add('peak');
        else if (i >= 9) bar.classList.add('hot');
        else bar.classList.add('active');
      }
      const height = isActive ? 6 + (i / bars.length) * 28 : 3;
      bar.style.height = height + 'px';
    });
  }

  function updateHud() {
    if (!state.hud) return;

    const dot = state.hud.querySelector('#vs-hud-dot');
    const statusEl = state.hud.querySelector('#vs-hud-status');
    const transcriptEl = state.hud.querySelector('#vs-hud-transcript');
    const langEl = state.hud.querySelector('#vs-hud-lang');
    const confEl = state.hud.querySelector('#vs-hud-confidence');
    const errorEl = state.hud.querySelector('#vs-hud-error');

    // Status dot
    dot.className = 'vs-hud-dot';
    if (state.errorText) {
      dot.classList.add('error');
      statusEl.textContent = '오류';
    } else if (state.isListening && !state.isPaused) {
      dot.classList.add('listening');
      statusEl.textContent = '듣는 중';
    } else if (state.isPaused) {
      statusEl.textContent = '일시정지';
    } else {
      statusEl.textContent = '대기';
    }

    // Transcript
    transcriptEl.className = 'vs-hud-transcript-text';
    if (!state.lastTranscript) {
      transcriptEl.textContent = '—';
      transcriptEl.classList.add('empty');
    } else {
      transcriptEl.textContent = `"${state.lastTranscript}"`;
      if (state.lastMatched) {
        transcriptEl.classList.add('matched');
      } else if (state.lastConfidence < state.config.confidence) {
        transcriptEl.classList.add('below');
      }
    }

    // Language + confidence
    langEl.textContent = state.config.language;
    confEl.textContent = state.lastConfidence
      ? `conf: ${state.lastConfidence.toFixed(2)}`
      : `conf: — (≥ ${state.config.confidence.toFixed(2)})`;

    // Error
    if (state.errorText) {
      errorEl.style.display = 'block';
      errorEl.textContent = state.errorText;
    } else {
      errorEl.style.display = 'none';
    }
  }

  // ---------- Speech Recognition ----------
  function createRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      state.errorText = 'Web Speech API를 지원하지 않는 브라우저';
      updateHud();
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = state.config.language;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const result = event.results[lastIndex];

      // Always capture the first alternative for display (even interim)
      const firstAlt = result[0];
      if (firstAlt && firstAlt.transcript) {
        state.lastTranscript = firstAlt.transcript.trim();
        state.lastConfidence = firstAlt.confidence || 0;
      }

      if (!result.isFinal) {
        updateHud();
        return;
      }

      // On final result: try to match command
      let matched = false;
      for (let i = 0; i < result.length; i++) {
        const alt = result[i];
        if (alt.confidence < state.config.confidence) continue;
        const command = matchCommand(alt.transcript);
        if (command) {
          state.lastTranscript = alt.transcript.trim();
          state.lastConfidence = alt.confidence;
          state.lastMatched = true;
          matched = true;
          executeCommand(command);
          break;
        }
      }

      if (!matched) {
        state.lastMatched = false;
      }
      updateHud();

      // Reset matched highlight after a moment
      if (matched) {
        setTimeout(() => {
          state.lastMatched = false;
          updateHud();
        }, 1500);
      }
    };

    recognition.onend = () => {
      state.isListening = false;
      updateHud();
      if (state.config.micEnabled && !state.isPaused && state.platform !== 'unsupported') {
        clearTimeout(state.restartTimer);
        state.restartTimer = setTimeout(() => {
          startRecognition();
        }, 300);
      }
    };

    recognition.onerror = (event) => {
      console.warn('[VoiceSwipe] Recognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        state.errorText = '마이크 권한이 거부되었습니다';
        state.config.micEnabled = false;
        chrome.runtime.sendMessage({ type: 'PERMISSION_DENIED' }).catch(() => {});
      } else if (event.error === 'no-speech') {
        // Normal — just restarts
      } else if (event.error === 'network') {
        state.errorText = '네트워크 오류 (Web Speech API는 인터넷 연결 필요)';
      } else if (event.error === 'audio-capture') {
        state.errorText = '마이크를 찾을 수 없음';
      } else {
        state.errorText = '인식 오류: ' + event.error;
      }
      updateHud();
    };

    recognition.onstart = () => {
      state.isListening = true;
      state.errorText = '';
      updateHud();
    };

    return recognition;
  }

  async function startRecognition() {
    if (state.platform === 'unsupported') return;
    if (state.isListening) return;
    if (!state.config.micEnabled) return;
    if (state.isPaused) return;

    // Ensure HUD exists and audio meter running
    createHud();
    await setupAudioMeter();

    if (!state.recognition) {
      state.recognition = createRecognition();
      if (!state.recognition) return;
    }

    try {
      state.recognition.lang = state.config.language;
      state.recognition.start();
    } catch (err) {
      // Already started
    }
    updateHud();
  }

  function stopRecognition() {
    if (state.recognition && state.isListening) {
      try {
        state.recognition.stop();
      } catch (err) {
        // ignore
      }
    }
    clearTimeout(state.restartTimer);
    state.isListening = false;
    stopAudioMeter();
    updateHud();
  }

  // ---------- Permission request ----------
  async function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state.errorText = '이 브라우저는 마이크 API를 지원하지 않습니다';
      updateHud();
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err) {
      state.errorText = '마이크 권한 거부됨: ' + err.message;
      updateHud();
      chrome.runtime.sendMessage({ type: 'PERMISSION_DENIED' }).catch(() => {});
      return false;
    }
  }

  // ---------- Page visibility ----------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.isPaused = true;
      stopRecognition();
    } else {
      state.isPaused = false;
      if (state.config.micEnabled) {
        startRecognition();
      }
    }
  });

  // ---------- URL change detection (SPA navigation) ----------
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const newPlatform = detectPlatform();
      if (newPlatform !== state.platform) {
        state.platform = newPlatform;
        if (state.platform === 'unsupported') {
          stopRecognition();
          removeHud();
        } else if (state.config.micEnabled) {
          startRecognition();
        }
      }
    }
  });
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- Message handling ----------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'SETTINGS_UPDATE': {
        const prevEnabled = state.config.micEnabled;
        state.config = { ...state.config, ...message.settings };
        if (state.recognition) {
          state.recognition.lang = state.config.language;
        }
        if (state.config.micEnabled && !prevEnabled) {
          requestMicPermission().then((ok) => {
            if (ok) startRecognition();
          });
        } else if (!state.config.micEnabled && prevEnabled) {
          stopRecognition();
          removeHud();
        }
        updateHud();
        sendResponse({ ok: true });
        break;
      }
      case 'PAUSE_RECOGNITION': {
        state.isPaused = true;
        stopRecognition();
        sendResponse({ ok: true });
        break;
      }
      case 'RESUME_RECOGNITION': {
        state.isPaused = false;
        if (state.config.micEnabled) startRecognition();
        sendResponse({ ok: true });
        break;
      }
      case 'GET_STATE': {
        sendResponse({
          platform: state.platform,
          isListening: state.isListening,
          isPaused: state.isPaused,
          config: state.config,
        });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
    return true;
  });

  // ---------- Initialization ----------
  async function init() {
    state.platform = detectPlatform();
    if (state.platform === 'unsupported') return;

    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (config) state.config = { ...state.config, ...config };
    } catch (err) {
      // Background may not be ready
    }

    if (state.config.micEnabled) {
      const ok = await requestMicPermission();
      if (ok) startRecognition();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
