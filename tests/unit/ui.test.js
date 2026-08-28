/* ============================================================
   UI 文言の多言語化（P2-9）
   仕様書: docs/test-specs/ui-i18n.md（U-01 〜 U-16）
   ------------------------------------------------------------
   いちばん重いのは U-09〜U-12。暗証番号の手掛かりは日本語文字列の中にあり、
   ロケールごとに正解が違う（0315 / 0415 / 0630 / 3004 / 3006）。
   手掛かりと正解がずれると、そのロケールだけ**詰んで進めなくなる**。
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiText, uiKeys, fill, placeholdersIn, UI_LOCALES } from "../../src/ui.js";
import { deadline, localeText, LOCALES } from "../../src/anoms.js";

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

const KANA = /[ぁ-んァ-ヶ]/;
const HAN = /[一-龠々]/;

/** そのロケールの暗証番号の正解（game.js の pinAnswerFor と同じ導出）。 */
function pinAnswerFor(locale) {
  const d = deadline(locale);
  const pad = (n) => String(n).padStart(2, "0");
  return d.order === "MD" ? pad(d.month) + pad(d.day) : pad(d.day) + pad(d.month);
}

describe("U-01..U-04 網羅と構造", () => {
  test("U-01 キー集合が5ロケールで完全に一致する", () => {
    const base = uiKeys();
    for (const loc of UI_LOCALES) {
      const keys = Object.keys(uiText(loc)).sort();
      const missing = base.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !base.includes(k));
      assert.deepEqual(missing, [], `${loc}: キーが足りない（その画面が未定義になる）`);
      assert.deepEqual(extra, [], `${loc}: 余分なキーがある`);
    }
  });

  test("U-02 空文字・undefined が無い", () => {
    for (const loc of UI_LOCALES) {
      const t = uiText(loc);
      for (const [k, v] of Object.entries(t)) {
        assert.equal(typeof v, "string", `${loc}.${k} が文字列でない`);
        assert.ok(v.trim().length > 0, `${loc}.${k} が空`);
      }
    }
  });

  test("U-03 未知のロケールは例外（既定値に落ちない）", () => {
    for (const bad of ["fr", "", null, undefined, "JA", "zh"]) {
      assert.throws(() => uiText(bad), /未対応の locale/,
        `${JSON.stringify(bad)} が通ってしまった`);
    }
  });

  test("U-04 ui.js は DOM / three / localStorage / 乱数 / 時刻に触らない", () => {
    // **文字列リテラルとコメントは対象外。** 訳文には "document" や "documento" が
    // 当然出てくる（英語・スペイン語の「書類」）。素朴に includes で見ると
    // 訳文をコードだと誤判定する。ここはコード部分だけを見る。
    const src = read("src/ui.js");
    let code = "";
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; code += "\n"; continue; }
      if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; code += " "; continue; }
      if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        for (; i < src.length; i++) {
          if (src[i] === "\\") { i++; continue; }
          if (src[i] === q) break;
        }
        code += '""'; continue;
      }
      code += c;
    }
    for (const bad of ["document", "window", "localStorage", "Math.random", "new Date", "THREE"]) {
      assert.ok(!code.includes(bad), `ui.js が ${bad} を参照している（純粋モジュールでなくなる）`);
    }
  });

  test("U-05b UI のロケール一覧が anoms.js と一致する", () => {
    assert.deepEqual([...UI_LOCALES].sort(), [...LOCALES].sort(),
      "UI と書類でロケール一覧がずれている");
  });
});

