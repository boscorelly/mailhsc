'use strict';

const http       = require('http');
const { URL }    = require('url');
const { chromium } = require('playwright');

const PORT = process.env.SCRAPER_PORT || 3000;

// One shared browser instance — reuse across requests
let browser = null;
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browser;
}

async function checkDomain(domain) {
  const b    = await getBrowser();
  const page = await b.newPage();
  page.on('console', () => {});

  try {
    await page.goto(
      `https://domainguardian.nebiatek.com/results?domain=${encodeURIComponent(domain)}`,
      { waitUntil: 'networkidle', timeout: 60000 }
    );
    await page.waitForTimeout(5000);

    const result = await page.evaluate(() => {
      const text  = document.body.innerText;
      // Match score (1-3 digits) followed by "Grade:" on the next line
      // Use \s+ to handle \r\n, \n, or other whitespace between them
      const match = text.match(/(\d{1,3})[\r\n]+Grade:\s*([A-F][+-]?)/);
      return {
        score: match ? match[1] : null,
        grade: match ? match[2] : null,
      };
    });

    return result;
  } finally {
    await page.close();
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (!req.url.startsWith('/check')) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let domain;
  try {
    const u  = new URL(req.url, `http://localhost:${PORT}`);
    domain   = u.searchParams.get('domain');
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid url' }));
    return;
  }

  if (!domain || !/^[a-zA-Z0-9._-]{1,253}$/.test(domain)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid domain' }));
    return;
  }

  try {
    const result = await checkDomain(domain);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('scraper error for domain:', domain, err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'scraper unavailable' }));
  }
});

// Warm up browser on start
getBrowser().then(() => {
  console.log('Scraper browser ready');
  server.listen(PORT, () => console.log(`Scraper listening on :${PORT}`));
}).catch(err => {
  console.error('Failed to start browser:', err);
  process.exit(1);
});
