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
      '--ignore-certificate-errors',
      '--hide-scrollbars'
    ]
  });

  try {
    for (const t of targets) {
      // Allow per-target retries
      const maxAttempts = t.retries || 5;
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

        // Ensure we use the per-target viewport
        await page.setViewport(vp);

        // Wait for at least one painted canvas (presence alone isn't enough)
        try {
          await page.waitForFunction(() => {
            const canvases = Array.from(document.querySelectorAll('canvas'));
            if (canvases.length === 0) return false;
            return canvases.some(c => {
              try {
                return c.toDataURL().length > 2000;
              } catch (e) {
                return false;
              }
            });
          }, { timeout: 20000 });
          await page.waitForTimeout(500);
        } catch (e) {
          console.warn('Painted-canvas wait timed out; continuing (will rely on retry/luminance)');
        }

        const outPath = path.join(outDir, t.filename);
        if (wrapper) {
          console.log('Using wrapper.screenshot for', t.filename);
          await wrapper.screenshot({ path: outPath });
        } else {
          console.log('Wrapper not found; using fullPage screenshot for', t.filename);
          await page.screenshot({ path: outPath, fullPage: true });
        }
        console.log('Saved:', outPath);

        // Save a debug full-page screenshot as well
        try {
          await page.screenshot({ path: path.join(outDir, `${t.filename.replace('.png', '')}_debug_full.png`), fullPage: true });
        } catch (e) {
        }

        // Validate screenshot: ensure it's larger than threshold and not mostly black
        const MIN_BYTES = 100 * 1024; // 100KB
        let isTooSmall = false;
        try {
          const st = fs.statSync(outPath);
          if (!st || st.size < MIN_BYTES) {
            isTooSmall = true;
            console.warn(`Saved file is too small (${st ? st.size : 'no stat'} bytes)`);
          }
        } catch (e) {
          isTooSmall = true;
          console.warn('Failed to stat screenshot file:', e.message || e);
        }

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

        if (!isTooSmall && !isMostlyBlack) {
          // Good capture: crop and write the cropped version
          const croppedPath = outPath.replace('.png', '_cropped.png');
          try {
            const width = (vp && vp.width) || 1920;
            const cropHeight = Math.min((vp && vp.height) || 1200, 1200);
            await sharp(outPath)
              .extract({ left: 0, top: 0, width: width, height: cropHeight })
              .toFile(croppedPath);
            console.log('Cropped:', croppedPath);
          } catch (e) {
            console.warn('Crop failed, leaving original:', e.message || e);
          }
          break; // success
        }

        // Not acceptable: retry if we have attempts left
        lastError = new Error(isTooSmall ? 'Captured image is too small' : 'Captured image is mostly black');
        console.warn(lastError.message + ', retrying...');
        await new Promise(res => setTimeout(res, 2000 * attempt));

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
