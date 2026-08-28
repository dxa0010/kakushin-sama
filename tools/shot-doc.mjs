/* ============================================================
   書類スクリーンショットハーネス
   ------------------------------------------------------------
   `tools/shot.mjs` が部屋の造形を撮る道具なのに対し、こちらは
   検分UIの書類（`#docCv` の Canvas 手描き）を撮る。

   ここに置く理由: 本作の中核ループは書類の精読であり、異変の1つは
   文字の差し替えである。**書類の見え方は造形と同格の一次資料**なのに、
   v22 まで撮影手段が無く「直したら目で確かめる」ループが回せなかった。
   多言語化（5ロケール）以降は、目で見ないと分からない不具合が5倍になる。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765

   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を
         無視するので、playwright のあるディレクトリへコピーして実行する。
     cp tools/shot-doc.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node shot-doc.mjs --out C:/tmp/doc-ja                        # 真正な5枚（ja）
     node shot-doc.mjs --out C:/tmp/doc-ru --locale ru            # ロシア語版
     node shot-doc.mjs --out C:/tmp/doc-anoms --all-anoms         # 5枚 × 全異変

   オプション:
     --out <dir>       出力先（既定 C:/tmp/shot-doc）
     --locale <loc>    ja / en / zh-Hans / ru / es（既定はブラウザ設定＝通常 ja）
     --anom <id>       この異変を全書類に当てて撮る（era / label / four ...）
     --all-anoms       全異変 × 全書類。枚数が多いので既定では撮らない
     --port <n>        静的サーバのポート（既定 8765）
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const OUT = opt("--out", "C:/tmp/shot-doc");
const PORT = opt("--port", "8765");
const LOCALE = opt("--locale", null);
const ONE_ANOM = opt("--anom", null);
const ALL_ANOMS = has("--all-anoms");
const SAVE_KEY = "kakushin_save_v1";   // src/game.js:113

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.error("  [page error]", e.message));

// ロケールはセーブから読まれる（src/game.js の detectLocale）。
// 起動前に書き込んでおく必要があるので、一度空ページで localStorage を立ててから本体を開く。
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
if (LOCALE) {
  await page.evaluate(([key, loc]) => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { s = {}; }
    s.locale = loc;
    localStorage.setItem(key, JSON.stringify(s));
  }, [SAVE_KEY, LOCALE]);
}

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "load" });
await page.click("#startBtn");
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 15000 });

const locale = await page.evaluate(() => window.__dbg.locale());
console.log(`locale = ${locale}`);

/** 書類を1枚撮る。anomId が null なら真正な状態で撮る。 */
async function shoot(itemIndex, anomId, label) {
  const ok = await page.evaluate(([i, id]) => {
    const d = window.__dbg;
    const it = d.ITEMS[i];
    if (!it) return null;
    // 偽物の割り当ては起動時に乱数で決まるので、撮影のたびに固定し直す。
    if (id === null) {
      it.copy = { fake: false, anomId: null };
    } else {
      const spec = d.DOCSPECS()[it.id];
      if (!spec) return { skipped: "書類データが無い" };
      if (!d.canApply(id, spec, d.locale())) return { skipped: "can 不成立" };
      it.copy = { fake: true, anomId: id };
    }
    d.openInspect(it);
    return { short: it.short, id: it.id };
  }, [itemIndex, anomId]);

  if (!ok) return null;
  if (ok.skipped) { console.log("  skip", label, "-", ok.skipped); return null; }

  await page.waitForTimeout(120);
  // locator.screenshot() は「要素が安定するまで」待つが、背後で 3D を回している
  // ページではこの判定が通らずタイムアウトする。canvas の中身を直接取り出す。
  const dataUrl = await page.evaluate(() => document.querySelector("#docCv").toDataURL("image/png"));
  writeFileSync(`${OUT}/${label}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  await page.evaluate(() => document.querySelector("#btnBack")?.click());
  console.log("  ->", `${label}.png`, `(${ok.short || ok.id})`);
}

const count = await page.evaluate(() => window.__dbg.ITEMS.length);
console.log(`書類 ${count} 件を撮ります -> ${OUT}`);

for (let i = 0; i < count; i++) {
  await shoot(i, null, `doc${String(i).padStart(2, "0")}_genuine`);
}

const anomIds = ALL_ANOMS
  ? await page.evaluate(() => window.__dbg.ANOM_IDS)
  : ONE_ANOM ? [ONE_ANOM] : [];

for (const id of anomIds) {
  for (let i = 0; i < count; i++) {
    await shoot(i, id, `doc${String(i).padStart(2, "0")}_${id}`);
  }
}

await browser.close();
console.log("done");
