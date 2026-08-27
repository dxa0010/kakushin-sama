/* ============================================================
   異変の多言語化ロジック（src/anoms.js）のユニットテスト
   仕様書: docs/test-specs/anoms-i18n.md
   各 test 名の先頭のIDが仕様書の表のIDと1対1で対応する。
   ------------------------------------------------------------
   実行: node --test tests/unit/
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ANOMS_URL = new URL("../../src/anoms.js", import.meta.url).href;

/** 決定的な乱数。注入必須（L-17）なので、テスト側で必ず用意する。 */
const rng0 = () => 0;
const rng9 = () => 0.9999;

async function load() {
  let mod;
  try {
    mod = await import(ANOMS_URL);
  } catch (e) {
    assert.fail(`src/anoms.js を import できない（未実装 or 構文エラー）: ${e.message}`);
  }
  for (const fn of [
    "anomMeta", "confusables", "confusableOutputs", "docSpecs",
    "localeText", "applyAnom", "canApply", "codexOrigin", "pinHint",
  ]) {
    assert.equal(typeof mod[fn], "function", `${fn} を named export していない`);
  }
  assert.ok(Array.isArray(mod.LOCALES), "LOCALES を named export していない");
  assert.ok(Array.isArray(mod.ANOM_IDS), "ANOM_IDS を named export していない");
  return mod;
}

/** そのロケールの書類1枚を素の状態で取り出す。 */
async function doc(locale, key) {
  const { docSpecs } = await load();
  const specs = docSpecs(locale);
  assert.ok(specs[key], `${locale} に書類 ${key} が無い`);
  return specs[key];
}

/** 全ロケール分の describe を回すヘルパ。 */
async function eachLocale(fn) {
  const { LOCALES } = await load();
  for (const locale of LOCALES) await fn(locale);
}

/* ============================================================
   L-1 舞台は日本固定
   ============================================================ */
describe("L-1 舞台は日本のまま（制度を国別に差し替えない）", () => {
  test("L-1a 対象ロケールは ja / en / zh-Hans / ru / es のちょうど5つ", async () => {
    const { LOCALES } = await load();
    assert.deepEqual([...LOCALES].sort(), ["en", "es", "ja", "ru", "zh-Hans"]);
  });

  // [削除] L-1b — L-25 で破棄。通貨は現地通貨になる（§9.7）

  // [削除] L-1c — L-25 で破棄。書類は国別様式になる（§9.7）

  // [削除] L-1d — L-25 で破棄。日本以外に元号が無い（§9.7）
});

/* ============================================================
   L-2 全ロケールで16種のメタが揃う
   ============================================================ */
describe("L-2 16種すべてのメタが全ロケールで定義されている", () => {
  const IDS = [
    "era", "typo", "minus", "stamp", "name", "mirror", "issuer", "date",
    "soul", "four", "kami", "eye", "blur", "mark", "ju", "label",
  ];

  test("L-2a ANOM_IDS は src/game.js の ANOMS と同じ16種・同じ順序", async () => {
    const { ANOM_IDS } = await load();
    assert.deepEqual([...ANOM_IDS], IDS);
  });

  test("L-2b 全ロケール×全16種で name / reject が空でない文字列", async () => {
    await eachLocale(async (locale) => {
      const { anomMeta, ANOM_IDS } = await load();
      for (const id of ANOM_IDS) {
        const m = anomMeta(id, locale);
        assert.equal(typeof m.name, "string", `${locale}/${id} の name が文字列でない`);
        assert.ok(m.name.trim().length > 0, `${locale}/${id} の name が空`);
        assert.equal(typeof m.reject, "string", `${locale}/${id} の reject が文字列でない`);
        assert.ok(m.reject.trim().length > 0, `${locale}/${id} の reject が空`);
      }
    });
  });

  test("L-2c 巧妙系（sub:true）の集合はロケールによらず同一", async () => {
    const { anomMeta, ANOM_IDS, LOCALES } = await load();
    const subsOf = (loc) => ANOM_IDS.filter((id) => anomMeta(id, loc).sub === true).join(",");
    const base = subsOf("ja");
    assert.equal(base, "typo,stamp,name,date,mark,label", "ja の巧妙系が game.js と一致しない");
    for (const locale of LOCALES) {
      assert.equal(subsOf(locale), base, `${locale} の巧妙系が ja と食い違う`);
    }
  });

  test("L-2d 図鑑名は同一ロケール内で重複しない（図鑑が潰れる）", async () => {
    await eachLocale(async (locale) => {
      const { anomMeta, ANOM_IDS } = await load();
      const names = ANOM_IDS.map((id) => anomMeta(id, locale).name);
      assert.equal(new Set(names).size, names.length, `${locale} で図鑑名が重複している`);
    });
  });
});

/* ============================================================
   L-5 負の金額は括弧記法を使わない
   ============================================================ */
describe("L-5 minus は括弧記法を使わず U+2212 を先頭に置く", () => {
  test("L-5a 全ロケールで U+2212 が金額の先頭に付く", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom } = await load();
      const out = applyAnom("minus", await doc(locale, "shiharai"), locale, rng0);
      const hit = out.rows.find((r) => r[1].includes("−"));
      assert.ok(hit, `${locale} で U+2212 が入っていない`);
      assert.ok(hit[1].startsWith("−"), `${locale} の "${hit[1]}" が U+2212 始まりでない`);
    });
  });

  test("L-5b 括弧で括る会計慣習を使っていない（en / es で異変に見えなくなる）", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom } = await load();
      const out = applyAnom("minus", await doc(locale, "shiharai"), locale, rng0);
      for (const r of out.rows) {
        assert.ok(!/^\(.*\)$/.test(r[1]), `${locale} の "${r[1]}" が括弧記法になっている`);
      }
    });
  });

  test("L-5c ハイフンマイナス（U+002D）ではなく U+2212 を使う", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom } = await load();
      const out = applyAnom("minus", await doc(locale, "shiharai"), locale, rng0);
      const hit = out.rows.find((r) => r[1].includes("−"));
      assert.ok(!hit[1].startsWith("-"), `${locale} が U+002D を使っている`);
    });
  });
});

