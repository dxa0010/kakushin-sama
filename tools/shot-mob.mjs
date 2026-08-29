/* ============================================================
   怪人「カクシン様」四面図ハーネス
   ------------------------------------------------------------
   カメラを固定したまま**怪人だけを回して** front/right/back/left を撮る。
   カメラを怪人のまわりに回すと壁や家具が視線に入って画角が揃わないので、
   モデルの側を回す。照明・背景・距離が4枚で完全に同一になり、
   改修前後の差分がモデルの差分だけになる。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765

   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので
         このファイルを playwright のあるディレクトリへコピーして、そこから実行する。
     cp tools/shot-mob.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node shot-mob.mjs --out C:/tmp/mob-before
     node shot-mob.mjs --out C:/tmp/mob-after --studio

   オプション:
     --out <dir>   出力先（既定 C:/tmp/mob）
     --studio      部屋を隠して無地の背景で撮る（造形・シルエットの判定用）
     --dark        ゲーム本来の暗さのまま撮る（既定は inspectLight で明るくする）
     --views a,b   撮るビューを絞る（既定は全部）
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 怪人を置く床の座標と、そこを見るカメラ。右の部屋の中央付近（家具の無い床）。
   カメラは目線 1.6m 固定・距離 2.3m で、全高 2.05m が縦の 6 割強を占める。 */
const MOB = { x: 2.4, z: 0.4 };
const CAM = { x: 2.4, z: -1.9 };

/** ビュー名 -> [怪人のY回転, 注視点の高さ, カメラ距離の倍率] */
const VIEWS = {
  front: [Math.PI,      1.05, 1.0],   // 顔＝通知書がこちらを向く
  right: [Math.PI / 2,  1.05, 1.0],   // マチェーテを持つ側（+x）
  back:  [0,            1.05, 1.0],   // 背中（頭頂の頭皮・襟・裾）
  left:  [-Math.PI / 2, 1.05, 1.0],   // 左腕側（-x）
  head:  [Math.PI,      1.87, 0.34],  // 顔の寄り（マスクと頭部の取り合い）
  hand:  [Math.PI * 0.72, 0.70, 0.30],  // 右手と大鉈の握りの寄り（拳の高さに合わせる）
  foot:  [Math.PI,      0.18, 0.42],  // ブーツの接地とすねの取り合い
};

const argv = process.argv.slice(2);
let OUT = "C:/tmp/mob", studio = false, dark = false, only = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") OUT = argv[++i];
  else if (argv[i] === "--studio") studio = true;
  else if (argv[i] === "--dark") dark = true;
  else if (argv[i] === "--views") only = argv[++i].split(",");
}
mkdirSync(OUT, { recursive: true });
const views = Object.entries(VIEWS).filter(([n]) => !only || only.includes(n));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGE-EXC:", e.message));
await page.goto("http://localhost:8765/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.click("#startBtn").catch(() => {});
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 15000 });
await page.waitForTimeout(9000);          // 導入文が画に被るので消えるまで待つ

// HUD を消す（造形の判定に時計・ミニマップは邪魔）
await page.evaluate(() => {
  const c = document.querySelector("canvas");
  for (const el of document.body.querySelectorAll("*"))
    if (el !== c && !el.contains(c) && el.tagName !== "SCRIPT" && el.tagName !== "CANVAS")
      el.style.setProperty("display", "none", "important");
});
/* 検分用の照明。gfx.inspectLight だけでは足りない――アンビエントの色が 0x2c2c40 と
   暗く、怪人の材質（作業着 0x1a1712 など）はほぼ黒に沈んで面の分かれ方が見えない。
   造形の是非は「陰影が付いた状態」でしか判定できないので、キー＋フィルを足す。
   ゲーム本来の見え方は --dark で撮る。 */
if (!dark) await page.evaluate(({ MOB, CAM }) => {
  const { scene, THREE } = window.__dbg.gfx;
  window.__dbg.gfx.inspectLight(true);
  scene.traverse(o => {
    if (o.isAmbientLight) { o.color.setHex(0xffffff); o.intensity = 0.55; }
    if (o.isHemisphereLight) { o.color.setHex(0xffffff); o.intensity = 0.45; }
  });
  const key = new THREE.DirectionalLight(0xfff2e0, 5.2);
  key.position.set(MOB.x - 2.2, 3.4, CAM.z - 1.0);
  key.target.position.set(MOB.x, 1.0, MOB.z);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xcfd8ff, 2.2);
  fill.position.set(MOB.x + 3.0, 2.0, MOB.z + 2.0);
  fill.target.position.set(MOB.x, 1.0, MOB.z);
  scene.add(fill, fill.target);
  /* リム（背後からの縁光）。真っ黒に近い衣装は、正面から当てるだけでは
     どこが前でどこが後ろか分からない。輪郭に光を回すと形が読める。 */
  const rim = new THREE.DirectionalLight(0xfff0d8, 3.4);
  rim.position.set(MOB.x + 1.2, 3.0, MOB.z + 3.2);
  rim.target.position.set(MOB.x, 1.2, MOB.z);
  scene.add(rim, rim.target);
}, { MOB, CAM });

/* 部屋を隠す。怪人・ライト・カメラだけ残して背景を無地にすると、
   シルエットと面の分かれ方だけが見える（造形の粗さはここに出る）。 */
if (studio) await page.evaluate(() => {
  const { scene, THREE } = window.__dbg.gfx;
  const mob = window.__dbg.monster;
  for (const o of scene.children) {
    if (o === mob || o.isLight || o.isCamera) continue;
    if (o.userData && o.userData.__keep) continue;
    o.visible = false;
  }
  scene.background = new THREE.Color(0x4a4a4e);
  scene.fog = null;
});

/* 怪人を毎tick固定する。mob.active=false なので monsterUpdate は座標に触らないが、
   保険として setInterval で押さえる（描画フックを挟むと画が黒くなる事例があったため、
   composer には一切触らない）。 */
await page.evaluate(({ MOB }) => {
  const d = window.__dbg;
  d.mob.active = false;
  d.monster.visible = true;
  d.monster.position.set(MOB.x, 0, MOB.z);
  window.__mobRy = Math.PI;
  setInterval(() => {
    d.monster.visible = true;
    d.monster.position.set(MOB.x, 0, MOB.z);
    d.monster.rotation.set(0, window.__mobRy, 0);
  }, 16);
}, { MOB });

for (const [name, [ry, ty, distScale]] of views) {
  await page.evaluate(({ ry, ty, distScale, MOB, CAM }) => {
    const d = window.__dbg;
    window.__mobRy = ry;
    // カメラは怪人から見て -z 側。寄りのときは同じ向きのまま距離だけ詰める。
    const dx = CAM.x - MOB.x, dz = CAM.z - MOB.z;
    const px = MOB.x + dx * distScale, pz = MOB.z + dz * distScale;
    d.ply.x = px; d.ply.z = pz; d.ply.hidden = false;
    const ax = MOB.x - px, az = MOB.z - pz, dist = Math.hypot(ax, az);
    d.ply.yaw = Math.atan2(-ax, -az);
    d.ply.pitch = Math.asin(Math.max(-1, Math.min(1, (ty - 1.6) / Math.hypot(dist, ty - 1.6))));
  }, { ry, ty, distScale, MOB, CAM });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", `${OUT}/${name}.png`);
}
await browser.close();
