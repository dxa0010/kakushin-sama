/* =====================================================================
 * title.js ── タイトル画面（ウェルカム画面）の演出
 *
 * 【なぜ別ファイルか】game.js は 6000 行を超えていて、タイトルの演出（暗転・ちらつき・
 * 冒頭の文章・メニューの反応）はゲームの状態をほとんど必要としない。必要なもの
 * （文言・音・設定画面の開閉）は initTitle() の引数で受け取り、ここからゲームの
 * 状態（state / save / scene）には触らない。開始ボタンを押したあとに何をするかも
 * game.js 側が決める（ここは「暗転し終わった」ことを知らせるだけ）。
 *
 * 【演出の文法】ゲーム本編と同じく「真顔でやりきる」。ふざけるのは題材だけ。
 *   - 背景は決定稿の怪人の絵。奥のモニターの光がときどき消え、**点き直すたびに
 *     あれが少しだけ近い**。動いている瞬間は見せない（暗転の間にだけ動く）。
 *   - メニューは押すと反応が返る。モードを選ぶと赤い印が押され、青色申告を選ぶと
 *     部屋が冷えて、あれが一歩近づく。開始を押すと、明かりが死んで真っ暗になる。
 *   - 音は最初の操作のあとにしか鳴らせない（自動再生の制限）。鳴るようになったら
 *     秒針だけを小さく刻む。期限が迫っている、というこの作品の一番の恐怖。
 *
 * 【自動テストとの約束】#startBtn は常に押せること（暗幕・冒頭の文章は
 * pointer-events:none）。#startBtn 自体に transform のアニメーションを掛けないこと
 * （Playwright は「位置が止まるまで」クリックを待つので、揺れ続けると押せなくなる）。
 * 揺らすのは中の <span> だけ。
 * ===================================================================== */

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 冒頭の文章（前提の5行）を出すのはセッションに1回だけ。「もう一度」「タイトルへ戻る」は
   location.reload() なので、毎回出すと2周目から邪魔になる。
   自動操作（navigator.webdriver）では出さない。ツール7本と E2E が #startBtn を
   すぐ押す前提で書かれていて、冒頭の数秒を待たせる理由が無い。 */
const COLD_KEY = "kakushin_cold_open";

// あれが近づく上限。顔を原点に拡大するので顔は動かないが、上げすぎると胴が画面からあふれて何の絵か分からなくなる。
const NEAR_STEP = 0.028, NEAR_MAX = 1.16;

/**
 * @param {object} d
 * @param {(k:string, v?:object)=>string} d.tr
 * @param {object} d.sfx  { ready():boolean, unlock(), tick(tock,vol), thump(vol), heartbeat(vol), deny() }
 * @param {()=>void} d.openSettings
 * @param {()=>void} d.closeSettings
 * @param {()=>boolean} d.settingsOpen
 * @param {(m:string)=>void} d.onMode   モードが変わった（"white" | "blue"）
 * @param {()=>boolean} d.blueUnlocked
 */
