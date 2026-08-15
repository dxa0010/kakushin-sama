
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
/* ============================================================
   確定申告からは逃げられない — prototype
   ============================================================ */
const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;

/* ---------- state ---------- */
let state = "TITLE";           // TITLE | PLAY | INSPECT | ETAX | END
let gameMin = 21 * 60;         // in-game minutes
let MIN_PER_SEC = 0.45;        // モードで変わる（白0.45 / 青0.55）
let phase = 1;
const flags = { n2130: false, n2200: false, n2300: false, tvAt: 21*60 + 50 + Math.random()*40, tvDone: false };

/* ---------- items ---------- */
const ITEMS = [
  { id: "shiharai", short: "支払調書",  x:  6.9, z: -5.4, y: 0.35,
    gag: "支払調書の束。1月に届いていた。開封すらしていなかった。" },
  { id: "iryohi",   short: "医療費",    x: -7.0, z:  4.5, y: 1.15,
    gag: "医療費のレシート束。一部、インクが消えて金額が読めない。" },
  { id: "mycard",   short: "マイナ",    x: -5.5, z: -4.4, y: 0.75,
    gag: "マイナンバーカード。電子証明書の有効期限……セーフ。あと2ヶ月だった。" },
  { id: "reader",   short: "リーダー",  x:  3.6, z:  5.35, y: 0.75,
    gag: "ICカードリーダー。テレビの裏に落ちていた。3年前に買って、使ったのは1回だけ。" },
  { id: "password", short: "パスワード", x:  7.0, z:  2.0, y: 1.55,
    gag: "e-Taxパスワードのメモ。『いつもの』と書いてある。どれだ。" },
];
const FAKE = { x: 2.5, z: 5.0, y: 0.35, taken: false,
  gag: "ふるさと納税の証明書……いや、これはワンストップ特例で提出済みだった。紙くずだ。" };
let got = 0;

/* ---------- 書類の中身と異変（真贋判定の核） ---------- */
const PLAYER_NAME = "三月 十五";
const DOCSPECS = {
  shiharai: { title: "支払調書", issuer: "株式会社ホワイト商事",
    rows: [["支払金額", "¥1,200,000"], ["源泉徴収税額", "¥122,526"], ["区分", "原稿料"]] },
  iryohi:   { title: "医療費のお知らせ", issuer: "全国健康保険協会",
    rows: [["医療費合計", "¥184,320"], ["対象期間", "1月〜12月"], ["受診回数", "14回"]] },
  mycard:   { title: "個人番号カード", issuer: "地方公共団体情報システム機構",
    rows: [["個人番号", "1234 5678 9012"], ["有効期限", "令和10年5月"], ["住所", "県道市町 1-2-3"]] },
  reader:   { title: "保証書", issuer: "ヨドバチカメラ",
    rows: [["品名", "ICカードリーダー"], ["型番", "CR-2026W"], ["購入金額", "¥2,980"]] },
  password: { title: "パスワード控え", issuer: "本人控え",
    rows: [["利用者識別番号", "1234 5678 9012 3456"], ["暗証番号", "＊＊＊＊＊＊＊＊"], ["メモ", "『いつもの』"]] },
};
const LOOKA = { 金: "全", 医: "圧", 番: "蕃", 期: "斯", 額: "顎", 号: "呂" };
const ANOMS = [
  // sub:true = 巧妙（青色申告で出やすい）。name は図鑑名
  { id: "era",    name: "存在しない年号",   reject: "年号が存在しません",
    apply: s => { s.era = Math.random() < 0.5 ? "令和∞年分" : "昭和107年分"; } },
  { id: "typo",   name: "入れ替わった題字", sub: true, reject: "書類の名称に誤りがあります",
    apply: s => { const t = [...s.title]; [t[0], t[1]] = [t[1], t[0]]; s.title = t.join(""); } },
  { id: "minus",  name: "負の金額",         reject: "金額が負の値になっています",
    can: d => d.rows.some(r => r[1].startsWith("¥")),
    apply: s => { const r = s.rows.find(r => r[1].startsWith("¥")); r[1] = "−" + r[1]; } },
  { id: "stamp",  name: "逆さの印",         sub: true, reject: "押印が逆さまです",
    apply: s => { s.stampFlip = true; } },
  { id: "name",   name: "一字ちがいの氏名", sub: true, reject: "氏名が申告者と一致しません",
    apply: s => { s.name = "三月 十六"; } },
  { id: "mirror", name: "鏡の書類",         reject: "書類全体が鏡文字です",
    apply: s => { s.mirror = true; } },
  { id: "issuer", name: "実在しない発行元", reject: "発行元が実在しません",
    apply: s => { s.issuer = "株式会社カクシン"; } },
  { id: "date",   name: "存在しない日付",   sub: true, reject: "発行日が存在しません",
    apply: s => { s.date = "令和8年2月30日"; } },
  { id: "soul",   name: "魂の対価",         reject: "金額が通貨ではありません",
    can: d => d.rows.some(r => r[1].startsWith("¥")),
    apply: s => { const r = s.rows.find(r => r[1].startsWith("¥")); r[1] = "魂"; } },
  { id: "four",   name: "四づくし",         reject: "数値がすべて4です",
    can: d => d.rows.some(r => /\d/.test(r[1])),
    apply: s => { s.rows.forEach(r => r[1] = r[1].replace(/\d/g, "4")); } },
  { id: "kami",   name: "名乗る書類",       reject: "氏名が人間ではありません",
    apply: s => { s.name = "カクシン様"; } },
  { id: "eye",    name: "見ている印",       reject: "印影が瞬きしました",
    apply: s => { s.stampEye = true; } },
  { id: "blur",   name: "濡れた文字",       reject: "書類が濡れています",
    apply: s => { s.blur = true; } },
  { id: "mark",   name: "透かしの顔",       sub: true, reject: "不正な透かしが検出されました",
    apply: s => { s.mark = true; } },
  { id: "ju",     name: "朱の呪",           reject: "確認できない印が押されています",
    apply: s => { s.ju = true; } },
  { id: "label",  name: "化けた項目名",     sub: true, reject: "項目名に誤りがあります",
    can: d => d.rows.some(r => [...r[0]].some(ch => LOOKA[ch])),
    apply: s => {
      const r = s.rows.find(r => [...r[0]].some(ch => LOOKA[ch]));
      const arr = [...r[0]], i = arr.findIndex(ch => LOOKA[ch]);
      arr[i] = LOOKA[arr[i]]; r[0] = arr.join("");
    } },
];
const anomName = id => (ANOMS.find(a => a.id === id) || {}).name || "？？？";

/* ---------- モード ---------- */
const MODES = {
  white: { label: "白色申告", forced: 2, p: 0.25, rp: 0.35, mps: 0.45, subtleW: 0.45, base: 34120, huntBonus: 0, visitEarly: 0 },
  blue:  { label: "青色申告", forced: 3, p: 0.5,  rp: 0.5,  mps: 0.55, subtleW: 0.75, base: 65480, huntBonus: 6, visitEarly: 4 },
};
let mode = "white";

/* ---------- セーブ（異変図鑑・エンディング記録・周回） ---------- */
const SAVE_KEY = "kakushin_save_v1";
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === "object")
      return Object.assign({ found: {}, endings: {}, runs: 0, bestRank: "" }, s);
  } catch (e) {}
  return { found: {}, endings: {}, runs: 0, bestRank: "" };
}
const save = loadSave();
function persistSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
const runLog = [];    // {short, fake, anomId, act, ok, revealed}
const newFound = [];
function registerFound(id) { if (id && !save.found[id]) { save.found[id] = true; newFound.push(id); } }

function makeCopy(it, p) {
  if (Math.random() >= p) return { fake: false, anom: null };
  const d = DOCSPECS[it.id];
  const ok = ANOMS.filter(a => !a.can || a.can(d));
  const subtle = ok.filter(a => a.sub), obvious = ok.filter(a => !a.sub);
  const pool = (Math.random() < MODES[mode].subtleW && subtle.length) ? subtle : obvious;
  return { fake: true, anom: pool[Math.floor(Math.random() * pool.length)] };
}
function assignCopies() {
  const order = [...ITEMS.keys()].sort(() => Math.random() - 0.5);
  ITEMS.forEach((it, i) => {
    it.copy = makeCopy(it, order.indexOf(i) < MODES[mode].forced ? 1 : MODES[mode].p);
  });
}
assignCopies();
function buildSpec(it) {
  const d = DOCSPECS[it.id];
  const s = { title: d.title, issuer: d.issuer, rows: d.rows.map(r => [...r]),
              era: "令和7年分", name: PLAYER_NAME, date: "令和8年1月31日",
              stampFlip: false, mirror: false };
  if (it.copy.fake) it.copy.anom.apply(s);
  return s;
}
function drawDoc(spec) {
  const cv = $("docCv"), c = cv.getContext("2d"), w = cv.width, h = cv.height;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.textBaseline = "alphabetic";
  c.fillStyle = "#ece7d8"; c.fillRect(0, 0, w, h);
  if (spec.mirror) { c.translate(w, 0); c.scale(-1, 1); }
  if (spec.blur) { c.shadowColor = "rgba(40,38,30,0.85)"; c.shadowBlur = 3.5; }
  if (spec.mark) {
    // 透かし：うっすらと、あの顔
    c.save();
    c.globalAlpha = 0.07; c.fillStyle = "#1a1815";
    c.fillRect(w/2 - 70, h/2 - 90, 140, 180);
    c.globalAlpha = 0.11; c.fillStyle = "#000";
    c.fillRect(w/2 - 45, h/2 - 40, 32, 24);
    c.fillRect(w/2 + 13, h/2 - 40, 32, 24);
    c.restore();
  }
  c.strokeStyle = "#8a8574"; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28);
  if (spec.ju) {
    c.save();
    c.translate(54, 54); c.rotate(-0.12);
    c.globalAlpha = 0.75; c.fillStyle = "#b23b2e";
    c.font = "34px serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("呪", 0, 0);
    c.restore();
  }
  c.fillStyle = "#22201c"; c.textAlign = "center";
  c.font = "600 32px 'Hiragino Mincho ProN','Yu Mincho',serif";
  c.fillText(spec.title, w / 2, 78);
  c.textAlign = "right"; c.font = "15px sans-serif"; c.fillStyle = "#4a463c";
  c.fillText(spec.era, w - 28, 44);
  c.textAlign = "left"; c.strokeStyle = "#9a9484"; c.lineWidth = 1;
  c.strokeRect(26, 106, w - 52, 46);
  c.font = "14px sans-serif"; c.fillStyle = "#5a564a"; c.fillText("氏名", 38, 134);
  c.font = "21px 'Hiragino Mincho ProN','Yu Mincho',serif"; c.fillStyle = "#22201c";
  c.fillText(spec.name, 120, 136);
  spec.rows.forEach((r, i) => {
    const y = 172 + i * 60;
    c.strokeRect(26, y, w - 52, 48);
    c.font = "13px sans-serif"; c.fillStyle = "#5a564a"; c.fillText(r[0], 38, y + 29);
    c.font = "17px ui-monospace,monospace"; c.fillStyle = "#22201c";
    c.textAlign = "right"; c.fillText(r[1], w - 40, y + 31); c.textAlign = "left";
  });
  c.font = "14px sans-serif"; c.fillStyle = "#3c3930";
  c.fillText("発行：" + spec.issuer, 30, h - 68);
  c.fillText(spec.date, 30, h - 38);
  c.save();
  c.translate(w - 80, h - 78);
  if (spec.stampFlip) c.rotate(Math.PI);
  c.globalAlpha = 0.85; c.strokeStyle = "#b23b2e"; c.lineWidth = 2.4;
  c.beginPath(); c.arc(0, 0, 30, 0, Math.PI * 2); c.stroke();
  if (spec.stampEye) {
    c.fillStyle = "#f4f0e6";
    c.beginPath(); c.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1a1815";
    c.beginPath(); c.arc(0, 0, 4.5, 0, Math.PI * 2); c.fill();
  } else {
    c.fillStyle = "#b23b2e"; c.font = "26px serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("印", 0, 2);
  }
  c.restore();
  c.restore();
}
/* 差し戻し・破棄後の再出現ポイント */
const SPOTS = [
  [6.9, -5.4, 0.35], [-7.0, 4.5, 1.15], [-5.5, -4.4, 0.75], [3.6, 5.35, 0.75], [7.0, 2.0, 1.55],
  [2.7, 2.2, 0.95], [-6.8, -1.0, 0.35], [1.2, -5.5, 0.4], [-3.5, 5.4, 0.4], [5.8, 4.8, 0.6], [-7.2, 2.2, 1.2],
];
function relocateItem(it) {
  const others = ITEMS.filter(o => o !== it && !o.taken);
  const cands = SPOTS.filter(([x, z]) =>
    Math.hypot(x - ply.x, z - ply.z) > 4 &&
    Math.hypot(x - it.x, z - it.z) > 1.5 &&
    others.every(o => Math.hypot(x - o.x, z - o.z) > 0.8));
  const pool = cands.length ? cands : SPOTS;
  const [x, z, y] = pool[Math.floor(Math.random() * pool.length)];
  it.x = x; it.z = z; it.y = y;
  const m = itemMeshes[it.id];
  m.position.set(x, y + 0.35, z); m.visible = true;
}

/* ---------- three basics ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050507);
scene.fog = new THREE.Fog(0x050507, 6, 17);
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 50);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
$("app").appendChild(renderer.domElement);
const MAXANISO = renderer.capabilities.getMaxAnisotropy();

/* 環境マップ（金属・光沢面の反射用、ごく弱く） */
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;
}

