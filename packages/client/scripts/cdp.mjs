import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function freePort(baseUrl) {
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

/** 起動した Chrome だけを終了し、失敗・中断時も一時プロファイルを回収する。 */
export async function withChrome(baseUrl, capture) {
  const port = await freePort(baseUrl);
  const profile = await mkdtemp(join(tmpdir(), 'chofugo-cdp-'));
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
    await capture(send, () => { if (interrupted) abort(); });
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
}
