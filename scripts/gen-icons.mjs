// Generate PWA PNG icons from icon.svg using Playwright + Chromium
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'fs';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../public/icons');
const svgPath  = path.join(iconsDir, 'icon.svg');
const svgRaw   = readFileSync(svgPath, 'utf-8');

async function renderPng(size, outFile) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });

  const html = `<!DOCTYPE html><html><head>
    <style>*{margin:0;padding:0;background:transparent}</style>
  </head><body>
    ${svgRaw.replace('<svg ', `<svg width="${size}" height="${size}" `)}
  </body></html>`;

  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  writeFileSync(outFile, buf);
  await browser.close();
  console.log(`✅ ${outFile} (${size}×${size})`);
}

mkdirSync(iconsDir, { recursive: true });

await renderPng(512, path.join(iconsDir, 'icon-512.png'));
await renderPng(192, path.join(iconsDir, 'icon-192.png'));
await renderPng(32,  path.join(iconsDir, 'favicon.png'));

console.log('아이콘 생성 완료!');
