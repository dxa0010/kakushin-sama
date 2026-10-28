/* ============================================================
   書類の異変が「却下理由のとおりに画面に出ているか」の E2E（手動実行）
   ------------------------------------------------------------
   v24 で異変のロジックを src/anoms.js へ移したとき、applyAnom() は
   spec.flags.mirror 等に書き込むのに drawDoc() は spec.mirror を読んだままで、
   鏡・逆さ印・見ている印・濡れ・透かし・朱の呪の6種が**真正と1バイトも違わない絵**
   になっていた。破れば「書類全体が鏡文字です」と言われるのに、画面は普通の書類。
   本作の中核ループそのものが壊れていたのに、単体テストは anoms.js だけを見ていたので
   通っていた。ここでは**プレイヤーが見る経路（openInspect → #docCv）**で確かめる。

   確かめること（全5ロケール × 全5書類 × 全16異変 × シード数通り）:
     1. 偽物の絵が真正と画素で違う（違いが無ければ見抜けない）
     2. 違う画素が、却下理由の指す場所「だけ」にある
        （年号なら右上、印なら右下、…。別の場所が変わっていたら理由と食い違う）
     3. 鏡は「真正を左右反転したもの」とほぼ一致する
     4. 見ている印は、検分中に実際に瞬く（開いた目と閉じた目の2状態が観測される）
     5. 化けた項目名は、混同表の**全箇所**について字が画素で変わる
        （同形に描かれる置換は見抜けない＝L-2 違反）

   実行（リポジトリルートで静的サーバを起動したまま）:
     python -m http.server 8765
     cp tests/e2e/doc-anoms.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node doc-anoms.mjs [--out C:/tmp/e2e-doc-anoms]

   成果物（--out）:
     report.json          全ケースの差分画素数・差分の外接矩形・判定
     label-<loc>.png      化けた項目名の全箇所（上=真正 / 下=偽物、2倍拡大）。目で確認する用
     eye-<loc>.png        見ている印の開いた目／閉じた目
     fail-*.png           落ちたケースの偽物の絵
   全ケース PASS なら exit 0、1つでも落ちれば exit 1。
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const OUT = opt("--out", "C:/tmp/e2e-doc-anoms");
const URL_BASE = process.env.E2E_URL || `http://localhost:${opt("--port", "8765")}`;
const LOCALES = ["ja", "en", "zh-Hans", "ru", "es"];
const SEEDS = [1, 2, 3, 4, 5, 6];
const SAVE_KEY = "kakushin_save_v1";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const report = { when: new Date().toISOString(), cases: [], fails: [] };

for (const locale of LOCALES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, loc]) => localStorage.setItem(k, JSON.stringify({ locale: loc })), [SAVE_KEY, locale]);
  await page.goto(`${URL_BASE}/index.html`, { waitUntil: "load" });
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });
  await page.evaluate(() => { window.__dbg.ply.hidden = true; });

  const res = await page.evaluate(async ({ SEEDS }) => {
    const d = window.__dbg;
    const loc = d.locale();
    const A = await import("/src/anoms.js");
    const cv = document.querySelector("#docCv");
    const c = cv.getContext("2d", { willReadFrequently: true });
    const W = cv.width, H = cv.height;
    const grab = () => c.getImageData(0, 0, W, H).data;
    // 1画素の「違う」の閾値（RGB いずれかの差）。同じ絵は1バイトも違わずに描かれるので、
    // 有無と場所は小さい閾値で見る（透かしは意図して薄い＝差 15 前後）。
    // 化けた項目名の「見えるか」は濃い差だけを数える（字の画素が入れ替わったか）。
    const TH_ANY = 6, TH_INK = 40;
    const diff = (a, b, flipB = false, TH = TH_ANY) => {
      let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, j = (y * W + (flipB ? W - 1 - x : x)) * 4;
        if (Math.abs(a[i] - b[j]) > TH || Math.abs(a[i + 1] - b[j + 1]) > TH || Math.abs(a[i + 2] - b[j + 2]) > TH) {
          n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
      }
      return { n, box: n ? [x0, y0, x1, y1] : null };
    };
    // 却下理由が指す場所（drawDoc の座標から。少し余白を持たせる）
    const rowsBottom = (nRows) => 172 + 60 * nRows;
    const REGION = {
      era:    () => [W / 2, 20, W - 14, 60],
      typo:   () => [20, 40, W - 20, 100],
      name:   () => [26, 104, W - 24, 154],
      kami:   () => [26, 104, W - 24, 154],
      minus:  (s) => [26, 170, W - 24, rowsBottom(s.rows.length)],
      soul:   (s) => [26, 170, W - 24, rowsBottom(s.rows.length)],
      four:   (s) => [26, 170, W - 24, rowsBottom(s.rows.length)],
      label:  (s) => [26, 170, W - 24, rowsBottom(s.rows.length)],
      issuer: () => [16, H - 90, W - 100, H - 56],
      date:   () => [16, H - 60, W - 100, H - 20],
      stamp:  () => [W - 80 - 36, H - 78 - 36, W - 80 + 36, H - 78 + 36],
      eye:    () => [W - 80 - 36, H - 78 - 36, W - 80 + 36, H - 78 + 36],
      ju:     () => [0, 0, 120, 120],
      mark:   () => [W / 2 - 72, H / 2 - 92, W / 2 + 72, H / 2 + 92],
    };
    const inside = (box, r) => box[0] >= r[0] && box[1] >= r[1] && box[2] <= r[2] && box[3] <= r[3];
    const MIN_PX = 12;      // これより少ない変化は、実際の画面ではまず気づけない
    // 項目名の1字置換は巧妙系なので小さくてよいが、ё の2点（3px）未満は同形とみなす。
    // í→i（1px）・l→I（1〜2px）はこれで落ち、混同表から外した。
    const LABEL_MIN = 3;

    const out = { locale: loc, cases: [], labelSites: [], eye: null, failPngs: {} };
    const ITEMS = d.ITEMS;
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const saved = it.copy;
      it.copy = { fake: false, anomId: null, seed: 0 };
      d.openInspect(it);
      const gen = grab();
      const spec0 = d.DOCSPECS()[it.id];
      for (const id of d.ANOM_IDS) {
        if (!d.canApply(id, spec0, loc)) continue;
        for (const seed of SEEDS) {
          it.copy = { fake: true, anomId: id, seed };
          d.openInspect(it);
          const img = grab();
          const s = d.buildSpec(it);
          const r = { doc: i, short: it.short, id, seed, reject: d.anomMeta(id, loc).reject, problems: [] };
          if (id === "mirror") {
            const m = diff(img, gen, true, TH_INK);   // 字形のラスタライズは左右対称でないので濃い差だけ
            r.n = m.n; r.box = m.box;
            // 反転して重ねたときに残る差＝鏡になっていない部分。枠線の1px ずれ程度は許す
            if (m.n > W * H * 0.004) r.problems.push(`左右反転した真正と ${m.n}px 食い違う（鏡になっていない）`);
            const plain = diff(img, gen);
            if (plain.n < 500) r.problems.push(`真正との差が ${plain.n}px しかない`);
          } else {
            const m = diff(img, gen);
            r.n = m.n; r.box = m.box;
            if (id === "label") {
              const ink = diff(img, gen, false, TH_INK).n;
              r.ink = ink;
              if (ink < LABEL_MIN) r.problems.push(`字の画素差が ${ink}px しかない（同形＝見抜けない）`);
            } else if (m.n < (id === "blur" ? 500 : MIN_PX)) r.problems.push(`真正との差が ${m.n}px しかない（見抜けない）`);
            if (m.box && REGION[id] && !inside(m.box, REGION[id](s))) {
              r.problems.push(`差が理由の指す場所の外にある: box=${m.box} region=${REGION[id](s).map(Math.round)}`);
            }
          }
          if (r.problems.length) out.failPngs[`${i}_${id}_${seed}`] = cv.toDataURL("image/png");
          out.cases.push(r);
          if (["mirror", "stamp", "eye", "blur", "mark", "ju", "minus", "soul", "four", "kami", "name", "issuer", "date"].includes(id)) break;   // 乱数を使わない異変は1シードで足りる
        }
      }

      // 化けた項目名：混同表の全箇所を1つずつ当てて、字が画素で変わることを確かめる
      const conf = A.confusables(loc);
      spec0.rows.forEach((row, ri) => {
        [...row[0]].forEach((ch, ci) => {
          if (!conf[ch]) return;
          const s = JSON.parse(JSON.stringify(spec0));
          const arr = [...s.rows[ri][0]]; arr[ci] = conf[ch]; s.rows[ri][0] = arr.join("");
          s.flags = {};
          d.drawDoc(spec0); const g = grab();
          const y = 172 + ri * 60;
          const crops = [c.getImageData(26, y, W - 52, 48)];
          d.drawDoc(s); const f = grab();
          crops.push(c.getImageData(26, y, W - 52, 48));
          const m = diff(f, g, false, TH_INK);
          out.labelSites.push({ doc: i, short: it.short, from: row[0], to: s.rows[ri][0], ch, sub: conf[ch], n: m.n,
                                ok: m.n >= LABEL_MIN, crops });
        });
      });
      it.copy = saved;
    }

    // 化けた項目名の目視用シート
    const sites = out.labelSites;
    const sheet = document.createElement("canvas");
    const cw = (W - 52) * 2, ch = 48 * 2;
    sheet.width = cw; sheet.height = Math.max(1, sites.length) * (ch * 2 + 26);
    const sc = sheet.getContext("2d");
    sc.fillStyle = "#fff"; sc.fillRect(0, 0, sheet.width, sheet.height);
    sites.forEach((st, k) => {
      const y0 = k * (ch * 2 + 26);
      sc.fillStyle = st.ok ? "#000" : "#c00"; sc.font = "16px sans-serif";
      sc.fillText(`${st.short}: ${st.ch} → ${st.sub}   (${st.n}px)`, 4, y0 + 18);
      st.crops.forEach((im, q) => {
        const t = document.createElement("canvas"); t.width = im.width; t.height = im.height;
        t.getContext("2d").putImageData(im, 0, 0);
        sc.imageSmoothingEnabled = false;
        sc.drawImage(t, 0, y0 + 24 + q * ch, cw, ch);
      });
      delete st.crops;
    });
    out.labelSheet = sheet.toDataURL("image/png");

    // 見ている印：検分中に実際に瞬くか（開いた目と閉じた目の2状態を観測する）
    const it = ITEMS[0];
    it.copy = { fake: true, anomId: "eye", seed: 1 };
    d.openInspect(it);
    const sx = W - 80 - 20, sy = H - 78 - 12;
    const sig = () => Array.from(c.getImageData(sx, sy, 40, 24).data).join(",");
    const states = new Map();
    const t0 = performance.now();
    while (performance.now() - t0 < 4500) {
      const k = sig();
      if (!states.has(k)) states.set(k, cv.toDataURL("image/png"));
      await new Promise((r) => setTimeout(r, 30));
    }
    out.eye = { states: states.size, pngs: [...states.values()].slice(0, 2) };
    document.querySelector("#btnBack")?.click();
    return out;
  }, { SEEDS });

  const save = (name, url) => writeFileSync(`${OUT}/${name}`, Buffer.from(url.split(",")[1], "base64"));
  save(`label-${locale}.png`, res.labelSheet);
  res.eye.pngs.forEach((u, k) => save(`eye-${locale}-${k}.png`, u));
  for (const [k, u] of Object.entries(res.failPngs)) save(`fail-${locale}-${k}.png`, u);

  for (const r of res.cases) {
    const pass = r.problems.length === 0;
    report.cases.push({ locale, ...r, pass });
    if (!pass) { report.fails.push({ locale, ...r }); console.log(`FAIL ${locale} doc${r.doc}(${r.short}) ${r.id} seed=${r.seed}: ${r.problems.join(" / ")}`); }
  }
  for (const st of res.labelSites) {
    report.cases.push({ locale, id: "label-site", ...st, pass: st.ok });
    if (!st.ok) { report.fails.push({ locale, id: "label-site", ...st }); console.log(`FAIL ${locale} label ${st.short} 「${st.from}」→「${st.to}」 差 ${st.n}px`); }
  }
  const eyeOk = res.eye.states >= 2;
  report.cases.push({ locale, id: "eye-blink", states: res.eye.states, pass: eyeOk });
  if (!eyeOk) { report.fails.push({ locale, id: "eye-blink", states: res.eye.states }); console.log(`FAIL ${locale} 見ている印が瞬かない（観測した状態 ${res.eye.states}）`); }
  if (pageErrors.length) { report.fails.push({ locale, id: "page-error", pageErrors }); console.log(`FAIL ${locale} page error: ${pageErrors.join(" | ")}`); }

  const n = res.cases.length + res.labelSites.length + 1;
  const bad = report.fails.filter((f) => f.locale === locale).length;
  console.log(`${locale}: ${n - bad}/${n} PASS（異変 ${res.cases.length} / 項目名の箇所 ${res.labelSites.length} / 瞬き 1）`);
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`\n${report.fails.length ? "FAIL" : "PASS"}: ${report.cases.length - report.fails.length}/${report.cases.length}  -> ${OUT}/report.json`);
process.exit(report.fails.length ? 1 : 0);