/* ---------- post-processing ---------- */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    res: { value: new THREE.Vector2(innerWidth, innerHeight) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 res;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float ca = 0.006 * dot(d, d);           // 端にいくほど色収差
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ca).b;
      float v = smoothstep(0.95, 0.30, length(d) * 1.15);   // ビネット
      col *= mix(0.42, 1.0, v);
      float g = fract(sin(dot(uv * res + mod(time, 97.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.028;                // フィルムグレイン
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// strength 0.28 / threshold 0.9：しきい値を上げて「明るい白い面（寝具・紙・時計盤）」が滲むのを防ぎ、
// 発光体（アイテムの光球・照明器具）だけを控えめに光らせる。
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.55, 0.9);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const filmPass = new ShaderPass(FilmShader);
composer.addPass(filmPass);

addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  filmPass.uniforms.res.value.set(innerWidth, innerHeight);
});

/* ---------- procedural textures ---------- */
function makeTex(w, h, fn, rx = 1, ry = 1) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  fn(cv.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAXANISO;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
function speckle(c, w, h, n, col, aMax) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(${col},${(Math.random() * aMax).toFixed(3)})`;
    c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
const floorTex = makeTex(256, 256, (c, w, h) => {
  c.fillStyle = "#54402c"; c.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) {
    const y = r * 64;
    c.fillStyle = `rgb(${78 + Math.random() * 20 | 0},${58 + Math.random() * 14 | 0},${38 + Math.random() * 10 | 0})`;
    c.fillRect(0, y + 2, w, 61);
    for (let i = 0; i < 22; i++) {
      c.strokeStyle = `rgba(38,26,14,${0.06 + Math.random() * 0.12})`;
      c.lineWidth = 0.8;
      const gy = y + 4 + Math.random() * 56;
      c.beginPath(); c.moveTo(0, gy);
      c.bezierCurveTo(w * 0.3, gy + (Math.random() - 0.5) * 5, w * 0.7, gy + (Math.random() - 0.5) * 5, w, gy);
      c.stroke();
    }
    c.fillStyle = "rgba(18,10,5,0.85)"; c.fillRect(0, y, w, 2);
    c.fillRect(Math.random() * w | 0, y, 2, 64);
  }
  speckle(c, w, h, 300, "20,12,6", 0.15);
}, 5, 4);
const ceilTex = makeTex(128, 128, (c, w, h) => {
  c.fillStyle = "#45423c"; c.fillRect(0, 0, w, h);
  speckle(c, w, h, 500, "20,18,16", 0.1);
}, 4, 3);
const woodTex = makeTex(128, 128, (c, w, h) => {
  c.fillStyle = "#4d3e2c"; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    c.strokeStyle = `rgba(30,20,10,${0.1 + Math.random() * 0.15})`;
    c.lineWidth = 0.8 + Math.random();
    const x = Math.random() * w;
    c.beginPath(); c.moveTo(x, 0);
    c.bezierCurveTo(x + (Math.random() - 0.5) * 8, h * 0.3, x + (Math.random() - 0.5) * 8, h * 0.7, x, h);
    c.stroke();
  }
}, 1, 1);
const nightTex = makeTex(512, 256, (c, w, h) => {
  // 夜空のグラデーション（天頂は濃紺、地平は街明かりで温かく霞む）
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#070c1c"); g.addColorStop(0.6, "#111a30"); g.addColorStop(1, "#2a2f42");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // 星（小さな点を散らす。地平付近は街明かりに負けるので上空のみ）
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * w, y = Math.random() * h * 0.5;
    c.fillStyle = `rgba(255,255,240,${0.2 + Math.random() * 0.6})`;
    const s = Math.random() < 0.15 ? 2 : 1;
    c.fillRect(x, y, s, s);
  }
  // 月＋淡いハロー（月明かりのにじみ）
  const mx = w * 0.72, my = h * 0.24, mr = 20;
  const halo = c.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2);
  halo.addColorStop(0, "rgba(230,226,205,0.35)"); halo.addColorStop(1, "rgba(230,226,205,0)");
  c.fillStyle = halo; c.beginPath(); c.arc(mx, my, mr * 3.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#e8e4d0"; c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#0c1225"; c.beginPath(); c.arc(mx + mr * 0.32, my - mr * 0.28, mr * 0.86, 0, Math.PI * 2); c.fill();
  // 遠景ビル（3層に分け、奥ほど暗く霞ませて奥行きを出す）
  const layers = [
    { col: "#0c1424", top: 0.50, alpha: 0.7, step: 46, jitH: 34, jitW: 30 },
    { col: "#0a1120", top: 0.58, alpha: 0.85, step: 38, jitH: 40, jitW: 24 },
    { col: "#06090f", top: 0.66, alpha: 1.0, step: 30, jitH: 48, jitW: 18 },
  ];
  for (const L of layers) {
    c.globalAlpha = L.alpha; c.fillStyle = L.col;
    for (let x = -10; x < w + 10; x += L.step) {
      const bh = h * (1 - L.top) + Math.random() * L.jitH;
      const bw = 16 + Math.random() * L.jitW;
      c.fillRect(x, h - bh, bw, bh + 5);
    }
  }
  c.globalAlpha = 1;
  // 窓明かり（最前面ビルの帯に格子状の点。色と明るさをばらけさせる）
  // ブルームで白い玉に膨らまないよう最大輝度を抑える。
  for (let i = 0; i < 150; i++) {
    const warm = Math.random() < 0.75;
    const a = 0.15 + Math.random() * 0.30;
    c.fillStyle = warm ? `rgba(200,168,96,${a})` : `rgba(130,158,200,${a})`;
    const x = Math.floor(Math.random() * w / 7) * 7 + 2;
    const y = h * 0.62 + Math.random() * h * 0.36;
    c.fillRect(x, y, 3, 2);
  }
});
const aoTex = makeTex(128, 128, (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});

/* ---------- 法線マップ（プロシージャルテクスチャの輝度から生成） ---------- */
function normalFromTex(srcTex, strength = 1.2) {
  const img = srcTex.image;
  const w = img.width, h = img.height;
  const data = img.getContext("2d").getImageData(0, 0, w, h).data;
  const lum = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
  };
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d");
  const out = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (lum(x+1, y) - lum(x-1, y)) * strength;
    const dy = (lum(x, y+1) - lum(x, y-1)) * strength;
    const nz = 1 / Math.sqrt(dx*dx + dy*dy + 1);
    const i = (y * w + x) * 4;
    out.data[i]   = (-dx * nz * 0.5 + 0.5) * 255;
    out.data[i+1] = (-dy * nz * 0.5 + 0.5) * 255;
    out.data[i+2] = nz * 255;
    out.data[i+3] = 255;
  }
  c.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = MAXANISO;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.copy(srcTex.repeat);
  return t;
}

/* ---------- 実写テクスチャ（three.js examples / ambientCG, MIT / CC0） ---------- */
const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb, rx, ry) {
  const t = texLoader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAXANISO;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
// diffuse/normal/roughness の3枚組を一括ロード（ambientCG命名規則: {name}_{diffuse,normal,roughness}.jpg）
function loadPBRSet(baseName, rx, ry) {
  return {
    map:          loadTex(`./assets/textures/${baseName}_diffuse.jpg`, true, rx, ry),
    normalMap:    loadTex(`./assets/textures/${baseName}_normal.jpg`, false, rx, ry),
    roughnessMap: loadTex(`./assets/textures/${baseName}_roughness.jpg`, false, rx, ry),
  };
}

/* ---------- materials (PBR) ---------- */
const M = {
  wall:   new THREE.MeshStandardMaterial({
    ...loadPBRSet("plaster017", 4.6, 1.8),
    color: 0x8a8578, roughness: 0.92,
  }),
  floor:  new THREE.MeshStandardMaterial({
    map: loadTex("./assets/textures/hardwood2_diffuse.jpg", true, 3.2, 4.4),
    bumpMap: loadTex("./assets/textures/hardwood2_bump.jpg", false, 3.2, 4.4),
    roughnessMap: loadTex("./assets/textures/hardwood2_roughness.jpg", false, 3.2, 4.4),
    color: 0x726b62, bumpScale: 0.9, roughness: 0.84, metalness: 0.0,   // グレイッシュな茶（彩度を落とした板色）
  }),
  ceil:   new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.96 }),
  wood:   new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalFromTex(woodTex, 1.4), roughness: 0.58 }),
  woodDark: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a8378, roughness: 0.6 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x2e2a33, roughness: 0.78 }),
  fabric: new THREE.MeshStandardMaterial({
    ...loadPBRSet("fabric001", 1.6, 1.6),
    color: 0x4a4762, roughness: 0.95,
  }),
  white:  new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.85 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.32, metalness: 0.85 }),
  paper:  new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.95 }),
  tv:     new THREE.MeshStandardMaterial({ color: 0x101216, emissive: 0x000000, roughness: 0.22, metalness: 0.4 }),
  suit:   new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.82 }),
  /* --- 家具統一パレット（2020年代の賃貸・量産家具で統一） --- */
  oak:      new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalFromTex(woodTex, 1.1), color: 0xc8a97e, roughness: 0.62 }),  // 主材: ライトオーク
  oakDark:  new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalFromTex(woodTex, 1.1), color: 0x8a6a4a, roughness: 0.66 }),  // 縁・脚まわりの濃い木口
  steel:    new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.75 }),  // 黒スチール脚（量産家具の定番）
  melamine: new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.55 }),                   // 白メラミン化粧板
  mattress: new THREE.MeshStandardMaterial({ color: 0xd6d0c0, roughness: 0.92 }),                   // マットレス・枕の生成り
  sheet:    new THREE.MeshStandardMaterial({ color: 0xcfc7b6, roughness: 0.9 }),                    // 敷きシーツ（少しグレイッシュ）
  blanket:  new THREE.MeshStandardMaterial({
    ...loadPBRSet("fabric001", 1.2, 1.2),
    color: 0xa89478, roughness: 0.96,                                                               // 掛け布団: くすんだオートミール茶（白いシーツと差をつけつつ暗すぎない）
  }),
  pillow:   new THREE.MeshStandardMaterial({ color: 0xe4ddcc, roughness: 0.9 }),                    // 枕（マットレスより明るい白）
  /* --- 机まわり専用（高精細化用） --- */
  plastic:  new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5, metalness: 0.05 }),   // 家電の樹脂（モニタ枠・キーボード土台）
  keycap:   new THREE.MeshStandardMaterial({ color: 0x35373d, roughness: 0.62 }),                   // キーキャップ（土台よりわずかに明るいグレー）
  screen:   new THREE.MeshStandardMaterial({ color: 0x0b0e14, emissive: 0x3a5f96, emissiveIntensity: 1.7, roughness: 0.5, metalness: 0.0 }),  // 液晶面（青白くはっきり点灯。机の主光源。つや消しで映り込みの白点を抑える）
  ceramic:  new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.35, metalness: 0.0 }),   // マグカップの陶器（少しつや）
  penBody:  new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.55 }),                   // ペン軸
  lampShade:new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.6, metalness: 0.2 }),    // デスクライトの傘（黒）
  lampArm:  new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.4, metalness: 0.6 }),    // アーム
  form:     new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.96 }),                   // 確定申告フォーム用紙（白めのオフホワイト）
  formInk:  new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.9 }),                    // 用紙の印字（薄い罫線・文字塊）
  /* --- 新規PBRテクスチャ（バリエーション拡充: metal063/fabric049/cardboard001/plastic011/concrete034/leather030） --- */
  rustMetal: new THREE.MeshStandardMaterial({ ...loadPBRSet("metal063", 1, 1), color: 0x9a9088, roughness: 0.7, metalness: 0.85 }),  // 汚れた鋼（フレーム・家電・刃物）
  workCloth: new THREE.MeshStandardMaterial({ ...loadPBRSet("fabric049", 1.4, 2.2), color: 0x3a3f33, roughness: 0.92 }),             // 作業着（暗いオリーブ黒）
  cardboard: new THREE.MeshStandardMaterial({ ...loadPBRSet("cardboard001", 1, 1), color: 0xb8a284, roughness: 0.95 }),             // 段ボール・古紙
  greyPlastic: new THREE.MeshStandardMaterial({ ...loadPBRSet("plastic011", 1, 1), color: 0x2a2c30, roughness: 0.5 }),              // 家電の樹脂（ざらつき）
  leatherBook: new THREE.MeshStandardMaterial({ ...loadPBRSet("leather030", 0.5, 0.5), color: 0x5a3d2a, roughness: 0.7 }),          // 革装丁の本・椅子
  concrete:  new THREE.MeshStandardMaterial({ ...loadPBRSet("concrete034", 2, 2), color: 0x8a8680, roughness: 0.95 }),              // コンクリート（アクセント）
};
// 背表紙：くすんだ布・革装丁の色（ホラーの暗い室内で浮かない、彩度低め・暗め）
const bookMats = [0x5a3730, 0x33455a, 0x3d5240, 0x5a4a28, 0x39344f, 0x6b5636,
                  0x4a2a2a, 0x2e3a3a, 0x6a6258, 0x453040]
  .map(cc => new THREE.MeshStandardMaterial({ color: cc, roughness: 0.86 }));
// 小口（ページ束）の生成り。背表紙より内側に一段引っ込ませて見せる
const pageMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.95 });

/* ---------- room geometry ---------- */
const walls = [];   // collision AABBs {x1,z1,x2,z2}
const solids = [];  // furniture collision
function box(x1, z1, x2, z2, h, mat, y0 = 0, coll = walls) {
  const g = new THREE.BoxGeometry(x2-x1, h, z2-z1);
  const m = new THREE.Mesh(g, mat);
  m.position.set((x1+x2)/2, y0 + h/2, (z1+z2)/2);
  scene.add(m);
  if (coll) coll.push({ x1, z1, x2, z2 });
  return m;
}
/* 視覚専用ヘルパー（当たり判定なし） */
function vbox(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m); return m;
}
function vcyl(rt, rb, h, mat, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); scene.add(m); return m;
}
function aoPatch(x, z, w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  scene.add(m); return m;
}

/* ---------- 高精細プロシージャル家具用ヘルパー ---------- */
// 角丸ボックス（面取り・エッジの丸みが v6 の素の BoxGeometry との一番の違い）
function rbox(w, h, d, mat, x, y, z, ry = 0, r = 0.02, seg = 3) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m); return m;
}
// テーパー付き丸脚（家具の脚。下がわずかに細い）
function tleg(rt, rb, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat);
  m.position.set(x, y, z); scene.add(m); return m;
}
// 引き出し前板（本体からわずかに浮かせ、周囲に目地の影を作る）
function drawer(w, h, mat, x, y, z, knobMat = M.steel) {
  rbox(w, h, 0.024, mat, x, y, z, 0, 0.008, 2);
  const k = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 10), knobMat);
  k.rotation.x = Math.PI / 2;
  k.position.set(x, y, z + 0.028); scene.add(k);
}
// floor & ceiling
{
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(17, 13), M.floor);
  fl.rotation.x = -Math.PI/2; scene.add(fl);
  const gk = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.7),
    new THREE.MeshLambertMaterial({ color: 0x393c41 }));
  gk.rotation.x = -Math.PI/2; gk.position.set(6.55, 0.008, -5.25); scene.add(gk); // 玄関たたき
  vbox(2.7, 0.07, 0.1, M.woodDark, 6.55, 0.035, -4.44);                           // 上がり框
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(17, 13), M.ceil);
  ce.rotation.x = Math.PI/2; ce.position.y = 2.8; scene.add(ce);
}
// outer walls
box(-8.3, -6.3,  8.3, -6.0, 2.8, M.wall);
box(-8.3,  6.0,  8.3,  6.3, 2.8, M.wall);
box(-8.3, -6.0, -8.0,  6.0, 2.8, M.wall);
box( 8.0, -6.0,  8.3,  6.0, 2.8, M.wall);
// center wall (2 door gaps)
box(-0.15, -6.0, 0.15, -3.5, 2.8, M.wall);
box(-0.15, -2.0, 0.15,  2.0, 2.8, M.wall);
box(-0.15,  3.5, 0.15,  6.0, 2.8, M.wall);
// bedroom/kitchen divider (door gap x -2.5..-1)
box(-8.0, -0.15, -2.5, 0.15, 2.8, M.wall);
box(-1.0, -0.15,  0.0, 0.15, 2.8, M.wall);
// 玄関 nook wall
box(4.85, -6.0, 5.15, -4.4, 2.8, M.wall);

/* 巾木・鴨居 */
vbox(15.9, 0.1, 0.05, M.woodDark, 0, 0.05, -5.97);
vbox(15.9, 0.1, 0.05, M.woodDark, 0, 0.05, 5.97);
vbox(0.05, 0.1, 11.9, M.woodDark, -7.97, 0.05, 0);
vbox(0.05, 0.1, 11.9, M.woodDark, 7.97, 0.05, 0);
vbox(0.34, 0.12, 1.56, M.woodDark, 0, 2.06, -2.75);   // 中央壁のドア開口
vbox(0.34, 0.12, 1.56, M.woodDark, 0, 2.06, 2.75);
vbox(1.56, 0.12, 0.34, M.woodDark, -1.75, 2.06, 0);   // 寝室・台所の間

/* ---------- 家具（当たり判定は従来のAABBを維持） ---------- */
// ベッド（実写PBRの金属フレーム＋乱れた寝具）
{
  solids.push({ x1: -7.5, z1: -5.75, x2: -5.6, z2: -3.7 });
  aoPatch(-6.55, -4.7, 2.2, 2.3);
  // ロータイプの木製プラットフォームベッド（脚・フレーム・ヘッドボード・すのこ縁）
  [[-6.98, -5.55], [-6.12, -5.55], [-6.98, -3.85], [-6.12, -3.85]].forEach(([x, z]) =>
    tleg(0.035, 0.028, 0.18, M.steel, x, 0.09, z));
  rbox(0.98, 0.14, 1.96, M.oak, -6.55, 0.25, -4.7, 0, 0.025);            // フレーム
  rbox(0.9, 0.04, 1.88, M.oakDark, -6.55, 0.335, -4.7, 0, 0.012);        // すのこ天端
  // ヘッドボード（面取りパネル＋縦framing＋笠木で厚みを出す）
  rbox(0.98, 0.58, 0.07, M.oak, -6.55, 0.55, -5.66, 0, 0.02);            // ヘッドボード本体
  rbox(0.86, 0.42, 0.02, M.oakDark, -6.55, 0.55, -5.61, 0, 0.012);       // 中央の落とし込みパネル
  [-0.44, 0.44].forEach(zx => vbox(0.06, 0.58, 0.05, M.oak, -6.55 + zx, 0.55, -5.64));  // 縦フレーム
  rbox(1.0, 0.06, 0.05, M.oakDark, -6.55, 0.85, -5.64, 0, 0.014);        // 笠木
  // 寝具（角丸で柔らかく。素材ごとに色を分けて“のっぺり白い塊”を回避）
  rbox(0.88, 0.18, 1.84, M.mattress, -6.55, 0.44, -4.7, 0, 0.06, 5);     // マットレス（面取り大きめ＝弾力感）
  rbox(0.86, 0.03, 1.82, M.sheet, -6.55, 0.54, -4.7, 0, 0.03, 3);        // 敷きシーツ（マットレス上端を覆う）
  // 掛け布団：ふくらんだ本体＋キルトの縫い目＋足側でめくれた層＋折り返した端
  const duvet = rbox(0.86, 0.2, 1.16, M.blanket, -6.55, 0.62, -4.2, 0.015, 0.09, 5);  // 本体（厚くふくらむ）
  // キルトの縫い目（浅い溝を格子状に。掛け布団上面のすぐ下へ細い暗strip）
  for (let qz = -0.42; qz <= 0.42; qz += 0.28)
    vbox(0.82, 0.006, 0.012, M.oakDark, -6.55, 0.715, -4.2 + qz);        // 横の縫い目
  for (let qx = -0.28; qx <= 0.28; qx += 0.28)
    vbox(0.012, 0.006, 1.08, M.oakDark, -6.55 + qx, 0.715, -4.2);        // 縦の縫い目
  rbox(0.82, 0.14, 0.46, M.blanket, -6.52, 0.68, -3.86, -0.06, 0.07, 5); // 足元でめくれてふくらむ層
  // 頭側で折り返した掛け布団の端（裏地＝シーツ色が見える）
  const foldBack = rbox(0.86, 0.06, 0.3, M.sheet, -6.55, 0.7, -4.86, 0.08, 0.04, 4);
  foldBack.rotation.x = -0.15;
  // 足側で床方向へ垂れる布の端（両サイド）
  const flap = rbox(0.28, 0.5, 0.12, M.blanket, -6.02, 0.34, -3.9, 0, 0.06, 5);
  flap.rotation.z = 0.16;
  const flap2 = rbox(0.22, 0.4, 0.1, M.blanket, -7.04, 0.36, -4.05, 0, 0.05, 5);
  flap2.rotation.z = -0.13;
  // 枕2つ（ヘッドボード際、少しずらして重ねる。中央にへこみ＝使用感）
  const pil1 = rbox(0.62, 0.14, 0.36, M.pillow, -6.4, 0.62, -5.28, 0.1, 0.08, 5);
  const pil2 = rbox(0.56, 0.12, 0.32, M.pillow, -6.74, 0.6, -5.24, -0.16, 0.07, 5);
  [pil1, pil2].forEach(p => p.scale.y = 0.9);                            // 少しつぶれた枕
  // 枕の中央のへこみ（暗い薄box）
  vbox(0.28, 0.01, 0.14, M.sheet, -6.4, 0.66, -5.28, 0.1);
}
// キッチン（白メラミンの量産ユニット。扉・目地・バー取っ手・蛇口・五徳まで）
{
  solids.push({ x1: -7.9, z1: 1.2, x2: -6.2, z2: 5.6 });
  vbox(1.6, 0.82, 4.3, M.melamine, -7.07, 0.45, 3.4);                    // 本体
  vbox(1.56, 0.08, 4.26, M.dark, -7.07, 0.04, 3.4);                       // 台輪（蹴込み）
  rbox(1.7, 0.05, 4.42, M.metal, -7.07, 0.885, 3.4, 0, 0.015);            // ステンレス天板
  // 前面の扉4枚（目地の影＋縦バー取っ手）
  [[2.05, 0.98], [3.05, 0.98], [4.0, 0.88], [4.9, 0.88]].forEach(([z, w]) => {
    rbox(0.025, 0.68, w, M.melamine, -6.245, 0.48, z, 0, 0.008, 2);
    vbox(0.025, 0.3, 0.022, M.steel, -6.228, 0.62, z - w / 2 + 0.07);
  });
  // シンク（凹み＋縁）
  vbox(0.85, 0.025, 1.05, new THREE.MeshLambertMaterial({ color: 0x24272b }), -7.05, 0.9, 4.35);
  rbox(0.91, 0.02, 1.11, M.metal, -7.05, 0.906, 4.35, 0, 0.008, 2);
  // 蛇口（立ち上がり＋曲がり首＋吐水口＋ハンドル）
  vcyl(0.024, 0.028, 0.26, M.metal, -7.5, 1.03, 4.35, 12);
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 10, 16, Math.PI / 2), M.metal);
  neck.position.set(-7.5, 1.16, 4.35); neck.rotation.y = Math.PI / 2; scene.add(neck);
  vcyl(0.02, 0.014, 0.06, M.metal, -7.41, 1.19, 4.35, 10);               // 吐水口
  vbox(0.1, 0.022, 0.03, M.steel, -7.5, 1.045, 4.26);                    // レバーハンドル
  // 2口コンロ（バーナーリング＋五徳＋前面ツマミ）
  [2.25, 2.85].forEach((z) => {
    vcyl(0.15, 0.15, 0.028, M.dark, -7.05, 0.925, z, 18);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 20), M.steel);
    ring.position.set(-7.05, 0.945, z); ring.rotation.x = Math.PI / 2; scene.add(ring);
    for (let a = 0; a < 4; a++)
      vbox(0.2, 0.012, 0.018, M.dark, -7.05, 0.948, z, a * Math.PI / 4);
    vcyl(0.022, 0.026, 0.035, M.dark, -6.235, 0.78, z + 0.1, 10).rotation.z = Math.PI / 2;  // ツマミ
  });

  /* ===== 高精細化: バックスプラッシュ・レンジフード・吊戸棚・ケトル・水切りかご・生活雑貨 ===== */
  // --- タイルのバックスプラッシュ（白サブウェイタイル＋目地をキャンバスで生成） ---
  const tcv = document.createElement("canvas");
  tcv.width = 128; tcv.height = 128;
  const tc = tcv.getContext("2d");
  tc.fillStyle = "#c9c4b8"; tc.fillRect(0, 0, 128, 128);              // 目地（グレー）
  tc.fillStyle = "#e6e2d8";                                          // タイル（オフホワイト）
  const th = 32, tw = 64;
  for (let row = 0; row * th < 128; row++) {
    const off = (row % 2) * (tw / 2);                               // レンガ積み（半枚ずらし）
    for (let cxp = -tw; cxp < 128 + tw; cxp += tw) {
      tc.fillRect(cxp + off + 1.5, row * th + 1.5, tw - 3, th - 3);
    }
  }
  const tileTex = new THREE.CanvasTexture(tcv);
  tileTex.colorSpace = THREE.SRGBColorSpace;
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(8, 2.4);
  const tileMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.45, metalness: 0.0 });
  // 壁(x≈-7.9)の内側に薄板を立てる。天板(0.885)から高さ0.62、カウンタ長手方向(z)に沿わせる
  const splash = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.62), tileMat);
  splash.position.set(-7.88, 1.2, 3.4); splash.rotation.y = Math.PI / 2; scene.add(splash);

  // --- レンジフード（コンロ z≈2.55 の上。ステンレスの台形フード＋底面＋前縁） ---
  // 環境マップが無い暗室では高metalが黒く沈むため、metalnessを抑えて拡散光を拾わせる
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0xc4c7cb, roughness: 0.5, metalness: 0.25 });
  // 傾いた前面パネル（下広がり）。壁寄せしてやや小型化
  const hoodFront = rbox(0.42, 0.24, 0.88, hoodMat, -7.42, 1.7, 2.55, 0, 0.01, 2);
  hoodFront.rotation.z = 0.5;                                        // 手前下がりに傾ける
  vbox(0.5, 0.36, 0.9, hoodMat, -7.66, 1.98, 2.55);                 // フード上部の箱
  vbox(0.56, 0.05, 0.92, new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.7 }), -7.62, 1.55, 2.55);  // 底面（吸込口）
  vcyl(0.05, 0.05, 0.05, M.dark, -7.62, 1.54, 2.55, 12).rotation.x = Math.PI / 2;  // 照明/ファンの丸

  // --- 吊戸棚（シンク側 z≈4.6 の上。白い扉2枚＋バー取っ手） ---
  vbox(0.42, 0.62, 1.3, M.melamine, -7.66, 1.95, 4.55);             // 箱
  [[4.9, 4.98], [4.22, 4.3]].forEach(([hinge, hz]) => {
    vbox(0.02, 0.56, 0.62, M.melamine, -7.44, 1.95, hz, 0.02);     // 扉
  });
  vbox(0.02, 0.24, 0.02, M.steel, -7.43, 1.78, 4.35);              // 取っ手
  vbox(0.02, 0.24, 0.02, M.steel, -7.43, 1.78, 4.75);

  // --- ケトル（奥バーナー z=2.85。丸い胴＋注ぎ口＋ハンドル＋つまみ） ---
  const kettle = vcyl(0.11, 0.13, 0.17, M.metal, -7.05, 1.02, 2.85, 16);
  vcyl(0.115, 0.09, 0.05, M.metal, -7.05, 1.13, 2.85, 16);          // 肩
  vcyl(0.04, 0.05, 0.03, M.dark, -7.05, 1.18, 2.85, 12);           // 蓋つまみ
  const spout = vcyl(0.018, 0.032, 0.14, M.metal, -6.9, 1.08, 2.85, 10);  // 注ぎ口
  spout.rotation.z = -0.7;
  const kHandle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 8, 16, Math.PI), M.dark);
  kHandle.position.set(-7.05, 1.2, 2.85); kHandle.rotation.x = Math.PI / 2; scene.add(kHandle);

  // --- 水切りかご（シンク手前 z≈3.55。ワイヤー枠＋皿2枚を立てる＋伏せマグ） ---
  const wire = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.6 });
  vbox(0.34, 0.02, 0.5, wire, -7.05, 0.905, 3.55);                 // 受け皿
  // 側面ワイヤー（細い縦桟を数本）
  for (let i = -2; i <= 2; i++) vbox(0.012, 0.14, 0.012, wire, -7.05 + i * 0.07, 0.98, 3.32);
  for (let i = -2; i <= 2; i++) vbox(0.012, 0.14, 0.012, wire, -7.05 + i * 0.07, 0.98, 3.78);
  // 立てた皿2枚（薄い円盤を縦に）
  [3.48, 3.62].forEach((pz, i) => {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 20), M.ceramic);
    plate.position.set(-7.05, 1.02, pz); plate.rotation.x = 0.05 + i * 0.02; scene.add(plate);
  });
  // 伏せたマグ
  vcyl(0.045, 0.05, 0.09, M.ceramic, -6.9, 0.95, 3.55, 14);

  // --- 生活雑貨: 食器用洗剤ボトル＋スポンジ（シンク左）、まな板（立てかけ） ---
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0x2f7d55, roughness: 0.4, metalness: 0.0 });  // 緑の洗剤
  vcyl(0.032, 0.038, 0.17, bottleMat, -7.2, 0.99, 4.85, 12);        // ボトル胴
  vcyl(0.014, 0.018, 0.05, M.dark, -7.2, 1.11, 4.85, 8);          // ノズル
  vbox(0.09, 0.05, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8c24a, roughness: 0.95 }), -6.95, 0.93, 4.7);  // 黄色いスポンジ
  const board = rbox(0.32, 0.02, 0.24, M.oak, -7.78, 1.06, 4.9, 0, 0.006, 2);  // まな板（壁際に立てかけ）
  board.rotation.z = Math.PI / 2 - 0.12; board.rotation.y = 0.1;
}
// クローゼット（開き戸が、少しだけ開いている）
{
  solids.push({ x1: -2.6, z1: -5.9, x2: -0.6, z2: -5.0 });
  aoPatch(-1.6, -5.15, 2.4, 1.3);
  vbox(2.0, 2.2, 0.86, new THREE.MeshLambertMaterial({ color: 0x14120f }), -1.6, 1.1, -5.46);
  vbox(0.94, 1.98, 0.04, M.white, -2.1, 1.06, -4.99);
  vbox(0.94, 1.98, 0.04, M.white, -1.02, 1.06, -4.96, -0.3);   // 右扉は少しだけ開く（闇のスリット＝不穏）
  vbox(0.03, 0.16, 0.03, M.metal, -1.68, 1.06, -4.98);   // 取っ手
  vbox(0.03, 0.16, 0.03, M.metal, -1.30, 1.06, -4.82, -0.3);
  vbox(2.06, 0.1, 0.12, M.woodDark, -1.6, 2.2, -4.98);
  vbox(2.06, 0.05, 0.12, M.woodDark, -1.6, 0.028, -4.98);

  /* ===== 高精細化: 扉の彫り込み＋開いた扉から覗く内部（ハンガーの服・棚・靴） ===== */
  // 扉の落とし込みパネル（一段暗い矩形を少し手前に）で平板さを解消
  vbox(0.72, 1.62, 0.012, new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 0.85 }), -2.1, 1.06, -4.968);
  const rp = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.62, 0.012), new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 0.85 }));
  rp.position.set(-1.02, 1.06, -4.94); rp.rotation.y = -0.3; scene.add(rp);
  // 内部をごく薄く照らす弱い暖色光（スリットの奥に服/棚の存在が滲む程度）。強度・範囲とも最小
  const closetGlow = new THREE.PointLight(0xffe0b0, 0.015 * 34, 1.4, 2.6);
  closetGlow.position.set(-1.55, 1.5, -5.2); closetGlow.castShadow = false; scene.add(closetGlow);
  // 内部は decorative のみ（solids には積まない＝隠れる動作を邪魔しない）
  // ハンガーレール（左右に渡した金属パイプ）
  const rail = vcyl(0.012, 0.012, 1.5, M.metal, -1.6, 1.72, -5.3, 10);
  rail.rotation.z = Math.PI / 2;
  // 服（ハンガー＋ミュートカラーの上着）を数着、少し間隔をあけて吊るす
  const coatCols = [0x3b4652, 0x5a4636, 0x2f3a34, 0x4a3f4f, 0x6a6258];
  coatCols.forEach((cc, i) => {
    const hx = -2.2 + i * 0.3;
    // ハンガーのフック
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI), M.metal);
    hook.position.set(hx, 1.74, -5.3); scene.add(hook);
    // 肩バー
    vbox(0.2, 0.01, 0.012, M.dark, hx, 1.68, -5.3);
    // 上着本体（肩から裾へ、わずかに広がる布）
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 8, 1, false, 0, Math.PI * 2),
      new THREE.MeshStandardMaterial({ color: cc, roughness: 0.9 }));
    coat.position.set(hx, 1.34, -5.32); coat.scale.z = 0.5;   // 前後に薄く
    scene.add(coat);
  });
  // 上段の棚＋畳んだ毛布/箱
  vbox(1.7, 0.03, 0.7, M.woodDark, -1.6, 1.98, -5.3);              // 棚板
  vbox(0.6, 0.16, 0.42, new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 0.95 }), -1.9, 2.08, -5.3);  // 畳んだ毛布
  vbox(0.5, 0.28, 0.4, M.cardboard, -1.15, 2.14, -5.3);           // 段ボール箱
  // 床の靴（2足ぶんの小箱）と収納ケース
  vbox(0.24, 0.09, 0.12, M.dark, -2.1, 0.08, -5.15);
  vbox(0.24, 0.09, 0.12, M.dark, -1.82, 0.08, -5.15);
  vbox(0.7, 0.3, 0.5, new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 0.6 }), -1.0, 0.18, -5.3);  // 半透明収納風の暗いケース
}
// タンス（オーク3段チェスト。天板が張り出し、脚・引き出し・取っ手まで作り込む）
{
  solids.push({ x1: -5.4, z1: -5.95, x2: -3.0, z2: -5.35 });
  aoPatch(-4.2, -5.6, 2.6, 0.9);
  const cx = -4.2, cz = -5.62, cw = 2.2, cd = 0.52;
  // 黒スチールの短脚（前2本は手前に出るので見える）
  [[-1.0, 0.2], [1.0, 0.2], [-1.0, -0.2], [1.0, -0.2]].forEach(([dx, dz]) =>
    tleg(0.03, 0.024, 0.14, M.steel, cx + dx * (cw / 2 - 0.06), 0.07, cz + dz * (cd / 2 - 0.06)));
  rbox(cw, 0.68, cd, M.oak, cx, 0.48, cz, 0, 0.02);                         // 本体
  rbox(cw + 0.08, 0.05, cd + 0.06, M.oakDark, cx, 0.845, cz, 0, 0.018);     // 張り出した天板
  // 引き出し3段（前板を浮かせ、横一列2連ノブ）
  for (let r = 0; r < 3; r++) {
    const dy = 0.66 - r * 0.2;
    rbox(cw - 0.06, 0.18, 0.026, M.oak, cx, dy, cz + cd / 2 + 0.002, 0, 0.01, 2);
    [-0.42, 0.42].forEach((kx) => {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 12), M.steel);
      k.rotation.x = Math.PI / 2;
      k.position.set(cx + kx, dy, cz + cd / 2 + 0.03); scene.add(k);
    });
  }
  // 天板の上の小物（レトロな目覚まし時計・眼鏡・文庫本・畳んだ布）
  // ツインベル目覚まし時計：丸い本体＋文字盤＋上部2つのベル＋脚
  const akX = cx - 0.62, akZ = cz + 0.02;
  const akMetal = new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.55, metalness: 0.4 });  // 反射控えめの金属（滲み防止）
  vcyl(0.07, 0.07, 0.05, akMetal, akX, 0.92, akZ, 20).rotation.x = Math.PI / 2;  // 本体（横向き円柱）
  const akFace = new THREE.Mesh(new THREE.CircleGeometry(0.058, 20),
    new THREE.MeshStandardMaterial({ color: 0xc4beae, roughness: 0.85 }));
  akFace.position.set(akX, 0.92, akZ + 0.026); scene.add(akFace);           // 文字盤（やや暗いオフホワイト）
  vbox(0.04, 0.006, 0.004, M.dark, akX, 0.925, akZ + 0.03, 0.6);            // 分針
  vbox(0.026, 0.006, 0.004, M.dark, akX + 0.006, 0.918, akZ + 0.03, -0.3);  // 時針
  [-0.05, 0.05].forEach(bx2 => {                                            // 上部の2つのベル
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), akMetal);
    bell.position.set(akX + bx2, 0.985, akZ); scene.add(bell);
  });
  vbox(0.012, 0.03, 0.008, akMetal, akX, 1.0, akZ - 0.02, 0.3);             // ベルを叩くハンマー
  [-0.045, 0.045].forEach(fx => vcyl(0.006, 0.006, 0.03, M.steel, akX + fx, 0.87, akZ, 8));  // 2本脚
  // 眼鏡（フレーム2枚＋ブリッジ＋つる）
  const glX = cx + 0.1, glZ = cz + 0.05;
  [-0.03, 0.03].forEach(gx => {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 8, 18), M.dark);
    lens.rotation.x = -Math.PI / 2; lens.position.set(glX + gx, 0.878, glZ); scene.add(lens);
  });
  vbox(0.02, 0.004, 0.004, M.dark, glX, 0.878, glZ);                        // ブリッジ
  vbox(0.004, 0.004, 0.08, M.dark, glX - 0.05, 0.878, glZ - 0.03);          // つる
  vbox(0.004, 0.004, 0.08, M.dark, glX + 0.05, 0.878, glZ - 0.03);
  // 文庫本（数冊積み、背表紙が見える）
  [0, 1, 2].forEach(k => {
    vbox(0.11, 0.018, 0.16, bookMats[(k * 3) % bookMats.length], cx + 0.62, 0.885 + k * 0.02, cz + 0.02, 0.08);
  });
  // 畳んだ布（少し崩れた2段）
  rbox(0.32, 0.06, 0.24, M.fabric, cx + 0.62, 0.945, cz - 0.02, 0.05, 0.03, 3);
}
// ローテーブル＋ラグ＋生活の痕跡（角丸天板・テーパー脚・幕板・下段棚）
{
  solids.push({ x1: 2.0, z1: 1.6, x2: 3.4, z2: 2.8 });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24),
    new THREE.MeshLambertMaterial({ color: 0x4a302c }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(2.7, 0.015, 2.2); scene.add(rug);
  const tx = 2.7, tz = 2.2;
  rbox(1.4, 0.05, 1.2, M.oak, tx, 0.42, tz, 0, 0.02);                       // 天板（角丸）
  rbox(1.28, 0.03, 1.08, M.oakDark, tx, 0.24, tz, 0, 0.012);                // 下段棚
  [[-0.62, -0.52], [0.62, -0.52], [-0.62, 0.52], [0.62, 0.52]].forEach(([dx, dz]) =>
    tleg(0.024, 0.032, 0.4, M.oakDark, tx + dx, 0.2, tz + dz));             // テーパー脚
  // 幕板（天板下を一周）
  rbox(1.3, 0.05, 0.03, M.oak, tx, 0.37, tz - 0.5, 0, 0.008, 2);
  rbox(1.3, 0.05, 0.03, M.oak, tx, 0.37, tz + 0.5, 0, 0.008, 2);
  // 生活の痕跡（天板 y≈0.445 の上に置く）
  // カップ麺（本体テーパー＋フタが半分めくれ＋割り箸）
  vcyl(0.092, 0.072, 0.11, new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.9 }), tx - 0.32, 0.5, tz - 0.18, 16);
  vcyl(0.085, 0.06, 0.02, new THREE.MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.7 }), tx - 0.32, 0.45, tz - 0.18, 16);  // 帯（赤ラベル）
  const lid = rbox(0.1, 0.004, 0.1, new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.6, metalness: 0.3 }), tx - 0.32, 0.565, tz - 0.14, 0.3, 0.002, 1);
  lid.rotation.x = -0.9;                                                    // 半分めくれたフタ
  [[-0.005, 0.02], [0.008, -0.01]].forEach(([ox, oz]) => {                  // 割り箸2本
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 6), M.oak);
    ch.position.set(tx - 0.32 + ox, 0.58, tz - 0.18 + oz); ch.rotation.z = 0.5; ch.rotation.y = 0.3; scene.add(ch);
  });
  // 空き缶（胴＋上面のリム＋プルタブ）
  vcyl(0.033, 0.033, 0.13, M.metal, tx + 0.36, 0.51, tz + 0.26, 16);
  vcyl(0.03, 0.03, 0.006, M.steel, tx + 0.36, 0.577, tz + 0.26, 16);        // 天面
  vbox(0.02, 0.002, 0.012, M.steel, tx + 0.36, 0.582, tz + 0.26);          // プルタブ
  // リモコン（本体＋ボタン格子）
  const rmx = tx + 0.22, rmz = tz - 0.32, rmr = 0.42;
  rbox(0.1, 0.024, 0.24, M.dark, rmx, 0.46, rmz, rmr, 0.01, 2);
  for (let br = 0; br < 5; br++)                                            // ボタン（2列×5行）
    for (let bc = 0; bc < 2; bc++) {
      const bxp = rmx + Math.cos(rmr) * (bc * 0.03 - 0.015) - Math.sin(rmr) * (br * 0.032 - 0.064);
      const bzp = rmz + Math.sin(rmr) * (bc * 0.03 - 0.015) + Math.cos(rmr) * (br * 0.032 - 0.064);
      vcyl(0.007, 0.007, 0.004, M.steel, bxp, 0.474, bzp, 6);
    }
  // 読みかけの雑誌（開いて伏せてある）
  const mag = rbox(0.3, 0.008, 0.22, M.form, tx - 0.05, 0.452, tz + 0.28, 0.15, 0.003, 1);
  mag.rotation.x = 0.02;
  vbox(0.28, 0.001, 0.2, M.formInk, tx - 0.05, 0.457, tz + 0.28, 0.15);     // 誌面の印字塊
  // コースターの輪染み（天板に薄く）
  const stain = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9, transparent: true, opacity: 0.5 }));
  stain.rotation.x = -Math.PI / 2; stain.position.set(tx + 0.1, 0.446, tz - 0.02); scene.add(stain);
}
// TVボード＋薄型テレビ（角丸ローボード・引き出し・スタンド・ベゼル）
{
  solids.push({ x1: 2.6, z1: 5.2, x2: 4.8, z2: 5.7 });
  aoPatch(3.7, 5.15, 2.6, 1.0);
  const bx = 3.7, bz = 5.45;
  rbox(2.2, 0.34, 0.5, M.oak, bx, 0.22, bz, 0, 0.02);                       // ローボード本体
  rbox(2.24, 0.03, 0.54, M.oakDark, bx, 0.4, bz, 0, 0.012);                 // 天板
  [[-1.05, 0.22], [1.05, 0.22]].forEach(([dx, dz]) =>
    tleg(0.024, 0.02, 0.06, M.steel, bx + dx, 0.03, bz + dz));
  // 引き出し2連（横バー取っ手）
  [-0.55, 0.55].forEach((dx) => {
    rbox(0.98, 0.22, 0.024, M.oak, bx + dx, 0.2, bz - 0.252, 0, 0.008, 2);
    vbox(0.44, 0.02, 0.024, M.steel, bx + dx, 0.2, bz - 0.268);
  });
  // 薄型テレビ（左右2脚スタンド＋極薄ベゼル＋つや消し画面）＋サウンドバー＋メディア機器
  const sx = bx, sz = bz - 0.03;
  [-0.42, 0.42].forEach(dx => {                                             // 左右のブレード脚
    rbox(0.14, 0.014, 0.16, M.dark, sx + dx, 0.412, sz, 0, 0.004, 2);       // 接地脚
    vbox(0.02, 0.12, 0.06, M.dark, sx + dx, 0.47, sz);                      // 支柱
  });
  rbox(1.16, 0.66, 0.028, M.plastic, sx, 0.86, sz + 0.006, 0, 0.006, 2);    // 背面ケース（薄）
  rbox(1.14, 0.64, 0.012, new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.35 }), sx, 0.86, sz - 0.006, 0, 0.004, 2);  // 極薄ベゼル
  vbox(1.08, 0.6, 0.006, M.tv, sx, 0.86, sz - 0.014);                       // 画面（前触れで光る・つや消し）
  vbox(0.05, 0.006, 0.006, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4 }), sx, 0.55, sz - 0.016);  // 下ベゼル中央のブランドロゴ
  // サウンドバー（テレビ手前、天板上）
  rbox(0.9, 0.05, 0.07, M.plastic, sx, 0.44, sz + 0.16, 0, 0.02, 2);
  vbox(0.86, 0.03, 0.005, new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.7 }), sx, 0.44, sz + 0.197);  // スピーカーグリル面
  // メディア機器（左下、電源LED点灯）＋赤い待機LED
  rbox(0.4, 0.05, 0.28, M.plastic, bx - 0.6, 0.44, bz + 0.06, 0, 0.008, 2);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  led.position.set(bx - 0.74, 0.45, bz + 0.19); scene.add(led);            // 待機ランプ（赤）
  // HDMIケーブルがテレビ裏から機器へ垂れる
  const tvcab = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), M.dark);
  tvcab.position.set(sx - 0.2, 0.62, sz + 0.05); tvcab.rotation.x = 0.2; scene.add(tvcab);
}
// PCデスク（オーク天板＋黒スチール脚。モニタ・キーボード・散乱書類・椅子）
{
  solids.push({ x1: 6.0, z1: -2.9, x2: 7.7, z2: -1.7 });
  aoPatch(6.85, -2.3, 2.2, 1.7);
  const dx = 6.85, dz = -2.3, dw = 1.6, dd = 0.72, dh = 0.74;
  rbox(dw, 0.05, dd, M.oak, dx, dh, dz, 0, 0.018);                          // 天板
  // 黒スチールの角脚（コの字を左右に）＋貫
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([px, pz]) =>
    vbox(0.05, dh, 0.05, M.steel, dx + px * (dw / 2 - 0.05), dh / 2, dz + pz * (dd / 2 - 0.06)));
  vbox(0.04, 0.04, dd - 0.1, M.steel, dx - (dw / 2 - 0.05), 0.1, dz);
  vbox(0.04, 0.04, dd - 0.1, M.steel, dx + (dw / 2 - 0.05), 0.1, dz);
  const top = dh + 0.025;                        // 天板上面の高さ（小物はこの上に置く）
  // ── モニタ ──────────────────────────────────────────
  // 椅子は -z 側。モニタは奥(+z)に置き、画面を椅子側(-z)へ向ける。
  const mz = dz + 0.24;                                                      // 支柱の位置（奥寄り）
  rbox(0.26, 0.018, 0.16, M.plastic, dx, top + 0.009, mz, 0, 0.01, 2);       // スタンド台座（重り）
  const neck = rbox(0.045, 0.22, 0.055, M.plastic, dx, top + 0.13, mz, 0, 0.015, 2);  // 支柱
  neck.rotation.x = 0.06;                                                    // わずかに後傾
  // パネル：背面ケース(厚)＋前面ベゼル(薄・角丸)＋液晶面。全体を -z にわずかに傾ける
  const panY = top + 0.36, panZ = mz - 0.03;
  const monBack = rbox(0.72, 0.44, 0.05, M.plastic, dx, panY, panZ + 0.02, 0, 0.014, 2);   // 背面ケース
  monBack.rotation.x = -0.06;
  const bezel = rbox(0.72, 0.44, 0.02, new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.4 }), dx, panY, panZ - 0.006, 0, 0.012, 2);
  bezel.rotation.x = -0.06;
  const scr = vbox(0.66, 0.375, 0.006, M.screen, dx, panY, panZ - 0.018);    // 液晶面（-z＝椅子側）
  scr.rotation.x = -0.06;
  // 画面の光で手元をほのかに照らす青白い局所光（消したデスクライトの代替。弱め・短レンジ）
  const scrGlow = new THREE.PointLight(0x88a8d8, 0.05 * 34, 1.2, 2.2);
  scrGlow.position.set(dx, panY - 0.22, panZ - 0.28);   // 画面より下・手前へ。ガラス面への正反射を避ける
  scrGlow.castShadow = true; scrGlow.shadow.mapSize.set(512, 512);
  scrGlow.shadow.bias = -0.0008; scrGlow.shadow.normalBias = 0.02;
  scrGlow.shadow.camera.near = 0.05; scrGlow.shadow.camera.far = 1.4;
  scene.add(scrGlow);
  vbox(0.05, 0.012, 0.006, new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5 }), dx, panY - 0.205, panZ - 0.02);  // 下ベゼルのロゴ帯
  // 電源ケーブル（台座から天板の奥へ垂れる）
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), M.dark);
  cable.position.set(dx + 0.1, top + 0.06, mz + 0.05); cable.rotation.x = 0.4; scene.add(cable);
  // ── キーボード（土台＋キーキャップ格子） ───────────────
  const kbX = dx - 0.02, kbZ = dz - 0.22, kbW = 0.46, kbD = 0.16;
  rbox(kbW, 0.016, kbD, M.plastic, kbX, top + 0.008, kbZ, 0, 0.006, 2);      // 土台
  for (let r = 0; r < 4; r++)                                                // キーキャップ 4行×14列
    for (let c = 0; c < 14; c++)
      vbox(0.024, 0.008, 0.022, M.keycap,
        kbX - kbW / 2 + 0.035 + c * 0.0295, top + 0.02, kbZ - kbD / 2 + 0.035 + r * 0.031);
  vbox(0.16, 0.008, 0.022, M.keycap, kbX, top + 0.02, kbZ + kbD / 2 - 0.02);  // スペースキー
  // ── マウス（角丸・2ボタンのすき間） ────────────────────
  const msX = dx + 0.34, msZ = dz - 0.2;
  rbox(0.058, 0.026, 0.095, M.plastic, msX, top + 0.013, msZ, 0, 0.02, 3);   // 本体
  vbox(0.001, 0.02, 0.05, new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6 }), msX, top + 0.022, msZ - 0.02);  // ボタン分割線
  // ── マグカップ（取っ手＋縁の凹み） ─────────────────────
  const cupX = dx - 0.6, cupZ = dz + 0.06;
  vcyl(0.05, 0.045, 0.11, M.ceramic, cupX, top + 0.055, cupZ, 16);           // 胴
  vcyl(0.043, 0.043, 0.02, new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.4 }), cupX, top + 0.1, cupZ, 16);  // 中のコーヒー
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 8, 16, Math.PI * 1.2), M.ceramic);
  handle.position.set(cupX + 0.05, top + 0.055, cupZ); handle.rotation.y = Math.PI / 2; scene.add(handle);  // 取っ手
  // ── ペン立て＋ペン ────────────────────────────────────
  const pcX = dx - 0.68, pcZ = dz + 0.2;
  vcyl(0.035, 0.032, 0.1, M.steel, pcX, top + 0.05, pcZ, 12);                // 筒
  [[-0.012, 0.01, 0.06], [0.014, -0.008, -0.05], [0.002, 0.014, 0.12]].forEach(([ox, oz, tilt]) => {
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 8), M.penBody);
    pen.position.set(pcX + ox, top + 0.11, pcZ + oz); pen.rotation.z = tilt; pen.rotation.x = tilt * 0.6; scene.add(pen);
  });
  // ── 散乱した確定申告フォーム（重なり＋印字） ──────────────
  const forms = [[-0.42, 0.18, 0.9], [-0.34, 0.28, 0.6], [0.05, 0.24, 1.3]];
  forms.forEach(([ox, oz, ry], i) => {
    const fx = dx + ox, fz = dz + oz, fy = top + 0.004 + i * 0.004;
    rbox(0.24, 0.004, 0.32, M.form, fx, fy, fz, ry, 0.002, 1);               // A4 用紙
    // 印字：見出し帯＋罫線数本（用紙面のすぐ上に薄板で）
    const put = (w, d, lx, lz) => { const m = vbox(w, 0.001, d, M.formInk, fx + lx, fy + 0.003, fz + lz, ry); return m; };
    put(0.16, 0.012, 0, -0.12);                                              // タイトル帯
    for (let r = 0; r < 5; r++) put(0.18, 0.003, 0, -0.05 + r * 0.035);      // 罫線
  });
  // ── 付箋（モニタ台座に1枚、机に1枚） ─────────────────────
  vbox(0.05, 0.001, 0.05, new THREE.MeshStandardMaterial({ color: 0xd9c94a, roughness: 0.9 }), dx + 0.28, top + 0.003, dz + 0.02, 0.3);
  const noteOnBase = vbox(0.05, 0.001, 0.05, new THREE.MeshStandardMaterial({ color: 0xd98fb0, roughness: 0.9 }), dx - 0.09, top + 0.006, mz - 0.04, -0.2);
  noteOnBase.position.y = top + 0.02;
  // ── デスクライト（アーム＋傘＋暖色の局所光。ホラーの手元の光だまり） ──
  const laX = dx + 0.62, laZ = dz + 0.2;
  vcyl(0.05, 0.06, 0.02, M.lampArm, laX, top + 0.01, laZ, 12);               // 台座
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 8), M.lampArm);
  arm1.position.set(laX, top + 0.18, laZ); arm1.rotation.z = 0.35; scene.add(arm1);
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 8), M.lampArm);
  arm2.position.set(laX - 0.14, top + 0.34, laZ - 0.04); arm2.rotation.z = 1.15; scene.add(arm2);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.11, 16, 1, true), M.lampShade);
  shade.position.set(laX - 0.3, top + 0.34, laZ - 0.06); shade.rotation.z = -0.7; scene.add(shade);
  // デスクライトは消灯（ユーザー要望）。電球は光らない暗いガラス球にし、光源は置かない。
  const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.1 }));  // 消えた電球（黒っぽい）
  lampGlow.position.set(laX - 0.32, top + 0.3, laZ - 0.06); scene.add(lampGlow);
  // 椅子（座面・背もたれ・5本脚キャスター・ガスシリンダー）
  solids.push({ x1: 6.35, z1: -3.6, x2: 6.85, z2: -3.1 });
  const chx = 6.6, chz = -3.35;
  rbox(0.44, 0.07, 0.42, M.dark, chx, 0.48, chz, 0, 0.03, 3);               // 座面
  const back = rbox(0.42, 0.5, 0.06, M.dark, chx, 0.76, chz + 0.2, 0, 0.03, 3);
  back.rotation.x = -0.12;                                                  // 背もたれ（少し倒す）
  vcyl(0.03, 0.03, 0.34, M.steel, chx, 0.31, chz, 10);                      // ガスシリンダー
  for (let a = 0; a < 5; a++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.04), M.steel);
    leg.position.set(chx + Math.sin(a / 5 * Math.PI * 2) * 0.13, 0.13, chz + Math.cos(a / 5 * Math.PI * 2) * 0.13);
    leg.rotation.y = a / 5 * Math.PI * 2; scene.add(leg);
    vcyl(0.028, 0.028, 0.05, M.dark, chx + Math.sin(a / 5 * Math.PI * 2) * 0.24, 0.06, chz + Math.cos(a / 5 * Math.PI * 2) * 0.24, 10).rotation.z = Math.PI / 2;
  }
}
// 本棚（オークのオープンシェルフ。本がぎっしり、一冊だけ倒れている）
{
  solids.push({ x1: 7.35, z1: 1.2, x2: 7.95, z2: 3.2 });
  const shx = 7.62, shzC = 2.15;            // 棚中心（壁際）
  const shH = 2.15, shD = 0.34, shW = 1.9;  // 高さ・奥行き・間口(z方向)
  // 側板・天地・背板
  rbox(shD, shH, 0.04, M.oak, shx, shH / 2, shzC - shW / 2, 0, 0.012);      // 左側板
  rbox(shD, shH, 0.04, M.oak, shx, shH / 2, shzC + shW / 2, 0, 0.012);      // 右側板
  rbox(shD, 0.04, shW, M.oak, shx, shH - 0.02, shzC, 0, 0.012);            // 天板
  rbox(shD, 0.04, shW, M.oakDark, shx, 0.06, shzC, 0, 0.012);              // 地板
  vbox(0.02, shH, shW, M.oakDark, shx + shD / 2 - 0.01, shH / 2, shzC);    // 背板
  // 棚板4枚（本の載る面 yb = 0.1 + s*0.5 に合わせる）
  for (let s = 0; s < 4; s++)
    rbox(shD - 0.03, 0.03, shW - 0.06, M.oak, shx, 0.1 + s * 0.5, shzC, 0, 0.01, 2);
  // 一冊 = 背表紙スラブ＋その奥の小口（ページ束）。lean で傾ける。
  // 本棚は右壁(x=8)際で室内(-x)を向いて開く。背表紙は室内側(-x)、小口は壁側(+x)。
  // bw = 背の幅（薄い/厚い）、bh = 本の高さ、bd = 本の奥行き（棚の奥行きに収める）。
  // 背表紙の装飾用マテリアル（タイトル帯＝暗色／金の箔押し／隆起バンド＝影）
  const bandDark = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.7 });
  const bandGilt = new THREE.MeshStandardMaterial({ color: 0x9c7b34, roughness: 0.5, metalness: 0.35 });
  function placeBook(spineFaceX, yBase, z, bw, bh, mat, lean = 0) {
    const bd = 0.22 + Math.random() * 0.05;                 // 奥行き
    const parts = [];
    // 背表紙：室内を向く薄い色スラブ
    parts.push(vbox(0.022, bh, bw, mat, spineFaceX, yBase + bh / 2, z));
    // 小口（ページ束）：背表紙の奥（+x側）へ延びる。少し低く・細くして束に見せる
    parts.push(vbox(bd, bh - 0.018, bw - 0.012, pageMat,
      spineFaceX + 0.011 + bd / 2, yBase + (bh - 0.018) / 2, z));
    // --- 背表紙のディティール（室内側 -x にわずかに突出。傾いた本には貼らず位置ズレを避ける） ---
    if (lean === 0) {
      const fx = spineFaceX - 0.012;       // 背表紙前面のわずか手前
      const bandMat = Math.random() < 0.45 ? bandGilt : bandDark;   // 金箔押しか、暗色の刷りか
      if (bw > 0.032) {                    // タイトル帯（上寄り）。細い本では省略。
        const tw = Math.min(bw * 0.66, 0.05);
        vbox(0.006, bh * 0.16, tw, bandMat, fx, yBase + bh * 0.72, z);
        if (Math.random() < 0.5)           // 著者帯（下寄り・小さめ）を時々
          vbox(0.005, bh * 0.06, tw * 0.7, bandMat, fx, yBase + bh * 0.30, z);
      }
      if (bw > 0.05 && Math.random() < 0.4) {   // 革装丁の隆起バンド（上下2本のリブ）
        for (const yy of [0.42, 0.58])
          vbox(0.010, 0.012, bw, mat, fx - 0.002, yBase + bh * yy, z);
      }
    } else {                               // 傾いた本は背表紙と小口だけを一緒に傾ける
      parts.forEach(m => { m.rotation.x = lean; });
    }
    return bh;
  }
  for (let s = 0; s < 4; s++) {
    const yb = 0.1 + s * 0.5 + 0.02;
    let z = 1.36;
    let lean = 0;                                           // 隣接する本は同じ側へ寄りかかる
    while (z < 3.02) {
      const bw = 0.028 + Math.random() * 0.05;             // 背の幅（薄い文庫〜厚い専門書）
      if (Math.random() < 0.12) { z += bw + 0.05; lean = 0; continue; }  // 抜けた隙間で列が途切れる
      const bh = 0.30 + Math.random() * 0.15;
      // 隙間の直後だけ寄りかかりを許可（倒れ込み）。列の途中はほぼ直立。
      if (lean === 0 && Math.random() < 0.22) lean = (Math.random() * 0.12 + 0.04);
      else if (Math.random() < 0.5) lean = 0;
      placeBook(7.46, yb, z + bw / 2, bw, bh, bookMats[Math.floor(Math.random() * bookMats.length)], lean);
      z += bw * Math.cos(lean) + 0.006;
    }
    // 各段に平積み1〜2冊（横に寝かせた本。背表紙が室内を向く向きで薄く積む）
    const stackN = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0;
    let sy = yb;
    for (let k = 0; k < stackN; k++) {
      const th = 0.04 + Math.random() * 0.03;
      const bookC = bookMats[Math.floor(Math.random() * bookMats.length)];
      const zc = 2.7 + (Math.random() - 0.5) * 0.2, ry = (Math.random() - 0.5) * 0.15;
      vbox(0.3, th, 0.24, pageMat, 7.55, sy + th / 2, zc, ry);           // 小口（束）
      vbox(0.3, th - 0.004, 0.02, bookC, 7.45, sy + th / 2, zc, ry);     // 背表紙が室内(-x)を向く
      sy += th + 0.004;
    }
  }
}
// 玄関ドア
{
  vbox(0.06, 2.1, 0.95, new THREE.MeshLambertMaterial({ color: 0x555a61 }), 7.96, 1.05, -5.15);
  vbox(0.05, 0.04, 0.16, M.metal, 7.9, 1.02, -4.82);
  vbox(0.05, 0.3, 0.06, M.dark, 7.92, 1.85, -5.15);   // ドアクローザー的な影
}
// 窓（月と、遠い街）＋ひだ付きカーテン
{
  const WX = -7.96, WY = 1.72, WZ = -2.6;   // 窓中心（西壁, +x向き）
  // 夜景（ガラスの奥。壁のわずか手前に置く）
  const night = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.02),
    new THREE.MeshBasicMaterial({ map: nightTex }));
  night.rotation.y = Math.PI / 2;
  night.position.set(WX + 0.05, WY, WZ); scene.add(night);
  // ガラス（夜景の手前。反射は控えめにして点光源のスペキュラ玉が出ないようにする）
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.02),
    new THREE.MeshStandardMaterial({ color: 0x141d30, roughness: 0.5, metalness: 0.0,
      transparent: true, opacity: 0.10 }));
  glass.rotation.y = Math.PI / 2; glass.position.set(WX + 0.075, WY, WZ); scene.add(glass);
  // 木枠のケーシング（上下左右の見付け＋外周を一段太く）
  const frameM = M.woodDark;
  const HW = 0.85, HH = 0.58;                // 窓開口の半幅・半高
  vbox(0.10, 0.09, HW * 2 + 0.18, frameM, WX + 0.02, WY + HH + 0.04, WZ);  // 上枠
  vbox(0.10, 0.09, HW * 2 + 0.18, frameM, WX + 0.02, WY - HH - 0.04, WZ);  // 下枠（この上に窓台）
  vbox(0.10, HH * 2 + 0.18, 0.09, frameM, WX + 0.02, WY, WZ - HW - 0.04);  // 左枠
  vbox(0.10, HH * 2 + 0.18, 0.09, frameM, WX + 0.02, WY, WZ + HW + 0.04);  // 右枠
  // 窓台（下枠の前に張り出す）＋エプロン
  vbox(0.20, 0.05, HW * 2 + 0.30, frameM, WX + 0.06, WY - HH - 0.09, WZ);  // 窓台（sill）
  vbox(0.12, 0.10, HW * 2 + 0.10, frameM, WX + 0.03, WY - HH - 0.16, WZ);  // エプロン
  // 十字の桟（縦1＋横1で4分割。細い木桟）
  vbox(0.04, HH * 2, 0.035, frameM, WX + 0.045, WY, WZ);   // 縦桟
  vbox(0.04, 0.035, HW * 2, frameM, WX + 0.045, WY, WZ);   // 横桟
  // カーテンレール＋端のフィニアル
  const rod = vcyl(0.02, 0.02, HW * 2 + 0.5, M.metal, WX + 0.16, WY + HH + 0.14, WZ, 10);
  rod.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    vcyl(0.035, 0.035, 0.05, M.metal, WX + 0.16, WY + HH + 0.14, WZ + s * (HW + 0.27), 10)
      .rotation.x = Math.PI / 2;
  }
  // ひだ付きカーテン：縦の半円柱を並べて布のドレープを作る
  function pleatedCurtain(zStart, zEnd, folds, gatherAt) {
    const top = WY + HH + 0.12, len = 1.30;
    const span = zEnd - zStart;
    for (let i = 0; i < folds; i++) {
      const t = i / (folds - 1);
      const z = zStart + span * t;
      // 束ねる側ほど山が深く、開く側ほど浅い（gatherAt: 0=zStart側で束ねる, 1=zEnd側）
      const depth = 0.05 + 0.06 * (1 - Math.abs(t - gatherAt));
      const fold = new THREE.Mesh(
        new THREE.CylinderGeometry(depth, depth, len, 8, 1, false, Math.PI * 0.15, Math.PI * 0.7),
        M.fabric);
      fold.position.set(WX + 0.16 + depth * 0.5, top - len / 2, z);
      fold.rotation.y = Math.PI;      // 山（凸側）を部屋側(+x)へ向ける
      scene.add(fold);
    }
    // 上端のヘッダー（ひだをまとめる帯）
    vbox(0.10, 0.10, Math.abs(span) + 0.12, M.fabric, WX + 0.17, top - 0.02, (zStart + zEnd) / 2);
  }
  // 左右のカーテン（外側で束ね、中央寄りが開いて夜景が覗く）
  pleatedCurtain(WZ - HW - 0.10, WZ - 0.30, 7, 0.0);   // 左パネル（左端で束ねる）
  pleatedCurtain(WZ + 0.30, WZ + HW + 0.10, 7, 1.0);   // 右パネル（右端で束ねる）
}
// 玄関の郵便物の山
for (let i = 0; i < 7; i++) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.36), M.paper);
  p.position.set(6.9 + (Math.random()-0.5)*0.5, 0.02 + i*0.025, -5.4 + (Math.random()-0.5)*0.5);
  p.rotation.y = Math.random()*0.9;
  scene.add(p);
}
// 壁掛け時計（プロシージャル。針メッシュ自体をゲーム内時刻と同期回転）
let lastWallMin = -1;
const clockHands = { minute: null, hour: null, second: null };
{
  const clx = 1.4, cly = 2.1, clz = -5.9;   // 中央壁の少し手前
  // --- 文字盤テクスチャ（数字・分目盛り・メーカー刻印・経年のくすみ） ---
  const faceTex = makeTex(512, 512, (c, w, h) => {
    const cx = w / 2, cy = h / 2, R = w * 0.47;
    // キャンバス全体を暗い下地で塗りつぶす（透明を使わず不透明テクスチャにする）
    c.fillStyle = "#141210"; c.fillRect(0, 0, w, h);
    // くすんだ古象牙色の文字盤（強い天井灯でも白飛びしないよう暗めに）＋外周ビネット
    const g = c.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    g.addColorStop(0, "#c3b89c"); g.addColorStop(0.7, "#b7ac90"); g.addColorStop(1, "#9d9276");
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    // 経年のシミ（薄い茶の斑点）
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399, r = R * (0.15 + (i % 7) / 7 * 0.75);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, s = 2 + (i % 5) * 3;
      c.fillStyle = `rgba(120,96,60,${0.03 + (i % 3) * 0.02})`;
      c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
    }
    // 分目盛り（60本、5本ごとに太く）＋12個の数字（純黒・太めで確実に読ませる）
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2 - Math.PI / 2;
      const big = i % 5 === 0;
      const r0 = R * (big ? 0.78 : 0.87), r1 = R * 0.94;
      c.strokeStyle = "#000000"; c.lineWidth = big ? 9 : 3.5; c.lineCap = "round";
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    c.fillStyle = "#000000"; c.font = `bold ${Math.round(R * 0.24)}px Georgia, serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    for (let n = 1; n <= 12; n++) {
      const a = n / 12 * Math.PI * 2 - Math.PI / 2, r = R * 0.64;
      c.fillText(String(n), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    // メーカー刻印と MADE IN 表記
    c.fillStyle = "#5a4f3e"; c.font = `bold ${Math.round(R * 0.08)}px Georgia, serif`;
    c.fillText("SEIKOSHA", cx, cy - R * 0.36);
    c.font = `${Math.round(R * 0.05)}px Georgia, serif`;
    c.fillText("QUARTZ", cx, cy + R * 0.32);
  });
  faceTex.wrapS = faceTex.wrapT = THREE.ClampToEdgeWrapping; faceTex.repeat.set(1, 1);
  // ミップマップ生成が細い数字・目盛りを潰すため無効化し、常にフル解像度でサンプルさせる
  faceTex.generateMipmaps = false;
  faceTex.minFilter = THREE.LinearFilter;
  faceTex.magFilter = THREE.LinearFilter;
  faceTex.anisotropy = 1;
  faceTex.needsUpdate = true;
  // --- ケース：濃い木の本体＋外周リム＋背面（奥行きのある枠に見せる） ---
  // ボディは文字盤より確実に後ろに置く（前面が文字盤を隠さないよう中心を奥へ）
  vcyl(0.29, 0.29, 0.06, M.oakDark, clx, cly, clz - 0.04, 44).rotation.x = Math.PI / 2;   // 背面のボディ（前面 ≈ clz-0.01）
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.03, 12, 48),
    new THREE.MeshStandardMaterial({ map: M.oakDark.map, normalMap: M.oakDark.normalMap, color: 0x6e523a, roughness: 0.6 }));
  rim.position.set(clx, cly, clz + 0.028); scene.add(rim);                                  // 木の外リム
  // 文字盤：CircleGeometry の既定UVは中心一点しか拾わないため、UVを円全体に貼り直す。
  const faceGeo = new THREE.CircleGeometry(0.235, 48);
  {
    const pos = faceGeo.attributes.position, uv = faceGeo.attributes.uv, r = 0.235;
    for (let i = 0; i < pos.count; i++)
      uv.setXY(i, 0.5 + (pos.getX(i) / r) * 0.47, 0.5 + (pos.getY(i) / r) * 0.47);
    uv.needsUpdate = true;
  }
  const face = new THREE.Mesh(faceGeo,
    new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.98, metalness: 0.0 }));
  face.position.set(clx, cly, clz + 0.020); scene.add(face);
  // 内側の影リング（文字盤外周だけをうっすら暗くして奥行きを出す。中央は暗くしない）
  const shadowRing = new THREE.Mesh(new THREE.TorusGeometry(0.243, 0.010, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, transparent: true, opacity: 0.35 }));
  shadowRing.position.set(clx, cly, clz + 0.023); scene.add(shadowRing);
  // 金属ベゼル（暗所で黒く沈まないよう metalness 低め・粗さ中）
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.252, 0.012, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.4, metalness: 0.3 }));
  bezel.position.set(clx, cly, clz + 0.030); scene.add(bezel);
  // ガラスカバー（ごく薄い反射。文字盤を覆い隠さないよう不透明度を最小に）
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.246, 48),
    new THREE.MeshStandardMaterial({ color: 0xeef3f6, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.04 }));
  glass.position.set(clx, cly, clz + 0.048); scene.add(glass);
  // 針：端を軸に回すため、ジオメトリを先端側へずらしてからグループごと回転させる
  // 幅方向にテーパーする菱形の針（先端が細くなる本物らしい形）
  function makeHand(len, wid, thick, mat, z, taper = 0.35) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(-wid * 0.5, -len * 0.12);
    shape.lineTo(-wid * taper * 0.5, len * 0.9 - wid);
    shape.lineTo(0, len - wid);              // 先端
    shape.lineTo(wid * taper * 0.5, len * 0.9 - wid);
    shape.lineTo(wid * 0.5, -len * 0.12);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat); m.position.z = -thick / 2;
    g.add(m);
    g.position.set(clx, cly, clz + z);
    scene.add(g);
    return g;
  }
  const handMat = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.5, metalness: 0.2 });
  const secMat = new THREE.MeshStandardMaterial({ color: 0xb02b1f, roughness: 0.5, metalness: 0.1 });
  clockHands.hour   = makeHand(0.135, 0.024, 0.006, handMat, 0.033);
  clockHands.minute = makeHand(0.205, 0.017, 0.006, handMat, 0.037);
  clockHands.second = makeHand(0.215, 0.006, 0.004, secMat, 0.040, 0.7);
  // 中央ハブ（金属キャップ＋赤い秒針のカウンターウェイト風）
  vcyl(0.017, 0.017, 0.018, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.3 }),
    clx, cly, clz + 0.043, 16).rotation.x = Math.PI / 2;
  drawWallClock(false);
}
function drawWallClock(glitch) {
  if (!clockHands.minute || !clockHands.hour) return;
  const mins = glitch ? Math.random() * 720 : gameMin % 720;
  // 12時位置(+Y)を0として時計回り＝-Z回転
  clockHands.hour.rotation.z = -(mins / 720) * Math.PI * 2;
  clockHands.minute.rotation.z = -((mins % 60) / 60) * Math.PI * 2;
  if (clockHands.second) {
    // 秒針：グリッチ時はランダム、通常は分の端数から秒を作って滑らかに回す
    const sec = glitch ? Math.random() * 60 : (mins * 60) % 60;
    clockHands.second.rotation.z = -(sec / 60) * Math.PI * 2;
  }
}

