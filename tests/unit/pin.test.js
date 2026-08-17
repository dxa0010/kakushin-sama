/* ============================================================
   マイナンバーカード暗証番号ロジック（src/pin.js）のユニットテスト
   仕様書: docs/test-specs/shiyakusho-end.md
   各 test 名の先頭のIDが仕様書の表のIDと1対1で対応する。
   ------------------------------------------------------------
   実行: node --test tests/unit/
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

/* ---------- テスト用の定数 ----------
 * 既定の正解に本番値 0315 をあえて使わない。src/pin.js が 0315 を
 * ハードコードしていたら FN-11 で露見するようにするため。 */
const ANSWER = "4771";
const WRONG = "0000";
const PROD_ANSWER = "0315";

const PIN_URL = new URL("../../src/pin.js", import.meta.url).href;

const RESULT_KEYS = ["already", "attemptsLeft", "finalWarning", "justLocked", "locked", "reason", "status"];
const STATE_KEYS = ["attemptsLeft", "attemptsUsed", "authenticated", "locked", "maxAttempts"];

/** src/pin.js を読み込む。各テストから個別に呼ぶので、未実装なら各ケースが個別に失敗する。 */
async function loadPin() {
  let mod;
  try {
    mod = await import(PIN_URL);
  } catch (e) {
    assert.fail(`src/pin.js を import できない（未実装 or 構文エラー）: ${e.message}`);
  }
  assert.equal(typeof mod.createPinGate, "function", "createPinGate を named export していない");
  assert.equal(typeof mod.normalizePin, "function", "normalizePin を named export していない");
  return mod;
}

/** 既定の設定（正解 4771 / 3回）でゲートを作る。overrides で個別に変えられる。 */
async function newGate(overrides = {}) {
  const { createPinGate } = await loadPin();
  return createPinGate({ answer: ANSWER, maxAttempts: 3, ...overrides });
}

/* ============================================================
   機能要件（正常系）
   ============================================================ */
