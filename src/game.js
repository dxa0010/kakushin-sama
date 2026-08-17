
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
// 音の生成エンジン（ゲーム非依存。tools/audio-lab.html から単体試聴できる）
import * as Audio from "./audio.js";
const { beep, thump, footstep, heartbeat, clockTick, speak,
        setVolume, toggleMute, audioPrefs } = Audio;
// マイナンバーカード暗証番号ロジック（ゲーム非依存の純粋モジュール。tests/unit/pin.test.js で単体検証できる）
import { createPinGate, normalizePin } from "./pin.js";
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
    // 【暗証番号の手掛かり①：形式】必須アイテムなので、桁数と「数字だけ」は必ず伝わる
    // 900px幅で1行あたり約30字で折り返すので、<br>で区切って収める（以下のギャグも同様）
    gag: "マイナンバーカード。電子証明書の期限は……セーフ。<br>あと2ヶ月だった。暗証番号は4桁。数字だけの、あれだ。" },
  { id: "reader",   short: "リーダー",  x:  3.6, z:  5.35, y: 0.75,
    gag: "ICカードリーダー。テレビの裏に落ちていた。3年前に買って、使ったのは1回だけ。" },
  { id: "password", short: "パスワード", x:  7.0, z:  2.0, y: 1.55,
    // 【暗証番号の手掛かり②：探索への誘導】『いつもの』で行き止まりにしないための一文。
    // ダミー3種のギャグに手掛かりを仕込んであるので、部屋を見て回る動機をここで作る
    gag: "e-Taxパスワードのメモ。『いつもの』と書いてある。どれだ。<br>……他の紙にも書き残していた気がする。<br>部屋に、何か落ちていなかったか。" },
];
// 無駄なアイテム（ダミー）：本物と紛らわしくするため、見た目（色）は本物と統一している
// （マーカーの色で本物/ハズレを見分けられてしまうと成立しないため）。バリエーション3種。
//
// 【暗証番号の手掛かり③：ダミーは「拾い損」ではなくなった】
// 以前はギャグを1つ言って消えるだけの完全な行き止まりだったので、暗証番号（0315）へ至る
// 3つの手掛かりをここに分散させた。3つ揃うと「いつもの4桁＝日付＝3月15日」に辿り着く：
//   ふるさと納税 → どこも同じ4桁を使い回している（＝『いつもの』の正体は1つの数字）
//   医療費（去年） → その4桁は**日付をそのまま並べただけ**（＝形式がMMDDだと分かる）
//   牛丼屋       → その日付は毎年3月14〜15日（＝どの日付なのかが分かる）
// **ダミーは任意取得**なので、これらが無くても氏名（全書類に印字）＋メモ『いつもの』＋
// 4桁マスクで解けるようにはなっている。ここは「拾えば楽になる」ご褒美の層。
const FAKES = [
  { x: 2.5, z: 5.0, y: 0.35, taken: false,
    gag: "ふるさと納税の証明書……ワンストップ特例で提出済みだ。<br>寄付サイトのログインも『いつもの』にした。<br>どのサイトも、同じ4桁を使い回している。" },
  { x: -4.3, z: -3.3, y: 0.35, taken: false,
    gag: "医療費控除の明細書……よく見たら去年の日付だった。<br>去年もこの時期、同じ4桁を打ち込んだ。<br>日付をそのまま並べただけの、覚えやすいあれを。" },
  { x: 0.3, z: 2.6, y: 0.35, taken: false,
    gag: "領収書の束——中身は全部、深夜の牛丼屋のものだった。<br>日付は毎年、3月14日と15日に集中している。<br>この2日だけ、生活が壊れる。" },
];
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
    // 暗証番号は実物の利用者証明用電子証明書と同じ4桁（8個だと桁数の誤誘導になる＝A-2）
    rows: [["利用者識別番号", "1234 5678 9012 3456"], ["暗証番号", "＊＊＊＊"], ["メモ", "『いつもの』"]] },
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
      return Object.assign({ found: {}, endings: {}, runs: 0, bestRank: "", audio: null }, s);
  } catch (e) {}
  return { found: {}, endings: {}, runs: 0, bestRank: "", audio: null };
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
/* 書類の描画は Canvas 手描きに戻してある（v22）。
   一度は写真ベースの用紙テクスチャ（doc_*.jpg）を背景に敷いたが、紙の柄が
   項目欄の罫線・文字と干渉して**異変が読めなくなった**。このゲームは「どこか
   一箇所ありえない」を見抜くのが本編なので、背景の質感より可読性が優先される。
   assets/textures/doc_*.jpg / stamp_curse.jpg は参照していない（ファイルは残置）。 */
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
  // RoomEnvironment は明るい白スタジオなので、これを上げると床・壁が一律に
  // 白っぽく底上げされて夜の暗さが死ぬ。0.12→0.06（金属の映り込みは残る程度）。
  scene.environmentIntensity = 0.06;
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

/* ---------- 環境遮蔽（GTAO・v20で追加） ----------
   この部屋は夜で、面と面が「接している」ことを示す手掛かりが影しかない。
   点光源のシャドウマップは数十cm〜mスケールの落ち影しか作れないので、
   机の脚と床・マグと天板・本と本の隙間・棚の内側といった数cmスケールの接触部が
   一切暗くならず、物が「乗っている」ではなく「浮いている」ように見えていた。
   （`aoPatch()` が床に半透明パッチを貼っていたのは、この不在の応急処置。）

   ブルームより前に置く：AOで暗くしてから、残った明部だけを滲ませる。
   逆順にするとAOが滲みを削って、光源のグローが痩せる。

   半径と強度は tools/shot-ao.mjs で off / 0.6・0.9・1.2 × 半径 0.20・0.35 を撮り比べて決めた。
   狭い部屋では半径を大きくすると「接触部が暗くなる」ではなく「領域全体が煤ける」方向に効き、
   0.35 ではモニタの黒ベゼルが背景に溶けて輪郭を失った。0.20 が接触影として最も素直。 */
const AO_RADIUS    = 0.20;   // m。本と本の隙間(1〜3cm)〜家具の接地部を拾う。上げると部屋全体が煤ける
const AO_INTENSITY = 0.9;    // 1.2 は暗部が潰れて造形が消える。0.6 は棚の奥行きが出きらない
const aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
aoPass.output = GTAOPass.OUTPUT.Default;
aoPass.blendIntensity = AO_INTENSITY;
aoPass.updateGtaoMaterial({
  radius: AO_RADIUS,
  distanceExponent: 1.0,
  thickness: 0.3,        // 薄い板（紙・本の表紙）の裏まで遮蔽が回り込まないように小さく
  distanceFallOff: 1.0,
  scale: 1.0,
  samples: 16,
  screenSpaceRadius: false,   // 半径はワールド単位で解釈させる（部屋の実寸に合わせるため）
});
aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
composer.addPass(aoPass);

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
// diffuse/normal/roughness の3枚組を一括ロード（ambientCG命名規則: {name}_{diffuse,normal,roughness}）
//
// 【拡張子について】既定は webp。v13でテクスチャを再圧縮し、読み込み量を 15.8MB → 4.1MB に落とした。
// ただし **plaster017 / fabric001 / hardwood2_diffuse は .jpg のまま残してある**。この3つは
// 初期バッチで既に適正な品質（q0.8〜0.85相当）で圧縮済みで、webp化しても縮まないか逆に増える
// （実測: fabric001_normal は webp q0.82 でちょうど元と同サイズ）。ここを無理に webp 化すると
// 再エンコードによる世代劣化を受けるだけで得がない。**「全部 webp に統一したい」という理由で
// 変換し直さないこと。** 逆に後期バッチ（fabric049/leather030/cardboard001/metal063/
// concrete034/plastic011）は実質無圧縮に近い状態で入っていたので、webp化で 1/5 以下になった。
function loadPBRSet(baseName, rx, ry, ext = "webp") {
  return {
    map:          loadTex(`./assets/textures/${baseName}_diffuse.${ext}`, true, rx, ry),
    normalMap:    loadTex(`./assets/textures/${baseName}_normal.${ext}`, false, rx, ry),
    roughnessMap: loadTex(`./assets/textures/${baseName}_roughness.${ext}`, false, rx, ry),
  };
}

/* 布の「面の質」だけを足すセット（v23）。fabric001 の法線＋ラフネスのみで、
   **拡散マップは意図的に外している**。
   ・fabric001_diffuse の平均は sRGB 194（リニア 0.52）。three.js は color に乗算するので、
     マップを足すと反射率がほぼ半分になる。淡い寝具（0xcfc7b6 など）で明るさを保つには
     color を sRGB で 1.34 倍しないと釣り合わず、それは 255 を超えて破綻する。
     つまり淡い布に拡散マップを足すと必ず暗く濁る。色は「のっぺり白い塊」を避けるために
     素材ごとに選んだ値なので、そこは動かさない。床の roughnessMap を外したのと同じ判断
     （マップは「一式だから」ではなく「何を足すか」で選ぶ）。
   ・代わりに布の皺は法線で出す。fabric001_normal の RG は 98〜163（中心 128）で、
     傾きにして ±0.24 程度＝実物どおり控えめ。薄暗い室内・1.5m 離れだと素の
     normalScale=1 ではほぼ見えないので、布ごとに 2.0〜3.0 まで上げる。
     タイルの大きさの決め方は M.mattress のところに書いた（10cm では見えない）。
   ・roughnessMap は 193〜221（=0.76〜0.87）。乗算されるので base roughness は 1.0 に置き、
     実効 0.76〜0.87 に収める。この程度の揺らぎが糸に沿った弱い艶になり、これが無いと
     どんな色でも「塗った板」に見える。床で問題になった低ラフネスの筋とはレンジが違う。 */
function clothSurf(rx, ry, normalScale) {
  return {
    normalMap:    loadTex("./assets/textures/fabric001_normal.jpg", false, rx, ry),
    roughnessMap: loadTex("./assets/textures/fabric001_roughness.jpg", false, rx, ry),
    normalScale:  new THREE.Vector2(normalScale, normalScale),
    roughness:    1.0,
  };
}

