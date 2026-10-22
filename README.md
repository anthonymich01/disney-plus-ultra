# Disney Plus Ultra 🚀

A high-performance Chrome Extension (Manifest V3) crafted to elevate your Disney+ viewing experience by eliminating common annoyances during binge-watching.

![Disney Plus Ultra](icons/icon128.png)

---

## 🌟 Key Features

### 1. ⚡ Auto Skip Intro & Credits
- **Instant Skip Intro**: Automatically detects and clicks "Skip Intro" or "Skip Recap" overlays as soon as they appear.
- **Immediate Next Episode**: Eliminates waiting through end credits and countdown screens by triggering the next episode immediately.
- **Deep Web Component Integration**: Works natively with Disney+'s Lit/Shadow DOM player components (`<skip-overlay>`, `<up-next-lite-v1>`, `<end-card-overlay>`, and `<pivot-tray-overlay>`) as well as Disney+'s native `Shift+N` player command bus.

### 2. 📺 Maintain Fullscreen Across Episodes
- **Never Drop Out of Fullscreen**: On standard Disney+, transitioning to the next episode often forces the browser out of full screen.
- **Seamless Continuity**: Disney Plus Ultra intercepts unnecessary `exitFullscreen()` triggers during episode transitions and ensures the player remains in full screen seamlessly.
- **Maintains Your Player Mode**: If you are watching in fullscreen, the next episode stays in fullscreen; if you choose to watch in windowed mode, it stays in windowed mode and will never force you into fullscreen.
- **Respects User Intent**: Pressing `Escape`, `f`, or clicking the player's fullscreen toggle button will immediately exit full screen as expected and will not be re-triggered.

### 3. 🔐 Auto-Insert Profile PIN for 21+ (R21) Titles
- **No More Repeated PIN Prompts**: In regions like Singapore (R21) or on profiles with Content Rating PINs, Disney+ repeatedly interrupts playback to ask for your 4-digit profile PIN (`https://www.disneyplus.com/profiles/sg-r21/enter-pin` or `/enter-pin/*`).
- **One-Time Configuration**: Enter your 4-digit PIN in the extension popup and enable **Auto Insert Profile PIN**.
- **Automated Entry & Submission**: When redirected to the PIN prompt, the extension automatically injects the PIN into the input fields and submits the form.
- **Auto-Return to Fullscreen**: Once verified and redirected to the next episode, full screen mode is automatically restored.

---

## 📦 Installation Instructions

1. **Open Google Chrome**.
2. Navigate to `chrome://extensions/` in your address bar (or go to **Menu (⋮)** → **Extensions** → **Manage Extensions**).
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the project directory:
   ```
   G:\projects\disney-plus-ultra
   ```
6. The **Disney Plus Ultra** extension icon will now appear in your Chrome toolbar!

---

## ⚙️ Configuration & Usage

1. Click the **Disney Plus Ultra** icon in your Chrome extensions bar.
2. Configure your desired preferences:
   - **Auto Skip Intro & Credits**: Toggle on/off (Default: **ON**).
   - **Stay in Fullscreen**: Toggle on/off (Default: **ON**).
   - **Auto Insert Profile PIN**: Toggle on/off.
   - **4-Digit Profile PIN**: Enter your 4-digit PIN (e.g., `0000`) and click **Save Settings**.
3. Open or refresh any [Disney+](https://www.disneyplus.com) tab and enjoy uninterrupted streaming!

---

## 🛠️ Architecture & Under the Hood

```
disney-plus-ultra/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background/
│   └── service-worker.js      # Background worker handling window fullscreen & storage
├── content/
│   ├── content-isolated.js    # Isolated-world script bridging chrome.* APIs & storage
│   └── content-main.js        # Main-world script with direct DOM, prototype & shadow DOM access
├── popup/
│   ├── popup.html             # Sleek dark-mode extension popup interface
│   ├── popup.css              # Disney+ inspired cyan/blue glowing aesthetic
│   └── popup.js               # Reactive settings storage & tab status manager
├── icons/                     # Generated extension icons (16px, 32px, 48px, 128px)
├── generate-icons.js          # Node.js icon generator script
└── README.md                  # Documentation
```

### Why Main World Execution (`world: "MAIN"`)?
Disney+ uses modern Custom Elements with closed/open Shadow Roots (`<disney-web-player>`, `<skip-overlay>`, `<pivot-tray-overlay>`) and custom LitElement event buses. Running `content-main.js` in the main execution context allows:
- Intercepting `document.exitFullscreen()` to prevent Disney+ from dropping fullscreen during playback teardown.
- Interacting directly with Disney+'s `commandBus` and `streamController`.
- Synthesizing native `ClipboardEvent` and React input descriptors to reliably auto-enter profile PINs without triggering security locks.
- Listening to SPA route changes (`pushState` and `replaceState`) instantly.

---

## 🔒 Privacy & Security

- **Local Storage Only**: Your profile PIN and preferences are stored exclusively on your local device within Chrome's sandboxed storage (`chrome.storage.sync` / `chrome.storage.local`).
- **Zero Telemetry**: No user data, passwords, or browsing activity are ever collected, transmitted, or logged externally.
- **Domain Restricted**: The extension only activates on `disneyplus.com` domains.
