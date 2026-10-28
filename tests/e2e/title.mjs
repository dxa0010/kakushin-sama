/* ============================================================
   タイトル画面（ウェルカム画面）の E2E・手動実行
   ------------------------------------------------------------
   確かめること:
     T-01 表示が整理されている（メニューは 開始／遊び方／設定 の3つだけ。音量・前提・
          操作説明はタイトル本体に出ていない。題字に怪異の名前がある）
     T-02 クレジット・ライセンスは右下の隅にあり、押すとクレジットが開く／戻れる
     T-03 遊び方：前提と操作説明が入っている。Esc で閉じる
     T-04 設定：タイトルから開ける（state は TITLE のまま）。見出しは「設定」、
          「タイトルへ戻る」は出ない。音量の変更が保存される。閉じると一時停止の文言に戻る
     T-05 未解禁の青色申告：押せるが拒まれる（白のまま・囁きが出る）
     T-06 解禁済みの青色申告：印が押され、部屋が冷え、あれが近づく（--near が増える）
     T-07 暗転のたびにあれが近づく（--near が単調に増え、上限で止まる）
     T-08 冒頭の文章（強制）：前提の5行が出る。クリックで飛ばせる
     T-09 開始：暗転してから PLAY になる。PLAY になるまで 3 秒以内
     T-10 縦長（スマホ）でも、題字・メニューが画面内に収まる
     T-11 動きを減らす設定：冒頭の文章も暗転も出ない
     T-12 ページエラーが1件も無い
   成果物: OUT_DIR（既定は OS の一時ディレクトリ/kakushin-e2e-title）に
           スクリーンショットと result.json（各ケースの合否と測定値）を書く。

   実行（playwright はグローバルにしか無い。ESM は NODE_PATH を無視する）:
     python -m http.server 8765          # リポジトリルートで（起動したままにする）
     cp tests/e2e/title.mjs "/c/Users/dxa00/AppData/Roaming/npm/node_modules/"
     node "/c/Users/dxa00/AppData/Roaming/npm/node_modules/title.mjs"
   全ケース PASS なら exit 0、1つでも落ちれば exit 1。
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL_BASE = process.env.E2E_URL || "http://localhost:8765";
const OUT = process.env.OUT_DIR || join(tmpdir(), "kakushin-e2e-title");
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (id, what, data) => { results.push({ id, what, pass: true, data }); console.log(`PASS ${id} ${what}`); };
const ng = (id, what, detail, data) => { results.push({ id, what, pass: false, detail, data }); console.log(`FAIL ${id} ${what}\n     → ${detail}`); };
async function check(id, what, fn) {
  try {
    const r = await fn() || {};
    if (r.fail) ng(id, what, r.fail, r.data); else ok(id, what, r.data);
  } catch (e) { ng(id, what, `例外: ${e.message}`); }
}

const ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
              "--autoplay-policy=no-user-gesture-required"];
const browser = await chromium.launch({ headless: true, args: ARGS });
const pageErrors = [];

async function open({ viewport = { width: 1280, height: 800 }, save = null, cold = false, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await ctx.addInitScript(({ save, cold }) => {
    if (save) localStorage.setItem("kakushin_save_v1", JSON.stringify(save));
    if (cold) sessionStorage.setItem("kakushin_cold_open", "force");
  }, { save, cold });
  const page = await ctx.newPage();
  page.on("pageerror", e => pageErrors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
  await page.goto(`${URL_BASE}/index.html`, { waitUntil: "networkidle" });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name) });
const near = (page) => page.evaluate(() => parseFloat(document.getElementById("tArtImg").style.getPropertyValue("--near") || "1"));
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; }, sel);
// 立ち上がりの演出が終わるまで待つ（swiftshader では実時間より遅れるので、秒数では待たない）
const settled = (page) => page.waitForFunction(() => {
  const f = document.getElementById("tFoot"), a = document.getElementById("tArt");
  return f && getComputedStyle(f).opacity === "1" && getComputedStyle(a).opacity === "1"; }, null, { timeout: 30000 });
const UNLOCKED = { found: {}, endings: { refund: true }, bestRank: null };

/* ---------- 横長・白（初回の人が見る画面） ---------- */
{
  const { ctx, page } = await open();
  await settled(page);
  await shot(page, "01-title-1280x800.png");

  await check("T-01", "表示が整理されている", async () => {
    const d = await page.evaluate(() => {
      const t = document.getElementById("title");
      const menu = [...document.querySelectorAll("#tMenu > button")].map(b => b.id);
      const txt = t.innerText;
      return { menu, h1: document.getElementById("titleName").textContent,
               volInTitle: !!t.querySelector("input[type=range]"),
               premVisible: !document.getElementById("howto").classList.contains("hidden"),
               desc: document.getElementById("modeDesc").textContent, st: window.__dbg.st(), len: txt.length };
    });
    if (d.menu.join() !== "startBtn,howtoBtn,settingsBtn") return { fail: `メニュー: ${d.menu}`, data: d };
    if (!d.h1.includes("カクシン")) return { fail: `題字: ${d.h1}`, data: d };
    if (d.volInTitle) return { fail: "タイトル本体に音量スライダーが残っている", data: d };
    if (d.premVisible) return { fail: "遊び方が最初から開いている", data: d };
    if (!d.desc) return { fail: "モードの説明が空", data: d };
    if (d.st !== "TITLE") return { fail: `state=${d.st}`, data: d };
    return { data: d };
  });

  await check("T-02", "クレジット・ライセンスは右下の隅", async () => {
    const r = await page.evaluate(() => { const b = document.getElementById("creditsLink").getBoundingClientRect();
      return { right: innerWidth - b.right, bottom: innerHeight - b.bottom, w: b.width, text: document.getElementById("creditsLink").textContent }; });
    if (r.right > 60 || r.bottom > 60) return { fail: `隅にない: ${JSON.stringify(r)}`, data: r };
    await page.click("#creditsLink");
    if (!(await visible(page, "#credits"))) return { fail: "クレジットが開かない", data: r };
    await page.waitForTimeout(500);
    await shot(page, "02-credits.png");
    await page.click("#cBack");
    if (await visible(page, "#credits")) return { fail: "戻れない", data: r };
    return { data: r };
  });

  await check("T-03", "遊び方：前提と操作説明。Esc で閉じる", async () => {
    await page.click("#howtoBtn");
    await page.waitForTimeout(500);
    const d = await page.evaluate(() => ({ prem: document.getElementById("prem").innerText, ctrl: document.getElementById("ctrl").innerText }));
    await shot(page, "03-howto.png");
    if (!(await visible(page, "#howto"))) return { fail: "開かない", data: d };
    if (!/e-Tax/.test(d.prem) || !/WASD/.test(d.ctrl)) return { fail: "前提か操作説明が無い", data: d };
    await page.keyboard.press("Escape");
    if (await visible(page, "#howto")) return { fail: "Esc で閉じない", data: d };
    return { data: { premLines: d.prem.split("\n").length } };
  });

  await check("T-04", "設定：タイトルから開け、音量が保存される", async () => {
    await page.click("#settingsBtn");
    await page.waitForTimeout(500);
    await shot(page, "04-settings.png");
    const d = await page.evaluate(() => ({
      open: !document.getElementById("pause").classList.contains("hidden"),
      h: document.getElementById("pauseH").textContent, resume: document.getElementById("pResume").textContent,
      toTitleShown: getComputedStyle(document.getElementById("pTitle")).display !== "none",
      st: window.__dbg.st() }));
    if (!d.open) return { fail: "開かない", data: d };
    if (d.h !== "設定" || d.resume !== "戻る") return { fail: `文言: ${d.h} / ${d.resume}`, data: d };
    if (d.toTitleShown) return { fail: "タイトルへ戻る が出ている", data: d };
    if (d.st !== "TITLE") return { fail: `state=${d.st}`, data: d };
    await page.$eval("#pVol", el => { el.value = "35"; el.dispatchEvent(new Event("input")); });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kakushin_save_v1")).audio);
    await page.keyboard.press("Escape");
    const after = await page.evaluate(() => ({ open: !document.getElementById("pause").classList.contains("hidden"),
      h: document.getElementById("pauseH").textContent, st: window.__dbg.st() }));
    if (!saved || Math.abs(saved.vol - 0.35) > 1e-6) return { fail: `保存されていない: ${JSON.stringify(saved)}`, data: d };
    if (after.open || after.h !== "一時停止" || after.st !== "TITLE") return { fail: `閉じた後: ${JSON.stringify(after)}`, data: after };
    return { data: { ...d, saved, after } };
  });

  await check("T-05", "未解禁の青色申告は拒まれる", async () => {
    // aria-disabled なので Playwright は「押せない」と判断して待ち続ける。人は押せる（押して拒まれる）
    await page.click("#modeBlue", { force: true });
    await page.waitForTimeout(350);
    // 囁きは 1.8 秒で消える。撮影は遅いので、先に読む
    const d = await page.evaluate(() => ({ blueSel: document.getElementById("modeBlue").classList.contains("sel"),
      whiteSel: document.getElementById("modeWhite").classList.contains("sel"),
      desc: document.getElementById("modeDesc").textContent, label: document.getElementById("modeBlue").textContent }));
    await shot(page, "05-blue-denied.png");
    if (d.blueSel || !d.whiteSel) return { fail: "青が選べてしまった", data: d };
    if (!d.desc.includes("まだ")) return { fail: `囁きが出ない: ${d.desc}`, data: d };
    if (!d.label.includes("還付")) return { fail: `解禁条件が書かれていない: ${d.label}`, data: d };
    return { data: d };
  });

  await check("T-07", "暗転のたびにあれが近づく", async () => {
    // 暗転は 5〜7 秒後に1回目、以降 9〜16 秒間隔。1回目を待つ
    const n0 = await near(page);
    await page.waitForFunction(n => parseFloat(document.getElementById("tArtImg").style.getPropertyValue("--near") || "1") > n,
      n0, { timeout: 20000 });
    const n1 = await near(page);
    await page.waitForTimeout(400);
    await shot(page, "07-after-blackout.png");
    return { data: { n0, n1 }, fail: n1 > n0 && n1 <= 1.16 ? null : `near ${n0}→${n1}` };
  });
  await ctx.close();
}