describe("機能要件", () => {
  test("FN-01 生成直後は残り回数が maxAttempts で、ロックも認証もされていない", async () => {
    const gate = await newGate();
    assert.deepEqual(gate.getState(), {
      attemptsLeft: 3, attemptsUsed: 0, maxAttempts: 3, locked: false, authenticated: false,
    });
  });

  test("FN-02 1回目で正解すると認証に成功する", async () => {
    const gate = await newGate();
    const r = gate.submit(ANSWER);
    assert.equal(r.status, "ok");
    assert.equal(r.already, false);
    assert.equal(r.attemptsLeft, 3, "正解では試行回数を消費しない");
    assert.equal(gate.getState().authenticated, true);
  });

  test("FN-03 2回ミスした後でも正解すれば認証に成功する（カウンタが正解を妨げない）", async () => {
    const gate = await newGate();
    gate.submit(WRONG);
    gate.submit(WRONG);
    const r = gate.submit(ANSWER);
    assert.equal(r.status, "ok");
    assert.equal(r.locked, false);
    assert.equal(r.attemptsLeft, 1, "残り回数は減らずに1のまま");
  });

  test("FN-04 1回目のミスは status:wrong・残り2回・最終警告ではない", async () => {
    const gate = await newGate();
    const r = gate.submit(WRONG);
    assert.equal(r.status, "wrong");
    assert.equal(r.attemptsLeft, 2);
    assert.equal(r.finalWarning, false);
    assert.equal(r.locked, false);
  });

  test("FN-05 2回目のミスは最終警告（あと1回でロック）になる", async () => {
    const gate = await newGate();
    gate.submit(WRONG);
    const r = gate.submit(WRONG);
    assert.equal(r.status, "wrong");
    assert.equal(r.attemptsLeft, 1);
    assert.equal(r.finalWarning, true, "ヒント再提示と怪人の呼び出しの合図になる");
    assert.equal(r.locked, false);
  });

  test("FN-06 3回目のミスでロックする", async () => {
    const gate = await newGate();
    gate.submit(WRONG);
    gate.submit(WRONG);
    const r = gate.submit(WRONG);
    assert.equal(r.status, "locked");
    assert.equal(r.locked, true);
    assert.equal(r.justLocked, true, "ending(\"shiyakusho\") を1回だけ呼ぶための合図");
    assert.equal(r.attemptsLeft, 0);
    assert.equal(gate.getState().locked, true);
  });

  test("FN-07 認証成功後の submit は入力に関わらず ok で、試行回数を消費しない", async () => {
    const gate = await newGate();
    gate.submit(ANSWER);
    for (let i = 0; i < 3; i++) {
      const r = gate.submit(WRONG);
      assert.equal(r.status, "ok");
      assert.equal(r.already, true);
      assert.equal(r.locked, false);
      assert.equal(r.attemptsLeft, 3);
    }
    assert.equal(gate.getState().locked, false, "認証後にロックされることはない");
  });

  test("FN-08 戻り値と状態のキー集合が契約どおり（過不足なし）", async () => {
    const gate = await newGate();
    assert.deepEqual(Object.keys(gate.submit("")).sort(), RESULT_KEYS, "invalid の結果");
    assert.deepEqual(Object.keys(gate.submit(WRONG)).sort(), RESULT_KEYS, "wrong の結果");
    assert.deepEqual(Object.keys(gate.submit(ANSWER)).sort(), RESULT_KEYS, "ok の結果");
    assert.deepEqual(Object.keys(gate.getState()).sort(), STATE_KEYS, "状態");

    const locked = await newGate({ maxAttempts: 1 });
    assert.deepEqual(Object.keys(locked.submit(WRONG)).sort(), RESULT_KEYS, "locked の結果");
  });

  test("FN-09 公開APIは submit と getState のちょうど2つ（正解を取り出す口が無い）", async () => {
    const gate = await newGate();
    assert.deepEqual(Object.keys(gate).sort(), ["getState", "submit"]);
  });

  test("FN-10 normalizePin は正しい4桁をそのまま返す", async () => {
    const { normalizePin } = await loadPin();
    assert.equal(normalizePin("0315"), "0315");
    assert.equal(normalizePin("0000"), "0000");
  });

  test("FN-11 正解値は注入されている（0315 がハードコードされていない）", async () => {
    const gate = await newGate();          // answer は 4771
    const r = gate.submit(PROD_ANSWER);
    assert.equal(r.status, "wrong", "0315 が無条件に通ってはいけない");
  });

  test("FN-12 期待桁数は answer の長さから導出される", async () => {
    const gate = await newGate({ answer: "12" });
    assert.equal(gate.submit("12").status, "ok");
    const gate2 = await newGate({ answer: "12" });
    const r = gate2.submit("0012");
    assert.equal(r.status, "invalid");
    assert.equal(r.reason, "format");
  });

  test("FN-13 本番値（0315 / 3回）で半角・全角どちらも認証できる", async () => {
    const half = await newGate({ answer: PROD_ANSWER });
    assert.equal(half.submit("0315").status, "ok");
    const full = await newGate({ answer: PROD_ANSWER });
    assert.equal(full.submit("０３１５").status, "ok");
  });
});

/* ============================================================
   境界値
   ============================================================ */
