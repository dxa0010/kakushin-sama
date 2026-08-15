# 開発引き継ぎ資料（v7時点）

次にこのリポジトリを触るセッション（人間・AI問わず）向けの技術メモ。「なぜこうなっているか」を中心に書く。ゲーム企画・レベルデザインの詳細は `README.md` を参照。

- **更新日**: 2026年8月15日
- **公開URL**: https://dxa0010.github.io/kakushin-sama/
- **最新コミット**: `8d9ad52`（グラフィックス基盤刷新）
- **ブランチ**: `claude/artifact-review-anha8j`

## 1. リポジトリ構成と、そうなっている理由

```
index.html                 DOM/CSS/UI要素 + importmap + <script type="module">
src/game.js                ゲーム全体（three.jsシーン構築・物理・AI・UI制御）を1ファイルに集約
vendor/three/               Three.js r185 本体 + addons（postprocessing/loaders/environments等）
assets/textures/            実写テクスチャ（現状: 床材のみ）
.github/workflows/          GitHub Pages 自動デプロイ
docs/HANDOFF.md             このファイル
```

- 元は claude.ai のArtifact機能で書かれた**単一HTML**（Three.js本体もインライン同梱、約680KB）だった。Artifact環境はCDN・外部ファイル参照を許さないため、この形になっていた。
- このリポジトリに移す際、GitHub Pages配信ならその制約がないので `index.html` / `src/game.js` / `vendor/` に分割した。**ビルドツールは意図的に導入していない**（webpack/vite等なし）。importmapで `three` / `three/addons/` を解決するだけの素のES modules構成。GitHub Pagesにそのままpushで載る前提を優先した。
- `src/game.js` は依然として1ファイル約1700行。分割はまだしていない（後述「次にやること」参照）。

## 2. 今回（v7）やったこと・意思決定の理由

目標は「Three.jsでバイオハザード7ライクな絵をPCでヌルヌル動かす」。方針は以下の優先順位で組んだ：

1. ライティング（影・トーンマップ）→ 2. ポストプロセス → 3. PBRマテリアル → 4. 実写アセット → 5. ジオメトリ密度

理由：フォトグラメトリ資産を大量投入する前に、光と影とポスプロを直すほうがコスト対効果が圧倒的に高い（同じジオメトリでも別ゲームに見える）。

### 実施内容

- **Three.js r128 → r185**。r155以降ライトが物理単位（lm/cd）になったため、既存の `intensity` 値を `PT_SCALE = 34` で一括スケール変換して見た目を維持しつつ移行（`src/game.js` の `PT_SCALE` 定数と、ライト生成箇所の掛け算を参照）。
- 全ルームライト＋懐中電灯（SpotLight）に `castShadow = true`。`renderer.shadowMap.type = PCFSoftShadowMap`。
- **ハマった点1**: 照明器具のシェード（`vcyl` で作った円柱）が光源を覆っていて、天井に多角形の影を落とす描画バグが出た。`userData.noShadow = true` を立てて、シーン一括の `castShadow` 設定ロジック（`scene.traverse` している箇所）でそれを尊重するようにして解決。
- **ハマった点2**: 懐中電灯を壁に近づけると白飛びした。SpotLightの `intensity` を下げ、`angle` を広げて`penumbra`を上げて解決（物理単位移行後の値なので、今後光量を触るときは他の光源との相対バランスに注意）。
- **ACESFilmicToneMapping** + `toneMappingExposure = 1.25`。
- ポストプロセス（`EffectComposer`）：`RenderPass → UnrealBloomPass → OutputPass → ShaderPass(自作FilmShader)`。自作シェーダーで色収差・ビネット・フィルムグレインを一括処理（`FilmShader` を参照。既存のthree.js addonsの `FilmPass`/`VignetteShader` は使わず、1パスにまとめて軽量化した）。
- 全マテリアルを `MeshLambertMaterial`/`MeshPhongMaterial` → `MeshStandardMaterial` に置換。プロシージャルCanvasテクスチャの輝度勾配から法線マップを自動生成する `normalFromTex()` を追加（Sobelっぽい簡易実装。CPU側でCanvasを読んで1回だけ計算し、Textureとしてキャッシュ）。
- `RoomEnvironment` を使った弱いIBL（`scene.environmentIntensity = 0.12`）で金属・光沢面に環境反射を持たせた。
- 床材のみ実写テクスチャに置換（後述「外部アセットの制約」）。

### 検証方法