/* ============================================================
   L-7 存在しない日付
   ============================================================ */
describe("L-7 date はロケール書式に従い、かつ実在しない日付になる", () => {
  test("L-7a 生成される日付に 2月30日 相当が含まれる", async () => {
    // ru は 30.02.2026、es は 30/02/2026 が現地の書式。月は語でなく数字で出る（§9.1）。
    const monthWord = { ja: "2月", en: "February", "zh-Hans": "2月", ru: ".02.", es: "/02/" };
    await eachLocale(async (locale) => {
      const { applyAnom } = await load();
      const out = applyAnom("date", await doc(locale, "shiharai"), locale, rng0);
      assert.ok(typeof out.date === "string" && out.date.length > 0, `${locale} で date が空`);
      assert.ok(out.date.includes(monthWord[locale]), `${locale} の "${out.date}" に2月が無い`);
      assert.ok(/30/.test(out.date), `${locale} の "${out.date}" に30日が無い`);
    });
  });

  // [削除] L-7b — L-25 で破棄。日本以外に元号が無い（§9.7）
});

/* ============================================================
   L-8 era ── 相互参照で成立させる
   ============================================================ */
describe("L-8 真正な書類は全て同一の年号年を印字する", () => {
  test("L-8a 5枚すべてに era フィールドがあり、値が一致する", async () => {
    await eachLocale(async (locale) => {
      const { docSpecs } = await load();
      const specs = docSpecs(locale);
      const eras = Object.entries(specs).map(([k, d]) => {
        assert.ok(typeof d.era === "string" && d.era.length > 0, `${locale}/${k} に era が無い`);
        return d.era;
      });
      assert.equal(eras.length, 5, `${locale} の書類が5枚でない`);
      assert.equal(new Set(eras).size, 1, `${locale} の年号年が書類間で食い違う: ${eras.join(" / ")}`);
    });
  });

  test("L-8b era 異変は「数でない年」か「別の元号」を生成し、真正値と必ず異なる", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom, docSpecs } = await load();
      const src = docSpecs(locale).shiharai;
      for (const rng of [rng0, rng9]) {
        const out = applyAnom("era", src, locale, rng);
        assert.notEqual(out.era, src.era, `${locale} で era が変わっていない`);
      }
    });
  });

  test("L-8c 分岐の一方は ∞（数でない年）、他方は真正値と違う年", async () => {
    // §9.4: 日本以外に元号は無い。era 異変は「他の4枚と食い違う税年度」で成立させる。
    await eachLocale(async (locale) => {
      const { applyAnom, docSpecs, localeText } = await load();
      const src = docSpecs(locale).shiharai;
      const genuine = localeText(locale).eraGenuine;
      const a = applyAnom("era", src, locale, rng0).era;
      const b = applyAnom("era", src, locale, rng9).era;
      const variants = [a, b];
      assert.ok(variants.some((v) => v.includes("∞")), `${locale} に ∞ 版が無い: ${variants.join(" / ")}`);
      assert.ok(variants.some((v) => v !== genuine && !v.includes("∞")),
        `${locale} に「別の年」版が無い: ${variants.join(" / ")}`);
      for (const v of variants) {
        assert.notEqual(v, genuine, `${locale} の era 異変が真正値と同じ: ${v}`);
      }
    });
  });

  test("L-8d 異変の年は真正な5枚のどれとも一致しない（相互参照だけで気づける）", async () => {
    // 歴史知識も税制知識も要らない。5枚を並べて1枚だけ年が違えば分かる、という形にする。
    await eachLocale(async (locale) => {
      const { applyAnom, docSpecs, localeText } = await load();
      const specs = docSpecs(locale);
      const genuine = localeText(locale).eraGenuine;
      for (const [key, d] of Object.entries(specs)) {
        assert.equal(d.era, genuine, `${locale}/${key} の真正な税年度が揃っていない`);
      }
      for (const rng of [rng0, rng9]) {
        const out = applyAnom("era", specs.shiharai, locale, rng);
        assert.ok(!Object.values(specs).some((d) => d.era === out.era),
          `${locale} の era 異変が真正書類と同じ年になっている（比較で気づけない）: ${out.era}`);
      }
    });
  });
});

/* ============================================================
   L-9 氏名は漢字のまま据え置く
   ============================================================ */
describe("L-9 氏名は全ロケールで漢字のまま、異変は1文字差", () => {
  // [削除] L-9a — L-36a に置き換え。氏名は国別（§9.4a）

  test("L-9b name 異変は1文字だけ差し替える", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom, localeText } = await load();
      const src = await doc(locale, "shiharai");
      const before = localeText(locale).playerName;
      const after = applyAnom("name", src, locale, rng0).name;
      assert.equal([...after].length, [...before].length, `${locale} で氏名の字数が変わった`);
      const diff = [...before].filter((ch, i) => ch !== [...after][i]);
      assert.equal(diff.length, 1, `${locale} の差分が1文字でない: ${before} → ${after}`);
    });
  });

  // [削除] L-9c — L-36b に置き換え。漢字前提を外し「1文字差」で保証する（§9.7）

  test("L-9d 氏名は全5枚に印字される（比較対象が無いと L-4 が成立しない）", async () => {
    await eachLocale(async (locale) => {
      const { docSpecs } = await load();
      for (const [k, d] of Object.entries(docSpecs(locale))) {
        assert.equal(d.showsName, true, `${locale}/${k} に氏名が印字されない`);
      }
    });
  });
});

/* ============================================================
   L-10 four は 4 のまま維持し、由来を図鑑で教える
   ============================================================ */
