/* ロケールごとに「ゲームが表示しうる文字」を全部集める。
 *
 * フォントのサブセットは必ずここを通す（P2-7 / L-14）。本文だけを拾うと、
 * 異変が出す字（confusableOutputs：ъ・戸・醫 など素の本文には無い）が
 * サブセットから落ちて豆腐になる。豆腐は「本物の異変ではない視覚的な差異」
 * なので、L-2（見えているものと却下理由が一致する）に真正面から反する。
 *
 * 出力は assets/fonts/charset-<locale>.txt（1行、重複なし、コードポイント順）。
 * サブセット生成コマンドはこのファイルだけを入力に取る。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOCALES, ANOM_IDS, docSpecs, localeText, anomMeta,
  confusableOutputs, codexOrigin, pinHint, authority,
} from "../src/anoms.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** コメントを落とす。
 * 本作のコメントは日本語で長く、しかも数式（J⁻ᵗ、≒、π）が混ざる。
 * これを表示文字として拾うと、実際には一度も描かれない字のために
 * サブセットが太る。**逆に、落としすぎると豆腐になる**ので、
 * 落とすのはコメントだけに限る（文字列リテラルには一切触れない）。 */
function stripComments(src, kind) {
  // index.html は <style> を内包するので、HTML コメントと CSS コメントの両方を消す。
  // CSS コメントを見落とすと、フォントの説明コメントに書いた例示文字
  // （「银 汇 缴 …」「豆腐（□）」など）がそのまま charset に混ざり、
  // 実際には一度も描かれない字のためにサブセットが太る。
  if (kind === "html") return src.replace(/<!--[\s\S]*?-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  // 文字列・テンプレートリテラル・正規表現を読み飛ばしながら、コメントだけ消す。
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; out += " "; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      for (; i < src.length; i++) {
        out += src[i];
        if (src[i] === "\\") { i++; if (i < src.length) out += src[i]; continue; }
        if (src[i] === q) break;
      }
      continue;
    }
    out += c;
  }
  return out;
}

/** UI（index.html と game.js の文字列リテラル）に出る字。
 * ここはロケール非依存の日本語 UI が中心だが、将来 UI を翻訳しても
 * 同じ手順で拾えるよう、ソースから機械的に集める。 */
function uiChars() {
  const set = new Set();
  for (const [rel, kind] of [["index.html", "html"], ["src/game.js", "js"]]) {
    const src = stripComments(readFileSync(join(ROOT, rel), "utf8"), kind);
    // ソース中の非 ASCII は基本すべて表示文字（識別子に日本語は使っていない）。
    // ASCII は全域を無条件で入れるので、ここでは非 ASCII だけ集めれば足りる。
    for (const ch of src) if (ch.codePointAt(0) > 0x7f) set.add(ch);
  }
  return set;
}

/** 表示に使う ASCII の全域。数字・記号・英字は locale を問わず出る
 * （金額、日付、暗証番号、ボタン、"OK" 等）。区別して削る利得より、
 * 落として豆腐になる危険のほうが大きい。 */
const ASCII = (() => {
  let s = "";
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
  return s;
})();

export function charsetFor(locale) {
  const set = new Set([...ASCII, ...uiChars()]);
  const add = (s) => { for (const ch of String(s)) set.add(ch); };

  const T = localeText(locale);
  for (const v of Object.values(T)) add(v);

  const specs = docSpecs(locale);
  for (const d of Object.values(specs)) {
    add(d.short); add(d.title); add(d.issuer); add(d.era); add(d.date); add(d.name);
    for (const r of d.rows) { add(r[0]); add(r[1]); }
  }

  for (const id of ANOM_IDS) {
    const m = anomMeta(id, locale);
    add(m.name); add(m.reject);
    const o = codexOrigin(id, locale);
    if (o) add(o);
  }
  add(pinHint(locale));
  add(authority(locale));

  // 異変が出力する字。本文には現れないので、ここを足さないと豆腐になる。
  add(confusableOutputs()[locale]);

  // 通貨・記号で本文から漏れうるもの。
  add("−¥$₽€※：、。／—─…“”«»");

  return [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join("");
}

if (process.argv[1] && process.argv[1].endsWith("charset.mjs")) {
  const dir = join(ROOT, "assets", "fonts");
  mkdirSync(dir, { recursive: true });
  for (const locale of LOCALES) {
    const cs = charsetFor(locale);
    writeFileSync(join(dir, `charset-${locale}.txt`), cs, "utf8");
    const cjk = [...cs].filter((c) => c.codePointAt(0) >= 0x2e80).length;
    console.log(`${locale.padEnd(8)} ${String([...cs].length).padStart(4)} 字 (うち CJK 等 ${cjk})`);
  }
}
