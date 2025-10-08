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


      // Screenshot van de volledige dashboard wrapper (dashboard + footer, geen extra zwart)
      const wrapper = await page.$('.css-1u1o2gi-page-wrapper');
      const outPath = path.join(outDir, t.filename);

      if (wrapper) {
        await wrapper.screenshot({ path: outPath });
      } else {
        // fallback: hele pagina
        await page.screenshot({ path: outPath, fullPage: true });
      }
      console.log('Saved:', outPath);

      // Crop de screenshot tot een hoogte van 1200px
      const croppedPath = outPath.replace('.png', '_cropped.png');
      await sharp(outPath)
        .extract({ left: 0, top: 0, width: 1920, height: 1200 })
        .toFile(croppedPath);
      console.log('Cropped:', croppedPath);

      await page.close();
    }
  } catch (err) {
    console.error('Screenshot error', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
