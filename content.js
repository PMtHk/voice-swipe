// Voice Swipe — Content Script
// Web Speech API for Instagram Reels navigation and volume/mute control

(() => {
  'use strict';

  const DEFAULT_CONFIG = {
    micEnabled: false,
    confidence: 0.5,
    language: 'ko-KR',
    volumeStep: 0.1,
  };

  // Command categories
  const COMMANDS = {
    // Navigation
    next: ['다음', 'next'],
    previous: ['이전', 'back', '뒤로', 'previous'],
    // Volume control
    mute: ['음소거', '뮤트', 'mute', '묵음'],
    unmute: ['소거해제', '음소거 해제', '언뮤트', 'unmute'],
    volumeUp: ['소리 키워', '소리 크게', '볼륨 업', '볼륨 올려', 'volume up', 'louder', 'up'],
    volumeDown: ['소리 줄여', '소리 작게', '볼륨 다운', '볼륨 내려', 'volume down', 'softer', 'down'],
    volumeMax: ['소리 최대', '최대 볼륨', 'max volume', 'maximum'],
    volumeMin: ['소리 최소', '최소 볼륨', 'min volume', 'minimum'],
  };

  const state = {
    config: { ...DEFAULT_CONFIG },
    platform: 'unsupported',
    isListening: false,
    isPaused: false,
    recognition: null,
    lastCommandAt: 0,
    restartTimer: null,
  };

  // ---------- Platform detection ----------
  function detectPlatform() {
    const url = window.location.href;
    if (/^https:\/\/www\.instagram\.com\/reels\//.test(url)) {
      return 'instagram-reels';
    }
    return 'unsupported';
  }

  // ---------- Video element helpers ----------
  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    const viewportMid = window.innerHeight / 2;
    // Prefer videos currently in viewport center
    const inView = videos.find((v) => {
      const rect = v.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top <= viewportMid &&
        rect.bottom >= viewportMid
      );
    });
    if (inView) return inView;
    // Fallback: any non-tiny video
    return videos.find((v) => v.offsetWidth > 100 && v.offsetHeight > 100) || null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ---------- Navigation (Instagram only) ----------
  function dispatchArrowKey(direction) {
    const key = direction > 0 ? 'ArrowDown' : 'ArrowUp';
    const keyCode = direction > 0 ? 40 : 38;
    const init = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };

    const targets = [
      document,
      document.body,
      document.activeElement,
      window,
    ].filter(Boolean);

    for (const target of targets) {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
      } catch (e) {}
    }
  }

  function navigateInstagramReels(direction) {
    dispatchArrowKey(direction);

    // Fallback: click on-screen nav button
    const nextSelectors = [
      'button[aria-label="Next"]',
      'button[aria-label="다음"]',
      'div[role="button"][aria-label="Next"]',
    ];
    const prevSelectors = [
      'button[aria-label="Back"]',
      'button[aria-label="Previous"]',
      'button[aria-label="이전"]',
      'div[role="button"][aria-label="Back"]',
    ];
    const selectors = direction > 0 ? nextSelectors : prevSelectors;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        try { el.click(); } catch (e) {}
        break;
      }
    }
  }

  // ---------- Volume control (both platforms) ----------
  function setMute(muted) {
    const video = findActiveVideo();
    if (!video) return false;
    video.muted = muted;
    return true;
  }

  function changeVolume(delta) {
    const video = findActiveVideo();
    if (!video) return false;
    const newVolume = clamp(video.volume + delta, 0, 1);
    video.volume = newVolume;
    // Unmute if volume is raised from 0
    if (delta > 0 && video.muted) {
      video.muted = false;
    }
    return true;
  }

  function setVolume(value) {
    const video = findActiveVideo();
    if (!video) return false;
    video.volume = clamp(value, 0, 1);
    if (value > 0) video.muted = false;
    return true;
  }

  // ---------- Command execution ----------
  function executeCommand(command) {
    const now = Date.now();
    if (now - state.lastCommandAt < 600) return;
    state.lastCommandAt = now;

    let success = false;

    switch (command) {
      // Navigation
      case 'next':
      case 'previous': {
        if (state.platform !== 'instagram-reels') return;
        navigateInstagramReels(command === 'next' ? 1 : -1);
        success = true;
        break;
      }

      // Volume
      case 'mute':
        success = setMute(true);
        break;
      case 'unmute':
        success = setMute(false);
        break;
      case 'volumeUp':
        success = changeVolume(state.config.volumeStep);
        break;
      case 'volumeDown':
        success = changeVolume(-state.config.volumeStep);
        break;
      case 'volumeMax':
        success = setVolume(1);
        break;
      case 'volumeMin':
        success = setVolume(0);
        break;

      default:
        return;
    }

    if (success) {
      chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        command,
        platform: state.platform,
      }).catch(() => {});
    }
  }

  // ---------- Command matching ----------
  function matchCommand(transcript) {
    const text = transcript.toLowerCase().trim();
    for (const [cmd, phrases] of Object.entries(COMMANDS)) {
      for (const phrase of phrases) {
        const p = phrase.toLowerCase();
        if (text === p || text.endsWith(' ' + p) || text.startsWith(p + ' ') || text.includes(' ' + p + ' ')) {
          return cmd;
        }
      }
    }
    return null;
  }

  // ---------- Speech Recognition ----------
  function createRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[VoiceSwipe] Web Speech API not supported');
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = state.config.language;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const result = event.results[lastIndex];
      if (!result.isFinal) return;

      for (let i = 0; i < result.length; i++) {
        const alt = result[i];
        if (alt.confidence < state.config.confidence) continue;
        const command = matchCommand(alt.transcript);
        if (command) {
          executeCommand(command);
          return;
        }
      }
    };

    recognition.onend = () => {
      state.isListening = false;
      if (state.config.micEnabled && !state.isPaused && state.platform !== 'unsupported') {
        clearTimeout(state.restartTimer);
        state.restartTimer = setTimeout(() => {
          startRecognition();
        }, 300);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        state.config.micEnabled = false;
        chrome.runtime.sendMessage({ type: 'PERMISSION_DENIED' }).catch(() => {});
      }
    };

    recognition.onstart = () => {
      state.isListening = true;
    };

    return recognition;
  }

  function startRecognition() {
    if (state.platform === 'unsupported') return;
    if (state.isListening) return;
    if (!state.config.micEnabled) return;
    if (state.isPaused) return;

    if (!state.recognition) {
      state.recognition = createRecognition();
      if (!state.recognition) return;
    }

    try {
      state.recognition.lang = state.config.language;
      state.recognition.start();
    } catch (err) {
      // Already started or error — onend will auto-restart
    }
  }

  function stopRecognition() {
    if (state.recognition && state.isListening) {
      try {
        state.recognition.stop();
      } catch (err) {}
    }
    clearTimeout(state.restartTimer);
    state.isListening = false;
  }

  // ---------- Permission request ----------
  async function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err) {
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
        }
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
    } catch (err) {}

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