describe("L-10 four は全ロケールで 4（忌み数を差し替えない）", () => {
  // [削除] L-10a — L-33b に置き換え。忌み数はロケール別（§9.7）

  // [削除] L-10b — L-33a に置き換え。en/ru/es は 13 を使う（§9.7）

  test("L-10c 全ロケールに four の由来文がある（文化差は図鑑で埋める＝L-3）", async () => {
    await eachLocale(async (locale) => {
      const { codexOrigin } = await load();
      const t = codexOrigin("four", locale);
      assert.equal(typeof t, "string", `${locale} に four の由来文が無い`);
      assert.ok(t.trim().length > 0, `${locale} の four の由来文が空`);
    });
  });

  // [削除] L-10d — L-33d に置き換え。四＝死 の説明は ja/zh-Hans のみ（§9.7）
});

/* ============================================================
   L-11 typo は文字体系ごとに機構が違う
   ============================================================ */
describe("L-11 typo は CJK と アルファベット系で機構が異なる", () => {
  test("L-11a CJK（ja / zh-Hans）は題字の先頭2文字を入れ替える", async () => {
    for (const locale of ["ja", "zh-Hans"]) {
      const { applyAnom } = await load();
      const src = await doc(locale, "shiharai");
      const before = [...src.title];
      const after = [...applyAnom("typo", src, locale, rng0).title];
      assert.equal(after[0], before[1], `${locale} の1文字目が入れ替わっていない`);
      assert.equal(after[1], before[0], `${locale} の2文字目が入れ替わっていない`);
      assert.deepEqual(after.slice(2), before.slice(2), `${locale} で3文字目以降が変わった`);
    }
  });

  test("L-11b アルファベット系（en / ru / es）は先頭文字を保つ", async () => {
    for (const locale of ["en", "ru", "es"]) {
      const { applyAnom } = await load();
      const src = await doc(locale, "shiharai");
      const after = applyAnom("typo", src, locale, rng0).title;
      assert.equal(after[0], src.title[0], `${locale} の先頭文字が変わった（バグに見える）`);
      assert.notEqual(after, src.title, `${locale} の題字が変わっていない`);
    }
  });

  test("L-11c アルファベット系は単語内の隣接2文字の転置（字の集合は不変）", async () => {
    for (const locale of ["en", "ru", "es"]) {
      const { applyAnom } = await load();
      const src = await doc(locale, "shiharai");
      const after = applyAnom("typo", src, locale, rng0).title;
      const sortChars = (s) => [...s].sort().join("");
      assert.equal(sortChars(after), sortChars(src.title), `${locale} で字が増減した`);
      const diff = [...src.title].reduce((n, ch, i) => (ch !== after[i] ? n + 1 : n), 0);
      assert.equal(diff, 2, `${locale} の差分が隣接2文字でない: ${src.title} → ${after}`);
    }
  });

  test("L-11d 空白を挟いだ転置はしない（単語の内側でのみ入れ替える）", async () => {
    for (const locale of ["en", "ru", "es"]) {
      const { applyAnom } = await load();
      const src = await doc(locale, "shiharai");
      const after = applyAnom("typo", src, locale, rng0).title;
      const idx = [...src.title].findIndex((ch, i) => ch !== after[i]);
      assert.ok(!/\s/.test(src.title[idx]) && !/\s/.test(src.title[idx + 1]),
        `${locale} が空白をまたいで転置した: ${src.title} → ${after}`);
    }
  });
});

/* ============================================================
   L-12 label ── ロケールごとの混同表
   ============================================================ */
