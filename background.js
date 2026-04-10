// Voice Swipe — Background Service Worker
// Manifest V3

const DEFAULT_CONFIG = {
  micEnabled: false,
  confidence: 0.5,
  language: 'ko-KR',
};

const SUPPORTED_URL_PATTERNS = [
  /^https:\/\/www\.youtube\.com\/shorts\//,
  /^https:\/\/www\.instagram\.com\/reels\//,
];

// ---------- Remote Config Hook (v2 readiness) ----------
// v1: always falls back to DEFAULT_CONFIG
// v2: replace with actual fetch to Fastify/Supabase endpoint
async function fetchRemoteConfig() {
  // Placeholder for v2 — returns null so caller uses DEFAULT_CONFIG
  return null;
}

async function loadConfig() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const remote = await fetchRemoteConfig().catch(() => null);
  return { ...DEFAULT_CONFIG, ...(remote || {}), ...stored };
}

// ---------- URL detection ----------
function isSupportedUrl(url) {
  if (!url) return false;
  return SUPPORTED_URL_PATTERNS.some((re) => re.test(url));
}

// ---------- Tab state management ----------
async function sendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Content script may not be loaded on this tab — ignore
  }
}

// When a tab becomes active, resume recognition if enabled
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isSupportedUrl(tab.url)) return;

  const { micEnabled } = await loadConfig();
  if (micEnabled) {
    sendMessageToTab(tabId, { type: 'RESUME_RECOGNITION' });
  }
});

// When a tab is updated (navigation), check if it's a supported page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!isSupportedUrl(tab.url)) return;

  const config = await loadConfig();
  sendMessageToTab(tabId, { type: 'SETTINGS_UPDATE', settings: config });
});

// Detect tab visibility changes via window focus
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — pause all recognition
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      if (isSupportedUrl(tab.url)) {
        sendMessageToTab(tab.id, { type: 'PAUSE_RECOGNITION' });
      }
    });
  } else {
    // Browser regained focus — resume active tab if supported
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab && isSupportedUrl(activeTab.url)) {
      const { micEnabled } = await loadConfig();
      if (micEnabled) {
        sendMessageToTab(activeTab.id, { type: 'RESUME_RECOGNITION' });
      }
    }
  }
});

// ---------- Chrome Debugger: trusted keyboard dispatch ----------
// YouTube checks user activation via requestStorageAccessFor which
// rejects programmatic events. chrome.debugger's Input.dispatchKeyEvent
// fires TRUSTED events that pass these checks.
const attachedTabs = new Set();

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
    return true;
  } catch (err) {
    // Might already be attached by DevTools etc.
    if (String(err.message).includes('already attached')) {
      attachedTabs.add(tabId);
      return true;
    }
    console.warn('[VoiceSwipe/bg] debugger attach failed:', err.message);
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {}
  attachedTabs.delete(tabId);
}

async function dispatchTrustedKey(tabId, direction) {
  const ok = await ensureDebuggerAttached(tabId);
  if (!ok) return false;

  const key = direction > 0 ? 'ArrowDown' : 'ArrowUp';
  const keyCode = direction > 0 ? 40 : 38;
  const keyBase = {
    key,
    code: key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };

  try {
    await chrome.debugger.sendCommand(
      { tabId },
      'Input.dispatchKeyEvent',
      { ...keyBase, type: 'rawKeyDown' }
    );
    await chrome.debugger.sendCommand(
      { tabId },
      'Input.dispatchKeyEvent',
      { ...keyBase, type: 'keyUp' }
    );
    return true;
  } catch (err) {
    console.warn('[VoiceSwipe/bg] key dispatch failed:', err.message);
    return false;
  }
}

// Clean up debugger on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
});

// Also clean up when user manually detaches via DevTools
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

// ---------- Message routing ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_CONFIG': {
        const config = await loadConfig();
        sendResponse(config);
        break;
      }

      case 'SETTINGS_UPDATE': {
        // Persist settings
        await chrome.storage.sync.set(message.settings);

        // Broadcast to all supported tabs
        const tabs = await chrome.tabs.query({});
        tabs.forEach((tab) => {
          if (isSupportedUrl(tab.url)) {
            sendMessageToTab(tab.id, {
              type: 'SETTINGS_UPDATE',
              settings: message.settings,
            });
          }
        });

        // If mic was disabled, detach debugger from all tabs
        if (message.settings && message.settings.micEnabled === false) {
          for (const tabId of Array.from(attachedTabs)) {
            await detachDebugger(tabId);
          }
        }
        sendResponse({ ok: true });
        break;
      }

      case 'DISPATCH_KEY': {
        // Content script asks us to send a trusted keyboard event
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: 'no tab id' });
          break;
        }
        const ok = await dispatchTrustedKey(tabId, message.direction);
        sendResponse({ ok });
        break;
      }

      case 'DETACH_DEBUGGER': {
        const tabId = sender.tab?.id;
        if (tabId) await detachDebugger(tabId);
        sendResponse({ ok: true });
        break;
      }

      case 'PERMISSION_DENIED': {
        // Content script reports mic permission was denied
        await chrome.storage.sync.set({ micEnabled: false });
        sendResponse({ ok: true });
        break;
      }

      case 'STATUS_UPDATE': {
        // Forward status updates to any open popup
        chrome.runtime.sendMessage(message).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // async response
});

// ---------- Initialization ----------
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const merged = { ...DEFAULT_CONFIG, ...existing };
  await chrome.storage.sync.set(merged);
});