/* ---------- materials (PBR) ---------- */
const M = {
  wall:   new THREE.MeshStandardMaterial({
    ...loadPBRSet("plaster017", 4.6, 1.8, "jpg"),   // jpgのまま（理由は loadPBRSet のコメント）
    color: 0x8a8578, roughness: 0.92,
  }),
  floor:  new THREE.MeshStandardMaterial({
    // 床は最も目に付く面なので拡散マップは jpg のまま（webp化しても14%しか縮まない）。
    // バンプはグレースケールで劣化が見えないため webp 化した（115KB→32KB）。
    map: loadTex("./assets/textures/hardwood2_diffuse.jpg", true, 3.2, 4.4),
    bumpMap: loadTex("./assets/textures/hardwood2_bump.webp", false, 3.2, 4.4),
    // 【roughnessMap を意図的に外している】hardwood2_roughness.jpg は板面がかなり
    // 低ラフネス（つや有り）で、three.js は roughness に**乗算**するため、roughness を
    // 1.0 まで上げても板目に沿った細い白い鏡面の筋が残る（実測：0.92 も 1.0 も筋が出る）。
    // 「床が白い反射光で光る」の直接原因だったので、マップを外して一律つや消しにした。
    // 板の質感は diffuse + bumpMap で足りている。復活させるならJPEG側のレンジを
    // 0.8〜1.0 に持ち上げてから使うこと。
    color: 0x726b62, bumpScale: 0.9, roughness: 0.95, metalness: 0.0,   // グレイッシュな茶（彩度を落とした板色）
  }),
  ceil:   new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.96 }),
  wood:   new THREE.MeshStandardMaterial({ map: woodTex, normalMap: normalFromTex(woodTex, 1.4), roughness: 0.58 }),
  woodDark: new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a8378, roughness: 0.6 }),
  dark:   new THREE.MeshStandardMaterial({ color: 0x2e2a33, roughness: 0.78 }),
  fabric: new THREE.MeshStandardMaterial({
    ...loadPBRSet("fabric001", 1.6, 1.6, "jpg"),   // jpgのまま（理由は loadPBRSet のコメント）
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
  /* --- 寝具（v23で材を入れ直した） ---
     v22で部品を減らしたら「積み木」は消えたが、こんどは布に見えないのが露わになった。
     原因は形ではなく材だった：マットレス・敷きシーツ・枕は**マップが1枚も無い**単色で、
     どれだけ色を分けても「塗った板」にしか見えない。掛け布団だけは fabric001 を貼って
     いたが `repeat 1.2`＝1面に1タイルなので、10cm 相当の織り目が 80cm まで拡大され、
     布ではなく**革のムラ**に見えていた。
     【repeat は「面あたりのタイル数」であって物理寸法ではない】RoundedBoxGeometry の UV は
     面ごとに 0..1 なので、同じ repeat を寸法の違う部品に使うと織り目の大きさが揃わない。
     以下は全部「1タイル≒26cm」から逆算した値（例：掛け布団の天面 0.96×1.20m → 3.7×4.6）。
     部品の寸法を変えたら repeat も直すこと。
     【なぜ物理的に正しい 10cm ではなく 26cm なのか】最初は実物の目付から逆算して
     「1タイル=10cm」（掛け布団なら 9.6×12）にしたが、撮ってみると**完全に見えなかった**。
     1024px のテクスチャに織り糸は約300本、つまり1本3px。10cm タイルは画面上で 40px 程度
     なので1本 0.12px——ミップマップで平均化されて無地になる。実物でも 2m 離れて糸は
     見えないのだから当たり前で、その距離で布に見えているのは糸ではなく**皺**のほう。
     fabric001 には撮影時の折り皺が 1/3 タイルくらいの大きさで写っており、26cm タイルなら
     それが 8〜9cm の陰影として残る。逆に旧 1.2（=80cm タイル）では皺が 25cm に拡大されて
     布ではなく「革のムラ」に見えていた。**見えるかどうかは画面上のピクセル数で決めること。** */
  mattress: new THREE.MeshStandardMaterial({
    ...clothSurf(3.4, 7.1, 2.0),                   // 0.88×1.84m。張り地は皺が出にくいので控えめ
    color: 0xd6d0c0,                                                                                // マットレスの生成り
  }),
  sheet:    new THREE.MeshStandardMaterial({
    ...clothSurf(3.5, 7.2, 2.6),                   // 0.92×1.86m（v24で拡大）。綿は光を拾うので強め
    color: 0xcfc7b6,                                                                                // 敷きシーツ（少しグレイッシュ）
  }),
  /* 掛け布団だけ fabric049（キルト＝格子に刺し縫いした布）の**法線だけ**を使う（v24）。
     v23 では fabric001 の3枚組を貼っていたが、撮ると布ではなく「なめし革のクッション」に
     見えた。3枚それぞれを測って切り分けた（測定は tools/texstat.mjs）:
     ・fabric001_normal の傾きは ±0.24 しかない。1.5m 離れた薄暗い室内では normalScale を
       3 倍に上げてもまだ**画に出ない**（撮影で確認）。革に見えていたのは織り目ではなく
       拡散マップのムラのほうだった。
       → fabric049_normal は RG が 29〜230（傾き ±0.8）で 3.3 倍強い。しかも模様が
         「格子の刺し縫い＋膨らんだパネル」という**キルト布そのもの**なので、掛け布団の
         絵として正しい。normalScale は 1.2 に抑える（元が強いので上げるとラップを
         掛けたような金属光沢になる）。
     ・拡散マップは**入れない**。fabric049_diffuse の平均は sRGB 59（リニア 0.044）。
       three.js は color に乗算するので、足すと反射率が 1/23 になり、布団色を保つには
       color を 20 倍しないと釣り合わない＝破綻する。fabric001 の拡散を足す手もあるが、
       そちらは 26cm タイルでは画に出ないと撮影で分かっている（暗くなるだけで得がない）。
       単色でも困らないのは、面の質を法線が、輪郭を drape の裾が受け持つから。
     ・ラフネスマップも**入れない**。fabric049_roughness の平均は 0.43（79〜210）で、
       乗算されるので base をどう上げても実効 0.43 前後＝つやのある面になる。v23 で
       「革に見える」と判断した幅の広いハイライトはこれが主因なので外し、roughness は
       0.95 の単一値に置く。布に鏡面ローブは出ない。（床の roughnessMap を外したのと
       同じ判断＝マップは「一式だから」ではなく「何を足すか」で選ぶ）
     タイルの大きさ: fabric049 は1枚に格子が 8×8 並んでいる。実物のキルトのパネルは
     15〜25cm なので 20cm を狙い、天面 1.28×1.20m に対して 6.4×6.0 パネル
     → repeat は 6.4/8 = 0.80、6.0/8 = 0.75。**1 未満＝1枚を使い切らない**ので天面に
     タイルの継ぎ目が出ない（シームレス素材なので途中で切っても成立する）。
     色は v23 の見え方を保つ値。旧 0xa89478 に拡散マップ（リニア 0.52）が乗って実効 0.22
     だったので、マップを外すぶん sRGB で 0.75 倍して 0x7e6f5a とする。結果として
     シーツの白との明度差が大きくなり、裾の輪郭がはっきり読めるようになった。 */
  blanket:  new THREE.MeshStandardMaterial({
    normalMap:   loadTex("./assets/textures/fabric049_normal.webp", false, 0.80, 0.75),
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: 0x7e6f5a, roughness: 0.95,                                                               // 掛け布団: くすんだオートミール茶を拡散マップ無しに換算した値
  }),
  pillow:   new THREE.MeshStandardMaterial({
    ...clothSurf(2.0, 1.4, 2.4),                   // 0.52×0.36m。枕カバーも同じ 26cm タイル相当
    color: 0xe4ddcc,                                                                                // 枕（マットレスより明るい白）
  }),
  /* --- 机まわり専用（高精細化用） --- */
  plastic:  new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5, metalness: 0.05 }),   // 家電の樹脂（モニタ枠・キーボード土台）
  keycap:   new THREE.MeshStandardMaterial({ color: 0x35373d, roughness: 0.62 }),                   // キーキャップ（土台よりわずかに明るいグレー）
  screen:   new THREE.MeshStandardMaterial({ color: 0x0b0e14, emissive: 0x3a5f96, emissiveIntensity: 1.7, roughness: 0.5, metalness: 0.0 }),  // 液晶面（青白くはっきり点灯。机の主光源。つや消しで映り込みの白点を抑える）
  ceramic:  new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.35, metalness: 0.0 }),   // マグカップの陶器（少しつや）
  penBody:  new THREE.MeshStandardMaterial({ color: 0x202227, roughness: 0.55 }),                   // ペン軸
  // デスクライトの傘（黒）。openEnded のコーンなので DoubleSide が必須。片面だと口を
  // のぞく角度で内壁も外壁も裏面カリングされ、法線がグレージングする細い帯＝「黒い板」
  // にしか見えなくなる（撮影で確認）。
  lampShade:new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }),
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
/* 布用の分割ボックス（v24）。面を格子に切った素の BoxGeometry。角は丸めない。
   【なぜ rbox ではなく専用のものが必要か】**RoundedBoxGeometry は面の中に頂点を持たない。**
   実装（vendor/three/addons/geometries/RoundedBoxGeometry.js:128-130）は、単位立方体の
   頂点を全部
       positions = box * Math.sign(position) + normal * radius     （box = 寸法/2 - radius）
   に写す。sign() で潰れるので、x 座標は必ず ±(寸法/2 - radius) ± radius の範囲に入り、
   **面の中央付近に頂点が1つも存在しない**。segments が細かくするのは角の丸みだけで、
   平面部分は最初から最後まで**1枚の四角**のまま（コンストラクタの
   「ensure it's odd so that we have a plane connecting the rounded corners」がそれ）。
   v23 で drape の fold（面の中のうねり）がどの画角でも見えなかったのは、天井灯が真上だから
   ではなく——**動かす頂点が無かったから**だった。当時「傾き20°では陰影が数%しか変わらない」
   と書いたが、それは検証していない推測で、原因の切り分けを誤っていた。逆に edge（輪郭の
   揺らぎ）だけが効いたのも同じ理由で説明がつく：稜線には頂点があるから。
   seg を上げても無駄なうえ、頂点だけ増える（掛け布団は seg=14 で 30276 頂点あったが、
   下の分割ボックスなら 2410 頂点で面の中まで動く）。
   角丸を捨てる副作用は布にとっては都合がよい。r=0.055 の面取りは v23 の撮影で
   「張り込んだクッション（＝革の椅子）」に見える主因のひとつだった。実物の掛け布団・
   シーツの縁は縫い目で、丸くはない。柔らかさは面取りではなく drape の dome と裾で出す。
   分割数は「変位の波長の 1/4 以下の間隔」で決める（fold の波長 39cm なら 10cm 以下、
   裾の帯 18cm なら 4.5cm 以下 → 実際は 4cm 程度にしてある）。 */
function cbox(w, h, d, mat, x, y, z, ry = 0, nx = 24, ny = 2, nz = 24) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, nx, ny, nz), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m); return m;
}
/* 布のうねり（v23）。**部品を足さずに**面の中へ低い周波数の起伏を作る。
   織り目（法線マップ）が数cmの細かさ、部品の輪郭が1mの大きさで、その中間——
   20〜40cm の「たわみ」だけがどこにも無かった。中間が無い面は、どの角度から見ても
   陰影が一定なので、色や織り目をいくら足しても平らな板に見える。
   v20〜v21 は同じ問題を「畝を7本の薄い箱で足す」で解こうとして積み木になった。
   今回は箱を増やさず、**メッシュ1個の頂点そのものを y に押し引きする**。
   README の「有機的な形は頂点を動かして作る」（正20面体を法線方向に変位させる手法）を
   直方体に適用したもの。
   ・RoundedBoxGeometry は非インデックスなので、同じ座標の頂点が複数ある。変位量を
     **座標だけの関数** h(x,z) にしておけば重複頂点も必ず同じ値になり、面の継ぎ目が割れない。
     （インデックス化して溶接する必要がない、というのがこの書き方の利点）
   ・変位は天端で最大、底面でゼロになるよう y で重み付けする（w=0..1）。底面を動かさないので、
     マットレスとシーツ・シーツと掛け布団の**意図的な食い込み（数cm）が保たれる**。
     全体を上下させると +側で食い込みが解けて隙間が開く。
   ・法線は computeVertexNormals() では**駄目**。非インデックスなので面法線になって
     角丸がカクカクに割れる。代わりに写像のヤコビアン J の逆転置 J⁻ᵗ で既存の滑らかな
     法線を厳密に変換する（deform() 側）。
   ・**面の中に頂点が無いメッシュに掛けても何も起きない**。だから布は rbox ではなく
     cbox（分割ボックス）で作る。理由と経緯は cbox のコメントに書いた。
     分割の間隔は変位の波長の 1/4 以下にする。 */

/* 任意の変位場でメッシュを歪める。disp(x,y,z) → [dx,dy,dz]（ローカル座標）。
   ヤコビアンは中心差分で数値的に作って three.js の Matrix3 で逆転置する。解析微分を
   手で書くと変位場を触るたびに導関数も直す必要があり、そこを間違えると「形は正しいのに
   陰影だけおかしい」という一番気付きにくいバグになる。頂点数万・起動時1回だけなので
   数値微分（1頂点あたり disp を7回）で十分。 */
function deform(mesh, disp) {
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
  const src = pos.array.slice();     // 変位は「元の座標」の関数なので、書き戻す前に元を退避する
  const J = new THREE.Matrix3(), n = new THREE.Vector3(), eps = 1e-3, m = new Array(9);
  for (let i = 0; i < pos.count; i++) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    const d = disp(x, y, z);
    pos.setXYZ(i, x + d[0], y + d[1], z + d[2]);
    for (let c = 0; c < 3; c++) {                       // 列 c = 元の座標での偏微分
      const p = [x, y, z], q = [x, y, z];
      p[c] += eps; q[c] -= eps;
      const dp = disp(p[0], p[1], p[2]), dq = disp(q[0], q[1], q[2]);
      for (let r = 0; r < 3; r++)                       // 行 r = 写像の成分
        m[r * 3 + c] = ((p[r] + dp[r]) - (q[r] + dq[r])) / (2 * eps);
    }
    J.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]).invert().transpose();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(J);
    // 行列式が0だと Matrix3.invert() は零行列を返す。そのときは元の法線を残す（真っ黒を防ぐ）
    if (n.lengthSq() > 1e-12) { n.normalize(); nor.setXYZ(i, n.x, n.y, n.z); }
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  g.computeBoundingSphere(); g.computeBoundingBox();
  return mesh;
}

/* 布の変位場。原点中心のボックス前提（cbox が作るもの）。
   ・fold: 主なうねりの振幅[m]。正弦3本の和で、1本目が幅方向に走る畝、2本目が直交する
     長い波、3本目が斜め成分。**3本目が無いとコーデュロイに見える**（v21 で薄い箱7本の
     畝を並べて失敗したのと同じ絵になる）。だから波長も詰めすぎない。
   ・edge: 天端の輪郭を水平（x/z）に揺らす振幅[m]。輪郭が波打つのは光の向きにも視点にも
     依存しないので、どのカットでも効く。
     （v23 ではこれ**だけ**が効いて fold が全く出ず、「天井灯が真上だから面の傾きは陰影に
       乗らない」と結論したが、これは誤診だった。本当の理由は rbox の面の中に頂点が無く、
       稜線にしか頂点が無かったこと＝edge しか動かせなかったこと。cbox のコメント参照。）
   ・dome: 周縁ほど天端を下げる量[m]。実物の掛け布団は中央（＝下の身体とマットレス）で
     厚く、縁で薄くなって垂れる。厚みが端まで一定だと「もう1枚のマットレス」に見える。
   ・変位は天端で最大、底面でゼロ（w=0..1）。底面を動かさないので寝具どうしの
     **意図的な食い込み（数cm）が保たれる**。全体を上下させると＋側で隙間が開く。

   ・sx / sz / drop / thin / hemWave: **裾の垂れ（v24）。ここが本命。**
     v23 で fold と edge を入れても、まだ「革のクッション」「白いプラ板」に見えていた。
     原因は、寝具が全部**マットレスの天端で水平に終わっている**ことだった。実物の寝具の
     いちばん強い手がかりは織り目でも皺でもなく、**縁が下へ垂れて側面を隠していること**で、
     これは輪郭（シルエット）の情報なので、法線マップでは絶対に作れない。
     天井灯がほぼ真上という条件下では陰影は当てにならず（fold が効かなかった理由）、
     輪郭だけが光の向きと視点に依存せず必ず読める。
     ・sx: ローカル x で「下に支えがある」半幅[m]。これを超えた帯を下へ落とす。
       マットレス半幅より少し内側に取ると、縁がマットレスに食い込んで**掴む**形になり、
       浮いて見えない（柔らかい物どうしは数cm重ねる、という既存の方針と同じ）。
     ・sz: 同じく +z（足側）だけの限界。頭側は下に必ずマットレスがあり、しかも枕と
       ヘッドボードで隠れるので落とさない。だから z は片側だけ。
     ・drop: 裾の落差[m]。thin: 落ちながら薄くなる量[m]（天端側だけ余分に下げる）。
       厚みが一定のまま垂れると「巻いた縁」に見えるので、裾は薄くする。
     ・hemWave: 裾の落差を裾に沿って±この割合で揺らす。裾線が波打つ＝これがそのまま
       シルエットの揺れになる。edge（水平方向の揺らぎ）は w で減衰させてあるので
       裾では効かない。裾の波はこちらで作る。
     ・落差の profile は t²。t=0 で傾き0なので肩が丸くなり、外側で急に落ちる。
       線形だと折り目が一本の直線になって「折り紙」に見えた。
     ・**裾の変位は w で減衰させない**（帯の下端まで一緒に落とす）。支えのある範囲では
       s=0 なので、上に書いた食い込みの保証はそのまま生きる。
     ・裾の帯には**分割数が要る**。帯の幅を4分割以上で刻めるまで rbox の seg を上げること。
       足りないと裾が1本の鋭い折れ線になる。 */
