# Use official Playwright image — includes all system deps + correct Chromium for the platform
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Update npm to latest major version
RUN npm install -g npm@latest

WORKDIR /app

COPY package.json ./
# Playwright already installed in base image — skip browser download
RUN npm install --omit=dev && npx playwright install chromium

COPY server.js ./

# Create non-root user
RUN groupadd -r scraper && useradd -r -g scraper scraper \
    && chown -R scraper:scraper /app

USER scraper

EXPOSE 3000
CMD ["node", "server.js"]
