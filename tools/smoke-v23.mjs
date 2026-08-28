/* ============================================================
   v23 の改修（画質プリセット・描画スキップ・ポインタロック復帰・怪人のスタック解消）が
   実機のブラウザで壊れていないことを確かめるスモークテスト。

   絵の良し悪しではなく「例外が出ないか」「意図した状態になっているか」を見る道具なので、
   shot.mjs（撮影）とは目的が違う。落ちたケースだけを標準出力に出す。

   前提: リポジトリルートで静的サーバを起動しておく
     python -m http.server 8765

   実行: playwright は npm のグローバルにしか無く、ESM は NODE_PATH を無視するので
         このファイルを playwright のあるディレクトリへコピーして、そこから実行する。
     cp tools/smoke-v23.mjs "$APPDATA/npm/node_modules/" && cd "$APPDATA/npm/node_modules"
     node smoke-v23.mjs
   ============================================================ */
import { chromium } from "playwright";

const URL = "http://localhost:8765/index.html";
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); };

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleMsgs = [];
page.on("console", (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => consoleMsgs.push({ type: "pageerror", text: String(e) }));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// --- 1. 起動時に例外が出ていないこと -------------------------------------
const errs0 = consoleMsgs.filter((m) => m.type === "pageerror" || m.type === "error");
check("S-00 起動時に例外なし", errs0.length === 0, errs0.map((e) => e.text).join(" / "));

// --- 2. PCFSoftShadowMap の毎フレーム警告が消えていること -----------------
// タイトル中も warmup で数フレーム描くので、残っていればここで必ず出る。
const pcfWarn = consoleMsgs.filter((m) => /PCFSoftShadowMap has been deprecated/.test(m.text));
check("S-01 PCFSoft の毎フレーム警告が出ない", pcfWarn.length === 0, `${pcfWarn.length}件`);

await page.click("#startBtn").catch(() => {});
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });
await page.waitForTimeout(1500);

// --- 3. 画質プリセットが実際に効いていること ------------------------------
const q = await page.evaluate(() => {
  const g = window.__dbg.gfx;
  const lights = [];
  g.scene.traverse((o) => { if (o.isLight && o.shadow) lights.push({ cast: o.castShadow, map: o.shadow.mapSize.x }); });
  return {
    quality: window.__dbg.quality(),
    pixelRatio: g.renderer.getPixelRatio(),
    aoW: g.aoPass.width, aoH: g.aoPass.height,
    drawW: g.renderer.domElement.width,
    shadowType: g.renderer.shadowMap.type,
    casters: lights.filter((l) => l.cast).length,
    lights: lights.length,
  };
});
// デスクトップ（論理コア8以上）想定なので high で走るはず。
check("A-01 デスクトップは high", q.quality === "high", JSON.stringify(q));
// AO は composer の実効解像度の半分（FX_SCALE=0.5）
const expAoW = Math.round((1280 * q.pixelRatio) * 0.5);
check("A-02 GTAO が半解像度", Math.abs(q.aoW - expAoW) <= 1, `aoW=${q.aoW} 期待=${expAoW}`);
check("A-03 shadowMap.type が PCF(1)", q.shadowType === 1, `type=${q.shadowType}`);

// --- 4. オーバーレイ中に描画を止めていること ------------------------------
// renderer.info.render.frame は composer.render() のたびに進む。
/* 【窓を十分長く取る】swiftshader では高画質時に1フレーム1.8秒かかることがある。
   700ms の窓だと「ちゃんと描いているのに0フレーム」になり、S-02 が偽陽性で落ちる
   （実際に踏んだ）。描画の有無を見るだけなので、窓の長さは惜しまない。 */
const frameDelta = await page.evaluate(async () => {
  const g = window.__dbg.gfx;
  const window6s = async () => {
    const a = g.renderer.info.render.frame;
    await new Promise((r) => setTimeout(r, 6000));
    return g.renderer.info.render.frame - a;
  };
  const playing = await window6s();
  window.__dbg.openPause();
  // ポーズ直前に始まっていた1フレームを描き切らせてから測る
  await new Promise((r) => setTimeout(r, 2500));
  const paused = await window6s();
  window.__dbg.closePause();
  return { playing, paused };
});
check("S-02 PLAY中は描画している", frameDelta.playing > 0, JSON.stringify(frameDelta));
check("S-03 ポーズ中は描画を止めている", frameDelta.paused === 0, JSON.stringify(frameDelta));