/* ---------- 解禁済み：青を選ぶ → 開始 ---------- */
{
  const { ctx, page } = await open({ save: UNLOCKED });
  await settled(page);
  await check("T-06", "青色申告：印・冷え・あれが近づく", async () => {
    const n0 = await near(page);
    await page.click("#modeBlue");
    await page.waitForTimeout(1500);
    await shot(page, "06-blue-selected.png");
    const d = await page.evaluate(() => ({ sel: document.getElementById("modeBlue").classList.contains("sel"),
      cold: document.getElementById("title").classList.contains("blue"),
      stamp: document.querySelector("#modeBlue .seal").classList.contains("stamp"),
      desc: document.getElementById("modeDesc").textContent }));
    const n1 = await near(page);
    if (!d.sel || !d.cold || !d.stamp) return { fail: JSON.stringify(d), data: d };
    if (!(n1 > n0)) return { fail: `近づいていない ${n0}→${n1}`, data: d };
    return { data: { ...d, n0, n1 } };
  });

  await check("T-09", "開始：暗転してから PLAY（3秒以内）", async () => {
    // 暗転の不透明度を 10ms ごとに記録して、PLAY より前に真っ暗になったかを見る。
    // 所要時間もページ内の時計で測る（スクリーンショットの撮影時間を混ぜない）
    await page.evaluate(() => {
      window.__darkLog = [];
      document.getElementById("startBtn").addEventListener("click", () => { window.__t0 = performance.now(); }, { capture: true, once: true });
      const iv = setInterval(() => {
        const st = window.__dbg.st();
        window.__darkLog.push([performance.now(), +document.getElementById("tDark").style.opacity || 0, st]);
        if (st === "PLAY") { window.__t1 = performance.now(); clearInterval(iv); }
      }, 10);
    });
    await page.click("#startBtn");
    await shot(page, "09a-start-flicker.png");
    await page.waitForFunction(() => window.__dbg.st() === "PLAY", null, { timeout: 8000 });
    const ms = Math.round(await page.evaluate(() => window.__t1 - window.__t0));
    const log = await page.evaluate(() => window.__darkLog);
    const blackBeforePlay = log.some(([, o, st]) => o >= 0.99 && st === "TITLE");
    await page.waitForTimeout(1500);
    await shot(page, "09b-play.png");
    const blue = await page.evaluate(() => document.getElementById("notice").innerHTML);
    if (!blackBeforePlay) return { fail: "真っ暗にならずに始まった", data: { ms } };
    if (ms > 3000) return { fail: `${ms}ms かかった`, data: { ms } };
    if (!/青色申告|本気/.test(blue)) return { fail: `青のモードで始まっていない: ${blue}`, data: { ms } };
    return { data: { ms, frames: log.length } };
  });
  await ctx.close();
}

