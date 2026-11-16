// テストだけで使う実行環境の型（engine は @types/node を持たないので、使う分だけ宣言する）。
// engine の本体（テスト以外）はこれらに触れない。

declare const process: { env: Record<string, string | undefined> };

interface ImportMeta {
  /** vite / vitest のファイルの読み込み（compat.test.ts が記録を読むのに使う）。 */
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
