# Use an official Node.js image as the base
FROM node:22-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install system dependencies required for Puppeteer/Chromium to run in a headless environment.
# Crucially, we now include the 'chromium' package itself.
RUN apt-get update \
    && apt-get install -y \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libxkbcommon0 \
    libgbm-dev \
    libasound2 \
    libcups2 \
    libfontconfig \
    libgtk-3-0 \
    libxrandr2 \
    libgconf-2-4 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of your application code
COPY . .

# Set environment variable telling Puppeteer where to find the browser
# This points to the system-installed Chromium path, which is now installed above
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

# Run the command to start your application
CMD [ "node", "bot.js" ]
