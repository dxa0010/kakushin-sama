/* ============================================================
   参照画と自分のレンダの輪郭を**重ねた1枚**を書き出す

   silhouette-diff.mjs の表は「どの帯が何ミリ違うか」は分かるが、
   その差が体のどの部位から来ているのかは分からない。
   胴が太いのか、腕が後ろに出ているのか、脚が開いていないのかを
   取り違えると、直すたびに別の場所が崩れる。

   高さを揃え、足元と「いちばん後ろ」で位置を合わせて2つの輪郭を重ねる。
     赤   = 参照（決定稿）
     青   = 自分のレンダ
     紫   = 両方が重なっているところ
   ずれている部位が色でそのまま見える。

   実行: cp tools/silhouette-overlay.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
         node silhouette-overlay.mjs <参照画> <自分のレンダ> <出力.png> [--key] [--mirror]
   ============================================================ */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const keyed = args.includes("--key");
const mirror = args.includes("--mirror");
if (files.length < 3) {
  console.error("usage: node silhouette-overlay.mjs <参照画> <自分のレンダ> <出力.png> [--key] [--mirror]");
  process.exit(1);
}
const [refFile, ownFile, outFile] = files;

const dataUrl = (f) => {
  const b = readFileSync(f);
  return `data:image/${b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : "png"};base64,${b.toString("base64")}`;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");

const png = await page.evaluate(async ([refUrl, ownUrl, useKey, doMirror]) => {
  /** 画像を読んで、図の画素だけの真偽値マスクにする */
  const maskOf = async (url, keyed) => {
    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement("canvas");
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const m = [];
    for (let y = 0; y < c.height; y++) {
      const row = new Uint8Array(c.width);
      const b0 = y * c.width * 4;
      const br = d[b0], bg = d[b0 + 1], bb = d[b0 + 2];
      for (let x = 0; x < c.width; x++) {
        const i = b0 + x * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        row[x] = keyed ? (!(R > G + 12 && B > G + 12) ? 1 : 0)
                       : (Math.abs(R - br) + Math.abs(G - bg) + Math.abs(B - bb) > 26 ? 1 : 0);
      }
      m.push(row);
    }
    return { w: c.width, h: c.height, m };
  };
  /** 図の外接矩形を求める */
  const boxOf = (mk) => {
    let y0 = -1, y1 = -1, x0 = 1e9, x1 = -1;
    for (let y = 0; y < mk.h; y++) {
      let any = false;
      for (let x = 0; x < mk.w; x++) if (mk.m[y][x]) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      if (any) { if (y0 < 0) y0 = y; y1 = y; }
    }
    return { x0, x1, y0, y1 };
  };

  const A = await maskOf(refUrl, false), B = await maskOf(ownUrl, useKey);
  const ba = boxOf(A), bb2 = boxOf(B);

  /* 高さ 800px に揃えて描き直す。足元(y1)と「いちばん後ろ」(x0)を原点にする。
     どちらも姿勢に依らず決まる点なので、位置合わせが恣意的にならない。 */
  const OH = 800, PAD = 40;
  const sa = OH / (ba.y1 - ba.y0), sb = OH / (bb2.y1 - bb2.y0);
  const wa = (ba.x1 - ba.x0) * sa, wb = (bb2.x1 - bb2.x0) * sb;
  const OW = Math.ceil(Math.max(wa, wb)) + PAD * 2;

  const out = document.createElement("canvas");
  out.width = OW; out.height = OH + PAD * 2;
  const g = out.getContext("2d");
  g.fillStyle = "#14141a"; g.fillRect(0, 0, out.width, out.height);
  const img = g.getImageData(0, 0, out.width, out.height);

  /** 元マスクを出力座標へ写して塗る。chan 0=赤(参照) 2=青(自分) */
  const paint = (mk, box, sc, chan) => {
    for (let oy = 0; oy < OH; oy++) {
      const sy = box.y0 + Math.round(oy / sc);
      if (sy < 0 || sy >= mk.h) continue;
      for (let ox = 0; ox < OW - PAD * 2; ox++) {
        let sx = box.x0 + Math.round(ox / sc);
        if (doMirror && chan === 2) sx = box.x1 - Math.round(ox / sc);
        if (sx < 0 || sx >= mk.w) continue;
        if (!mk.m[sy][sx]) continue;
        const i = ((oy + PAD) * out.width + (ox + PAD)) * 4;
        img.data[i + chan] = 220;
        img.data[i + 3] = 255;
      }
    }
  };
  paint(A, ba, sa, 0);    // 参照 = 赤
  paint(B, bb2, sb, 2);   // 自分 = 青
  g.putImageData(img, 0, 0);

  // 目盛り（0.1 刻みの高さ線）
  g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
  g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "11px monospace";
  for (let k = 0; k <= 10; k++) {
    const y = PAD + OH * k / 10;
    g.beginPath(); g.moveTo(PAD, y); g.lineTo(out.width - PAD, y); g.stroke();
    g.fillText((k / 10).toFixed(1), 4, y + 4);
  }
  return out.toDataURL("image/png");
}, [dataUrl(refFile), dataUrl(ownFile), keyed, mirror]);

await browser.close();
writeFileSync(outFile, Buffer.from(png.split(",")[1], "base64"));
console.log(`saved ${outFile}  （赤=参照 / 青=自分 / 紫=一致）`);
