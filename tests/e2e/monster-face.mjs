/* ============================================================
   怪人の向き（v27）のE2E: 移動中は進行方向を向き、freeze 中だけ
   プレイヤーへ向き直ること。
   手動実行: python -m http.server 8765 → node monster-face.mjs
   アーティファクト: screenshots/monster-face*.png
   （headless swiftshader は数 fps のため、dt は 0.05 にクランプされる。
    回転収束 rate=dt*5=0.25/frame → 収束には3秒以上かかる前提で待つ）
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL_BASE = process.env.E2E_URL || "http://localhost:8765";
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
         "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

const results = [];
function ok(id, what) { results.push([id, true]); console.log(`PASS ${id} ${what}`); }
function ng(id, what, detail) { results.push([id, false]); console.log(`FAIL ${id} ${what}\n     → ${detail}`); }

const wrap = d => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

await page.goto(`${URL_BASE}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.click("#startBtn");
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });

/* プレイヤーを北西の隅に置く（怪人の巡回経路・視界から離す）。 */
await page.evaluate(() => {
  const dbg = window.__dbg;
  dbg.ply.x = -6.6; dbg.ply.z = 5.2; dbg.ply.yaw = -Math.PI / 2; dbg.ply.pitch = 0;
  dbg.spawnMonster();
  /* spawnMonster は patrol で出すが huntLeft 初期値 0 のままだと即 leave に
     演出が遷移する（leave は出口へ歩くモード）。検証中は patrol を固定する。 */
  dbg.visit.huntLeft = 9999;
  dbg.ply.hidden = true;   // 視界判定を無効化して chase を起きなくする
});

/* F-01: 巡回中は yaw が進行方向へ追従する */
{
  const samples = [];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(400);
    samples.push(await page.evaluate(() => {
      const m = window.__dbg.mob;
      return { x: m.x, z: m.z, ry: window.__dbg.monster.rotation.y, mode: m.mode };
    }));
    if (i === 12) await page.screenshot({ path: "screenshots/monster-face-mid.png" });
  }
  let checked = 0, good = 0, worst = 0, badmodes = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].mode !== "patrol") { badmodes.push(samples[i].mode); continue; }
    const a = samples[i - 1], b = samples[i];
    const mv = Math.hypot(b.x - a.x, b.z - a.z);
    if (mv < 0.1) continue;   // ほぼ停止（waypoint 折返しフレーム等）は除外
    checked++;
    const err = Math.abs(wrap(b.ry - Math.atan2(b.x - a.x, b.z - a.z)));
    if (err > worst) worst = err;
    if (err < 0.55) good++;
  }
  if (checked >= 5 && badmodes.length <= 2 && good / checked >= 0.8)
    ok("F-01", `巡回中の yaw が進行方向に追従（${good}/${checked}、最大誤差 ${(worst * 180 / Math.PI).toFixed(0)}°）`);
  else
    ng("F-01", "巡回中の yaw が進行方向に追従", `good ${good}/${checked}、mode変化 ${badmodes.join(",") || "無"}、最大誤差 ${(worst * 180 / Math.PI).toFixed(0)}°`);
}

/* F-02: freeze（発見直後の硬直）の間だけプレイヤーへ向き直る */
{
  const info = await page.evaluate(() => {
    const dbg = window.__dbg, p = dbg.ply, m = dbg.mob;
    m.mode = "chase"; m.freeze = 2.4; p.hidden = false;
    /* プレイヤーを怪人から2.4m先に置く（捕獲判定 0.95m に入らない距離） */
    p.x = m.x + 1.7; p.z = m.z + 1.7;
    return { px: p.x, pz: p.z, mx: m.x, mz: m.z };
  });
  await page.waitForTimeout(2800);
  const after = await page.evaluate(() => {
    const dbg = window.__dbg, p = dbg.ply, m = dbg.mob;
    return { want: Math.atan2(p.x - m.x, p.z - m.z), now: dbg.monster.rotation.y };
  });
  const err = Math.abs(wrap(after.want - after.now));
  if (err < 0.35)
    ok("F-02", `freeze 中はプレイヤーの方へ向く（誤差 ${(err * 180 / Math.PI).toFixed(1)}°）`);
  else
    ng("F-02", "freeze 中はプレイヤーの方へ向く", `誤差 ${(err * 180 / Math.PI).toFixed(1)}°`);
}

/* F-03: freeze 解除後は再び進行方向へ戻る、ページエラー無し */
{
  await page.evaluate(() => {
    const dbg = window.__dbg, m = dbg.mob;
    m.freeze = 0; m.mode = "patrol"; m.boost = 0; dbg.visit.huntLeft = 9999; dbg.ply.hidden = true;
  });
  const a = await page.evaluate(() => ({ x: window.__dbg.mob.x, z: window.__dbg.mob.z, ry: window.__dbg.monster.rotation.y }));
  await page.waitForTimeout(2400);
  const b = await page.evaluate(() => ({ x: window.__dbg.mob.x, z: window.__dbg.mob.z, ry: window.__dbg.monster.rotation.y, mode: window.__dbg.mob.mode }));
  const issues = [];
  const mv = Math.hypot(b.x - a.x, b.z - a.z);
  if (b.mode === "patrol" && mv > 0.1 && Math.abs(wrap(b.ry - Math.atan2(b.x - a.x, b.z - a.z))) > 0.55)
    issues.push(`freeze 解除後も yaw が移動方向へ戻らない（移動 ${mv.toFixed(2)}m）`);
  if (issues.length) ng("F-03", "freeze 解除後は進行方向へ戻る", issues.join(" / "));
  else ok("F-03", `freeze 解除後は進行方向へ戻る（mode=${b.mode}、移動 ${mv.toFixed(2)}m）`);
  await page.screenshot({ path: "screenshots/monster-face-end.png" });
}

await browser.close();
const failed = results.filter(r => !r[1]);
console.log(`\n--- ${results.length - failed.length}/${results.length} PASS / pageerrors ${errors.length} ---`);
if (errors.length) console.log(errors.join("\n"));
process.exit(failed.length ? 1 : 0);
