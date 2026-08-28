/* ============================================================
   フォント同梱とサブセット（P2-7）
   仕様書: docs/test-specs/font-bundling.md（F-01 〜 F-12）
   ------------------------------------------------------------
   要点は1つ。**同梱フォントだけで全ロケールが豆腐なしに描けること。**
   Proton / Steam Deck には日本語・中国語フォントが無いのが既定なので、
   OS フォントに頼っている限り「実機で全文が □ になる」まで気付けない。
   ここはその代わりに、ソースとフォントの cmap を突き合わせる層になる。
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { LOCALES, confusableOutputs, docSpecs, localeText, anomMeta, ANOM_IDS,
         codexOrigin, pinHint, authority } from "../../src/anoms.js";
import { charsetFor } from "../../tools/charset.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");
const has = (rel) => existsSync(new URL(rel, ROOT));

/** そのフォントが実際に収録しているコードポイント。
 * .cmap.txt は make-fonts.mjs が **サブセット後のファイルを読み直して** 出す。 */
const cmapOf = (name) =>
  new Set(read(`assets/fonts/${name}.cmap.txt`).split("\n")
    .filter(Boolean).map((h) => parseInt(h, 16)));

/** ロケール → 主フォント（仕様書 §3.2）。 */
const PLAN = { ja: "jp", en: "jp", ru: "jp", es: "jp", "zh-Hans": "sc" };
const FACES_FOR = (grp) =>
  [`kakushin-sans-${grp}`, `kakushin-serif-${grp}`];

/** 穴埋め face（`简` と `₽`）。提供元の元フォントが違うので複数に分かれる。
 * 枚数を決め打ちすると、穴が増えて -3 が出たときに黙って見落とす。 */
const FALLBACK_FACES = () => {
  const out = [];
  for (let i = 1; i <= 9; i++) {
    const n = `kakushin-fallback-${i}`;
    if (has(`assets/fonts/${n}.cmap.txt`)) out.push(n); else break;
  }
  return out;
};
const FALLBACK_CPS = () => {
  const s = new Set();
  for (const n of FALLBACK_FACES()) for (const cp of cmapOf(n)) s.add(cp);
  return s;
};

describe("F-01..F-03 charsetFor が表示しうる字を取りこぼさない", () => {
  test("F-01 書類・異変・図鑑・当局名の全文字が入っている", () => {
    for (const locale of LOCALES) {
      const cs = new Set(charsetFor(locale));
      const need = [];
      const push = (s) => { if (s) need.push(...String(s)); };

      for (const v of Object.values(localeText(locale))) push(v);
      for (const d of Object.values(docSpecs(locale))) {
        push(d.short); push(d.title); push(d.issuer); push(d.era); push(d.date); push(d.name);
        for (const r of d.rows) { push(r[0]); push(r[1]); }
      }
      for (const id of ANOM_IDS) {
        const m = anomMeta(id, locale);
        push(m.name); push(m.reject); push(codexOrigin(id, locale));
      }
      push(pinHint(locale)); push(authority(locale));

      const missing = [...new Set(need)].filter((c) => !cs.has(c));
      assert.deepEqual(missing, [],
        `${locale}: charsetFor が取りこぼしている: ${missing.join("")}`);
    }
  });

  test("F-02 異変が出す字（本文に現れない）が入っている", () => {
    const outs = confusableOutputs();
    for (const locale of LOCALES) {
      const cs = new Set(charsetFor(locale));
      const missing = [...outs[locale]].filter((c) => !cs.has(c));
      // ここが落ちると、異変の字だけ豆腐になる。豆腐は「本物ではない見える差異」
      // なので、プレイヤーは豆腐を通報して却下される＝L-2 違反。
      assert.deepEqual(missing, [],
        `${locale}: 異変の出力字が落ちている: ${missing.join("")}`);
    }
  });

  test("F-03 表示可能 ASCII を全域含む", () => {
    for (const locale of LOCALES) {
      const cs = new Set(charsetFor(locale));
      const missing = [];
      for (let c = 0x20; c <= 0x7e; c++) {
        if (!cs.has(String.fromCharCode(c))) missing.push(String.fromCharCode(c));
      }
      assert.deepEqual(missing, [], `${locale}: ASCII が欠けている: ${missing.join("")}`);
    }
  });
});

describe("F-04..F-05 同梱フォントが charset を満たす", () => {
  test("F-04 各ロケールの全文字が、同梱フォントのどれかに入っている", () => {
    const fb = FALLBACK_CPS();
    assert.ok(FALLBACK_FACES().length > 0, "穴埋め face が1つも無い");
    for (const locale of LOCALES) {
      // serif / sans はそれぞれ単独で本文を描けなければならない。
      // 役割ごとに別スタックなので、「sans にはあるが serif に無い」字は
      // その役割で描かれた瞬間に豆腐になる。合算で見てはいけない。
      for (const face of FACES_FOR(PLAN[locale])) {
        const cm = cmapOf(face);
        const missing = [...charsetFor(locale)]
          .filter((c) => !cm.has(c.codePointAt(0)) && !fb.has(c.codePointAt(0)));
        assert.deepEqual(missing, [],
          `${locale}/${face}: 同梱フォントに無い字がある（実機で豆腐になる）: ${missing.join("")}`);
      }
    }
  });

  test("F-05 charset-<locale>.txt が現在のコードと一致している", () => {
    for (const locale of LOCALES) {
      const rel = `assets/fonts/charset-${locale}.txt`;
      assert.ok(has(rel), `${rel} が無い。node tools/charset.mjs を実行すること`);
      assert.equal(read(rel), charsetFor(locale),
        `${rel} が古い。文言を足したら node tools/make-fonts.mjs をやり直すこと` +
        `（古いままだと、足した文言が実機で豆腐になる）`);
    }
  });
});

