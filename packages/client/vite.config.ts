import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 開発サーバー1つで、画面と Worker（Durable Object を含む）を動かす。
// Worker の設定は packages/server/wrangler.jsonc を使い、静的ファイルの経路だけここで足す。
// （wrangler.jsonc に assets を書くと、directory のない assets を server 単体の `wrangler dev` が拒否し、
//   server のテストが起動しなくなるため。directory はこのプラグインがビルドの出力先を入れる。）
//
// 公開先のドメインも、ビルドのときだけここで足す（独自ドメイン chofugo.na2kera.com）。
// wrangler.jsonc に routes を書くと、ローカルの wrangler dev がリクエストのホストを routes のものに読み替え、
// Origin の確認（server の origin.ts）がローカルで通らなくなる恐れがあるため、開発とテストには持ち込まない。
// routes を書くと workers.dev の URL は既定で止まるので、workers_dev: true で残す（前に配ったリンクのため）。
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      configPath: '../server/wrangler.jsonc',
      config: {
        assets: {
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        },
        ...(command === 'build'
          ? { routes: [{ pattern: 'chofugo.na2kera.com', custom_domain: true }], workers_dev: true }
          : {}),
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
}));