/* ---------- lights ---------- */
const PT_SCALE = 34;   // r155+のライト物理単位化に伴うスケール（cd換算）
// 壁のフィルを底上げして、点光源キーを弱めても部屋が暗く沈まないようにする
const ambient = new THREE.AmbientLight(0x2c2c40, 0.85 * 0.44 * 0.5);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x323c58, 0x100c0a, 0.85 * 0.42 * 0.5);
scene.add(hemi);
const roomLights = [];
const fixtureMats = [];
// シーリング灯は全て壁から十分内側へ寄せる（壁際のホットスポットを作らない）。
// y=2.66 まで持ち上げ、器具の発光面のすぐ内側に光源を置くことで
// 「宙に浮いた変な光源が壁を焼く」見えを解消する。
[[3.8, 1.0], [-4.2, 3.0], [-5.0, -3.2], [5.6, -4.4]].forEach(([x, z]) => {
  // 【壁抜け対策】distance を 5.2 まで絞り、各室の照明が隣室の床・壁へ
  // 届かないようにする（部屋の間口が概ね 4〜5m なので、光は自室内で減衰しきる）。
  // レンジを下げた分ぶんだけ強度を引き上げ、さらに全体を一段暗く（0.36）。
  const l = new THREE.PointLight(0xffdca8, 0.18 * PT_SCALE, 5.2, 2);   // 初期値も半減（applyLightsが即上書き）
  l.position.set(x, 2.66, z);
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  // バイアスを小さくして影を壁の根元に密着させる（peter-panning ＝
  // 壁の足元から影が浮いて光が漏れる現象を抑える）。
  l.shadow.bias = -0.0007;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = 5;
  l.shadow.camera.near = 0.12;
  l.shadow.camera.far = 6;       // distance に合わせて截頭錐台を絞り、影の解像度を稼ぐ
  scene.add(l); roomLights.push(l);
  // 照明器具（コード＋シェード＋発光面）── 影キャスト除外
  vcyl(0.012, 0.012, 0.16, M.dark, x, 2.72, z, 6).userData.noShadow = true;
  vcyl(0.16, 0.22, 0.12, M.dark, x, 2.62, z, 12).userData.noShadow = true;
  const fm = new THREE.MeshBasicMaterial({ color: 0xe8d6a6 });
  fixtureMats.push(fm);
  vcyl(0.15, 0.15, 0.02, fm, x, 2.55, z, 12);
});
const moon = new THREE.PointLight(0x7f95c8, 0.3 * PT_SCALE * 0.6, 7, 2);
moon.position.set(-7.3, 1.8, -2.6);
scene.add(moon);
const flash = new THREE.SpotLight(0xfff0cf, 9, 15, Math.PI/5.2, 0.7, 1.6);
flash.castShadow = true;
flash.shadow.mapSize.set(2048, 2048);
flash.shadow.bias = -0.002;
flash.shadow.normalBias = 0.04;
flash.shadow.camera.near = 0.2;
flash.shadow.camera.far = 15;
const flashTarget = new THREE.Object3D();
scene.add(flash, flashTarget);
flash.target = flashTarget;

