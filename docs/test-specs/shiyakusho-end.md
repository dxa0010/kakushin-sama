# 市役所 END（マイナンバーカード暗証番号）テスト仕様

## 実現したいこと

e-Tax送信画面にマイナンバーカードの暗証番号入力を追加する。正解は `0315`（4桁）。
3回間違えるとカードがロックされ、4つ目のエンディング「市役所 END」へ分岐する。
暗証番号の判定ロジックは、ブラウザ無しで検証できるよう純粋モジュール `src/pin.js` に切り出す。

## 対象範囲

- **対象**
  - `src/pin.js`（新規・実装者が作成）: 暗証番号の正規化・照合・試行回数・ロック状態の管理。純粋関数群。
  - `src/game.js` / `index.html` の配線: 入力欄、メッセージ、怪人の呼び出し、`EDS.shiyakusho`、`ending("shiyakusho")`、`refreshTitleMeta()` の 4 END 対応、`DOCSPECS.password` のマスク桁数修正。
- **対象外**
  - 既存の却下ロジック（真贋審査）。認証と真贋審査は独立で、既存コードは変更しない（変更されていないことは W-10 で守る）。
  - 既存3エンディングの文面（不変であることを W-09 で守る）。
  - `src/audio.js`（実聴で確定した音のパラメータ。本機能では触らない。変更が無いことは `git diff src/audio.js` が空であることで確認する。テストでは検査しない＝ソース文字列に依存する回帰テストは壊れやすく、音の値は本機能と無関係のため）。
  - 3Dシーン・描画・入力操作系。

## テストの階層

| 層 | ファイル | 何を守るか | 実行 |
|---|---|---|---|
| ユニット（仕様の主役） | `tests/unit/pin.test.js` | 暗証番号ロジックの仕様そのもの | `npm test` |
| ユニット（性能） | `tests/unit/pin.perf.test.js` | 計算量・実行時間 | 同上（環境依存のため分離） |
| 静的配線検査 | `tests/unit/wiring.test.js` | `game.js` / `index.html` / `package.json` が仕様どおり配線されているか（DOM不要） | 同上 |
| E2E（補助） | `tests/e2e/shiyakusho.mjs` | 実ブラウザでの分岐・状態保持・エンディング数表示 | 手動（後述） |

E2E を主役にしないのは、Playwright がこのリポジトリに入っておらず（依存ゼロを維持するため入れない）、
グローバルの `node_modules` へスクリプトをコピーして実行する運用になっているため。CI で回せない層に仕様を置かない。

## `src/pin.js` の API 契約（テストが期待する形）

実装者はこの形で実装する。**正解値 `0315` と最大試行回数 `3` は `src/pin.js` に書かない**（`src/game.js` から注入する）。

```js
// 4桁（既定）の数字へ正規化する。全角数字→半角、前後の空白除去。
// 正規化できなければ null を返す。UI は「4桁揃うまで送信不可」の判定にこれを使う。
export function normalizePin(raw, digits = 4): string | null

// 暗証番号ゲートを作る。answer / maxAttempts は必須（既定値を持たない）。
export function createPinGate({ answer, maxAttempts }): PinGate

// PinGate の公開キーは submit / getState のちょうど2つ（正解を取り出す API を持たない）
PinGate = {
  submit(raw): PinResult,
  getState(): PinState,
}

// PinState のキーはちょうど5つ
PinState = { attemptsLeft, attemptsUsed, maxAttempts, locked, authenticated }

// PinResult のキーはちょうど7つ
PinResult = {
  status: "ok" | "wrong" | "invalid" | "locked",
  attemptsLeft: number,      // この submit 後の残り回数（0未満にならない）
  locked: boolean,
  finalWarning: boolean,     // 「あと1回でロック」= このミスで attemptsLeft が 1 になった
  justLocked: boolean,       // このsubmitでロックに遷移した（ending を1回だけ呼ぶための合図）
  already: boolean,          // 認証済みへの再submit
  reason: null | "type" | "empty" | "format",   // status==="invalid" のときのみ非null
}
```

判定の順序（これが仕様）:

