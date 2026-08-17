/* ============================================================
   AO（環境遮蔽）のパラメータ比較ハーネス
   ------------------------------------------------------------
   同一アングル・同一シードで AO の強度／半径だけを振って撮る。
   目視で「なんとなく良い」を避け、並べて比較して決めるための道具。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765

   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので
         このファイルを playwright のあるディレクトリへコピーして、そこから実行する。
     cp tools/shot-ao.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node shot-ao.mjs shelf desk

   出力: C:/tmp/ao/<アングル>_<ラベル>.png
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "C:/tmp/ao";
mkdirSync(OUT, { recursive: true });

/** 撮影アングル: 名前 -> [視点x, 視点z, 対象x, 対象y, 対象z]（shot_items.mjs と同じ形式） */
const ANGLES = {
  shelf:   [6.2, 2.15, 7.62, 1.2, 2.15],
  desk:    [6.85, -3.6, 6.85, 1.13, -2.1],
  kitchen: [-5.6, 3.4, -7.07, 0.95, 3.4],
  bed:     [-5.0, -4.3, -6.55, 0.7, -4.8],
  table:   [2.7, 0.5, 2.7, 0.5, 2.2],
};

/** 振る条件: ラベル -> { on, intensity, radius } */
const CASES = [
  ["off",   { on: false }],
  ["i06r35", { on: true, intensity: 0.6, radius: 0.35 }],
  ["i09r35", { on: true, intensity: 0.9, radius: 0.35 }],
  ["i09r20", { on: true, intensity: 0.9, radius: 0.20 }],
  ["i12r35", { on: true, intensity: 1.2, radius: 0.35 }],
];

const only = process.argv.slice(2);
const angles = Object.entries(ANGLES).filter(([n]) => !only.length || only.includes(n));

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
// 導入文（4.6秒）が画に被るので消えるまで待つ
await page.waitForTimeout(5200);

for (const [angle, view] of angles) {
  const [px, pz, tx, ty, tz] = view;
  await page.evaluate(({ px, pz, tx, ty, tz }) => {
    const d = window.__dbg;
    d.ply.x = px; d.ply.z = pz; d.ply.hidden = false;
    const dx = tx - px, dz = tz - pz, dist = Math.hypot(dx, dz);
    d.ply.yaw = Math.atan2(-dx, -dz);
    d.ply.pitch = Math.asin(Math.max(-1, Math.min(1, (ty - 1.6) / Math.hypot(dist, ty - 1.6))));
  }, { px, pz, tx, ty, tz });

  for (const [label, cfg] of CASES) {
    const applied = await page.evaluate(
      (c) => window.__dbg.gfx.ao(c.on, c.intensity, c.radius),
      cfg);
    await page.waitForTimeout(350);
    const path = `${OUT}/${angle}_${label}.png`;
    await page.screenshot({ path });
    console.log("saved", `${angle}_${label}`, JSON.stringify(applied));
  }
}
await browser.close();
