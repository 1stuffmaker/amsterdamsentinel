/**
 * screenshot.js
 * - Visits each URL in `targets` and saves a screenshot to disk.
 * - Designed to be run in GitHub Actions runner.
 *
 * NOTE: Update the 'targets' array with your dashboard/panel URLs & filenames.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  const outDir = path.join(process.cwd(), 'public', 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Replace with the public Grafana dashboard / panel URLs you want to capture.
  // You can screenshot the full public dashboard page, or use panel-specific URLs (d-solo/...&panelId=...).
  const targets = [
    {
      url: 'https://amsterdamsentinel.grafana.net/public-dashboards/d93f8182bbf84d9f89bca0d105e8e230',
      filename: 'dashboard.png',
      viewport: { width: 1600, height: 900 }
    },
    // Example panel capture (uncomment + edit if you want single-panel images)
    // {
    //   url: 'https://amsterdamsentinel.grafana.net/d-solo/UID/slug?panelId=2&fullscreen&orgId=1',
    //   filename: 'panel_2.png',
    //   viewport: { width: 1000, height: 600 }
    // }
  ];

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
  });

  try {
    for (const t of targets) {
      console.log('Capturing', t.url);
      const page = await browser.newPage();
      await page.setViewport(t.viewport || { width: 1200, height: 800 });
      // optional: set user agent to avoid bot detection
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');

      // Navigate and wait until network is idle (adjust timeout/wait if needed)
      await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 60_000 });

      // Wait a moment more in case Grafana loads panels lazily
      await page.waitForTimeout(2000);

      // If you want to crop or target a specific selector (panel), use:
      // const el = await page.$('.panel-selector');
      // await el.screenshot({ path: path.join(outDir, t.filename) });

      // Otherwise capture viewport
      const outPath = path.join(outDir, t.filename);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log('Saved:', outPath);

      await page.close();
    }
  } catch (err) {
    console.error('Screenshot error', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
