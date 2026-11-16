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
| `--mode` | ボットがホストのときのモード（`daifugo`・`custom`） | ルームの設定のまま |
| `--rules` | ボットがホストのときのルール。`all` はそのモードで選べるすべて、または `flush_on_8,give_on_7` のような ID の列 | ルームの設定のまま |

ボットがホストになったときは、人が `--start-when` 人そろったら試合を始め、ゲームの結果では次のゲームを配る。試合の結果に着いたら終わる。
7渡し・10捨ての選択では、手札からでたらめに 0〜上限枚を選ぶ。試合の結果に着いたら、モード・ルールと、その2の出来事（激縛り・9リバース・選択・渡す・捨てる・K スキップ・4止めなど）の回数を表示する。

```sh
node scripts/bots.mjs --count 4 --delay 30 --mode custom --rules all   # カスタム・16種すべて ON の試合
```

同じ機械で別のプロジェクトが 5173 番を使っているときは、開発サーバーを別のポートで起動して `--base` で渡す（例：`node node_modules/vite/bin/vite.js --port 19470 --strictPort` と `--base http://localhost:19470`）。

### 見本ページ（開発のときだけ）

`http://localhost:5173/dev/gallery` に、固定のデータで各画面を描く見本がある（ホーム、名前の入力、ロビー、交換、対戦の各場面、結果。その2の分：カスタムのロビー、7渡し・10捨ての選択、4止めの返し、札が5つ出ている場、ダイヤの3の最初の1手、7渡しで受け取ったカード、10捨てを含む履歴、16種のルール一覧）。`?s=<場面>` で1つだけ描く。
`&vw=390&vh=800` を付けると画面の枠をその大きさに固定する（幅500px未満にできないヘッドレス Chrome で撮るため）。本番のビルドには含まれない。

## テスト・型チェック・ビルド

```sh
pnpm --filter @chofugo/client test        # 手の選び方・交換・7渡し/10捨て・4止め・残り時間・出来事・受け取ったカードの強調・つなぎ直し・送信中などの関数のテスト
pnpm --filter @chofugo/client typecheck
pnpm --filter @chofugo/client build       # dist/client（画面）と dist/chofugo（Worker）を作る
```

## デプロイ

```sh
pnpm run deploy     # ルートから（`pnpm deploy` は pnpm の組み込みコマンドなので `run` を付ける）。client をビルドしてから、ビルドの出力の設定で wrangler deploy
```

- 必ず client のビルドの出力（`vite build` が作る `dist/chofugo/wrangler.json`）でデプロイする。`packages/server` で `wrangler deploy` を実行すると、画面の静的ファイルが含まれない。
- デプロイには Cloudflare へのログイン（`wrangler login`）が必要。
- 公開先：`https://chofugo.na2kera.workers.dev`（Worker の名前は `chofugo`）。公開先でボットを動かすときは `node scripts/bots.mjs --base https://chofugo.na2kera.workers.dev --count 3`。

## 素材

- フォント：DotGothic16（`public/fonts/`、SIL Open Font License 1.1。全文は `public/fonts/OFL.txt`）。
- ドット絵：`src/pixel/patterns.ts`（数字・マーク・ジョーカー・王冠・矢印・カードの裏の模様）。枠は `src/pixel/frames.ts` で見本と同じ方法（点の並び → SVG）で作る。
