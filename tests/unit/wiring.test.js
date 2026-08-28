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
/* 2026-08-28（P2-9）: 画面の文言は src/ui.js へ移した。
   game.js にはキーだけが残るので、文言そのものはこちらで見る。 */
const UI = () => read("src/ui.js");
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

  test("W-02 正解を締切から導出して注入している（maxAttempts:3）", async () => {
    // 2026-08-19: 正解はロケールごとに違う（仕様書 L-30）ため、literal "0315" ではなく
    // deadline() からの導出になった。日本 0315 / 米 0415 / 中 0630 / 露 3004 / 西 3006。
    const game = GAME();
    const m = game.match(/createPinGate\(\{([\s\S]{0,400}?)\}\)/);
    assert.ok(m, "createPinGate(...) の呼び出しが無い");
    assert.match(m[1], /pinAnswerFor\(/, "正解を pinAnswerFor() で導出していない");
    assert.match(m[1], /maxAttempts\s*:\s*3\b/, "maxAttempts: 3 を注入していない");
    assert.match(game, /function pinAnswerFor[\s\S]{0,300}deadline\(/,
      "pinAnswerFor が deadline() を使っていない（締切と番号がずれる）");

    // 導出結果が本番値と一致することは、実際に計算して確かめる
    const { deadline } = await import(new URL("../../src/anoms.js", import.meta.url).href);
    const pad = (n) => String(n).padStart(2, "0");
    const derive = (loc) => {
      const d = deadline(loc);
      return d.order === "MD" ? pad(d.month) + pad(d.day) : pad(d.day) + pad(d.month);
    };
    assert.equal(derive("ja"), "0315", "日本語版の正解が 0315 にならない");
    for (const [loc, want] of [["en", "0415"], ["zh-Hans", "0630"], ["ru", "3004"], ["es", "3006"]]) {
      assert.equal(derive(loc), want, `${loc} の正解が ${want} にならない`);
    }
  });

  test("W-03 gate の生成は openEtax() の外（ウィンドウを開き直しても試行回数が保持される）", () => {
    const body = fnBody(GAME(), "openEtax");
    assert.ok(!body.includes("createPinGate"),
      "openEtax の中で gate を作ると、閉じて開き直すたびに試行回数がリセットされてしまう");
  });

  test("W-04 試行回数をセーブに永続化していない（save に暗証番号の状態を持たない）", () => {
    // 2026-08-19: 設定の永続化（P2-4）で locale / sens / gamma が増えた。
    // このテストの主旨は「暗証番号の状態を save に持たない」ことなので、
    // 構造の丸ごと凍結ではなく、キーの過不足を見る形に変える。
    const game = GAME();
    assert.ok(!/save\.[A-Za-z_$]*[Pp]in/.test(game), "save に暗証番号の状態を書き込んでいる");

    const m = game.match(/Object\.assign\((\{[^}]*\{\}[^}]*\}[^)]*)\s*,\s*s\)/);
    assert.ok(m, "loadSave の既定オブジェクトが見つからない");
    const defaults = m[1];
    for (const key of ["found", "endings", "runs", "bestRank", "audio", "locale", "sens", "gamma"]) {
      assert.ok(new RegExp(key + "\\s*:").test(defaults),
        `save の既定に ${key} が無い: ${defaults}`);
    }
    assert.ok(!/[Pp]in|attempt|locked/.test(defaults),
      `save の既定に暗証番号の状態が混ざっている: ${defaults}`);
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
  test("W-05 password 書類の暗証番号マスクが全ロケールでちょうど ＊4個（8個は誤誘導）", async () => {
    // 2026-08-19: 書類データは src/anoms.js へ移った。5ロケール全部を見る。
    const { LOCALES, docSpecs } = await import(new URL("../../src/anoms.js", import.meta.url).href);
    for (const locale of LOCALES) {
      const rows = docSpecs(locale).password.rows;
      const row = rows.find((r) => /＊/.test(r[1]));
      assert.ok(row, `${locale} の password 書類にマスク行が無い`);
      assert.equal([...row[1]].length, 4,
        `${locale}: マスクが ${[...row[1]].length} 個。暗証番号は4桁なので ＊＊＊＊ にする`);
    }
  });

  test("W-13 ミス時のメッセージ（違います・残り回数・ロック警告）がある", () => {
    // 文言は ui.js へ移った（P2-9）。game.js 側はキーの参照を、
    // 文言そのものは ui.js の日本語を見る。
    const game = GAME(), ui = UI();
    for (const key of ["pinWrong", "pinAttemptsLeft", "pinLastChance", "pinLocked"]) {
      assert.ok(game.includes(`"${key}"`), `game.js が ${key} を使っていない`);
    }
    assert.match(ui, /暗証番号が違います/, "ミス時のメッセージが無い");
    assert.match(ui, /残り/, "残り回数の表示が無い");
    assert.match(ui, /ロックされます/, "2回目ミスのロック警告が無い");
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
    // tag は文言そのものではなくキーになった（P2-9）。
    assert.match(entry, /tag:\s*"endCityTag"/, 'tag が "endCityTag" でない');
    assert.match(UI(), /endCityTag:\s*"市役所 END"/, 'ui.js の ja に「市役所 END」が無い');
    assert.match(entry, /text:\s*"endCityText"/, 'text が "endCityText" でない');
    const cityText = UI().match(/endCityText:\s*"([^"]*)"/);
    assert.ok(cityText, "ui.js の ja に endCityText が無い");
    assert.match(cityText[1], /ロック/, "text にカードがロックされた旨が無い");
    assert.match(cityText[1], /平日/, "text に市役所の受付（平日9時〜17時）が無い");
    assert.match(cityText[1], /<br>/, "既存3つと同じ文体（<br>で短い断定を並べる）になっていない");
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
  test("W-09 既存3エンディングの日本語が一字も変わっていない", () => {
    /* 2026-08-28（P2-9）: 文言は ui.js へ移した。日付と金額は差し込みになったので
       「3月16日」「¥34,120」はもう文字列に含まれない（含めてはいけない＝U-15）。
       このテストの主旨は「既存の結末の日本語を勝手に推敲しない」ことなので、
       検査先を ui.js の ja に移し、差し込み部分を除いた本文で見る。 */
    const ui = UI();
    const originals = [
      ['endRefundTag', '還付 END'],
      ['endRefundText', '受付完了。<br>あなたは生き延びた。<br><br>還付金：{money}'],
      ['endLateTag', '期限後申告 END'],
      // 2026-08-19: 「怪人」→「カクシン様」に変更。文言の推敲ではなく公平性の修正。
      // 変更前は「カクシン」という名前がプレイヤーに一度も提示されず、
      // 異変 issuer（発行元＝株式会社カクシン）を却下する根拠がゲーム内に存在しなかった。
      // タイトル画面とこの END で名乗ることで、却下判定が演繹可能になる。
      // 2026-08-28: 名前も差し込み（{monster}）になった。出典は anoms.js の localeText。
      ['endLateText', '{deadlineNext} 0:00。<br>{monster}は、静かに頭を下げた。<br>「期限後申告について、ご案内します」<br><br>無申告加算税があなたに課された。'],
      ['endSermonTag', '説教 END'],
      ['endSermonText', '捕まった。<br><br>あなたは税務署で3時間、丁寧に説教された。<br>担当者は、最後までずっと敬語だった。'],
    ];
    for (const [key, want] of originals) {
      assert.ok(ui.includes(`${key}: "${want}"`),
        `既存エンディングの日本語が変わっている: ${key}\n  期待: ${want}`);
    }
  });

  test("W-10 既存の却下ロジック（真贋審査）が残っている", () => {
    const game = GAME();
    for (const needle of [
      "etaxRejects++",
      // 2026-08-28（P2-9）: 文言は ui.js の etaxRejected へ。ここはキーの参照を見る。
      'tr("etaxRejected"',
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

  /* L-23（仕様書: docs/test-specs/anoms-i18n.md）
     異変 issuer / kami は「怪異の名前」を知らないと却下できない。
     v21 以前はこの名前がプレイヤーに一度も提示されておらず、両異変は
     ゲーム内の情報だけでは解けなかった（L-2 違反）。名前はタイトル画面で提示する。
     名前をテストにハードコードせず実装から導出しているので、改名しても追従する。 */
  test("L-23 異変が使う怪異の名前がタイトル画面で提示されている", async () => {
    const game = GAME();
    const html = HTML();

    // 2026-08-19: 異変の中身は src/anoms.js へ移った。日本語版の名前で確認する。
    void game;
    const { localeText } = await import(new URL("../../src/anoms.js", import.meta.url).href);
    const T = localeText("ja");
    const issuer = T.fakeIssuer;     // 例: 株式会社カクシン
    const kami = T.monster;          // 例: カクシン様

    // 2つのリテラルの最長共通部分文字列＝怪異の名前
    let token = "";
    for (let i = 0; i < kami.length; i++)
      for (let j = i + 1; j <= kami.length; j++) {
        const t = kami.slice(i, j);
        if (t.length > token.length && issuer.includes(t)) token = t;
      }
    assert.ok(token.length >= 2,
      `issuer(${issuer}) と kami(${kami}) に共通の名前が無い。別々の名前を使うと、` +
      `一方はタイトルで提示されても他方の根拠にならない`);

    // タイトル画面のオーバーレイ（プレイヤーが開始前に必ず読む範囲）に名前があること
    const from = html.indexOf('<div id="title"');
    const to = html.indexOf('<div id="meta">');
    assert.ok(from >= 0 && to > from, 'index.html のタイトル画面オーバーレイが見つからない');
    const titleScreen = html.slice(from, to);

    // オーバーレイのどこかにあるだけでは不足。操作説明（.ctrl, 0.78rem の灰色文字）は
    // 読み飛ばされうるので、必ず目に入る <h1> にあることを要求する。
    //
    // 2026-08-28（P2-9）: 多言語化で <h1> は空になり、実行時に流し込む形になった。
    // 守る性質は変わらない ──「名前が開始前に必ず目に入る」こと。
    // そこで (a) h1 の器がタイトル画面にあること、(b) それを monster で埋める配線が
    // game.js にあること、(c) どのロケールでも名前が空でないこと、の3点で見る。
    const h1 = titleScreen.match(/<h1\s+id="titleName"\s*>([\s\S]*?)<\/h1>/);
    assert.ok(h1, 'タイトル画面に <h1 id="titleName"> が無い');
    assert.match(GAME(), /\$\("titleName"\)\.textContent\s*=\s*TXT\.monster/,
      'h1 に怪異の名前を流し込む配線が無い。' +
      '異変 issuer / kami を却下する根拠がゲーム内に存在しなくなる（L-2 公平性）');

    const { LOCALES } = await import(new URL("../../src/anoms.js", import.meta.url).href);
    for (const loc of LOCALES) {
      const name = localeText(loc).monster;
      assert.ok(name && name.trim().length >= 2,
        `${loc}: 怪異の名前が空（タイトルに何も出ない）`);
    }

    // <title> にも入れる（ストア名・タブ名・口コミで使われる同じトークン）。
    // こちらは静的な日本語のままなので、従来どおりリテラルで見る。
    const head = html.match(/<title>([^<]*)<\/title>/);
    assert.ok(head && head[1].includes(token),
      `<title> に「${token}」が無い: ${head && head[1]}`);
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
