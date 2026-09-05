'use strict';

const http       = require('http');
const { URL }    = require('url');
const { chromium } = require('playwright');

const PORT = process.env.SCRAPER_PORT || 3000;
const fs   = require('fs');
const path = require('path');

// ── Local cache (file-based, 1h TTL) ─────────────────────────────────────────
const CACHE_DIR = process.env.CACHE_DIR || '/tmp/dg-cache';
const CACHE_TTL_MS = 60 * 60 * 1000;
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

function cacheGet(domain) {
  try {
    const f = path.join(CACHE_DIR, domain + '.json');
    const stat = fs.statSync(f);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      try { fs.unlinkSync(f); } catch {}
      return null;
    }
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return null; }
}

function cacheSet(domain, result) {
  try {
    fs.writeFileSync(path.join(CACHE_DIR, domain + '.json'), JSON.stringify(result));
  } catch {}
}

// ── Concurrency limit: max 2 simultaneous Chromium pages ─────────────────────
let active = 0;
const waiting = [];
function acquire() {
  return new Promise(resolve => {
    if (active < 2) { active++; resolve(); }
    else waiting.push(resolve);
  });
}
function release() {
  active--;
  const next = waiting.shift();
  if (next) { active++; next(); }
}

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

  let domain, force = false;
  try {
    const u  = new URL(req.url, `http://localhost:${PORT}`);
    domain   = u.searchParams.get('domain');
    force    = u.searchParams.get('force') === '1';
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

  // Force-refresh: delete cache entry before fetching
  if (force) {
    try { fs.unlinkSync(path.join(CACHE_DIR, domain + '.json')); } catch {}
  }

  // Serve from cache when fresh (unless force refresh)
  const cached = !force && cacheGet(domain);
  if (cached) {
    res.writeHead(200);
    res.end(JSON.stringify(cached));
    return;
  }

  try {
    await acquire();
    let result;
    try {
      result = await checkDomain(domain);
    } finally {
      release();
    }
    if (result.score !== null) cacheSet(domain, result);
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