/* ---------- item props ---------- */
const itemMeshes = {};
function makeGlow(x, y, z, color) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.085),                     // アイコンを小さく（0.13→0.085）
    new THREE.MeshLambertMaterial({ color: 0xd8cba8, emissive: color })   // コアも少し落ち着かせる
  );
  grp.add(core);
  const l = new THREE.PointLight(color, 0.34 * 3.2, 1.5, 2);  // 周囲を照らす明かりを暗く（0.8→0.34）・レンジも大幅短縮（2.6→1.5）で布への広い反射を抑える
  grp.add(l);
  grp.position.set(x, y, z);
  scene.add(grp);
  return grp;
}
ITEMS.forEach(it => { itemMeshes[it.id] = makeGlow(it.x, it.y + 0.35, it.z, 0xd9a441); });
const fakeMesh = makeGlow(FAKE.x, FAKE.y + 0.35, FAKE.z, 0x7fa8d9);

/* ---------- 壁のポスター（前触れ演出用） ---------- */
function makePosterTex(bad) {
  const cv = document.createElement("canvas");
  cv.width = 192; cv.height = 256;
  const c = cv.getContext("2d");
  c.fillStyle = "#ddd6c4"; c.fillRect(0, 0, 192, 256);
  c.strokeStyle = "#8a8474"; c.lineWidth = 3; c.strokeRect(6, 6, 180, 244);
  c.textAlign = "center";
  if (bad) {
    c.fillStyle = "#7a1f14";
    c.font = "900 46px sans-serif";
    c.fillText("納", 96, 66); c.fillText("税", 96, 122);
    c.fillText("シ", 96, 178); c.fillText("ロ", 96, 234);
  } else {
    c.fillStyle = "#2b4a7a";
    c.font = "bold 26px serif";
    c.fillText("確定申告", 96, 88); c.fillText("お済みですか", 96, 128);
    c.font = "13px sans-serif"; c.fillStyle = "#55503f";
    c.fillText("国税庁", 96, 220);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const posterTexOk = makePosterTex(false), posterTexBad = makePosterTex(true);
const posterMat = new THREE.MeshLambertMaterial({ map: posterTexOk });
const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.3), posterMat);
poster.position.set(-3.4, 1.7, -5.97);
scene.add(poster);