function drape(mesh, { fold = 0, kx = 15, kz = 9, phase = 0, edge = 0, dome = 0,
                       sx = Infinity, sz = Infinity, drop = 0, thin = 0, hemWave = 0 } = {}) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const y0 = bb.min.y, H = Math.max(bb.max.y - y0, 1e-6);
  const ax = Math.max(bb.max.x, 1e-6), az = Math.max(bb.max.z, 1e-6);   // 原点中心なので max が半寸法
  // 裾の帯。sx/sz を省略（Infinity）すると帯幅 0 になり、下の t は常に 0＝垂れなし。
  const bx = Math.min(sx, ax), bz = Math.min(sz, az);
  const spanX = Math.max(ax - bx, 1e-6), spanZ = Math.max(az - bz, 1e-6);
  return deform(mesh, (x, y, z) => {
    const w = (y - y0) / H;
    const u = x / ax, v = z / az;                                       // -1..1 に正規化した面内座標
    const dy = fold * (0.60 * Math.sin(kx * x + phase) * (0.72 + 0.28 * Math.cos(kz * z * 0.6 + 1.1))
                     + 0.28 * Math.sin(kz * z + phase * 1.7)
                     + 0.16 * Math.sin(kx * 0.62 * x + kz * 1.35 * z + 2.3))
             - dome * (u * u * 0.55 + v * v * 0.45);
    // 裾: 左右は絶対値、足側は片側だけ。角は両方効くので hypot で合成し、いちばん低く垂れる。
    const tx = Math.max(0, (Math.abs(x) - bx) / spanX);
    const tz = Math.max(0, (z - bz) / spanZ);
    const t = Math.min(1, Math.hypot(tx, tz)), s = t * t;
    const hem = drop * (1 + hemWave * (0.60 * Math.sin(kz * 1.1 * z + phase)
                                     + 0.40 * Math.sin(kx * 0.9 * x + phase + 1.9)));
    return [w * edge * Math.sin(kz * 0.8 * z + phase),
            w * dy - s * (hem + w * thin),
            w * edge * Math.sin(kx * 0.8 * x + phase + 1.3)];
  });
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
// ベッド（木製プラットフォーム＋寝具）
{
  solids.push({ x1: -7.5, z1: -5.75, x2: -5.6, z2: -3.7 });
  aoPatch(-6.55, -4.7, 2.2, 2.3);
  /* 【v22で整理した】v20〜v21 では「布らしさ」を出そうとして、掛け布団のまわりに
     縁の巻き込み（左右＋足元）・側面へ垂れる布6枚・足元の垂れ・キルトの畝7本・
     足元でめくれた層・折り返しの端、ヘッドボードの落とし込みパネルと框4本、
     さらに枕2つ——合わせて 25 個以上の薄い箱を足していた。個々の理屈は通っていたが、
     並べると寸法の近い箱が何層にも重なり、ベッドが家具ではなく「積み木」に見えた。
     細部を足すより点数を減らし、フレーム→マットレス→シーツ→掛け布団→枕 の
     5層が一目で読める状態を優先する。以下は「無いと何が読めなくなるか」で選んだ分だけ。
     残した部品の数値は当時のまま。撤去した部品が何をしようとしていたか、なぜ
     足す方向が行き詰まったかは docs/HANDOFF.md セクション13 に全部残してある。 */
  [[-6.98, -5.55], [-6.12, -5.55], [-6.98, -3.85], [-6.12, -3.85]].forEach(([x, z]) =>
    tleg(0.035, 0.028, 0.18, M.steel, x, 0.09, z));
  rbox(0.98, 0.14, 1.96, M.oak, -6.55, 0.25, -4.7, 0, 0.025);            // フレーム
  rbox(0.9, 0.04, 1.88, M.oakDark, -6.55, 0.335, -4.7, 0, 0.012);        // すのこ天端
  // ヘッドボードは本体＋笠木の2枚だけ。落とし込みパネル・縦框・上下桟（計5枚）は
  // 厚さ 1.6〜7cm の板が同じ場所に重なるので、額縁ではなく段々の壇に見えていた。
  rbox(0.98, 0.58, 0.07, M.oak, -6.55, 0.55, -5.66, 0, 0.02);            // 本体（前面 z=-5.625、y 0.26〜0.84）
  rbox(1.0, 0.06, 0.07, M.oakDark, -6.55, 0.85, -5.633, 0, 0.014);       // 笠木（天端 0.84 にかぶせる）
  /* 寝具（角丸で柔らかく。素材ごとに色を分けて“のっぺり白い塊”を回避）
     v23：材（M.mattress ほか）に織り目の法線とラフネスを入れ、掛け布団と敷きシーツは
     さらに drape() で面の中をうねらせた。**部品数は v22 のまま増やしていない。**
     v24 で分かったこと：**その drape は効いていなかった。** rbox（RoundedBoxGeometry）は
     面の中に頂点を持たないので、面の中のうねりを掛ける相手が存在しなかった。
     シーツ・掛け布団・枕は cbox（分割ボックス）に置き換えた。マットレスだけは rbox のまま
     ——天面はシーツで隠れ、側面もシーツの裾で 11cm 覆われるので、動かす面が残らない。

     v24：それでもまだ布に見えなかった。**寸法のほうが間違っていた。**
     v23 まで掛け布団は幅 0.96、敷きシーツは幅 0.86——つまりどちらも
     マットレス(0.88)とほぼ同じ幅で、天端で水平に終わっていた。実物の寝具は
     掛け布団が 1.35〜1.5m（シングルのマットレス 0.9m に対して片側 25cm 以上垂れる）、
     敷きシーツはマットレスを包んで側面を隠す。**縁が下へ垂れて側面を覆っている**という
     のが寝具のいちばん強い手がかりで、寸法がそうなっていなければ材で何をしても出ない。
     そこで掛け布団を 1.28 幅（片側 20cm 垂れ）、シーツを 0.92 幅（マットレスを包む）に広げ、
     drape の裾（sx/sz/drop）で外周を落とした。**部品数は v22 のまま増えていない。**
     ・寸法を変えたので当たり判定と repeat も見直した。裾の最外周は x -7.19〜-5.91 で、
       ベッドの solids（-7.5〜-5.6）の内側に収まっている＝見た目だけが外へ出ることはない。
     ・脚は x -6.98/-6.12（中心から 0.43）＝フレーム内なので、裾（0.46 より外）と当たらない。 */
  rbox(0.88, 0.18, 1.84, M.mattress, -6.55, 0.44, -4.7, 0, 0.06, 5);     // マットレス（面取り大きめ＝弾力感）
  /* 敷きシーツ。厚み 3cm なのでうねりは 7mm まで（天端 0.547〜0.562）。掛け布団の天端の
     最低値 0.580 を突き抜けないことを確認済み。ぴんと張ったシーツにもこの程度の皺はある。
     波長は掛け布団より短く（kx 22 / kz 13）、輪郭の揺れも控えめに。
     v24: 0.86×1.82 → 0.92×1.86 に広げ、マットレス(0.88×1.84)を 2cm ずつ超えさせて
     裾を 11cm 落とす（sx 0.425 / drop 0.11）。マットレス側面 18cm の上 11cm が
     シーツで隠れ、**残り 7cm だけがマットレス色で見える**＝ボックスシーツを被せた形。
     v23 は逆にマットレスより 1cm 内側で終わっていたので、白い板の上に一段細い白い板が
     乗っているだけに見えていた（これが「シーツ感がない」の正体）。
     sx=0.425 はマットレス半幅 0.44 より内側なので、裾は落ち始めでマットレス天端に
     2.5cm 食い込む。柔らかい物どうしを数cm重ねるのは既存の方針どおりで、
     こうしないと縁が浮いて「乗せた紙」に見える。 */
  drape(cbox(0.92, 0.03, 1.86, M.sheet, -6.55, 0.54, -4.7, 0, 24, 2, 40),
    { fold: 0.007, kx: 22, kz: 13, phase: 0.7, edge: 0.006,
      sx: 0.425, sz: 0.90, drop: 0.11, thin: 0.006, hemWave: 0.22 });
  /* 掛け布団は1個で済ませる。要点は「厚み」より「マットレスに被っていること」。
     ・幅 1.28（v23 は 0.96）でマットレス(x -6.99〜-6.11)より片側 20cm 外へ出す
     ・底面 0.515 をマットレス天端 0.53 より 1.5cm 下げ、縁が肩に乗り越えるようにする
     ・厚みは 0.12（旧 0.20）。0.20 だと側面から見た時に白いマットレスの上へ
       “2枚目のマットレス”を積んだように見えた（撮影で確認）。布は薄くていい。
     これで縁の巻き込みと垂れ布（10枚）は要らなくなる。柔らかい物どうしは数cm
     重ねないと必ず浮くので、マットレス・シーツとの食い込みは意図的。
     y 0.515〜0.635 はフレーム天端(0.32)・脚(0.18)より上なので x が重なっても貫通しない。
     足側は z=-3.70 でフレーム端(-3.72)まで。マットレス足元(-3.78)より 8cm 出るぶんが
     フレームの上に垂れる。頭側は -4.90 で止め、枕(-5.18〜-5.54)との間に敷きシーツの
     白を 28cm 残す＝「めくったまま寝ていない」状態を、部品を足さずに輪郭で出す。 */
  /* うねり 36mm（厚み 0.12 の約 1/3）＋縁の垂れ 18mm。天端 0.635 が 0.581〜0.671 で波打つ。
     底面は動かさないので上の「1.5cm 食い込ませる」設計はそのまま生きる。
     最初は fold 22mm・edge 0 で試したが**引きでも寄りでも変化が見て取れなかった**——
     天井灯がほぼ真上なので、面が20°傾いても陰影がほとんど変わらない。輪郭を水平に
     揺らす edge を足してから、ようやく布に見えるようになった（drape のコメント参照）。
     kx=16 は幅 1.28m に畝が約3.3本＝波長 39cm。ここを 26（5本）まで詰めると
     v21 で消したキルトの畝と同じコーデュロイに見えたので、意図して緩くしている。
     v24: 幅を 1.28 に広げ、裾を左右 20cm・足元 10cm 垂らした（sx 0.46 / sz 0.50 /
     drop 0.20 / thin 0.06）。裾の最下端は y 0.255〜0.375（hemWave で±30%揺れる）で、
     マットレス側面(0.35〜0.53)とフレーム側面(0.18〜0.32)の前を通って落ちる。
     フレームの外面は |x|=0.49 なので、裾（|x|=0.64）とは 15cm 離れていて貫通しない。
     床は y=0 なので届かない。厚みは裾で 0.12→0.06 に薄くなる（thin）。一定のまま
     垂らすと「巻いた縁」＝v21 で消した縁の巻き込みと同じ絵になる。 */
  drape(cbox(1.28, 0.12, 1.20, M.blanket, -6.55, 0.575, -4.30, 0.015, 32, 3, 28),
    { fold: 0.036, kx: 16, kz: 9, phase: 2.1, edge: 0.018, dome: 0.018,
      sx: 0.46, sz: 0.50, drop: 0.20, thin: 0.06, hemWave: 0.30 });
  // 枕は1つ（v22）。2つ並べると枕どうしの隙間もヘッドボードとの間も読めず、白い板が
  // ずれて重なっているだけに見えた。マットレス幅の内側に収め、底面をシーツ上面 0.555 に。
  // v23: 枕も drape する。うねりは要らないが dome（周縁で天端が下がる）だけ効かせると
  // 中央が膨らんで四隅が落ちる＝「詰め物が寄った枕」になる。dome が無いと石鹸に見える。
  /* v24: 枕も cbox にした。角丸(r=0.07)は厚み 0.15 の半分＝断面がほぼ楕円で、これが
     石鹸に見える最大の原因だった。実物の枕は角丸ではなく、袋の縫い目が稜線として残り、
     中央が詰め物で膨らむ。だから丸みは面取りではなく dome（0.014→0.045）で作る。
     v23 の dome は rbox の面に頂点が無かったのでほぼ効いていなかった（cbox のコメント参照）。
     分割は 16×2×12（3cm 間隔）。うねり 5mm は袋の皺ぶん。 */
  const pillow = drape(cbox(0.52, 0.15, 0.36, M.pillow, -6.55, 0.623, -5.36, 0.08, 16, 2, 12),
    { fold: 0.005, kx: 11, kz: 15, phase: 1.4, edge: 0.004, dome: 0.045 });
  pillow.scale.y = 0.9;                                                  // 少しつぶれた枕（高さ 0.135 / y 0.556〜0.691）
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
  // 五徳の天端は輪(torus)の上端 0.957。旧版は胴の中心を 1.02 に置いていたので下端が
  // 0.935 で、五徳の桟(0.942〜0.954)と輪を 2cm 呑み込んでいた（桟は 0.2m あって胴より
  // 外に出るため、桟がケトルに突き刺さって見えていた）。0.957 に接地させる。
  const kettle = vcyl(0.11, 0.13, 0.17, M.metal, -7.05, 1.042, 2.85, 16);   // 胴 y 0.957〜1.127
  vcyl(0.115, 0.09, 0.05, M.metal, -7.05, 1.147, 2.85, 16);         // 肩 y 1.122〜1.172（胴天端に 5mm 噛ませる）
  vcyl(0.04, 0.05, 0.03, M.dark, -7.05, 1.182, 2.85, 12);          // 蓋つまみ y 1.167〜1.197
  const spout = vcyl(0.018, 0.032, 0.14, M.metal, -6.9, 1.102, 2.85, 10);  // 注ぎ口
  spout.rotation.z = -0.7;
  // 提げ手は胴をまたぐ弧。torus の輪は既定で XY 平面（軸が Z）なので回転は不要。
  // 旧版は rotation.x=π/2 で輪を水平にしていたため、蓋のまわりに平たい半円が
  // 浮いているだけに見えていた。両端(x -7.05±0.09, y 1.160)を肩の内側に埋める。
  const kHandle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 8, 16, Math.PI), M.dark);
  kHandle.position.set(-7.05, 1.160, 2.85); scene.add(kHandle);      // 頂点 y 1.250（つまみ天端 1.197 の上）

  /* --- 水切りかご（シンク手前。ワイヤー枠に皿2枚を立て、脇に伏せマグ） ---
     旧版は4つ壊れていた（AO 導入後の撮影で発覚）。
     ① 受け皿を y 0.895〜0.915 に置いていた。天板は rbox(...,0.885,...) なので上面は
        0.910 で、受け皿が天板に 1.5cm めり込んでいた（中心座標を上面と誤読した型）。
     ② CylinderGeometry の軸は Y なので、厚み 0.015・半径 0.11 の円柱は「既に水平な円盤」。
        立てるには rotation.x ≒ π/2 が必要なのに 0.05+i*0.02（約3度）しか与えておらず、
        「立てた皿」は寝たままだった。
     ③ その2枚が y 1.02・半径 0.11・z 間隔 0.14 で、互いに 8cm 分めり込んでいた。
        しかも下端 1.0125 は受け皿天面から 10cm 浮いていた。
     ④ 伏せマグ（y 0.905〜0.995）が受け皿天面 0.915 を 1cm 貫通していた。
     縦桟も z 方向ではなく x 方向に並べていたので、皿を立てても挟む隙間が無かった。 */
  const wire = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.6 });
  const dpY = 0.930;                                                // 受け皿の天面（＝皿とマグの接地面）
  vbox(0.34, 0.02, 0.5, wire, -7.05, dpY - 0.01, 3.53);            // 受け皿 x -7.22〜-6.88 / y 0.910〜0.930 / z 3.28〜3.78
  // 歯（皿を挟む縦桟）を z 方向に5本並べ、上下2本の横桟で繋ぐ。皿は歯と歯の隙間に立つ。
  const rackZ = [3.36, 3.43, 3.50, 3.57, 3.64];
  rackZ.forEach((tz) => {
    [-7.17, -6.93].forEach((tx) => vbox(0.012, 0.14, 0.012, wire, tx, dpY + 0.07, tz));  // 縦桟 y 0.930〜1.070
    vbox(0.24, 0.010, 0.010, wire, -7.05, dpY + 0.005, tz);       // 底の渡し（皿の座）y 0.930〜0.940
  });
  [-7.17, -6.93].forEach((tx) => {
    vbox(0.012, 0.012, 0.32, wire, tx, dpY + 0.045, 3.50);        // 下の横桟 z 3.34〜3.66
    vbox(0.012, 0.012, 0.32, wire, tx, dpY + 0.130, 3.50);        // 上の横桟（縦桟の天端 1.070 の直下）
  });
  // 立てた皿2枚。rotation.x = π/2±θ で円盤の面が z に垂直になる。傾き θ での占有半幅は
  // y: 0.0075|cosφ|+0.11|sinφ|、z: 0.0075|sinφ|+0.11|cosφ|（φ=π/2±θ）。θ=0.10 なら
  // y 半幅 0.1102 / z 半幅 0.0184 → 中心 y=dpY+0.111 で受け皿に接地し、z は歯の隙間
  // (0.07) に収まる。隙間を1つ飛ばして置くので皿同士も重ならない。
  [3.465, 3.605].forEach((pz, i) => {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 20), M.ceramic);
    plate.position.set(-7.05, dpY + 0.111, pz);                   // 下端 0.9308（受け皿天面 0.930 に接地）
    plate.rotation.x = Math.PI / 2 + (i ? -0.10 : 0.10);          // 左右に少し倒して単調さを消す
    scene.add(plate);
  });
  // 伏せたマグ（歯の外側 z 3.67〜3.77 に確保した帯へ。受け皿に接地）
  vcyl(0.045, 0.05, 0.09, M.ceramic, -7.05, dpY + 0.045, 3.72, 14);

  // --- 生活雑貨: 食器用洗剤ボトル＋スポンジ（シンク左）、まな板（立てかけ） ---
  // ボトル・スポンジ・まな板はいずれも接地面を 5〜10mm 割り込んでいた。ボトルとスポンジは
  // シンクの中（底板の上面 0.9125）に、まな板は天板の上面 0.910 に載せ直す。
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0x2f7d55, roughness: 0.4, metalness: 0.0 });  // 緑の洗剤
  vcyl(0.032, 0.038, 0.17, bottleMat, -7.2, 0.998, 4.85, 12);        // ボトル胴 y 0.913〜1.083
  vcyl(0.014, 0.018, 0.05, M.dark, -7.2, 1.105, 4.85, 8);          // ノズル y 1.080〜1.130（胴天端に 3mm 噛ませる）
  vbox(0.09, 0.05, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8c24a, roughness: 0.95 }), -6.95, 0.938, 4.7);  // 黄色いスポンジ y 0.913〜0.963
  // まな板は rotation.z = π/2-0.12 で立てるので、y 半幅は hx·sin+hy·cos = 0.16·0.9928+0.01·0.1197
  // = 0.160。中心を 1.071 に置いて下端 0.911（天板 0.910 の直上）にする。
  const board = rbox(0.32, 0.02, 0.24, M.oak, -7.78, 1.071, 4.9, 0, 0.006, 2);  // まな板（壁際に立てかけ）
  board.rotation.z = Math.PI / 2 - 0.12; board.rotation.y = 0.1;
}
// クローゼット（開き戸が、少しだけ開いている）
{
  solids.push({ x1: -2.6, z1: -5.9, x2: -0.6, z2: -5.0 });
  aoPatch(-1.6, -5.15, 2.4, 1.3);
  /* 躯体。v22まで **中実の箱1個**（`vbox(2.0, 2.2, 0.86, ..., -1.6, 1.1, -5.46)`）だったので、
     内部（ハンガーレール・上着5着・棚・毛布・段ボール・靴・収納ケース＝約20メッシュ）と
     内部照明が **1つも見えていなかった**。前面 z=-5.03 の面で全部隠れる。撮影で確認済み。
     背板＋側板2枚＋天板の4枚に割って中を抜く。床は室内のフローリングをそのまま使う
     （下枠 y 0〜0.05 が敷居として見えるので底板は要らない）。
     内寸 x -2.56〜-0.64 / y 0〜2.16 / z -5.85〜-5.03。 */
  const clBody = new THREE.MeshLambertMaterial({ color: 0x14120f });
  vbox(2.0, 2.2, 0.04, clBody, -1.6, 1.1, -5.87);                // 背板 z -5.89〜-5.85
  vbox(0.04, 2.2, 0.86, clBody, -2.58, 1.1, -5.46);              // 左側板 x -2.60〜-2.56
  vbox(0.04, 2.2, 0.86, clBody, -0.62, 1.1, -5.46);              // 右側板 x -0.64〜-0.60
  vbox(2.0, 0.04, 0.86, clBody, -1.6, 2.18, -5.46);              // 天板 y 2.16〜2.20
  vbox(0.94, 1.98, 0.04, M.white, -2.1, 1.06, -4.99);            // 左扉（閉。室内側の面は z -4.97）
  /* 右扉は少しだけ開く（闇のスリット＝不穏）。旧版は2つ壊れていた。
     ① `rotation.y = -0.3` は自由端を **-z＝クローゼットの中へ** 振る向きで、
        閉じた箱の中へ扉が開いていた。丁番は外側の端（x -0.55）にある。
     ② 回転が扉の中心まわりなので、丁番側の角が躯体に 9cm 食い込んでいた。
     丁番の世界座標を固定したまま +0.3 回す。局所点 (lx,ly,lz) は
     (lx·cosθ + lz·sinθ, ly, -lx·sinθ + lz·cosθ) へ移るので、
     中心 = 丁番 - R·(0.47,0,0) = (-0.999, 1.06, -4.851)。
     これで扉は z -5.009〜-4.693＝**躯体の前面 -5.03 より室内側**に収まり、
     側板と z だけで分離する（x・y は重なってよい＝ベッドと同じ手）。 */
  const clDoorR = 0.3, cdc = Math.cos(clDoorR), cds = Math.sin(clDoorR);
  const onDoorR = (lx, lz) => [-0.999 + lx * cdc + lz * cds, -4.851 - lx * cds + lz * cdc];   // 右扉の局所→世界
  {
    const [wx, wz] = onDoorR(0, 0);
    vbox(0.94, 1.98, 0.04, M.white, wx, 1.06, wz, clDoorR);
  }
  vbox(0.03, 0.16, 0.03, M.metal, -1.68, 1.06, -4.955);          // 左扉の取っ手（室内面 -4.97 から 3cm 出す。旧版は 83% 埋まっていた）
  {
    const [wx, wz] = onDoorR(-0.38, 0.035);                      // 自由端寄り・室内側の面の上
    vbox(0.03, 0.16, 0.03, M.metal, wx, 1.06, wz, clDoorR);
  }
  vbox(2.06, 0.1, 0.12, M.woodDark, -1.6, 2.2, -4.98);           // 上枠（天板の前端に噛ませる）
  vbox(2.06, 0.05, 0.12, M.woodDark, -1.6, 0.025, -4.98);        // 下枠＝敷居 y 0〜0.05（旧版は 3mm 浮いていた）

  /* ===== 高精細化: 扉の彫り込み＋開いた扉から覗く内部（ハンガーの服・棚・靴） ===== */
  // 扉の落とし込みパネル（一段暗い矩形を少し手前に）で平板さを解消
  vbox(0.72, 1.62, 0.012, new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 0.85 }), -2.1, 1.06, -4.962);
  {
    const rp = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.62, 0.012), new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 0.85 }));
    const [wx, wz] = onDoorR(0, 0.026);
    rp.position.set(wx, 1.06, wz); rp.rotation.y = clDoorR; scene.add(rp);
  }
  /* 内部をごく薄く照らす弱い暖色光（スリットの奥に服/棚の存在が滲む程度）。
     この光は躯体が中実だった間、**何も照らしていなかった**ので強度が未検証だった。
     中を抜いた途端に強すぎることが判明し、2回撮って2回焼き切れた:
       (1) y1.50/z-5.20 は上着の面（z -5.37〜-5.23）から 12cm → 上着がピンクに飛ぶ
       (2) y1.92/z-5.45 へ逃がしたら棚板の下面（y1.965）から 4.5cm → 天井が橙に飛ぶ
     真因は位置ではなく **decay=2.6 を奥行 0.86m の箱で使っていたこと**。
     1/d^2.6 は 0.10m と 0.67m で 140 倍違うので、近くを飛ばさない強度にすると
     奥が完全に沈む。decay を 1.3 に緩めて比を 12 倍に落とし、そのうえで
     前室の中央（上着の面から 0.10 / 棚板から 0.665 / 扉の内面から 0.14）に置く。
     照度は最近接の上着 2.0、棚板 0.17、床の収納ケース 0.09。ブルーム閾値 0.9 に対して
     上着の輝度は 2.0×0.29/π=0.19 なので飛ばない。
     漏れは無い: 躯体の外面（側板・背板・天板）はすべて法線がこの光と逆を向くので、
     castShadow=false でも室内へ抜けるのは扉のスリットだけ（それは狙いどおり）。 */
  const closetGlow = new THREE.PointLight(0xffe0b0, 0.003 * 34, 2.2, 1.3);
  closetGlow.position.set(-1.55, 1.30, -5.13); closetGlow.castShadow = false; scene.add(closetGlow);
  // 内部は decorative のみ（solids には積まない＝隠れる動作を邪魔しない）
  // ハンガーレール（左右に渡した金属パイプ）。長さは内寸 1.92 + 両側 1cm の差し込み
  const rail = vcyl(0.012, 0.012, 1.94, M.metal, -1.6, 1.72, -5.3, 10);
  rail.rotation.z = Math.PI / 2;                                   // 軸をX方向へ（既定はY）
  /* 服（ハンガー＋ミュートカラーの上着）を数着、少し間隔をあけて吊るす。
     旧版は フック / 肩バー / 上着 が y 方向に 3つの浮島に分かれていた
     （レール上端 1.732 に対しフックが 4mm 浮き、その下 5.5cm が空で肩バー、
      さらに 2.5cm 空けて上着）。レール上端から下へ順に積み直す。 */
  const coatCols = [0x3b4652, 0x5a4636, 0x2f3a34, 0x4a3f4f, 0x6a6258];
  coatCols.forEach((cc, i) => {
    const hx = -2.2 + i * 0.3;
    /* ハンガーのフック。TorusGeometry の輪は既定で **XY平面（軸=Z）** なので、
       そのまま置くとレール（軸=X）と同じ平面内で弧を描き、レールに掛からず横に浮く。
       rotation.y = π/2 で輪を ZY 平面へ倒して初めてレールを跨ぐ（型D）。
       弧の頂点の内側は局所 y = 0.02-0.004 = 0.016 なので、
       中心 y = 1.732 - 0.016 = 1.716 でレール上端に接する。弧の両端は y 1.712〜1.720。 */
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI), M.metal);
    hook.position.set(hx, 1.716, -5.3); hook.rotation.y = Math.PI / 2; scene.add(hook);
    // 肩バー（上面 1.712 をフックの両端に合わせる）
    vbox(0.2, 0.01, 0.012, M.dark, hx, 1.707, -5.3);
    // 上着本体（肩から裾へ、わずかに広がる布）。上端 1.705 で肩バーに 3mm 噛む
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 8, 1, false, 0, Math.PI * 2),
      new THREE.MeshStandardMaterial({ color: cc, roughness: 0.9 }));
    coat.position.set(hx, 1.395, -5.30); coat.scale.z = 0.5;   // 前後に薄く
    scene.add(coat);
  });
  /* 上段の棚＋畳んだ毛布/箱。旧版の棚板は z -5.65〜**-4.95** で、
     躯体の前面 -5.03 を 8cm 越えて **扉を突き抜けていた**（撮影で扉の上に
     板が飛び出しているのが見えた）。前面ぴったり -5.03 で止め、
     幅も内寸いっぱいにして両側板へ差し込む。上面は 1.995。 */
  vbox(1.94, 0.03, 0.70, M.woodDark, -1.6, 1.98, -5.38);           // 棚板 z -5.73〜-5.03
  /* 棚上は 1.995〜2.16（天板の下面）の **16.5cm しかない**。
     旧版は毛布 h0.16 を 5mm 浮かせ、段ボール h0.28 は天板を 8cm 突き抜けていた。
     どちらも高さを詰めて棚上に収める。 */
  vbox(0.6, 0.14, 0.42, new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 0.95 }), -1.9, 2.065, -5.3);  // 畳んだ毛布 y 1.995〜2.135
  vbox(0.5, 0.15, 0.4, M.cardboard, -1.15, 2.07, -5.3);            // 段ボール箱 y 1.995〜2.145
  // 床の靴（2足ぶんの小箱）と収納ケース。旧版は靴 3.5cm・ケース 3cm 浮いていた
  vbox(0.24, 0.09, 0.12, M.dark, -2.1, 0.045, -5.15);
  vbox(0.24, 0.09, 0.12, M.dark, -1.82, 0.045, -5.15);
  vbox(0.7, 0.3, 0.5, new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 0.6 }), -1.0, 0.15, -5.3);  // 半透明収納風の暗いケース
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
  /* 天板の上の小物（レトロな目覚まし時計・眼鏡・文庫本・畳んだ布）
     天板は rbox(...,0.845,...) で厚み 0.05 なので **上面は 0.870**。旧版は小物を
     0.87〜0.945 に「だいたい」置いていて、時計は 2cm 沈み、眼鏡と本は 4〜6mm 浮き、
     布は本の中に 1.9cm 埋まっていた。以下すべて 0.870 を基準に積み上げる。 */
  // ツインベル目覚まし時計：脚 → 丸い本体（横向き円柱）→ 文字盤 → 針 → 上のベル
  const akX = cx - 0.62, akZ = cz + 0.02, akY = 0.970;                      // 本体の中心（脚 0.03 ＋ 半径 0.07）
  const akMetal = new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.55, metalness: 0.4 });  // 反射控えめの金属（滲み防止）
  [-0.045, 0.045].forEach(fx => vcyl(0.006, 0.006, 0.03, M.steel, akX + fx, 0.885, akZ, 8));  // 2本脚 y 0.870〜0.900
  vcyl(0.07, 0.07, 0.05, akMetal, akX, akY, akZ, 20).rotation.x = Math.PI / 2;  // 本体（横向き円柱）y 0.900〜1.040
  const akFace = new THREE.Mesh(new THREE.CircleGeometry(0.058, 20),
    new THREE.MeshStandardMaterial({ color: 0xc4beae, roughness: 0.85 }));
  akFace.position.set(akX, akY, akZ + 0.026); scene.add(akFace);            // 文字盤（本体の前面 +0.025 の 1mm 手前）
  /* 針。文字盤の法線は +Z（CircleGeometry は既定で XY 平面）なので、針は **rotation.z**
     で回さないと盤面を回らない。旧版は vbox の第8引数＝rotation.y で回していたため、
     針が奥行き方向に寝て「文字盤に横一本の口が付いている」ようにしか見えなかった。
     また中心に置いた箱は左右対称の棒になるので、自分の向きへ len/2 ずらして
     根元を文字盤の中心に合わせる。角度は 12時(+Y)を π/2 とし、時計回りに減る。 */
  const akHand = (len, wid, ang) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(len, wid, 0.004), M.dark);
    h.position.set(akX + Math.cos(ang) * len / 2, akY + Math.sin(ang) * len / 2, akZ + 0.030);
    h.rotation.z = ang; scene.add(h);
  };
  /* 針の角度は 12時＝+Y＝π/2 で、時計回りに **減る**（反時計回りに増える）。
     壁掛け時計はゲーム内時刻に同期して回るが、この目覚まし時計は静止メッシュなので
     **開始時刻（gameMin = 21*60 → 21:00）に合わせる**。同じ部屋の2つの時計が
     初手から1時間ずれていると継続性の破れとして目に付く。 */
  akHand(0.044, 0.005, Math.PI / 2);                                        // 分針（12時）
  akHand(0.030, 0.007, Math.PI);                                            // 時針（9時＝真左）
  [-0.05, 0.05].forEach(bx2 => {                                            // 上部の2つのベル（本体天端 1.040 に 5mm 噛ませる）
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), akMetal);
    bell.position.set(akX + bx2, 1.035, akZ); scene.add(bell);
  });
  vbox(0.012, 0.03, 0.008, akMetal, akX, 1.055, akZ - 0.02, 0.3);           // ベルを叩くハンマー y 1.040〜1.070
  // 眼鏡（フレーム2枚＋ブリッジ＋つる）。管の半径 0.004 なので中心 0.874 で接地する
  const glX = cx + 0.1, glZ = cz + 0.05;
  [-0.03, 0.03].forEach(gx => {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 8, 18), M.dark);
    lens.rotation.x = -Math.PI / 2; lens.position.set(glX + gx, 0.874, glZ); scene.add(lens);  // 輪を XZ 平面へ倒す＝卓上に伏せる
  });
  vbox(0.02, 0.004, 0.004, M.dark, glX, 0.874, glZ);                        // ブリッジ
  vbox(0.004, 0.004, 0.08, M.dark, glX - 0.05, 0.874, glZ - 0.03);          // つる
  vbox(0.004, 0.004, 0.08, M.dark, glX + 0.05, 0.874, glZ - 0.03);
  // 文庫本（数冊積み、背表紙が見える）。厚み 0.018 なので段差も 0.018（旧版は 0.02 で 2mm の空気が入っていた）
  [0, 1, 2].forEach(k => {
    vbox(0.11, 0.018, 0.16, bookMats[(k * 3) % bookMats.length], cx + 0.62, 0.879 + k * 0.018, cz + 0.02, 0.08);
  });
  /* 畳んだ布。旧版は本と同じ x に置いて本の山に 1.9cm 埋まっていたうえ、
     面取り r=0.03 が h/2 と同値で **平らな天面が消えて丸薬形**になっていた（型B）。
     本から 6.5cm 離した空きスペースへ移し、r を 0.012 に落として畳んだ角を残す。 */
  rbox(0.32, 0.06, 0.24, M.fabric, cx + 0.90, 0.900, cz - 0.02, 0.05, 0.012, 3);  // y 0.870〜0.930
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
  vcyl(0.092, 0.072, 0.11, new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.9 }), tx - 0.32, 0.5, tz - 0.18, 16);  // 胴 y 0.445〜0.555
  /* 帯（赤ラベル）。旧版は y 0.44〜0.46 で **天板（上面 0.445）に 5mm 潜り**、
     しかも上下の半径が 0.085/0.060 と胴（0.092/0.072）より強くテーパーしていたので、
     下では胴に食い込み上では飛び出していた。胴の高さ y での半径は
     r(y) = 0.072 + (y-0.445)/0.11·0.020。帯を y 0.47〜0.52 に置き、そこの胴の半径 +2mm にする。 */
  vcyl(0.0876, 0.0785, 0.05, new THREE.MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.7 }), tx - 0.32, 0.495, tz - 0.18, 16);
  /* 半分めくれたフタ。rotation.x = -0.9 で立てると y 半幅が
     0.002·cos0.9 + 0.05·sin0.9 = 0.0404 になるので、旧版の中心 0.565 では
     下端が 0.525＝**縁（0.555）より 3cm 下**＝カップの中に沈んでいた。
     蝶番は縁にあるべきなので中心を 0.555+0.0404 に上げる。 */
  const lid = rbox(0.1, 0.004, 0.1, new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.6, metalness: 0.3 }), tx - 0.32, 0.595, tz - 0.14, 0.3, 0.002, 1);
  lid.rotation.x = -0.9;
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
  rbox(0.1, 0.024, 0.24, M.dark, rmx, 0.457, rmz, rmr, 0.01, 2);            // y 0.445〜0.469（旧版は 3mm 浮いていた）
  for (let br = 0; br < 5; br++)                                            // ボタン（2列×5行）
    for (let bc = 0; bc < 2; bc++) {
      const bxp = rmx + Math.cos(rmr) * (bc * 0.03 - 0.015) - Math.sin(rmr) * (br * 0.032 - 0.064);
      const bzp = rmz + Math.sin(rmr) * (bc * 0.03 - 0.015) + Math.cos(rmr) * (br * 0.032 - 0.064);
      vcyl(0.007, 0.007, 0.004, M.steel, bxp, 0.470, bzp, 6);               // 本体上面 0.469 に 1mm 噛ませる
    }
  // 読みかけの雑誌（開いて伏せてある）
  const mag = rbox(0.3, 0.008, 0.22, M.form, tx - 0.05, 0.452, tz + 0.28, 0.15, 0.003, 1);
  mag.rotation.x = 0.02;
  /* 誌面の印字塊。旧版は雑誌に rotation.x=0.02 が付いているのに印字は水平なままで、
     傾きの差（端で 2.2mm）が浮き（1mm）を上回るので **奥の端で紙に潜っていた**。
     載せる面と同じ姿勢を与えるのが原則。 */
  vbox(0.28, 0.001, 0.2, M.formInk, tx - 0.05, 0.457, tz + 0.28, 0.15).rotation.x = 0.02;
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
  /* この家具は z=5.45 の壁際にあるので **室内側は -z**。ベゼル・画面が sz-0.006 / sz-0.014、
     背面ケースが sz+0.006 と、テレビ自体は正しく -z を向いている。
     天板は rbox(...,0.4,...) の厚み 0.03 なので **上面は 0.415**。 */
  const sx = bx, sz = bz - 0.03;
  [-0.42, 0.42].forEach(dx => {                                             // 左右のブレード脚
    rbox(0.14, 0.014, 0.16, M.dark, sx + dx, 0.422, sz, 0, 0.004, 2);       // 接地脚 y 0.415〜0.429（旧版は 0.405 で天板に 1cm 沈んでいた）
    vbox(0.02, 0.105, 0.06, M.dark, sx + dx, 0.4775, sz);                   // 支柱 y 0.425〜0.530（上端は背面ケースの下端 0.53 に一致）
  });
  rbox(1.16, 0.66, 0.028, M.plastic, sx, 0.86, sz + 0.006, 0, 0.006, 2);    // 背面ケース（薄）
  rbox(1.14, 0.64, 0.012, new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.35 }), sx, 0.86, sz - 0.006, 0, 0.004, 2);  // 極薄ベゼル
  vbox(1.08, 0.6, 0.006, M.tv, sx, 0.86, sz - 0.014);                       // 画面（前触れで光る・つや消し）
  vbox(0.05, 0.006, 0.006, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4 }), sx, 0.55, sz - 0.016);  // 下ベゼル中央のブランドロゴ
  /* サウンドバー（テレビ手前、天板上）。旧版は sz+0.16＝**壁側** に置いていたので
     テレビのパネル（z 5.406〜5.420）の裏に完全に隠れ、しかもグリル面が壁を向いていた。
     コメントの「テレビ手前」どおり -z 側へ回す。グリルは室内を向く面（-z）に貼る。 */
  rbox(0.9, 0.05, 0.07, M.plastic, sx, 0.44, sz - 0.16, 0, 0.02, 2);        // z 5.225〜5.295
  vbox(0.86, 0.03, 0.005, new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.7 }), sx, 0.44, sz - 0.197);  // スピーカーグリル面（室内向き）
  /* メディア機器。旧版は x 2.90〜3.30 でテレビの左脚（x 3.21〜3.35）と重なっていた。
     脚を天板の上へ上げると y の重なりが 4mm から 1.4cm に増えるので、
     **x だけ** ずらして分離する（1軸で分ければ y・z は自由＝ベッド／デスクライトと同じ手）。 */
  rbox(0.4, 0.05, 0.28, M.plastic, bx - 0.72, 0.44, bz + 0.06, 0, 0.008, 2);  // x 2.78〜3.18（脚まで 3cm）
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  // 待機ランプ（赤）。旧版は z 5.64＝機器の **壁側の面** に付いていて室内から見えなかった
  led.position.set(bx - 0.86, 0.45, bz - 0.085); scene.add(led);           // 機器の室内側の面（z 5.37）の 5mm 手前
  // HDMIケーブルがテレビ裏から機器へ垂れる。旧版は z 5.422〜5.518 で背面ケース（5.412〜5.440）を貫いていた
  const tvcab = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), M.dark);
  tvcab.position.set(sx - 0.2, 0.62, sz + 0.09); tvcab.rotation.x = 0.2; scene.add(tvcab);  // z 5.462〜5.558
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
  /* 取っ手。torus の輪は既定で XY 平面（軸が Z）にあり、マグの軸が Y なのでこれが正しい向き。
     旧版は rotation.y=π/2 で輪を YZ 平面に倒していたため、輪が胴の側面と平行になり、
     x 方向の厚みが管の 0.008 しか無いまま胴（半径 0.0475）に半分埋まって、
     「胴に貼り付いた白い板」に見えていた（撮影で確認）。
     弧は 0〜216°なので、そのままだと +X 中心にならない。-0.6π 回して ±108°の対称な
     C 字にすると、両端が胴側（-x）を向いた本物のマグ取っ手になる。
     端点は x offset 0.032cos108° = -0.0099。中心を +0.052 に置けば端は 0.0421 で
     胴の壁 0.0475 の内側に 5mm 埋まり、外周は 0.092（壁から 4.4cm）まで張り出す。 */
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 8, 16, Math.PI * 1.2), M.ceramic);
  handle.position.set(cupX + 0.052, top + 0.055, cupZ);
  handle.rotation.z = -Math.PI * 0.6; scene.add(handle);                     // 取っ手（y は top+0.015〜top+0.095 で胴の高さに収まる）
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
  /* ── デスクライト（アーム＋傘。消灯中の造形だけが仕事） ──
     旧版は2つ壊れていた。
     ① アームが XY 平面内でしか曲がらないので、傘は laZ-0.06 = モニタとほぼ同じ z に
        居座り、傘（半径0.075）とベゼル（x 6.49〜7.21 / z -2.119〜-2.073）が
        x・y・z すべてで重なっていた＝モニタの左肩に食い込んでいた。
     ② 傘が openEnded の鋭い円錐＋片面マテリアルだったので、口をのぞく角度では
        内壁も外壁も裏面カリングで消え、法線がグレージングする細い帯だけが残って
        「机に立つ黒い板」に見えていた。
     ①は「1軸で分離できれば他は自由」（ベッドの垂れ布と同じ）で解く。アームを
     手前(-z)へ振って傘を z -2.49〜-2.27 に置けば、x も y も制限せずにモニタと分かれる。
     ②は円錐台＋縁の帯＋内側の反射板（BackSide）にして、口が形として読めるようにする。 */
  const laX = dx + 0.62, laZ = dz + 0.2;                                      // 台座（7.47, -2.10）
  vcyl(0.05, 0.06, 0.02, M.lampArm, laX, top + 0.01, laZ, 12);               // 台座
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 8), M.lampArm);
  arm1.position.set(laX, top + 0.18, laZ); arm1.rotation.z = 0.35; scene.add(arm1);
  const armTop = new THREE.Vector3(laX - 0.058, top + 0.34, laZ);            // arm1 の上端
  const headP = new THREE.Vector3(laX - 0.17, top + 0.35, laZ - 0.28);       // 傘の中心（手前へ振る）
  // arm2 は任意方向なので quaternion で向ける（rotation.z だけでは z 方向へ振れない）
  const armDir = headP.clone().sub(armTop);
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, armDir.length(), 8), M.lampArm);
  arm2.position.copy(armTop).add(headP).multiplyScalar(0.5);
  arm2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.clone().normalize());
  scene.add(arm2);
  // 傘は円錐台（細い口＝アーム側、広い口＝光の出口）。軸の +Y 側が細い口になる。
  // 口が向く先を机の天板に取り、その逆向きを傘の軸にする。
  const lampAim = new THREE.Vector3(dx + 0.2, top, dz - 0.15).sub(headP).normalize();
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.085, 0.13, 16, 1, true), M.lampShade);
  shade.position.copy(headP);
  shade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lampAim.clone().negate());
  scene.add(shade);
  // 以下は傘の子にして同じ姿勢を継がせる（親の quaternion を再計算しないで済む）
  const shadeIn = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.081, 0.124, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xb6afa1, roughness: 0.75, side: THREE.BackSide }));
  shade.add(shadeIn);                                                        // 内側の反射板（内壁だけ描く）
  const shadeRim = new THREE.Mesh(new THREE.CylinderGeometry(0.089, 0.087, 0.014, 16, 1, true), M.lampShade);
  shadeRim.position.y = -0.062; shade.add(shadeRim);                         // 口の縁（4mm 張り出す帯）
  const shadeCap = new THREE.Mesh(new THREE.CircleGeometry(0.030, 16), M.lampShade);
  shadeCap.rotation.x = -Math.PI / 2; shadeCap.position.y = 0.064; shade.add(shadeCap);  // 細い口の蓋
  // デスクライトは消灯（ユーザー要望）。電球は光らない暗いガラス球にし、光源は置かない。
  const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.1 }));  // 消えた電球（黒っぽい）
  lampGlow.position.copy(headP).add(lampAim.clone().multiplyScalar(0.045));  // 口の少し内側
  scene.add(lampGlow);
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
  /* 本の配置（v20で作り直した）
     ------------------------------------------------------------------
     AOで接触部が暗くなったことで、旧版の造形バグが撮影で全部見えるようになった。
     直したのは5点で、いずれも「棚板・側板という決まった箱の中に収める」計算が
     抜けていたことが原因。

     ① 側板の突き抜け: 旧版は while(z < 3.02) を通ったあと最大 0.078 幅の本を置いて
        いたので、遠い側の縁が z=3.098 まで届き、右側板(3.08〜3.12)を貫通しつつ
        棚板(〜3.07)から宙へはみ出していた。→ 置く前に収まるか判定して break する。
     ② 傾いた本の食い込み: 送りが z += bw*cos(lean) で (bh/2)*sin(lean) の項を
        落としていたため、傾いた本が隣へ最大3.5cmめり込んでいた。→ 実際の z 占有幅
        hz = (bw/2)cos + (bh/2)sin を求め、判定と送りの両方に使う。
     ③ 傾いた本の沈み込み: rotation.x はメッシュ中心まわりの回転なので、傾けると
        下端が (bw/2)sin(lean) - (bh/2)(1-cos lean) だけ下がって棚板にめり込む。
        → その分だけ yBase を持ち上げる。
     ④ 宙浮き: 旧版の yb = 0.1+s*0.5+0.02 は棚板の上面(0.115+s*0.5)より 5mm 高く、
        全ての本が浮いていた。→ 上面そのものを基準にする。
     ⑤ 平積みの位置と寸法: 旧版は立てた本の列の「中」(z 2.6〜2.8)に平積みを置いて
        いたので互いに貫通し、さらに背表紙スラブが幅0.3で x=7.45 中心――つまり
        7.30〜7.60――にあり、棚の前面(7.45)から15cmも突き出していた。
        → 平積み用の z 帯を先に確保して立てる列からは飛ばし、小口と背表紙を
        棚の奥行き(7.465〜7.775)に収まる寸法に作り直す。 */
  const Z0 = 1.24, Z1 = 3.06;               // 本を置ける z 範囲（棚板 1.23〜3.07 の内側）
  for (let s = 0; s < 4; s++) {
    const ytop = 0.115 + s * 0.5;           // この段の棚板の上面（本はここに接地させる）
    // 平積みを置く z 帯を先に決め、立てた本の列はそこを空けて通す。
    const stackN = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0;
    const stackZ = 2.72;                                        // 平積みの中心
    const gap0 = stackN ? 2.57 : Infinity;                      // 平積みが占める z 帯
    const gap1 = stackN ? 2.87 : Infinity;                      // （0冊なら帯なし＝Infinity）
    let z = Z0 + 0.01;
    let lean = 0;                                           // 隣接する本は同じ側へ寄りかかる
    while (z < Z1) {
      const bw = 0.028 + Math.random() * 0.05;             // 背の幅（薄い文庫〜厚い専門書）
      if (Math.random() < 0.12) { z += bw + 0.05; lean = 0; continue; }  // 抜けた隙間で列が途切れる
      const bh = 0.30 + Math.random() * 0.15;
      // 隙間の直後だけ寄りかかりを許可（倒れ込み）。列の途中はほぼ直立。
      if (lean === 0 && Math.random() < 0.22) lean = (Math.random() * 0.12 + 0.04);
      else if (Math.random() < 0.5) lean = 0;
      const hz = (bw / 2) * Math.cos(lean) + (bh / 2) * Math.sin(lean);  // 傾けた本が z に占める半幅
      if (z + 2 * hz > Z1) break;                                  // ① 側板を突き抜ける分は置かない
      if (z < gap1 && z + 2 * hz > gap0) { z = gap1; lean = 0; continue; }  // ⑤ 平積みの帯は空ける
      const dip = (bw / 2) * Math.sin(lean) - (bh / 2) * (1 - Math.cos(lean));  // ③ 傾きで下端が沈む量
      placeBook(7.46, ytop + dip, z + hz, bw, bh, bookMats[Math.floor(Math.random() * bookMats.length)], lean);
      z += 2 * hz + 0.006;                                         // ② cos だけでなく sin の項も含める
    }
    // 各段に平積み1〜2冊（横に寝かせた本。背表紙が室内を向く向きで薄く積む）
    let sy = ytop;
    for (let k = 0; k < stackN; k++) {
      const th = 0.04 + Math.random() * 0.03;
      const bookC = bookMats[Math.floor(Math.random() * bookMats.length)];
      // ry は ±0.06 まで。振りを大きくすると z 占有が広がって確保した帯を越える。
      const zc = stackZ + (Math.random() - 0.5) * 0.04, ry = (Math.random() - 0.5) * 0.12;
      vbox(0.27, th, 0.23, pageMat, 7.6285, sy + th / 2, zc, ry);   // 小口（束）x 7.487〜7.770（棚板内）
      vbox(0.02, th, 0.23, bookC, 7.470, sy + th / 2, zc, ry);      // 背表紙が室内(-x)を向く x 7.453〜7.487
      sy += th + 0.004;
    }
  }
}
// 玄関ドア
{
  vbox(0.06, 2.1, 0.95, new THREE.MeshLambertMaterial({ color: 0x555a61 }), 7.96, 1.05, -5.15);   // 扉 x 7.93〜7.99
  vbox(0.05, 0.04, 0.16, M.metal, 7.905, 1.02, -4.82);   // レバーハンドル（旧版は x 7.925 止まりで扉面 7.93 から 5mm 浮いていた）
  vbox(0.05, 0.3, 0.06, M.dark, 7.92, 1.85, -5.15);   // ドアクローザー的な影
}
// 窓（月と、遠い街）＋ひだ付きカーテン
//
// 【v11: 奥行きの作り直し】旧v10は夜景板(-7.91)とガラス(-7.885)がわずか2.5cmしか
// 離れておらず、しかも枠(奥行き10cm)が薄かったため、カメラから見ると「夜景の絵が
// カーテンのすぐ後ろに貼り付いている」ように見えた（ユーザー報告）。
// 壁の室内面(-8.00)から動かせない一方、カーテンレール側は室内へ押し出す余地がある
// ので、①枠の奥行きを2倍(10cm→20cm)にして「凹み」自体を深くする、②夜景板を
// 凹みの最奥(-7.97)まで下げる、③ガラス・桟・カーテンレールは枠の室内側の面に
// 合わせてまとめて10cm室内へ出す──という3点で、夜景板とガラスの間に18cm、
// 凹み全体で27cm弱の空気層を作った。ガラス自体の見え方（色・不透明度）は
// v10のまま（点光源のスペキュラ玉を避けるため意図的に控えめ）。
{
  const WX = -7.96, WY = 1.72, WZ = -2.6;   // 窓中心（西壁, +x向き）
  // 夜景（凹みの最奥。壁の室内面(-8.00)のすぐ手前に置き、ガラスとの間を大きく空ける）
  const night = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.02),
    new THREE.MeshBasicMaterial({ map: nightTex }));
  night.rotation.y = Math.PI / 2;
  night.position.set(WX - 0.01, WY, WZ); scene.add(night);
  // ガラス（夜景から18cm手前。反射は控えめにして点光源のスペキュラ玉が出ないようにする）
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.02),
    new THREE.MeshStandardMaterial({ color: 0x141d30, roughness: 0.5, metalness: 0.0,
      transparent: true, opacity: 0.10 }));
  glass.rotation.y = Math.PI / 2; glass.position.set(WX + 0.175, WY, WZ); scene.add(glass);
  // 木枠のケーシング（奥行きを20cmに深くして「窓辺の凹み」を作る。上下左右の見付け＋外周を一段太く）
  const frameM = M.woodDark;
  const HW = 0.85, HH = 0.58;                // 窓開口の半幅・半高
  vbox(0.20, 0.09, HW * 2 + 0.18, frameM, WX + 0.07, WY + HH + 0.04, WZ);  // 上枠
  vbox(0.20, 0.09, HW * 2 + 0.18, frameM, WX + 0.07, WY - HH - 0.04, WZ);  // 下枠（この上に窓台）
  vbox(0.20, HH * 2 + 0.18, 0.09, frameM, WX + 0.07, WY, WZ - HW - 0.04);  // 左枠
  vbox(0.20, HH * 2 + 0.18, 0.09, frameM, WX + 0.07, WY, WZ + HW + 0.04);  // 右枠
  // 窓台（下枠の前に張り出す）＋エプロン（枠の室内側の面に合わせて張り出し量を調整）
  vbox(0.20, 0.05, HW * 2 + 0.30, frameM, WX + 0.16, WY - HH - 0.09, WZ);  // 窓台（sill）y 1.115〜1.165
  vbox(0.12, 0.10, HW * 2 + 0.10, frameM, WX + 0.13, WY - HH - 0.075, WZ); // エプロン y 1.015〜1.115（旧版は窓台の下に 3.5cm の空気が入っていた）
  // 十字の桟（縦1＋横1で4分割。細い木桟。ガラス面に重ねて「ガラスの桟」に見せる）
  vbox(0.04, HH * 2, 0.035, frameM, WX + 0.175, WY, WZ);   // 縦桟
  vbox(0.04, 0.035, HW * 2, frameM, WX + 0.175, WY, WZ);   // 横桟
  // カーテンレール＋端のフィニアル（枠の見付けよりさらに室内側へ出し、窓との間に空間を作る）
  const rod = vcyl(0.02, 0.02, HW * 2 + 0.5, M.metal, WX + 0.26, WY + HH + 0.14, WZ, 10);
  rod.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    vcyl(0.035, 0.035, 0.05, M.metal, WX + 0.26, WY + HH + 0.14, WZ + s * (HW + 0.27), 10)
      .rotation.x = Math.PI / 2;
  }
  // ひだ付きカーテン：縦の半円柱を並べて布のドレープを作る
  function pleatedCurtain(zStart, zEnd, folds, gatherAt) {
    /* 丈は 1.30 だと下端が y 1.12 まで届き、**窓台（y 1.115〜1.165 / 前面 x -7.70）を
       4.5cm 貫いて**いた。ひだの山は最大でも x -7.755 までしか手前に出ないので
       x では逃げられない。窓台の上面 1.165 で止める丈にする（小窓なので裾丈で正しい）。 */
    const top = WY + HH + 0.12, len = 1.25;   // 下端 y 1.17
    const span = zEnd - zStart;
    for (let i = 0; i < folds; i++) {
      const t = i / (folds - 1);
      const z = zStart + span * t;
      // 束ねる側ほど山が深く、開く側ほど浅い（gatherAt: 0=zStart側で束ねる, 1=zEnd側）
      const depth = 0.05 + 0.06 * (1 - Math.abs(t - gatherAt));
      const fold = new THREE.Mesh(
        new THREE.CylinderGeometry(depth, depth, len, 8, 1, false, Math.PI * 0.15, Math.PI * 0.7),
        M.fabric);
      fold.position.set(WX + 0.26 + depth * 0.5, top - len / 2, z);
      fold.rotation.y = Math.PI;      // 山（凸側）を部屋側(+x)へ向ける
      // 【影キャスト除外】月光スポット(moon)はカーテンのすぐ後ろにあるため、
      // カーテンに影を落とさせると点光源からの発散で巨大な影になり、床の光溜まりが
      // 窓の形ではなく細いスリットに潰れる。窓の形はゴボ(moon.map)側で表現するので、
      // ここは影を落とさない。天井灯から見てもカーテンは壁際で影はほぼ出ない。
      fold.userData.noShadow = true;
      scene.add(fold);
    }
    // 上端のヘッダー（ひだをまとめる帯）
    vbox(0.10, 0.10, Math.abs(span) + 0.12, M.fabric, WX + 0.27, top - 0.02, (zStart + zEnd) / 2)
      .userData.noShadow = true;   // 同上
  }
  // 左右のカーテン（外側で束ね、中央寄りが開いて夜景が覗く）
  pleatedCurtain(WZ - HW - 0.10, WZ - 0.30, 7, 0.0);   // 左パネル（左端で束ねる）
  pleatedCurtain(WZ + 0.30, WZ + HW + 0.10, 7, 1.0);   // 右パネル（右端で束ねる）
}
/* 玄関の郵便物の山。厚み 0.02 に対して段差 0.025 だったので、7枚すべての間に
   5mm の空気が入り、いちばん下の1枚も床から 1cm 浮いていた（タンスの文庫本と同じ型）。
   段差＝厚みにして下端を床（y=0）に置き、封筒同士が接した山にする。 */
