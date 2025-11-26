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

// Helper function to handle the Aternos interaction
async function startAternosServer(ctx) {
    let browser = null;
    // Set higher timeout for page actions
    const PAGE_TIMEOUT = 90000; 

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

        const page = await browser.newPage();

        // set viewport to look like a real desktop
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Login
        ctx.reply('🔑 Logging into Aternos...');
        // Increased navigation timeout
        await page.goto('https://aternos.org/go/', { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

        // Accept cookies if the banner appears (try/catch to ignore if not present)
        try {
            // Use a short timeout for cookies, as it's not critical
            const cookieBtn = await page.waitForSelector('.cc-btn.cc-dismiss', { timeout: 5000 });
            if (cookieBtn) await cookieBtn.click();
        } catch (e) {}

        // Type credentials
        // !!! INCREASED TIMEOUT HERE FOR THE FAILED SELECTOR !!!
        await page.waitForSelector('#user', { visible: true, timeout: 60000 });
        await page.type('#user', process.env.ATERNOS_USER);
        await page.type('#password', process.env.ATERNOS_PASS);

        // Click login button
        await page.click('#login');
        
        // Wait for navigation to the dashboard or server list
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

        // Check if login failed
        if (page.url().includes('login')) {
            throw new Error('Login failed. Check your username/password. Aternos might also be showing a CAPTCHA/Cloudflare screen that the bot cannot pass.');
        }

        // 2. Select Server
        // If we are on the server list page (account with multiple servers), click the first one
        if (page.url().includes('/servers')) {
            await page.click('.server-body'); 
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }

        // 3. Click Start
        ctx.reply('⚡ Looking for Start button...');
        
        // Wait for the main server interface
        await page.waitForSelector('#start', { timeout: 30000 });
        
        // Check status before clicking
        const status = await page.$eval('.status-label', el => el.innerText);
        if (status.toLowerCase().includes('online')) {
            ctx.reply('✅ Server is already ONLINE!');
            await browser.close();
            return;
        }

        // Click Start
        await page.click('#start');
        ctx.reply('🖱️ Start button clicked. Waiting for confirmation...');

        // 4. Handle Queue/Confirmation
        try {
            // Wait a moment for modals
            await new Promise(r => setTimeout(r, 2000));
            
            // Look for the huge red notification "Confirm" button if queue is long
            // Or the standard EULA accept button
            const confirmSelector = '#confirm';
            if (await page.$(confirmSelector) !== null) {
                await page.click(confirmSelector);
                ctx.reply('✅ Confirmed launch request.');
            }
        } catch (e) {
            // No confirmation needed or missed it
            console.log("No confirmation modal found.");
        }

        ctx.reply('✅ Browser task finished. The server should be starting now.');

    } catch (error) {
        console.error(error);
        ctx.reply(`❌ Error: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

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
