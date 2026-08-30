/* ============================================================
   指定した高さでの「図の横切り」を全部並べる

   silhouette-diff.mjs は輪郭の**外側の端だけ**を見るので、
   「胴が厚いか」は分かっても「腿が太いか」は分からない。
   ある高さで横一列を走査し、図が連続している区間（ラン）をすべて出せば、
   腿・すね・腕といった**部位ごとの太さ**が直接読める。

   首が太い・手足が細いといった指摘は目視だと水掛け論になるので、ここで決める。

   実行: cp tools/limb-width.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
         node limb-width.mjs <画像> [--key] [--rows=0.30,0.45,0.60]
   出力は全高で正規化した値（幅も位置も「全高＝1.0」）。
   ============================================================ */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const keyed = args.includes("--key");
const rows = (args.find((a) => a.startsWith("--rows="))?.slice(7) || "0.10,0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90")
  .split(",").map(Number);
if (!file) { console.error("usage: node limb-width.mjs <画像> [--key] [--rows=...]"); process.exit(1); }

const b = readFileSync(file);
const url = `data:image/${b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : "png"};base64,${b.toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const mask = await page.evaluate(async ([u, useKey]) => {
  const im = new Image(); im.src = u; await im.decode();
  const c = document.createElement("canvas");
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let y = 0; y < c.height; y++) {
    const row = [];
    const b0 = y * c.width * 4;
    const br = d[b0], bg = d[b0 + 1], bb = d[b0 + 2];
    for (let x = 0; x < c.width; x++) {
      const i = b0 + x * 4;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      row.push(useKey ? !(G < 0.88 * Math.min(R, B))
                      : Math.abs(R - br) + Math.abs(G - bg) + Math.abs(B - bb) > 26);
    }
    out.push(row);
  }
  return { w: c.width, h: c.height, rows: out };
}, [url, keyed]);
await browser.close();

// 図の上端・下端・左端を求めて、全高で正規化する
const ys = [];
mask.rows.forEach((r, y) => { if (r.some(Boolean)) ys.push(y); });
const y0 = ys[0], y1 = ys[ys.length - 1], H = y1 - y0;
let x0 = Infinity;
for (const y of ys) { const i = mask.rows[y].indexOf(true); if (i >= 0 && i < x0) x0 = i; }

console.log(`${file}   図の高さ ${H}px`);
console.log("");
console.log("  高さ | 横切りの区間（位置:幅、いずれも全高で正規化）");
console.log("  -----+--------------------------------------------------");
for (const t of rows) {
  const y = Math.min(y1, y0 + Math.round(H * t));
  const r = mask.rows[y];
  const runs = [];
  let s = null;
  for (let x = 0; x <= r.length; x++) {
    if (r[x] && s === null) s = x;
    else if (!r[x] && s !== null) {
      if (x - s >= 2) runs.push([(s - x0) / H, (x - s) / H]);   // 1px のごみは捨てる
      s = null;
    }
  }
  const txt = runs.length
    ? runs.map(([p, w]) => `${p.toFixed(3)}:${w.toFixed(3)}`).join("  ")
    : "(なし)";
  console.log(`  ${t.toFixed(2)} | ${txt}`);
}
