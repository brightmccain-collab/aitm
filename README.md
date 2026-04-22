# AiTM Proxy Research Environment (V2)
### Transition from Device Code Flow to Dynamic Proxy Relay

This environment is designed for training engineers on how modern Adversary-in-the-Middle (AiTM) attacks operate using headless browser synchronization.

## Architecture
1. **Orchestrator (src/orchestrator.js)**: Uses `puppeteer-extra` with `stealth` and `puppeteer-real-browser` to create a session that mimics a standard user laptop.
2. **Relay Server (src/server.js)**: An Express/Socket.io server that pipes victim interactions to the headless browser.
3. **Frontend Mirror (frontend/index.html)**: A dynamic interface that renders the headless browser's state in real-time.

## Setup Instructions
1. Install dependencies: `npm install puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-real-browser socket.io express`
2. Configure your proxy in `src/config.json` (optional but recommended for bypassing geolocation checks).
3. Run the orchestrator: `node src/server.js`

## Why this is replacing the Device Code method:
- **No Visual Lures**: The victim interacts with the real UI, not a "device login" page.
- **MFA Capture**: The session is captured AFTER the user completes their real MFA.
- **Stealth**: Uses 2026-standard evasion to bypass Turnstile and WAF.