describe("F-06..F-10 配線とライセンス", () => {
  const HTML = () => read("index.html");
  const GAME = () => read("src/game.js");

  test("F-06 @font-face の src が実在ファイルを指している", () => {
    const html = HTML();
    const faces = [...html.matchAll(/@font-face\s*\{[\s\S]*?\}/g)].map((m) => m[0]);
    assert.ok(faces.length >= 3, `@font-face が足りない（${faces.length} 件）`);
    for (const f of faces) {
      const m = f.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      assert.ok(m, `@font-face に url() が無い: ${f.slice(0, 80)}`);
      assert.ok(has(m[1]), `@font-face の参照先が無い: ${m[1]}`);
    }
  });

  test("F-07 serif / sans / mono すべてに同梱ファミリが先頭で入っている", () => {
    // OS フォントを消すのが目的ではない（実機に良いフォントがあるなら使ってよい）。
    // 目的は**順序**：同梱ファミリが先に来ていないと、開発機では OS フォントで
    // 描かれてしまい、同梱漏れが Proton 実機まで見つからない。
    const stacks = [];
    // CSS 変数の定義（index.html の :root と html[lang="zh-Hans"]）
    for (const m of HTML().matchAll(/--f-(?:sans|serif|mono)\s*:([^;]+);/g)) stacks.push(["css", m[1]]);
    // canvas 側の F_SERIF / F_SANS / F_MONO（game.js）
    for (const m of GAME().matchAll(/`((?:'Kakushin|'Hiragino|ui-monospace)[^`]*)`/g)) stacks.push(["canvas", m[1]]);

    assert.ok(stacks.length >= 6, `フォントスタックが少なすぎる（${stacks.length} 件）`);
    for (const [where, raw] of stacks) {
      const first = raw.split(",")[0].replace(/['"\s]/g, "");
      assert.ok(first.startsWith("Kakushin") || first.startsWith("${"),
        `${where}: 先頭が同梱ファミリではない: ${raw.trim()}`);
    }
    for (const fam of ["Kakushin Serif", "Kakushin Sans", "Kakushin Mono"]) {
      assert.ok((HTML() + GAME()).includes(fam), `${fam} がどこからも使われていない`);
    }
  });

  test("F-08 最初の描画前にフォントの読み込みを待っている", () => {
    const game = GAME();
    // canvas の c.font はフォント読み込みを起動しない。待たずに描くと
    // 初回だけ OS フォント（Proton では豆腐）で描かれる。
    assert.match(game, /document\.fonts\.(ready|load)/,
      "document.fonts の待機が無い。canvas は @font-face を自動では読まない");
  });

  test("F-09 ファミリ名に Noto を残していない（OFL の Reserved Font Name）", () => {
    const src = HTML() + GAME();
    const hits = [...src.matchAll(/font-family\s*:[^;]*Noto|['"]Noto [^'"]*['"]/g)].map((m) => m[0]);
    assert.deepEqual(hits, [],
      `サブセットは改変なので Noto の名を使えない（OFL 1.1）: ${hits.join(" / ")}`);
  });

  test("F-10 OFL 表記が THIRD-PARTY-NOTICES と ゲーム内クレジットの両方にある", () => {
    for (const rel of ["THIRD-PARTY-NOTICES.md", "index.html"]) {
      const s = read(rel);
      assert.match(s, /SIL Open Font License|OFL/,
        `${rel} に OFL の表記が無い（片方だけ直さないこと）`);
    }
    assert.ok(has("assets/fonts/OFL.txt"), "ライセンス全文の同梱は再配布の条件");
  });
});

describe("F-11..F-12 非機能", () => {
  test("F-11 同梱フォント合計が 2.5MB 以下", () => {
    const names = ["kakushin-sans-jp", "kakushin-serif-jp", "kakushin-sans-sc",
      "kakushin-serif-sc", "kakushin-mono", ...FALLBACK_FACES()];
    let total = 0;
    for (const n of names) {
      const rel = `assets/fonts/${n}.woff2`;
      if (has(rel)) total += statSync(new URL(rel, ROOT)).size;
    }
    assert.ok(total > 0, "同梱フォントが1つも無い");
    assert.ok(total <= 2.5 * 1024 * 1024,
      `同梱フォントが大きすぎる: ${(total / 1024 / 1024).toFixed(2)} MB（上限 2.5MB）`);
  });

  test("F-12 依存を足していない", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.dependencies, undefined, "dependencies を足している");
    assert.equal(pkg.devDependencies, undefined, "devDependencies を足している");
  });
});
