# 開発引き継ぎ資料（v8時点）

次にこのリポジトリを触るセッション（人間・AI問わず）向けの技術メモ。「なぜこうなっているか」を中心に書く。ゲーム企画・レベルデザインの詳細は `README.md` を参照。

- **更新日**: 2026年8月15日
- **公開URL**: https://dxa0010.github.io/kakushin-sama/
- **ブランチ**: `claude/artifact-review-anha8j`

## 1. リポジトリ構成と、そうなっている理由

```
index.html                 DOM/CSS/UI要素 + importmap + <script type="module">
src/game.js                ゲーム全体（three.jsシーン構築・物理・AI・UI制御）を1ファイルに集約
vendor/three/               Three.js r185 本体 + addons（postprocessing/geometries/environments等）
assets/textures/            実写テクスチャ（壁・床・布地。ambientCG CC0 + three.js examples MIT）
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

## 4. 家具の高精細プロシージャル化・洋室化（v8）

### 方針転換の経緯（重要）

最初は主要家具を外部のCC0 glTFモデル（Poly Haven）に置換する方向で進めた（`GLTFLoader` + `loadModel()` + `tintModel()`）。しかし**出典（作者・年代・様式）がバラバラなモデルは、色ティントを揃えても統一感が出なかった**——錆びた病院ベッド・学校の椅子・70年代CRT・北欧キャビネット・オフィスデスクが同じ部屋に並ぶちぐはぐさは、明度・彩度の調整では消せなかった。ユーザーの「現状統一感がなく、いろいろうまくいっていない。自作は？」「最低3段は細かく。自作でやってみましょう」という判断を受け、**全家具を自作の高精細プロシージャル・ジオメトリに切り替え、単一マテリアルパレットで統一**した。外部glTFモデルとローダー配線・`tintModel`・`loadModel` は全廃し、`assets/models/` ディレクトリも削除済み。

### 実施内容

- **統一マテリアルパレット**（`src/game.js` の `M` に追加）：`oak`（ライトオーク、主材）・`oakDark`（濃いオーク、縁・脚）・`steel`（黒スチール脚、量産家具の定番）・`melamine`（白メラミン化粧板）・`mattress`（生成りの寝具）。既存の `M.wood`/`M.dark`/`M.metal`/`M.fabric` も併用。色味はこのパレットに閉じることで統一される。
- **高精細ヘルパー3種**（`vbox`/`vcyl` の直後）：
  - `rbox(w,h,d,mat,x,y,z,ry,r,seg)` … `RoundedBoxGeometry`（`vendor/three/addons/geometries/RoundedBoxGeometry.js`、r185からMITで取得）による**面取りボックス**。素の `BoxGeometry` との一番の差はエッジの角丸で、これがv6比の「作り込み感」の主因。
  - `tleg(rt,rb,h,mat,x,y,z)` … 下がわずかに細い**テーパー丸脚**（`CylinderGeometry`）。
  - `drawer(w,h,mat,x,y,z,knobMat)` … 本体からわずかに浮かせた**引き出し前板**＋円筒ノブ。
- **作り込んだ家具9点**（すべて `src/game.js` の「家具」ブロック内）。v6の素のBoxGeometryから最低3段のディテール追加（面取り・脚の造形・取っ手）を目標にした：
  - **ベッド**：4本の黒スチールテーパー脚＋オークのフレーム＋すのこ天端＋ヘッドボード＋笠木。寝具は角丸の `mattress` マットレス＋2枚重ねの掛け布団（ずれ・めくれ）＋床側へ垂れるフラップ＋斜めの枕。
  - **キッチン**：白メラミンの本体＋台輪（蹴込み）＋ステンレス天板（`rbox`）＋前面4扉（目地の影＋縦バー取っ手）＋シンク凹み＋縁＋蛇口（立ち上がり＋`TorusGeometry`の曲がり首＋吐水口＋レバー）＋2口コンロ（バーナーリング`TorusGeometry`＋4本スポークの五徳＋前面ツマミ）。
  - **タンス**：オーク3段チェスト。黒スチール短脚＋張り出した天板＋3段引き出し（各2連ノブ）＋天板上の目覚まし時計・畳んだ布。
  - **ローテーブル**：角丸天板＋下段棚＋テーパー脚＋幕板。上にカップ麺・空き缶・リモコン、下に円形ラグ。
  - **TVボード＋薄型テレビ**：オークのローボード（天板張り出し・引き出し2連・短スチール脚）＋薄型TV（スタンド＋黒枠背面パネル＋発光画面）。画面は `M.tv`（下記参照）。
  - **PCデスク＋オフィスチェア**：オーク天板＋黒スチール角脚＋貫。モニタ（スタンド＋角丸ベゼル＋発光面）＋キーボード＋マウス＋マグカップ＋散乱書類。椅子は角丸座面＋背もたれ（少し倒す）＋ガスシリンダー＋5本脚キャスター。
  - **本棚**：オークのオープンシェルフ（側板・天地・背板・棚板4枚）。棚板の載る面 `yb = 0.1 + s*0.5` に合わせて枠を作ってあるので、既存の本配置ループ（`bookMats[]` のランダム`vbox`）がそのまま棚の上に載る。
  - **壁掛け時計**：下記参照。
- **和室設定を廃止し洋室に統一**：畳（`M.tatami`）とふすま（`M.fusuma`）は既にv8序盤で削除済み。床は全面フローリング（`M.floor`）。押入れは「隠れ場所」ロジック・当たり判定（`kind: "closet"`）はそのまま、見た目だけ白い開き戸に変更。表示テキストも「押入れ」→「クローゼット」に統一（`index.html` の `#hideOv` 文言、操作説明）。
- **壁掛け時計（全プロシージャル）**：文字盤（`CircleGeometry`）・ベゼル（`TorusGeometry`）・12本の目盛り（12/3/6/9は太く）・時針/分針/中央キャップをすべて手続き生成。針は**根元を支点に回すため、`BoxGeometry` を先端側へ `geo.translate(0, len/2 - wid, 0)` でずらしてから `Group` に入れ、グループごと `rotation.z` で回転**させる（ジオメトリ中心で回すと針が中心軸で振れてしまうため）。12時位置（+Y）を0とし、時計回り＝`-Z`回転。`drawWallClock(glitch)` は角度計算だけを行い、`clockGlitch` 連動（前触れ時のランダム化）ロジックは従来のまま。`clockHands.minute/hour` は今回 `getObjectByName` ではなく自作した `Group` を直接保持する。

