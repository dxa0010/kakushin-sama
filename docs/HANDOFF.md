# 開発引き継ぎ資料（v8時点）

次にこのリポジトリを触るセッション（人間・AI問わず）向けの技術メモ。「なぜこうなっているか」を中心に書く。ゲーム企画・レベルデザインの詳細は `README.md` を参照。

- **更新日**: 2026年8月15日
- **公開URL**: https://dxa0010.github.io/kakushin-sama/
- **ブランチ**: `claude/artifact-review-anha8j`

## 1. リポジトリ構成と、そうなっている理由

```
index.html                 DOM/CSS/UI要素 + importmap + <script type="module">
src/game.js                ゲーム全体（three.jsシーン構築・物理・AI・UI制御）を1ファイルに集約
vendor/three/               Three.js r185 本体 + addons（postprocessing/loaders/environments等）
assets/textures/            実写テクスチャ（壁・床・布地。ambientCG CC0 + three.js examples MIT）
assets/models/               主要家具のglTFモデル（Poly Haven、CC0）
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

## 4. 家具のglTF化・洋室化（v8）

### 実施内容

- `src/game.js` に `GLTFLoader`（`vendor/three/addons/loaders/GLTFLoader.js`。同梱済みだったが今回初配線）をimportし、`loadModel(url, opts)` ヘルパーを追加（`vbox`/`vcyl` 定義の直後）。当たり判定は非同期ロードを待たず同期的に `solids.push()` する既存方式のまま（モデルの実寸は事前計測した固定値をハードコードして使っている）。
- 置換した7点：壁掛け時計（`wall_clock`）・本棚（`wooden_bookshelf_worn`）・テレビ（`Television_01`）・PCデスク（`metal_office_desk`）・椅子（`SchoolChair_01`）・タンス（`modern_wooden_cabinet`、新規追加家具）・ベッドフレーム（`old_bed_frame`）。すべてPoly Haven、CC0、`assets/models/<AssetID>/<AssetID>.gltf`（+ `.bin` + `textures/`）。
- **和室設定を廃止し洋室に統一**：ユーザー判断（「バイオハザード7のイメージを目指してる」路線と「和風家具はCC0が薄いので洋室化」の両方の指示）。畳（`M.tatami`、`tatami005`テクスチャ）とふすま（`M.fusuma`、`fusumaTex`プロシージャル）を削除し、床は全面フローリング（`M.floor`）に統一。押入れは「隠れ場所」としてのゲームロジック・当たり判定（`kind: "closet"`）はそのまま残し、**見た目だけ**ふすま2枚引き戸→白い開き戸に変更。表示テキストも「押入れ」→「クローゼット」に統一（`index.html` の `#hideOv` 文言、`src/game.js` の promptEl 分岐）。
- **壁掛け時計の実装方式変更**：旧実装はCanvas 2Dで文字盤・針を毎分再描画して`CanvasTexture`として貼っていた（`drawWallClock()`）。`wall_clock.gltf` は分針・時針・時針・文字盤が個別ノードに分かれている（`wall_clock_minute_hand` / `wall_clock_hours_hand` / `wall_clock` 等）ため、**針メッシュ自体を `rotation.z` で回転**させる方式に変更。`root.getObjectByName()` でロード完了後に針への参照を取得し、`drawWallClock(glitch)` は角度計算だけ行うようになった（関数名は据え置き、呼び出し側の `clockGlitch` 連動ロジックは変更なし）。回転軸が `rotation.z` で正しいことは実機スクリーンショットで確認済み。
- **色味の統一**：各glTFは出典（撮影条件）がバラバラなので、素材ごとに明度・彩度が食い違う。`tintModel(root, tint, roughBoost)` を追加し、`loadModel()` 呼び出し時に `tint`（0xRRGGBB、乗算）と `roughBoost`（roughnessへの加算）を指定して部屋の暗いウォームトーンへ寄せている。この関数内で `castShadow`/`receiveShadow` も一括設定している（下記「ハマった点」参照）。
- 本棚（`wooden_bookshelf_worn`）はモデル自体には本が含まれていないため、棚板の上に手続き型の本（`bookMats[]`、`vbox`のランダム配置ループ）を従来通り重ねている。本の色を明るく戻した（後述）。

### ハマった点