describe("境界値", () => {
  test("BD-01 残り回数が 3→2→1→0 と1つずつ減る", async () => {
    const gate = await newGate();
    const seq = [gate.submit(WRONG), gate.submit(WRONG), gate.submit(WRONG)];
    assert.deepEqual(seq.map(r => r.attemptsLeft), [2, 1, 0]);
    assert.deepEqual(seq.map(r => r.status), ["wrong", "wrong", "locked"]);
  });

  test("BD-02 2回のミスではロックしない", async () => {
    const gate = await newGate();
    gate.submit(WRONG);
    const r = gate.submit(WRONG);
    assert.equal(r.locked, false);
    assert.equal(r.justLocked, false);
    assert.equal(gate.getState().locked, false);
  });

  test("BD-03 maxAttempts:1 なら1回のミスで即ロックする", async () => {
    const gate = await newGate({ maxAttempts: 1 });
    const r = gate.submit(WRONG);
    assert.equal(r.status, "locked");
    assert.equal(r.justLocked, true);
    assert.equal(r.finalWarning, false, "警告する猶予が無い場合は最終警告を出さない");
    assert.equal(r.attemptsLeft, 0);
  });

  test("BD-04 maxAttempts:5 なら5回目のミスでロックし、4回目が最終警告になる", async () => {
    const gate = await newGate({ maxAttempts: 5 });
    const seq = [];
    for (let i = 0; i < 5; i++) seq.push(gate.submit(WRONG));
    assert.deepEqual(seq.map(r => r.status), ["wrong", "wrong", "wrong", "wrong", "locked"]);
    assert.deepEqual(seq.map(r => r.finalWarning), [false, false, false, true, false]);
    assert.deepEqual(seq.map(r => r.attemptsLeft), [4, 3, 2, 1, 0]);
  });

  test("BD-05 attemptsUsed は試行を消費したときだけ増える", async () => {
    const gate = await newGate();
    gate.submit("");
    assert.equal(gate.getState().attemptsUsed, 0);
    gate.submit("477");
    assert.equal(gate.getState().attemptsUsed, 0);
    gate.submit(null);
    assert.equal(gate.getState().attemptsUsed, 0);
    gate.submit(WRONG);
    assert.equal(gate.getState().attemptsUsed, 1);
  });
});

/* ============================================================
   異常系（不正入力は試行回数を消費しない）
   ============================================================ */
describe("異常系", () => {
  /** 不正入力の共通検証: invalid / 指定 reason / 消費なし */
  async function expectInvalid(input, reason) {
    const gate = await newGate();
    const before = gate.getState();
    const r = gate.submit(input);
    assert.equal(r.status, "invalid");
    assert.equal(r.reason, reason);
    assert.equal(r.attemptsLeft, before.attemptsLeft, "不正入力は試行回数を消費しない");
    assert.equal(gate.getState().attemptsUsed, 0);
    assert.equal(gate.getState().locked, false);
  }

  test("ER-01 空文字は invalid/empty で試行を消費しない", async () => {
    await expectInvalid("", "empty");
  });

  test("ER-02 空白のみ（半角・全角）は invalid/empty で試行を消費しない", async () => {
    await expectInvalid("   ", "empty");
    await expectInvalid("　　", "empty");
    await expectInvalid("\t\n", "empty");
  });

  test("ER-03 3桁は invalid/format で試行を消費しない", async () => {
    await expectInvalid("477", "format");
  });

  test("ER-04 5桁は invalid/format で試行を消費しない", async () => {
    await expectInvalid("47710", "format");
  });

  test("ER-05 数字以外を含む入力は invalid/format で試行を消費しない", async () => {
    await expectInvalid("03a5", "format");
    await expectInvalid("47７a", "format");
  });

  test("ER-06 内部に空白のある入力は invalid/format で試行を消費しない", async () => {
    await expectInvalid("031 5", "format");
    await expectInvalid("47 71", "format");
  });

  test("ER-07 null は invalid/type で試行を消費しない", async () => {
    await expectInvalid(null, "type");
  });

  test("ER-08 undefined と引数なしは invalid/type で試行を消費しない", async () => {
    await expectInvalid(undefined, "type");
    const gate = await newGate();
    const r = gate.submit();
    assert.equal(r.status, "invalid");
    assert.equal(r.reason, "type");
    assert.equal(r.attemptsLeft, 3);
  });

  test("ER-09 数値 315 は invalid/type（先頭ゼロが落ちた形を通さない）", async () => {
    await expectInvalid(315, "type");
    const prod = await newGate({ answer: PROD_ANSWER });
    const r = prod.submit(315);
    assert.equal(r.status, "invalid", "数値 315 を \"0315\" として扱ってはいけない");
    assert.equal(r.reason, "type");
    assert.equal(prod.getState().authenticated, false);
  });

  test("ER-10 String オブジェクトは invalid/type（プリミティブ文字列のみ受理）", async () => {
    await expectInvalid(new String(ANSWER), "type");
  });

  test("ER-11 想定外の型を渡しても例外を投げず invalid/type になる", async () => {
    const gate = await newGate();
    const hostile = { toString() { throw new Error("boom"); } };
    const inputs = [hostile, Symbol("pin"), [4, 7, 7, 1], NaN, true, false, {}, () => {}, BigInt(4771)];
    for (const input of inputs) {
      let r;
      assert.doesNotThrow(() => { r = gate.submit(input); }, `submit が例外を投げた: ${String(input.toString ? "(object)" : input)}`);
      assert.equal(r.status, "invalid");
      assert.equal(r.reason, "type");
    }
    assert.equal(gate.getState().attemptsLeft, 3, "想定外の入力で試行を消費しない");
  });

  test("ER-12 不正入力を繰り返してもロックに到達しない", async () => {
    const gate = await newGate();
    for (let i = 0; i < 20; i++) gate.submit(["", "1", "12345", "abcd", null, 315][i % 6]);
    assert.equal(gate.getState().attemptsLeft, 3);
    assert.equal(gate.getState().locked, false);
  });

  test("ER-13 不正入力のあとに正解を入れれば認証できる", async () => {
    const gate = await newGate();
    gate.submit("");
    gate.submit("477");
    assert.equal(gate.submit(ANSWER).status, "ok");
  });

  test("ER-14 normalizePin は不正な入力すべてに null を返す", async () => {
    const { normalizePin } = await loadPin();
    for (const bad of ["", "   ", "477", "47710", "03a5", "031 5", null, undefined, 315,
                       "٠٣١٥", "〇三一五", {}, [], true]) {
      assert.equal(normalizePin(bad), null, `normalizePin(${String(bad)}) は null であるべき`);
    }
  });
});

