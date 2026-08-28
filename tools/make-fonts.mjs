/* 同梱フォントのサブセットを作る（P2-7）。
 *
 * **これは出荷手順ではない。** 生成物（.woff2 と .cmap.txt）をコミットし、
 * 配信時には何も実行しない。リポジトリの方針「ビルドはしない・依存は足さない」
 * を破らないため、このツールが要るのはフォントを作り直すときだけである。
 *
 * 必要なもの（開発機のみ）:
 *   python -m pip install fonttools brotli
 *   元フォント（OFL, Google Fonts より）を FONT_SRC に置く
 *
 * 使い方:
 *   node tools/charset.mjs        # 先に charset-<locale>.txt を作る
 *   node tools/make-fonts.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LOCALES } from "../src/anoms.js";
import { charsetFor } from "./charset.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "fonts");
const SRC = process.env.FONT_SRC || "C:/tmp/fonts-src";

/** ロケール → 使うフォント。zh-Hans だけ SC 系。
 * 日本語フォント（JIS 系）は簡体字専用の字（银・汇・缴・鹭・额・户・备・编・费）を
 * 持たない＝実測済み。ここを一本化すると zh-Hans が豆腐になる。 */
const PLAN = {
  ja: "jp", en: "jp", ru: "jp", es: "jp", "zh-Hans": "sc",
};

/** 出力ファミリ。**Noto を名前に残さないこと。**
 * OFL 1.1 は Reserved Font Name の付いた名前を改変版に使うことを禁じており、
 * サブセットは改変にあたる（docs/test-specs/font-bundling.md §3.3）。 */
const FACES = [
  { out: "kakushin-sans-jp",  src: "sansjp.ttf",   group: "jp" },
  { out: "kakushin-serif-jp", src: "serifjp.ttf",  group: "jp" },
  { out: "kakushin-sans-sc",  src: "sanssc.ttf",   group: "sc" },
  { out: "kakushin-serif-sc", src: "serifsc.ttf",  group: "sc" },
  { out: "kakushin-mono",     src: "sansmono.ttf", group: "mono" },
];

const py = (code) => execFileSync("python", ["-c", code], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
}).trim();

/** そのフォントが実際に収録しているコードポイント。
 * サブセット後のファイルを読み直して求める。入力の charset を書き写すと、
 * 元フォントに無かった字まで「入っている」ことにしてしまい、
 * マニフェストが実物とずれる（仕様書 §4.1 F-04）。 */
function cmapOf(path) {
  const out = py(
    "import sys,json\n" +
    "from fontTools.ttLib import TTFont\n" +
    "t=TTFont(sys.argv[0] if False else " + JSON.stringify(path) + ",lazy=True)\n" +
    "s=set()\n" +
    "for tb in t['cmap'].tables: s|=set(tb.cmap.keys())\n" +
    "print(json.dumps(sorted(s)))"
  );
  return new Set(JSON.parse(out));
}

