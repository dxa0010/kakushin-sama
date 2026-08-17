/* ============================================================
   src/pin.js の性能・計算量テスト（環境依存のため別ファイルに分離）
   仕様書: docs/test-specs/shiyakusho-end.md（NF-01 / NF-02）
   ------------------------------------------------------------
   遅いマシンで揺れる場合はこのファイルだけ除外して実行できる:
     node --test tests/unit/pin.test.js tests/unit/wiring.test.js
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

const PIN_URL = new URL("../../src/pin.js", import.meta.url).href;
const ANSWER = "4771";
const WRONG = "0000";

async function loadPin() {
  try {
    return await import(PIN_URL);
  } catch (e) {
    assert.fail(`src/pin.js を import できない（未実装 or 構文エラー）: ${e.message}`);
  }
}

/** 誤り・不正入力・ロック後を混ぜて n 回 submit し、所要ミリ秒を返す */
function hammer(createPinGate, n) {
  const gate = createPinGate({ answer: ANSWER, maxAttempts: 3 });
  const inputs = [WRONG, "", "477", "０３１５", null, WRONG];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) gate.submit(inputs[i % inputs.length]);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

describe("非機能（性能）", () => {
  test("NF-01 submit を 200,000 回呼んでも 1,000ms 未満（無限ループ・重い処理が無い）", async () => {
    const { createPinGate } = await loadPin();
    hammer(createPinGate, 20000);                 // ウォームアップ（JIT）
    const ms = hammer(createPinGate, 200000);
    assert.ok(ms < 1000, `200,000回の submit に ${ms.toFixed(1)}ms かかった（閾値 1,000ms）`);
  });

  test("NF-02 呼び出し回数10倍で所要時間が25倍未満（1回あたりO(1)。二次曲線なら100倍になる）", async () => {
    const { createPinGate } = await loadPin();
    hammer(createPinGate, 20000);                 // ウォームアップ（JIT）
    const small = hammer(createPinGate, 20000);
    const large = hammer(createPinGate, 200000);
    const ratio = large / Math.max(small, 0.05);  // 0除算回避
    assert.ok(ratio < 25,
      `20,000回=${small.toFixed(1)}ms, 200,000回=${large.toFixed(1)}ms（比 ${ratio.toFixed(2)}倍、閾値 25倍）`);
  });
});