/* ---------- 怪人「ジェイソン」（13日の金曜日オマージュ） ---------- */
// グループの正面はローカル +z（mob更新で monster.lookAt(ply) するため、
// マスク面は必ず +z を向くように組む）。全高 ≈ 2.05m の大柄・前傾姿勢。
function makeMonster() {
  const g = new THREE.Group();

  // --- 怪人専用マテリアル（この個体だけで使うのでローカル定義） ---
  const skin    = new THREE.MeshStandardMaterial({ color: 0x5f5346, roughness: 0.9 });           // くすんだ肌（手・首）暗め＝発光防止
  const scalp   = new THREE.MeshStandardMaterial({ color: 0x1c1915, roughness: 0.92 });          // 頭頂（汚れた髪/頭皮）＝白いオーブ化を防ぐ
  const boot    = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.8, metalness: 0.05 }); // 黒い作業ブーツ
  const bootSole= new THREE.MeshStandardMaterial({ color: 0x0d0b09, roughness: 0.9 });           // 靴底
  const strapM  = new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.7 });           // マスクの革ストラップ
  const bladeM  = new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 0.32, metalness: 0.85 }); // マチェーテの刃
  const handleM = new THREE.MeshStandardMaterial({ color: 0x241f1b, roughness: 0.7 });           // マチェーテの柄
  // 作業着: workClothを流用しつつ、この個体用に法線タイリングを弱めた別インスタンス
  // （furniture側の見た目を変えないようにclone。リブの主張を抑えて「厚手の上着」に見せる）
  const cloth = M.workCloth.clone();
  // リブが「タイヤ積み」に見えないよう法線をかなり弱め、粗さを上げて縞状ハイライトを消す
  if (cloth.normalMap) { cloth.normalScale = new THREE.Vector2(0.22, 0.22); }
  cloth.roughness = 0.97; cloth.metalness = 0.0;
  const cm = (w, h, d, mat, x, y, z, ry = 0) => {   // ローカル簡易ボックス
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m;
  };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); g.add(m); return m;
  };

  // === 脚（わずかに開く。前傾で膝が前に出るイメージ） ===
  for (const s of [-1, 1]) {
    // 太もも
    cyl(0.13, 0.15, 0.55, cloth, s * 0.17, 0.62, 0.02);
    // すね
    cyl(0.11, 0.12, 0.55, cloth, s * 0.19, 0.15, 0.06);
    // ブーツ（甲＋つま先＋底）
    cm(0.22, 0.16, 0.30, boot, s * 0.19, 0.02, 0.12);
    cm(0.22, 0.10, 0.14, boot, s * 0.19, 0.05, 0.30);   // つま先
    cm(0.24, 0.04, 0.46, bootSole, s * 0.19, -0.05, 0.16); // 靴底
  }

  // === 胴（大柄・厚い胸板。太めのバレル型で寸胴に。前傾のため上部を +z へ） ===
  // 上半身は樽のように太く、腰でもあまり絞らない（砂時計に見えないよう rb を大きめに）
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.31, 0.74, 14), cloth);
  torso.position.set(0, 1.22, 0.05); torso.rotation.x = 0.08; g.add(torso);
  // 腹〜作業着の裾（胴とほぼ同径でつなぎ、寸胴の塊に見せる）
  cyl(0.31, 0.32, 0.30, cloth, 0, 0.88, 0.03, 14);
  // 開いたジャケットの前立て（濃い縦帯）
  cm(0.11, 0.70, 0.02, strapM, 0, 1.22, 0.32, 0);

  // === 肩（怒り肩・盛り上がった僧帽筋。太く高く、首の露出を隠す） ===
  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.70, 12), cloth);
  shoulders.position.set(0, 1.60, 0.03); shoulders.rotation.z = Math.PI / 2; g.add(shoulders);
  for (const s of [-1, 1]) cyl(0.14, 0.11, 0.16, cloth, s * 0.33, 1.64, 0.02); // 肩の盛り上がり
  // 立った襟（首の付け根を覆い、細い首が浮かないように。少し高く）
  cyl(0.15, 0.18, 0.16, cloth, 0, 1.75, 0.035, 12);

  // === 首（太い・短い）＋頭 ===
  cyl(0.13, 0.15, 0.12, skin, 0, 1.80, 0.045);
  // 頭は少し縦長の楕円体。露出する頭頂/後頭は暗い頭皮(scalp)にして白いオーブ化を防ぐ。
  // マスクはこの前面に載せる。襟に近づけて neck gap をなくすため 1.90→1.87 に下げる
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 16), scalp);
  head.position.set(0, 1.87, 0.05); head.scale.set(1.0, 1.12, 1.05); g.add(head);

  // --- ホッケーマスク（+z 面に配置）。キャンバスで通気孔・赤シェブロン・目/口スリットを描く ---
  const mcv = document.createElement("canvas");
  mcv.width = 256; mcv.height = 320;
  const mc = mcv.getContext("2d");
  mc.fillStyle = "#9c9070"; mc.fillRect(0, 0, 256, 320);            // 骨色（暗めのクリーム＝強い照明下でも発光しにくい）
  // 経年の汚れ（薄い斑）
  mc.fillStyle = "rgba(74,62,42,0.30)";
  for (let i = 0; i < 40; i++) {
    const rx = 30 + Math.abs(Math.sin(i * 12.9) * 196);
    const ry = 30 + Math.abs(Math.cos(i * 7.7) * 260);
    mc.beginPath(); mc.arc(rx, ry, 3 + (i % 4), 0, Math.PI * 2); mc.fill();
  }
  // 目穴（2つ）と口穴
  mc.fillStyle = "#0a0806";
  mc.beginPath(); mc.ellipse(92, 138, 20, 14, 0, 0, Math.PI * 2); mc.fill();
  mc.beginPath(); mc.ellipse(164, 138, 20, 14, 0, 0, Math.PI * 2); mc.fill();
  mc.beginPath(); mc.ellipse(128, 232, 34, 12, 0, 0, Math.PI * 2); mc.fill(); // 口
  // 通気孔クラスタ（三角配置の小さな黒丸）
  mc.fillStyle = "#12100c";
  const vent = (cx2, cy2) => { mc.beginPath(); mc.arc(cx2, cy2, 4.5, 0, Math.PI * 2); mc.fill(); };
  vent(128, 78); vent(112, 96); vent(144, 96);                       // 額の三角
  vent(128, 186); vent(112, 200); vent(144, 200);                    // 鼻下
  vent(70, 188); vent(186, 188);                                     // 頬
  // 赤い三角シェブロン（額中央から左右へ）
  mc.fillStyle = "#a61d1d";
  const chevron = (cx2, cy2, w2, h2, dir) => {
    mc.beginPath(); mc.moveTo(cx2, cy2); mc.lineTo(cx2 + dir * w2, cy2 + h2 * 0.5);
    mc.lineTo(cx2 + dir * w2 * 0.5, cy2 + h2); mc.closePath(); mc.fill();
  };
  chevron(128, 40, 26, 30, -1); chevron(128, 40, 26, 30, 1);         // 額のV
  chevron(108, 250, 18, 26, -1); chevron(148, 250, 18, 26, 1);       // 顎の左右
  const maskTex = new THREE.CanvasTexture(mcv);
  maskTex.colorSpace = THREE.SRGBColorSpace;
  // マスク本体は半球シェル状（頭の前面に張り付く）
  const maskGeo = new THREE.SphereGeometry(0.205, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const mask = new THREE.Mesh(
    maskGeo,
    // roughnessを上げmetalnessゼロ＝ブルーム閾値0.9で滲まない、樹脂っぽいマット面
    new THREE.MeshStandardMaterial({ map: maskTex, roughness: 0.78, metalness: 0.0 })
  );
  // 半球の開口を +z（正面）へ向ける：デフォルトは +y 開口なので x軸 -90°、さらに少し上向き
  // 頭に合わせ 1.95→1.91。z方向に潰して（scale.z<1）オーブではなく顔型の平たいマスクに
  mask.position.set(0, 1.88, 0.08);
  mask.rotation.x = Math.PI * 0.5 + 0.06;
  mask.scale.set(1.02, 1.05, 0.82);
  g.add(mask);
  // マスク周りの革ストラップ（頭の側面〜後ろ）
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.018, 6, 16), strapM);
  strap.position.set(0, 1.88, 0.02); strap.rotation.y = Math.PI / 2; g.add(strap);

  // === 腕（左右）。太めで大柄。右腕(+x)を下ろしマチェーテ、左腕はやや前へ ===
  // 左腕（-x）：肩→上腕→前腕→拳
  cyl(0.10, 0.09, 0.44, cloth, -0.37, 1.40, 0.06);                  // 上腕
  cyl(0.085, 0.078, 0.42, cloth, -0.41, 1.02, 0.15);                // 前腕（やや前）
  cyl(0.10, 0.10, 0.13, skin, -0.43, 0.80, 0.19);                   // 拳
  // 右腕（+x）：下ろした腕
  cyl(0.10, 0.09, 0.46, cloth, 0.37, 1.38, 0.04);                   // 上腕
  cyl(0.085, 0.078, 0.44, cloth, 0.40, 0.98, 0.06);                 // 前腕
  const rHand = cyl(0.10, 0.10, 0.14, skin, 0.42, 0.76, 0.08);      // 右拳（マチェーテ把持）

  // === マチェーテ（右手に。刃を下向き・やや前へ） ===
  const macheteGrp = new THREE.Group();
  // 柄
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.16, 8), handleM);
  handle.position.y = 0.0; macheteGrp.add(handle);
  // 柄頭
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), handleM);
  pommel.position.y = 0.09; macheteGrp.add(pommel);
  // 刃（下向き。先端に向かって幅が出る片刃のイメージ）
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.60, 0.012), bladeM);
  blade.position.y = -0.40; macheteGrp.add(blade);
  // 刃先の尖り
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.10, 4), bladeM);
  tip.position.y = -0.73; tip.rotation.x = Math.PI; tip.rotation.y = Math.PI / 4; macheteGrp.add(tip);
  // 峰側の背（少し厚み）
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.58, 0.02), bladeM);
  spine.position.set(-0.022, -0.39, 0); macheteGrp.add(spine);
  // 右拳の位置に配置し、わずかに前傾＆外へ倒す
  macheteGrp.position.set(0.42, 0.72, 0.12);
  macheteGrp.rotation.set(0.35, 0, 0.12);
  g.add(macheteGrp);

  // 頭部アセンブリの参照（将来のエフェクト用に保持）
  g.userData.face = head;
  g.userData.mask = mask;

  scene.add(g);
  return g;
}
const monster = makeMonster();
monster.visible = false;

