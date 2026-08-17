/* =====================================================================
 * pin.js ── マイナンバーカード暗証番号ロジック（ゲーム非依存・純粋関数）
 *
 * 仕様書: docs/test-specs/shiyakusho-end.md
 *
 * 【なぜ別ファイルか】ブラウザ無しで node --test から検証できるようにするため。
 * DOM / Audio / three / localStorage / Math.random / Date など、副作用のある
 * ものには一切触れない（NF-05）。正解値・最大試行回数もここには書かない。
 * `answer` / `maxAttempts` は必ず呼び出し側（src/game.js）から注入する。
 * ===================================================================== */

/** 全角数字（U+FF10〜U+FF19）だけを半角へ変換する。
 * アラビア数字以外の Unicode 数字（"٠٣١٥" や "〇三一五"）は対象外
 * （日本語IMEで現実に起こるのは全角数字だけ、という設計時の仮定）。 */
function toHalfWidthDigits(s) {
  return s.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10));
}

/** 型・前後の空白・全角数字を正規化し、「数字だけの文字列」を返す。
 * 数字にならなければ null。桁数はここでは判定しない（呼び出し側の責務）。
 * `String.prototype.trim()` は仕様上、半角空白・タブ・改行・全角空白(U+3000) を
 * 除去する（A-6）。 */
function digitsOnly(raw) {
  if (typeof raw !== "string") return null;   // 暗黙の文字列化はしない（A-4）
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const half = toHalfWidthDigits(trimmed);
  return /^[0-9]+$/.test(half) ? half : null;
}

/**
 * raw を digits 桁の数字文字列へ正規化する。全角数字→半角、前後の空白除去。
 * 正規化できなければ null。UI は「4桁揃うまで送信不可」の判定にこれを使う。
 */
export function normalizePin(raw, digits = 4) {
  const d = digitsOnly(raw);
  if (d === null) return null;
  return d.length === digits ? d : null;
}

/** 生成時の PinResult（invalid/locked/ok/wrong）を7キーちょうどで作る。 */
function makeResult({ status, attemptsLeft, locked, finalWarning, justLocked, already, reason }) {
  return { status, attemptsLeft, locked, finalWarning, justLocked, already, reason };
}

/**
 * 暗証番号ゲートを作る。answer / maxAttempts は必須（既定値を持たない＝A-7）。
 * 不正な引数は黙って動かさず、生成時に例外を投げる（メッセージに引数名を含む）。
 */
export function createPinGate(options) {
  const { answer, maxAttempts } = options || {};

  // answer: 正規化して「1桁以上の数字列」であればよい。期待桁数はここから導出する（A-8）。
  const normAnswer = digitsOnly(answer);
  if (normAnswer === null) {
    throw new Error(
      `createPinGate: answer は数字のみの文字列である必要があります（受け取った値: ${JSON.stringify(answer)}）`
    );
  }

  // maxAttempts: 1以上の整数のみ受け付ける。
  const validMax =
    typeof maxAttempts === "number" && Number.isInteger(maxAttempts) && maxAttempts >= 1;
  if (!validMax) {
    throw new Error(
      `createPinGate: maxAttempts は1以上の整数である必要があります（受け取った値: ${JSON.stringify(maxAttempts)}）`
    );
  }

  // ここで options を分解済みなので、生成後に options 自体を書き換えても
  // この先の判定には影響しない（NF-04：防御的コピー）。
  let attemptsUsed = 0;
  let locked = false;
  let authenticated = false;

  function attemptsLeft() {
    return Math.max(0, maxAttempts - attemptsUsed);
  }

  function submit(raw) {
    // 判定の順序は仕様書どおり：1)ロック 2)認証済み 3)型 4)空 5)桁数/形式 6)照合
    if (locked) {
      return makeResult({
        status: "locked", attemptsLeft: 0, locked: true,
        finalWarning: false, justLocked: false, already: false, reason: null,
      });
    }
    if (authenticated) {
      return makeResult({
        status: "ok", attemptsLeft: attemptsLeft(), locked: false,
        finalWarning: false, justLocked: false, already: true, reason: null,
      });
    }
    if (typeof raw !== "string") {
      return makeResult({
        status: "invalid", attemptsLeft: attemptsLeft(), locked: false,
        finalWarning: false, justLocked: false, already: false, reason: "type",
      });
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      return makeResult({
        status: "invalid", attemptsLeft: attemptsLeft(), locked: false,
        finalWarning: false, justLocked: false, already: false, reason: "empty",
      });
    }
    const half = toHalfWidthDigits(trimmed);
    if (!/^[0-9]+$/.test(half) || half.length !== normAnswer.length) {
      return makeResult({
        status: "invalid", attemptsLeft: attemptsLeft(), locked: false,
        finalWarning: false, justLocked: false, already: false, reason: "format",
      });
    }
    if (half === normAnswer) {
      authenticated = true;
      return makeResult({
        status: "ok", attemptsLeft: attemptsLeft(), locked: false,
        finalWarning: false, justLocked: false, already: false, reason: null,
      });
    }
    attemptsUsed++;
    const left = attemptsLeft();
    if (left <= 0) {
      locked = true;
      return makeResult({
        status: "locked", attemptsLeft: 0, locked: true,
        finalWarning: false, justLocked: true, already: false, reason: null,
      });
    }
    return makeResult({
      status: "wrong", attemptsLeft: left, locked: false,
      finalWarning: left === 1, justLocked: false, already: false, reason: null,
    });
  }

  function getState() {
    return {
      attemptsLeft: attemptsLeft(),
      attemptsUsed,
      maxAttempts,
      locked,
      authenticated,
    };
  }

  // 公開キーは submit / getState のちょうど2つ（正解を取り出す口を持たない＝SEC-01〜04）。
  return { submit, getState };
}