describe("U-05..U-06 翻訳漏れの検出", () => {
  // 翻訳漏れは「日本語が残っている」形で必ず現れる。
  // 言語選択の "言語 / Language" は全ロケール共通で日本語を含むのが意図なので除く。
  const ALLOW_JP = new Set(["optLang"]);

  test("U-05 en / ru / es に かな・カナ・漢字が残っていない", () => {
    for (const loc of ["en", "ru", "es"]) {
      const t = uiText(loc);
      const hits = Object.entries(t)
        .filter(([k, v]) => !ALLOW_JP.has(k) && (KANA.test(v) || HAN.test(v)))
        .map(([k, v]) => `${k}: ${v.slice(0, 40)}`);
      assert.deepEqual(hits, [], `${loc} に日本語が残っている:\n  ${hits.join("\n  ")}`);
    }
  });

  test("U-06 zh-Hans に かな が残っていない", () => {
    const t = uiText("zh-Hans");
    const hits = Object.entries(t)
      .filter(([k, v]) => !ALLOW_JP.has(k) && KANA.test(v))
      .map(([k, v]) => `${k}: ${v.slice(0, 40)}`);
    assert.deepEqual(hits, [], `zh-Hans に かな が残っている:\n  ${hits.join("\n  ")}`);
  });
});

describe("U-09..U-12 暗証番号の手掛かり（最重要）", () => {
  test("U-09 手掛かり③の日付が、そのロケールの期限日と前日である", () => {
    for (const loc of UI_LOCALES) {
      const t = uiText(loc);
      const ph = placeholdersIn(t.gagFake3);
      // 日付は直書きせず、必ず差し込みで受ける（仕様書 §3.3）。
      // 月は1回だけ出す（「3月14日と3月15日」ではなく「3月14日と15日」）。
      for (const k of ["mon", "d1", "d2"]) {
        assert.ok(ph.includes(k),
          `${loc}.gagFake3 に {${k}} が無い（日付の直書きになっている）: ${t.gagFake3}`);
      }
      // 「月を1回だけ出す」書き方は、前日が同じ月にあることが前提。
      // 期限が1日のロケールを足すなら、この文言を作り直す必要がある。
      const d = deadline(loc);
      assert.ok(d.day >= 2,
        `${loc}: 期限が月初なので「{mon}{d1}日と{d2}日」が破綻する（文言を作り直すこと）`);
    }
  });

  test("U-10 手掛かり①が「4桁」「数字だけ」に相当する情報を含む", () => {
    // 「4」と、桁/数字にあたる語。ロケールごとに綴りが違うので語のリストで見る。
    const DIGITWORD = /4|四|四位|cuatro|четыре|четырёх|four/i;
    for (const loc of UI_LOCALES) {
      const g = uiText(loc).gagMycard;
      assert.match(g, DIGITWORD, `${loc}.gagMycard に「4桁」の情報が無い`);
    }
  });

  test("U-11 手掛かり②が探索への誘導を含む", () => {
    // 「他の紙にも書いた」「部屋に落ちていないか」に当たる示唆。
    // 文面はロケールで違うので、キーの存在と長さ（2行以上）で見る。
    for (const loc of UI_LOCALES) {
      const g = uiText(loc).gagPassword;
      const lines = g.split("<br>").filter((s) => s.trim());
      assert.ok(lines.length >= 3,
        `${loc}.gagPassword が短すぎる（『いつもの』だけでは行き止まりになる）: ${g}`);
    }
  });

  test("U-12 手掛かり③が示す答えが pinAnswerFor と一致する", () => {
    for (const loc of UI_LOCALES) {
      const d = deadline(loc);
      const pad = (n) => String(n).padStart(2, "0");
      // 手掛かりは「期限の日付をそのまま並べたもの」。
      // 並びはロケールの日付表記に従う（ru / es は 日→月）。
      const fromClue = d.order === "MD"
        ? pad(d.month) + pad(d.day)
        : pad(d.day) + pad(d.month);
      assert.equal(fromClue, pinAnswerFor(loc),
        `${loc}: 手掛かりの示す答えと正解がずれている（このロケールだけ詰む）`);
      assert.match(pinAnswerFor(loc), /^\d{4}$/, `${loc}: 正解が4桁でない`);
    }
  });
});