/* ---------- 影フラグ一括設定 ---------- */
scene.traverse(o => {
  if (!o.isMesh) return;
  const mat = o.material;
  const basic = mat && mat.isMeshBasicMaterial;
  o.castShadow = !basic && !(mat && mat.transparent) && !o.userData.noShadow;
  o.receiveShadow = !basic;
}); // 「訪問」のあいだだけ実在する
const WP = [[3.5,0.5],[0,-2.75],[-4.5,-3.5],[-1.75,0],[-5,3.5],[0,2.75],[3.5,4.5],[6.2,-4.0]];
const mob = { x: 0, z: 0, wp: 0, mode: "patrol", lostAt: 0, spokeAt: -99, stuck: 0, active: false };
function spawnMonster() {
  // プレイヤーから遠い候補の中からランダムに出現（毎回同じ場所からは出ない）
  const withD = WP.map((wp, i) => ({ i, wp, d: Math.hypot(wp[0]-ply.x, wp[1]-ply.z) }))
    .sort((a, b) => b.d - a.d);
  const pick = withD[Math.floor(Math.random() * Math.min(3, withD.length))];
  mob.x = pick.wp[0]; mob.z = pick.wp[1]; mob.wp = pick.i;
  mob.mode = "patrol"; mob.lostAt = 0; mob.stuck = 0; mob.active = true;
  monster.visible = true;
  monster.position.set(mob.x, 0, mob.z);
  beep(85, 0.7, "sine", 0.16, 55);
  notice("── 何かが、部屋に入ってきた。", 3.2);
}