export function initTitle(d) {
  const root = $("title");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let alive = true;        // 開始後は演出を全部止める
  let near = 1;            // あれの近さ（#tArtImg の scale）
  let lastFocus = null;

  /* ---------- フィルムの粒子 ----------
     画像を同梱せずに毎回作る（160px 四方で十分。大きくしても粒が細かくなるだけ）。 */
  {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const g = c.getContext("2d");
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    $("tGrain").style.backgroundImage = `url(${c.toDataURL()})`;
  }

  /* ---------- 暗転（明かりが消える）と、あれが近づく ---------- */
  const dark = $("tDark"), art = $("tArtImg");
  const setNear = (v) => { near = v; art.style.setProperty("--near", v.toFixed(3)); };
  // 点滅のパターン [不透明度, 保持ms] の列。最後は必ず 0 に戻す。
  async function blackout({ step = true, pattern } = {}) {
    if (!alive) return;
    const seq = pattern || (Math.random() < 0.5
      ? [[0.92, rand(90, 160)], [0.15, 60], [0.97, rand(140, 260)], [0, 0]]
      : [[0.97, rand(160, 300)], [0, 0]]);
    let moved = false;
    for (const [o, ms] of seq) {
      dark.style.opacity = String(o);
      // 一番暗いところで動かす。明るいうちに動くと「拡大した」と見抜かれる。
      if (!moved && o >= 0.9) {
        moved = true;
        if (step && near < NEAR_MAX) setNear(Math.min(NEAR_MAX, near + NEAR_STEP));
        if (d.sfx.ready()) d.sfx.thump(0.07);
      }
      if (ms) await wait(ms);
      if (!alive) return;
    }
  }
  function scheduleBlackout(first) {
    if (reduce) return;
    later(async () => { await blackout(); scheduleBlackout(false); }, first ? rand(5000, 7000) : rand(9000, 16000));
  }

  /* ---------- 題字のノイズ ---------- */
  const h1 = $("titleName");
  function scheduleGlitch() {
    if (reduce) return;
    later(() => {
      if (!alive) return;
      h1.classList.add("glitch");
      later(() => h1.classList.remove("glitch"), 170);
      scheduleGlitch();
    }, rand(6000, 13000));
  }

  /* ---------- マウスの位置で背景をわずかに動かす（奥行き） ---------- */
  if (!reduce && matchMedia("(pointer: fine)").matches) {
    const px = $("tArt");
    root.addEventListener("pointermove", (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      px.style.transform = `translate(${(-x * 14).toFixed(1)}px, ${(-y * 9).toFixed(1)}px)`;
    });
  }

  /* ---------- 音：最初の操作で解禁し、秒針を刻む ---------- */
  let tickOn = false;
  function startTicking() {
    if (tickOn || !alive) return;
    tickOn = true;
    let tock = false;
    const iv = setInterval(() => {
      if (!alive) { clearInterval(iv); return; }
      // 設定画面やクレジットを読んでいる間も止めない（時間は止まらない）
      d.sfx.tick(tock = !tock, 0.035);
    }, 1000);
  }
  const unlock = () => {
    if (!alive) return;
    d.sfx.unlock();
    if (d.sfx.ready()) startTicking();
  };
  root.addEventListener("pointerdown", unlock, { capture: true });
  addEventListener("keydown", unlock, { capture: true });

  /* ---------- メニューの反応 ---------- */
  let lastBeat = 0;
  for (const el of root.querySelectorAll(".tItem, .mbtn")) {
    const hover = () => {
      if (!alive || !d.sfx.ready()) return;
      if (el.id === "startBtn") {
        // 開始にだけ心音。連打で鳴りっぱなしにならないよう間を空ける
        const now = performance.now();
        if (now - lastBeat > 1400) { lastBeat = now; d.sfx.heartbeat(0.22); }
      } else {
        d.sfx.tick(false, 0.06);
      }
    };
    el.addEventListener("pointerenter", hover);
    el.addEventListener("focus", hover);
  }

  /* ---------- モード選択 ---------- */
  const desc = $("modeDesc");
  let descTimer = null;
  function showDesc(key, whisper = false) {
    desc.classList.remove("show", "whisper");
    void desc.offsetWidth;   // 同じ文言でもフェードをやり直す
    desc.textContent = d.tr(key);
    desc.classList.toggle("whisper", whisper);
    desc.classList.add("show");
  }
  function select(m) {
    const w = $("modeWhite"), b = $("modeBlue");
    const on = m === "blue" ? b : w, off = m === "blue" ? w : b;
    const changed = !on.classList.contains("sel");
    on.classList.add("sel"); off.classList.remove("sel");
    on.setAttribute("aria-checked", "true"); off.setAttribute("aria-checked", "false");
    root.classList.toggle("blue", m === "blue");
    showDesc(m === "blue" ? "modeDescBlue" : "modeDescWhite");
    if (!changed) return;
    // 外した側の印も必ず消す。.stamp は fill-mode both なので、残すと最終フレームの
    // opacity が効き続けて、赤い印が両方に付いて見える（2026-10-28 の不具合）
    off.querySelector(".seal").classList.remove("stamp");
    // 印を押し直す（アニメーションをやり直すため一度外す）
    const seal = on.querySelector(".seal");
    seal.classList.remove("stamp"); void seal.offsetWidth; seal.classList.add("stamp");
    if (d.sfx.ready()) d.sfx.thump(m === "blue" ? 0.32 : 0.2);
    if (m === "blue") {
      // 青色申告＝あれが本気になる。明かりを落とし、一歩近づける
      later(() => blackout({ pattern: [[0.97, 220], [0.3, 70], [0.95, 160], [0, 0]] }), 160);
      if (d.sfx.ready()) later(() => d.sfx.heartbeat(0.45), 380);
    }
    d.onMode(m);
  }
  $("modeWhite").addEventListener("click", () => select("white"));
  $("modeBlue").addEventListener("click", () => {
    if (!d.blueUnlocked()) {
      // 解禁前：拒まれる。理由はボタンの文言に書いてある（還付ENDで解禁）
      const b = $("modeBlue");
      b.classList.remove("deny"); void b.offsetWidth; b.classList.add("deny");
      if (d.sfx.ready()) d.sfx.deny();
      clearTimeout(descTimer);
      showDesc("modeLockedWhisper", true);
      descTimer = setTimeout(() => showDesc($("modeBlue").classList.contains("sel") ? "modeDescBlue" : "modeDescWhite"), 1800);
      return;
    }
    select("blue");
  });
  desc.textContent = d.tr("modeDescWhite");

  /* ---------- モーダル（遊び方・クレジット・設定） ---------- */
  const modals = ["howto", "credits"];
  function openModal(id, opener) {
    lastFocus = opener || document.activeElement;
    $(id).classList.remove("hidden");
    const back = $(id).querySelector(".btn");
    if (back) back.focus({ preventScroll: true });
    if (d.sfx.ready()) d.sfx.tick(true, 0.08);
  }
  function restoreFocus() { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); lastFocus = null; }
  $("howtoBtn").addEventListener("click", (e) => openModal("howto", e.currentTarget));
  $("howtoBack").addEventListener("click", () => { $("howto").classList.add("hidden"); restoreFocus(); });
  $("creditsLink").addEventListener("click", (e) => openModal("credits", e.currentTarget));
  $("cBack").addEventListener("click", () => { if (alive && !d.settingsOpen()) restoreFocus(); });
  $("settingsBtn").addEventListener("click", (e) => {
    lastFocus = e.currentTarget;
    d.openSettings();
    if (d.sfx.ready()) d.sfx.tick(true, 0.08);
  });

  /** Esc。開いているものを1枚だけ閉じる（クレジットは設定の上に重なるので先に）。 */
  function escape() {
    if (!$("credits").classList.contains("hidden")) { $("credits").classList.add("hidden"); if (!d.settingsOpen()) restoreFocus(); return; }
    if (d.settingsOpen()) { d.closeSettings(); restoreFocus(); return; }
    for (const id of modals) {
      if (!$(id).classList.contains("hidden")) { $(id).classList.add("hidden"); restoreFocus(); return; }
    }
    if (root.classList.contains("opening")) skipOpening();
  }

  /* ---------- 冒頭の文章 → 題字が灯る ---------- */
  const open = $("tOpen");
  let openingDone = false;
  function reveal() {
    if (openingDone) return;
    openingDone = true;
    root.classList.remove("opening");
    open.classList.add("gone");
    later(() => open.remove(), 1200);
    root.classList.add("reveal");
    later(() => root.classList.add("lit"), 120);
    scheduleBlackout(true);
    later(() => h1.classList.add("on"), 2200);   // 点灯（tFlickOn 0.5s+1.5s）が終わってから
    later(scheduleGlitch, 3000);
  }
  function skipOpening() { reveal(); }

  const forced = sessionStorage.getItem(COLD_KEY) === "force";
  const playOpening = !reduce && (forced || (!sessionStorage.getItem(COLD_KEY) && !navigator.webdriver));
  if (playOpening) {
    try { sessionStorage.setItem(COLD_KEY, "1"); } catch (e) {}
    root.classList.add("opening");
    const lines = ["premise1", "premise2", "premise3", "premise4", "premise5"].map((k) => d.tr(k));
    const box = $("tOpenLines");
    box.textContent = "";
    lines.forEach((t, i) => {
      const p = document.createElement("p");
      p.textContent = t;
      // 4行目（偽物が混ざっている）と5行目（期限）の前は、少し長く間を取る
      p.style.animationDelay = `${0.5 + i * 1.05 + (i >= 3 ? 0.35 : 0)}s`;
      box.appendChild(p);
    });
    $("tOpenSkip").textContent = d.tr("skipHint");
    later(reveal, 7600);
    // 何か押せば飛ばせる。押した操作はそのまま下のボタンに届く（#tOpen は pointer-events:none）
    const skip = () => { if (!openingDone) reveal(); };
    root.addEventListener("pointerdown", skip, { once: true });
    addEventListener("keydown", skip, { once: true });
  } else {
    open.remove();
    reveal();
  }

  /* ---------- 開始：明かりが死ぬ ---------- */
  let starting = false;
  /** 暗転し終わったら resolve する。2回目以降の呼び出しは null（連打で二重に始めない）。 */
  function beginStart() {
    if (starting) return null;
    starting = true;
    reveal();
    root.classList.add("starting");
    if (d.sfx.ready()) d.sfx.thump(0.4);
    const pattern = reduce
      ? [[1, 260]]
      : [[0.85, 70], [0.1, 60], [0.9, 90], [0.35, 110], [1, 520]];
    return (async () => {
      for (const [o, ms] of pattern) {
        dark.style.transition = "none";
        dark.style.opacity = String(o);
        await wait(ms);
      }
      if (d.sfx.ready() && !reduce) d.sfx.heartbeat(0.55);
      stop();
    })();
  }

  function stop() {
    alive = false;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  return { escape, beginStart, select };
}