このサンドボックス環境にはブラウザGUIがないため、`playwright-core` + プリインストール済みChromium（`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、`--use-angle=swiftshader`でソフトウェアレンダリング）でヘッドレス実行し、スクリーンショットで目視確認した。`window.__dbg`（`src/game.js` 末尾でグローバル公開しているデバッグフック）でプレイヤー座標をワープさせて各部屋を確認している。同じ手順は次のセッションでも使える：

```bash
python3 -m http.server 8765   # リポジトリルートで
# 別途 playwright-core を node_modules に持つディレクトリから:
# chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
#   args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
```

**注意**: これはソフトウェアラスタライザでの確認であり、実GPU上の見た目・フレームレートは未検証。ユーザーの実機での確認待ちの状態でこの引き継ぎ資料を書いている。

## 3. 外部アセットの制約（重要）

- クラウドのサンドボックス実行環境のネットワークポリシーでは **ambientCG / Poly Haven に直接到達できない**（`curl`が0バイト/タイムアウトで失敗する）。CC0のPBRテクスチャセットを使う方針自体は生きているが、そちらの環境では取得できない。
- **`raw.githubusercontent.com` は到達可能**。そのため床材は three.js公式リポジトリの `examples/textures/hardwood2_*.jpg`（MITライセンス）を使った。`assets/textures/hardwood2_{diffuse,bump,roughness}.jpg` として保存済み。
- **壁・畳・布のPBR化は完了済み**（2026-08-15、ローカル環境でambientCGへ直接到達して取得）。採用素材：
  - 壁 → `PaintedPlaster017`（無地グレーの漆喰、微細なひび。廃墟感の強い候補〈PaintedPlaster007/009/014〉は「まだ人が住んでいる普通の家」という世界観に合わないため除外）
  - 畳 → `Tatami005`（畳縁の格子まで含む実写）
  - 布 → `Fabric001`（無地リネン/コットン、しわ感あり。布団・座布団・カーテン等 `M.fabric` 全用途に使用）
  - いずれも ambientCG（CC0）。2Kソースをplaywright+Chromium(Canvas)でリサイズ・再圧縮し、`assets/textures/{plaster017,tatami005,fabric001}_{diffuse,normal,roughness}.jpg` として1024px・JPEG品質0.8〜0.85で保存（合計約1.8MB）。`normalMap`はNormalGL版（three.jsはOpenGL規約）。
  - `src/game.js` に `loadPBRSet(baseName, rx, ry)` ヘルパーを追加し、`M.wall` / `M.tatami` / `M.fabric` で使用。対応する旧プロシージャル定義（`wallTex`/`tatamiTex`/`fabricTex`、および `normalFromTex()` 呼び出し）は削除済み。`woodTex`/`ceilTex`/`fusumaTex`等、他のプロシージャルテクスチャは変更なし。

## 4. 既知の未解決事項・次にやること（優先順）

1. **AO（アンビエントオクルージョン）**：`vendor/three/addons/postprocessing/GTAOPass.js` は同梱済みで未使用。接地感が大きく向上するはずだが、GPU負荷とのトレードオフを実機で見てから判断すべき。
2. **怪人「カクシン様」のモデル強化**：現状 `makeMonster()` はほぼ円柱＋Canvas顔テクスチャのまま（`src/game.js` 内で検索）。部屋の質感が上がった分、相対的に一番の粗になっている。glTFモデル差し替え候補（`vendor/three/addons/loaders/GLTFLoader.js` は同梱済み、未配線）。
3. **`src/game.js` のファイル分割**：1700行の単一ファイルなので、そろそろ `render.js` / `game-logic.js` / `content.js`（ANOMS・DOCSPECS等のデータ）くらいには割ってもいい規模。急ぎではない。
4. **フレームレート実測**：実機（ユーザーのPC）でのFPS計測がまだ。重ければ `bloomPass` の解像度を下げる、`shadow.mapSize` を1024→512に落とす等の調整枠を用意すること。
5. **市役所END（未実装、README参照）**：グラフィックスと直接関係ないが、ゲーム内容側の積み残し。

## 5. デプロイ・運用メモ

- `main` ブランチはまだ存在しない（このリポジトリは `claude/artifact-review-anha8j` 一本で運用中）。`.github/workflows/deploy-pages.yml` は `main` と `claude/artifact-review-anha8j` の両方へのpushをトリガにしてある。
- GitHub Pages の有効化はリポジトリ設定で一度だけ手動操作が必要だった（`Settings → Pages → Source: GitHub Actions`）。これは完了済み。以後は自動。
- ワークフローの `actions/configure-pages@v5` は `enablement: true` を明示しないと、Pages未設定リポジトリでは "Get Pages site failed" で落ちる（ハマったポイント。修正済みだが、他プロジェクトに流用するときも要注意）。