/* ============================================================
   正規化
   ============================================================ */
describe("正規化", () => {
  test("NM-01 全角数字の入力が正解として通る", async () => {
    const gate = await newGate();
    assert.equal(gate.submit("４７７１").status, "ok");
  });

  test("NM-02 全角と半角が混在しても正解として通る", async () => {
    const gate = await newGate();
    assert.equal(gate.submit("４７7１").status, "ok");
  });

  test("NM-03 前後の空白（半角・タブ・改行・全角空白）を除去して通る", async () => {
    for (const raw of [" 4771 ", "\t4771\n", "　4771　", "4771 "]) {
      const gate = await newGate();
      assert.equal(gate.submit(raw).status, "ok", `"${raw}" は正解として通るべき`);
    }
  });

  test("NM-04 全角で入力された誤りは wrong（正規化が判定を甘くしない）", async () => {
    const gate = await newGate();
    const r = gate.submit("００００");
    assert.equal(r.status, "wrong");
    assert.equal(r.attemptsLeft, 2, "正規化できた誤りは試行を消費する");
  });

  test("NM-05 normalizePin が全角と前後の空白を正規化する", async () => {
    const { normalizePin } = await loadPin();
    assert.equal(normalizePin("０３１５"), "0315");
    assert.equal(normalizePin(" 0315 "), "0315");
    assert.equal(normalizePin("０３15"), "0315");
    assert.equal(normalizePin("　0315\n"), "0315");
  });

  test("NM-06 normalizePin は桁数を指定できる", async () => {
    const { normalizePin } = await loadPin();
    assert.equal(normalizePin("12345", 5), "12345");
    assert.equal(normalizePin("1234", 5), null);
    assert.equal(normalizePin("12", 2), "12");
  });

  test("NM-07 正解側（answer）も正規化される", async () => {
    const gate = await newGate({ answer: "４７７１" });
    assert.equal(gate.submit("4771").status, "ok");
  });
});

/* ============================================================
   ロック後の冪等性
   ============================================================ */