for (let i = 0; i < 7; i++) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.36), M.paper);
  p.position.set(6.9 + (Math.random()-0.5)*0.5, 0.01 + i*0.02, -5.4 + (Math.random()-0.5)*0.5);
  p.rotation.y = Math.random()*0.9;
  scene.add(p);
}
// 壁掛け時計（プロシージャル。針メッシュ自体をゲーム内時刻と同期回転）
let lastWallMin = -1;
const clockHands = { minute: null, hour: null, second: null };
// 秒針の音を時計の位置から鳴らすため、ブロックの外に出してある（clockTickUpdate が使う）
const clx = 1.4, cly = 2.1, clz = -5.9;   // 中央壁の少し手前
{
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
  /* 中央ハブ（金属キャップ＋赤い秒針のカウンターウェイト風）。
     旧版は z clz+0.034〜+0.052 で **ガラスカバー（clz+0.048）を 4mm 突き抜けて**いた。
     針（〜clz+0.042）の前を覆いつつガラスの内側に収まる位置へ。 */
  vcyl(0.017, 0.017, 0.014, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.3 }),
    clx, cly, clz + 0.040, 16).rotation.x = Math.PI / 2;   // z clz+0.033〜+0.047
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
const ambient = new THREE.AmbientLight(0x2c2c40, 0.85 * 0.44 * 0.25);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x323c58, 0x100c0a, 0.85 * 0.42 * 0.25);
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
  const l = new THREE.PointLight(0xffdca8, 0.09 * PT_SCALE, 5.2, 2);   // 初期値も連動（applyLightsが即上書き）
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
// 月光（窓 → 床）。
// 【重要】壁に開口は無い（窓は西壁に貼った夜景板＋ガラス板の“絵”）。よって壁の外に
// 光源を置いても壁で遮られる。また裸のPointLightを室内に置くと「窓際に浮いた電球」に
// なり、床全体を青白く洗って夜の暗さを壊す（v9まではこれで、床の白い反射光の原因だった）。
// そこで SpotLight の投影テクスチャ（ゴボ = light.map）で“窓の形”を床に落とす。
// 桟の十字はゴボ側の模様で表現するので、光源は桟・ガラスより手前（室内側）に置く
// ＝ 窓まわりのジオメトリに自己遮蔽させない。カーテンだけは光源より前にあるので、
// castShadow により本物の影を落とす（狙いどおり）。
const moonGobo = makeTex(256, 256, (c, w, h) => {
  const ss = (e0, e1, x) => {            // smoothstep
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const HA = 0.28, HB = 0.23, EDGE = 0.055;   // 窓開口の半幅・半高（UV比）と縁のボケ
  const MW = 0.013, MS = 0.010;               // 桟の半幅と、そのボケ
  const img = c.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const a = px / w - 0.5, b = py / h - 0.5;
      // 開口のマスク（矩形＋ソフトエッジ）
      const base = (1 - ss(HA - EDGE, HA + EDGE, Math.abs(a)))
                 * (1 - ss(HB - EDGE, HB + EDGE, Math.abs(b)));
      // 十字桟：|a| か |b| が小さいところを暗くする。完全な黒にはしない（回り込み分）
      const mull = 0.18 + 0.82 * Math.min(
        ss(MW, MW + MS, Math.abs(a)), ss(MW, MW + MS, Math.abs(b)));
      // 月は高い位置にあるので、上端をわずかに強くして勾配を作る
      const grad = 1 - 0.22 * (py / h);
      const v = Math.round(255 * base * mull * grad);
      const i = (py * w + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
});
// makeTex の既定は RepeatWrapping。ゴボは繰り返すと錐台の外に窓が並んで写るので必ずクランプ。
moonGobo.wrapS = moonGobo.wrapT = THREE.ClampToEdgeWrapping;

// 【アングルが要】月は高い位置にあるので、光は窓の上端から急角度で差し込ませる。
// 窓の中心高さ(1.72)から水平寄りに撃つと、床への足跡が奥へ細長く伸びて減衰で消え、
// 「窓の形」ではなく細い滲みになる（実測済み）。開口上端(2.30)付近から床を狙う。
const moon = new THREE.SpotLight(0x7f95c8, 5.5, 9, Math.PI / 6, 0.25, 1.0);
// v11: 窓の奥行きを作り直した際、ガラス・カーテンレールをまとめて10cm室内へ寄せたので、
// 光源も同じだけ室内へ（-7.80→-7.70）。ガラス(-7.785)より室内側という関係は維持。
moon.position.set(-7.70, 2.26, -2.6);   // ガラス(-7.785)より室内側。桟・夜景板は背後になる
moon.map = moonGobo;                     // 窓の形を床へ投影
moon.castShadow = true;                  // 家具・カーテンが月光を遮る（map投影にも必要）
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.bias = -0.0015;
moon.shadow.normalBias = 0.03;
moon.shadow.camera.near = 0.05;   // カーテンが光源のすぐ室内側にあるので near は詰めておく
moon.shadow.camera.far = 9;
const moonTarget = new THREE.Object3D();
moonTarget.position.set(-6.4, 0, -2.6);  // 床（壁から約1.4m）を狙う。急角度なので足跡が窓形に収まる
scene.add(moon, moonTarget);
moon.target = moonTarget;
const flash = new THREE.SpotLight(0xfff0cf, 1.5, 15, Math.PI/5.2, 0.7, 1.6);   // 目線の懐中電灯。明るすぎたので 9→1.5 に減光
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
    new THREE.OctahedronGeometry(0.021),                      // 存在感をさらに抑える（0.085→1/4）
    new THREE.MeshLambertMaterial({ color: 0xd8cba8, emissive: color, emissiveIntensity: 0.75 })
  );
  grp.add(core);
  const l = new THREE.PointLight(color, 0.22 * 3.2, 1.0, 2);  // 明かりもさらに減光（0.34→0.22）・レンジ短縮（1.5→1.0）
  grp.add(l);
  grp.position.set(x, y, z);
  scene.add(grp);
  return grp;
}
// 本物・ダミー共通の色（見た目で真贋がバレないよう統一。※真贋は拾って中身を見て判断させる）
const ITEM_MARK_COLOR = 0xd9a441;
ITEMS.forEach(it => { itemMeshes[it.id] = makeGlow(it.x, it.y + 0.35, it.z, ITEM_MARK_COLOR); });
const fakeMeshes = FAKES.map(f => makeGlow(f.x, f.y + 0.35, f.z, ITEM_MARK_COLOR));