describe("U-13..U-15 差し込みと書式", () => {
  test("U-13 差し込み記号が5ロケールで同じキーに同じ集合で現れる", () => {
    const base = uiText("ja");
    for (const loc of UI_LOCALES) {
      const t = uiText(loc);
      for (const key of Object.keys(base)) {
        const a = [...new Set(placeholdersIn(base[key]))].sort();
        const b = [...new Set(placeholdersIn(t[key]))].sort();
        assert.deepEqual(b, a,
          `${loc}.${key} の差し込み記号が ja と違う（片方だけ穴あきになる）\n` +
          `  ja: ${a.join(",") || "(なし)"}\n  ${loc}: ${b.join(",") || "(なし)"}`);
      }
    }
  });

  test("U-14 fill は埋め忘れを例外にする", () => {
    assert.throws(() => fill("{a} と {b}", { a: 1 }), /\{b\}/);
    assert.equal(fill("{a} と {b}", { a: 1, b: 2 }), "1 と 2");
    assert.equal(fill("記号なし", {}), "記号なし");
  });

  test("U-15 文言に日付・金額を直書きしていない", () => {
    // 「3月15日」「April 15」「¥34,120」のような直書きを禁じる（仕様書 §3.3）。
    const BAD = [
      [/[0-9]{1,2}月[0-9]{1,2}日/, "日付の直書き"],
      [/(January|February|March|April|May|June)\s+[0-9]{1,2}/, "日付の直書き"],
      [/[¥$€₽]\s?[0-9][0-9,. ]*[0-9]/, "金額の直書き"],
    ];
    for (const loc of UI_LOCALES) {
      for (const [k, v] of Object.entries(uiText(loc))) {
        for (const [re, why] of BAD) {
          assert.ok(!re.test(v), `${loc}.${k}: ${why}: ${v.slice(0, 60)}`);
        }
      }
    }
  });
});

describe("U-16 対象外の確認", () => {
  test("U-16 クレジット画面の中身は日本語のまま（翻訳しない）", () => {
    const html = read("index.html");
    const m = html.match(/<div id="creditsBody">([\s\S]*?)<div id="creditsHint"/);
    assert.ok(m, "#creditsBody が見つからない");
    // ライセンス表記は義務で置いてあるもの。利用者の指示で日本語のままにしてある。
    assert.ok(KANA.test(m[1]) || HAN.test(m[1]),
      "クレジットが翻訳されている。ここは日本語のままにする（仕様書 §1.1）");
  });
});

