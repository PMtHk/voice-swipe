// Voice Swipe — Background Service Worker
// Manifest V3

const DEFAULT_CONFIG = {
  micEnabled: false,
  confidence: 0.5,
  language: 'ko-KR',
};

const SUPPORTED_URL_PATTERNS = [
  /^https:\/\/www\.instagram\.com\/reels\//,
];

// ---------- Remote Config Hook (v2 readiness) ----------
// v1: always falls back to DEFAULT_CONFIG
// v2: replace with actual fetch to Fastify/Supabase endpoint
async function fetchRemoteConfig() {
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
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      if (isSupportedUrl(tab.url)) {
        sendMessageToTab(tab.id, { type: 'PAUSE_RECOGNITION' });
      }
    });
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab && isSupportedUrl(activeTab.url)) {
      const { micEnabled } = await loadConfig();
      if (micEnabled) {
        sendMessageToTab(activeTab.id, { type: 'RESUME_RECOGNITION' });
      }
    }
  }
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
        await chrome.storage.sync.set(message.settings);

        const tabs = await chrome.tabs.query({});
        tabs.forEach((tab) => {
          if (isSupportedUrl(tab.url)) {
            sendMessageToTab(tab.id, {
              type: 'SETTINGS_UPDATE',
              settings: message.settings,
            });
          }
        });
        sendResponse({ ok: true });
        break;
      }

      case 'PERMISSION_DENIED': {
        await chrome.storage.sync.set({ micEnabled: false });
        sendResponse({ ok: true });
        break;
      }

      case 'STATUS_UPDATE': {
        chrome.runtime.sendMessage(message).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});

// ---------- Initialization ----------
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const merged = { ...DEFAULT_CONFIG, ...existing };
  await chrome.storage.sync.set(merged);
});