/* ---------- 訪問イベント（カクシン様はイレギュラーに来る） ---------- */
const EXIT_POS = { x: 6.2, z: -5.1 };  // 玄関
const visit = {
  state: "none",                        // none | omen | active
  nextAt: 21*60 + 30 + Math.random()*12,  // game-min
  omenLeft: 0, huntLeft: 0, omen: null, leaveT: 0,
};
let aggro = 0, etaxRejects = 0, tearGenuine = 0, clockGlitch = false;
// キー光源を弱め、その分アンビエント/ヘミのフィルで底上げする（壁焼け対策）。
// ユーザー要望で全フェーズをさらに半分の明るさに落とす（夜の暗さを強める）。
// 旧: {1:[0.36,0.72], 2:[0.20,0.48], 3:[0.07,0.3]} → キー/フィルとも 1/2。
const LIGHT_BASE = { 1: [0.18, 0.36], 2: [0.10, 0.24], 3: [0.035, 0.15] };
function applyLights(mul = 1) {
  const [li, am] = LIGHT_BASE[phase];
  roomLights.forEach(l => l.intensity = li * mul * PT_SCALE);
  ambient.intensity = am * 0.4 * (mul === 1 ? 1 : 0.7);
  hemi.intensity = am * 0.38 * (mul === 1 ? 1 : 0.7);
  const f = Math.min(1, (li * mul) / 0.36);   // 器具の発光面も連動して暗くなる
  fixtureMats.forEach(m => m.color.setRGB(0.12 + 0.82 * f, 0.1 + 0.78 * f, 0.08 + 0.64 * f));
}
const OMENS = ["tv", "lights", "clock", "poster"];
function startOmen() {
  visit.state = "omen";
  visit.omenLeft = 9 + Math.random() * 3;
  visit.omen = OMENS[Math.floor(Math.random() * OMENS.length)];
  if (visit.omen === "tv") { M.tv.emissive.setHex(0x8f97a4); beep(210, 0.8, "sawtooth", 0.05, 60); }
  else if (visit.omen === "lights") { applyLights(0.45); beep(90, 0.3, "sine", 0.06); }
  else if (visit.omen === "clock") { clockGlitch = true; }
  else if (visit.omen === "poster") { posterMat.map = posterTexBad; posterMat.map.needsUpdate = true; }
}
function enterVisit() {
  if (mob.active) return;
  visit.state = "active";
  clockGlitch = false;
  if (state === "INSPECT") { closeInspect(); subtitle("──顔を上げた。", 1.8); }
  applyLights(0.1);
  setTimeout(() => { if (mob.active) applyLights(0.6); }, 380);
  thump(0.35);
  spawnMonster();
  visit.huntLeft = [0, 20, 28, 38][phase] + Math.min(12, aggro * 2) + MODES[mode].huntBonus;
  visit.leaveT = 0;
}
function endVisit() {
  mob.active = false; monster.visible = false; mob.mode = "patrol";
  visit.state = "none";
  visit.nextAt = gameMin + 18 - MODES[mode].visitEarly + Math.random() * 14 - Math.min(10, aggro * 1.5);
  restoreRoom();
  notice("……気配が、消えた。", 2.6);
}
function restoreRoom() {
  applyLights(1);
  clockGlitch = false;
  M.tv.emissive.setHex(0x000000);
  posterMat.map = posterTexOk; posterMat.map.needsUpdate = true;
}

/* ---------- player ---------- */
const ply = { x: 6.4, z: -5.2, yaw: Math.PI, pitch: 0, r: 0.33, hidden: false };
const keys = {};
addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "KeyE") tryInteract();
  if (e.code === "Escape") {
    if (state === "INSPECT") closeInspect();
    else if (state === "ETAX") closeEtax();
  }
});
addEventListener("keyup",   e => { keys[e.code] = false; });

/* pointer lock look */
renderer.domElement.addEventListener("click", () => {
  if (state === "PLAY" && !isTouch) renderer.domElement.requestPointerLock();
});
addEventListener("mousemove", e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  ply.yaw   -= e.movementX * 0.0023;
  ply.pitch = Math.max(-1.2, Math.min(1.2, ply.pitch - e.movementY * 0.0023));
});

/* touch controls: dual fixed sticks (FPS style) */
const isTouch = matchMedia("(pointer: coarse)").matches;
if (isTouch) document.body.classList.add("touch");
const stickMove = { x: 0, y: 0 };   // -1..1
const stickLook = { x: 0, y: 0 };   // -1..1 (rate)
function makeStick(el, out) {
  const knob = el.querySelector(".knob");
  let id = null;
  const update = (t) => {
    const r = el.getBoundingClientRect();
    const max = r.width * 0.42;
    let dx = t.clientX - (r.left + r.width/2);
    let dy = t.clientY - (r.top + r.height/2);
    const len = Math.hypot(dx, dy) || 1, cl = Math.min(len, max);
    dx = dx/len*cl; dy = dy/len*cl;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    out.x = dx/max; out.y = dy/max;
  };
  el.addEventListener("touchstart", e => {
    e.preventDefault();
    if (id !== null) return;
    id = e.changedTouches[0].identifier;
    update(e.changedTouches[0]);
  }, { passive: false });
  addEventListener("touchmove", e => {
    for (const t of e.changedTouches) if (t.identifier === id) { e.preventDefault(); update(t); }
  }, { passive: false });
  addEventListener("touchend", e => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      id = null; out.x = out.y = 0;
      knob.style.transform = "translate(-50%,-50%)";
    }
  }, { passive: true });
  addEventListener("touchcancel", e => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      id = null; out.x = out.y = 0;
      knob.style.transform = "translate(-50%,-50%)";
    }
  }, { passive: true });
}
makeStick($("stickL"), stickMove);
makeStick($("stickR"), stickLook);

/* ---------- collision ---------- */
function hitsAny(x, z, r) {
  const all = walls.concat(solids);
  for (const b of all) {
    const cx = Math.max(b.x1, Math.min(x, b.x2));
    const cz = Math.max(b.z1, Math.min(z, b.z2));
    if ((x-cx)*(x-cx) + (z-cz)*(z-cz) < r*r) return true;
  }
  return false;
}
function moveCircle(o, dx, dz, r) {
  if (!hitsAny(o.x + dx, o.z, r)) o.x += dx;
  if (!hitsAny(o.x, o.z + dz, r)) o.z += dz;
}
/* line of sight: segment vs wall AABBs (walls only) */
function los(ax, az, bx, bz) {
  for (const b of walls) {
    let t0 = 0, t1 = 1;
    const dx = bx-ax, dz = bz-az;
    let ok = true;
    const clip = (p, q) => {
      if (p === 0) { if (q < 0) ok = false; return; }
      const t = q / p;
      if (p < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; }
      else       { if (t < t0) ok = false; else if (t < t1) t1 = t; }
    };
    clip(-dx, ax - b.x1); if (ok) clip(dx, b.x2 - ax);
    if (ok) clip(-dz, az - b.z1); if (ok) clip(dz, b.z2 - az);
    if (ok && t0 <= t1) return false;
  }
  return true;
}

/* ---------- audio ---------- */
let AC = null, droneNodes = null;
function audioInit() {
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const g = AC.createGain(); g.gain.value = 0.05; g.connect(AC.destination);
  const mk = f => { const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(g); o.start(); return o; };
  droneNodes = { g, o1: mk(52), o2: mk(54.7) };
}
function beep(freq, dur = 0.12, type = "sine", vol = 0.18, glideTo = null) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, AC.currentTime + dur);
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + dur + 0.02);
}
function thump(vol = 0.5) { beep(58, 0.28, "sine", vol, 40); beep(180, 0.05, "square", vol*0.3); }
function stopDrone() { if (droneNodes) { droneNodes.g.gain.linearRampToValueAtTime(0.0001, AC.currentTime + 1.5); } }

/* ---------- speech ---------- */
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 0.82; u.pitch = 0.4; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { /* no speech — subtitle only */ }
}

