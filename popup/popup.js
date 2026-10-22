// Disney Plus Ultra - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const toggleAutoSkip = document.getElementById('toggle-auto-skip');
  const toggleFullscreen = document.getElementById('toggle-fullscreen');
  const toggleAutoPin = document.getElementById('toggle-auto-pin');
  const pinInput = document.getElementById('profile-pin-input');
  const pinContainer = document.getElementById('pin-config-container');
  const togglePinVisBtn = document.getElementById('toggle-pin-visibility');
  const btnSave = document.getElementById('btn-save');
  const statusText = document.getElementById('status-text');
  const toast = document.getElementById('toast');

  let isPinVisible = false;

  const DEFAULT_SETTINGS = {
    autoSkip: true,
    maintainFullscreen: true,
    autoInsertPin: false,
    profilePin: '',
    skipDelay: 0
  };

  // Check if Disney+ is open in any active tab
  chrome.tabs.query({ url: '*://*.disneyplus.com/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      statusText.textContent = `Connected (${tabs.length} Disney+ tab${tabs.length > 1 ? 's' : ''})`;
      document.querySelector('.status-dot').style.backgroundColor = '#00e676';
    } else {
      statusText.textContent = 'Disney+ Extension Ready';
    }
  });

  // Load saved settings
  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime.lastError || !items) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (localItems) => {
          applySettings(localItems || DEFAULT_SETTINGS);
        });
      } else {
        applySettings(items);
      }
    });
  }

  function applySettings(settings) {
    toggleAutoSkip.checked = !!settings.autoSkip;
    toggleFullscreen.checked = !!settings.maintainFullscreen;
    toggleAutoPin.checked = !!settings.autoInsertPin;
    pinInput.value = settings.profilePin || '';

    updatePinContainerState();
  }

  function updatePinContainerState() {
    if (toggleAutoPin.checked) {
      pinContainer.classList.remove('disabled');
    } else {
      pinContainer.classList.add('disabled');
    }
  }

  // Toggle PIN visibility
  togglePinVisBtn.addEventListener('click', () => {
    isPinVisible = !isPinVisible;
    pinInput.type = isPinVisible ? 'text' : 'password';
    togglePinVisBtn.innerHTML = isPinVisible
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
           <line x1="1" y1="1" x2="23" y2="23"></line>
         </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
           <circle cx="12" cy="12" r="3"></circle>
         </svg>`;
  });

  // Only allow digits in PIN input
  pinInput.addEventListener('input', (e) => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
  });

  // Toggle auto-pin changes
  toggleAutoPin.addEventListener('change', () => {
    updatePinContainerState();
    if (toggleAutoPin.checked && !pinInput.value) {
      pinInput.focus();
    }
    saveSettings(false); // auto-save toggle state
  });

  // Auto-save toggle switches on change
  toggleAutoSkip.addEventListener('change', () => saveSettings(false));
  toggleFullscreen.addEventListener('change', () => saveSettings(false));

  // Save Settings function
  function saveSettings(showToast = true) {
    const pin = pinInput.value.trim();

    if (toggleAutoPin.checked && pin && !/^\d{4}$/.test(pin)) {
      if (showToast) {
        showToastMsg('PIN must be exactly 4 digits!', true);
      }
      return;
    }

    const settings = {
      autoSkip: toggleAutoSkip.checked,
      maintainFullscreen: toggleFullscreen.checked,
      autoInsertPin: toggleAutoPin.checked,
      profilePin: pin,
      skipDelay: 0
    };

    chrome.runtime.sendMessage({ action: 'saveSettings', settings }, (res) => {
      if (showToast) {
        showToastMsg('Settings saved successfully!');
      }
    });
  }

  function showToastMsg(msg, isError = false) {
    toast.textContent = msg;
    if (isError) {
      toast.style.background = '#ff4444';
      toast.style.color = '#fff';
    } else {
      toast.style.background = 'rgba(0, 210, 255, 0.95)';
      toast.style.color = '#050811';
    }
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  btnSave.addEventListener('click', () => {
    saveSettings(true);
  });

  // Initialize
  loadSettings();
});
