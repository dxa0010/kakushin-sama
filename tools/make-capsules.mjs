/* ============================================================
   Steam ストア用カプセル・ライブラリ資産の合成（P6-1）
   ------------------------------------------------------------
   下地（AI生成のキーアート）＋ロゴタイプを合成して、Steam の各枠を
   **正確な画素数で**書き出す。

   なぜ headless Chromium で組むのか（3つとも実測に基づく制約）:

   (1) **`agy`（Gemini）は文字を描けない。** 短い数行でも崩れるし、日本語は
       非日本語が混ざる（tools/genimage.mjs の実測メモ参照）。カプセルには
       **必ずロゴタイプが要る**（Steam の規約: 「読める製品ロゴ」が必須）ので、
       画像生成だけではカプセルが1枚も作れない。文字はこちらで置く。
   (2) **フォントはゲームと同じものを使う。** assets/fonts の Noto サブセットを
       data URI で埋める。ストアのロゴとゲーム内の見出しが別書体だと、
       カプセルからゲームに入った瞬間に「別物」に見える。
   (3) **透過が要る資産がある。** ライブラリロゴは透過 PNG 必須。
       agy の出力は JPEG 固定で透過を持てない。

   ⚠️ **Steam の規約（partner.steamgames.com/doc/store/assets/rules）**
       カプセルに置いてよい文字は **ゲーム名と公式サブタイトルだけ**。
       レビュー点数・受賞歴・「Now Available」「50% OFF」等は**全部禁止**。
       違反すると露出が落ち、公式セールに出られなくなる。
       ここで組んでいるのは題名とサブタイトルのみ。**後から足さないこと。**
       ライブラリヒーローは **文字を一切入れてはいけない**（別枠）。

   前提: リポジトリルートで `python -m http.server 8765`（キーアートの取り込みには不要。
         フォントはファイルから直接読んで data URI にする）
   実行:
     cp tools/make-capsules.mjs "$APPDATA/npm/node_modules/"
     cd "$APPDATA/npm/node_modules"
     node make-capsules.mjs --repo C:/Users/dxa00/projects/kakusinsan/kakushin-sama \
       --art docs/storeart --out C:/tmp/store/capsules [--locale ja|en] [名前...]

   出力される枠と寸法の出典:
     partner.steamgames.com/doc/store/assets/standard
     partner.steamgames.com/doc/store/assets/libraryassets
   ============================================================ */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
let REPO = "C:/Users/dxa00/projects/kakusinsan/kakushin-sama";
let ART = "C:/Users/dxa00/projects/kakusinsan/kakushin-sama/docs/storeart", OUT = "C:/tmp/store/capsules", LOCALE = "ja";
const names = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--repo") REPO = argv[++i];
  else if (argv[i] === "--art") ART = argv[++i];
  else if (argv[i] === "--out") OUT = argv[++i];
  else if (argv[i] === "--locale") LOCALE = argv[++i];
  else names.push(argv[i]);
}

/* 題名とサブタイトルは docs/STEAM-RELEASE.md §14.0 の決定稿。
   ⚠️ ここを勝手に変えないこと。実績名・ストア名と同じ文字列でなければならない。
   非日本語圏はラテン文字 KAKUSHIN で固定（「确信」は音でブランドが繋がらない）。 */
const TITLE = {
  ja: { logo: "カクシン様", sub: "確定申告からは逃げられない", serif: true, tracking: "0.06em" },
  en: { logo: "KAKUSHIN",   sub: "NO ESCAPE FROM YOUR TAX RETURN", serif: true, tracking: "0.14em" },
};

/* 出力する枠。art は下地（land=横位置 / port=縦位置 / null=下地なし）。
   layout はロゴの置き方。 */
const ASSETS = {
  // --- ストア（必須4種） ---
  main_capsule:     { w: 1232, h: 706,  art: "land", layout: "hero" },
  header_capsule:   { w: 920,  h: 430,  art: "land", layout: "hero" },
  // 「ロゴが小カプセルをほぼ埋めること」が Steam の指示。120x45 まで縮むので、
  // 下地を強く沈めてロゴだけが残るようにする。
  small_capsule:    { w: 462,  h: 174,  art: "land", layout: "logo" },
  vertical_capsule: { w: 748,  h: 896,  art: "port", layout: "vert" },
  // --- ストア（任意） ---
  page_background:  { w: 1438, h: 810,  art: "land", layout: "art" },
  // --- ライブラリ（公開後に必要） ---
  library_capsule:  { w: 600,  h: 900,  art: "port", layout: "vert" },
  library_header:   { w: 920,  h: 430,  art: "land", layout: "hero" },
  // ⚠️ ヒーローは文字禁止。layout:"art" は文字を一切置かない。
  library_hero:     { w: 3840, h: 1240, art: "land", layout: "art" },
  // ロゴタイプのみ・透過 PNG。幅 1280 か高さ 720 のどちらかに合わせる。
  library_logo:     { w: 1280, h: 560,  art: null,   layout: "logoonly", alpha: true },
};