describe("ロック後の冪等性", () => {
  /** ロック済みのゲートを作る */
  async function lockedGate() {
    const gate = await newGate();
    gate.submit(WRONG); gate.submit(WRONG); gate.submit(WRONG);
    return gate;
  }

  test("LK-01 ロック後に誤りを入れてもロックのまま（justLocked は立たない）", async () => {
    const gate = await lockedGate();
    const r = gate.submit(WRONG);
    assert.equal(r.status, "locked");
    assert.equal(r.justLocked, false);
    assert.equal(r.attemptsLeft, 0);
  });

  test("LK-02 ロック後に正解を入れても認証できない（ロックは不可逆）", async () => {
    const gate = await lockedGate();
    const r = gate.submit(ANSWER);
    assert.equal(r.status, "locked");
    assert.equal(gate.getState().authenticated, false);
  });

  test("LK-03 ロック後に何度 submit しても残り回数が負にならない", async () => {
    const gate = await lockedGate();
    for (let i = 0; i < 10; i++) {
      const r = gate.submit(WRONG);
      assert.equal(r.attemptsLeft, 0);
    }
    assert.equal(gate.getState().attemptsLeft, 0);
    assert.equal(gate.getState().attemptsUsed, 3, "ロック後は試行回数も増えない");
  });

  test("LK-04 justLocked は3回目のミスのときだけ true（ending の二重呼び出しを防げる）", async () => {
    const gate = await newGate();
    const flags = [];
    for (let i = 0; i < 10; i++) flags.push(gate.submit(WRONG).justLocked);
    assert.deepEqual(flags, [false, false, true, false, false, false, false, false, false, false]);
    assert.equal(flags.filter(Boolean).length, 1);
  });

  test("LK-05 ロック後の不正入力もロック扱いになる（reason は付かない）", async () => {
    const gate = await lockedGate();
    for (const bad of ["", null, "12", 315]) {
      const r = gate.submit(bad);
      assert.equal(r.status, "locked");
      assert.equal(r.reason, null);
    }
  });
});

/* ============================================================
   情報漏洩
   ============================================================ */
