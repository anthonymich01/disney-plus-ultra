// Disney Plus Ultra - Isolated World Content Script
// Bridges chrome.* APIs with the MAIN world script

(function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    autoSkip: true,
    maintainFullscreen: true,
    autoInsertPin: false,
    profilePin: '',
    skipDelay: 0
  };

  let currentSettings = { ...DEFAULT_SETTINGS };

  // Clear any legacy persistent wasFullscreen flag from storage
  chrome.storage.local.remove(['wasFullscreen']).catch(() => {});

  // Fetch initial settings from storage
  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime.lastError || !items) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (localItems) => {
          currentSettings = localItems || DEFAULT_SETTINGS;
          sendSettingsToMain();
        });
      } else {
        currentSettings = items;
        sendSettingsToMain();
      }
    });
  }

  function sendSettingsToMain() {
    window.postMessage({
      source: 'DPU_ISOLATED',
      type: 'SETTINGS',
      settings: currentSettings
    }, '*');
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' || areaName === 'local') {
      let updated = false;
      for (const [key, change] of Object.entries(changes)) {
        if (key in currentSettings) {
          currentSettings[key] = change.newValue;
          updated = true;
        }
      }
      if (updated) {
        sendSettingsToMain();
      }
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'settingsUpdated' && message.settings) {
      currentSettings = { ...currentSettings, ...message.settings };
      sendSettingsToMain();
    }
  });

  // Listen for messages from MAIN world script
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'DPU_MAIN') {
      return;
    }

    const { type, payload } = event.data;

    switch (type) {
      case 'GET_SETTINGS':
        sendSettingsToMain();
        break;

      case 'LOG':
        console.log('[Disney+ Ultra Isolated]', ...(payload?.args || []));
        break;

      default:
        break;
    }
  });

  // Initial load
  loadSettings();
})();