// --- 5. 検分を閉じたらポインタロックを取り直そうとすること -----------------
// headless ではロック自体は成立しないが、「閉じたのに一度も要求していない」退行は捕まる。
const relockTried = await page.evaluate(async () => {
  const el = window.__dbg.gfx.renderer.domElement;
  let calls = 0;
  const orig = el.requestPointerLock.bind(el);
  el.requestPointerLock = function (...a) { calls++; try { return orig(...a); } catch (e) { return undefined; } };
  const it = window.__dbg.ITEMS.find((i) => !i.taken);
  window.__dbg.openInspect(it);
  await new Promise((r) => setTimeout(r, 120));
  document.getElementById("btnBack").click();
  await new Promise((r) => setTimeout(r, 200));
  return { calls, state: window.__dbg.st() };
});
check("S-04 検分を閉じるとロックを取り直す", relockTried.calls >= 1, JSON.stringify(relockTried));
check("S-05 検分を閉じると PLAY に戻る", relockTried.state === "PLAY", JSON.stringify(relockTried));

// --- 6. 怪人が壁の角でスタックしないこと ----------------------------------
/* 【実時間ではなくゲーム内時間で測る】この検証は swiftshader（ソフトウェア描画）で
   走るので実フレームレートが数fpsまで落ちる。ゲーム側は dt を Math.min(0.05, …) で
   クランプしているため、**ゲーム内時間は実時間の1/4以下の速さでしか進まない**。
   実時間の秒で「何m進んだか」を見ると、スタックしていなくても必ず遅く見える。
   ゲームと同じクランプ後の dt を1フレームずつ積んで、その時間軸で測る。 */
/* 【プレイヤーを隠したまま測る】測りたいのは「巡回中に部屋の角や家具に引っかかるか」。
   素直に出現させると、無操作で立ち止まっているプレイヤーを怪人がすぐ捕まえて
   説教ENDに入り、以降フリーズした怪人を「13秒スタック」と誤検出してしまう（実際に踏んだ）。
   ply.hidden を立てると canSee が常に false になるので、怪人は巡回を続ける＝
   ウェイポイント網を一周させて角の挙動だけを見られる。狩り時間が尽きたら再訪させる。 */
const stuckStat = await page.evaluate(async () => {
  const d0 = window.__dbg;
  d0.ply.hidden = true;
  d0.enterVisit();
  const m = d0.mob;
  return await new Promise((resolve) => {
    let worst = 0, run = 0, gameT = 0, moved = 0, frames = 0, revisits = 0;
    let px = m.x, pz = m.z, last = performance.now();
    // swiftshader は数fpsしか出ないので、ゲーム内18秒でも実時間では分単位かかる。
    // 何かの拍子に進まなくなっても必ず抜けられるよう、実時間の上限も置く。
    const wallDeadline = performance.now() + 150000;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!m.active) { d0.enterVisit(); revisits++; px = m.x; pz = m.z; if (now < wallDeadline) requestAnimationFrame(tick); else resolve({ worst: -1, note: "wall timeout while inactive" }); return; }
      const d = Math.hypot(m.x - px, m.z - pz);
      px = m.x; pz = m.z;
      gameT += dt; moved += d; frames++;
      // 「動けなかった」の判定はゲーム側の停滞判定と同じ尺度（進みたかった量の1割未満）
      if (d < 1.05 * dt * 0.1) { run += dt; if (run > worst) worst = run; } else run = 0;
      if (gameT < 12 && d0.st() === "PLAY" && now < wallDeadline) requestAnimationFrame(tick);
      else {
        d0.ply.hidden = false;
        resolve({ worst: +worst.toFixed(2), gameT: +gameT.toFixed(1), frames, revisits,
                  perGameSec: +(moved / gameT).toFixed(2), mode: m.mode, state: d0.st() });
      }
    };
    requestAnimationFrame(tick);
  });
});
/* steer（壁沿いのすべり）と 0.45秒での打ち切りが効いていれば、止まり続ける区間は
   0.45秒＋1フレームを超えないはず（v22 は最大1.2秒その場で震えていた）。 */
