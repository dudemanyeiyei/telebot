const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// --- DEBUG SECTION ---
console.log("--- DEBUG: ENVIRONMENT VARIABLES CHECK ---");
console.log("Available Environment Keys:", Object.keys(process.env));

if (process.env.TELEGRAM_BOT_TOKEN) {
    // Show the first 5 characters to help verify it's the right token
    const tokenPreview = process.env.TELEGRAM_BOT_TOKEN.substring(0, 5) + "...";
    console.log(`✅ TELEGRAM_BOT_TOKEN found (Length: ${process.env.TELEGRAM_BOT_TOKEN.length})`);
    console.log(`🔎 Token starts with: "${tokenPreview}" (Check if this matches BotFather)`);
} else {
    console.error("❌ TELEGRAM_BOT_TOKEN is MISSING or UNDEFINED");
}
console.log("----------------------------------------");
// ---------------------

// Add stealth plugin to hide that this is a bot
puppeteer.use(StealthPlugin());

// Check if the token is available
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("❌ Fatal Error: TELEGRAM_BOT_TOKEN is not set in environment variables.");
    console.error("👉 ACTION REQUIRED: Go to Railway -> Variables and add 'TELEGRAM_BOT_TOKEN'. Then REDEPLOY.");
    process.exit(1);
}

// Initialize the bot with your token
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Helper function to dump HTML content for debugging
async function dumpHtmlContent(page, context) {
    if (page) {
        try {
            const htmlContent = await page.content();
            console.error(`--- PAGE CONTENT DUMP ON FAILURE (${context.toUpperCase()}) (START) ---`);
            console.error(htmlContent);
            console.error(`--- PAGE CONTENT DUMP ON FAILURE (${context.toUpperCase()}) (END) ---`);
            return `The raw page HTML for step '${context}' has been dumped to the logs for inspection.`;
        } catch (dumpError) {
            console.error(`Error dumping HTML: ${dumpError.message}`);
            return `Failed to dump page HTML for step '${context}'.`;
        }
    }
    return '';
}

