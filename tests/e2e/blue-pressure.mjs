/* ============================================================
   青色申告の圧力（v25: ほぼ常時参戦・やや速く）の実測（E2E・手動実行）
   ------------------------------------------------------------
   見るもの:
     P-01/P-03  21時台・23時台の在室率（怪人が部屋にいるゲーム時間の割合）
     P-02/P-04  同じ時間帯の不在の最長（息継ぎが消えていないこと）
     V-01〜03   巡回速度が白の 1.2 倍になっていること（白は従来のまま）
     V-04       21時台でも、追い続ければプレイヤー(3.6)を超えるまで加速すること
   在室率はゲーム時間で数える。swiftshader は1フレームが重く dt が 0.05 で頭打ちになるので、
   実時間で割ると遅いPCほど在室率が変わって見える（memory: playwright-perf-measure-pitfalls）。

   実行（shiyakusho.mjs と同じ。playwright はグローバルにしか無い）:
     python -m http.server 8765          # リポジトリルートで
     cp tests/e2e/blue-pressure.mjs "/c/Users/dxa00/AppData/Roaming/npm/node_modules/"
     cd "/c/Users/dxa00/AppData/Roaming/npm/node_modules"
     E2E_OUT=/c/tmp/blue-pressure.json node blue-pressure.mjs

   実測値はすべて E2E_OUT（既定 ./blue-pressure.json）に JSON で残す。合否より数値が本体で、
   次にバランスを触るときの基準線になる。
   ============================================================ */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL_BASE = process.env.E2E_URL || "http://localhost:8765";
const OUT = process.env.E2E_OUT || "blue-pressure.json";
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); };

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
// 画質は low に倒す（detectQuality はコア数4以下で low）。測るのは AI と時間割だけで絵は見ないし、
// high の swiftshader は1フレーム1秒を超えて dt 頭打ちになり、ゲーム内45分に実時間30分かかる。
await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 2 }));

