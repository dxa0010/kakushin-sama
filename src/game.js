
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.8);
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
const tatamiTex = makeTex(256, 256, (c, w, h) => {
  c.fillStyle = "#6d6647"; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) {
    c.strokeStyle = `rgba(48,44,26,${0.22 + Math.random() * 0.2})`;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke();
  }
  speckle(c, w, h, 400, "180,170,110", 0.12);
  c.strokeStyle = "#3a3524"; c.lineWidth = 8; c.strokeRect(0, 0, w, h);
  c.strokeStyle = "#2c2818"; c.lineWidth = 2; c.strokeRect(4, 4, w - 8, h - 8);
}, 4, 3);
const wallTex = makeTex(256, 256, (c, w, h) => {
  c.fillStyle = "#736d63"; c.fillRect(0, 0, w, h);
  speckle(c, w, h, 900, "255,250,240", 0.05);
  speckle(c, w, h, 900, "30,28,24", 0.06);
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * w;
    const g = c.createLinearGradient(x, 0, x, h);
    g.addColorStop(0, "rgba(40,36,30,0)");
    g.addColorStop(1, `rgba(40,36,30,${0.05 + Math.random() * 0.08})`);
    c.fillStyle = g; c.fillRect(x, 0, 6 + Math.random() * 18, h);
  }
}, 2, 1);
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
const fabricTex = makeTex(128, 128, (c, w, h) => {
  c.fillStyle = "#3c3a52"; c.fillRect(0, 0, w, h);
  speckle(c, w, h, 1200, "90,88,120", 0.1);
  speckle(c, w, h, 600, "16,15,26", 0.12);
}, 2, 2);
const fusumaTex = makeTex(128, 256, (c, w, h) => {
  c.fillStyle = "#b6ac96"; c.fillRect(0, 0, w, h);
  speckle(c, w, h, 500, "90,80,60", 0.05);
  c.strokeStyle = "#5a4a34"; c.lineWidth = 8; c.strokeRect(0, 0, w, h);
  c.fillStyle = "#3a2f20";
  c.beginPath(); c.ellipse(w - 22, h / 2, 7, 16, 0, 0, Math.PI * 2); c.fill();
});
const nightTex = makeTex(256, 128, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0a1226"); g.addColorStop(1, "#1a2338");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = "#05070f"; c.globalAlpha = 0.85;
  for (let i = 0; i < 9; i++) {
    c.fillRect(i * 30 - 5, h - 20 - Math.random() * 30, 14 + Math.random() * 24, 60);
  }
  c.globalAlpha = 1;
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(220,200,140,${0.15 + Math.random() * 0.45})`;
    c.fillRect(Math.random() * w, h * 0.55 + Math.random() * h * 0.4, 2, 2);
  }
  c.fillStyle = "#e8e4d0"; c.beginPath(); c.arc(w * 0.72, h * 0.26, 11, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#0a1226"; c.beginPath(); c.arc(w * 0.755, h * 0.235, 9.5, 0, Math.PI * 2); c.fill();
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

/* ---------- 実写テクスチャ（three.js examples, MIT） ---------- */
const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb, rx, ry) {
  const t = texLoader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAXANISO;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

/* ---------- materials (PBR) ---------- */
const M = {
  wall:   new THREE.MeshStandardMaterial({ map: wallTex, normalMap: normalFromTex(wallTex, 0.7), roughness: 0.95 }),
  floor:  new THREE.MeshStandardMaterial({
    map: loadTex("./assets/textures/hardwood2_diffuse.jpg", true, 3.2, 4.4),
    bumpMap: loadTex("./assets/textures/hardwood2_bump.jpg", false, 3.2, 4.4),
    roughnessMap: loadTex("./assets/textures/hardwood2_roughness.jpg", false, 3.2, 4.4),
    color: 0x87705a, bumpScale: 0.9, roughness: 0.8, metalness: 0.0,
  }),
  tatami: new THREE.MeshStandardMaterial({ map: tatamiTex, normalMap: normalFromTex(tatamiTex, 1.8), roughness: 0.88 }),
  ceil:   new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.96 }),
  wood:   new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalFromTex(woodTex, 1.4), roughness: 0.58 }),
  woodDark: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a8378, roughness: 0.6 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x2e2a33, roughness: 0.78 }),
  fabric: new THREE.MeshStandardMaterial({ map: fabricTex, normalMap: normalFromTex(fabricTex, 2.0), roughness: 0.97 }),
  white:  new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.85 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.32, metalness: 0.85 }),
  fusuma: new THREE.MeshStandardMaterial({ map: fusumaTex, normalMap: normalFromTex(fusumaTex, 1.2), roughness: 0.9 }),
  paper:  new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.95 }),
  tv:     new THREE.MeshStandardMaterial({ color: 0x101216, emissive: 0x000000, roughness: 0.22, metalness: 0.4 }),
  suit:   new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.82 }),
};
const bookMats = [0x5a3a36, 0x39485a, 0x46543a, 0x585034, 0x3c3a52, 0x6a5a48]
  .map(cc => { const m = new THREE.MeshLambertMaterial({ color: cc }); m.color.offsetHSL(0, -0.22, -0.06); return m; });

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
// floor & ceiling
{
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(17, 13), M.floor);
  fl.rotation.x = -Math.PI/2; scene.add(fl);
  const tat = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), M.tatami);
  tat.rotation.x = -Math.PI/2; tat.position.set(-4, 0.01, -3); scene.add(tat);   // 寝室は畳
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
// ベッド（畳の上に、布団が乱れたまま）
{
  solids.push({ x1: -7.6, z1: -5.6, x2: -4.8, z2: -3.8 });
  aoPatch(-6.2, -4.7, 3.6, 2.5);
  vbox(2.8, 0.28, 1.8, M.woodDark, -6.2, 0.14, -4.7);
  vbox(2.64, 0.2, 1.64, M.white, -6.2, 0.38, -4.7);
  vbox(1.9, 0.16, 1.66, M.fabric, -5.75, 0.5, -4.7, 0.03);
  vbox(0.52, 0.12, 0.72, M.white, -7.25, 0.52, -4.7, 0.15);
}
// キッチン（シンク・コンロ・取っ手）
{
  solids.push({ x1: -7.9, z1: 1.2, x2: -6.2, z2: 5.6 });
  vbox(1.6, 0.86, 4.3, M.woodDark, -7.07, 0.43, 3.4);
  vbox(1.74, 0.06, 4.44, M.metal, -7.07, 0.92, 3.4);
  vbox(0.85, 0.025, 1.05, new THREE.MeshLambertMaterial({ color: 0x24272b }), -7.05, 0.945, 4.35); // シンク
  vcyl(0.028, 0.028, 0.32, M.metal, -7.55, 1.08, 4.35, 8);
  vbox(0.36, 0.05, 0.05, M.metal, -7.4, 1.23, 4.35);
  vcyl(0.14, 0.14, 0.03, M.dark, -7.05, 0.955, 2.25, 12);   // コンロ
  vcyl(0.14, 0.14, 0.03, M.dark, -7.05, 0.955, 2.85, 12);
  vbox(0.03, 0.03, 0.5, M.metal, -6.17, 0.62, 2.4);
  vbox(0.03, 0.03, 0.5, M.metal, -6.17, 0.62, 4.2);
}
// 押入れ（ふすまが、少しだけ開いている）
{
  solids.push({ x1: -2.6, z1: -5.9, x2: -0.6, z2: -5.0 });
  aoPatch(-1.6, -5.15, 2.4, 1.3);
  vbox(2.0, 2.2, 0.86, new THREE.MeshLambertMaterial({ color: 0x14120f }), -1.6, 1.1, -5.46);
  vbox(0.94, 1.98, 0.04, M.fusuma, -2.1, 1.06, -4.99);
  vbox(0.94, 1.98, 0.04, M.fusuma, -1.02, 1.06, -4.96);
  vbox(2.06, 0.1, 0.12, M.woodDark, -1.6, 2.2, -4.98);
  vbox(2.06, 0.05, 0.12, M.woodDark, -1.6, 0.028, -4.98);
}
// ローテーブル＋ラグ＋生活の痕跡
{
  solids.push({ x1: 2.0, z1: 1.6, x2: 3.4, z2: 2.8 });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24),
    new THREE.MeshLambertMaterial({ color: 0x4a302c }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(2.7, 0.015, 2.2); scene.add(rug);
  vbox(1.4, 0.05, 1.2, M.wood, 2.7, 0.7, 2.2);
  [[2.1, 1.7], [3.3, 1.7], [2.1, 2.7], [3.3, 2.7]].forEach(([x, z]) =>
    vcyl(0.035, 0.035, 0.68, M.woodDark, x, 0.34, z, 8));
  vcyl(0.09, 0.08, 0.11, M.white, 2.4, 0.78, 2.0, 10);      // カップ麺
  vcyl(0.055, 0.055, 0.13, M.metal, 3.05, 0.79, 2.45, 10);  // 空き缶
  vbox(0.1, 0.03, 0.22, M.dark, 2.95, 0.74, 1.9, 0.4);      // リモコン
}
// TVボード＋テレビ
{
  solids.push({ x1: 2.6, z1: 5.2, x2: 4.8, z2: 5.7 });
  aoPatch(3.7, 5.15, 2.6, 1.0);
  vbox(2.2, 0.42, 0.5, M.woodDark, 3.7, 0.21, 5.45);
  vbox(0.96, 0.3, 0.02, M.dark, 3.2, 0.2, 5.19);
  vbox(0.96, 0.3, 0.02, M.dark, 4.2, 0.2, 5.19);
  vbox(1.7, 1.0, 0.06, M.dark, 3.7, 1.05, 5.52);
  vbox(1.58, 0.88, 0.02, M.tv, 3.7, 1.05, 5.48);            // 画面（前触れで光る）
  vcyl(0.05, 0.05, 0.14, M.dark, 3.7, 0.49, 5.45, 8);
  vbox(0.6, 0.03, 0.3, M.dark, 3.7, 0.43, 5.45);
}
// PCデスク（モニタ・キーボード・散乱書類・椅子）
{
  solids.push({ x1: 6.0, z1: -2.9, x2: 7.7, z2: -1.7 });
  aoPatch(6.85, -2.3, 2.2, 1.7);
  vbox(1.7, 0.05, 1.2, M.wood, 6.85, 0.76, -2.3);
  [[6.1, -2.85], [7.6, -2.85], [6.1, -1.75], [7.6, -1.75]].forEach(([x, z]) =>
    vbox(0.06, 0.74, 0.06, M.dark, x, 0.37, z));
  vbox(0.86, 0.52, 0.04, M.dark, 6.85, 1.12, -2.62);
  vbox(0.78, 0.44, 0.015, new THREE.MeshLambertMaterial({ color: 0x11151c, emissive: 0x0a1420 }), 6.85, 1.12, -2.59);
  vcyl(0.04, 0.04, 0.1, M.dark, 6.85, 0.83, -2.62, 8);
  vbox(0.55, 0.025, 0.18, M.dark, 6.8, 0.795, -2.12);
  vbox(0.09, 0.025, 0.14, M.dark, 7.38, 0.795, -2.08);
  vcyl(0.05, 0.04, 0.1, M.white, 6.3, 0.84, -2.55, 10);
  for (let i = 0; i < 3; i++)
    vbox(0.28, 0.006, 0.2, M.paper, 6.35 + Math.random() * 0.9, 0.79, -2.35 + Math.random() * 0.4, Math.random() * 1.2);
  // 椅子
  solids.push({ x1: 6.35, z1: -3.6, x2: 6.85, z2: -3.1 });
  vcyl(0.26, 0.26, 0.07, M.fabric, 6.6, 0.46, -3.35, 12);
  vcyl(0.03, 0.03, 0.4, M.metal, 6.6, 0.24, -3.35, 8);
  vbox(0.44, 0.5, 0.06, M.fabric, 6.6, 0.85, -3.58);
  [[0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]].forEach(([dx, dz]) =>
    vbox(0.07, 0.04, 0.07, M.metal, 6.6 + dx, 0.03, -3.35 + dz));
}
// 本棚（本がぎっしり、一冊だけ倒れている）
{
  solids.push({ x1: 7.35, z1: 1.2, x2: 7.95, z2: 3.2 });
  vbox(0.04, 2.2, 2.0, M.woodDark, 7.93, 1.1, 2.2);
  vbox(0.6, 2.2, 0.04, M.woodDark, 7.65, 1.1, 1.22);
  vbox(0.6, 2.2, 0.04, M.woodDark, 7.65, 1.1, 3.18);
  vbox(0.6, 0.04, 2.0, M.woodDark, 7.65, 2.18, 2.2);
  for (let s = 0; s < 4; s++) {
    const yb = 0.06 + s * 0.52;
    vbox(0.56, 0.04, 1.92, M.woodDark, 7.65, yb, 2.2);
    let z = 1.28;
    while (z < 3.05) {
      const bw = 0.07 + Math.random() * 0.06;
      if (Math.random() < 0.14) { z += bw; continue; }   // 抜けた隙間
      const bh = 0.3 + Math.random() * 0.14;
      vbox(0.32, bh, bw, bookMats[Math.floor(Math.random() * bookMats.length)],
        7.7 - Math.random() * 0.05, yb + 0.02 + bh / 2, z + bw / 2);
      z += bw + 0.012;
    }
  }
  vbox(0.32, 0.07, 0.44, bookMats[1], 7.6, 1.65, 2.9, 0.2);   // 倒れた一冊
}
// 玄関ドア
{
  vbox(0.06, 2.1, 0.95, new THREE.MeshLambertMaterial({ color: 0x555a61 }), 7.96, 1.05, -5.15);
  vbox(0.05, 0.04, 0.16, M.metal, 7.9, 1.02, -4.82);
  vbox(0.05, 0.3, 0.06, M.dark, 7.92, 1.85, -5.15);   // ドアクローザー的な影
}
// 窓（月と、遠い街）＋カーテン
{
  vbox(0.06, 1.2, 1.74, M.woodDark, -7.96, 1.72, -2.6);
  const night = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.02),
    new THREE.MeshBasicMaterial({ map: nightTex }));
  night.rotation.y = Math.PI / 2;
  night.position.set(-7.91, 1.72, -2.6); scene.add(night);
  vbox(0.03, 1.02, 0.03, M.metal, -7.9, 1.72, -2.6);
  const rod = vcyl(0.018, 0.018, 2.6, M.metal, -7.84, 2.42, -2.6, 8);
  rod.rotation.x = Math.PI / 2;
  vbox(0.09, 1.5, 0.5, M.fabric, -7.85, 1.68, -3.55);
  vbox(0.09, 1.5, 0.42, M.fabric, -7.85, 1.68, -1.72);
}
// 玄関の郵便物の山
for (let i = 0; i < 7; i++) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.36), M.paper);
  p.position.set(6.9 + (Math.random()-0.5)*0.5, 0.02 + i*0.025, -5.4 + (Math.random()-0.5)*0.5);
  p.rotation.y = Math.random()*0.9;
  scene.add(p);
}
// 壁掛け時計（針はゲーム内時刻と同期）
const clockCv = document.createElement("canvas");
clockCv.width = clockCv.height = 128;
const wallClockTex = new THREE.CanvasTexture(clockCv);
wallClockTex.colorSpace = THREE.SRGBColorSpace;
let lastWallMin = -1;
function drawWallClock(glitch) {
  const c = clockCv.getContext("2d");
  c.clearRect(0, 0, 128, 128);
  c.fillStyle = "#d8d2c2"; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#38342c"; c.lineWidth = 5; c.stroke();
  c.strokeStyle = "#55503f"; c.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    c.beginPath();
    c.moveTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
    c.lineTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
    c.stroke();
  }
  const mins = glitch ? Math.random() * 720 : gameMin % 720;
  const ha = mins / 720 * Math.PI * 2 - Math.PI / 2;
  const ma = (mins % 60) / 60 * Math.PI * 2 - Math.PI / 2;
  c.strokeStyle = "#22201a"; c.lineWidth = 5; c.lineCap = "round";
  c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.cos(ha) * 28, 64 + Math.sin(ha) * 28); c.stroke();
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.cos(ma) * 42, 64 + Math.sin(ma) * 42); c.stroke();
  wallClockTex.needsUpdate = true;
}
drawWallClock(false);
{
  const wc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshLambertMaterial({ map: wallClockTex, transparent: true }));
  wc.position.set(1.4, 2.1, -5.965); scene.add(wc);
}

/* ---------- lights ---------- */
const PT_SCALE = 34;   // r155+のライト物理単位化に伴うスケール（cd換算）
const ambient = new THREE.AmbientLight(0x28283a, 0.85 * 0.32);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x2a3450, 0x0d0a08, 0.85 * 0.3);
scene.add(hemi);
const roomLights = [];
const fixtureMats = [];
[[3.8, 1.0], [-4.5, 3.0], [-5.5, -3.5], [6.5, -5.0]].forEach(([x, z]) => {
  const l = new THREE.PointLight(0xffdca8, 0.55 * PT_SCALE, 9, 2);
  l.position.set(x, 2.5, z);
  l.castShadow = true;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.bias = -0.0015;
  l.shadow.normalBias = 0.06;
  l.shadow.radius = 6;
  l.shadow.camera.near = 0.15;
  l.shadow.camera.far = 10;
  scene.add(l); roomLights.push(l);
  // 照明器具（コード＋シェード＋発光面）── 影キャスト除外
  vcyl(0.012, 0.012, 0.22, M.dark, x, 2.69, z, 6).userData.noShadow = true;
  vcyl(0.16, 0.22, 0.12, M.dark, x, 2.54, z, 12).userData.noShadow = true;
  const fm = new THREE.MeshBasicMaterial({ color: 0xf0e0b8 });
  fixtureMats.push(fm);
  vcyl(0.15, 0.15, 0.02, fm, x, 2.47, z, 12);
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
    new THREE.OctahedronGeometry(0.13),
    new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: color })
  );
  grp.add(core);
  const l = new THREE.PointLight(color, 0.8 * 3.2, 2.6, 2);
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

/* ---------- 怪人「カクシン様」 ---------- */
function makeMonster() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.9, 10), M.suit);
  body.position.y = 0.95; g.add(body);
  // 顔 = 源泉徴収票
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 320;
  const c = cv.getContext("2d");
  c.fillStyle = "#e8e4d8"; c.fillRect(0, 0, 256, 320);
  c.strokeStyle = "#555"; c.lineWidth = 2;
  c.strokeRect(10, 10, 236, 300);
  c.fillStyle = "#222";
  c.font = "bold 26px serif"; c.textAlign = "center";
  c.fillText("源泉徴収票", 128, 46);
  c.font = "11px sans-serif";
  for (let r = 0; r < 6; r++) {
    c.strokeStyle = "#888"; c.lineWidth = 1;
    c.strokeRect(20, 66 + r*40, 216, 34);
  }
  c.fillStyle = "#111";
  c.fillRect(52, 130, 42, 30);   // 目
  c.fillRect(162, 130, 42, 30);  // 目
  const faceTex = new THREE.CanvasTexture(cv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.78),
    new THREE.MeshBasicMaterial({ map: faceTex })
  );
  face.position.set(0, 2.25, 0.01);
  g.add(face);
  g.userData.face = face;
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
const LIGHT_BASE = { 1: [0.55, 0.85], 2: [0.26, 0.55], 3: [0.08, 0.35] };
function applyLights(mul = 1) {
  const [li, am] = LIGHT_BASE[phase];
  roomLights.forEach(l => l.intensity = li * mul * PT_SCALE);
  ambient.intensity = am * 0.32 * (mul === 1 ? 1 : 0.7);
  hemi.intensity = am * 0.3 * (mul === 1 ? 1 : 0.7);
  const f = Math.min(1, (li * mul) / 0.55);   // 器具の発光面も連動して暗くなる
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
          nearTarget.kind === "closet" ? (ply.hidden ? "［E］押入れを出る" : "［E］押入れに隠れる") :
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
  st: () => state, gm: () => gameMin, setMin: v => { gameMin = v; },
  setMode: m => { mode = m; } };