1. ロック済みなら即 `status:"locked"`（`justLocked:false`, `reason:null`）。入力内容は見ない。
2. 認証済みなら即 `status:"ok"`（`already:true`）。入力内容は見ない。試行回数を消費しない。
3. `typeof raw !== "string"` → `invalid`/`type`（**暗黙の文字列化をしない**。`315` を `"0315"` として扱わない）。
4. 正規化（前後空白除去・全角数字→半角）後が空 → `invalid`/`empty`。
5. 正規化後が「`answer` と同じ桁数の数字」でない → `invalid`/`format`。
6. `answer` と一致 → `ok`（`already:false`, 認証済みへ）。不一致 → 試行回数を1消費。
   残り 0 になったら `status:"locked"`, `justLocked:true`。残り 1 になったら `status:"wrong"`, `finalWarning:true`。

`3` 〜 `5`（不正入力）は**試行回数を消費しない**。

## 前提・仮定

| # | 仮定した内容 | 根拠 | 覆された場合の影響 |
|---|---|---|---|
| A-1 | 正解は `0315`。手掛かりは「主人公名 `三月 十五` ＝ 申告期限 3/15」とメモの『いつもの』 | **要求由来**。`PLAYER_NAME`（src/game.js:53）は `buildSpec()` で全書類に印字され（src/game.js:167）、`ITEMS` は5個で机の起動条件が `got < 5`（src/game.js:1971）なのでパスワード控えの検分は必須。手掛かりは必ず目に入る | 正解値は注入なので `game.js` の1箇所の変更で済む |
| A-2 | 桁数は4。`DOCSPECS.password` の表示を `＊＊＊＊＊＊＊＊`(8) → `＊＊＊＊`(4) に直す | **要求由来**（実物の利用者証明用電子証明書は4桁。8個は誤誘導） | 8桁のままだと不公平になるので必須 |
| A-3 | 不正入力（桁数違い・数字以外・型違い）は試行回数を消費しない | **要求由来**（設計時の仮定として要求書に明記）。長さの打ち間違いで1回失うのは理不尽で、3回の緊張感が「入力ミスへの罰」に化ける | 消費する設計にすると理不尽になる。UI 側も4桁揃うまで送信不可にする |
| A-4 | 数値型 `315` は `invalid`/`type` として拒否（文字列化しない） | **要求由来**（先頭ゼロが落ちた形を通してはいけない）＋設計時の仮定（型で弾くのが最も安全） | UI から来る値は常に文字列なので実害なし |
| A-5 | 全角数字（U+FF10〜U+FF19）のみ半角化する。アラビア数字以外の Unicode 数字（`٠٣١٥`、`〇三一五`）は拒否 | **設計時の仮定**。日本語IMEで現実に起こるのは全角数字だけ | 拒否が厳しすぎても不正入力扱いで試行を消費しないので害は小さい |
| A-6 | 前後の空白は `String.prototype.trim()` 相当（半角空白・タブ・改行・全角空白 U+3000 を含む）を除去する | **設計時の仮定**（コピペ由来の空白を救う） | — |
| A-7 | `answer` / `maxAttempts` は必須引数。既定値を持たず、不正なら**生成時に例外**（メッセージに引数名を含む） | **設計時の仮定**。既定値 `0315`/`3` を `pin.js` に持たせないという要求から導いた。黙って動くより落ちた方が安全 | 実装が既定値を持つとテスト NF-07 が落ちる |
| A-8 | `answer` は正規化して「1桁以上の数字列」であればよく、期待桁数は `answer` の長さから導出する | **設計時の仮定**（テストで `0315` 以外の値・桁数を使えるようにするため） | — |
| A-9 | 認証成功後の再 `submit` は入力内容に関わらず `ok`（`already:true`）。成功後にロックされることはない | **設計時の仮定**。一度通った認証を後から失わせるのは不合理で、UI は成功後に入力欄を閉じる | — |
| A-10 | 暗証番号の照合は**即時**（`setTimeout` の演出を挟まない）。「送信中──審査しています…」は認証成功後の既存審査だけに出す | **設計時の仮定**。ミス3回の判定に遅延を挟むと E2E も体感も悪い | E2E の待ち時間の想定が変わるだけ |
| A-11 | ロック時、`ending("shiyakusho")` は演出のため最大 2.5 秒程度遅延してよい | **設計時の仮定**（既存 `refund` が 2200ms 遅延しているのに倣う） | E2E は最大5秒待つ |
| A-12 | 入力欄の id は `#etaxPin`、送信は既存の `#etaxBtn` を流用。`maxlength="4"` / `inputmode="numeric"` / `autocomplete="off"` を付ける | **設計時の仮定**（テストと E2E が参照するので固定する。`inputmode` はタッチ操作対応済みのゲームなのでテンキーを出す。`autocomplete` はゲームの暗証番号にブラウザの自動補完が効くのは邪魔） | 実装者が別の id を使うと W-11 が落ちる |
| A-13 | ウィンドウを開き直したとき、試行を消費済みなら「残り n 回」をメッセージ欄に表示する | **設計時の仮定**。残り回数が見えないと3回制限が不公平になる（公平性は本機能の設計思想） | — |
| A-14 | 試行回数はセーブに永続化しない（1プレイ限り）。`save` の構造は変更しない | **要求由来** | — |
| A-15 | 性能の閾値（submit 200,000回 < 1000ms、呼び出し10倍で所要時間25倍未満）は仮定 | **設計時の仮定**。実質「無限ループ・履歴の無限蓄積・O(n) 化が無い」ことの担保 | 遅いマシンで揺れるため `pin.perf.test.js` に分離 |