describe("L-12 label はロケール固有の混同表で1箇所だけ置換する", () => {
  test("L-12a 全ロケールに空でない混同表がある", async () => {
    await eachLocale(async (locale) => {
      const { confusables } = await load();
      const tbl = confusables(locale);
      assert.ok(Object.keys(tbl).length > 0, `${locale} の混同表が空`);
      for (const [from, to] of Object.entries(tbl)) {
        assert.notEqual(from, to, `${locale} の ${from} が自分自身に化けている`);
        assert.ok(to.length > 0, `${locale} の ${from} の化け先が空`);
      }
    });
  });

  test("L-12b 混同表の全エントリが、いずれかの項目名に実際にヒットする（死んだ表を作らない）", async () => {
    await eachLocale(async (locale) => {
      const { confusables, docSpecs } = await load();
      const labels = Object.values(docSpecs(locale)).flatMap((d) => d.rows.map((r) => r[0])).join("\x00");
      for (const from of Object.keys(confusables(locale))) {
        assert.ok(labels.includes(from), `${locale} の混同表エントリ "${from}" がどの項目名にも出現しない`);
      }
    });
  });

  test("L-12c 置換箇所はちょうど1つ。前後の文字・他の項目名・値は不変", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom, canApply, confusables, docSpecs } = await load();
      const tbl = confusables(locale);
      for (const [key, src] of Object.entries(docSpecs(locale))) {
        if (!canApply("label", src, locale)) continue;
        const out = applyAnom("label", src, locale, rng0);

        // 変わった項目名はちょうど1つ
        const changedIdx = src.rows.reduce((acc, r, i) => (r[0] !== out.rows[i][0] ? [...acc, i] : acc), []);
        assert.equal(changedIdx.length, 1, `${locale}/${key} で変わった項目名が1つでない`);

        // 値は一切変わらない
        for (let i = 0; i < src.rows.length; i++) {
          assert.equal(out.rows[i][1], src.rows[i][1], `${locale}/${key} で値が変わった`);
        }

        // 変化は「表の1エントリを1箇所に当てた」だけで説明できる。
        // （m→rn のように字数が増える置換を許すが、置換箇所が2つ以上あってはならない）
        const before = src.rows[changedIdx[0]][0];
        const after = out.rows[changedIdx[0]][0];
        const explains = Object.entries(tbl).filter(([from, to]) => {
          const at = before.indexOf(from);
          if (at < 0) return false;
          return before.slice(0, at) + to + before.slice(at + from.length) === after;
        });
        assert.ok(explains.length >= 1,
          `${locale}/${key} の変化が混同表の1箇所置換で説明できない: "${before}" → "${after}"`);
      }
    });
  });

  test("L-12d ru の表にラテン文字を混ぜない（フォントが同形に描くと見えない＝L-2違反）", async () => {
    const { confusables } = await load();
    for (const [from, to] of Object.entries(confusables("ru"))) {
      assert.ok(!/[A-Za-z]/.test(to), `ru の ${from}→${to} がラテン文字を使っている（不可視の異変になる）`);
    }
  });

  test("L-12e es の表に Año→Ano を含めない（ゲーム側がボケない規律）", async () => {
    const { confusables } = await load();
    const tbl = confusables("es");
    assert.ok(!("Añ" in tbl), "es の表に Año 由来のエントリがある");
  });

  test("L-12g 置換結果がその言語で正しい綴りになってはならない（異変が異変にならない）", async () => {
    // 現実の正書法で許容される異形は「間違い」に見えず、公平性（L-2）を壊す。
    // 見つかったものはここに列挙して、項目名側を変えることで回避する。
    const AMBIGUOUS = {
      es: ["periodo"],   // RAE は "período" と "periodo" の両方を認めている
      en: [], ja: [], ru: [], "zh-Hans": [],
    };
    await eachLocale(async (locale) => {
      const { applyAnom, canApply, confusables, docSpecs } = await load();
      const deny = AMBIGUOUS[locale].map((w) => w.toLowerCase());
      for (const [key, src] of Object.entries(docSpecs(locale))) {
        if (!canApply("label", src, locale)) continue;
        const n = src.rows.flatMap((r) => [...r[0]]).filter((c) => confusables(locale)[c]).length;
        for (let i = 0; i < n; i++) {
          const out = applyAnom("label", src, locale, () => i / n);
          for (const r of out.rows) {
            for (const word of r[0].toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
              assert.ok(!deny.includes(word),
                `${locale}/${key} の置換結果 "${r[0]}" が正しい綴り "${word}" になっている`);
            }
          }
        }
      }
    });
  });

  test("L-12f zh-Hans の表は簡体字→繁体/異体字（同じ字への置換ではない）", async () => {
    const { confusables } = await load();
    const tbl = confusables("zh-Hans");
    assert.ok(Object.keys(tbl).length >= 6, "zh-Hans の表が薄い");
    for (const [from, to] of Object.entries(tbl)) {
      assert.ok(/[一-鿿]/.test(to), `zh-Hans の ${from}→${to} が漢字でない`);
    }
  });
});

/* ============================================================
   L-13 暗証番号の日付順序
   ============================================================ */
describe("L-13 暗証番号は 0315 固定、手掛かり文で順序を明示する", () => {
  test("L-13a anoms.js は正解値を持たない（pin.js と同じ規律）", async () => {
    const mod = await load();
    const dumped = JSON.stringify(Object.entries(mod).filter(([, v]) => typeof v !== "function"));
    assert.ok(!dumped.includes("0315"), "anoms.js に正解値 0315 が埋め込まれている");
  });

  test("L-13b 全ロケールに暗証番号の手掛かり文がある", async () => {
    await eachLocale(async (locale) => {
      const { pinHint } = await load();
      const t = pinHint(locale);
      assert.equal(typeof t, "string", `${locale} の手掛かり文が無い`);
      assert.ok(t.trim().length > 0, `${locale} の手掛かり文が空`);
    });
  });

  // [削除] L-13c — L-30 で消滅。暗証番号は各国の書き順なので順序の注記が要らない（§9.5）

  test("L-13d 手掛かり文は氏名の意味（三月＝月、十五＝日）を開示する", async () => {
    await eachLocale(async (locale) => {
      const { pinHint, localeText } = await load();
      assert.ok(pinHint(locale).includes(localeText(locale).playerName),
        `${locale} の手掛かり文に氏名が出てこない（救済経路が無い）`);
    });
  });
});

/* ============================================================
   L-14 フォントサブセット用のグリフ列挙
   ============================================================ */
describe("L-14 混同表の出力字を列挙できる（サブセットで豆腐にしない）", () => {
  test("L-14a confusableOutputs() が全ロケール分の出力字を返す", async () => {
    const { confusableOutputs, confusables, LOCALES } = await load();
    const out = confusableOutputs();
    for (const locale of LOCALES) {
      assert.ok(typeof out[locale] === "string", `${locale} の出力字が無い`);
      for (const to of Object.values(confusables(locale))) {
        for (const ch of to) {
          assert.ok(out[locale].includes(ch), `${locale} の出力字 "${ch}" が列挙に含まれない`);
        }
      }
    }
  });

  test("L-14b 出力字には素の本文に無い字が含まれる（列挙が必要な理由の確認）", async () => {
    const { confusableOutputs, docSpecs } = await load();
    const out = confusableOutputs();
    for (const locale of ["ja", "zh-Hans", "ru"]) {
      const body = JSON.stringify(docSpecs(locale));
      const novel = [...out[locale]].filter((ch) => !body.includes(ch));
      assert.ok(novel.length > 0, `${locale} の出力字が全て本文に含まれている（前提の確認に失敗）`);
    }
  });
});

/* ============================================================
   L-16〜L-19 純粋性・注入・防御
   ============================================================ */
