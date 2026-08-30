/* ============================================================
   画像の一部を切り出して保存する

   参照のターンアラウンド（1枚に正面・斜め・背面が並んだ絵）を
   ビューごとに分けるために使う。1枚のままだと、評価を頼んでも
   どのパネルと比べているのかが定まらない。

   実行: cp tools/crop.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
         node crop.mjs <入力> <出力> <x> <y> <w> <h>
   座標は 0..1 の割合で指定する（画像の実寸を知らなくてよい）。
   ============================================================ */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [inp, out, X, Y, W, H] = process.argv.slice(2);
if (!inp || !out || H === undefined) {
  console.error("usage: node crop.mjs <入力> <出力> <x> <y> <w> <h>   （x,y,w,h は 0..1 の割合）");
  process.exit(1);
}
const b = readFileSync(inp);
const url = `data:image/${b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : "png"};base64,${b.toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
const png = await page.evaluate(async ([u, x, y, w, h]) => {
  const im = new Image(); im.src = u; await im.decode();
  const sx = Math.round(im.naturalWidth * x), sy = Math.round(im.naturalHeight * y);
  const sw = Math.round(im.naturalWidth * w), sh = Math.round(im.naturalHeight * h);
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  c.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL("image/png");
}, [url, +X, +Y, +W, +H]);
await browser.close();
writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
console.log(`saved ${out}`);