## 機能要件テスト（`tests/unit/pin.test.js`）

ユニットテストの既定の正解は **`4771`**（本番値 `0315` をあえて使わず、値がハードコードされていないことを示す）。

| ID | 保証する内容 | 前提 | 入力 | 期待結果 | 根拠 |
|---|---|---|---|---|---|
| FN-01 | 初期状態 | `answer:"4771"`, `maxAttempts:3` | `getState()` | `{attemptsLeft:3, attemptsUsed:0, maxAttempts:3, locked:false, authenticated:false}` | A-7 |
| FN-02 | 1回目で正解 → 認証成功 | 新規 | `submit("4771")` | `status:"ok"`, `already:false`, `attemptsLeft:3`, `authenticated:true` | 要求（正常系） |
| FN-03 | 2回ミス後の正解も成功する（カウンタが正解を妨げない） | 2回ミス済 | `submit("4771")` | `status:"ok"`, `locked:false`, `attemptsLeft:1` のまま | 要求（正常系） |
| FN-04 | 1回目ミス | 新規 | `submit("0000")` | `status:"wrong"`, `attemptsLeft:2`, `finalWarning:false` | 要求（残り2回） |
| FN-05 | 2回目ミスは最終警告 | 1回ミス済 | `submit("0000")` | `status:"wrong"`, `attemptsLeft:1`, `finalWarning:true` | 要求（あと1回でロック＋ヒント再提示＋怪人） |
| FN-06 | 3回目ミスでロック | 2回ミス済 | `submit("0000")` | `status:"locked"`, `locked:true`, `justLocked:true`, `attemptsLeft:0` | 要求（市役所ENDへ） |
| FN-07 | 認証後の再submitは入力に関わらず `ok`／消費しない | 認証済 | `submit("0000")` ×3 | 毎回 `status:"ok"`, `already:true`, `locked:false`, `attemptsLeft` 不変 | A-9 |
| FN-08 | 戻り値と状態のキー集合が契約どおり | 各状態 | `Object.keys()` | result は7キー、state は5キー（過不足なし） | 設計（APIの安定） |
| FN-09 | 公開APIは `submit` / `getState` のちょうど2つ | 新規 | `Object.keys(gate)` | `["getState","submit"]` | 要求（正解が漏れないAPI） |
| FN-10 | `normalizePin` が正しい4桁を返す | — | `normalizePin("0315")` | `"0315"` | 要求 |
| FN-11 | 正解値は注入されている（`0315` がハードコードされていない） | `answer:"4771"` | `submit("0315")` | `status:"wrong"`（`ok` ではない） | 要求（注入可能） |
| FN-12 | 期待桁数は `answer` から導出される | `answer:"12"` | `submit("12")` / `submit("0012")` | `ok` / `invalid`(`format`) | A-8 |
| FN-13 | 本番値の確認 | `answer:"0315"`, `maxAttempts:3` | `submit("0315")` / 別インスタンスで `submit("０３１５")` | どちらも `ok` | A-1, 要求（全角） |

## 境界値テスト

