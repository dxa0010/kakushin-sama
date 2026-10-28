/* タイトル画面の背景を軽量な webp に書き出す。
 *
 * 元は docs/storeart/title_mannequin.png（決定稿 concept4 の怪人。1254px 四方・約1.8MB）。
 * 2026-10-28 に Steam 用キーアート（key_16x9.jpg）から差し替えた（依頼主の指示：
 * ストア用の絵は怪人の造形が決定稿と違う）。タイトルは起動直後に
 * 必ず読むので、そのまま載せると初回表示が重くなる。ブラウザの webp エンコーダで
 * 画質を落として assets/title/ に置く（**生成物をコミットする。配信時には何も実行しない**）。
 * 依存を足さないために、画像処理は Playwright の Chromium の canvas で行う。
 *
 * 実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので、
 *       このファイルを playwright のあるディレクトリへコピーして、リポジトリの場所を渡す。
 *   cp tools/make-title-art.mjs "/c/Users/dxa00/AppData/Roaming/npm/node_modules/"
 *   node "/c/Users/dxa00/AppData/Roaming/npm/node_modules/make-title-art.mjs" "$(pwd)"
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || process.cwd();
const JOBS = [
  { src: "docs/storeart/title_mannequin.png", out: "assets/title/title_mannequin.webp", w: 1254, q: 0.86 },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
for (const j of JOBS) {
  const mime = j.src.endsWith(".png") ? "image/png" : "image/jpeg";
  const uri = `data:${mime};base64,` + readFileSync(join(ROOT, j.src)).toString("base64");
  const b64 = await page.evaluate(async ({ uri, w, q }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const h = Math.round(img.height * w / img.width);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/webp", q).split(",")[1];
  }, { uri, w: j.w, q: j.q });
  mkdirSync(join(ROOT, j.out, ".."), { recursive: true });
  const buf = Buffer.from(b64, "base64");
  writeFileSync(join(ROOT, j.out), buf);
  console.log(`${j.out}  ${(buf.length / 1024).toFixed(0)} KB`);
}
await browser.close();