describe("情報漏洩", () => {
  test("SEC-01 どの戻り値にも正解が含まれない", async () => {
    const gate = await newGate();
    const results = [gate.submit(""), gate.submit(WRONG), gate.submit(WRONG), gate.submit(WRONG)];
    const ok = await newGate();
    results.push(ok.submit(ANSWER), ok.submit(WRONG));
    for (const r of results) {
      assert.ok(!JSON.stringify(r).includes(ANSWER), `戻り値に正解が漏れている: ${JSON.stringify(r)}`);
    }
  });

  test("SEC-02 getState() に正解が含まれない", async () => {
    const gate = await newGate();
    const states = [JSON.stringify(gate.getState())];
    gate.submit(WRONG); states.push(JSON.stringify(gate.getState()));
    gate.submit(ANSWER); states.push(JSON.stringify(gate.getState()));
    for (const s of states) assert.ok(!s.includes(ANSWER), `状態に正解が漏れている: ${s}`);
  });

  test("SEC-03 インスタンスを覗いても正解が読み取れない", async () => {
    const gate = await newGate();
    gate.submit(WRONG);
    const dumps = [
      JSON.stringify(gate), String(gate), Object.keys(gate).join(","),
      JSON.stringify(gate.getState()),
      ...Object.getOwnPropertyNames(gate).map(k => String(gate[k])),
      String(gate.submit), String(gate.getState),
    ];
    for (const d of dumps) {
      assert.ok(!d.includes(ANSWER), `正解が読み取れてしまう: ${d.slice(0, 200)}`);
    }
  });

  test("SEC-04 状態に正解を返しそうな名前のキーが無い", async () => {
    const gate = await newGate();
    const keys = Object.keys(gate.getState()).map(k => k.toLowerCase());
    for (const bad of ["answer", "pin", "code", "secret", "expected", "correct"]) {
      assert.ok(!keys.some(k => k.includes(bad)), `getState() に ${bad} を含むキーがある`);
    }
  });

  test("SEC-05 src/pin.js が eval / new Function を使わない", async () => {
    const src = stripComments(await readSrc("src/pin.js"));
    assert.ok(!/\beval\s*\(/.test(src), "eval を使っている");
    assert.ok(!/new\s+Function\s*\(/.test(src), "new Function を使っている");
  });
});

/* ============================================================
   非機能（性能は tests/unit/pin.perf.test.js に分離）
   ============================================================ */
describe("非機能", () => {
  test("NF-03 別インスタンスの試行回数は独立している（モジュール状態を持たない）", async () => {
    const a = await newGate();
    const b = await newGate();
    a.submit(WRONG); a.submit(WRONG);
    assert.equal(a.getState().attemptsLeft, 1);
    assert.deepEqual(b.getState(), {
      attemptsLeft: 3, attemptsUsed: 0, maxAttempts: 3, locked: false, authenticated: false,
    });
    a.submit(WRONG);
    assert.equal(a.getState().locked, true);
    assert.equal(b.getState().locked, false, "片方のロックが他方に伝播してはいけない");
  });

  test("NF-04 生成後に options を書き換えても挙動が変わらない（防御的コピー）", async () => {
    const { createPinGate } = await loadPin();
    const opts = { answer: ANSWER, maxAttempts: 3 };
    const gate = createPinGate(opts);
    opts.answer = WRONG;
    opts.maxAttempts = 99;
    assert.equal(gate.submit(WRONG).status, "wrong", "外から正解を差し替えられてはいけない");
    const gate2 = createPinGate({ answer: ANSWER, maxAttempts: 3 });
    const opts2 = { answer: ANSWER, maxAttempts: 3 };
    const gate3 = createPinGate(opts2);
    opts2.maxAttempts = 99;
    gate3.submit(WRONG); gate3.submit(WRONG);
    assert.equal(gate3.submit(WRONG).status, "locked", "maxAttempts も生成時の値で固定される");
    assert.equal(gate2.submit(ANSWER).status, "ok");
  });

  test("NF-05 src/pin.js が副作用のある API を参照しない（純粋・再現性）", async () => {
    const src = stripComments(await readSrc("src/pin.js"));
    const forbidden = [
      /\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
      /\bfetch\s*\(/, /AudioContext/, /\bTHREE\b/, /\bMath\.random\b/, /\bDate\b/,
      /\bperformance\b/, /\bconsole\b/, /\bprocess\b/, /\brequire\s*\(/,
    ];
    for (const re of forbidden) {
      assert.ok(!re.test(src), `src/pin.js が ${re} を参照している（純粋であるべき）`);
    }
    assert.ok(!/^\s*import\b/m.test(src), "src/pin.js は何も import しない（依存ゼロ）");
  });

  test("NF-07 生成時の引数不正は例外になり、メッセージに引数名を含む", async () => {
    const { createPinGate } = await loadPin();
    const badAnswers = [undefined, null, "", "abc", "03a5", "03 15", 315, {}, [], "０３a５"];
    for (const answer of badAnswers) {
      assert.throws(() => createPinGate({ answer, maxAttempts: 3 }), /answer/,
        `answer=${String(answer)} は生成時に例外になるべき`);
    }
    assert.throws(() => createPinGate(), /answer/, "引数なしは例外になるべき");
    const badMax = [undefined, null, 0, -1, 1.5, "3", NaN, Infinity, {}];
    for (const maxAttempts of badMax) {
      assert.throws(() => createPinGate({ answer: ANSWER, maxAttempts }), /maxAttempts/,
        `maxAttempts=${String(maxAttempts)} は生成時に例外になるべき`);
    }
  });

  test("NF-08 submit は例外を投げず、不正理由を reason で返す（握りつぶさない）", async () => {
    const gate = await newGate();
    const cases = [["", "empty"], ["   ", "empty"], ["477", "format"], ["47710", "format"],
                   ["03a5", "format"], [null, "type"], [315, "type"], [Symbol("x"), "type"]];
    for (const [input, reason] of cases) {
      let r;
      assert.doesNotThrow(() => { r = gate.submit(input); });
      assert.equal(r.reason, reason, `${String(input)} の reason`);
      assert.ok(["type", "empty", "format"].includes(r.reason));
    }
  });
});

/* ---------- ソース読み出しヘルパー（静的検査用） ----------
 * コメントは検査対象から外す（コメントに "window に触らない" などと書いてあるだけで
 * 落ちるのは理不尽なため）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

async function readSrc(rel) {
  const { readFile } = await import("node:fs/promises");
  const url = new URL(`../../${rel}`, import.meta.url);
  try {
    return await readFile(url, "utf8");
  } catch (e) {
    assert.fail(`${rel} が存在しない（未実装）: ${e.message}`);
  }
}