| ID | 保証する内容 | 前提 | 入力 | 期待結果 | 根拠 |
|---|---|---|---|---|---|
| BD-01 | 残り回数が 3→2→1→0 と1ずつ減る | 新規 | 誤り×3 | `attemptsLeft` が `2,1,0`、`status` が `wrong,wrong,locked` | 要求（各段階） |
| BD-02 | 2回ミスではロックしない | 新規 | 誤り×2 | `locked:false`, `getState().locked === false` | 要求（ちょうど3回でロック） |
| BD-03 | `maxAttempts:1` なら1回のミスで即ロック | `maxAttempts:1` | 誤り×1 | `status:"locked"`, `justLocked:true`, `finalWarning:false` | 設計（最大試行回数の注入） |
| BD-04 | `maxAttempts:5` なら5回目でロック | `maxAttempts:5` | 誤り×5 | 1〜4回目 `wrong`（4回目のみ `finalWarning:true`）、5回目 `locked` | 設計（最大試行回数の注入） |
| BD-05 | `attemptsUsed` は消費した時だけ増える | 新規 | 不正入力×3 → 誤り×1 | `attemptsUsed` は 0,0,0 → 1 | A-3 |

## 異常系テスト（すべて「試行回数を消費しない」ことを含む）

| ID | 入力 | 期待結果 | 根拠 |
|---|---|---|---|
| ER-01 | `""` | `invalid`/`empty`, `attemptsLeft` 不変 | A-3 |
| ER-02 | `"   "`（空白のみ・全角空白含む） | `invalid`/`empty`, 消費なし | A-3, A-6 |
| ER-03 | `"477"`（3桁） | `invalid`/`format`, 消費なし | A-3 |
| ER-04 | `"47710"`（5桁） | `invalid`/`format`, 消費なし | A-3 |
| ER-05 | `"03a5"`（数字以外を含む） | `invalid`/`format`, 消費なし | 要求 |
| ER-06 | `"031 5"`（内部の空白） | `invalid`/`format`, 消費なし | 要求 |
| ER-07 | `null` | `invalid`/`type`, 消費なし | 要求 |
| ER-08 | `undefined` / 引数なし | `invalid`/`type`, 消費なし | 要求 |
| ER-09 | 数値 `315` および `"0315"` ゲートへの数値 `315` | `invalid`/`type`（`ok` にならない） | A-4 |
| ER-10 | `new String("4771")`（String オブジェクト） | `invalid`/`type` | A-4（プリミティブ文字列のみ受理） |
| ER-11 | 例外を投げる `toString` を持つオブジェクト、`Symbol()`、`[4,7,7,1]`、`NaN`、`true`、`{}`、関数、`BigInt(4771)` | **例外を投げず**すべて `invalid`/`type`、消費なし | 非機能（堅牢性）。UI から想定外の値が来ても壊れない |
| ER-12 | 不正入力を20回繰り返す | `attemptsLeft` は 3 のまま、`locked:false` | A-3（不正入力でロックに到達しない） |
| ER-13 | 不正入力の後に正解 | `status:"ok"` | A-3 |
| ER-14 | `normalizePin` の不正入力一覧（`""`, `"477"`, `"47710"`, `"03a5"`, `"031 5"`, `null`, `315`, `"٠٣١٥"`, `"〇三一五"`） | すべて `null` | A-5, A-3 |

## 正規化テスト

| ID | 保証する内容 | 入力 | 期待結果 | 根拠 |
|---|---|---|---|---|
| NM-01 | 全角数字が通る | `"４７７１"` | `ok` | 要求（日本語IME） |
| NM-02 | 全角と半角の混在が通る | `"４７7１"` | `ok` | 要求 |
| NM-03 | 前後の空白（半角・タブ・改行・全角空白）を除去して通る | `" 4771 "`, `"\t4771\n"`, `"　4771　"` | すべて `ok` | 要求, A-6 |
| NM-04 | 全角混在でも誤りは誤り（正規化が判定を甘くしない） | `"００００"` | `wrong`（`invalid` ではない） | 設計 |
| NM-05 | `normalizePin` が全角・空白を正規化する | `"０３１５"`, `" 0315 "` | `"0315"` | 要求 |
| NM-06 | `normalizePin` の桁数指定 | `normalizePin("12345", 5)` | `"12345"` | A-8 |
| NM-07 | 正解側も正規化される | `answer:"４７７１"` に `submit("4771")` | `ok` | A-5 |

## ロック後の冪等性テスト

