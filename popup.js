// Voice Swipe — Popup Script

const DEFAULT_CONFIG = {
  micEnabled: false,
  confidence: 0.5,
  language: 'ko-KR',
};

const PLATFORM_LABELS = {
  'youtube-shorts': 'YouTube Shorts',
  'instagram-reels': 'Instagram Reels',
  'unsupported': '지원하지 않는 페이지',
};

const COMMAND_LABELS = {
  next: '다음',
  previous: '이전',
};

// ---------- Element refs ----------
const elements = {
  statusWrapper: document.getElementById('status'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  pageInfo: document.getElementById('pageInfo'),
  micToggle: document.getElementById('micToggle'),
  micLabel: document.getElementById('micLabel'),
  lastCommand: document.getElementById('lastCommand'),
  confidence: document.getElementById('confidence'),
  confidenceValue: document.getElementById('confidenceValue'),
  languageRadios: document.querySelectorAll('input[name="language"]'),
};

let state = { ...DEFAULT_CONFIG };
let currentPlatform = 'unsupported';
let currentContentState = null;

// ---------- Utilities ----------
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function detectPlatformFromUrl(url) {
  if (!url) return 'unsupported';
  if (/^https:\/\/www\.youtube\.com\/shorts\//.test(url)) return 'youtube-shorts';
  if (/^https:\/\/www\.instagram\.com\/reels\//.test(url)) return 'instagram-reels';
  return 'unsupported';
}

// ---------- State rendering ----------
function renderStatus() {
  const { micEnabled } = state;
  const isSupported = currentPlatform !== 'unsupported';
  const isListening =
    currentContentState?.isListening === true &&
    currentContentState?.isPaused === false;

  let statusState = 'inactive';
  let statusLabel = '비활성';

  if (!isSupported) {
    statusState = 'inactive';
    statusLabel = '비활성';
  } else if (micEnabled && isListening) {
    statusState = 'listening';
    statusLabel = '듣는 중';
  } else if (micEnabled && !isListening) {
    statusState = 'paused';
    statusLabel = '일시정지';
  } else {
    statusState = 'inactive';
    statusLabel = '꺼짐';
  }

  elements.statusWrapper.dataset.state = statusState;
  elements.statusText.textContent = statusLabel;
}

function renderMicToggle() {
  const on = state.micEnabled;
  elements.micToggle.dataset.state = on ? 'on' : 'off';
  elements.micLabel.textContent = on ? '마이크 끄기' : '마이크 켜기';
  elements.micToggle.disabled = currentPlatform === 'unsupported';
}

function renderPageInfo() {
  elements.pageInfo.textContent = PLATFORM_LABELS[currentPlatform] || '알 수 없음';
}

function renderConfidence() {
  elements.confidence.value = state.confidence;
  elements.confidenceValue.textContent = Number(state.confidence).toFixed(2);
}

function renderLanguage() {
  elements.languageRadios.forEach((radio) => {
    radio.checked = radio.value === state.language;
  });
}

function renderAll() {
  renderStatus();
  renderMicToggle();
  renderPageInfo();
  renderConfidence();
  renderLanguage();
}

// ---------- Settings persistence ----------
async function updateSettings(partial) {
  state = { ...state, ...partial };
  await chrome.runtime.sendMessage({
    type: 'SETTINGS_UPDATE',
    settings: partial,
  }).catch(() => {});
  renderAll();
}

const debouncedConfidenceUpdate = debounce((value) => {
  updateSettings({ confidence: Number(value) });
}, 300);

// ---------- Event handlers ----------
elements.micToggle.addEventListener('click', () => {
  if (currentPlatform === 'unsupported') return;
  updateSettings({ micEnabled: !state.micEnabled });
});

elements.confidence.addEventListener('input', (e) => {
  elements.confidenceValue.textContent = Number(e.target.value).toFixed(2);
  debouncedConfidenceUpdate(e.target.value);
});

elements.languageRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    updateSettings({ language: e.target.value });
  });
});

// ---------- Status updates from content script ----------
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE' && message.command) {
    const label = COMMAND_LABELS[message.command] || message.command;
    elements.lastCommand.textContent = label;
  }
});

// ---------- Init ----------
async function init() {
  // Load config
  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).catch(() => null);
  if (config) state = { ...state, ...config };

  // Detect current tab platform
  const tab = await getCurrentTab();
  currentPlatform = detectPlatformFromUrl(tab?.url);

  // Query content script state if on supported page
  if (currentPlatform !== 'unsupported' && tab?.id) {
    currentContentState = await chrome.tabs
      .sendMessage(tab.id, { type: 'GET_STATE' })
      .catch(() => null);
  }

  renderAll();
}

init();