function subset(srcPath, outPath, chars) {
  // pyftsubset は文字集合をファイルで受け取る。コマンドラインに数百字を渡すと
  // Windows の長さ制限に引っかかるため。作業用なので必ず後で消す（出荷物に混ぜない）。
  const listFile = outPath + ".chars.tmp";
  writeFileSync(listFile, chars, "utf8");
  try {
  execFileSync("python", [
    "-m", "fontTools.subset", srcPath,
    `--text-file=${listFile}`,
    `--output-file=${outPath}`,
    "--flavor=woff2",
    "--layout-features=",          // 合字・カーニングは使わない（等幅の桁揃えを崩さない）
    "--no-hinting",
    "--desubroutinize",
    "--drop-tables+=DSIG",
    "--name-IDs=*",                // 著作権表示（name ID 0/7/13/14）を残す＝OFL の条件
    "--recalc-bounds",
  ], { stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  } finally {
    rmSync(listFile, { force: true });
  }
  return outPath;
}

mkdirSync(OUT, { recursive: true });

// ---- 1. ロケールの charset を書き出す（charset.mjs と同じ結果） ----
const charsets = {};
for (const locale of LOCALES) {
  const cs = charsetFor(locale);
  charsets[locale] = cs;
  writeFileSync(join(OUT, `charset-${locale}.txt`), cs, "utf8");
}

// ---- 2. グループごとの入力文字集合 ----
const union = (arr) => [...new Set(arr.flatMap((s) => [...s]))]
  .sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join("");

const GROUP_CHARS = {
  jp: union(LOCALES.filter((l) => PLAN[l] === "jp").map((l) => charsets[l])),
  sc: union(LOCALES.filter((l) => PLAN[l] === "sc").map((l) => charsets[l])),
  // mono は金額・日付・暗証番号にしか使わないが、どの字が来るかを絞り込むより
  // 全体を渡して「元フォントにある分だけ」入るに任せるほうが安全（漏れが出ない）。
  mono: union(LOCALES.map((l) => charsets[l])),
};

// ---- 3. サブセット生成 ----
const made = [];
for (const f of FACES) {
  const srcPath = join(SRC, f.src);
  if (!existsSync(srcPath)) throw new Error(`元フォントが無い: ${srcPath}（FONT_SRC を設定するか取得すること）`);
  const outPath = join(OUT, `${f.out}.woff2`);
  subset(srcPath, outPath, GROUP_CHARS[f.group]);
  const cm = cmapOf(outPath);
  writeFileSync(join(OUT, `${f.out}.cmap.txt`),
    [...cm].sort((a, b) => a - b).map((c) => c.toString(16)).join("\n"), "utf8");
  made.push({ ...f, outPath, cm, size: statSync(outPath).size });
  console.log(`${f.out.padEnd(18)} ${String(cm.size).padStart(5)} 字  ${(made.at(-1).size / 1024).toFixed(0)} KB`);
}

// ---- 4. 穴埋めフォント ----
// 主フォントに無い字を集める。実測では ₽（U+20BD, CJK 系フォントに一切無い）と
// 简（U+7B80, 言語選択の「简体中文」。日本語フォントに無い）が該当した。
// これらは「主フォントの後ろに置く小さな face」で埋める。CSS のフォント
// フォールバックが字ごとに効くので、unicode-range を手で管理する必要は無い。
const byOut = Object.fromEntries(made.map((m) => [m.out, m]));
const gapSet = new Set();
for (const locale of LOCALES) {
  const grp = PLAN[locale];
  for (const ch of charsets[locale]) {
    const cp = ch.codePointAt(0);
    const covered = made.some((m) => (m.group === grp) && m.cm.has(cp));
    if (!covered) gapSet.add(ch);
  }
}
// 穴埋めに使えるのは、その字を実際に持っている元フォント。
// 実測では1つの元フォントでは賄えなかった（₽ は mono だけ、简 は SC だけが持つ）。
// そこで提供元ごとに小さな face を分けて出す。CSS のフォールバックは
// 字ごとに効くので、スタックに並べるだけで済む。
const DONORS = ["sanssc.ttf", "sansmono.ttf", "sansjp.ttf"];
const gapChars = [...gapSet].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join("");
const fallbacks = [];
if (gapChars) {
  const donorCmaps = Object.fromEntries(DONORS.map((d) => [d, cmapOf(join(SRC, d))]));
  const orphan = [...gapChars].filter((c) =>
    !DONORS.some((d) => donorCmaps[d].has(c.codePointAt(0))));
  if (orphan.length) {
    // 黙って落とさない。ここに来たら文言側かフォント選定側の手当てが要る。
    throw new Error(`どの元フォントにも無い字がある（実機で豆腐になる）: ` +
      orphan.map((c) => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase()})`).join(", "));
  }
  let remaining = [...gapChars];
  let n = 0;
  for (const d of DONORS) {
    const mine = remaining.filter((c) => donorCmaps[d].has(c.codePointAt(0)));
    if (!mine.length) continue;
    remaining = remaining.filter((c) => !mine.includes(c));
    n += 1;
    const name = `kakushin-fallback-${n}`;
    const outPath = join(OUT, `${name}.woff2`);
    subset(join(SRC, d), outPath, mine.join(""));
    const cm = cmapOf(outPath);
    writeFileSync(join(OUT, `${name}.cmap.txt`),
      [...cm].sort((a, b) => a - b).map((c) => c.toString(16)).join("\n"), "utf8");
    fallbacks.push({ name, size: statSync(outPath).size });
    console.log(`${name.padEnd(18)} ${String(cm.size).padStart(5)} 字  ` +
      `${(statSync(outPath).size / 1024).toFixed(1)} KB  [${mine.join("")}] <- ${d}`);
    if (!remaining.length) break;
  }
} else {
  console.log("穴埋めフォントは不要（主フォントで全字を賄えている）");
}

// ---- 5. OFL 全文を同梱（再配布の条件） ----
const ofl = join(SRC, "OFL.txt");
if (!existsSync(ofl)) throw new Error("OFL.txt が無い。ライセンス全文の同梱は再配布の条件。");
writeFileSync(join(OUT, "OFL.txt"), readFileSync(ofl, "utf8"), "utf8");

const total = made.reduce((a, m) => a + m.size, 0) +
  fallbacks.reduce((a, f) => a + f.size, 0);
console.log(`\n合計 ${(total / 1024 / 1024).toFixed(2)} MB` +
  (fallbacks.length ? `（穴埋め ${fallbacks.map((f) => f.name).join(", ")} を含む）` : ""));
