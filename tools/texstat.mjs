/* ============================================================
   テクスチャの明るさ・分布を測る道具
   ------------------------------------------------------------
   diffuse を貼ったときに色をどれだけ補正すべきか、normalMap が
   そもそも画に出る強さを持っているか、roughnessMap を掛けたら
   実効ラフネスが幾らになるか——これは目で見ても分からないので測る。

   ここに置く理由: v23〜v24 の寝具の材の判断（拡散マップを外す／
   fabric049 の法線だけを使う／ラフネスマップを外す）は全部この数値が
   根拠になっている。src/game.js のコメントがこの数値を引用しているので、
   同じ数字を再現できる手段をリポジトリに残す。tools/shot.mjs と同じ理屈。

   読み方:
     mean … sRGB のままの平均（0-255）
     lin  … mean を sRGB→リニアに変換した値。**拡散マップの評価はこちら**。
             three.js は color とマップを乗算するので、lin がそのまま
             「色が何倍に暗くなるか」になる。
             例: fabric001_diffuse は lin 0.52 ＝ 貼ると反射率が半分。
                 打ち消すには color を sRGB で 1/0.52^(1/2.2) = 1.34 倍
                 する必要があり、淡い色では 255 を超えて破綻する。
     roughnessMap / normalMap は**リニアデータなので lin ではなく mean/255 で読む**。
             例: fabric049_roughness は mean 110 → 0.43。base roughness に
                 乗算されるので、base をどう上げても実効 0.43 前後（つや有り）。
             例: normal の RG が 29〜230 → 傾き ±(230-128)/128 ≒ ±0.8。
                 fabric001_normal は 98〜163 ＝ ±0.24 しかなく、薄暗い室内で
                 1.5m 離れると normalScale を 3 倍にしても画に出なかった。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765
   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので
         このファイルを playwright のあるディレクトリへコピーして、そこから実行する。
     cp tools/texstat.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node texstat.mjs fabric049_normal.webp fabric001_diffuse.jpg
   引数を省略すると寝具で使っている布だけを測る。
   ============================================================ */
import { chromium } from "playwright";

const names = process.argv.slice(2);
if (!names.length) names.push(
  "fabric001_diffuse.jpg", "fabric001_normal.jpg", "fabric001_roughness.jpg",
  "fabric049_diffuse.webp", "fabric049_normal.webp", "fabric049_roughness.webp");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:8765/index.html", { waitUntil: "domcontentloaded" });
// WebGL は不要。canvas でデコードして生のピクセルを読むだけ。
const out = await page.evaluate(async (names) => {
  const res = [];
  for (const n of names) {
    const img = new Image();
    img.src = "./assets/textures/" + n;
    try { await img.decode(); } catch (e) { res.push({ n, err: String(e) }); continue; }
    const cv = document.createElement("canvas");
    // 平均と min/max を見るだけなので 512px に落として十分（1024px 全部読む必要はない）
    cv.width = Math.min(512, img.naturalWidth); cv.height = Math.min(512, img.naturalHeight);
    const c = cv.getContext("2d");
    c.drawImage(img, 0, 0, cv.width, cv.height);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const sum = [0, 0, 0], min = [255, 255, 255], max = [0, 0, 0];
    let px = 0;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        sum[k] += d[i + k];
        if (d[i + k] < min[k]) min[k] = d[i + k];
        if (d[i + k] > max[k]) max[k] = d[i + k];
      }
      px++;
    }
    const mean = sum.map(v => v / px);
    const lin = mean.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    res.push({
      n, size: [img.naturalWidth, img.naturalHeight],
      mean: mean.map(v => Math.round(v)),
      lin: lin.map(v => +v.toFixed(3)),
      min, max,
      // 法線として読んだときの傾きの幅（RG の 128 からのずれ）。±0.3 を下回ると
      // 薄暗い室内では normalScale を上げても画に出ない、が経験則。
      slopeRG: [(max[0] - 128) / 128, (128 - min[0]) / 128,
                (max[1] - 128) / 128, (128 - min[1]) / 128].map(v => +v.toFixed(2)),
    });
  }
  return res;
}, names);
for (const r of out) {
  if (r.err) { console.log(`${r.n}: ERROR ${r.err}`); continue; }
  console.log(`${r.n}  ${r.size[0]}x${r.size[1]}`);
  console.log(`  mean sRGB ${r.mean.join(",")}   linear ${r.lin.join(",")}   /255 ${r.mean.map(v => (v / 255).toFixed(2)).join(",")}`);
  console.log(`  min ${r.min.join(",")}  max ${r.max.join(",")}   法線として ±${Math.max(...r.slopeRG).toFixed(2)}`);
}
await browser.close();