describe("L-16 applyAnom は入力を変更しない", () => {
  test("L-16a 全ロケール×全異変で入力オブジェクトが不変", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom, canApply, docSpecs, ANOM_IDS } = await load();
      for (const [key, src] of Object.entries(docSpecs(locale))) {
        for (const id of ANOM_IDS) {
          if (!canApply(id, src, locale)) continue;
          const snapshot = JSON.stringify(src);
          applyAnom(id, src, locale, rng0);
          assert.equal(JSON.stringify(src), snapshot, `${locale}/${key}/${id} が入力を破壊した`);
        }
      }
    });
  });

  test("L-16b rows は配列ごとコピーされる（浅いコピーで元を汚さない）", async () => {
    await eachLocale(async (locale) => {
      const { applyAnom, docSpecs } = await load();
      const src = docSpecs(locale).shiharai;
      const out = applyAnom("four", src, locale, rng0);
      assert.notEqual(out.rows, src.rows, `${locale} で rows が共有されている`);
      for (let i = 0; i < src.rows.length; i++) {
        assert.notEqual(out.rows[i], src.rows[i], `${locale} で rows[${i}] が共有されている`);
      }
    });
  });

  test("L-16c docSpecs は呼ぶたびに新しいオブジェクトを返す（前の周回の異変が残らない）", async () => {
    const { docSpecs } = await load();
    const a = docSpecs("ja"), b = docSpecs("ja");
    assert.notEqual(a, b, "docSpecs が同じ参照を返している");
    assert.notEqual(a.shiharai, b.shiharai, "書類が共有されている");
    assert.notEqual(a.shiharai.rows, b.shiharai.rows, "rows が共有されている");
    assert.deepEqual(a, b, "docSpecs の内容が呼び出しごとに違う");
  });
});

describe("L-17 乱数は注入必須（既定値を持たない）", () => {
  test("L-17a rng を渡さないと例外", async () => {
    const { applyAnom, docSpecs } = await load();
    assert.throws(() => applyAnom("era", docSpecs("ja").shiharai, "ja"), /rng/,
      "rng 未指定が通ってしまう");
  });

  test("L-17b rng が関数でなければ例外", async () => {
    const { applyAnom, docSpecs } = await load();
    for (const bad of [0.5, "0.5", null, {}]) {
      assert.throws(() => applyAnom("era", docSpecs("ja").shiharai, "ja", bad), /rng/,
        `rng=${JSON.stringify(bad)} が通ってしまう`);
    }
  });

  test("L-17c Math.random を内部で呼ばない（決定的に再現できる）", async () => {
    const { applyAnom, docSpecs, ANOM_IDS, canApply } = await load();
    const orig = Math.random;
    let called = 0;
    Math.random = () => { called++; return 0.5; };
    try {
      const src = docSpecs("ja").shiharai;
      for (const id of ANOM_IDS) {
        if (canApply(id, src, "ja")) applyAnom(id, src, "ja", rng0);
      }
    } finally {
      Math.random = orig;
    }
    assert.equal(called, 0, "Math.random を内部で呼んでいる");
  });
});

describe("L-18 未対応ロケールは例外（暗黙のフォールバックをしない）", () => {
  test("L-18a 各 API が未知のロケールで例外を投げる", async () => {
    const { anomMeta, confusables, docSpecs, localeText, pinHint, codexOrigin } = await load();
    for (const bad of ["fr", "ja-JP", "zh-Hant", "", null, undefined]) {
      assert.throws(() => docSpecs(bad), /locale/i, `docSpecs(${JSON.stringify(bad)})`);
      assert.throws(() => localeText(bad), /locale/i, `localeText(${JSON.stringify(bad)})`);
      assert.throws(() => confusables(bad), /locale/i, `confusables(${JSON.stringify(bad)})`);
      assert.throws(() => pinHint(bad), /locale/i, `pinHint(${JSON.stringify(bad)})`);
      assert.throws(() => anomMeta("era", bad), /locale/i, `anomMeta(era, ${JSON.stringify(bad)})`);
      assert.throws(() => codexOrigin("four", bad), /locale/i, `codexOrigin(four, ${JSON.stringify(bad)})`);
    }
  });

  test("L-18b 未知の異変IDも例外（黙って異変が消えるのを防ぐ）", async () => {
    const { anomMeta, applyAnom, docSpecs } = await load();
    assert.throws(() => anomMeta("nope", "ja"), /nope/, "未知IDのメタ取得が通る");
    assert.throws(() => applyAnom("nope", docSpecs("ja").shiharai, "ja", rng0), /nope/,
      "未知IDの適用が通る");
  });
});

describe("L-19 can を満たさない書類への適用は例外", () => {
  test("L-19a 金額の無い書類に minus / soul は適用できない", async () => {
    await eachLocale(async (locale) => {
      const { canApply, applyAnom, docSpecs } = await load();
      const src = docSpecs(locale).password;   // 金額欄が無い
      for (const id of ["minus", "soul"]) {
        assert.equal(canApply(id, src, locale), false, `${locale} で ${id} が可能と判定された`);
        assert.throws(() => applyAnom(id, src, locale, rng0), /can/i,
          `${locale} で ${id} の不正適用が通った`);
      }
    });
  });

  test("L-19b 混同表の字を含む項目名が無い書類に label は適用できない", async () => {
    await eachLocale(async (locale) => {
      const { canApply, applyAnom, docSpecs, confusables } = await load();
      const tbl = confusables(locale);
      for (const [key, src] of Object.entries(docSpecs(locale))) {
        const hit = src.rows.some((r) => [...r[0]].some((ch) => tbl[ch]));
        assert.equal(canApply("label", src, locale), hit, `${locale}/${key} の label 判定が表と食い違う`);
        if (!hit) {
          assert.throws(() => applyAnom("label", src, locale, rng0), /can/i,
            `${locale}/${key} で label の不正適用が通った`);
        }
      }
    });
  });

  test("L-19c 視覚系の異変はどの書類にも適用できる", async () => {
    await eachLocale(async (locale) => {
      const { canApply, docSpecs } = await load();
      for (const [key, src] of Object.entries(docSpecs(locale))) {
        for (const id of ["stamp", "mirror", "eye", "blur", "mark", "ju"]) {
          assert.equal(canApply(id, src, locale), true, `${locale}/${key} で ${id} が不可と判定された`);
        }
      }
    });
  });
});

