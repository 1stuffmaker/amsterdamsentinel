const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  const outDir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    {
      url: 'https://amsterdamsentinel.grafana.net/public-dashboards/d93f8182bbf84d9f89bca0d105e8e230',
      filename: 'dashboard.png',
      viewport: { width: 1600, height: 900 }
    },
  ];

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process'
    ]
  });

  try {
    for (const t of targets) {
      const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 2000 });
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');

      console.log('Loading', t.url);
      await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 60000 });



      // Wacht langer zodat alles geladen is
      await new Promise(resolve => setTimeout(resolve, 5000));


      // Screenshot van dashboard plus footer
      const dashboard = await page.$('.css-efhoa4-body');
      const footer = await page.$('[data-testid="public-dashboard-footer"]');
      const outPath = path.join(outDir, t.filename);
      if (dashboard && footer) {
        // Bepaal bounding box van dashboard en footer
        const dbBox = await dashboard.boundingBox();
        const ftBox = await footer.boundingBox();
        if (dbBox && ftBox) {
          // Combineer beide boxen tot één screenshot
          const x = Math.min(dbBox.x, ftBox.x);
          const y = dbBox.y;
          const width = Math.max(dbBox.width, ftBox.width);
          const height = (ftBox.y + ftBox.height) - dbBox.y;
          await page.screenshot({ path: outPath, clip: { x, y, width, height } });
        } else {
          await dashboard.screenshot({ path: outPath });
        }
      } else if (dashboard) {
        await dashboard.screenshot({ path: outPath });
      } else {
        // fallback: hele pagina
        await page.screenshot({ path: outPath, fullPage: true });
      }
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