| ID | 保証する内容 | 前提 | 入力 | 期待結果 | 根拠 |
|---|---|---|---|---|---|
| LK-01 | ロック後の誤りはロックのまま | ロック済 | `submit("0000")` | `status:"locked"`, `justLocked:false`, `attemptsLeft:0` | 要求 |
| LK-02 | ロック後に正解を入れても通らない | ロック済 | `submit("4771")` | `status:"locked"`, `authenticated:false` | 要求（ロックは不可逆） |
| LK-03 | 残り回数が負にならない | ロック済 | `submit` ×10 | 毎回 `attemptsLeft === 0` | 要求 |
| LK-04 | `justLocked` はちょうど一度だけ true | 新規 | 誤り×10 | `justLocked` が true になるのは3回目のみ（＝`ending` の二重呼び出しを防げる） | 要求 |
| LK-05 | ロック後の不正入力もロック扱い | ロック済 | `submit("")`, `submit(null)` | `status:"locked"`, `reason:null` | 設計（判定順序1） |

## 情報漏洩テスト

| ID | 保証する内容 | 条件 | 期待結果 | 根拠 |
|---|---|---|---|---|
| SEC-01 | 戻り値から正解が読めない | `ok`/`wrong`/`invalid`/`locked` の全結果 | `JSON.stringify(result)` に正解文字列が含まれない | 要求 |
| SEC-02 | 状態から正解が読めない | 各状態の `getState()` | `JSON.stringify(state)` に正解文字列が含まれない | 要求 |
| SEC-03 | インスタンスから正解が読めない | `JSON.stringify(gate)`, `String(gate)`, 全 own property の値、`gate.submit.toString()` | いずれにも正解文字列が含まれない | 要求 |
| SEC-04 | 正解を返す名前のキーが無い | `getState()` のキー | `answer` / `pin` / `code` / `secret` を含むキーが無い | 要求 |
| SEC-05 | `pin.js` が `eval` / `new Function` を使わない | ソース静的検査 | 一致なし | セキュリティ（動的評価の禁止） |

## 非機能要件テスト

| ID | 分類 | 保証する内容 | 条件 | 期待結果 | 根拠 |
|---|---|---|---|---|---|
| NF-01 | 性能 | `submit` が実用上一定時間 | 200,000回 submit（誤り＋ロック後を含む） | 1,000ms 未満 | A-15 |
| NF-02 | 計算量 | 1回あたりの計算量が呼び出し回数に依存しない（履歴を溜め込まない） | 20,000回 と 200,000回 の所要時間比（ウォームアップ後） | 25倍未満（O(1)なら約10倍。二次なら約100倍になる） | A-15 |
| NF-03 | 状態の独立性 | モジュールレベルの可変状態を持たない | 2つの gate を作り、一方だけ2回ミス | 他方は `attemptsLeft:3`, `locked:false` | 要求 |
| NF-04 | 防御的コピー | 生成後に options を書き換えても挙動が変わらない | `opts.answer` / `opts.maxAttempts` を生成後に変更 | 生成時の値で動作し続ける | 設計（外から正解を差し替えられない） |
| NF-05 | 副作用なし | `pin.js` が DOM / Audio / three / localStorage / `Math.random` / `Date` / `import` を参照しない | ソース静的検査 | 一致なし（＝Node でも同じ結果、再現性がある） | 要求（純粋・副作用なし） |
| NF-06 | 依存ゼロ | `package.json` に依存を足していない | `dependencies` / `devDependencies` | 無い（または空） | 要求（依存ゼロの静的サイト） |
| NF-07 | エラー処理 | 生成時の引数不正は黙って動かず例外を投げ、メッセージに引数名を含む | `answer` 欠落 / `"abc"` / `"031"`(桁0扱いでない) / 数値、`maxAttempts` が `0`,`-1`,`1.5`,`"3"`,`NaN`,欠落 | `Error` を投げ、メッセージに該当引数名（`answer` / `maxAttempts`）を含む | A-7（観測可能性：原因が読める） |
| NF-08 | エラー処理 | `submit` は決して例外を投げず、不正時は `reason` で理由を返す（UIが理由を表示できる） | ER-11 の全入力 | 例外なし、`reason` が `"type"`/`"empty"`/`"format"` のいずれか | 観測可能性（握りつぶさない＝戻り値で理由を返す） |

## 配線テスト（`tests/unit/wiring.test.js`／ソース静的検査・ブラウザ不要）

DOM に依存せず「実装漏れが起きやすい箇所」を守る層。E2E が CI で回せないため、ここで代替する。