/* ------------------------------------------------------------
   L-23 / L-24: 怪異の名前とタイトル（仕様書 §8）
   ------------------------------------------------------------ */
describe("怪異の名前とタイトル", () => {
  test("L-23b 全ロケールに title があり、ブランドトークンを含む", async () => {
    const { LOCALES, localeText } = await load();
    for (const locale of LOCALES) {
      const t = localeText(locale);
      assert.equal(typeof t.title, "string", `${locale} に title が無い`);
      assert.ok(t.title.length > 0, `${locale} の title が空`);
      // ja は原語のカタカナ、それ以外は L-24 によりラテン文字大文字で固定
      const token = locale === "ja" ? "カクシン" : "KAKUSHIN";
      assert.ok(t.title.includes(token),
        `${locale} の title に「${token}」が無い: ${t.title}。` +
        `タイトルは異変 issuer / kami の唯一の根拠なので、名前が消えると解けなくなる`);
    }
  });

  test("L-23c ja の title が index.html の <title> と一致する", async () => {
    const { localeText } = await load();
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const m = html.match(/<title>([^<]*)<\/title>/);
    assert.ok(m, "index.html に <title> が無い");
    assert.equal(m[1], localeText("ja").title,
      "index.html の <title> と src/anoms.js の ja.title がずれている（片方だけ直した）");
  });

  test("L-24 zh-Hans は「确信」を使わない（quèxìn と読まれ音が繋がらない）", async () => {
    const { localeText } = await load();
    const t = localeText("zh-Hans");
    for (const [field, v] of Object.entries(t)) {
      if (typeof v !== "string") continue;
      assert.ok(!v.includes("确信"),
        `zh-Hans の ${field} に「确信」がある: ${v}。` +
        `漢字の中国語音 quèxìn は KAKUSHIN と別物で、ブランドが繋がらない（仕様書 L-24）`);
    }
  });
});

/* ============================================================
   §9 国別コンテンツ設計（L-31 〜 L-36）
   仕様書: docs/test-specs/anoms-i18n.md §9
   ------------------------------------------------------------
   §9.1 / §9.4a / §9.5 の表をテスト側に写して固定する。
   一次資料は仕様書であり、ここはその写し。食い違ったら仕様書が正しい。
   ============================================================ */

const FACTS = {
  ja: {
    symbol: "¥", position: "pre", thousands: ",", decimal: ".",
    unlucky: "4", month: 3, day: 15, order: "MD", pin: "0315",
    playerName: "三月 十五", playerNameAlt: "三月 十六",
    realAuthority: "国税庁",
  },
  en: {
    symbol: "$", position: "pre", thousands: ",", decimal: ".",
    unlucky: "13", month: 4, day: 15, order: "MD", pin: "0415",
    playerName: "April Fifteen", playerNameAlt: "Apryl Fifteen",
    realAuthority: "Internal Revenue Service",
  },
  "zh-Hans": {
    symbol: "¥", position: "pre", thousands: ",", decimal: ".",
    unlucky: "4", month: 6, day: 30, order: "MD", pin: "0630",
    playerName: "六月 三十", playerNameAlt: "六月 三千",
    realAuthority: "国家税务总局",
  },
  ru: {
    symbol: "₽", position: "post", thousands: " ", decimal: ",",
    unlucky: "13", month: 4, day: 30, order: "DM", pin: "3004",
    playerName: "Апрелий Тридцатов", playerNameAlt: "Апрелей Тридцатов",
    realAuthority: "Федеральная налоговая служба",
  },
  es: {
    symbol: "€", position: "post", thousands: ".", decimal: ",",
    unlucky: "13", month: 6, day: 30, order: "DM", pin: "3006",
    playerName: "Junio Treinta", playerNameAlt: "Iunio Treinta",
    realAuthority: "Agencia Estatal de Administración Tributaria",
  },
};

const SRC = () => readFileSync(new URL("../../src/anoms.js", import.meta.url), "utf8");

describe("L-31 通貨モデルがロケールごとに正しい", () => {
  test("L-31a money(locale) が §9.1 の表と一致する", async () => {
    const { money } = await load();
    for (const [locale, f] of Object.entries(FACTS)) {
      const m = money(locale);
      assert.equal(m.symbol, f.symbol, `${locale} の通貨記号`);
      assert.equal(m.position, f.position, `${locale} の記号位置`);
      assert.equal(m.thousands, f.thousands, `${locale} の桁区切り`);
      assert.equal(m.decimal, f.decimal, `${locale} の小数点`);
    }
  });

  test("L-31b formatMoney が記号位置と桁区切りを守る", async () => {
    const { formatMoney } = await load();
    assert.equal(formatMoney("ja", 1200000), "¥1,200,000");
    assert.equal(formatMoney("en", 1200000), "$1,200,000");
    assert.equal(formatMoney("zh-Hans", 1200000), "¥1,200,000");
    // 後置ロケールは数値と記号のあいだに空白を置くのが現地の組版
    assert.equal(formatMoney("ru", 1200000), "1 200 000 ₽");
    assert.equal(formatMoney("es", 1200000), "1.200.000 €");
  });

  test("L-31c 真正な書類の金額欄が、そのロケールの通貨記号を使っている", async () => {
    const { docSpecs, money, LOCALES } = await load();
    for (const locale of LOCALES) {
      const m = money(locale);
      const others = Object.values(FACTS).map((f) => f.symbol).filter((s) => s !== m.symbol);
      for (const [key, d] of Object.entries(docSpecs(locale))) {
        for (const [label, value] of d.rows) {
          for (const wrong of others) {
            assert.ok(!value.includes(wrong),
              `${locale}/${key} の「${label}」に他ロケールの通貨記号 ${wrong} がある: ${value}`);
          }
        }
      }
    }
  });
});

