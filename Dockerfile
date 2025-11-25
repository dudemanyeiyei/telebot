# Use the official Puppeteer image which includes Chrome and all dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install dependencies (if needed) or setup app
USER root

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json .
RUN npm install

# Copy the bot code
COPY bot.js .

# Switch back to the non-privileged 'pptruser' provided by the image
USER pptruser

# Start the bot
CMD ["node", "bot.js"]
