import { describe, expect, it } from 'vitest';

// client は @types/node を入れていない（tsconfig の types は vite/client だけ）ので、node:fs は動的に読み、
// 使う関数だけを型にする。テストは Node で動く（vitest.config.ts の environment: 'node'）。
interface NodeFs {
  existsSync(path: URL): boolean;
  readdirSync(path: URL): string[];
  readFileSync(path: URL): Uint8Array;
  readFileSync(path: URL, encoding: 'utf8'): string;
  statSync(path: URL): { isDirectory(): boolean };
}
const NODE_FS: string = 'node:fs';
const { existsSync, readdirSync, readFileSync, statSync } = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;

// 「ホーム画面に追加」のためのマニフェストとアイコン（scripts/favicon.mjs で書き出す）。
const CLIENT = new URL('../../', import.meta.url);
const PUBLIC = new URL('public/', CLIENT);
const SRC = new URL('src/', CLIENT);
const MANIFEST = 'manifest.webmanifest';

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(readFileSync(new URL(MANIFEST, PUBLIC), 'utf8')) as {
  name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons: Icon[];
};
const html = readFileSync(new URL('index.html', CLIENT), 'utf8');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG の IHDR から幅と高さを読む。 */
function pngSize(data: Uint8Array): { width: number; height: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = String.fromCharCode(...data.subarray(12, 16));
  if (type !== 'IHDR') throw new Error('IHDR が先頭にない');
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** src/ の下のファイルを全部（テストのファイルも含む）。 */
function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    return statSync(url).isDirectory() ? sourceFiles(new URL(`${name}/`, dir)) : [url];
  });
}

describe('ホーム画面に追加（マニフェスト）', () => {
  it('マニフェストに名前・開く場所・全画面の表示がある', () => {
    expect(manifest.name).toBe('超富豪');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('アイコンのファイルが public/ にあり、PNG で、大きさが sizes と合う', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      const file = new URL(icon.src.slice(1), PUBLIC);
      expect(existsSync(file), icon.src).toBe(true);
      const data = readFileSync(file);
      expect([...data.subarray(0, 8)], icon.src).toEqual(PNG_SIGNATURE);
      expect(icon.type).toBe('image/png');
      const { width, height } = pngSize(data);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it('192×192 と 512×512、丸抜き用（maskable）の 512×512 がある', () => {
    const has = (sizes: string, purpose: string) =>
      manifest.icons.some((x) => x.sizes === sizes && (x.purpose ?? 'any').split(/\s+/).includes(purpose));
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('index.html がマニフェストを指している', () => {
    const links = html.match(/<link\b[^>]*>/g) ?? [];
    const manifestLinks = links.filter((x) => /\brel="manifest"/.test(x));
    expect(manifestLinks).toHaveLength(1);
    expect(manifestLinks[0]).toContain(`href="/${MANIFEST}"`);
  });

  it('サービスワーカーは登録しない（index.html にも src/ にもない）', () => {
    const pattern = /serviceWorker\s*\.\s*register/;
    expect(pattern.test(html)).toBe(false);
    const self = new URL(import.meta.url).href;
    const hits = sourceFiles(SRC)
      .filter((url) => url.href !== self)
      .filter((url) => pattern.test(readFileSync(url, 'utf8')))
      .map((url) => url.pathname);
    expect(hits).toEqual([]);
  });
});
