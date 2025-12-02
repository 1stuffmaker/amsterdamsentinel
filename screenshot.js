const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

(async () => {
  const outDir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    {
      url: 'https://amsterdamsentinel.grafana.net/public-dashboards/d93f8182bbf84d9f89bca0d105e8e230',
      filename: 'dashboard.png',
      viewport: { width: 1920, height: 2000 }
    },
  ];

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Removed flags that can cause blank/black canvas rendering in headless Chromium
      '--enable-webgl',
      '--enable-unsafe-webgpu',
      '--ignore-certificate-errors',
      '--hide-scrollbars'
    ]
  });

  try {
    for (const t of targets) {
      // Allow per-target retries
      const maxAttempts = t.retries || 2;
      let attempt = 0;
      let lastError = null;
      const vp = t.viewport || { width: 1920, height: 1200 };

      // Try multiple attempts if the capture appears to be blank
      while (attempt < maxAttempts) {
        attempt++;
        const page = await browser.newPage();
        // Always use a large fixed viewport to ensure we capture the full dashboard
        const viewport = { width: 1920, height: 2000 };
        await page.setViewport(viewport);
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
        console.log('Loading', t.url, '(attempt', attempt, 'of', maxAttempts + ')');
        await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Short wait so Grafana panels have time to paint
        await new Promise(res => setTimeout(res, 3000 + (attempt - 1) * 2000));

        // Wait for Grafana canvas elements or time out
        try {
          await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 15000 });
          await new Promise(res => setTimeout(res, 1000));
        } catch (e) {
          // continue anyway
        }

        // Try a few possible dashboard wrapper selectors (Grafana markup can change)
        const wrapperSelectors = [
          '.css-1u1o2gi-page-wrapper',
          '.dashboard-container',
          '.gf-dashboard',
          '[data-testid="dashboard-container"]'
        ];
        let wrapper = null;
        for (const sel of wrapperSelectors) {
          wrapper = await page.$(sel);
          if (wrapper) break;
        }

        // Save debug HTML for inspection
        try {
          const html = await page.content();
          fs.writeFileSync(path.join(outDir, `${t.filename.replace('.png', '')}_debug.html`), html);
        } catch (e) {
          console.warn('Failed writing debug HTML:', e.message || e);
        }

        const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
        console.log('Canvas elements found:', canvasCount, 'Wrapper selector found:', !!wrapper);

        const outPath = path.join(outDir, t.filename);
        // Always use fullPage: true to capture the entire scrollable content
        await page.screenshot({ path: outPath, fullPage: true });
        console.log('Saved:', outPath);

        // Save a full-page debug screenshot as well
        try {
          await page.screenshot({ path: path.join(outDir, `${t.filename.replace('.png', '')}_debug_full.png`), fullPage: true });
        } catch (e) {
        }

        // Check whether the saved image is mostly black
        let isMostlyBlack = false;
        try {
          const stats = await sharp(outPath).stats();
          const mean = stats.channels.reduce((s, c) => s + (c.mean || 0), 0) / stats.channels.length;
          console.log('Image mean luminance:', mean.toFixed(2));
          if (mean < 10) isMostlyBlack = true;
        } catch (e) {
          console.warn('Failed to analyze image luminance:', e.message || e);
        }

        await page.close();

        if (!isMostlyBlack) {
          break; // good capture
        }

        lastError = new Error('Captured image is mostly black');
        console.warn('Captured image is mostly black, retrying...');
        await new Promise(res => setTimeout(res, 3000 * attempt));
      }

      if (lastError) console.error('Final attempt issue for', t.url, lastError.message);
    }
  } catch (err) {
    console.error('Screenshot error', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