/* ---------- 壁のポスター（前触れ演出用） ----------
   Canvas手描きに戻してある（v22）。写真ポスター（poster_normal/anom.jpg）は
   絵として濃すぎ、部屋の他の面（プロシージャル生成）と質感が揃わないうえ、
   前触れの「ポスターが変わった」という差分が読み取りにくかった。
   ここは情報として読ませる面なので、平坦でも輪郭がはっきりする手描きを採る。 */
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

  // --- 顔＝紙の通知書プレート（+z 面に配置）。ユーザー要望で「前の顔」（ホッケーマスク導入前の
  // デザイン）に戻した。文言だけ更新：「源泉徴収票」→「重加算税」（仮装・隠蔽への懲罰的な追徴税で、
  // 確定申告ホラーというテーマに直球で刺さるので採用）。以前は素の円柱ボディに直接貼っていたが、
  // 今の頭部球（半径0.185・z scale 1.05＝前面 z≈0.244）より少し前に置いて食い込みを避ける。
  //
  // 【v22で写真テクスチャから戻した】monster_face.jpg は解像度と陰影があるぶん「作り込んだ顔」に
  // 見えてしまい、この怪人の怖さの源――事務書類がそのまま顔になっている無機質さ――が薄れた。
  // MeshBasic（陰影を受けない）なのも意図的で、暗い部屋でも紙面が白く平坦に浮く。
  const fcv = document.createElement("canvas");
  fcv.width = 256; fcv.height = 320;
  const fc = fcv.getContext("2d");
  fc.fillStyle = "#e8e4d8"; fc.fillRect(0, 0, 256, 320);
  fc.strokeStyle = "#555"; fc.lineWidth = 2;
  fc.strokeRect(10, 10, 236, 300);
  fc.fillStyle = "#222";
  fc.font = "bold 26px serif"; fc.textAlign = "center";
  fc.fillText("重加算税", 128, 46);
  fc.font = "11px sans-serif";
  for (let r = 0; r < 6; r++) {
    fc.strokeStyle = "#888"; fc.lineWidth = 1;
    fc.strokeRect(20, 66 + r * 40, 216, 34);
  }
  fc.fillStyle = "#111";
  fc.fillRect(52, 130, 42, 30);   // 目
  fc.fillRect(162, 130, 42, 30);  // 目
  const faceTex = new THREE.CanvasTexture(fcv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.43),
    new THREE.MeshBasicMaterial({ map: faceTex })
  );
  face.position.set(0, 1.87, 0.27);
  g.add(face);

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
// キー光源を弱め、その分アンビエント/ヘミのフィルで底上げする（壁焼け対策）。
// ユーザー要望で段階的に暗くしている（夜の暗さを強める）。
// 初期 {1:[0.36,0.72],...} → 1/2 → さらに 1/2（＝元の 1/4）。キー/フィル比は維持。
const LIGHT_BASE = { 1: [0.09, 0.18], 2: [0.05, 0.12], 3: [0.018, 0.075] };
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
  if (e.code === "KeyM") {
    const m = toggleMute();
    notice(m ? "🔇 ミュート" : `🔈 音量 ${Math.round(audioPrefs.vol * 100)}%`, 1.4);
  }
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

