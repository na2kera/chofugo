// node packages/client/scripts/og.mjs http://localhost:19473 docs/mock/client
// Node 22 の fetch / WebSocket と手元の Chrome だけで撮影する。
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withChrome } from './cdp.mjs';

const [base, destination] = process.argv.slice(2);
if (!base || !destination || process.argv.length !== 4) {
  console.error('使い方: node packages/client/scripts/og.mjs <開発サーバーのURL> <出力先のフォルダ>');
  process.exit(1);
}
const baseUrl = new URL(base);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('HTTP(S) URL を指定してください');

await withChrome(baseUrl, async (send, checkInterrupted) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 315, deviceScaleFactor: 2, mobile: false });
  await mkdir(resolve(destination), { recursive: true });
  for (const variant of ['a', 'b', 'c']) {
    checkInterrupted();
    const url = new URL('/dev/og', baseUrl);
    url.searchParams.set('v', variant);
    const navigation = await send('Page.navigate', { url: url.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    // lazy import の描画と、その描画で要求されたフォントの読み込みの両方を待つ。
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      checkInterrupted();
      const check = await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-og="${variant}"]') !== null`, returnByValue: true,
      });
      if (check.result.value) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw new Error(`/dev/og?v=${variant} が描画されません（開発サーバーを指定してください）`);
    const fonts = await send('Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        if (!document.fonts.check('48px DotGothic16', '超富豪')) throw new Error('DotGothic16 が未ロード');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = document.querySelector('[data-og]').getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      })()`, awaitPromise: true, returnByValue: true,
    });
    if (fonts.exceptionDetails) throw new Error(JSON.stringify(fonts.exceptionDetails));
    const box = fonts.result.value;
    if (box.x !== 0 || box.y !== 0 || box.width !== 600 || box.height !== 315) throw new Error(`撮影枠が不正: ${JSON.stringify(box)}`);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: 600, height: 315, scale: 1 },
    });
    const png = Buffer.from(data, 'base64');
    if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) throw new Error('PNG が1200×630ではありません');
    const file = resolve(destination, `og-${variant}.png`);
    await writeFile(file, png);
    console.log(`${file} (1200×630)`);
  }
});
