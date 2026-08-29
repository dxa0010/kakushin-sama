/* ============================================================
   参照画と自分のレンダの**シルエットを数値で比べる**

   目で見比べて直すと、毎回ちがう箇所を触ってしまい全体のつり合いが取れない。
   輪郭を「高さ＝1.0」で正規化して同じ高さでの前後の張り出しを表にすれば、
   どこが太いか・どこが長いかが一意に決まり、balance として直せる。

   agy が書き出す画像は拡張子が .png でも中身は JPEG なので、
   デコードはブラウザ（playwright）に任せる。PIL も numpy も要らない。

   実行: cp tools/silhouette-diff.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
         node silhouette-diff.mjs <参照画> <自分のレンダ> [--mirror] [--rows=16] [--plate=<背景画>]

   --plate を渡すと、自分のレンダから**背景だけの同画角**を引いて図を取る。
   背景は無地に設定してあるが、後処理のビネットで周辺が落ちるため、
   行ごとの色比較では図と地が分けられない（全面が図として拾われる）。
   ============================================================ */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const mirror = args.includes("--mirror");
const rows = Number(args.find((a) => a.startsWith("--rows="))?.slice(7) || 16);
const plate = args.find((a) => a.startsWith("--plate="))?.slice(8) || null;
/* 下地と本番を別プロセスで撮ると露出がわずかにずれることがある。
   その差が既定のしきい値を超えると全面が図として拾われるので、外から上げられるようにする。 */
const thresh = Number(args.find((a) => a.startsWith("--thresh="))?.slice(9) || 26);
if (files.length < 2) {
  console.error("usage: node silhouette-diff.mjs <参照画> <自分のレンダ> [--mirror] [--rows=16]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

/** 画像を読み、各行の輪郭（左端・右端）を返す。
 *  背景は行ごとに左端の画素を基準にする――自分のレンダは背景がグラデーションなので、
 *  一定色との比較では図が取れない。参照画は無地だが同じ方法で問題なく取れる。 */
const grab = async (file, thresh, plateFile) =>
  page.evaluate(async ([url, th, purl]) => {
    const load = async (u) => {
      const im = new Image(); im.src = u; await im.decode();
      const cv = document.createElement("canvas");
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      return { w: cv.width, h: cv.height, d: cx.getImageData(0, 0, cv.width, cv.height).data };
    };
    const a = await load(url);
    const p = purl ? await load(purl) : null;
    const out = [];
    for (let y = 0; y < a.h; y++) {
      const b = y * a.w * 4;
      // 下地があるなら同じ画素と、無いならその行の左端と比べる
      const br = a.d[b], bg = a.d[b + 1], bb = a.d[b + 2];
      let lo = null, hi = null;
      for (let x = 0; x < a.w; x++) {
        const i = b + x * 4;
        const cr = p ? p.d[i] : br, cg = p ? p.d[i + 1] : bg, cb = p ? p.d[i + 2] : bb;
        if (Math.abs(a.d[i] - cr) + Math.abs(a.d[i + 1] - cg) + Math.abs(a.d[i + 2] - cb) > th) {
          if (lo === null) lo = x;
          hi = x;
        }
      }
      out.push([lo, hi]);
    }
    return out;
  }, [dataUrl(file), thresh, plateFile ? dataUrl(plateFile) : null]);

/* about:blank から file:// の画像は読めない（オリジンが違うのでデコードが拒否される）。
   バイト列を data: URL にして渡す。JPEG でも PNG でもブラウザが判別してくれる。 */
function dataUrl(file) {
  const b = readFileSync(file);
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,${b.toString("base64")}`;
}

/** 高さで正規化した前後位置の並びにする。0.0 = 最上端, 1.0 = 足元。 */
function profile(rowsArr, doMirror, n) {
  const ys = [];
  rowsArr.forEach(([lo], y) => { if (lo !== null) ys.push(y); });
  if (!ys.length) throw new Error("図が見つからない（しきい値が高すぎる可能性）");
  const y0 = ys[0], y1 = ys[ys.length - 1], H = y1 - y0;
  let x0 = Infinity, x1 = -Infinity;
  for (const y of ys) { const [lo, hi] = rowsArr[y]; if (lo < x0) x0 = lo; if (hi > x1) x1 = hi; }
  const span = (x1 - x0) / H;
  const res = [];
  for (let k = 0; k <= n; k++) {
    const y = Math.min(y1, y0 + Math.round(H * k / n));
    const [lo, hi] = rowsArr[y];
    if (lo === null) { res.push([k / n, null, null]); continue; }
    let a = (lo - x0) / H, b = (hi - x0) / H;
    if (doMirror) { const t = a; a = span - b; b = span - t; }
    res.push([k / n, a, b]);
  }
  return { span, res, H };
}

const ref = profile(await grab(files[0], 26, null), false, rows);
const own = profile(await grab(files[1], thresh, plate), mirror, rows);
await browser.close();

const f = (v) => (v === null ? "  --  " : v.toFixed(3).padStart(6));
console.log(`参照: ${files[0]}`);
console.log(`自分: ${files[1]}${mirror ? "（左右反転して比較）" : ""}`);
console.log(`奥行き（前後の総幅／高さ）:  参照 ${ref.span.toFixed(3)}   自分 ${own.span.toFixed(3)}   差 ${(own.span - ref.span >= 0 ? "+" : "") + (own.span - ref.span).toFixed(3)}`);
console.log("");
console.log("  高さ |    参照  後   前    厚み |    自分  後   前    厚み | 厚みの差");
console.log("  -----+--------------------------+--------------------------+---------");
for (let i = 0; i < ref.res.length; i++) {
  const [t, ra, rb] = ref.res[i], [, oa, ob] = own.res[i];
  if (ra === null || oa === null) { console.log(`  ${t.toFixed(2)} |  (なし)`); continue; }
  const rw = rb - ra, ow = ob - oa;
  const d = ow - rw;
  console.log(`  ${t.toFixed(2)} | ${f(ra)}${f(rb)}${f(rw)}    | ${f(oa)}${f(ob)}${f(ow)}    | ${(d >= 0 ? "+" : "") + d.toFixed(3)}`);
}