/* ---------- audio ----------
 * 音の生成エンジンは `src/audio.js` に分離してある（`tools/audio-lab.html` から
 * 単体で試聴・調整できるようにするため）。**新しい音を足すときは audio.js 側に書き、
 * 必ず BUS のどれかに繋ぐこと。** ここに残すのはゲーム状態に依存する部分だけ。
 * （import と分割代入はファイル冒頭にある。const は巻き上げられないため、
 *   ここに置くとこれより前の行から beep 等を参照できなくなる）
 */
let ambience = null;   // 環境音のハンドル（部屋鳴り・冷蔵庫）

// 設定の永続化はゲーム側の責務（audio.js が localStorage を触ると試聴ツールが
// ゲームのセーブを書き換えてしまうため）
Audio.setOnPrefsChange(p => { save.audio = p; persistSave(); });

// 【環境音は生活音だけ】v14ではドローン（52/54.7Hzのうなり）も敷いていたが、実聴の結果
// 「合成音が鳴っている」と分かってしまうので外した。部屋鳴り＋冷蔵庫の2つだけの方が
// 静かで、23:00に冷蔵庫が止まったときの落差も大きい。雨も窓の晴れた夜空と矛盾するため無し。
function audioInit() {
  Audio.audioInit(save.audio || undefined);
  ambience = {
    room: Audio.startRoomTone(),
    fridge: Audio.startFridge({ cycle: true }),
  };
}

