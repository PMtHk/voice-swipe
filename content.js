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
    platform: 'unsupported', // 'youtube-shorts' | 'instagram-reels' | 'unsupported'
    isListening: false,
    isPaused: false,
    recognition: null,
    lastCommandAt: 0,
    restartTimer: null,
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
      behavior: 'smooth',
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

  function navigateYouTubeShorts(direction) {
    // Try keyboard first (YouTube Shorts responds to arrow keys)
    dispatchKey(direction > 0 ? 'ArrowDown' : 'ArrowUp');

    // Fallback: scroll
    setTimeout(() => {
      const scrolled = window.scrollY;
      scrollBy(direction);
      // If scroll didn't work, try button click
      setTimeout(() => {
        if (Math.abs(window.scrollY - scrolled) < 10) {
          const selectors = direction > 0
            ? ['button[aria-label="Next video"]', '#navigation-button-down button']
            : ['button[aria-label="Previous video"]', '#navigation-button-up button'];
          findAndClickButton(selectors);
        }
      }, 200);
    }, 50);
  }

  function navigateInstagramReels(direction) {
    // Try keyboard first
    dispatchKey(direction > 0 ? 'ArrowDown' : 'ArrowUp');

    // Fallback: button click after a short delay
    setTimeout(() => {
      const nextSelectors = [
        'button[aria-label="Next"]',
        'button[aria-label="다음"]',
        'svg[aria-label="Next"]',
      ];
      const prevSelectors = [
        'button[aria-label="Back"]',
        'button[aria-label="Previous"]',
        'button[aria-label="이전"]',
        'svg[aria-label="Back"]',
      ];
      findAndClickButton(direction > 0 ? nextSelectors : prevSelectors);
    }, 150);
  }

  function executeCommand(command) {
    const now = Date.now();
    // Debounce: ignore commands within 600ms of last execution
    if (now - state.lastCommandAt < 600) return;
    state.lastCommandAt = now;

    const direction = command === 'next' ? 1 : -1;

    if (state.platform === 'youtube-shorts') {
      navigateYouTubeShorts(direction);
    } else if (state.platform === 'instagram-reels') {
      navigateInstagramReels(direction);
    } else {
      return;
    }

    // Broadcast status to popup
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

      // Check all alternatives, pick the highest confidence above threshold
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
      // Auto-restart if still enabled and not paused
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
      // Already started or error — will restart on onend
    }
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
  urlObserver.observe(document.body, { childList: true, subtree: true });

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

    // Load config from background
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (config) state.config = { ...state.config, ...config };
    } catch (err) {
      // Background may not be ready — use defaults
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
