/* ============================================================
   怪人の全体・メッシュごとの外接箱を数値で出す

   造形を変えるたびに「切っ先が床を割っていないか」「全高が伸びていないか」を
   目で確かめるのは無理で、実際この作業では刃を伸ばすたびに床を突き抜けていた。
   刃の角度・刃渡り・握りの高さは連動するので、解析で合わせても必ずずれる。
   **変えたら測る**ための道具。

   実行: cp tools/mob-bbox.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
         node mob-bbox.mjs
   前提: リポジトリルートで python -m http.server 8765
   ============================================================ */
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on("pageerror", (e) => console.log("PAGE-EXC:", e.message));
await page.goto("http://localhost:8765/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.click("#startBtn").catch(() => {});
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });

const out = await page.evaluate(() => {
  const { THREE } = window.__dbg.gfx;
  const mob = window.__dbg.monster;
  mob.position.set(0, 0, 0);
  mob.rotation.set(0, 0, 0);
  mob.updateMatrixWorld(true);
  const rows = [];
  const all = new THREE.Box3();
  let i = 0;
  mob.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    all.union(b);
    rows.push({
      i: i++,
      name: o.material?.name || o.material?.uuid?.slice(0, 6) || "?",
      min: [b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(3)),
      max: [b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(3)),
    });
  });
  return { all: { min: [all.min.x, all.min.y, all.min.z].map((v) => +v.toFixed(3)),
                  max: [all.max.x, all.max.y, all.max.z].map((v) => +v.toFixed(3)) }, rows };
});

console.log("全体   min", out.all.min.join(" "), "  max", out.all.max.join(" "));
console.log("全高", (out.all.max[1] - out.all.min[1]).toFixed(3), " 接地", out.all.min[1].toFixed(3));
for (const r of out.rows) console.log(String(r.i).padStart(2), r.name.padEnd(8), "min", r.min.join(" ").padEnd(22), "max", r.max.join(" "));
await browser.close();