| ID | 保証する内容 | 検査対象 | 根拠 |
|---|---|---|---|
| W-01 | `game.js` が `./pin.js` から `createPinGate` と `normalizePin` を import している | `src/game.js` | 設計 |
| W-02 | `createPinGate` に `"0315"` と `maxAttempts: 3` を注入している | `src/game.js` | A-1, 要求 |
| W-03 | gate の生成が `openEtax()` の中でない（ウィンドウ再開で試行回数が保持される） | `src/game.js` の `openEtax` 本体 | 要求 |
| W-04 | 試行回数をセーブに永続化していない（`save.pin*` が無い） | `src/game.js` | A-14 |
| W-05 | `DOCSPECS.password` の暗証番号マスクがちょうど `＊`4個 | `src/game.js` | A-2 |
| W-06 | `EDS.shiyakusho` があり、`tag` が `"市役所 END"`、`text` に「ロック」「平日」を含み `<br>` で改行している | `src/game.js` | 要求（README.md:121 の設計・既存3つと同じ文体） |
| W-07 | `ending("shiyakusho")` の呼び出しがある | `src/game.js` | 要求 |
| W-08 | `refreshTitleMeta()` が4つ目を数える（`shiyakusho` を含む／`/3` のハードコードが無い） | `src/game.js` の `refreshTitleMeta` 本体 | 要求（実装漏れが起きやすい箇所） |
| W-09 | 既存3エンディングの `tag` / `text` が一字も変わっていない | `src/game.js` | 要求（既存の文面を変えない） |
| W-10 | 既存の却下ロジックが残っている（`etaxRejects++`、却下メッセージ、`enterVisit()`/`huntLeft`、`ending("refund")`） | `src/game.js` | 要求（回帰） |
| W-11 | `index.html` に `#etaxPin`（`maxlength="4"`, `inputmode="numeric"`, `autocomplete="off"`）がある | `index.html` | A-12 |
| W-12 | `game.js` が `etaxPin` を `normalizePin` で検証し、入力イベント（`addEventListener("input", …)` または HTML の `oninput`）で送信ボタンの有効/無効を切り替えている | `src/game.js`, `index.html` | 要求（4桁揃うまで送信不可） |
| W-13 | ミス時のメッセージ文言（「暗証番号が違います」「ロックされます」「残り」）がある | `src/game.js` | 要求 |
| W-14 | 2回目ミスでヒントを再提示している（`いつもの` の出現が3回以上＝既存2箇所＋再提示） | `src/game.js` | 要求 |
| W-15 | `__dbg` に `pin`（`getState`）と `openEtax` を公開している | `src/game.js` | 観測可能性（E2Eから残り回数を観測するため） |
| W-16 | ミスごとに `aggro++` している（`aggro++` の出現が3回以上＝既存2箇所＋暗証番号ミス） | `src/game.js` | 要求 |

## E2Eテスト（`tests/e2e/shiyakusho.mjs`／手動実行）

| ID | 保証する内容 | 手順の要点 | 根拠 |
|---|---|---|---|
| E2E-01 | 入力欄があり、4桁未満では送信不可・4桁で送信可 | e-Tax を開き `#etaxPin` に `"031"` → `#etaxBtn` disabled、`"0315"` → enabled | 要求, A-12 |
| E2E-02 | 誤り3回で市役所ENDへ分岐し記録される | 誤り×3 → `#edTag === "市役所 END"`、`__dbg.save.endings.shiyakusho === true` | 要求 |
| E2E-03 | ウィンドウを閉じて開き直しても残り回数が保持され、画面に見える | 誤り×1 → `#etaxClose` → 再オープン → `attemptsLeft===2` かつ `#etaxMsg` に「残り」 | 要求, A-13 |
| E2E-04 | リロードで試行回数はリセットされる（セーブに残さない） | 誤り×1 → `reload` → `attemptsLeft===3` | A-14 |
| E2E-05 | 2回目のミスで怪人を呼び、ヒントを再提示する | 誤り×2 → `mob.active===true` または `visit.huntLeft>=25`、`#etaxMsg` に「いつもの」 | 要求（既存却下と同じ escalation） |
| E2E-06 | 正解で認証を通過し、既存の審査に入る | `"0315"` 送信 → `#etaxMsg` が「送信中──審査しています…」を経て 却下 or 受付完了 | 要求（認証と真贋審査は独立） |
| E2E-07 | タイトルの記録表示が4つ目を数える | `#meta` が `エンディング n/4` 形式。市役所END到達後にリロードすると n が1増える | 要求 |
| E2E-08 | ロック後に追加操作してもエンディングが二重に走らない・例外が出ない | END後に `#etaxBtn` をクリック → `#edTag` 不変、`console` エラー 0件 | 要求（冪等性） |

### E2E の実行手順