await page.goto(`${URL_BASE}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
// 青は還付END達成で解禁される。ボタンは押せないので、開始前にモードだけ差し替える
// （startBtn が MODES[mode].mps を読むので、時計の速さも青になる）。
await page.evaluate(() => window.__dbg.setMode("blue"));
await page.click("#startBtn");
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 30000 });

/* ---------- 巡回速度（白と青を同じ状況で） ----------
   プレイヤーを隠して巡回させ、1フレームの移動量 / dt の上位値を取る。
   壁沿いのすべりで遅くなるフレームがあるので、最大ではなく90パーセンタイル。 */
const patrolSpeed = (m) => page.evaluate((m) => new Promise((resolve) => {
  const d = window.__dbg;
  d.setMode(m);
  d.ply.hidden = true;
  d.mob.active = false; d.enterVisit();
  d.mob.mode = "patrol";
  let last = performance.now(), px = d.mob.x, pz = d.mob.z, gameT = 0;
  const sp = [];
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (dt > 0.005 && d.mob.mode === "patrol") sp.push(Math.hypot(d.mob.x - px, d.mob.z - pz) / dt);
    px = d.mob.x; pz = d.mob.z; gameT += dt;
    if (gameT < 6) requestAnimationFrame(tick);
    else {
      sp.sort((a, b) => a - b);
      resolve(+sp[Math.floor(sp.length * 0.9)].toFixed(2));
    }
  };
  requestAnimationFrame(tick);
}), m);

/* ---------- 在室率 ----------
   プレイヤーは隠したまま（見つからない＝追跡で狩り時間が止まらない、最も在室が短くなる条件）。
   呼ぶ直前に endVisit() してあるので、窓は「前触れ→訪問→…」の頭から始まる。
   【窓を1周より長く取る】23時台の1回の滞在は約78秒＝ゲーム内43分。窓が40分だと1回の
   訪問の中に収まって在室率100%・不在0と出る（実際に踏んだ）。23:00〜23:59 をほぼ丸ごと見る。 */
const presence = (span) => page.evaluate((span) => new Promise((resolve) => {
  const d = window.__dbg;
  d.setMode("blue");
  d.ply.hidden = true;
  let started = true, t0 = d.gm(), lastGm = d.gm(), on = 0, total = 0, gapNow = 0, gapMax = 0, visits = 0, wasOn = d.mob.active;
  const timeline = [];
  const deadline = performance.now() + 30 * 60 * 1000;
  const tick = () => {
    const gm = d.gm(), dg = gm - lastGm; lastGm = gm;
    const act = d.mob.active;
    if (started && dg > 0) {
      total += dg;
      if (act) { on += dg; gapNow = 0; } else { gapNow += dg; gapMax = Math.max(gapMax, gapNow); }
      if (act && !wasOn) visits++;
    }
    if (act !== wasOn) timeline.push({ gm: +gm.toFixed(2), active: act, visit: d.visit.state });
    wasOn = act;
    // 23:59 の時間切れ（END）でも打ち切る。23時台は1回の滞在が終わる前に夜が明けるので、
    // 窓の終わりは END になるのが普通（v25 の実測: 23:13 に来て 23:59 まで居座った）。
    const live = d.st() === "PLAY";
    if (live && (!started || gm - t0 < span) && performance.now() < deadline) requestAnimationFrame(tick);
    else resolve({ ratio: +(on / total).toFixed(3), totalMin: +total.toFixed(1), visits,
                   gapMaxMin: +gapMax.toFixed(2), endedBy: live ? "span" : d.st(), timeline });
  };
  requestAnimationFrame(tick);
}), span);

/* ---------- 21時台の追跡加速 ----------
   smoke-v23 の B-05 と同じ置き方（西側の部屋に並べ、追いつかれそうになったら怪人を戻す）。
   怪人の実移動速度の推移を記録し、3.6 を超えた時刻を取る。 */
const chaseRamp = () => page.evaluate(() => new Promise((resolve) => {
  const d = window.__dbg;
  d.setMode("blue");
  d.ply.hidden = false;
  d.mob.active = false; d.enterVisit();
  d.ply.x = -4; d.ply.z = 4.5;
  d.mob.x = -4; d.mob.z = 0.6; d.mob.mode = "patrol"; d.mob.freeze = 0;
  d.mob.boost = 0; d.mob.boostT = 0; d.mob.crumb = -1;
  let last = performance.now(), px = d.mob.x, pz = d.mob.z, gameT = 0, firstFast = null, chaseT = null;
  const trace = [];
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    gameT += dt;
    const v = dt > 0.005 ? Math.hypot(d.mob.x - px, d.mob.z - pz) / dt : 0;
    if (d.mob.mode === "chase" && chaseT === null) chaseT = gameT;
    if (chaseT !== null && firstFast === null && v > 3.6 && d.mob.freeze <= 0) firstFast = gameT - chaseT;
    trace.push({ t: +gameT.toFixed(2), v: +v.toFixed(2), boost: +d.mob.boost.toFixed(2), mode: d.mob.mode });
    if (Math.hypot(d.mob.x - d.ply.x, d.mob.z - d.ply.z) < 1.4) { d.mob.x = -4; d.mob.z = 0.6; }
    px = d.mob.x; pz = d.mob.z;
    d.mob.lostAt = 0;   // 視線の判定ではなく加速の積み方だけを見る
    if (gameT < 16 && d.st() === "PLAY") requestAnimationFrame(tick);
    else resolve({ firstOver36: firstFast === null ? null : +firstFast.toFixed(2),
                   maxBoost: Math.max(...trace.map((s) => s.boost)), trace });
  };
  requestAnimationFrame(tick);
}));

const p1Blue = await patrolSpeed("blue");
const p1White = await patrolSpeed("white");
const ramp1 = await chaseRamp();
await page.evaluate(() => { const d = window.__dbg; d.mob.active = false; d.endVisit(); d.visit.nextAt = d.gm(); });
const pres1 = await presence(45);

// 23時台へ。flags の判定はループ側にあるので、時刻を動かして1フレーム待てば phase 3 になる。
await page.evaluate(() => { const d = window.__dbg; d.setMin(23 * 60 + 0.1); });
await page.waitForTimeout(500);
const p3Blue = await patrolSpeed("blue");
const p3White = await patrolSpeed("white");
await page.evaluate(() => { const d = window.__dbg; d.mob.active = false; d.endVisit(); d.visit.nextAt = d.gm(); d.setMode("blue"); });
const pres3 = await presence(60);   // 実質 END まで

check("V-01 21時台 青の巡回は白の約1.2倍", Math.abs(p1Blue / p1White - 1.2) < 0.08, `blue=${p1Blue} white=${p1White}`);
check("V-02 21時台 白の巡回は従来の1.05", Math.abs(p1White - 1.05) < 0.08, `white=${p1White}`);
check("V-03 23時台 青の巡回は白の約1.2倍", Math.abs(p3Blue / p3White - 1.2) < 0.08, `blue=${p3Blue} white=${p3White}`);
check("V-04 21時台でも追い続ければ3.6m/sを超える（16秒以内）", ramp1.firstOver36 !== null,
      `firstOver36=${ramp1.firstOver36}s maxBoost=${ramp1.maxBoost}`);
check("P-01 21時台 在室率 65%以上", pres1.ratio >= 0.65, JSON.stringify({ ...pres1, timeline: undefined }));
check("P-02 21時台 不在の最長は前触れが成立する長さ（≥5ゲーム内分）", pres1.gapMaxMin >= 5, `gapMax=${pres1.gapMaxMin}`);
check("P-03 23時台 在室率 65%以上", pres3.ratio >= 0.65, JSON.stringify({ ...pres3, timeline: undefined }));
check("P-04 23時台 でも来る前に前触れの窓がある（≥5ゲーム内分）", pres3.gapMaxMin >= 5, `gapMax=${pres3.gapMaxMin}`);
check("S-01 例外なし", errs.length === 0, errs.slice(0, 3).join(" / "));

writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  patrol: { phase1: { blue: p1Blue, white: p1White }, phase3: { blue: p3Blue, white: p3White } },
  chaseRampPhase1: ramp1, presencePhase1: pres1, presencePhase3: pres3, results, errs,
}, null, 2));

await browser.close();
let bad = 0;
for (const r of results) { if (!r.ok) bad++; console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id}  ${r.detail || ""}`); }
console.log(`\n${results.length - bad}/${results.length} passed  → ${OUT}`);
process.exit(bad ? 1 : 0);