// Helper function to handle the Aternos interaction
async function startAternosServer(ctx) {
    let browser = null;
    // Set faster timeout for the final login wait
    const FAST_TIMEOUT = 15000;
    const SLOW_TIMEOUT = 90000;
    const MAX_POLLS = 120; // Maximum number of status checks (120 * 10 seconds = 20 minutes)
    const POLL_INTERVAL_MS = 10000; // Check status every 10 seconds
    let page = null; // Declare page outside try block for access in catch

    try {
        ctx.reply('🚀 Launching browser... (This may take up to 2 minutes)');

        // Launch browser with arguments optimized for Railway/Docker
        browser = await puppeteer.launch({
            // Use 'new' headless mode
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process', // Often helps in containerized environments
                '--no-zygote'
            ],
            // PUPPETEER_EXECUTABLE_PATH is set in the Dockerfile
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
        });

        page = await browser.newPage();

        // ** Set a realistic User Agent to improve stealth **
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

        // set viewport to look like a real desktop
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Login
        ctx.reply('🔑 Logging into Aternos...');
        await page.goto('https://aternos.org/go/', { waitUntil: 'domcontentloaded', timeout: SLOW_TIMEOUT });

        // ** Adding a 5 second human-like pause after page load **
        console.log("Pausing for 5 seconds to simulate human behavior...");
        await new Promise(r => setTimeout(r, 5000));
        // End of pause

        // Accept cookies if the banner appears (try/catch to ignore if not present)
        try {
            const cookieBtn = await page.waitForSelector('.cc-btn.cc-dismiss', { timeout: 5000 });
            if (cookieBtn) await cookieBtn.click();
        } catch (e) { /* ignore if element not found */ }

        // Type credentials
        await page.waitForSelector('.username', { visible: true, timeout: 60000 });

        // FIX: Using page.evaluate() to directly set the value, which is more reliable than page.type()
        await page.evaluate((user, pass) => {
            document.querySelector('.username').value = user;
            document.querySelector('.password').value = pass;
        }, process.env.ATERNOS_USER, process.env.ATERNOS_PASS);

        // Click login button
        await page.click('.login-button');

        // FIX: Replacing strict page.waitForNavigation() with a more reliable wait for a key element
        // on the destination page (the server list/dashboard). We are using a fast timeout here.
        const dashboardSelector = '.server-body, .server-list, #start';

        try {
            // Use the fast timeout for the expected success state
            await page.waitForSelector(dashboardSelector, { timeout: FAST_TIMEOUT });
        } catch (e) {
            // --- LOGIN FAILURE ANALYSIS ---
            const currentUrl = page.url();

            // NEW: Attempt to extract the specific Aternos error message
            let loginErrorText = '';
            try {
                // Look specifically for the text within the error span
                loginErrorText = await page.$eval('.login-error .error-message', el => el.innerText.trim());
            } catch (innerError) { /* ignore if element not found */ }

            const urlStillLogin = currentUrl.includes('login');

            if (urlStillLogin && loginErrorText) {
                // We are still on the login page and an Aternos error is showing.
                throw new Error(`Aternos Login Failed: ${loginErrorText}. Please check your ATERNOS_USER and ATERNOS_PASS environment variables.`);
            } else if (urlStillLogin) {
                // We are still on the login page but no explicit Aternos error was detected (might be 2FA prompt or HCAPTCHA block).
                throw new Error('Login failed. Aternos might be asking for a 2FA code or a silent CAPTCHA block occurred.');
            } else {
                // We left the login page but didn't find the dashboard/server list in time (network issue/slow loading).
                throw new Error(`Navigation failed or server dashboard did not load fast enough (>${FAST_TIMEOUT}ms). Current URL: ${currentUrl}`);
            }
        }

        // 2. Select Server
        // If we are on the server list page (account with multiple servers), click the first one
        if (page.url().includes('/servers')) {
            ctx.reply('🖱️ Found server list, clicking first server...');
            await page.click('.server-body');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        }

        // 3. Initial Status Check
        ctx.reply('⚡ Looking for Start button and server status...');

        // Wait for the main server interface (#start button is a reliable identifier for the dashboard)
        await page.waitForSelector('#start', { timeout: 30000 });

        // CRITICAL FIX: Ensure the status label is present and visible before trying to read it
        const statusTextSelector = '.statuslabel-label';
        try {
            await page.waitForSelector(statusTextSelector, { visible: true, timeout: 15000 });
        } catch (e) {
            const debugMsg = await dumpHtmlContent(page, 'initial_status_check');
            throw new Error(`Server Status element not found. Aternos UI may have changed or failed to load completely. ${debugMsg}`);
        }

        let status = await page.$eval(statusTextSelector, el => el.innerText);

        if (status.toLowerCase().includes('online')) {
            ctx.reply('✅ Server is already ONLINE!');
            await browser.close();
            return;
        }

        // 4. Click Start (if not online)
        ctx.reply('🖱️ Server is offline. Clicking Start button...');
        await page.click('#start');

        let pollCount = 0;
        let isOnline = false;
        let waitingOrQueue = false;

        // 5. Polling Loop
        while (pollCount < MAX_POLLS && !isOnline) {
            pollCount++;
            console.log(`Polling server status... (Attempt ${pollCount}/${MAX_POLLS})`);

            // --- A. Confirmation/EULA Handler ---
            try {
                // Check for the huge red notification "Confirm" button or standard EULA accept button
                const confirmSelector = '#confirm, .eula-accept-button';
                const confirmBtn = await page.$(confirmSelector);
                if (confirmBtn) {
                    await confirmBtn.click();
                    ctx.reply('✅ Confirmation/EULA button pressed.');
                    // Wait for the modal to dismiss and page to update
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) {
                // No confirmation needed or failed to click it
                console.log("No confirmation modal found or failed to click.");
            }

            // --- B. Status Check ---
            try {
                // Refresh the status text
                status = await page.$eval(statusTextSelector, el => el.innerText);
                const normalizedStatus = status.toLowerCase();

                if (normalizedStatus.includes('online')) {
                    isOnline = true;
                    ctx.reply('🎉 Server is now **ONLINE**!');
                } else if (normalizedStatus.includes('waiting') || normalizedStatus.includes('queue')) {
                    waitingOrQueue = true;
                    ctx.reply(`⏳ Server Status: **${status}** (Checking again in ${POLL_INTERVAL_MS / 1000}s)`);
                    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                } else if (normalizedStatus.includes('loading') || normalizedStatus.includes('starting')) {
                    ctx.reply(`🔄 Server Status: **${status}** (Starting up...) (Checking again in ${POLL_INTERVAL_MS / 1000}s)`);
                    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                } else if (normalizedStatus.includes('stopping') || normalizedStatus.includes('offline')) {
                    // CRITICAL: If the status reverts to offline/stopping, try clicking start again
                    // This covers the case where a queue times out or a confirmation is missed.
                    if (pollCount > 1) { // Only click again after the first attempt
                        ctx.reply('⚠️ Server status reverted to offline/stopping. Clicking Start again...');
                        await page.click('#start');
                        await new Promise(r => setTimeout(r, 5000)); // Wait for page reaction
                    }
                    await new Promise(r => setTimeout(r, 5000)); // Short pause before next check
                } else {
                    // Catch-all for unknown states
                    ctx.reply(`❓ Unknown Server Status: **${status}**. Will continue checking...`);
                    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                }

            } catch (e) {
                const debugMsg = await dumpHtmlContent(page, `status_poll_attempt_${pollCount}`);
                ctx.reply(`❌ Server Status Check Failed on attempt ${pollCount}. ${debugMsg}`);
                throw new Error(`Failed to read server status: ${e.message}`);
            }
        }

        if (!isOnline) {
            ctx.reply(`❌ Server did not start within the maximum time limit (approx. ${Math.round(MAX_POLLS * POLL_INTERVAL_MS / 60000)} minutes).`);
        }

    } catch (error) {
        // Handle all other errors, including fatal Puppeteer/Login errors
        const context = 'final_catch';
        let dumpMessage = '';
        if (page) {
             dumpMessage = await dumpHtmlContent(page, context);
        }
        ctx.reply(`❌ **Fatal Process Error**: ${error.message} \n\n${dumpMessage}`);
        console.error(error);
    } finally {
        if (browser) await browser.close();
        console.log('Browser closed.');
    }
}

// Bot Command Handler
bot.command('start', (ctx) => {
    startAternosServer(ctx);
});

// Enhanced launch with error handling for 401 Unauthorized
bot.launch().then(() => {
    console.log('Bot is running...');
}).catch((err) => {
    console.error("❌ FAILED TO LAUNCH BOT");
    if (err.response && err.response.error_code === 401) {
        console.error("🚨 ERROR 401: Unauthorized. Your TELEGRAM_BOT_TOKEN is wrong.");
        console.error("   - Check for leading/trailing spaces in Railway variables.");
        console.error("   - Check if you copied the whole token.");
        console.error("   - Generate a new token in @BotFather.");
    } else {
        console.error(err);
    }
    process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
