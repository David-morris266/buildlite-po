const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<html><body><h1>Hello PDF</h1></body></html>', { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  require('fs').writeFileSync('smoketest.pdf', pdf);
  console.log('Wrote smoketest.pdf');
})().catch(err => { console.error('SMOKETEST ERROR:', err); process.exit(1); });
