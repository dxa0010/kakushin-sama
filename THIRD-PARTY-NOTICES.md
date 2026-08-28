# サードパーティ・ライセンス表示

本作には以下の第三者著作物が含まれています。各ライセンスの条件に従って再配布しています。
**アセットを追加・差し替えたときは、このファイルも必ず更新すること**（MITライセンスは
著作権表示の保持が再配布の条件なので、表示を欠くとライセンス違反になります）。

---

## Three.js（および同梱の addons）

- **配置**: `vendor/three/`
- **著作権**: Copyright © 2010-2026 three.js authors
- **ライセンス**: MIT License
- **入手元**: https://github.com/mrdoob/three.js
- **ライセンス全文**: `vendor/three/LICENSE`

MIT License の全文は上記ファイルに同梱しています。`postprocessing/`、`geometries/`、
`environments/` 配下の addons も同一ライセンスです。

---

## テクスチャ

### three.js examples 由来（MIT License）

| ファイル | 用途 |
|---|---|
| `assets/textures/hardwood2_diffuse.jpg` | 床（フローリング） |
| `assets/textures/hardwood2_bump.jpg` | 床のバンプ |
| `assets/textures/hardwood2_roughness.jpg` | （現在は未使用。v10で意図的に外した） |

- **著作権**: Copyright © 2010-2026 three.js authors
- **ライセンス**: MIT License（`vendor/three/LICENSE` と同一）
- **入手元**: https://github.com/mrdoob/three.js `examples/textures/`

### ambientCG 由来（CC0 1.0 / パブリックドメイン）

| ベース名 | 用途 |
|---|---|
| `plaster017` | 壁（漆喰） |
| `tatami005` | 畳（v8の洋室化により現在は未使用） |
| `fabric001` | 布地全般（布団・座布団・カーテン） |
| `fabric049` | 布地（追加分） |
| `leather030` | 革 |
| `cardboard001` | 段ボール |
| `metal063` | 金属 |
| `concrete034` | コンクリート |
| `plastic011` | プラスチック |

各セットは `_diffuse` / `_normal` / `_roughness` の3枚組で `assets/textures/` に配置。
2Kのオリジナルを1024pxへリサイズし、JPEG品質0.8〜0.85で再圧縮しています。
法線マップは OpenGL 規約（NormalGL）版を使用（three.js の規約に合わせるため）。

- **ライセンス**: CC0 1.0 Universal（パブリックドメイン提供）
- **入手元**: https://ambientcg.com/
- **表示義務**: CC0 に帰属表示の義務はありませんが、出典を明確にするため記載しています。

---

## 同梱フォント（Noto / SIL Open Font License 1.1）

`assets/fonts/*.woff2` は Google Fonts の Noto シリーズを、本作が表示する文字だけに
**サブセット**したものです。Proton / Steam Deck の Wine には日本語・中国語フォントが
無いのが既定で、同梱しないと実機で全文が豆腐（□）になります。

| ファイル | 元フォント | 用途 |
|---|---|---|
| `kakushin-sans-jp.woff2` | Noto Sans JP | UI・項目名（ja / en / ru / es） |
| `kakushin-serif-jp.woff2` | Noto Serif JP | タイトル・書類の題字（ja / en / ru / es） |
| `kakushin-sans-sc.woff2` | Noto Sans SC | UI・項目名（zh-Hans） |
| `kakushin-serif-sc.woff2` | Noto Serif SC | タイトル・書類の題字（zh-Hans） |
| `kakushin-mono.woff2` | Noto Sans Mono | 金額・日付・暗証番号 |
| `kakushin-fallback-1.woff2` | Noto Sans SC | 穴埋め（`简`。日本語フォントに無い） |
| `kakushin-fallback-2.woff2` | Noto Sans Mono | 穴埋め（`₽`。CJK 系フォントに一切無い） |

- **著作権表示**: Copyright © The Noto Project Authors (https://github.com/notofonts)
- **ライセンス**: SIL Open Font License, Version 1.1
- **ライセンス全文**: `assets/fonts/OFL.txt`（同梱済み。**再配布の条件**）
- **入手元**: https://github.com/google/fonts
- **改変について**: サブセットは OFL 上の「Modified Version」にあたります。
  OFL 1.1 は Reserved Font Name の付いた名前を改変版に使うことを禁じているため、
  ファミリ名から `Noto` を外し `Kakushin Sans` / `Kakushin Serif` / `Kakushin Mono`
  に改名しています。**元の名前に戻さないこと。**
- **再生成**: `node tools/charset.mjs && node tools/make-fonts.mjs`
  （開発機のみ。`python -m pip install fonttools brotli` と元フォントが要ります。
  生成物をコミットするので、配信時には何も実行しません。）

**ゲーム内クレジット（`index.html` の `#credits`）と内容を一致させること。**
Steam 配布は再配布にあたるため、片方だけ直すと表示義務を満たしません。

---

## 本作自身の著作物について

上記以外のソースコード（`src/game.js`、`index.html`）、および
プロシージャル生成しているテクスチャ・ジオメトリ（家具、壁掛け時計、夜景、
書類、怪人「カクシン様」等）はすべて本プロジェクトのオリジナルです。

**リポジトリにオープンソースライセンス（MIT等）は意図的に置いていません。**
商用化を想定しているため、既定の著作権（無断利用不可）のままにしてあります。
うっかり `LICENSE` に MIT を置くと第三者がフォークして再販できてしまうので、
**公開リポジトリだからといって安易にライセンスファイルを追加しないこと。**