check("A-04 怪人が0.6秒以上その場で止まらない", stuckStat.worst < 0.6, JSON.stringify(stuckStat));
/* 巡回速度は phase1 で 1.05 m/s。角での減速や方向転換で目減りするので、
   その6割を「ちゃんと歩き回っている」の下限とする。 */
check("A-05 怪人がゲーム内時間で歩けている", stuckStat.perGameSec > 0.63, JSON.stringify(stuckStat));

// --- 7. 低画質へ切り替えても例外が出ず、実際に軽くなること -----------------
const lowQ = await page.evaluate(async () => {
  const sel = document.getElementById("pQual");
  sel.value = "low";
  sel.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 400));
  const g = window.__dbg.gfx;
  const lights = [];
  g.scene.traverse((o) => { if (o.isLight && o.shadow && o.castShadow) lights.push(o.shadow.mapSize.x); });
  return { quality: window.__dbg.quality(), pixelRatio: g.renderer.getPixelRatio(), casters: lights.length, ao: g.aoPass.enabled };
});
check("A-06 low で影を落とす光源が1灯", lowQ.casters === 1, JSON.stringify(lowQ));
check("A-07 low で pixelRatio が1", lowQ.pixelRatio === 1, JSON.stringify(lowQ));
check("A-08 low で GTAO が無効", lowQ.ao === false, JSON.stringify(lowQ));

// --- 8b. パンくず追跡：間仕切り壁を回り込めること --------------------------
/* 部屋の中央には x≈0 を南北に走る間仕切り壁があり、開口は z:-3.5〜-2.0 と z:2.0〜3.5 の
   2箇所だけ。(4,0) と (-4,0) はその壁を挟んで真正面で、直進では絶対に届かない
   （v22 の怪人はここで壁に貼り付いたまま置いていかれた＝「ぐるぐる回れば振り切れる」）。
   南の開口(0,-2.75)を通る足跡を敷いた場合と、足跡を消した場合を撮り比べる。
   ロスト2.8秒での打ち切りは経路の検証には邪魔なので、毎フレーム lostAt を戻して
   「追い続けたときにどう動くか」だけを見る。 */
const crumb = await page.evaluate(async () => {
  const d = window.__dbg;
  const DOOR = { x: 0, z: -2.75 };
  const run = (useTrail) => new Promise((resolve) => {
    d.ply.hidden = false;
    if (!d.mob.active) d.enterVisit();
    d.ply.x = -4; d.ply.z = 0;
    d.trail.length = 0;
    if (useTrail) {
      // プレイヤーが東側から南の開口を抜けて西側へ回り込んだ、という足跡
      for (const [x, z] of [[4,0],[3,-1],[2,-2],[1,-2.75],[0,-2.75],[-1,-2.75],[-2,-2],[-3,-1],[-4,0]]) {
        d.ply.x = x; d.ply.z = z; d.trailPush();
      }
      d.ply.x = -4; d.ply.z = 0;
    }
    d.mob.x = 4; d.mob.z = 0; d.mob.mode = "chase"; d.mob.lostAt = 0; d.mob.crumb = -1;
    let gameT = 0, minDoor = Infinity, last = performance.now();
    const wallDeadline = performance.now() + 120000;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      gameT += dt;
      d.mob.lostAt = 0; d.mob.mode = "chase";      // 経路だけを見たいので打ち切りは止める
      const dd = Math.hypot(d.mob.x - DOOR.x, d.mob.z - DOOR.z);
      if (dd < minDoor) minDoor = dd;
      // 【捕獲される前に必ず抜ける】捕獲判定は0.95m。一度でも説教ENDに入ると state が END で
      // 固まり、このあとのケースが全部「ENDのまま計測」になって無言で無効になる（実際に踏んだ）。
      const near = Math.hypot(d.mob.x - d.ply.x, d.mob.z - d.ply.z) < 1.4;
      if (!near && gameT < 8 && d.st() === "PLAY" && now < wallDeadline) requestAnimationFrame(tick);
      else resolve({ minDoor: +minDoor.toFixed(2),
                     toPlayer: +Math.hypot(d.mob.x - d.ply.x, d.mob.z - d.ply.z).toFixed(2),
                     mobX: +d.mob.x.toFixed(2), mobZ: +d.mob.z.toFixed(2), gameT: +gameT.toFixed(1) });
    };
    requestAnimationFrame(tick);
  });
  const withTrail = await run(true);
  const noTrail = await run(false);
  return { withTrail, noTrail };
});
/* 【当初の想定は外れた】「足跡が無ければ壁に貼り付いたまま」と予想したが、実測では
   足跡なしでも steer（壁沿いのすべり）だけで開口まで 0.34m まで到達した。つまり
   v23 の2つの改修のうち、**角を回り込めること自体は steer が担っている**。
   足跡が効くのは到達の速さと直進性で、同じ時間でプレイヤーとの距離が 1.4m 対 3.4m
   まで開く。主張はこの差のほうに置く。 */
