// Background service worker for Disney Plus Ultra
const DEFAULT_SETTINGS = {
  autoSkip: true,
  maintainFullscreen: true,
  autoInsertPin: false,
  profilePin: '',
  skipDelay: 0
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Disney+ Ultra] Extension installed:', details.reason);
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(data);
  // Clean up any legacy fullscreen state
  chrome.storage.local.remove(['wasFullscreen']).catch(() => {});
});

// Clean up legacy fullscreen state on worker startup
chrome.storage.local.remove(['wasFullscreen']).catch(() => {});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case 'getSettings': {
      chrome.storage.sync.get(DEFAULT_SETTINGS).then(settings => {
        sendResponse({ success: true, settings });
      }).catch(err => {
        // Fallback to local storage if sync fails
        chrome.storage.local.get(DEFAULT_SETTINGS).then(settings => {
          sendResponse({ success: true, settings });
        }).catch(e => {
          sendResponse({ success: false, error: e.message, settings: DEFAULT_SETTINGS });
        });
      });
      return true; // async response
    }

    case 'saveSettings': {
      const newSettings = message.settings;
      chrome.storage.sync.set(newSettings).then(() => {
        // Also save to local as backup
        chrome.storage.local.set(newSettings);
        // Broadcast to all Disney+ tabs
        chrome.tabs.query({ url: '*://*.disneyplus.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'settingsUpdated',
              settings: newSettings
            }).catch(() => {});
          });
        });
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'setWindowFullscreen': {
      const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
      const targetState = message.fullscreen ? 'fullscreen' : 'normal';
      chrome.windows.update(windowId, { state: targetState }).then((win) => {
        sendResponse({ success: true, state: win.state });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'getWindowFullscreen': {
      const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
      chrome.windows.get(windowId).then((win) => {
        sendResponse({ success: true, isFullscreen: win.state === 'fullscreen' });
      }).catch(err => {
        sendResponse({ success: false, error: err.message, isFullscreen: false });
      });
      return true;
    }

    default:
      break;
  }
  return false;
});
