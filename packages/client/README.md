# @chofugo/client

超富豪の画面（React + Vite）。設計は `docs/design-client.md`、場面ごとの仮定は `docs/client-assumptions.md`。

## 必要なもの

- Node.js 22.13.1（ルートの `package.json` の Volta と `pnpm-workspace.yaml` で固定）
- `pnpm install` 済みであること

## 開発サーバー

```sh
pnpm dev            # ルートから。http://localhost:5173
```

- Vite の開発サーバー1つで、画面と Worker（`packages/server` の Durable Object を含む）を動かす。
- Worker の設定は `packages/server/wrangler.jsonc` を使い、静的ファイルの経路（`/api/*` だけ Worker、それ以外は画面、存在しないパスは `index.html`）は `vite.config.ts` の Cloudflare プラグインの `config` で足している。
  `wrangler.jsonc` に `assets` を書くと、`directory` のない `assets` を server 単体の `wrangler dev`（server のテスト）が拒否するため。
- ストレージは `packages/client/.wrangler/` に残る（ルームは開発サーバーを止めても消えない）。

### 4つのタブで4席を開く

URL に `?p=1`〜`?p=4` を付けると、本人確認の値と名前の保存先が別々になる。同じブラウザの4つのタブで、それぞれ別の席として参加できる。

```
http://localhost:5173/r/<ルームID>?p=1
http://localhost:5173/r/<ルームID>?p=2
...
```

### 席を自動で埋める（ボット）

開発サーバーに WebSocket でつなぎ、出せる手からでたらめに選んで操作する。

```sh
cd packages/client
node scripts/bots.mjs --room <ルームID>              # 3席を埋める（自分はブラウザで1席）
node scripts/bots.mjs --count 4 --delay 50           # ルームを作って4席ともボットで1試合
```

| 引数 | 意味 | 初期値 |
|---|---|---|
| `--room` | 入るルーム。なければ作って URL を表示する | なし |
| `--count` | ボットの数 | 3 |
| `--delay` | 操作までの間（ミリ秒） | 400 |
| `--games` | ボットがホストのときのゲーム数（`0` は無制限） | 5 |
| `--start-when` | ボットがホストのとき、人が何人そろったら始めるか（残りは CPU） | 4 |
| `--rematch` | 試合の結果で「もう一度」を続ける | しない |
| `--quiet` | 途中の表示を出さない | 出す |
| `--base` | 開発サーバーの URL | `http://localhost:5173` |

ボットがホストになったときは、人が `--start-when` 人そろったら試合を始め、ゲームの結果では次のゲームを配る。試合の結果に着いたら終わる。

### 見本ページ（開発のときだけ）

`http://localhost:5173/dev/gallery` に、固定のデータで各画面を描く見本がある（ホーム、名前の入力、ロビー、交換、対戦の各場面、結果）。`?s=<場面>` で1つだけ描く。
`&vw=390&vh=800` を付けると画面の枠をその大きさに固定する（幅500px未満にできないヘッドレス Chrome で撮るため）。本番のビルドには含まれない。

## テスト・型チェック・ビルド

```sh
pnpm --filter @chofugo/client test        # 手の選び方・交換・残り時間・出来事・つなぎ直し・送信中などの関数のテスト
pnpm --filter @chofugo/client typecheck
pnpm --filter @chofugo/client build       # dist/client（画面）と dist/chofugo（Worker）を作る
```

## デプロイ

```sh
pnpm deploy         # ルートから。client をビルドしてから、ビルドの出力の設定で wrangler deploy
```

- 必ず client のビルドの出力（`vite build` が作る `dist/chofugo/wrangler.json`）でデプロイする。`packages/server` で `wrangler deploy` を実行すると、画面の静的ファイルが含まれない。
- デプロイには Cloudflare へのログイン（`wrangler login`）が必要。

## 素材

- フォント：DotGothic16（`public/fonts/`、SIL Open Font License 1.1。全文は `public/fonts/OFL.txt`）。
- ドット絵：`src/pixel/patterns.ts`（数字・マーク・ジョーカー・王冠・矢印・カードの裏の模様）。枠は `src/pixel/frames.ts` で見本と同じ方法（点の並び → SVG）で作る。