check("A-09 足跡があれば開口へ回り込む", crumb.withTrail.minDoor < 1.5, JSON.stringify(crumb.withTrail));
check("A-10 足跡ありは同じ時間で0.5m以上多く詰める",
      crumb.noTrail.toPlayer - crumb.withTrail.toPlayer > 0.5, JSON.stringify(crumb));
check("A-11 足跡ありのほうがプレイヤーに近づく",
      crumb.withTrail.toPlayer < crumb.noTrail.toPlayer, JSON.stringify(crumb));

// --- 8c. 青色申告の発見演出と追跡速度 --------------------------------------
/* 白は「一切変えない」が方針なので、白では freeze も spot 演出も 0 のままであること、
   青でだけ 4.0 m/s・0.7秒の硬直・spot uniform が立つことを両方確かめる。 */
const blueFx = await page.evaluate(async () => {
  const d = window.__dbg;
  const probe = (m) => new Promise((resolve) => {
    d.setMode(m);
    d.ply.hidden = false;
    // 狩り時間(huntLeft)を必ず作り直す。使い切っていると mode が "leave" になり、
    // 目の前に立たせても追跡に入らない。
    d.mob.active = false; d.enterVisit();
    /* 【(0,0) に置いてはいけない】そこは中央の間仕切り壁の中で、視線(los)が通らないので
       どれだけ近くても canSee が false のままになる（実際にこれで空振りした）。
       西側の部屋の、キッチン境界の壁(z=-0.15〜0.15)より南に、両者を並べて置く。 */
    d.ply.x = -4; d.ply.z = 4;
    d.mob.x = -4; d.mob.z = 1.5; d.mob.mode = "patrol"; d.mob.freeze = 0; d.mob.crumb = -1;
    let gameT = 0, last = performance.now(), maxFreeze = 0, maxSpot = 0, chaseSp = 0;
    const wallDeadline = performance.now() + 90000;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      gameT += dt;
      if (d.mob.freeze > maxFreeze) maxFreeze = d.mob.freeze;
      const sv = d.gfx.filmPass.uniforms.spot.value;
      if (sv > maxSpot) maxSpot = sv;
      // 【捕まる前に離す】座標をずらすと壁の外に出しかねないので、怪人のほうを最初の
      // 位置へ戻して距離を作る。記録したいのは maxFreeze と maxSpot だけなので、
      // それが揃っていれば即座に打ち切ってよい。
      if (Math.hypot(d.mob.x - d.ply.x, d.mob.z - d.ply.z) < 1.7) { d.mob.x = -4; d.mob.z = 1.5; }
      const enough = maxFreeze > 0 && maxSpot > 0.35;
      if (!enough && gameT < 4 && d.st() === "PLAY" && now < wallDeadline) requestAnimationFrame(tick);
      else resolve({ mode: m, maxFreeze: +maxFreeze.toFixed(2), maxSpot: +maxSpot.toFixed(2),
                     mobMode: d.mob.mode, state: d.st() });
    };
    requestAnimationFrame(tick);
  });
  /* 【白を先に測る】spot は戻りを 1.1秒かけて落とす作りなので、青のあとに白を測ると
     残光をそのまま「白でも演出が出た」と読んでしまう（実際にこれで誤検出した）。
     ここまでのケースは全て白モードかつ spotFx:false で走っているので、白から測れば 0 から始まる。 */
  const white = await probe("white");
  const blue = await probe("blue");
  return { blue, white };
});
check("B-01 青は発見時に0.5秒以上硬直する", blueFx.blue.maxFreeze >= 0.5, JSON.stringify(blueFx.blue));
check("B-02 青は spot 演出が立つ", blueFx.blue.maxSpot > 0.3, JSON.stringify(blueFx.blue));
check("B-03 白は硬直しない（白は変えない）", blueFx.white.maxFreeze === 0, JSON.stringify(blueFx.white));
check("B-04 白は spot 演出が出ない（白は変えない）", blueFx.white.maxSpot === 0, JSON.stringify(blueFx.white));