Playwright はこのリポジトリに入っていない（依存ゼロを維持）。ESM は `NODE_PATH` を無視するため、
Playwright を持つグローバル `node_modules` にスクリプトをコピーして、そのディレクトリから実行する。

```bash
# 1. リポジトリルートで静的配信（起動したままにする）
python -m http.server 8765
# 2. http://localhost:8765/ が引けることを確認
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8765/
# 3. スクリプトをコピーして実行
cp tests/e2e/shiyakusho.mjs "/c/Users/dxa00/AppData/Roaming/npm/node_modules/"
cd "/c/Users/dxa00/AppData/Roaming/npm/node_modules"
node shiyakusho.mjs        # 全ケース PASS で exit 0、1つでも落ちれば exit 1
```

- Chromium は WebGL のため `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` で起動する。
- 怪人に捕まって `sermon` END に落ちるのを防ぐため、スクリプトは `__dbg.ply.hidden = true` を維持する。
- スクリプトは `__dbg.openInspect` + `#btnTake` で書類を5点集めて `got` を 5 にし、`__dbg.openEtax()` で e-Tax を開く。
- 市役所END到達で `localStorage` にエンディング記録が書かれる。Playwright は毎回新しいプロファイルで起動するので本番のセーブは汚れない。
- 途中の操作（`__dbg.openEtax()` など）で落ちた場合は `FAIL FATAL` として集計に載せ、ブラウザを閉じて exit 1 する。
  実装前は「配線が無いので中断した」ことが Red として出るのが正しい。

### E2E の Red 確認（実装前・2026-08-17）

```
$ node shiyakusho.mjs
FAIL FATAL 操作が中断した（配線が未実装の可能性）
     → page.evaluate: TypeError: window.__dbg.openEtax is not a function

--- 0/1 PASS / pageerrors 0 ---
```

ハーネス自体（起動 → `#startBtn` → `__dbg.openInspect` + `#btnTake` で書類5点回収）は正常に動作し、
**未実装の配線（`__dbg.openEtax`）に到達した時点で止まっている**＝正しい理由での Red。
`pageerrors 0` なので、テスト側のスクリプトがゲームに例外を起こしているわけではない。

## 意図的にテストしなかった項目

| 項目 | 理由 |
|---|---|
| 並行性・競合状態・デッドロック | `pin.js` は同期API、JS は単一スレッド。並行実行の経路が存在しない（`await` を挟む箇所が無い） |
| リソースリーク（ファイル/接続/ハンドル） | `pin.js` は I/O を持たない。閉じるべき資源が無い |
| 暗証番号の定数時間比較（タイミング攻撃） | クライアント側で完結するゲーム。ソースを見れば正解が読めるので、攻撃モデルとして成立しない |
| 暗証番号のマスク表示（`type="password"`） | 要求に無く、ホラーゲームの手入力ではタイポが見えた方が親切。実装者の裁量に委ねる |
| 描画（`drawDoc` の見た目・キャンバス内容） | 4桁マスクの値は `DOCSPECS` の静的検査（W-05）で担保でき、ピクセル比較は壊れやすい |
| `src/audio.js` の音のパラメータ | 本機能では触らない。実聴で確定した値なので、ソース文字列に依存する回帰テストは弊害の方が大きい（`git diff src/audio.js` が空であることで確認する） |
| メモリ使用量の絶対値 | Node の `heapUsed` は GC タイミングで大きく揺れ、閾値テストが不安定。代わりに NF-02（所要時間の線形性）で「履歴を溜め込まない」ことを担保する |
| e-Tax送信の 40 秒タイムアウト（既存 `etaxTimer` → `sermon`） | 既存挙動で本機能の変更対象外。暗証番号入力に時間をかけると `sermon` に落ちるのは既存仕様のまま |

## テストの実行方法

```bash
npm test                 # = node --test tests/unit/*.test.js（全73ケース）
npm run test:logic       # 性能テストを除く（遅いマシン・CI用）
```

**注意**: このマシンの Node v22.20.0 では `node --test tests/unit/`（ディレクトリ指定）が
ディレクトリを実行ファイルとして解決しようとして `MODULE_NOT_FOUND` になる。
グロブ指定（`tests/unit/*.test.js`）で動く。`package.json` の `scripts.test` はグロブにしてある。

## Red の確認記録

`src/pin.js` が存在しない状態（＝実装前）での実行結果。日付: 2026-08-17、Node v22.20.0。

