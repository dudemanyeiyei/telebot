const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to hide that this is a bot
puppeteer.use(StealthPlugin());

// Check if the token is available
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("❌ Fatal Error: TELEGRAM_BOT_TOKEN is not set in environment variables.");
    process.exit(1);
}

// Initialize the bot with your token
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Helper function to handle the Aternos interaction
async function startAternosServer(ctx) {
    let browser = null;
    try {
        ctx.reply('🚀 Launching browser... (This may take up to 2 minutes)');

        // Launch browser with arguments optimized for Railway/Docker
        browser = await puppeteer.launch({
            headless: 'new', // Use new headless mode
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process', // Often helps in containerized environments
                '--no-zygote'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();

        // set viewport to look like a real desktop
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Login
        ctx.reply('🔑 Logging into Aternos...');
        await page.goto('https://aternos.org/go/', { waitUntil: 'networkidle2', timeout: 60000 });

        // Accept cookies if the banner appears (try/catch to ignore if not present)
        try {
            const cookieBtn = await page.waitForSelector('.cc-btn.cc-dismiss', { timeout: 5000 });
            if (cookieBtn) await cookieBtn.click();
        } catch (e) {}

        // Type credentials
        await page.waitForSelector('#user', { visible: true });
        await page.type('#user', process.env.ATERNOS_USER);
        await page.type('#password', process.env.ATERNOS_PASS);

        // Click login button
        await page.click('#login');
        
        // Wait for navigation to the dashboard or server list
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

        // Check if login failed
        if (page.url().includes('login')) {
            throw new Error('Login failed. Check your username/password.');
        }

        // 2. Select Server (If you have multiple, it usually defaults to the last used, 
        // but explicit selection is safer if you know the server ID. 
        // For now, we assume the dashboard loads the main server).
        
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
        // Aternos sometimes shows a "Confirm" modal or a "Yes, I accept the EULA" modal
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
        
        // Optional: Take a screenshot on error for debugging (requires setting up file sending)
        // if (browser) {
        //    const buffer = await browser.pages()[0].screenshot();
        //    ctx.replyWithPhoto({ source: buffer });
        // }
    } finally {
        if (browser) await browser.close();
    }
}

bot.command('start', (ctx) => {
    startAternosServer(ctx);
});

bot.launch().then(() => {
    console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