/* ---------- minimap ---------- */
const mmCanvas = $("minimap"), mmCtx = mmCanvas.getContext("2d");
const MM_BOUNDS = { minX: -8.3, maxX: 8.3, minZ: -6.3, maxZ: 6.3 };
function mmPos(x, z) {
  return [
    (x - MM_BOUNDS.minX) / (MM_BOUNDS.maxX - MM_BOUNDS.minX) * mmCanvas.width,
    (z - MM_BOUNDS.minZ) / (MM_BOUNDS.maxZ - MM_BOUNDS.minZ) * mmCanvas.height,
  ];
}
function drawMinimap() {
  const ctx = mmCtx, w = mmCanvas.width, h = mmCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#12100c"; ctx.fillRect(0, 0, w, h);
  // 家具（薄く）
  ctx.fillStyle = "rgba(150,138,110,0.3)";
  solids.forEach(b => {
    const [x1, z1] = mmPos(b.x1, b.z1), [x2, z2] = mmPos(b.x2, b.z2);
    ctx.fillRect(x1, z1, x2 - x1, z2 - z1);
  });
  // 壁（部屋の構造）
  ctx.fillStyle = "#5c5747";
  walls.forEach(b => {
    const [x1, z1] = mmPos(b.x1, b.z1), [x2, z2] = mmPos(b.x2, b.z2);
    ctx.fillRect(x1, z1, Math.max(1.6, x2 - x1), Math.max(1.6, z2 - z1));
  });
  // 怪人（追跡中のみ表示＝すでに気配で分かっている情報)
  if (mob.active && mob.mode === "chase") {
    const [mx, mz] = mmPos(mob.x, mob.z);
    ctx.fillStyle = "#d9584a";
    ctx.beginPath(); ctx.arc(mx, mz, 3.4, 0, Math.PI * 2); ctx.fill();
  }
  // プレイヤー（向きつき三角）
  const [px, pz] = mmPos(ply.x, ply.z);
  const fx = -Math.sin(ply.yaw), fz = -Math.cos(ply.yaw);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(Math.atan2(fx, -fz));
  ctx.fillStyle = "#e9dfc0";
  ctx.beginPath();
  ctx.moveTo(0, -5.5); ctx.lineTo(3.6, 4.2); ctx.lineTo(-3.6, 4.2); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------- UI helpers ---------- */
const subtitleEl = $("subtitle"), noticeEl = $("notice"), promptEl = $("prompt");
let subT = 0, noticeT = 0;
function subtitle(t, sec = 3) { subtitleEl.textContent = t; subT = sec; }
function notice(t, sec = 3.6) { noticeEl.innerHTML = t; noticeEl.style.opacity = 1; noticeT = sec; }
function refreshSlots() {
  $("items").innerHTML = ITEMS.map(it =>
    `<div class="slot ${it.taken ? "got" : ""}">${it.short}</div>`).join("");
}
refreshSlots();

/* ---------- interact ---------- */
let nearTarget = null; // {kind:'item'|'fake'|'desk'|'closet', ref}
const CLOSET = { x: -1.6, z: -4.55 };
function findNear() {
  if (ply.hidden) return { kind: "closet" };
  const cand = [];
  ITEMS.forEach(it => { if (!it.taken) {
    const d = Math.hypot(ply.x - it.x, ply.z - it.z);
    if (d < 1.45) cand.push({ d, kind: "item", ref: it });
  }});
  if (!FAKE.taken) {
    const d = Math.hypot(ply.x - FAKE.x, ply.z - FAKE.z);
    if (d < 1.45) cand.push({ d, kind: "fake", ref: FAKE });
  }
  const dd = Math.hypot(ply.x - 6.5, ply.z - (-2.0));
  if (dd < 1.6) cand.push({ d: dd, kind: "desk" });
  const dc = Math.hypot(ply.x - CLOSET.x, ply.z - CLOSET.z);
  if (dc < 1.25) cand.push({ d: dc, kind: "closet" });
  cand.sort((a, b) => a.d - b.d);
  return cand[0] || null;
}
function tryInteract() {
  if (state !== "PLAY" || !nearTarget) return;
  if (nearTarget.kind === "closet") {
    if (ply.hidden) {
      ply.hidden = false;
      $("hideOv").style.display = "none";
    } else {
      const md = Math.hypot(mob.x - ply.x, mob.z - ply.z);
      if (md < 2.2 && mob.mode === "chase") {
        notice("見られている。隠れられない！", 2.2);
        return;
      }
      ply.hidden = true;
      $("hideOv").style.display = "block";
      beep(140, 0.18, "sine", 0.1);
    }
    return;
  }
  if (nearTarget.kind === "item") {
    if (mob.active && mob.mode === "chase") { subtitle("それどころじゃない！", 1.6); return; }
    openInspect(nearTarget.ref);
  } else if (nearTarget.kind === "fake") {
    FAKE.taken = true;
    scene.remove(fakeMesh);
    notice(FAKE.gag);
    beep(240, 0.3, "sawtooth", 0.08, 120);
  } else if (nearTarget.kind === "desk") {
    if (got < 5) {
      notice(`書類がまだ足りない。（${got} / 5）`);
    } else {
      openEtax();
    }
  }
}
promptEl.addEventListener("click", tryInteract);
promptEl.addEventListener("touchstart", e => { e.preventDefault(); tryInteract(); }, { passive: false });

/* ---------- 検分（真贋判定） ---------- */
let inspectIt = null;
function openInspect(it) {
  state = "INSPECT";
  inspectIt = it;
  drawDoc(buildSpec(it));
  $("inspect").classList.remove("hidden");
  document.exitPointerLock && document.exitPointerLock();
  beep(520, 0.08, "triangle", 0.08);
}
function closeInspect() {
  $("inspect").classList.add("hidden");
  if (state === "INSPECT") state = "PLAY";
  inspectIt = null;
}
$("btnTake").addEventListener("click", () => {
  if (!inspectIt) return;
  const it = inspectIt;
  runLog.push({ short: it.short, fake: it.copy.fake,
    anomId: it.copy.fake ? it.copy.anom.id : null,
    act: "take", ok: !it.copy.fake, revealed: false });
  it.taken = true; got++;
  itemMeshes[it.id].visible = false;
  refreshSlots();
  notice(it.gag);
  beep(880, 0.1, "triangle", 0.12); beep(1180, 0.14, "triangle", 0.1);
  closeInspect();
});
$("btnTear").addEventListener("click", () => {
  if (!inspectIt) return;
  const it = inspectIt;
  runLog.push({ short: it.short, fake: it.copy.fake,
    anomId: it.copy.fake ? it.copy.anom.id : null,
    act: "tear", ok: it.copy.fake, revealed: it.copy.fake });
  if (it.copy.fake) registerFound(it.copy.anom.id);
  aggro++;
  if (!it.copy.fake) tearGenuine++;
  it.copy = makeCopy(it, MODES[mode].rp);   // 新しい一枚が湧く（また偽物かもしれない）
  relocateItem(it);
  beep(1600, 0.16, "sawtooth", 0.05, 320); beep(120, 0.2, "sine", 0.08);
  notice("破り捨てた。<br><span style=\"opacity:.65\">……紙を裂く音が、静かな部屋に響いた。</span>", 3);
  closeInspect();
});
$("btnBack").addEventListener("click", () => closeInspect());

/* ---------- e-Tax sequence（審査＝真贋の清算） ---------- */
let etaxTimer = 0;
function openEtax() {
  state = "ETAX";
  etaxTimer = 0;
  $("etaxMsg").textContent = "";
  $("etaxMsg").classList.remove("ok");
  $("etaxBtn").disabled = false;
  $("etax").classList.remove("hidden");
  document.exitPointerLock && document.exitPointerLock();
}
function closeEtax() {
  if (state !== "ETAX") return;
  $("etax").classList.add("hidden");
  state = "PLAY";
}
$("etaxClose").addEventListener("click", closeEtax);
$("etaxBtn").addEventListener("click", () => {
  const btn = $("etaxBtn"), msg = $("etaxMsg"), win = $("etaxWin");
  btn.disabled = true;
  msg.classList.remove("ok");
  msg.textContent = "送信中──審査しています…";
  setTimeout(() => {
    const bad = ITEMS.find(it => it.taken && it.copy.fake);
    if (bad) {
      etaxRejects++; aggro++;
      const why = bad.copy.anom.reject;
      const entry = [...runLog].reverse().find(e =>
        e.short === bad.short && e.fake && e.act === "take" && !e.revealed);
      if (entry) entry.revealed = true;
      registerFound(bad.copy.anom.id);
      bad.taken = false; got--;
      bad.copy = { fake: false, anom: null };  // 差し戻しの再交付は本物（終盤の救済）
      relocateItem(bad);
      refreshSlots();
      msg.innerHTML = `審査結果：<b>却下</b>　『${bad.short}』──${why}。<br>該当書類は差し戻されました。<span style="opacity:.7">……部屋のどこかへ。</span>`;
      win.classList.remove("shake"); void win.offsetWidth; win.classList.add("shake");
      thump(0.3 + etaxRejects * 0.12);
      $("vignette").style.opacity = Math.min(0.9, etaxRejects * 0.25);
      // 却下は、あれを呼ぶ
      if (!mob.active) enterVisit();
      else visit.huntLeft = Math.max(visit.huntLeft, 25);
      const d = Math.hypot(mob.x - 6.5, mob.z + 2);
      if (d > 2.5) { mob.x += (6.5 - mob.x) * 0.3; mob.z += (-2.0 - mob.z) * 0.3; }
      btn.disabled = false;
    } else {
      msg.classList.add("ok");
      msg.textContent = "受付結果：受付完了　受付番号 20260315230000000001";
      beep(660, 0.4, "sine", 0.12); beep(830, 0.4, "sine", 0.1); beep(990, 0.6, "sine", 0.1);
      setTimeout(() => ending("refund"), 2200);
    }
  }, 1400 + Math.random() * 600);
});

/* ---------- endings ---------- */
const EDS = {
  refund: { tag: "還付 END", text: "受付完了。<br>あなたは生き延びた。<br><br>還付金：¥34,120" },
  late:   { tag: "期限後申告 END", text: "3月16日 0:00。<br>怪人は、静かに頭を下げた。<br>「期限後申告について、ご案内します」<br><br>無申告加算税があなたに課された。" },
  sermon: { tag: "説教 END", text: "捕まった。<br><br>あなたは税務署で3時間、丁寧に説教された。<br>担当者は、最後までずっと敬語だった。" },
};
function ending(key) {
  if (state === "END") return;
  state = "END";
  stopDrone();
  try { speechSynthesis.cancel(); } catch (e) {}
  let rankLine = "";
  const firstRefund = key === "refund" && !save.endings.refund;
  if (key === "refund") {
    const pen = etaxRejects * 9000 + tearGenuine * 2500;
    const yen = Math.max(120, MODES[mode].base - pen);
    EDS.refund.text = `受付完了。<br>あなたは生き延びた。<br><br>還付金：¥${yen.toLocaleString()}` +
      (pen === 0
        ? `<br><span style="font-size:.82em;opacity:.75">──完璧な申告。書類を見る目が、あなたを守った。</span>`
        : `<br><span style="font-size:.82em;opacity:.75">──却下${etaxRejects}件、本物の破棄${tearGenuine}件。だいぶ疑われた。</span>`);
    const mistakes = etaxRejects + tearGenuine;
    const left = 23 * 60 + 59 - gameMin;
    const rk = mistakes === 0 ? (left >= 60 ? "S ── 国税査察官" : "A ── 税理士")
             : mistakes <= 1 ? "B ── 経理のベテラン"
             : mistakes <= 3 ? "C ── 一般納税者" : "D ── 駆け込み申告者";
    rankLine = `${mode === "blue" ? "【青色】" : ""}判定ランク　${rk}`;
    const RORDER = ["S", "A", "B", "C", "D"];
    if (!save.bestRank || RORDER.indexOf(rk[0]) < RORDER.indexOf(save.bestRank))
      save.bestRank = rk[0];
  }
  // 答え合わせ＋図鑑
  const rows = runLog.map(e => {
    const truth = e.fake ? (e.revealed ? `偽物〈${anomName(e.anomId)}〉` : "偽物〈？？？〉") : "本物";
    return `<div class="rrow ${e.ok ? "rok" : "rng"}"><span>${e.short}</span><span>${truth} → ${e.act === "take" ? "受理" : "破棄"}</span><span>${e.ok ? "○" : "×"}</span></div>`;
  }).join("");
  save.endings[key] = true; save.runs++;
  persistSave();
  const foundN = Object.keys(save.found).length;
  const newTxt = newFound.length
    ? `<br><span class="new">NEW　${newFound.map(anomName).join("・")}</span>` : "";
  $("recap").innerHTML =
    (runLog.length ? `<div class="rhead">今夜の書類 ── 答え合わせ</div>${rows}` : "") +
    `<div class="zukan">異変図鑑　${foundN} / ${ANOMS.length}${newTxt}</div>` +
    (rankLine ? `<div class="zukan">${rankLine}</div>` : "") +
    (firstRefund ? `<div class="zukan new">高難度モード『青色申告』が解禁された。</div>` : "");
  $("etax").classList.add("hidden");
  $("inspect").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("vignette").style.opacity = 0;
  $("edTag").textContent = EDS[key].tag;
  $("edText").innerHTML = EDS[key].text;
  $("ending").classList.remove("hidden");
  document.exitPointerLock && document.exitPointerLock();
}

/* ---------- monster AI ---------- */
let stepAcc = 0;
function monsterUpdate(dt) {
  if (!mob.active) {
    if (state === "PLAY") $("vignette").style.opacity = 0;
    if (visit.state === "omen") {
      visit.omenLeft -= dt;
      if (visit.omenLeft <= 0) enterVisit();
    } else if (visit.state === "none" && state !== "ETAX" && gameMin >= visit.nextAt) {
      startOmen();
    }
    return;
  }
  const speeds = [0, 1.05, 1.6, 2.3];
  let sp = speeds[phase];
  const sight = [0, 4, 5.5, 7][phase];
  const pd = Math.hypot(ply.x - mob.x, ply.z - mob.z);
  const canSee = !ply.hidden && pd < sight && los(mob.x, mob.z, ply.x, ply.z);

  if (state === "ETAX") {
    // e-Tax中はドアの外で待つ（演出はモーダル側）
  } else if (mob.mode === "leave") {
    visit.leaveT += dt;
    const d = Math.hypot(EXIT_POS.x - mob.x, EXIT_POS.z - mob.z);
    if (d < 0.6 || visit.leaveT > 7) { endVisit(); return; }
    moveCircle(mob, (EXIT_POS.x-mob.x)/d * sp * dt, (EXIT_POS.z-mob.z)/d * sp * dt, 0.4);
  } else if (mob.mode === "patrol") {
    visit.huntLeft -= dt;
    if (visit.huntLeft <= 0) {
      mob.mode = "leave"; visit.leaveT = 0;
    } else if (canSee) {
      mob.mode = "chase";
      if (state === "INSPECT") { closeInspect(); subtitle("──顔を上げると、そこに居た。", 2.2); }
      const now = performance.now()/1000;
      if (now - mob.spokeAt > 10) {
        mob.spokeAt = now;
        subtitle("「提出期限は、3月16日です」", 3);
        speak("提出期限は、3月16日です");
        beep(48, 1.2, "sine", 0.22, 36);
      }
    } else {
      const [tx, tz] = WP[mob.wp];
      const d = Math.hypot(tx - mob.x, tz - mob.z);
      if (d < 0.45) mob.wp = (mob.wp + 1) % WP.length;
      else {
        const ox = mob.x, oz = mob.z;
        moveCircle(mob, (tx-mob.x)/d * sp * dt, (tz-mob.z)/d * sp * dt, 0.4);
        if (Math.hypot(mob.x-ox, mob.z-oz) < sp*dt*0.15) mob.wp = (mob.wp + 1) % WP.length;
      }
    }
  } else { // chase
    sp *= 1.2;
    if (canSee) mob.lostAt = 0;
    else { mob.lostAt += dt; if (mob.lostAt > 2.8) { mob.mode = "patrol"; mob.lostAt = 0; } }
    const d = pd || 1;
    const ox = mob.x, oz = mob.z;
    moveCircle(mob, (ply.x-mob.x)/d * sp * dt, (ply.z-mob.z)/d * sp * dt, 0.4);
    if (Math.hypot(mob.x-ox, mob.z-oz) < sp*dt*0.1) {
      mob.stuck += dt;
      if (mob.stuck > 1.2) { mob.mode = "patrol"; mob.stuck = 0; }
    } else mob.stuck = 0;
    if (pd < 0.95 && !ply.hidden) ending("sermon");
  }

  monster.position.set(mob.x, 0, mob.z);
  monster.lookAt(ply.x, 0, ply.z); // 顔は常にこちらを向く
  // footsteps
  stepAcc += dt * sp;
  if (stepAcc > 1.1) {
    stepAcc = 0;
    const vol = Math.max(0, 0.4 - pd * 0.03);
    if (vol > 0.01) beep(70 + Math.random()*8, 0.09, "sine", vol);
  }
  // 接近ビネット
  if (state === "PLAY") {
    $("vignette").style.opacity = pd < 3.5 ? (1 - pd/3.5) * 0.85 : 0;
  }
}

/* ---------- clock & events ---------- */
function clockUpdate(dt) {
  gameMin += dt * MIN_PER_SEC; // MIN_PER_SEC[game-min/real-sec] → 21:00〜23:59が約6分
  const h = Math.floor(gameMin / 60), m = Math.floor(gameMin % 60);
  const cl = $("clock");
  if (clockGlitch) {
    // 前触れ：時計が壊れる
    cl.textContent = Math.floor(gameMin * 6) % 2
      ? "██:██"
      : `${52 + Math.floor(Math.random()*40)}:${String(Math.floor(Math.random()*90)).padStart(2,"0")}`;
  } else {
    cl.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  cl.classList.toggle("danger", h >= 23 || clockGlitch);
  // 壁掛け時計の針を更新（故障の前触れ中は狂う）
  if (Math.floor(gameMin) !== lastWallMin || (clockGlitch && Math.random() < 0.15)) {
    lastWallMin = Math.floor(gameMin);
    drawWallClock(clockGlitch);
  }

  if (gameMin >= 21*60+30 && !flags.n2130) {
    flags.n2130 = true;
    beep(1320, 0.09, "sine", 0.2); setTimeout(() => beep(1320, 0.09, "sine", 0.16), 160);
    notice("スマホ：<b>【国税庁】確定申告の期限が近づいています</b>");
  }
  if (gameMin >= 22*60 && !flags.n2200) {
    flags.n2200 = true; phase = 2;
    if (!mob.active && visit.state !== "omen") applyLights(1);
    notice("22:00 ── 部屋が、暗くなった気がする。");
  }
  if (gameMin >= flags.tvAt && !flags.tvDone) {
    flags.tvDone = true;
    M.tv.emissive.setHex(0x8fb0e8);
    beep(300, 0.5, "sawtooth", 0.14, 90);
    subtitle("テレビ「確定申告は、お早めに」", 3);
    setTimeout(() => M.tv.emissive.setHex(0x000000), 5000);
  }
  if (gameMin >= 23*60 && !flags.n2300) {
    flags.n2300 = true; phase = 3;
    stopDrone();
    if (!mob.active && visit.state !== "omen") applyLights(1);
    if (visit.state === "none" && !mob.active) visit.nextAt = Math.min(visit.nextAt, gameMin + 2);
    notice("23:00 ── 音楽が、消えた。<br>あと1時間しかない。");
  }
  if (gameMin >= 23*60 + 59) ending("late");
}

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === "PLAY" || state === "ETAX" || state === "INSPECT") {
    if (state === "PLAY") {
      // look (right stick, rate-based)
      if (Math.abs(stickLook.x) > 0.08 || Math.abs(stickLook.y) > 0.08) {
        ply.yaw   -= stickLook.x * 2.7 * dt;
        ply.pitch = Math.max(-1.2, Math.min(1.2, ply.pitch - stickLook.y * 1.9 * dt));
      }
      // move (WASD or left stick) — 隠れている間は動けない
      let fx = 0, fz = 0;
      if (!ply.hidden) {
        if (keys.KeyW) fz -= 1; if (keys.KeyS) fz += 1;
        if (keys.KeyA) fx -= 1; if (keys.KeyD) fx += 1;
        if (Math.abs(stickMove.x) > 0.12 || Math.abs(stickMove.y) > 0.12) {
          fx = stickMove.x; fz = stickMove.y;
        }
      }
      const len = Math.hypot(fx, fz);
      if (len > 0.01) {
        const sp = 3.6 * dt / (len > 1 ? len : 1);
        const sin = Math.sin(ply.yaw), cos = Math.cos(ply.yaw);
        moveCircle(ply, (fx * cos + fz * sin) * sp, (fz * cos - fx * sin) * sp, ply.r);
      }
      clockUpdate(dt);
      // interact prompt
      nearTarget = findNear();
      if (nearTarget) {
        promptEl.classList.remove("hidden");
        promptEl.textContent =
          nearTarget.kind === "desk"   ? (got < 5 ? `PC ── 書類が足りない（${got}/5）` : "［E］e-Taxを開く") :
          nearTarget.kind === "closet" ? (ply.hidden ? "［E］クローゼットを出る" : "［E］クローゼットに隠れる") :
          nearTarget.kind === "item"   ? "［E］書類を検分する" :
          "［E］調べる";
      } else promptEl.classList.add("hidden");
    }
    if (state === "INSPECT") clockUpdate(dt);   // 検分中も時計は止まらない
    monsterUpdate(dt);
    if (state === "ETAX") {
      etaxTimer += dt;
      if (etaxTimer > 40) ending("sermon");
      clockUpdate(dt * 0.4); // 送信中も時間は進む（少しだけ慈悲）
    }

    // camera
    camera.position.set(ply.x, 1.6, ply.z);
    const dir = new V3(-Math.sin(ply.yaw)*Math.cos(ply.pitch), Math.sin(ply.pitch), -Math.cos(ply.yaw)*Math.cos(ply.pitch));
    camera.lookAt(camera.position.clone().add(dir));
    flash.position.copy(camera.position);
    flashTarget.position.copy(camera.position.clone().add(dir.multiplyScalar(6)));

    // item bobbing
    const t = now / 1000;
    for (const id in itemMeshes) {
      const m = itemMeshes[id];
      if (!m.visible) continue;
      m.children[0].rotation.y = t * 1.4;
      m.position.y += Math.sin(t * 2.2) * 0.0009;
    }
    fakeMesh.children[0].rotation.y = t * 1.4;

    drawMinimap();

    // timers
    if (subT > 0) { subT -= dt; if (subT <= 0) subtitleEl.textContent = ""; }
    if (noticeT > 0) { noticeT -= dt; if (noticeT <= 0) noticeEl.style.opacity = 0; }
  }

  filmPass.uniforms.time.value = now / 1000;
  composer.render();
}
requestAnimationFrame(frame);

/* ---------- title: mode select & 記録表示 ---------- */
function refreshTitleMeta() {
  const blueOpen = !!save.endings.refund;
  const mb = $("modeBlue");
  mb.disabled = !blueOpen;
  mb.textContent = blueOpen ? "青色申告" : "青色申告（還付ENDで解禁）";
  const eN = ["refund", "late", "sermon"].filter(k => save.endings[k]).length;
  $("meta").textContent =
    `異変図鑑 ${Object.keys(save.found).length}/${ANOMS.length} ／ エンディング ${eN}/3`
    + (save.bestRank ? ` ／ 最高ランク ${save.bestRank}` : "");
}
refreshTitleMeta();
$("modeWhite").addEventListener("click", () => {
  mode = "white";
  $("modeWhite").classList.add("sel"); $("modeBlue").classList.remove("sel");
});
$("modeBlue").addEventListener("click", () => {
  if ($("modeBlue").disabled) return;
  mode = "blue";
  $("modeBlue").classList.add("sel"); $("modeWhite").classList.remove("sel");
});

/* ---------- start ---------- */
$("startBtn").addEventListener("click", () => {
  MIN_PER_SEC = MODES[mode].mps;
  assignCopies();   // モード確定後に偽物を配り直す
  $("title").classList.add("hidden");
  $("hud").classList.remove("hidden");
  audioInit();
  state = "PLAY";
  if (!isTouch) renderer.domElement.requestPointerLock();
  notice(
    mode === "blue"
      ? "3月15日 21:00 ── 自宅。<br>青色申告。書類は多く、偽物は巧妙だ。<br><span style=\"opacity:.6\">……今夜は、あちらも本気らしい。</span>"
      : "3月15日 21:00 ── 自宅。<br>まだ、何もやっていない。<br><span style=\"opacity:.6\">……今夜の書類は、どこか様子がおかしい。</span>", 4.6);
});

/* debug hook (テスト用) */
window.__dbg = { ply, mob, visit, ITEMS, openInspect, enterVisit, startOmen, ending, save, runLog,
  monster, spawnMonster,   // 検証用: 怪人の直接制御
  st: () => state, gm: () => gameMin, setMin: v => { gameMin = v; },
  setMode: m => { mode = m; } };