// --- 8d. 青の段階的加速と訪問間隔 ------------------------------------------
const accel = await page.evaluate(async () => {
  const d = window.__dbg;
  /* 追い続けている間だけ速くなること、足跡の終端で抜けていくことを見る。
     プレイヤーは動かさず、怪人が追いつく前に位置を戻して追跡を継続させる。 */
  const chase = () => new Promise((resolve) => {
    d.setMode("blue");
    d.ply.hidden = false;
    d.mob.active = false; d.enterVisit();
    d.ply.x = -4; d.ply.z = 4;
    d.mob.x = -4; d.mob.z = 1.5; d.mob.mode = "patrol"; d.mob.freeze = 0;
    d.mob.boost = 0; d.mob.boostT = 0; d.mob.crumb = -1;
    let gameT = 0, last = performance.now(), maxBoost = 0;
    const wallDeadline = performance.now() + 120000;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      gameT += dt;
      if (d.mob.boost > maxBoost) maxBoost = d.mob.boost;
      if (Math.hypot(d.mob.x - d.ply.x, d.mob.z - d.ply.z) < 1.7) { d.mob.x = -4; d.mob.z = 1.5; }
      if (gameT < 12 && d.st() === "PLAY" && now < wallDeadline) requestAnimationFrame(tick);
      else resolve({ maxBoost: +maxBoost.toFixed(2), gameT: +gameT.toFixed(1), mobMode: d.mob.mode });
    };
    requestAnimationFrame(tick);
  });
  const blue = await chase();
  // 白は chaseAccel が null なので、同じ状況でも boost は一切積まれない
  const whiteAccel = (() => { d.setMode("white"); return d.mob.boost; })();
  // 訪問間隔の式（青 6+乱数0..8、白 18+乱数0..14）を、実際の設定値から確かめる
  const gaps = { blueGap: 6, whiteGap: 18 };
  return { blue, whiteAccel, gaps };
});
// 12ゲーム秒 ÷ 1.5秒 = 8回ぶん、つまり +1.6 m/s まで積める計算。半分積めていれば効いている。
check("B-05 青は追い続けると加速が積まれる", accel.blue.maxBoost >= 0.8, JSON.stringify(accel.blue));

const gapStat = await page.evaluate(() => {
  const d = window.__dbg;
  // endVisit() が次回時刻を決める。モードごとに何ゲーム内分先になるかを直接測る。
  const sample = (m) => {
    d.setMode(m);
    const before = d.gm();
    d.mob.active = true; d.endVisit();
    return +(d.visit.nextAt - before).toFixed(1);
  };
  const blue = [], white = [];
  for (let i = 0; i < 12; i++) { blue.push(sample("blue")); white.push(sample("white")); }
  return { blueMin: Math.min(...blue), blueMax: Math.max(...blue),
           whiteMin: Math.min(...white), whiteMax: Math.max(...white) };
});
check("B-06 青の訪問間隔は6〜14ゲーム内分",
      gapStat.blueMin >= 5.9 && gapStat.blueMax <= 14.1, JSON.stringify(gapStat));
check("B-07 白の訪問間隔は従来どおり18〜32（白は変えない）",
      gapStat.whiteMin >= 17.9 && gapStat.whiteMax <= 32.1, JSON.stringify(gapStat));

// --- 8. 一連の操作を通して新しい例外が出ていないこと ----------------------
const errs1 = consoleMsgs.filter((m) => m.type === "pageerror" || m.type === "error");
check("S-06 操作後も例外なし", errs1.length === 0, errs1.map((e) => e.text).slice(0, 5).join(" / "));

await browser.close();

let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  // 合否だけでなく実測値も常に出す。ここで測っているのは性能とAIの挙動で、
  // 通ったときの数値そのものが次の改修の基準線になるため。
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id}  ${r.detail || ""}`);
}
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