describe("L-32 minus は記号位置に依らず数値の先頭に付く", () => {
  test("L-32a U+2212 が数字の直前にある", async () => {
    const { docSpecs, applyAnom, canApply, LOCALES } = await load();
    for (const locale of LOCALES) {
      for (const [key, d] of Object.entries(docSpecs(locale))) {
        if (!canApply("minus", d, locale)) continue;
        const out = applyAnom("minus", d, locale, rng0);
        const hit = out.rows.find((r) => r[1].includes("−"));
        assert.ok(hit, `${locale}/${key} で U+2212 が入っていない`);
        // 値の文字列の先頭に置く。前置記号なら「−¥1,200,000」、後置記号なら
        // 「−1 200 000 ₽」。どちらも現地の負数表記として自然（§9.2 / L-32）。
        assert.equal(hit[1].indexOf("−"), 0,
          `${locale}/${key}: U+2212 が値の先頭に無い: ${hit[1]}`);
      }
    }
  });

  test("L-32b 括弧記法も U+002D も使わない（L-5 の維持）", async () => {
    const { docSpecs, applyAnom, canApply, LOCALES } = await load();
    for (const locale of LOCALES) {
      for (const d of Object.values(docSpecs(locale))) {
        if (!canApply("minus", d, locale)) continue;
        const out = applyAnom("minus", d, locale, rng0);
        const hit = out.rows.find((r) => r[1].includes("−"));
        assert.ok(!/\(/.test(hit[1]), `括弧記法になっている: ${hit[1]}`);
        assert.ok(!hit[1].includes("-"), `U+002D が混ざっている: ${hit[1]}`);
      }
    }
  });
});

describe("L-33 four の忌み数がロケールごとに違う", () => {
  test("L-33a 忌み数が §9.1 の表と一致する", async () => {
    const { unluckyNumber } = await load();
    for (const [locale, f] of Object.entries(FACTS)) {
      assert.equal(unluckyNumber(locale), f.unlucky, `${locale} の忌み数`);
    }
  });

  test("L-33b four 適用後、数値がすべて忌み数に置き換わっている", async () => {
    const { docSpecs, applyAnom, canApply, unluckyNumber, LOCALES } = await load();
    for (const locale of LOCALES) {
      const n = unluckyNumber(locale);
      for (const [key, d] of Object.entries(docSpecs(locale))) {
        if (!canApply("four", d, locale)) continue;
        const out = applyAnom("four", d, locale, rng0);
        for (const [label, value] of out.rows) {
          for (const run of value.match(/[0-9][0-9 ,.]*[0-9]|[0-9]/g) || []) {
            const bare = run.replace(/[ ,.]/g, "");
            assert.ok(new RegExp("^(" + n + ")+$").test(bare),
              `${locale}/${key} の「${label}」に忌み数でない数値が残っている: ${value}`);
          }
        }
      }
    }
  });

  test("L-33c ja と zh-Hans は同じ忌み数 4 を共有する（図鑑を共用できる）", async () => {
    const { unluckyNumber } = await load();
    assert.equal(unluckyNumber("ja"), unluckyNumber("zh-Hans"),
      "四＝死 は日中で共有されるので、図鑑の由来文も共用できるはず（L-28）");
  });

  test("L-33e 却下理由が実際に出る忌み数と一致する", async () => {
    // プレイヤーが見た数と却下理由が食い違うと、何を根拠に却下されたのか分からなくなる（L-2）。
    // 忌み数を変えたのに文言を直し忘れる、という事故はこれで落ちる。
    const WORD  = { ja: "4", en: "thirteen", "zh-Hans": "四", ru: "тринадцать", es: "trece" };
    const WRONG = { ja: "13", en: "four", "zh-Hans": "13", ru: "четыр", es: "cuatro" };
    const { anomMeta, LOCALES } = await load();
    for (const locale of LOCALES) {
      const r = anomMeta("four", locale).reject;
      assert.ok(r.includes(WORD[locale]),
        `${locale} の却下理由に忌み数が出てこない: ${r}`);
      assert.ok(!r.toLowerCase().includes(WRONG[locale]),
        `${locale} の却下理由に別ロケールの忌み数が残っている: ${r}`);
    }
  });

  test("L-33d 全ロケールに four の由来文がある", async () => {
    const { codexOrigin, LOCALES } = await load();
    for (const locale of LOCALES) {
      const t = codexOrigin("four", locale);
      assert.equal(typeof t, "string", `${locale} に four の由来文が無い`);
      assert.ok(t.trim().length > 0, `${locale} の four の由来文が空`);
    }
  });
});

describe("L-20 label の当たりが置換の種類ごとに一様である", () => {
  test("L-20a どの置換の種類も、頻度が全体の 1/種類数 前後になる", async () => {
    // 箇所から一様に引くと、その言語で頻出する字に偏る（ru の и→й が 47箇所中22）。
    // 最も効く置換ほど出現字が珍しく、偏りの割を食う。種類を先に引くことで揃える。
    const { docSpecs, confusables, applyAnom, canApply, LOCALES } = await load();
    for (const locale of LOCALES) {
      const tbl = confusables(locale);
      for (const [key, d] of Object.entries(docSpecs(locale))) {
        if (!canApply("label", d, locale)) continue;
        const kinds = new Set();
        for (const [label] of d.rows) for (const ch of label) if (tbl[ch]) kinds.add(ch);
        const K = kinds.size;
        if (K < 2) continue;

        const seen = new Map();
        const N = 600;
        for (let i = 0; i < N; i++) {
          const out = applyAnom("label", d, locale, () => i / N);
          // どの種類が使われたかは、変化した項目名を元と比べて特定する
          let hit = null;
          out.rows.forEach((r, ri) => { if (r[0] !== d.rows[ri][0]) hit = ri; });
          assert.notEqual(hit, null, `${locale}/${key} で項目名が変わっていない`);
          // 置換は最初の出現とは限らない（"withheld" の末尾の d が当たることがある）。
          // 先頭から見て最初に食い違う位置の、元の字が置換の種類。
          const before = [...d.rows[hit][0]], after = [...out.rows[hit][0]];
          let at = 0;
          while (at < before.length && before[at] === after[at]) at++;
          const kind = before[at];
          assert.ok(kinds.has(kind),
            `${locale}/${key} の置換が表で説明できない: ${d.rows[hit][0]} -> ${out.rows[hit][0]}`);
          seen.set(kind, (seen.get(kind) || 0) + 1);
        }
        assert.equal(seen.size, K,
          `${locale}/${key}: ${K} 種類あるうち ${seen.size} 種類しか出ていない`);
        const expect = N / K;
        for (const [kind, n] of seen) {
          assert.ok(n >= expect * 0.5 && n <= expect * 1.5,
            `${locale}/${key}: ${kind}→${tbl[kind]} の頻度が偏っている ` +
            `(${n}/${N}, 期待 ${expect.toFixed(0)} 前後)`);
        }
      }
    }
  });
});

describe("L-34 締切と暗証番号がロケールごとに違う（L-30）", () => {
  test("L-34a deadline(locale) が §9.5 の表と一致する", async () => {
    const { deadline } = await load();
    for (const [locale, f] of Object.entries(FACTS)) {
      const d = deadline(locale);
      assert.equal(d.month, f.month, `${locale} の締切の月`);
      assert.equal(d.day, f.day, `${locale} の締切の日`);
      assert.equal(d.order, f.order, `${locale} の日付の書き順`);
    }
  });

  test("L-34b 締切とその国の書き順から暗証番号が導出できる", async () => {
    const { deadline } = await load();
    const pad = (n) => String(n).padStart(2, "0");
    for (const [locale, f] of Object.entries(FACTS)) {
      const d = deadline(locale);
      const derived = d.order === "MD" ? pad(d.month) + pad(d.day) : pad(d.day) + pad(d.month);
      assert.equal(derived, f.pin,
        `${locale}: 締切から導出した番号が §9.5 の表と違う`);
    }
  });

  test("L-34c anoms.js のソースに暗証番号そのものを書かない（L-13a を5ロケールに拡張）", async () => {
    const src = SRC();
    for (const [locale, f] of Object.entries(FACTS)) {
      assert.ok(!src.includes('"' + f.pin + '"'),
        `anoms.js に ${locale} の正解値 ${f.pin} が文字列として埋め込まれている`);
    }
  });

  test("L-34d 手掛かり文に氏名が出る（救済経路＝既存 L-13d の維持）", async () => {
    const { pinHint, localeText, LOCALES } = await load();
    for (const locale of LOCALES) {
      assert.ok(pinHint(locale).includes(localeText(locale).playerName),
        `${locale} の手掛かり文に氏名が出てこない`);
    }
  });
});

describe("L-35 税年度と当局名", () => {
  test("L-35a 真正な5枚がすべて同一の税年度を印字する（era の相互参照の前提）", async () => {
    const { docSpecs, LOCALES } = await load();
    for (const locale of LOCALES) {
      const years = Object.values(docSpecs(locale)).map((d) => d.era);
      assert.equal(new Set(years).size, 1,
        `${locale} の税年度が書類ごとに違う: ${JSON.stringify(years)}。` +
        `真正な書類が食い違っていたら era 異変が判定できない`);
      assert.ok(years[0] && String(years[0]).length > 0, `${locale} の税年度が空`);
    }
  });

  test("L-35b 当局名は実在する当局の正式名称と一致しない（パロディであることの機械的保証）", async () => {
    const { authority } = await load();
    for (const [locale, f] of Object.entries(FACTS)) {
      const a = authority(locale);
      assert.equal(typeof a, "string", `${locale} の当局名が無い`);
      assert.ok(a.trim().length > 0, `${locale} の当局名が空`);
      assert.notEqual(a, f.realAuthority,
        `${locale} の当局名が実在する当局の正式名称そのもの: ${a}`);
      assert.ok(!a.includes(f.realAuthority),
        `${locale} の当局名が実在する正式名称を含んでいる: ${a}`);
    }
  });
});

describe("L-36 氏名と一字違い（§9.4a）", () => {
  test("L-36a 氏名が §9.4a の表と一致する", async () => {
    const { localeText } = await load();
    for (const [locale, f] of Object.entries(FACTS)) {
      const t = localeText(locale);
      assert.equal(t.playerName, f.playerName, `${locale} の氏名`);
      assert.equal(t.playerNameAlt, f.playerNameAlt, `${locale} の一字違い`);
    }
  });

  test("L-36b 一字違いは本当に1文字差である", async () => {
    const { localeText, LOCALES } = await load();
    for (const locale of LOCALES) {
      const { playerName: a, playerNameAlt: b } = localeText(locale);
      const A = [...a], B = [...b];
      assert.equal(A.length, B.length, `${locale}: 長さが違う（${a} / ${b}）`);
      const diff = A.filter((ch, i) => ch !== B[i]).length;
      assert.equal(diff, 1, `${locale}: ${diff} 文字違う（1文字であるべき）: ${a} / ${b}`);
    }
  });

  test("L-36c 氏名は全5枚に印字される（比較対象が無いと L-4 が成立しない）", async () => {
    const { docSpecs, LOCALES } = await load();
    for (const locale of LOCALES) {
      for (const [key, d] of Object.entries(docSpecs(locale))) {
        assert.equal(d.showsName, true, `${locale}/${key} が氏名を印字しない`);
      }
    }
  });
});