### ハマった点

- **`loadModel` の消し残し**：glTFローダーとヘルパー（`GLTFLoader` import・`loadModel`・`tintModel`）を先に削除したのに、呼び出し側6箇所（タンス・TV・デスク・椅子・本棚・時計）が残っていた。`loadModel is not defined` でモジュール評価が即死し、以降のシーン構築が全て止まる。プロシージャル置換後に `grep loadModel src/game.js` が0件になることを必ず確認すること。
- **TV画面の発光は共有マテリアル `M.tv`**：TVの前触れ・本番演出は `M.tv.emissive.setHex(...)` でマテリアル単位に発光を切り替えている（`src/game.js` 内の `visit.omen === "tv"` 分岐、`flags.tvDone` 分岐）。薄型TVの画面メッシュは必ず `M.tv` を使うこと（別マテリアルにすると光らなくなる）。
- **針の回転支点**：上記の通り、針メッシュはジオメトリを先端方向へオフセットしてから `Group` を回す。これを忘れると針が中央で回転して盤面から飛び出す。
- **カメラ向きの計算**：`ply.yaw` の座標系は `dir = (-sin(yaw), -cos(yaw))`（`yaw=0` で -z方向）。ワープ撮影スクリプトでは視点→対象から `yaw = atan2(-dx, -dz)`、`pitch = asin((ty-1.6)/dist)` で算出する。過去に取り違えて対象が画角外になる事故が複数回あったので、撮影前にこの式を確認すること。
- **ソフトウェアレンダリングのスクリーンショットが重い**：`page.screenshot()` はSwiftShaderで数秒〜十数秒かかる。timeoutは60秒程度に緩めておく。実GPUのFPSは未計測（既存TODO）。