describe("U-07..U-08 ソースに翻訳対象の日本語が残っていない", () => {
  /** JS のコメントと、HTML/CSS のコメントを落とす。
   * コメントの日本語は画面に出ないので対象外。 */
  function stripComments(src, kind) {
    if (kind === "html") {
      return src.replace(/<!--[\s\S]*?-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    }
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

  // 意図的に日本語のまま残すもの。
  //  - 言語選択は各言語を自分の名前で出す（英語版でも「日本語」と出るのが正しい）
  //  - 開発者向けの例外メッセージは画面に出ない
  //  - <title> は起動直後に document.title = TXT.title で上書きする。
  //    静的な値は作品の正式名称（ストア名）なので日本語のままでよい。
  const ALLOWED = [
    "言語 / Language", "日本語", "简体中文",
    "UI 文言のキーが無い",
    "カクシン様 ─ 確定申告からは逃げられない",
  ];

  test("U-07 index.html に翻訳対象の日本語が直書きされていない（#credits を除く）", () => {
    let html = stripComments(read("index.html"), "html");
    // クレジットはライセンス表記なので日本語のまま（仕様書 §1.1）
    const from = html.indexOf('<div id="credits"');
    const to = html.indexOf("</div>", html.indexOf('id="cBack"'));
    if (from >= 0 && to > from) html = html.slice(0, from) + html.slice(to);

    const hits = [];
    for (const m of html.matchAll(/>([^<>]+)</g)) {
      const s = m[1].trim();
      if (s && (KANA.test(s) || HAN.test(s)) && !ALLOWED.includes(s)) hits.push(s);
    }
    assert.deepEqual(hits, [],
      `data-t を付け忘れた文言がある（実機まで気付けない）:\n  ${hits.join("\n  ")}`);
  });

  test("U-08 src/game.js に翻訳対象の日本語リテラルが残っていない", () => {
    const src = stripComments(read("src/game.js"), "js");
    const hits = [];
    for (const m of src.matchAll(/(["'`])((?:\.|(?!\1)[\s\S])*?)\1/g)) {
      const s = m[2];
      if (!KANA.test(s) && !HAN.test(s)) continue;
      if (ALLOWED.some((a) => s.includes(a))) continue;
      // GLSL は画面に文字を出さない（コメントに日本語があるだけ）
      if (/gl_FragColor|texture2D|varying/.test(s)) continue;
      hits.push(s.slice(0, 50));
    }
    assert.deepEqual(hits, [],
      `game.js に日本語の文言が残っている（ui.js へ移すこと）:\n  ${hits.join("\n  ")}`);
  });
});

describe("U-17 約物がロケールの組版に合っている", () => {
  /* 翻訳漏れ（U-05）は「日本語の単語が残る」形で出るが、**約物のズレは単語では出ない**。
     英文に全角スラッシュや和字間隔が混ざったまま気付かない、という壊れ方をする。
     書類描画で全角コロン（「Выдал ： ООО」）を直したのと同じ種類の問題。 */
  const JP_PUNCT = [
    ["／", "全角スラッシュ U+FF0F", "/"],
    ["　", "和字間隔 U+3000", "半角スペース"],
    ["……", "二重三点リーダ", "… ひとつ"],
    ["——", "二重ダッシュ", "— ひとつ"],
    ["、", "読点", ","],
    ["。", "句点", "."],
    ["「", "かぎ括弧", "引用符"],
    ["」", "かぎ括弧", "引用符"],
    ["『", "二重かぎ", "引用符"],
    ["』", "二重かぎ", "引用符"],
    ["（", "全角丸括弧", "()"],
    ["）", "全角丸括弧", "()"],
    ["：", "全角コロン", ":"],
    ["！", "全角感嘆符", "!"],
    ["？", "全角疑問符", "?"],
    ["【", "隅付き括弧", "[]"],
    ["】", "隅付き括弧", "[]"],
  ];

  test("U-17a en / ru / es に和文用の約物が混ざっていない", () => {
    for (const loc of ["en", "ru", "es"]) {
      const t = uiText(loc);
      const hits = [];
      for (const [k, v] of Object.entries(t)) {
        if (k === "optLang") continue;   // 言語選択は日本語を含むのが意図
        for (const [ch, name, better] of JP_PUNCT) {
          if (v.includes(ch)) hits.push(`${loc}.${k}: ${name} → ${better}`);
        }
      }
      assert.deepEqual(hits, [],
        `和文の組版のまま欧文を流し込んでいる:\n  ${hits.join("\n  ")}`);
    }
  });

  test("U-17b zh-Hans が日本式のかぎ括弧を使っていない", () => {
    // 簡体字中国語は「」『』を使わない。引用は “”、文書名は《》。
    const t = uiText("zh-Hans");
    const hits = Object.entries(t)
      .filter(([, v]) => /[「」『』]/.test(v))
      .map(([k, v]) => `${k}: ${v.slice(0, 40)}`);
    assert.deepEqual(hits, [],
      `zh-Hans に日本式のかぎ括弧が残っている（“” / 《》 にする）:\n  ${hits.join("\n  ")}`);
  });

  test("U-17c ja は和文の約物のまま（欧文化していない）", () => {
    // 逆方向の事故（一括置換で日本語まで巻き込む）を防ぐ。
    const t = uiText("ja");
    assert.ok(t.ctrlPc.includes("／"), "ja の区切りが半角スラッシュになっている");
    assert.ok(t.rankLine.includes("　"), "ja の字下げが半角スペースになっている");
    assert.ok(t.omenGone.startsWith("……"), "ja の三点リーダが1つになっている");
  });
});