```
$ npm test
1..13
# tests 73
# suites 13
# pass 5
# fail 68
```

**失敗理由が正しいことの確認**

- ユニット（FN/BD/ER/NM/LK/SEC/NF、`pin.test.js` + `pin.perf.test.js`）の全ケースは、
  **`src/pin.js` が無いこと**を理由に個別に失敗している（テストコードの構文エラーではない）。
  各ケースが `loadPin()` で動的 import するので、モジュール不在でもケース単位で失敗が出る:

  ```
  not ok 1 - FN-01 生成直後は残り回数が maxAttempts で、ロックも認証もされていない
        error: "src/pin.js を import できない（未実装 or 構文エラー）:
                Cannot find module '...\src\pin.js' imported from ...\tests\unit\pin.test.js"
  ```

- 配線テストは「まだ実装されていない配線」を理由に失敗している。例:

  ```
  not ok 1 - W-05 DOCSPECS.password の暗証番号マスクがちょうど ＊4個（8個は誤誘導）
        error: マスクが 8 個になっている。実物の暗証番号は4桁なので ＊＊＊＊ にする
  ```

**現時点で PASS している5ケース**（既存の状態を守る回帰テストなので、Green の後も PASS のままであるべき）

| ID | 内容 |
|---|---|
| W-03 | gate の生成が `openEtax()` の中でない（現状は `createPinGate` 自体が無いので自明に PASS。実装後も PASS を維持すること） |
| W-04 | 試行回数をセーブに永続化していない／`save` の既定構造が不変 |
| W-09 | 既存3エンディングの `tag` / `text` が不変 |
| W-10 | 既存の却下ロジックが残っている |
| NF-06 | `package.json` に依存が無い |

**内訳（合計 73ケース ＝ PASS 5 ＋ FAIL 68）**

| ファイル | ケース数 | PASS | FAIL | 失敗理由 |
|---|---|---|---|---|
| `pin.test.js`（FN 13 / BD 5 / ER 14 / NM 7 / LK 5 / SEC 5 / NF 5） | 54 | 0 | 54 | `src/pin.js` 不在 |
| `pin.perf.test.js`（NF-01, NF-02） | 2 | 0 | 2 | `src/pin.js` 不在 |
| `wiring.test.js`（W-01〜W-16, NF-06） | 17 | 5 | 12 | 配線が未実装（`import` が無い、`EDS.shiyakusho` が無い、`＊` が8個、`refreshTitleMeta` が `/3` のまま、`#etaxPin` が無い 等） |

## 実装エージェントへの申し送り

1. **`src/pin.js` に `0315` と `3` を書かないこと。** FN-11 と SEC-05・NF-05 の静的検査で落ちる。値は `src/game.js` から注入する。
2. **`refreshTitleMeta()`（src/game.js:2410-2419）の `["refund","late","sermon"]` と `エンディング ${eN}/3` を必ず直す。** 実装漏れが起きやすい箇所なので W-08 で守っている。
3. **`DOCSPECS.password` の `＊＊＊＊＊＊＊＊` を `＊＊＊＊` にする**（W-05）。桁数の誤誘導は不公平になる。
4. **gate はモジュールのトップレベルで1つだけ作る**（`openEtax()` の中で作らない＝W-03）。ウィンドウを閉じて開き直しても試行回数が保持されるため。ただし `save` には書かない（W-04）。
5. **既存の却下ロジック・既存3ENDの文面には触らない**（W-09 / W-10 が回帰を検出する）。認証と真贋審査は独立で、認証成功後は既存の送信処理へそのまま流す。
6. **`window.__dbg` に `pin`（ゲート本体）と `openEtax` を追加する**（W-15）。E2E が残り回数を観測するために必要。
7. UI の id は `#etaxPin` 固定（W-11 / E2E が参照）。`maxlength="4"` / `inputmode="numeric"` / `autocomplete="off"` を付ける。4桁揃うまで `#etaxBtn` を `disabled` にする（`normalizePin` で判定）。
8. 2回目のミスでは、メッセージにロック警告とメモの手掛かり（『いつもの』）を出し、既存の却下と同じ escalation（`if (!mob.active) enterVisit(); else visit.huntLeft = Math.max(visit.huntLeft, 25);`）を行う（W-13 / W-14 / E2E-05）。
9. ミスごとに `aggro++`（W-16）。
10. **テストは変更しないこと。** 仕様の前提が誤っていると判断したら、直さずに呼び出し元へ報告する。