/* ---------- 冒頭の文章（強制） ---------- */
{
  const { ctx, page } = await open({ cold: true });
  await check("T-08", "冒頭の文章：前提の5行、クリックで飛ばせる", async () => {
    await page.waitForTimeout(2500);
    const d = await page.evaluate(() => ({ lines: [...document.querySelectorAll("#tOpenLines p")].map(p => p.textContent),
      opening: document.getElementById("title").classList.contains("opening") }));
    await shot(page, "08a-cold-open.png");
    if (d.lines.length !== 5 || !d.opening) return { fail: JSON.stringify(d), data: d };
    await page.mouse.click(900, 400);   // 何も無い所を押す
    await settled(page);
    const after = await page.evaluate(() => ({ reveal: document.getElementById("title").classList.contains("reveal"),
      gone: !document.getElementById("tOpen"), st: window.__dbg.st() }));
    await shot(page, "08b-after-skip.png");
    if (!after.reveal || !after.gone || after.st !== "TITLE") return { fail: JSON.stringify(after), data: after };
    return { data: { ...d, after } };
  });
  await ctx.close();
}

/* ---------- 縦長（スマホ） ---------- */
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 } });
  await settled(page);
  await shot(page, "10-portrait-390x844.png");
  await check("T-10", "縦長でも題字とメニューが画面内", async () => {
    const r = await page.evaluate(() => ["titleName", "startBtn", "settingsBtn", "modeBlue", "creditsLink"].map(id => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { id, l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) };
    }));
    const out = r.filter(x => x.l < 0 || x.r > 390 || x.t < 0 || x.b > 844);
    return { data: r, fail: out.length ? `はみ出し: ${JSON.stringify(out)}` : null };
  });
  await ctx.close();
}

/* ---------- 動きを減らす ---------- */
{
  const { ctx, page } = await open({ cold: true, reducedMotion: "reduce" });
  await check("T-11", "動きを減らす：冒頭の文章も暗転も無い", async () => {
    await page.waitForTimeout(8000);
    const d = await page.evaluate(() => ({ opening: !!document.getElementById("tOpen"),
      near: document.getElementById("tArtImg").style.getPropertyValue("--near") || "1" }));
    await shot(page, "11-reduced-motion.png");
    return { data: d, fail: d.opening || d.near !== "1" ? JSON.stringify(d) : null };
  });
  await ctx.close();
}

await check("T-12", "ページエラーが無い", async () => (pageErrors.length ? { fail: pageErrors.join(" | ") } : {}));

await browser.close();
writeFileSync(join(OUT, "result.json"), JSON.stringify({ when: new Date().toISOString(), url: URL_BASE, results }, null, 2));
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS  成果物: ${OUT}`);
process.exit(failed ? 1 : 0);
