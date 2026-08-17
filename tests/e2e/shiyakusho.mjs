/* ============================================================
   市役所 END の配線確認（E2E・手動実行）
   仕様書: docs/test-specs/shiyakusho-end.md（E2E-01 〜 E2E-08）
   ------------------------------------------------------------
   Playwright はこのリポジトリに入っていない（依存ゼロを維持するため）。
   ESM は NODE_PATH を無視するので、playwright を持つグローバル node_modules に
   コピーして、そのディレクトリから実行する:

     python -m http.server 8765          # リポジトリルートで（起動したままにする）
     cp tests/e2e/shiyakusho.mjs "/c/Users/dxa00/AppData/Roaming/npm/node_modules/"
     cd "/c/Users/dxa00/AppData/Roaming/npm/node_modules"
     node shiyakusho.mjs

   全ケース PASS なら exit 0、1つでも落ちれば exit 1。
   Playwright は毎回新しいプロファイルで起動するので、本番の localStorage は汚れない。
   ============================================================ */
import { chromium } from "playwright";

const URL_BASE = process.env.E2E_URL || "http://localhost:8765";
const results = [];

function ok(id, what)          { results.push({ id, what, pass: true }); console.log(`PASS ${id} ${what}`); }
function ng(id, what, detail)  { results.push({ id, what, pass: false, detail }); console.log(`FAIL ${id} ${what}\n     → ${detail}`); }

/** 1ケースを実行する。失敗しても後続を続ける。 */
async function check(id, what, fn) {
  try {
    const detail = await fn();
    if (detail) ng(id, what, detail); else ok(id, what);
  } catch (e) {
    ng(id, what, `例外: ${e.message}`);
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e)));
page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });

/* ---------- 共通操作 ---------- */
async function startRun() {
  await page.goto(`${URL_BASE}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const meta = await page.textContent("#meta");
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });
  // 怪人に捕まって説教ENDに落ちないように、ずっと隠れている扱いにする
  await page.evaluate(() => { window.__dbg.ply.hidden = true; });
  return meta;
}
async function collectDocs() {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(n => window.__dbg.openInspect(window.__dbg.ITEMS[n]), i);
    await page.waitForSelector("#inspect:not(.hidden)", { timeout: 5000 });
    await page.click("#btnTake");
    await page.waitForTimeout(120);
  }
}
async function openEtax() {
  await page.evaluate(() => { window.__dbg.ply.hidden = true; window.__dbg.openEtax(); });
  await page.waitForSelector("#etax:not(.hidden)", { timeout: 5000 });
}
async function submitPin(value, wait = 400) {
  await page.fill("#etaxPin", value);
  await page.click("#etaxBtn");
  await page.waitForTimeout(wait);
  return (await page.textContent("#etaxMsg")) || "";
}
const pinState = () => page.evaluate(() => window.__dbg.pin.getState());

/* ============================================================
   本体。途中の操作で落ちても、集計とブラウザの後片付けは必ず行う
   （実装前は __dbg.openEtax や __dbg.pin が無いので、ここで中断するのが正しい Red）。
   ============================================================ */
try {
  await run();
} catch (e) {
  ng("FATAL", "操作が中断した（配線が未実装の可能性）", e.message.split("\n")[0]);
}

async function run() {
/* ---------- 1周目: 誤り3回でロック → 市役所 END ---------- */
const metaBefore = await startRun();
await collectDocs();
await openEtax();

await check("E2E-01", "4桁未満は送信不可・4桁で送信可", async () => {
  await page.fill("#etaxPin", "031");
  const disabled3 = await page.evaluate(() => document.getElementById("etaxBtn").disabled);
  await page.fill("#etaxPin", "0315");
  const enabled4 = await page.evaluate(() => !document.getElementById("etaxBtn").disabled);
  if (!disabled3) return "3桁でも送信ボタンが押せてしまう";
  if (!enabled4) return "4桁揃っても送信ボタンが有効にならない";
  return null;
});

await check("E2E-03", "閉じて開き直しても残り回数が保持され画面に見える", async () => {
  const msg1 = await submitPin("1111");
  const after1 = await pinState();
  if (after1.attemptsLeft !== 2) return `1回ミス後の残りが ${after1.attemptsLeft}（2 のはず）: msg="${msg1}"`;
  await page.click("#etaxClose");
  await page.waitForTimeout(200);
  await openEtax();
  const reopened = await pinState();
  if (reopened.attemptsLeft !== 2) return `開き直したら残りが ${reopened.attemptsLeft} に戻った（保持されるべき）`;
  const msg = (await page.textContent("#etaxMsg")) || "";
  if (!msg.includes("残り")) return `再オープン時に残り回数が表示されない: msg="${msg}"`;
  return null;
});

await check("E2E-05", "2回目のミスで怪人を呼び、メモの手掛かりを再提示する", async () => {
  const msg = await submitPin("2222");
  const st = await pinState();
  const mob = await page.evaluate(() => ({ active: window.__dbg.mob.active, hunt: window.__dbg.visit.huntLeft }));
  const problems = [];
  if (st.attemptsLeft !== 1) problems.push(`残りが ${st.attemptsLeft}（1 のはず）`);
  if (!msg.includes("ロックされます")) problems.push(`ロック警告が無い: "${msg}"`);
  if (!msg.includes("いつもの")) problems.push(`ヒント再提示が無い: "${msg}"`);
  if (!(mob.active || mob.hunt >= 25)) problems.push(`怪人が呼ばれていない: ${JSON.stringify(mob)}`);
  return problems.length ? problems.join(" / ") : null;
});

await check("E2E-02", "3回目のミスで市役所ENDに分岐し記録される", async () => {
  await submitPin("3333", 200);
  await page.waitForSelector("#ending:not(.hidden)", { timeout: 8000 });
  const tag = (await page.textContent("#edTag")) || "";
  const recorded = await page.evaluate(() => !!window.__dbg.save.endings.shiyakusho);
  const st = await pinState();
  const problems = [];
  if (tag.trim() !== "市役所 END") problems.push(`edTag が "${tag}"`);
  if (!recorded) problems.push("save.endings.shiyakusho が立っていない");
  if (!st.locked) problems.push("ゲートが locked になっていない");
  if (st.attemptsLeft !== 0) problems.push(`残りが ${st.attemptsLeft}（0 のはず）`);
  return problems.length ? problems.join(" / ") : null;
});

await check("E2E-08", "ロック後に追加操作してもエンディングが二重に走らず例外も出ない", async () => {
  const before = (await page.textContent("#edTag")) || "";
  const errs0 = pageErrors.length;
  await page.evaluate(() => {
    const b = document.getElementById("etaxBtn");
    if (b) { b.disabled = false; b.click(); b.click(); }
  });
  await page.waitForTimeout(600);
  const after = (await page.textContent("#edTag")) || "";
  const st = await pinState();
  const problems = [];
  if (after !== before) problems.push(`エンディング表示が変化した: "${before}" → "${after}"`);
  if (st.attemptsLeft < 0) problems.push(`残り回数が負になった: ${st.attemptsLeft}`);
  if (pageErrors.length > errs0) problems.push(`例外が出た: ${pageErrors.slice(errs0).join(" | ")}`);
  return problems.length ? problems.join(" / ") : null;
});

/* ============================================================
   2周目: 記録表示／試行回数がセーブに残らないこと／正解で既存審査に入ること
   （startRun() が index.html を読み直すので、タイトルの #meta は更新後の値になる）
   ============================================================ */
const metaAfter = await startRun();

await check("E2E-07", "タイトルの記録表示が エンディング n/4 で、市役所ENDで1つ増える", async () => {
  const m0 = /エンディング\s*(\d+)\s*\/\s*4/.exec(metaBefore || "");
  const m1 = /エンディング\s*(\d+)\s*\/\s*4/.exec(metaAfter || "");
  if (!m1) return `#meta が "エンディング n/4" 形式でない: "${metaAfter}"`;
  if (m0 && Number(m1[1]) !== Number(m0[1]) + 1)
    return `エンディング数が増えていない: ${m0[1]} → ${m1[1]}`;
  return null;
});

await collectDocs();
await openEtax();

await check("E2E-04", "リロード後は試行回数がリセットされる（セーブに残さない）", async () => {
  const st = await pinState();
  const persisted = await page.evaluate(() =>
    JSON.stringify(window.__dbg.save).toLowerCase().includes("pin"));
  const problems = [];
  if (st.attemptsLeft !== 3) problems.push(`新しいプレイの残りが ${st.attemptsLeft}（3 のはず）`);
  if (st.locked) problems.push("前のプレイのロックが引き継がれている");
  if (persisted) problems.push("save に暗証番号の状態が書かれている");
  return problems.length ? problems.join(" / ") : null;
});

await check("E2E-06", "正解 0315 で認証を通過し、既存の審査に入る", async () => {
  const msg = await submitPin("0315", 300);
  if (!/送信中|審査/.test(msg)) return `認証後に審査へ進んでいない: msg="${msg}"`;
  await page.waitForFunction(
    () => /却下|受付完了/.test(document.getElementById("etaxMsg").textContent || ""),
    { timeout: 10000 });
  const st = await pinState();
  if (!st.authenticated) return "認証済みになっていない";
  const final = (await page.textContent("#etaxMsg")) || "";
  if (!/却下|受付完了/.test(final)) return `審査結果が出ない: "${final}"`;
  return null;
});

}   /* run() ここまで */

/* ---------- 集計 ---------- */
await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n--- ${results.length - failed.length}/${results.length} PASS / pageerrors ${pageErrors.length} ---`);
if (pageErrors.length) console.log(pageErrors.join("\n"));
process.exit(failed.length ? 1 : 0);
