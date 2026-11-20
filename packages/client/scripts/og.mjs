// node packages/client/scripts/og.mjs http://localhost:19473 docs/mock/client
// Node 22 の fetch / WebSocket と手元の Chrome だけで撮影する。
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, destination] = process.argv.slice(2);
if (!base || !destination || process.argv.length !== 4) {
  console.error('使い方: node packages/client/scripts/og.mjs <開発サーバーのURL> <出力先のフォルダ>');
  process.exit(1);
}
const baseUrl = new URL(base);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('HTTP(S) URL を指定してください');

async function freePort() {
  for (const port of [19476, 19477, 19478, 19479, 19470, 19471, 19472, 19474, 19475, 19473]) {
    if (port === Number(baseUrl.port)) continue;
    const server = createServer();
    const available = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('19470〜19479 に空き CDP ポートがありません');
}

function connect(socket) {
  let nextId = 0;
  const pending = new Map();
  function failAll(error) {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  }
  socket.addEventListener('close', () => failAll(new Error('CDP が切断されました')));
  socket.addEventListener('error', () => failAll(new Error('CDP WebSocket エラー')));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const port = await freePort();
const profile = await mkdtemp(join(tmpdir(), 'chofugo-og-'));
let chrome;
let closed;
let socket;
let stopped = false;
let startupError;
let stderr = '';
const abort = () => { throw new Error('撮影を中断しました'); };
// シグナルでも finally の後始末へ進む。
let interrupted = false;
const interrupt = () => { interrupted = true; socket?.close(); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  closed = new Promise((resolve) => chrome.once('close', () => { stopped = true; resolve(); }));
  chrome.once('error', (error) => { startupError = error; });
  chrome.stderr.on('data', (data) => { stderr = (stderr + data).slice(-4000); });
  console.log(`Chrome PID=${chrome.pid}, CDP=${port}, profile=${profile}`);
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (interrupted) abort();
    if (startupError || stopped) throw startupError ?? new Error(`Chrome が終了しました: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      target = (await response.json()).find((item) => item.type === 'page');
      if (target) break;
    } catch { /* 起動を待つ。 */ }
    await delay(100);
  }
  if (!target) throw new Error(`Chrome の CDP に接続できません: ${stderr}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([once(socket, 'open'), delay(10_000).then(() => { throw new Error('WebSocket 接続 timeout'); })]);
  const send = connect(socket);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 315, deviceScaleFactor: 2, mobile: false });
  await mkdir(resolve(destination), { recursive: true });
  for (const variant of ['a', 'b', 'c']) {
    if (interrupted) abort();
    const url = new URL('/dev/og', baseUrl);
    url.searchParams.set('v', variant);
    const navigation = await send('Page.navigate', { url: url.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    // lazy import の描画と、その描画で要求されたフォントの読み込みの両方を待つ。
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (interrupted) abort();
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
} finally {
  socket?.close();
  if (chrome?.pid && !stopped) {
    chrome.kill('SIGTERM');
    await Promise.race([closed, delay(3000)]);
    if (!stopped) { chrome.kill('SIGKILL'); await closed; }
  }
  await rm(profile, { recursive: true, force: true });
  console.log(`後始末: Chrome PID=${chrome?.pid ?? '起動失敗'} 終了、一時フォルダ削除: ${profile}`);
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
