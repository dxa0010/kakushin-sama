/* ============================================================
   押し入れビュー（v26）のE2E:  隠れると実カメラが押し入れ内へ移る
   手動実行:  python -m http.server 8765 でルートを配信しながら
     node closet-view.mjs  （playwright がある node_modules で）
   アーティファクト: 実行 cwd に screenshots/closet-*.png
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

const results = [];
function ok(id, what) { results.push([id, true]); console.log(`PASS ${id} ${what}`); }
function ng(id, what, detail) { results.push([id, false]); console.log(`FAIL ${id} ${what}\n     → ${detail}`); }
async function check(id, what, fn) {
  try { const d = await fn(); if (d) ng(id, what, d); else ok(id, what); }
  catch (e) { ng(id, what, `例外: ${e.message}`); }
}

/* プロンプトは canvas がポインタイベントを握るので、JS から直接クリックする */
const clickPrompt = async () => {
  await page.evaluate(() => document.getElementById("prompt").click());
};

await page.goto(`${URL_BASE}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.click("#startBtn");
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });

/* クローゼット（x -1.6, z -4.55）の前に立たせる */
await page.evaluate(() => { const p = window.__dbg.ply; p.x = -1.6; p.z = -4.2; p.yaw = Math.PI; p.pitch = 0; });
await page.waitForTimeout(400);

const outside = await page.evaluate(() => {
  const p = window.__dbg.ply;
  return { x: p.x, z: p.z, yaw: p.yaw, hidden: p.hidden };
});
await page.screenshot({ path: "screenshots/closet-before.png" });

const promptShown = await page.evaluate(() => {
  const el = document.getElementById("prompt");
  return !el.classList.contains("hidden") && /隠|hide/i.test(el.textContent || "");
});
if (!promptShown) ng("H-01", "クローゼット前で「隠れる」プロンプトが出る", "prompt が出ていない");
else ok("H-01", "クローゼット前で「隠れる」プロンプトが出る");

await clickPrompt();
await page.waitForTimeout(400);

await check("H-02", "隠れるとカメラが押し入れ内へ移り、正面（+z）を向く", async () => {
  const s = await page.evaluate(() => {
    const p = window.__dbg.ply, cam = window.__dbg.gfx.camera;
    const ov = document.getElementById("hideOv");
    return { x: p.x, z: p.z, yaw: p.yaw, hidden: p.hidden,
             cam: [cam.position.x, cam.position.y, cam.position.z],
             bg: getComputedStyle(ov).backgroundImage, ov: getComputedStyle(ov).display };
  });
  const issues = [];
  if (!s.hidden) issues.push("ply.hidden が立っていない");
  if (Math.abs(s.x - (-1.52)) > 0.02) issues.push(`x が ${s.x}（-1.52 のはず）`);
  if (Math.abs(s.z - (-5.15)) > 0.02) issues.push(`z が ${s.z}（-5.15 のはず）`);
  const ny = ((s.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (Math.min(Math.abs(ny - Math.PI), Math.abs(ny + Math.PI)) > 0.02)
    issues.push(`yaw が ${s.yaw}（π＝+z正面のはず）`);
  const d = Math.hypot(s.cam[0] - s.x, s.cam[2] - s.z);
  if (d > 0.01) issues.push(`カメラがプレイヤーと一致しない: 距離 ${d.toFixed(3)}`);
  if (!/radial-gradient/.test(s.bg)) issues.push(`hideOv がビネットになっていない: ${s.bg.slice(0, 80)}`);
  if (s.ov !== "block") issues.push(`hideOv が表示されていない: ${s.ov}`);
  await page.screenshot({ path: "screenshots/closet-hidden.png" });
  return issues.join(" / ") || null;
});

await check("H-03", "隠れている間は移動できない", async () => {
  const before = await page.evaluate(() => {
    const p = window.__dbg.ply; return [p.x, p.z];
  });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => {
    const p = window.__dbg.ply; return [p.x, p.z];
  });
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
  return moved > 0.01 ? `W押下で ${moved.toFixed(3)}m 動いた` : null;
});

await check("H-04", "出ると元の位置・向きに戻る", async () => {
  await clickPrompt();
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const p = window.__dbg.ply;
    const ov = document.getElementById("hideOv");
    return { x: p.x, z: p.z, yaw: p.yaw, hidden: p.hidden, ov: getComputedStyle(ov).display };
  });
  const issues = [];
  if (s.hidden) issues.push("hidden が解除されていない");
  if (Math.hypot(s.x - outside.x, s.z - outside.z) > 0.02)
    issues.push(`位置が戻っていない: (${outside.x},${outside.z}) → (${s.x},${s.z})`);
  const dy = ((s.yaw - outside.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (Math.abs(dy) > 0.02) issues.push(`向きが戻っていない: ${outside.yaw} → ${s.yaw}`);
  if (s.ov !== "none") issues.push(`hideOv が消えていない: ${s.ov}`);
  return issues.join(" / ") || null;
});

await check("H-05", "連続で隠れてもページエラーが出ない", async () => {
  for (let i = 0; i < 3; i++) {
    await clickPrompt();
    await page.waitForTimeout(250);
    await clickPrompt();
    await page.waitForTimeout(250);
  }
  return errors.length ? `エラー: ${errors.join(" | ")}` : null;
});

await page.screenshot({ path: "screenshots/closet-after.png" });
await browser.close();
const failed = results.filter(r => !r[1]);
console.log(`\n--- ${results.length - failed.length}/${results.length} PASS / pageerrors ${errors.length} ---`);
if (errors.length) console.log(errors.join("\n"));
process.exit(failed.length ? 1 : 0);
