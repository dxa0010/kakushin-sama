/* ============================================================
   配線テスト（ソース静的検査・ブラウザ不要）
   仕様書: docs/test-specs/shiyakusho-end.md（W-01 〜 W-16, NF-06）
   ------------------------------------------------------------
   src/game.js は DOM と Three.js に密結合していて Node から実行できない。
   そこで「実装漏れが起きやすい配線」をソース文字列として検査する層を置く。
   E2E（tests/e2e/shiyakusho.mjs）は Playwright がリポジトリに無く自動実行できないため、
   この層がその代替になる。
   ============================================================ */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => {
  try {
    return readFileSync(new URL(rel, ROOT), "utf8");
  } catch (e) {
    assert.fail(`${rel} を読めない: ${e.message}`);
  }
};
const GAME = () => read("src/game.js");
const HTML = () => read("index.html");

/** 先頭が column 0 の `}` で閉じる関数の本体を取り出す（game.js のトップレベル関数の書式） */
function fnBody(src, name) {
  const re = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  assert.ok(m, `function ${name}() が見つからない`);
  return m[1];
}
const count = (src, needle) => src.split(needle).length - 1;

describe("配線: pin.js の利用", () => {
  test("W-01 game.js が ./pin.js から createPinGate と normalizePin を import している", () => {
    const game = GAME();
    const imports = [...game.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/pin\.js["']/g)]
      .map(m => m[1]).join(",");
    assert.ok(imports, 'src/pin.js からの import 文が無い');
    assert.match(imports, /createPinGate/, "createPinGate を import していない");
    assert.match(imports, /normalizePin/, "normalizePin を import していない（4桁揃うまで送信不可の判定に使う）");
  });

  test("W-02 正解 0315 と maxAttempts:3 を注入して gate を生成している", () => {
    const game = GAME();
    const m = game.match(/createPinGate\(([\s\S]{0,400}?)\)/);
    assert.ok(m, "createPinGate(...) の呼び出しが無い");
    assert.match(m[1], /["']0315["']/, "正解 0315 を注入していない");
    assert.match(m[1], /maxAttempts\s*:\s*3\b/, "maxAttempts: 3 を注入していない");
  });

  test("W-03 gate の生成は openEtax() の外（ウィンドウを開き直しても試行回数が保持される）", () => {
    const body = fnBody(GAME(), "openEtax");
    assert.ok(!body.includes("createPinGate"),
      "openEtax の中で gate を作ると、閉じて開き直すたびに試行回数がリセットされてしまう");
  });

  test("W-04 試行回数をセーブに永続化していない（save の構造も不変）", () => {
    const game = GAME();
    assert.ok(!/save\.[A-Za-z_$]*[Pp]in/.test(game), "save に暗証番号の状態を書き込んでいる");
    assert.match(game,
      /Object\.assign\(\{ found: \{\}, endings: \{\}, runs: 0, bestRank: "", audio: null \}/,
      "save の既定構造が変わっている（本機能では save を変更しない）");
  });

  test("W-12 etaxPin の入力を normalizePin で検証して送信ボタンを制御している", () => {
    const game = GAME();
    assert.match(game, /etaxPin/, "入力欄 #etaxPin を参照していない");
    assert.match(game, /normalizePin\s*\(/, "normalizePin を呼んでいない");
    // 入力の途中でボタンの有効/無効が切り替わる必要があるので、入力イベントを拾っているはず
    const listens = /etaxPin[\s\S]{0,160}?addEventListener\(\s*["']input["']/.test(game)
      || /oninput/.test(HTML());
    assert.ok(listens, "#etaxPin の入力イベントを拾っていない（4桁揃うまで送信不可にできない）");
  });

  test("W-15 __dbg に pin と openEtax を公開している（E2Eから残り回数を観測するため）", () => {
    const game = GAME();
    const m = game.match(/window\.__dbg\s*=\s*\{[\s\S]*$/);
    assert.ok(m, "window.__dbg の定義が見つからない");
    assert.match(m[0], /\bpin\b/, "__dbg に pin（getState を持つゲート）を公開していない");
    assert.match(m[0], /\bopenEtax\b/, "__dbg に openEtax を公開していない");
  });
});

describe("配線: 手掛かりの公平性とメッセージ", () => {
  test("W-05 DOCSPECS.password の暗証番号マスクがちょうど ＊4個（8個は誤誘導）", () => {
    const m = GAME().match(/\["暗証番号",\s*"(＊+)"\]/);
    assert.ok(m, "DOCSPECS.password の暗証番号の行が見つからない");
    assert.equal([...m[1]].length, 4,
      `マスクが ${[...m[1]].length} 個になっている。実物の暗証番号は4桁なので ＊＊＊＊ にする`);
  });

  test("W-13 ミス時のメッセージ（違います・残り回数・ロック警告）がある", () => {
    const game = GAME();
    assert.match(game, /暗証番号が違います/, "ミス時のメッセージが無い");
    assert.match(game, /残り/, "残り回数の表示が無い");
    assert.match(game, /ロックされます/, "2回目ミスのロック警告が無い");
  });

  test("W-14 2回目のミスでメモの手掛かりを再提示している", () => {
    const n = count(GAME(), "いつもの");
    assert.ok(n >= 3,
      `『いつもの』の出現が ${n} 箇所しかない（既存2箇所＋2回目ミスでの再提示で3箇所以上になるはず）`);
  });

  test("W-16 暗証番号のミスごとに aggro を増やしている", () => {
    const n = count(GAME(), "aggro++");
    assert.ok(n >= 3, `aggro++ が ${n} 箇所しかない（既存2箇所＋暗証番号ミスで3箇所以上になるはず）`);
  });
});

describe("配線: 市役所 END", () => {
  test("W-06 EDS.shiyakusho があり、tag と文体が仕様どおり", () => {
    const game = GAME();
    const m = game.match(/shiyakusho\s*:\s*\{([\s\S]*?)\}/);
    assert.ok(m, "EDS に shiyakusho が無い");
    const entry = m[1];
    assert.match(entry, /tag:\s*"市役所 END"/, 'tag が "市役所 END" でない');
    assert.match(entry, /ロック/, "text にカードがロックされた旨が無い");
    assert.match(entry, /平日/, "text に市役所の受付（平日9時〜17時）が無い");
    assert.match(entry, /<br>/, "既存3つと同じ文体（<br>で短い断定を並べる）になっていない");
  });

  test("W-07 ending(\"shiyakusho\") を呼んでいる", () => {
    assert.match(GAME(), /ending\(\s*["']shiyakusho["']\s*\)/, 'ending("shiyakusho") の呼び出しが無い');
  });

  test("W-08 refreshTitleMeta が4つ目のエンディングを数える", () => {
    const body = fnBody(GAME(), "refreshTitleMeta");
    assert.ok(/shiyakusho/.test(body) || /Object\.keys\(EDS\)/.test(body),
      "refreshTitleMeta が shiyakusho を数えていない（エンディング数のハードコードを直す）");
    assert.ok(!/\/3/.test(body),
      "エンディング数 /3 がハードコードされたまま（4つ目を数えるようにする）");
  });
});

describe("回帰: 既存の挙動を壊していない", () => {
  test("W-09 既存3エンディングの tag と text が一字も変わっていない", () => {
    const game = GAME();
    const originals = [
      'refund: { tag: "還付 END", text: "受付完了。<br>あなたは生き延びた。<br><br>還付金：¥34,120" }',
      'late:   { tag: "期限後申告 END", text: "3月16日 0:00。<br>怪人は、静かに頭を下げた。<br>「期限後申告について、ご案内します」<br><br>無申告加算税があなたに課された。" }',
      'sermon: { tag: "説教 END", text: "捕まった。<br><br>あなたは税務署で3時間、丁寧に説教された。<br>担当者は、最後までずっと敬語だった。" }',
    ];
    for (const line of originals) {
      assert.ok(game.includes(line), `既存エンディングの定義が変わっている:\n${line}`);
    }
  });

  test("W-10 既存の却下ロジック（真贋審査）が残っている", () => {
    const game = GAME();
    for (const needle of [
      "etaxRejects++",
      "審査結果：<b>却下</b>",
      "if (!mob.active) enterVisit();",
      "visit.huntLeft = Math.max(visit.huntLeft, 25)",
      'ending("refund")',
      'ending("late")',
      'ending("sermon")',
    ]) {
      assert.ok(game.includes(needle), `既存の処理が失われている: ${needle}`);
    }
  });
});

describe("配線: index.html と package.json", () => {
  test("W-11 index.html に暗証番号の入力欄 #etaxPin がある", () => {
    const html = HTML();
    const m = html.match(/<input[^>]*id="etaxPin"[^>]*>/);
    assert.ok(m, '#etaxPin の input が無い');
    const tag = m[0];
    assert.match(tag, /maxlength="4"/, "maxlength=\"4\" が無い（4桁以上打ててしまう）");
    assert.match(tag, /inputmode="numeric"/, 'inputmode="numeric" が無い（タッチ操作でテンキーが出ない）');
    assert.match(tag, /autocomplete="off"/, 'autocomplete="off" が無い');
    assert.ok(html.indexOf('id="etaxPin"') > html.indexOf('id="etaxWin"'),
      "#etaxPin が e-Tax ウィンドウの中に無い");
  });

  test("NF-06 package.json に依存を追加していない（依存ゼロの静的サイトを維持）", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      assert.ok(!pkg[field] || Object.keys(pkg[field]).length === 0,
        `${field} に依存が追加されている: ${JSON.stringify(pkg[field])}`);
    }
    assert.equal(pkg.type, "module", "src/pin.js は ESM なので type: module が必要");
    assert.match(pkg.scripts.test, /node --test/, "テストは node 標準の node:test で実行する");
  });
});