### 家具の追加・調整のしかた（次にやる人向け）

- 新しい家具は「家具」ブロック内に `{ ... }` スコープで足す。当たり判定は視覚ジオメトリと独立に `solids.push({x1,z1,x2,z2})` で登録する（描画とAABBがズレても許容範囲。プレイに効くのはAABBの方）。
- 面取りは `rbox` の `r`（角丸半径）と `seg`（分割数）で調整。小物は `r` を小さく・`seg` を2に落として軽量化している。
- 収集アイテムは光るマーカー（`makeGlow`、`it.y + 0.35` に浮く）なので、家具の座標を多少動かしてもアイテムの発見性には影響しない。ただしアイテムが家具の内部に完全に埋まると見栄えが悪いので、`ITEMS[]` の座標と家具の位置関係は目視で確認すること。

## 5. 既知の未解決事項・次にやること（優先順）

1. **AO（アンビエントオクルージョン）**：`vendor/three/addons/postprocessing/GTAOPass.js` は同梱済みで未使用。接地感が大きく向上するはずだが、GPU負荷とのトレードオフを実機で見てから判断すべき。
2. **怪人「カクシン様」のモデル強化**：現状 `makeMonster()` はほぼ円柱＋Canvas顔テクスチャのまま（`src/game.js` 内で検索）。家具の作り込みが進んだ分、相対的に一番の粗になっている。家具と同じプロシージャル方針（`rbox`/`tleg` 等のヘルパー＋統一パレット）で作り込むのが自然。無理に外部glTFへ戻すと、また統一感の問題が再発するので注意。
3. **キッチン・クローゼット枠の作り込み継続**：キッチン本体・シンク・コンロ・クローゼットの箱は既にv8で作り込んだが、さらにディテールを足す余地はある（引き出しの中・扉のヒンジ等）。優先度は怪人より低い。
4. **`src/game.js` のファイル分割**：1700行超の単一ファイルなので、そろそろ `render.js` / `game-logic.js` / `content.js`（ANOMS・DOCSPECS等のデータ）くらいには割ってもいい規模。急ぎではない。
5. **フレームレート実測**：実機（ユーザーのPC）でのFPS計測がまだ。プロシージャル家具は面取り（`RoundedBoxGeometry`）や五徳・キャスター等で頂点数が増えているため、v7時点より重い可能性がある。重ければ `bloomPass` の解像度を下げる、`shadow.mapSize` を1024→512に落とす、小物の `seg`/`r` をさらに削る等の調整枠を用意すること。
6. **市役所END（未実装、README参照）**：グラフィックスと直接関係ないが、ゲーム内容側の積み残し。

## 6. デプロイ・運用メモ

- `main` ブランチはまだ存在しない（このリポジトリは `claude/artifact-review-anha8j` 一本で運用中）。`.github/workflows/deploy-pages.yml` は `main` と `claude/artifact-review-anha8j` の両方へのpushをトリガにしてある。
- GitHub Pages の有効化はリポジトリ設定で一度だけ手動操作が必要だった（`Settings → Pages → Source: GitHub Actions`）。これは完了済み。以後は自動。
- ワークフローの `actions/configure-pages@v5` は `enablement: true` を明示しないと、Pages未設定リポジトリでは "Get Pages site failed" で落ちる（ハマったポイント。修正済みだが、他プロジェクトに流用するときも要注意）。
