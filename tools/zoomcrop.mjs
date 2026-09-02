/* 画像の一部を切り出して**拡大**して保存する（crop.mjs は等倍なので小さい画像だと見えない）
   node zoomcrop.mjs <入力> <出力> <x> <y> <w> <h> <倍率>   x,y,w,h は 0..1 の割合 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [inp, out, X, Y, W, H, S] = process.argv.slice(2);
const b = readFileSync(inp);
const mime = b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : "png";
const url = `data:image/${mime};base64,${b.toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
const png = await page.evaluate(async ([u, x, y, w, h, s]) => {
  const img = new Image();
  img.src = u;
  await img.decode();
  const sx = Math.round(img.width * x), sy = Math.round(img.height * y);
  const sw = Math.round(img.width * w), sh = Math.round(img.height * h);
  const c = document.createElement("canvas");
  c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}, [url, +X, +Y, +W, +H, +S]);
writeFileSync(out, Buffer.from(png, "base64"));
console.log("saved", out);
await browser.close();
