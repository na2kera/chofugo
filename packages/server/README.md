# @chofugo/server

Cloudflare Worker と、ルームの Durable Object（`Room`）。設計は `docs/design.md` §4・§8.2、場面ごとの仮定は `docs/server-assumptions.md`。

## 必要なもの

- **Node.js 22.12 以上**（wrangler 4.162.0 の要件。Node 20 では wrangler が起動しない）
- `pnpm install` 済みであること

## 開発サーバー

```sh
pnpm --filter @chofugo/server dev          # http://localhost:8787
```

- `POST /api/rooms` → `201 { "roomId": "..." }`
- `GET /api/rooms/:roomId/ws` → WebSocket（メッセージの型は `src/protocol.ts`）

秒数を短くして手で試すときは、テスト用の機能を有効にして起動する（本番の `wrangler.jsonc` には入れない）。

```sh
pnpm --filter @chofugo/server exec wrangler dev --var CHOFUGO_TEST_MODE:1
curl -X POST localhost:8787/api/rooms -d '{"timing":{"turnMs":5000,"cpuDelayMs":200}}'
```

差し替えられる値は `src/timing.ts` の `Timing`（ミリ秒、10〜3,600,000）。

## 型チェック

```sh
pnpm --filter @chofugo/server typecheck    # wrangler types で worker-configuration.d.ts を作ってから tsc
```

## テスト

```sh
pnpm --filter @chofugo/server test
```

- `test/*.test.mjs` が、それぞれ自分の開発サーバー（`wrangler dev`、ポート 19480〜19489、インスペクターはその +10 の 19490〜19499、一時ディレクトリのストレージ。割り当ては `test/helpers.mjs` の `PORTS`）を起動し、本物の WebSocket で接続して確かめる。終わると開発サーバーを止める。`prod.test.mjs` だけはテスト用の機能を有効にせずに起動する。`origin.test.mjs` は Origin の比較の単体テスト。
- ファイルは1つずつ順に実行する（`vitest.config.mjs`）。全体で約100秒。
- その2の分：`custom.test.mjs`（設定の直し方、16種すべて ON の通しの試合、保存の形式の番号）、`choice.test.mjs`（7渡しの選択の時間切れ・CPU・代役、`give` の中身の見え方）。
- 通しの試合のテストは、最後に `POST /api/rooms/:id/test/check`（期限についての検査で見つかった問題の一覧、design-2 §3.4）が空であることを確かめる。
- テストのファイルは JavaScript で書いており、型チェックの対象外（`@types/node` を足していないため）。
