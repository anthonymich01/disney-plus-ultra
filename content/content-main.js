// Disney Plus Ultra - Main World Script
// Runs directly in page context with access to Web Components, Shadow DOM, and native prototypes

(function() {
  'use strict';

  console.log('[Disney+ Ultra] Main content script loaded.');

  let settings = {
    autoSkip: true,
    maintainFullscreen: true,
    autoInsertPin: false,
    profilePin: '',
    skipDelay: 0
  };

  let isTransitioning = false;
  let transitionTimer = null;
  let lastSkipTime = 0;
  let lastPinAttemptUrl = '';
  let lastPinAttemptTime = 0;
  let currentUrl = location.href;

  // Clean up any legacy persistent wasFullscreen from sessionStorage on init
  // only keep transition flag if it was set for an active transition
  if (sessionStorage.getItem('dpu_was_fullscreen')) {
    sessionStorage.removeItem('dpu_was_fullscreen');
  }

  // Communication with Isolated World
  function postToIsolated(type, payload = {}) {
    window.postMessage({
      source: 'DPU_MAIN',
      type,
      payload
    }, '*');
  }

  // Listen for settings from Isolated World
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'DPU_ISOLATED') {
      return;
    }
    if (event.data.type === 'SETTINGS' && event.data.settings) {
      settings = { ...settings, ...event.data.settings };
      console.log('[Disney+ Ultra] Settings updated:', {
        autoSkip: settings.autoSkip,
        maintainFullscreen: settings.maintainFullscreen,
        autoInsertPin: settings.autoInsertPin,
        hasPin: !!settings.profilePin
      });
      runChecks();
    }
  });

  // Request initial settings
  postToIsolated('GET_SETTINGS');

  // ==========================================
  // FULLSCREEN CONTINUITY ENGINE
  // ==========================================

  function isCurrentlyFullscreen() {
    return !!document.fullscreenElement;
  }

  function getPlayerContainer() {
    const dwp = document.querySelector('disney-web-player');
    return document.querySelector('.btm-media-clients') ||
           dwp?.mediaElementContainerElement ||
           dwp ||
           document.querySelector('[data-testid="disney-web-player-container"]') ||
           document.querySelector('[data-testid="disney-web-player-wrapper"]') ||
           document.querySelector('.player-container-root') ||
           document.documentElement;
  }

  // Called whenever an episode transition begins (Next button, video ended, PIN redirect)
  function markEpisodeTransition() {
    isTransitioning = true;
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      isTransitioning = false;
    }, 5000);

    // Only maintain fullscreen if the user is ACTUALLY in fullscreen right now!
    if (settings.maintainFullscreen && isCurrentlyFullscreen()) {
      console.log('[Disney+ Ultra] Episode transition starting in FULLSCREEN. Will maintain for next episode.');
      sessionStorage.setItem('dpu_fullscreen_transition', 'true');
    } else {
      console.log('[Disney+ Ultra] Episode transition starting in WINDOWED mode. Will NOT force fullscreen.');
      sessionStorage.removeItem('dpu_fullscreen_transition');
    }
  }

  // Listen for fullscreen change events
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      console.log('[Disney+ Ultra] Player entered fullscreen.');
      if (isTransitioning) {
        isTransitioning = false;
      }
    } else {
      console.log('[Disney+ Ultra] Player exited fullscreen.');
      // If the user manually toggles out of fullscreen, clear transition flag immediately
      // so next episode respects the user's windowed choice!
      if (!isTransitioning) {
        sessionStorage.removeItem('dpu_fullscreen_transition');
      }
    }
  });

  // Intercept document.exitFullscreen during transitions ONLY
  const originalExitFullscreen = document.exitFullscreen ? document.exitFullscreen.bind(document) : null;
  if (originalExitFullscreen) {
    document.exitFullscreen = async function(...args) {
      const shouldKeepFullscreen = settings.maintainFullscreen &&
                                   isTransitioning &&
                                   sessionStorage.getItem('dpu_fullscreen_transition') === 'true';

      if (shouldKeepFullscreen) {
        console.log('[Disney+ Ultra] Blocked Disney+ teardown exitFullscreen during episode transition.');
        return Promise.resolve();
      }
      return originalExitFullscreen(...args);
    };
  }

  // Restore fullscreen ONE-TIME when entering next episode if previous was fullscreen
  function handleNextEpisodeFullscreen() {
    const shouldRestore = settings.maintainFullscreen &&
                          sessionStorage.getItem('dpu_fullscreen_transition') === 'true';

    if (!shouldRestore) {
      // User was watching in windowed mode. Do not force fullscreen!
      isTransitioning = false;
      sessionStorage.removeItem('dpu_fullscreen_transition');
      return;
    }

    // Already in fullscreen (teardown intercept worked seamlessly)
    if (isCurrentlyFullscreen()) {
      console.log('[Disney+ Ultra] Already in fullscreen on next episode.');
      sessionStorage.removeItem('dpu_fullscreen_transition');
      isTransitioning = false;
      return;
    }

    console.log('[Disney+ Ultra] Fullscreen dropped during transition, restoring for next episode...');

    let restored = false;
    const finish = () => {
      restored = true;
      sessionStorage.removeItem('dpu_fullscreen_transition');
      isTransitioning = false;
    };

    // Auto-expire restore attempt after 6 seconds
    setTimeout(finish, 6000);

    const tryRestore = () => {
      if (restored || isCurrentlyFullscreen()) {
        finish();
        return;
      }

      const container = getPlayerContainer();
      if (container && container.requestFullscreen) {
        container.requestFullscreen().then(() => {
          console.log('[Disney+ Ultra] Fullscreen restored on next episode.');
          finish();
        }).catch((err) => {
          console.log('[Disney+ Ultra] Direct requestFullscreen deferred pending user gesture:', err.message);
          // Wait for first user interaction (click or keypress) to restore once
          const onFirstGesture = () => {
            if (!restored && sessionStorage.getItem('dpu_fullscreen_transition') === 'true' && !document.fullscreenElement) {
              container.requestFullscreen().catch(() => {});
            }
            cleanup();
          };
          const cleanup = () => {
            window.removeEventListener('pointerdown', onFirstGesture, true);
            window.removeEventListener('keydown', onFirstGesture, true);
            finish();
          };
          window.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
          window.addEventListener('keydown', onFirstGesture, { once: true, capture: true });
        });
      }
    };

    setTimeout(tryRestore, 500);
    setTimeout(tryRestore, 1500);
  }

  // Attach video listeners to detect natural episode completion
  function attachVideoListeners() {
    const video = document.querySelector('video');
    if (video && !video.__dpu_attached) {
      video.__dpu_attached = true;
      video.addEventListener('ended', () => {
        console.log('[Disney+ Ultra] Video ended event fired.');
        markEpisodeTransition();
      });
    }
  }

  // ==========================================
  // FEATURE 1: AUTO SKIP INTRO & CREDITS
  // ==========================================

  function triggerElementClick(element, label = 'element', isNextEpisode = false) {
    if (!element) return false;
    const now = Date.now();
    if (now - lastSkipTime < 1200) return false; // debounce

    lastSkipTime = now;
    if (isNextEpisode) {
      markEpisodeTransition();
    }

    console.log(`[Disney+ Ultra] Triggering skip/next on: ${label}`);

    const delay = Math.max(0, parseInt(settings.skipDelay, 10) || 0);
    setTimeout(() => {
      try {
        if (typeof element.click === 'function') {
          element.click();
        } else {
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        }
      } catch (err) {
        console.warn(`[Disney+ Ultra] Error clicking ${label}:`, err);
      }
    }, delay);

    return true;
  }

  function checkSkipIntro() {
    if (!settings.autoSkip) return false;

    // 1. Disney+ <skip-overlay> Web Component
    const skipOverlay = document.querySelector('skip-overlay, [data-testid="skip-overlay"]');
    if (skipOverlay) {
      const shadow = skipOverlay.shadowRoot;
      if (shadow) {
        const skipBtn = shadow.querySelector('button, [role="button"], .skip__button, [data-testid="skip-button"], [data-qa*="skip"]');
        if (skipBtn && (skipBtn.offsetWidth > 0 || skipBtn.getClientRects().length > 0 || skipBtn.innerText)) {
          return triggerElementClick(skipBtn, 'Skip Overlay Button', false);
        }
      }

      if (skipOverlay.streamController?.value?.visible) {
        if (typeof skipOverlay.handleClick === 'function') {
          const now = Date.now();
          if (now - lastSkipTime > 1200) {
            lastSkipTime = now;
            console.log('[Disney+ Ultra] Calling skipOverlay.handleClick()');
            skipOverlay.handleClick();
            return true;
          }
        }
      }
    }

    // 2. Standard DOM Skip Buttons
    const skipSelectors = [
      'button[data-testid="skip-button"]',
      'button.skip__button',
      '.skip__button',
      '[data-qa="skip-button"]',
      'button[aria-label*="skip" i]'
    ];

    for (const sel of skipSelectors) {
      const btn = document.querySelector(sel);
      if (btn && (btn.offsetWidth > 0 || btn.offsetHeight > 0)) {
        const text = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('skip') || text.includes('intro') || text.includes('recap')) {
          return triggerElementClick(btn, `DOM Button (${sel})`, false);
        }
      }
    }

    return false;
  }

  function checkNextEpisode() {
    if (!settings.autoSkip) return false;

    // 1. <up-next-lite-v1> Web Component
    const upNext = document.querySelector('up-next-lite-v1');
    if (upNext) {
      if (upNext.streamController?.value?.visible) {
        const btn = upNext.shadowRoot?.querySelector('button, .cta-button');
        if (btn) {
          return triggerElementClick(btn, 'Up-Next Button', true);
        }
        if (typeof upNext.handleButtonClick === 'function') {
          const now = Date.now();
          if (now - lastSkipTime > 1200) {
            lastSkipTime = now;
            markEpisodeTransition();
            console.log('[Disney+ Ultra] Calling upNext.handleButtonClick()');
            upNext.handleButtonClick();
            return true;
          }
        } else if (typeof upNext.handleTransition === 'function') {
          const now = Date.now();
          if (now - lastSkipTime > 1200) {
            lastSkipTime = now;
            markEpisodeTransition();
            console.log('[Disney+ Ultra] Calling upNext.handleTransition(false)');
            upNext.handleTransition(false);
            return true;
          }
        }
      }
    }

    // 2. <end-card-overlay> Web Component
    const endCard = document.querySelector('end-card-overlay');
    if (endCard) {
      if (endCard.streamController?.value?.continuousPlayVisible) {
        const btn = endCard.shadowRoot?.querySelector('button, .primary-button');
        if (btn) {
          return triggerElementClick(btn, 'End-Card Button', true);
        }
        if (typeof endCard.handlePrimaryButtonClick === 'function') {
          const now = Date.now();
          if (now - lastSkipTime > 1200) {
            lastSkipTime = now;
            markEpisodeTransition();
            console.log('[Disney+ Ultra] Calling endCard.handlePrimaryButtonClick()');
            endCard.handlePrimaryButtonClick(new Event('click'));
            return true;
          }
        }
      }
    }

    // 3. <pivot-tray-overlay> Web Component ("Up Next" carousel & CTA)
    const pivot = document.querySelector('pivot-tray-overlay');
    if (pivot && pivot.shadowRoot) {
      const shadow = pivot.shadowRoot;
      const ctaBtn = shadow.querySelector('.cta-button, [aria-label="Next For You"]');
      if (ctaBtn) {
        return triggerElementClick(ctaBtn, 'Pivot Tray CTA Button', true);
      }

      const tile = shadow.querySelector('pivot-tray-carousel')?.shadowRoot?.querySelector('pivot-tray-tile')?.shadowRoot?.querySelector('.tile-container');
      if (tile) {
        return triggerElementClick(tile, 'Pivot Tray Tile', true);
      }
    }

    // 4. Standard DOM Next Episode Buttons
    const nextSelectors = [
      'button[data-testid="next-episode-button"]',
      'button[aria-label*="next episode" i]',
      'button[aria-label*="skip credits" i]',
      'button[aria-label*="next for you" i]',
      '.up-next-button',
      '.skip-credits-button'
    ];

    for (const sel of nextSelectors) {
      const btn = document.querySelector(sel);
      if (btn && (btn.offsetWidth > 0 || btn.offsetHeight > 0)) {
        return triggerElementClick(btn, `DOM Next Button (${sel})`, true);
      }
    }

    // 5. Native Keyboard Shortcut Fallback (Shift + N)
    const isUpNextVisible = !!document.querySelector('dialog[aria-label="Up Next"], .pivot-tray-overlay, [data-qa="pivot-tray-overlay.overlay"]');
    if (isUpNextVisible) {
      const now = Date.now();
      if (now - lastSkipTime > 1500) {
        lastSkipTime = now;
        markEpisodeTransition();
        console.log('[Disney+ Ultra] Dispatching Shift+N keyboard shortcut for next episode.');
        const ev = new KeyboardEvent('keydown', {
          key: 'N',
          code: 'KeyN',
          shiftKey: true,
          bubbles: true,
          composed: true
        });
        document.dispatchEvent(ev);
        return true;
      }
    }

    return false;
  }

  // ==========================================
  // FEATURE 3: AUTO INSERT PROFILE PIN (21+)
  // ==========================================

  function getPinInputs() {
    // 1. Singapore R21 container & modern group: [name="pin-entry"]
    const pinGroup = document.querySelector('[name="pin-entry"], [role="group"][name*="pin" i], [role="group"][aria-label*="pin" i]');
    if (pinGroup) {
      const groupInputs = Array.from(pinGroup.querySelectorAll('input'));
      if (groupInputs.length === 4) return groupInputs;
    }

    // 2. aria-label="1 of 4 values entered" etc.
    const ariaInputs = [
      document.querySelector('input[aria-label*="1 of 4"]'),
      document.querySelector('input[aria-label*="2 of 4"]'),
      document.querySelector('input[aria-label*="3 of 4"]'),
      document.querySelector('input[aria-label*="4 of 4"]')
    ].filter(Boolean);
    if (ariaInputs.length === 4) return ariaInputs;

    // 3. digit-0 through digit-3 IDs
    const digitInputs = [];
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`digit-${i}`);
      if (el) digitInputs.push(el);
    }
    if (digitInputs.length === 4) return digitInputs;

    // 4. Fallback: 4 single-digit numeric / password inputs
    const genericInputs = Array.from(document.querySelectorAll('input[type="password"][inputmode="numeric"], input[inputmode="numeric"][maxlength="1"]'));
    if (genericInputs.length === 4) return genericInputs;

    return null;
  }

  function isPinPage() {
    const url = location.href.toLowerCase();
    if (url.includes('enter-pin') || url.includes('sg-r21') || url.includes('/pin/')) {
      return true;
    }
    return !!getPinInputs();
  }

  function autoInsertProfilePin() {
    if (!settings.autoInsertPin || !settings.profilePin) return false;
    const pin = String(settings.profilePin).trim();
    if (!/^\d{4}$/.test(pin)) {
      console.warn('[Disney+ Ultra] Configured PIN is not 4 digits:', pin);
      return false;
    }

    const inputs = getPinInputs();
    if (!inputs || inputs.length !== 4) return false;

    const firstInput = inputs[0];
    const now = Date.now();
    if (location.href === lastPinAttemptUrl && now - lastPinAttemptTime < 2500) {
      return false;
    }

    lastPinAttemptUrl = location.href;
    lastPinAttemptTime = now;

    console.log('[Disney+ Ultra] Auto-inserting 4-digit profile PIN...');

    // Method 1: React internal onPaste handler (Fastest & most reliable)
    try {
      const reactPropsKey = Object.keys(firstInput).find(k => k.startsWith('__reactProps'));
      if (reactPropsKey && typeof firstInput[reactPropsKey]?.onPaste === 'function') {
        console.log('[Disney+ Ultra] Triggering React onPaste handler with PIN.');
        firstInput[reactPropsKey].onPaste({
          preventDefault: () => {},
          clipboardData: {
            getData: () => pin
          }
        });
      }
    } catch (e) {
      console.warn('[Disney+ Ultra] Direct React onPaste call failed:', e);
    }

    // Method 2: Synthetic ClipboardEvent paste
    try {
      firstInput.focus();
      const dt = new DataTransfer();
      dt.setData('text', pin);
      dt.setData('text/plain', pin);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      firstInput.dispatchEvent(pasteEvent);
      console.log('[Disney+ Ultra] Dispatched ClipboardEvent paste on first PIN input.');
    } catch (err) {
      console.warn('[Disney+ Ultra] Synthetic paste dispatch failed:', err);
    }

    // Method 3: Fallback React onChange and native value setter
    setTimeout(() => {
      const lastInput = inputs[3];
      if (!lastInput || !lastInput.value) {
        console.log('[Disney+ Ultra] Fallback: setting individual digits via React props and native setters.');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        inputs.forEach((input, i) => {
          input.focus();
          if (nativeSetter) {
            nativeSetter.call(input, pin[i]);
          } else {
            input.value = pin[i];
          }

          const reactPropsKey = Object.keys(input).find(k => k.startsWith('__reactProps'));
          if (reactPropsKey && typeof input[reactPropsKey]?.onChange === 'function') {
            input[reactPropsKey].onChange({
              target: input,
              currentTarget: input,
              preventDefault: () => {}
            });
          }

          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: pin[i], bubbles: true, composed: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { key: pin[i], bubbles: true, composed: true }));
        });
      }

      // Check for Continue/Submit button if not automatically submitted
      setTimeout(() => {
        const submitBtn = document.querySelector('button[type="submit"], button.button--primary, button[data-testid="submit-button"], button[aria-label*="Continue" i]');
        if (submitBtn && (submitBtn.offsetWidth > 0 || submitBtn.offsetHeight > 0)) {
          console.log('[Disney+ Ultra] Clicking submit button for PIN.');
          submitBtn.click();
        }
      }, 300);
    }, 150);

    return true;
  }

  // ==========================================
  // ROUTE DETECTION & RUN LOOP
  // ==========================================

  function onUrlChange() {
    const oldUrl = currentUrl;
    currentUrl = location.href;
    console.log('[Disney+ Ultra] URL changed to:', currentUrl);

    // If leaving a playing video towards a PIN prompt, mark transition if in fullscreen
    if (oldUrl.includes('/play/') && isPinPage()) {
      if (settings.maintainFullscreen && isCurrentlyFullscreen()) {
        sessionStorage.setItem('dpu_fullscreen_transition', 'true');
      }
    }

    // If entering player (/play/), check if we should restore fullscreen
    if (currentUrl.includes('/play/')) {
      handleNextEpisodeFullscreen();
    }

    // Check PIN entry on URL change
    if (isPinPage()) {
      setTimeout(autoInsertProfilePin, 300);
      setTimeout(autoInsertProfilePin, 1000);
    }
  }

  // Hook pushState and replaceState for SPA route change detection
  const origPushState = history.pushState;
  history.pushState = function(...args) {
    origPushState.apply(this, args);
    onUrlChange();
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    origReplaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  // Periodic loop for skip buttons, PIN inputs, and video listener
  // NOTE: Fullscreen is NEVER polled or forced here!
  function runChecks() {
    // 1. PIN prompt check
    if (isPinPage()) {
      autoInsertProfilePin();
      return;
    }

    // 2. Player checks
    if (location.href.includes('/play/')) {
      // Check skip intro
      if (!checkSkipIntro()) {
        // Check next episode / skip credits
        checkNextEpisode();
      }

      // Attach video listeners for natural end detection
      attachVideoListeners();
    }
  }

  // Set up interval check (only for skip buttons and PIN prompts)
  setInterval(runChecks, 350);

  // Set up MutationObserver to react immediately to skip overlays
  const observer = new MutationObserver(() => {
    runChecks();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Initial check on load
  if (location.href.includes('/play/')) {
    handleNextEpisodeFullscreen();
  }
  setTimeout(runChecks, 500);

})();
