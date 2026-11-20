// node packages/client/scripts/poster.mjs http://localhost:19473 docs/poster
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withChrome } from './cdp.mjs';

const [base, destination] = process.argv.slice(2);
if (!base || !destination || process.argv.length !== 4) {
  console.error('使い方: node packages/client/scripts/poster.mjs <開発サーバーのURL> <出力先のフォルダ>');
  process.exit(1);
}
const baseUrl = new URL(base);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('HTTP(S) URL を指定してください');

await withChrome(baseUrl, async (send, checkInterrupted) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1123, height: 794, deviceScaleFactor: 2, mobile: false });
  await mkdir(resolve(destination), { recursive: true });
  for (const variant of ['a', 'b', 'c', 'd']) {
    checkInterrupted();
    const url = new URL('/dev/poster', baseUrl);
    url.searchParams.set('v', variant);
    const navigation = await send('Page.navigate', { url: url.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      checkInterrupted();
      const check = await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-poster="${variant}"]') !== null`, returnByValue: true,
      });
      if (check.result.value) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error(`/dev/poster?v=${variant} が描画されません（開発サーバーを指定してください）`);
    const layout = await send('Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        if (!document.fonts.check('48px DotGothic16', '超富豪')) throw new Error('DotGothic16 が未ロード');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = document.querySelector('[data-poster]').getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      })()`, awaitPromise: true, returnByValue: true,
    });
    if (layout.exceptionDetails) throw new Error(JSON.stringify(layout.exceptionDetails));
    const box = layout.result.value;
    // 297×210mm の CSS 実寸（96dpi）。丸め誤差だけを許す。
    if (box.x !== 0 || box.y !== 0 || Math.abs(box.width - 297 * 96 / 25.4) > 0.1 || Math.abs(box.height - 210 * 96 / 25.4) > 0.1) {
      throw new Error(`撮影枠が不正: ${JSON.stringify(box)}`);
    }
    checkInterrupted();
    const printed = await send('Page.printToPDF', {
      landscape: true, paperWidth: 11.693, paperHeight: 8.268,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false,
    });
    const pdf = Buffer.from(printed.data, 'base64');
    const pages = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
    if (pages !== 1) throw new Error(`poster-${variant}.pdf が1ページではありません: ${pages}ページ`);
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { ...box, scale: 1 },
    });
    const png = Buffer.from(screenshot.data, 'base64');
    // mm の小数を Chrome が整数画素に丸めるため、最大1pxの差を許す。
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (Math.abs(width - box.width * 2) > 1 || Math.abs(height - box.height * 2) > 1) {
      throw new Error(`PNG の寸法が不正: ${width}×${height}`);
    }
    const prefix = resolve(destination, `poster-${variant}`);
    await writeFile(`${prefix}.pdf`, pdf);
    await writeFile(`${prefix}.png`, png);
    console.log(`${prefix}.pdf (1ページ), ${prefix}.png (${width}×${height})`);
  }
});
