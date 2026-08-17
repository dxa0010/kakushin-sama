/* ============================================================
   汎用スクリーンショットハーネス
   ------------------------------------------------------------
   名前付きアングルを撮って PNG に落とすだけの道具。
   「1点直したら必ず撮る」ループを回すための土台で、
   改修前後を別ディレクトリに撮り分けて並べて比べるのが基本の使い方。

   ここに置く理由: v19まで撮影スクリプトはリポジトリ外（C:/tmp と npm の
   グローバル node_modules）にしか無く、アングル定義が失われると同じ画角で
   撮り直せなかった。アングルは造形の一次資料なのでリポジトリに置く。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765

   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので
         このファイルを playwright のあるディレクトリへコピーして、そこから実行する。
     cp tools/shot.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node shot.mjs --out C:/tmp/before bedside_r bedside_l bedhead
     node shot.mjs --out C:/tmp/after  bedside_r bedside_l bedhead   # 直した後
     node shot.mjs --out C:/tmp/all                                  # アングル名を省略すると全部

   オプション:
     --out <dir>    出力先（既定 C:/tmp/shot）
     --light        検分用に部屋を明るくする（暗いままでは造形の是非が判定できない）
     --no-ao        AOを切って撮る（AOが隠している造形バグを見たいとき）
     --hud          HUD（時計・ミニマップ・字幕・書類ボタン）を残す。既定は消す
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/** 名前 -> [視点x, 視点z, 対象x, 対象y, 対象z]（視点の高さは常にプレイヤーの目=1.6） */
const ANGLES = {
  /* 部屋全体・家具ごとの定番（shot_items.mjs から引き継いだもの） */
  shelf:     [ 6.20,  2.15,  7.62, 1.20,  2.15],
  desk:      [ 6.85, -3.60,  6.85, 1.13, -2.10],
  kitchen:   [-5.60,  3.40, -7.07, 0.95,  3.40],
  bed:       [-5.00, -4.30, -6.55, 0.70, -4.80],
  table:     [ 2.70,  0.50,  2.70, 0.50,  2.20],
  /* ベッドの接地・貫通を見るための寄り（v20で追加）。
     マットレス側面とフレーム・脚の関係は真横からしか判定できない。 */
  bedside_r: [-5.30, -4.20, -6.20, 0.45, -4.20],   // 右側面（垂れ布とフレーム・脚）
  bedside_l: [-7.60, -4.34, -7.02, 0.45, -4.34],   // 左側面（同じく垂れ布）
  bedhead:   [-6.55, -3.30, -6.55, 0.62, -5.60],   // 足元からヘッドボードと枕を見る
  bedfoot:   [-6.30, -2.90, -6.55, 0.55, -4.30],   // 足元の掛け布団のめくれ
  /* 本棚の右端（側板と本の貫通が出る場所） */
  shelf_r:   [ 6.60,  3.05,  7.55, 1.15,  3.05],
};

const argv = process.argv.slice(2);
let OUT = "C:/tmp/shot", light = false, ao = true, hud = false;
const names = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") OUT = argv[++i];
  else if (argv[i] === "--light") light = true;
  else if (argv[i] === "--no-ao") ao = false;
  else if (argv[i] === "--hud") hud = true;
  else names.push(argv[i]);
}
mkdirSync(OUT, { recursive: true });
const angles = Object.entries(ANGLES).filter(([n]) => !names.length || names.includes(n));
const unknown = names.filter(n => !(n in ANGLES));
if (unknown.length) { console.error("unknown angle:", unknown.join(", ")); process.exit(1); }

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
await page.waitForTimeout(9000);          // 導入文が画に被るので消えるまで待つ（5.2秒では消えきらなかった）

if (light) await page.evaluate(() => window.__dbg.gfx.inspectLight(true));
if (!ao)   await page.evaluate(() => window.__dbg.gfx.ao(false));
// HUDを消す: 造形を見るとき時計・ミニマップ・字幕・書類ボタンが画の1/4を潰していた。
// ゲーム側にトグルを持たせず、canvas を含まない要素をこちらで隠す（描画には触らない）。
if (!hud) await page.evaluate(() => {
  const c = document.querySelector("canvas");
  for (const el of document.body.querySelectorAll("*"))
    if (el !== c && !el.contains(c) && el.tagName !== "SCRIPT" && el.tagName !== "CANVAS")
      el.style.setProperty("display", "none", "important");
});

for (const [name, [px, pz, tx, ty, tz]] of angles) {
  await page.evaluate(({ px, pz, tx, ty, tz }) => {
    const d = window.__dbg;
    d.ply.x = px; d.ply.z = pz; d.ply.hidden = false;
    const dx = tx - px, dz = tz - pz, dist = Math.hypot(dx, dz);
    d.ply.yaw = Math.atan2(-dx, -dz);
    d.ply.pitch = Math.asin(Math.max(-1, Math.min(1, (ty - 1.6) / Math.hypot(dist, ty - 1.6))));
  }, { px, pz, tx, ty, tz });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", `${OUT}/${name}.png`);
}
await browser.close();
