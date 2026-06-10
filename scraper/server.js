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
    // Use 'load' not 'networkidle' — DomainGuardian makes continuous DNS/DoH
    // requests that prevent the page from ever reaching network idle state
    await page.goto(
      `https://domainguardian.nebiatek.com/results?domain=${encodeURIComponent(domain)}`,
      { waitUntil: 'load', timeout: 30000 }
    );
    // Wait for "Scanned on" to appear (analysis started)
    await page.waitForFunction(() => {
      return document.body.innerText.includes('Scanned on');
    }, { timeout: 60000 });

    // Wait for the score to stabilize — "Scanned on" appears while score is still
    // 0, then the final score is computed over the next few seconds as DNS lookups
    // complete. Poll until score stops changing.
    let lastScore = null;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const current = await page.evaluate(() => {
        const text = document.body.innerText;
        const m = text.match(/(\d{1,3})[\r\n]+Grade:/);
        return m ? m[1] : null;
      });
      if (current !== null && current === lastScore) break;
      lastScore = current;
    }

    const result = await page.evaluate(() => {
      const text  = document.body.innerText;
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