const unknown = names.filter(n => !(n in ASSETS));
if (unknown.length) { console.error("unknown asset:", unknown.join(", ")); process.exit(1); }
const targets = Object.entries(ASSETS).filter(([n]) => !names.length || names.includes(n));
mkdirSync(OUT, { recursive: true });

/** ファイルを data URI にする。setContent は about:blank 相当で走るので、
    localhost の相対 URL もフォントの CORS も当てにできない。全部埋め込む。 */
function dataURI(path, mime) {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

const fontSerif = dataURI(join(REPO, "assets/fonts/kakushin-serif-jp.woff2"), "font/woff2");
const fontSans  = dataURI(join(REPO, "assets/fonts/kakushin-sans-jp.woff2"),  "font/woff2");
const artLand = existsSync(join(ART, "key_16x9.jpg"))     ? dataURI(join(ART, "key_16x9.jpg"), "image/jpeg")     : null;
const artPort = existsSync(join(ART, "key_portrait.jpg")) ? dataURI(join(ART, "key_portrait.jpg"), "image/jpeg") : null;
if (!artLand || !artPort) { console.error("キーアートが見つからない:", ART); process.exit(1); }

const T = TITLE[LOCALE];
if (!T) { console.error("unknown locale:", LOCALE); process.exit(1); }

/* ロゴタイプ。題名＋サブタイトル＋朱印のモチーフだけで構成する。
   朱印はゲーム内の書類に押されている「印」と同じ意味を持たせている
   （＝この作品の記号）。scale で枠ごとに一括で拡大縮小する。 */
function logoHTML({ scale = 1, sub = true, seal = true, align = "center" }) {
  return `
  <div class="logo" style="--s:${scale}; text-align:${align}">
    <div class="row">
      ${seal ? `<div class="seal">印</div>` : ""}
      <div class="name">${T.logo}</div>
    </div>
    ${sub ? `<div class="sub">${T.sub}</div>` : ""}
  </div>`;
}

/* 下地の置き方。object-position で「顔と光源を枠内に残す」ことだけ意識する。
   ⚠️ 縦位置の絵は床の書類に読めない文字が写っている。規約の「その他の文字は不可」に
   触れかねないので、縦枠では下寄せにして床を枠外へ逃がす。 */
function bgHTML(kind, dim) {
  const src = kind === "port" ? artPort : artLand;
  const pos = kind === "port" ? "50% 22%" : "50% 45%";
  return `<img class="bg" src="${src}" style="object-position:${pos}">
          <div class="scrim" style="--dim:${dim}"></div>`;
}

function pageHTML(a) {
  const { w, h, art, layout } = a;
  let body = "";
  if (layout === "art") {
    body = bgHTML(art, 0.15);
  } else if (layout === "logoonly") {
    body = logoHTML({ scale: w / 620, sub: true, seal: true });
  } else if (layout === "logo") {
    // 小カプセル: 下地は気配だけ。ロゴが枠をほぼ埋める。
    // 初期値は大きめに置いて、後段の autoFit が枠に収まるまで縮める。
    body = bgHTML(art, 0.72) + logoHTML({ scale: w / 560, sub: false, seal: true });
  } else if (layout === "vert") {
    body = bgHTML(art, 0.30) + `<div class="vgrad"></div>` + logoHTML({ scale: w / 620, sub: true, seal: true });
  } else {
    body = bgHTML(art, 0.34) + `<div class="hgrad"></div>` + logoHTML({ scale: w / 900, sub: true, seal: true });
  }
  const bottom = (layout === "vert");
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family:"Kakushin Serif"; src:url(${fontSerif}) format("woff2"); font-weight:100 900; }
  @font-face { font-family:"Kakushin Sans";  src:url(${fontSans})  format("woff2"); font-weight:100 900; }
  html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;
            background:${a.alpha ? "transparent" : "#07070a"};}
  .wrap{position:relative;width:${w}px;height:${h}px;display:flex;
        align-items:${bottom ? "flex-end" : "center"};justify-content:center;
        padding-bottom:${bottom ? Math.round(h * 0.07) : 0}px;box-sizing:border-box;}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  /* 全体を沈める幕。カプセルは 120x45 まで縮むので、下地が明るいとロゴが読めなくなる。 */
  .scrim{position:absolute;inset:0;background:#05060a;opacity:var(--dim);}
  /* 横長枠: 右下から中央へ向かう暗がり。ロゴを乗せる面を作る。 */
  .hgrad{position:absolute;inset:0;
    background:radial-gradient(120% 90% at 50% 60%, rgba(4,5,9,.86) 0%, rgba(4,5,9,.55) 45%, rgba(4,5,9,0) 78%);}
  /* 縦長枠: 下半分を沈めてロゴの座を作る。 */
  .vgrad{position:absolute;inset:0;
    background:linear-gradient(to bottom, rgba(4,5,9,0) 38%, rgba(4,5,9,.80) 72%, rgba(4,5,9,.96) 100%);}
  .logo{position:relative;z-index:2;}
  .row{display:flex;align-items:center;justify-content:center;gap:calc(28px * var(--s));
       white-space:nowrap;}
  /* 朱印。ゲーム内の書類に押されている印と同じ記号にしてある。 */
  .seal{font-family:"Kakushin Serif",serif;font-weight:700;
    width:calc(78px * var(--s));height:calc(78px * var(--s));line-height:calc(78px * var(--s));
    font-size:calc(46px * var(--s));text-align:center;color:#c0403a;
    border:calc(4px * var(--s)) solid #c0403a;border-radius:50%;
    opacity:.92;transform:rotate(-7deg);
    text-shadow:0 0 calc(10px * var(--s)) rgba(192,64,58,.55);}
  .name{font-family:"Kakushin Serif",serif;font-weight:700;
    font-size:calc(104px * var(--s));line-height:1.0;color:#efe9da;
    letter-spacing:${T.tracking};
    text-shadow:0 calc(3px * var(--s)) calc(26px * var(--s)) rgba(0,0,0,.95),
                0 0 calc(4px * var(--s)) rgba(0,0,0,.85);}
  .sub{font-family:"Kakushin Sans",sans-serif;font-weight:500;
    margin-top:calc(20px * var(--s));
    font-size:calc(27px * var(--s));color:#b9b1a1;letter-spacing:0.20em;
    text-shadow:0 calc(2px * var(--s)) calc(14px * var(--s)) rgba(0,0,0,.95);}
  </style><div class="wrap">${body}</div>`;
}

const browser = await chromium.launch({ headless: true });
for (const [name, a] of targets) {
  const page = await browser.newPage({
    viewport: { width: a.w, height: a.h },
    deviceScaleFactor: 1,
  });
  await page.setContent(pageHTML(a), { waitUntil: "load" });
  // data URI のフォントと画像が実際に載るまで待つ。ここを飛ばすと
  // 代替フォントで焼かれた PNG が出てくる（見た目では気付きにくい）。
  await page.evaluate(() => document.fonts.ready);

  /* ロゴを枠に合わせて縮める。**固定倍率で組むと必ずどこかで溢れる**：
     「カクシン様」は5字、"KAKUSHIN" は8字で、同じ font-size でも実寸が倍近く違う。
     実測（初回）: 小カプセル 462px に対して日本語のロゴが 517px になり、
     2行に折れて「様」が枠外へ落ちた。字数ではなく**描画後の実寸**で決める。 */
  const fit = await page.evaluate((maxRatio) => {
    const row = document.querySelector(".row");
    const logo = document.querySelector(".logo");
    if (!row || !logo) return null;
    const limit = document.body.clientWidth * maxRatio;
    let s = parseFloat(getComputedStyle(logo).getPropertyValue("--s")) || 1;
    for (let i = 0; i < 40 && row.getBoundingClientRect().width > limit; i++) {
      s *= 0.96;
      logo.style.setProperty("--s", String(s));
    }
    return { scale: +s.toFixed(3), width: Math.round(row.getBoundingClientRect().width), limit: Math.round(limit) };
  }, a.layout === "logo" ? 0.90 : 0.82);
  if (fit) console.log(`  fit: --s=${fit.scale}  row=${fit.width}px / limit=${fit.limit}px`);

  await page.waitForTimeout(250);
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    omitBackground: !!a.alpha,
  });
  console.log(`saved ${name}.png  ${a.w}x${a.h}${a.alpha ? "  (透過)" : ""}`);
  await page.close();
}
await browser.close();