- **非同期ロードとシャドウ一括設定の順序**：既存コードは起動時に `scene.traverse(o => { o.castShadow = ... })` を1回だけ同期実行して全メッシュの影フラグを立てていた（`src/game.js` 内、モンスター生成直後）。glTFは `GLTFLoader.load()` が非同期なので、この一括処理より後に読み込まれたメッシュには影フラグが付かない。→ `tintModel()` 内で各メッシュに個別に `castShadow = true; receiveShadow = true;` を設定することで解決。
- **本の色が真っ黒に潰れる**：`bookMats[]` は元々プロシージャル本棚（明るいwoodDark材で照り返しがあった）向けに `offsetHSL(0, -0.22, -0.06)` で暗く調整されていた。実写PBR本棚（テクスチャ自体が焦げ茶色）に載せると暗すぎて潰れたため、`offsetHSL` 調整を外し彩度・明度を上げた色に変更（`src/game.js` の `bookMats` 定義）。
- **ソフトウェアレンダリングでのスクリーンショットが激重＋タイムアウトする**：glTF家具5〜7点を同時にシャドウキャスト対象として読み込むと、SwiftShaderでの `page.screenshot()` に1枚あたり最大14秒程度かかった（メインスレッド自体は固まっていない。`performance.now()` 経由の生存確認では応答している）。Playwrightのデフォルトタイムアウト（30秒）を超えるケースがあったため、動作確認時はscreenshotのtimeoutを60秒程度に緩めて対応した。実GPUでは問題にならない想定だが、実機FPS計測はまだ（既存TODO）。
- **カメラ向きの計算ミス**：`ply.yaw` の座標系は `dir = (-sin(yaw), -cos(yaw))`（`yaw=0` で -z方向）。動作確認用スクリプトで一度取り違えて時計や家具が画角外になる事故が複数回あった。次にワープ撮影する時はこの式を先に確認すること。

### Poly Havenからのモデル取得手順（メモ）

ローカル環境（クラウドサンドボックスと違いambientCG/Poly Havenに直接到達可能）から以下の手順で取得した：

```bash
# 1. アセット一覧・詳細確認
curl -s "https://api.polyhaven.com/assets?t=models" | jq 'keys'
curl -s "https://api.polyhaven.com/files/<AssetID>" | jq '.gltf["1k"]'

# 2. gltf本体 + bin + テクスチャ一式をダウンロード（.gltf内のuri参照とディレクトリ構造を一致させること）
#    d.gltf["1k"].gltf.url         … 本体.gltfのURL
#    d.gltf["1k"].gltf.include     … { "textures/xxx.jpg": {url}, "AssetID.bin": {url} } の辞書
```

`dimensions`フィールド（API上の `info` エンドポイント）は単位が不定で信用できないことがあった（例: `WoodenChair_01` が高さ22mと出た）。実際のバウンディングボックスは `.gltf` の `accessors[].min/max`（全meshの合算）から計算するか、Three.js側で `new THREE.Box3().setFromObject(model)` を使うのが確実。

## 5. 既知の未解決事項・次にやること（優先順）

1. **AO（アンビエントオクルージョン）**：`vendor/three/addons/postprocessing/GTAOPass.js` は同梱済みで未使用。接地感が大きく向上するはずだが、GPU負荷とのトレードオフを実機で見てから判断すべき。
2. **怪人「カクシン様」のモデル強化**：現状 `makeMonster()` はほぼ円柱＋Canvas顔テクスチャのまま（`src/game.js` 内で検索）。家具のglTF化が進んだ分、相対的に一番の粗になっている。`GLTFLoader`は今回配線済みなので `loadModel()` をそのまま流用できる。
3. **キッチン・押入れ枠のプロシージャル部分**：シンク・コンロ・押入れの箱部分はまだ手続き型ジオメトリのまま。優先度は家具本体より低いが、統一感を上げるならここも実写化の余地がある。
4. **`src/game.js` のファイル分割**：1700行超の単一ファイルなので、そろそろ `render.js` / `game-logic.js` / `content.js`（ANOMS・DOCSPECS等のデータ）くらいには割ってもいい規模。急ぎではない。
5. **フレームレート実測**：実機（ユーザーのPC）でのFPS計測がまだ。glTF家具の追加でシャドウマップ対象のメッシュ数が増えている（本棚10Kトライアングル等）ため、v7時点より重くなっている可能性がある。重ければ `bloomPass` の解像度を下げる、`shadow.mapSize` を1024→512に落とす、影を落とさない家具を増やす等の調整枠を用意すること。
6. **市役所END（未実装、README参照）**：グラフィックスと直接関係ないが、ゲーム内容側の積み残し。

## 6. デプロイ・運用メモ

- `main` ブランチはまだ存在しない（このリポジトリは `claude/artifact-review-anha8j` 一本で運用中）。`.github/workflows/deploy-pages.yml` は `main` と `claude/artifact-review-anha8j` の両方へのpushをトリガにしてある。
- GitHub Pages の有効化はリポジトリ設定で一度だけ手動操作が必要だった（`Settings → Pages → Source: GitHub Actions`）。これは完了済み。以後は自動。
- ワークフローの `actions/configure-pages@v5` は `enablement: true` を明示しないと、Pages未設定リポジトリでは "Get Pages site failed" で落ちる（ハマったポイント。修正済みだが、他プロジェクトに流用するときも要注意）。