// ワールド座標(wx,wz)の音源が、プレイヤーから見て左右どちらに聞こえるかを -1..1 で返す。
// カメラの正面は `dir = (-sin(yaw), *, -cos(yaw))`（frame() の dir 計算と同じ定義）。
// 右手ベクトルは正面をY軸まわりに-90°回した (x,z)→(-z,x) なので **(cos(yaw), -sin(yaw))**。
// 【符号に注意】ここを逆にすると全ての音が左右反対に鳴り、しかも「なんとなく変」程度にしか
// 感じられないので気付きにくい。yaw=0（-z向き）のとき、右手側 +x にある音源が +1 になるのが正しい。
// 真横で±1、正面・真後ろで0。真後ろが中央に来るのは StereoPanner の原理的な限界だが、
// 距離減衰と併せれば「どちら側に居るか」は十分伝わる。
function panFor(wx, wz) {
  const dx = wx - ply.x, dz = wz - ply.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return 0;
  const rx = Math.cos(ply.yaw), rz = -Math.sin(ply.yaw);   // 右手方向
  return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
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
  FAKES.forEach((f, idx) => { if (!f.taken) {
    const d = Math.hypot(ply.x - f.x, ply.z - f.z);
    if (d < 1.45) cand.push({ d, kind: "fake", ref: f, idx });
  }});
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
    const f = nearTarget.ref;
    f.taken = true;
    scene.remove(fakeMeshes[nearTarget.idx]);
    // 手掛かりを仕込んで2行になったので、既定の3.6秒では読み切れない
    notice(f.gag, 6.4);
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
  notice(it.gag, 6.4);   // マイナ・メモは手掛かりで2行になっている（上記 FAKES と同じ理由）
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
// マイナンバーカード暗証番号の認証ゲート。
// 【生成場所が重要】openEtax() の中で作らない（W-03）。ウィンドウを閉じて開き直しても
// 試行回数（残り3回）が保持されるようにするため、モジュールのトップレベルで1つだけ作る。
// 正解 0315 と最大試行回数 3 はここでだけ注入する（pin.js には書かない＝A-1, A-7）。
// セーブには残さない（1プレイ限り＝A-14。save 側に暗証番号関連のキーは追加しない）。
const pin = createPinGate({ answer: "0315", maxAttempts: 3 });

/** #etaxPin の入力状態と pin ゲートの状態から、送信ボタンの有効/無効を決める。
 * ロック済みなら常に無効、認証済みなら常に有効、それ以外は4桁揃うまで無効にする（A-12）。 */
function updateEtaxBtnState() {
  const btn = $("etaxBtn"), pinInput = $("etaxPin");
  const st = pin.getState();
  if (st.locked) { btn.disabled = true; return; }
  if (st.authenticated) { btn.disabled = false; return; }
  btn.disabled = normalizePin(pinInput.value) === null;
}
$("etaxPin").addEventListener("input", updateEtaxBtnState);

function openEtax() {
  state = "ETAX";
  etaxTimer = 0;
  const pinInput = $("etaxPin");
  const st = pin.getState();
  $("etaxMsg").classList.remove("ok");
  if (st.locked) {
    // ロック後にここへ来ることは通常無い（ロック直後に市役所ENDへ遷移する）が、保険として表示する
    $("etaxMsg").textContent = "カードがロックされています。市役所の窓口でのみ再登録できます。";
    pinInput.value = ""; pinInput.disabled = true;
  } else if (st.authenticated) {
    $("etaxMsg").textContent = "";
    pinInput.value = ""; pinInput.disabled = true;
  } else {
    pinInput.disabled = false;
    pinInput.value = "";
    // 開き直したとき、試行を消費済みなら残り回数を見せる（A-13：公平性）。
    // 【初回は空にする】案内文は上の .row に既にあり、#etaxMsg はエラー色（#a12b1f）なので、
    // ここに案内を出すと「まだ何も失敗していないのに赤い文が出ている」状態になる。
    $("etaxMsg").textContent = st.attemptsUsed > 0 ? `残り${st.attemptsLeft}回です。` : "";
  }
  updateEtaxBtnState();
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
  const btn = $("etaxBtn"), msg = $("etaxMsg"), win = $("etaxWin"), pinInput = $("etaxPin");

  if (!pin.getState().authenticated) {
    const r = pin.submit(pinInput.value);
    // submit するたびにタイマーを0に戻す（不正入力・誤りを含む）。能動的に操作している間は
    // 「居座り」ではないので、暗証番号を思い出す時間を実質的に確保できる（下記(A)の判断とセット）。
    etaxTimer = 0;
    if (r.status === "ok") {
      pinInput.value = "";
      pinInput.disabled = true;
      updateEtaxBtnState();
      // ここで return しない。認証成功後は既存の送信・審査処理へそのまま入る
      // （認証と真贋審査は独立。既存の却下ロジックは変更しない）。
    } else if (r.status === "wrong") {
      aggro++;
      win.classList.remove("shake"); void win.offsetWidth; win.classList.add("shake");
      pinInput.value = "";
      let html = `暗証番号が違います。残り${r.attemptsLeft}回です。`;
      if (r.finalWarning) {
        // 2回目のミス＝最終警告。既存の却下と同じ escalation（怪人を呼ぶ）に加え、
        // メモの手掛かりを再提示する。『いつもの』だけでは名前に結びつかないため、
        // 申告書の氏名欄（PLAYER_NAME）を引用して一歩踏み込む（答え0315そのものは書かない）。
        html += `<br>次に間違えるとカードがロックされます。` +
                `<br>メモには『いつもの』とだけ書いてある。` +
                `<br>……申告書の氏名欄には、いつもの名前があった。「${PLAYER_NAME}」。`;
        if (!mob.active) enterVisit();
        else visit.huntLeft = Math.max(visit.huntLeft, 25);
      }
      msg.innerHTML = html;
      updateEtaxBtnState();
      return;
    } else if (r.status === "locked") {
      if (r.justLocked) {
        // 3回目のミス。ロックの合図はちょうど1回だけ来るので、ここで ending を1回だけ呼ぶ。
        aggro++;
        win.classList.remove("shake"); void win.offsetWidth; win.classList.add("shake");
        msg.innerHTML = "暗証番号が違います。カードがロックされました。<br>再登録は市役所の窓口でのみ受け付けます。";
        pinInput.disabled = true;
        btn.disabled = true;
        setTimeout(() => ending("shiyakusho"), 2200);
      }
      return;
    } else {
      // invalid（送信ボタンは4桁揃うまで無効なので、通常の操作では到達しない）
      msg.textContent = "4桁の数字で入力してください。";
      updateEtaxBtnState();
      return;
    }
  }

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
  // 暗証番号を3回間違えてカードがロックされた失敗系エンディング（sermon と同様、ランク計算には関与しない・何も解禁しない）
  shiyakusho: { tag: "市役所 END", text: "マイナンバーカードがロックされた。<br>再登録は市役所の窓口でのみ受け付けている。<br>市役所は平日9時〜17時。<br><br>今夜、あなたはe-Taxで送信できなかった。" },
};
function ending(key) {
  if (state === "END") return;
  state = "END";
  // エンディング中は環境音を全部落とす（結末の文章を静かに読ませる）
  if (ambience) { for (const h of Object.values(ambience)) if (h) h.stop(1.5); ambience = null; }
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
let stepAcc = 0, stepGap = 1.1;
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
  // footsteps（v14で左右の定位を追加）
  // 【なぜ重要か】隠れて怪人の位置を推測するのがこのゲームの核なのに、v13までは
  // 距離減衰だけで方向が分からず、音が情報として機能していなかった。
  stepAcc += dt * sp;
  // 【歩幅もばらつかせる】音そのもののばらつき（audio.js の vary）だけでは
  // **一定間隔で鳴ること自体**が機械的に聞こえる。人間の歩行は等間隔ではないし、
  // 引きずるような歩き方なら余計に崩れる。次の1歩ごとに閾値を引き直す。
  if (stepAcc > stepGap) {
    stepAcc = 0;
    stepGap = 0.95 + Math.random() * 0.3;   // 1.1 を中心に ±15% ほど
    const vol = Math.max(0, 0.4 - pd * 0.03);
    // 【音の値はここに書かない】body / peta / snap / tone は実聴で決めた値が
    // audio.js の既定になっている。ここで上書きすると試聴台で決めた音と本編がずれるので、
    // 渡すのは定位と「1歩ごとにばらつかせる」指示だけにする。
    if (vol > 0.01) footstep(vol, { pan: panFor(mob.x, mob.z), vary: 1 });
  }
  // 接近ビネット
  if (state === "PLAY") {
    $("vignette").style.opacity = pd < 3.5 ? (1 - pd/3.5) * 0.85 : 0;
  }
  heartbeatUpdate(pd);
}

/* ---------- 心音（怪人が近いほど速く・大きく） ----------
 * 【なぜ距離で速さを変えるか】音量だけで近さを表すと、プレイヤーは音量つまみの
 * 大小と区別できない。速さは絶対的なので、環境やヘッドフォンに依らず「近い」と伝わる。
 * 隠れている間もあえて鳴らす。隠れて息を止めている最中こそ、自分の心臓だけが聞こえる。
 * 定位はしない（自分の心臓なので中央）。
 *
 * 【dt ではなく実時間で刻む】秒針と同じ理由。dt は Math.min(0.05, ...) で頭打ちなので、
 * 20fps を下回るとゲーム全体がスローモーションになり、dt で積算すると心拍も一緒に
 * 遅くなってしまう。心拍の間隔は「怪人との距離」の関数であって描画性能の関数ではない。
 * 弱いGPUのノートPCで緊張感のテンポが崩れるのは明確に間違いなので、実時間を使う。
 * （距離そのものは dt 駆動なので、低fpsでは怪人の接近が遅くなる。それは正しい挙動） */
let hbAt = 0;
const HB_RANGE = 6.5;          // これより遠いと鳴らさない
function heartbeatUpdate(pd) {   // dt は取らない（実時間で刻むため）
  const now = performance.now() / 1000;
  if (state !== "PLAY" && state !== "INSPECT") { hbAt = 0; return; }
  if (!mob.active || pd > HB_RANGE) { hbAt = 0; return; }
  if (!hbAt) { hbAt = now; return; }
  const near = 1 - Math.min(1, pd / HB_RANGE);      // 0（遠い）〜1（密着）
  // 間隔 1.15秒（遠い）→ 0.42秒（密着）。実際の心拍と同じ範囲に収めて生々しさを出す
  const interval = 1.15 - near * 0.73;
  if (now - hbAt < interval) return;
  hbAt = now;
  heartbeat(0.12 + near * 0.33);
}

/* ---------- 壁掛け時計の秒針 ----------
 * 【1秒はゲーム内時間ではなく実時間で刻む】ゲーム内時間は MIN_PER_SEC 倍で流れるので、
 * ゲーム内の秒に合わせると刻みが速すぎて時計に聞こえない（ただのノイズの連打になる）。
 * 時計の音は「時間が経っている」という体感を作るための環境音なので、実時間で刻む。
 * そのため dt ではなく performance.now() を使う。clockUpdate は e-Tax 中に dt を 0.4倍で
 * 呼ばれるが、**秒針がそれに引きずられて遅くなってはいけない**。
 *
 * 定位と減衰は時計の実際の位置（clx, clz）から計算する。壁のどこで鳴っているか分かるので、
 * 部屋の空間把握そのものの手掛かりになる。
 * 前触れ（clockGlitch）中は刻みを崩す。見た目が壊れているのに音が正確だと嘘になる。 */
let tickAt = 0, tickTock = false;
function clockTickUpdate() {     // dt は取らない（実時間で刻むため）
  const now = performance.now() / 1000;
  if (!tickAt) { tickAt = now; return; }
  // 故障中は 0.45〜1.6秒のばらつき。正常時はきっちり1秒
  const interval = clockGlitch ? 0.45 + Math.random() * 1.15 : 1.0;
  if (now - tickAt < interval) return;
  tickAt = now;
  tickTock = !tickTock;
  const d = Math.hypot(ply.x - clx, ply.z - clz);
  // 距離減衰。時計の真下（約1m）で0.13、部屋の反対側（約9m）でほぼ無音
  const vol = Math.max(0, 0.15 - d * 0.016);
  if (vol <= 0.005) return;
  clockTick(tickTock, vol, { pan: panFor(clx, clz) });
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
  clockTickUpdate();

  if (gameMin >= 21*60+30 && !flags.n2130) {
    flags.n2130 = true;
    beep(1320, 0.09, "sine", 0.2); setTimeout(() => beep(1320, 0.09, "sine", 0.16), 160);
    // 【暗証番号の手掛かり④：日付を目に入れる】21:30は必ず来るので、ダミーを1つも拾わなかった
    // プレイヤーにも「3月15日」という並びが一度は提示される。氏名「三月 十五」と同じ日付
    notice("スマホ：<b>【国税庁】確定申告の期限が近づいています</b><br>提出期限：3月15日 23:59", 4.6);
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
    // 【23:00は「音が減る」演出】v14まではドローンを止めていたが、ドローン自体を廃止したので
    // 生活音を落とす形に変えた。冷蔵庫を止めるだけだと cycle:true の停止中に当たった場合に
    // 何も起きないので、常時鳴っている部屋鳴りも同時に絞る。これで必ず落差が出る。
    if (ambience) {
      if (ambience.fridge) { ambience.fridge.stop(2.0); ambience.fridge = null; }
      if (ambience.room) ambience.room.set("vol", 0.018);
    }
    if (!mob.active && visit.state !== "omen") applyLights(1);
    if (visit.state === "none" && !mob.active) visit.nextAt = Math.min(visit.nextAt, gameMin + 2);
    notice("23:00 ── 冷蔵庫が、止まった。<br>部屋が、静かになりすぎた。あと1時間しかない。");
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
      // 【なぜ認証前だけ上限を延ばすか】暗証番号を思い出す時間が実質40秒しかないと、
      // 考え込むだけで市役所ENDより先に説教ENDに落ちてしまい、パズルとして成立しない。
      // それでも緊張が失われる心配は無い：monsterUpdate(dt) は state に関係なく毎フレーム
      // 呼ばれ続けており、下の pd < 0.95 && !ply.hidden での ending("sermon") も生きている。
      // つまり e-Tax画面に居る間も怪人は近づいてきて、机の前で捕まる。緊張は不可視の
      // タイマーではなく実在する脅威が担保しているので、認証前の上限を延ばしても緊張は落ちない。
      // さらに openEtax() は毎回 etaxTimer=0 を実行するため、元の40秒は「閉じて開き直せば
      // 無効化できる」ハードな制約ではなく、知らない人だけが罰される罠になっていた。
      // 認証後は従来どおり40秒のまま（変更なし）。submit するたびにも0へ戻す（不正入力・
      // 誤りを含む。能動的に操作している＝居座りではないため）。
      // 時計は clockUpdate(dt*0.4) で進み続け、3月16日0:00の期限後ENDが最終的な締め切りとして
      // 残るので、居座り対策は失われない。
      const etaxLimit = pin.getState().authenticated ? 40 : 90;
      if (etaxTimer > etaxLimit) ending("sermon");
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
    fakeMeshes.forEach(m => { m.children[0].rotation.y = t * 1.4; });

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
  // エンディング数は EDS のキー数から数える（shiyakusho 追加で4つ目。ハードコードしない）
  const eN = Object.keys(EDS).filter(k => save.endings[k]).length;
  $("meta").textContent =
    `異変図鑑 ${Object.keys(save.found).length}/${ANOMS.length} ／ エンディング ${eN}/${Object.keys(EDS).length}`
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

/* ---------- 音量スライダー（タイトル画面） ---------- */
{
  const sl = $("volSlider"), lab = $("volVal");
  const paint = () => {
    sl.value = String(Math.round(audioPrefs.vol * 100));
    lab.textContent = audioPrefs.muted ? "ミュート" : `${Math.round(audioPrefs.vol * 100)}%`;
  };
  paint();   // 保存された設定を復元して表示
  sl.addEventListener("input", () => { setVolume(Number(sl.value) / 100); paint(); });
}

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
window.__dbg = { ply, mob, visit, ITEMS, FAKES, openInspect, enterVisit, startOmen, ending, save, runLog,
  monster, spawnMonster,   // 検証用: 怪人の直接制御
  pin, openEtax,           // 検証用: 暗証番号ゲート本体とe-Taxの開閉（E2Eから残り回数を観測するため）
  st: () => state, gm: () => gameMin, setMin: v => { gameMin = v; },
  setMode: m => { mode = m; },
  // 検証用: 音は耳で聞けないので、グラフと実出力を数値で確認できるように公開する
  audio: { AC: () => Audio.AC, master: () => Audio.masterGain, BUS: () => Audio.BUS,
           panFor, setVolume, toggleMute, prefs: () => audioPrefs,
           ambience: () => ambience, lib: Audio },
  // 検証用: 絵は目で見られないので、撮影ハーネスから描画系を直接触れるように公開する。
  // v19まで scene が非公開で `__dbg.monster.parent` から辿る必要があった（HANDOFF §9）。
  gfx: {
    scene, camera, renderer, composer, aoPass, bloomPass, filmPass, THREE,
    /** AOのon/off・強度・半径をリロードなしで変える（before/afterを同一シードで撮るため） */
    ao(on = true, intensity = AO_INTENSITY, radius = AO_RADIUS) {
      aoPass.enabled = !!on;
      aoPass.blendIntensity = intensity;
      aoPass.updateGtaoMaterial({ radius });
      return { enabled: aoPass.enabled, intensity, radius };
    },
    /** AOバッファそのものを画面に出す（0=通常, 4=AO, 5=Denoise, 3=法線, 2=深度） */
    aoDebug(output = GTAOPass.OUTPUT.AO) { aoPass.output = output; return output; },
    /** 検分用に部屋を一時的に明るくする。暗いまま撮っても造形は判定できない */
    inspectLight(on = true) {
      ambient.intensity = on ? 1.2 : 0.85 * 0.44 * 0.25;
      hemi.intensity    = on ? 1.0 : 0.85 * 0.42 * 0.25;
      return { ambient: ambient.intensity, hemi: hemi.intensity };
    },
  } };
