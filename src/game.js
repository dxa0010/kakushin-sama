
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
// 音の生成エンジン（ゲーム非依存。tools/audio-lab.html から単体試聴できる）
import * as Audio from "./audio.js";
const { beep, thump, footstep, heartbeat, clockTick, speak,
        setVolume, toggleMute, audioPrefs } = Audio;
// マイナンバーカード暗証番号ロジック（ゲーム非依存の純粋モジュール。tests/unit/pin.test.js で単体検証できる）
import { createPinGate, normalizePin } from "./pin.js";
// 書類・異変の多言語データ（純粋モジュール。tests/unit/anoms.test.js で単体検証できる）
import { LOCALES, ANOM_IDS, docSpecs, applyAnom, canApply, anomMeta,
         localeText, codexOrigin, pinHint, deadline, formatMoney, authority } from "./anoms.js";
import { uiText, fill, formatDate, shiftDay, monthLabel } from "./ui.js";
/* ============================================================
   カクシン様 ─ 確定申告からは逃げられない — prototype
   ============================================================ */
const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;

/* ---------- state ---------- */
let state = "TITLE";           // TITLE | PLAY | INSPECT | ETAX | PAUSE | END
let gameMin = 21 * 60;         // in-game minutes
let MIN_PER_SEC = 0.45;        // モードで変わる（白0.45 / 青0.55）
let phase = 1;
const flags = { n2130: false, n2200: false, n2300: false, tvAt: 21*60 + 50 + Math.random()*40, tvDone: false };

/* ---------- items ---------- */
const ITEMS = [
  { id: "shiharai", short: "",  x:  6.9, z: -5.4, y: 0.35,
    gagKey: "gagShiharai" },
  { id: "iryohi",   short: "",    x: -7.0, z:  4.5, y: 1.15,
    gagKey: "gagIryohi" },
  { id: "mycard",   short: "",    x: -5.5, z: -4.4, y: 0.75,
    // 【暗証番号の手掛かり①：形式】必須アイテムなので、桁数と「数字だけ」は必ず伝わる
    // 900px幅で1行あたり約30字で折り返すので、<br>で区切って収める（以下のギャグも同様）
    gagKey: "gagMycard" },
  { id: "prior",    short: "",  x:  3.6, z:  5.35, y: 0.75,
    gagKey: "gagPrior" },
  { id: "password", short: "", x:  7.0, z:  2.0, y: 1.55,
    // 【暗証番号の手掛かり②：探索への誘導】『いつもの』で行き止まりにしないための一文。
    // ダミー3種のギャグに手掛かりを仕込んであるので、部屋を見て回る動機をここで作る
    gagKey: "gagPassword" },
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
    gagKey: "gagFake1" },
  { x: -4.3, z: -3.3, y: 0.35, taken: false,
    gagKey: "gagFake2" },
  { x: 0.3, z: 2.6, y: 0.35, taken: false,
    gagKey: "gagFake3" },
];
let got = 0;

/* ---------- 書類の中身と異変（真贋判定の核） ----------
   中身は src/anoms.js（5ロケール分・純粋モジュール）に移した。ここは配線だけ。
   ロケールを跨いで壊れやすいのは「見たものと却下理由の食い違い」なので、
   却下理由も図鑑名もここで文字列を持たず、必ず anomMeta() から取る。 */

/** 表示ロケール。保存値 > ブラウザ設定 > ja の順で決める。 */
function detectLocale() {
  const saved = save && save.locale;
  if (saved && LOCALES.includes(saved)) return saved;
  const langs = (navigator.languages && navigator.languages.length)
    ? navigator.languages : [navigator.language || "ja"];
  for (const raw of langs) {
    const l = String(raw).toLowerCase();
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("zh")) return "zh-Hans";
    if (l.startsWith("ru")) return "ru";
    if (l.startsWith("es")) return "es";
    if (l.startsWith("en")) return "en";
  }
  return "ja";
}
let LOCALE = "ja";     // save 読み込み後に applyLocale() で確定する
let SPECS = null;      // docSpecs(LOCALE)
let TXT = null;        // localeText(LOCALE)

/** UI 文言（ui.js）と、その差し込み値。applyLocale で作り直す。 */
let U = null;
let UVAL = null;

/** 差し込み値をそろえる。**文言側で日付や金額を組み立てない**（仕様書 §3.3）。
 * 期限を deadline() から引くので、期限を変えれば文言も一緒に動く。 */
function uiValues(locale) {
  const d = deadline(locale);
  const prev = shiftDay(d, -1);
  const next = shiftDay(d, 1);
  return {
    deadline: formatDate(locale, d.month, d.day),
    deadlineDay: formatDate(locale, d.month, d.day),
    deadlinePrev: formatDate(locale, prev.month, prev.day),
    deadlineNext: formatDate(locale, next.month, next.day),
    // 手掛かり③は同じ月の2日を並べる。月を2回書くと冗長なので分けて渡す
    //（「3月14日と3月15日」ではなく「3月14日と15日」）。
    mon: monthLabel(locale, d.month),
    d1: prev.day,
    d2: d.day,
    name: localeText(locale).playerName,
    monster: localeText(locale).monster,
    authority: authority(locale),
    taxYear: localeText(locale).eraGenuine,
  };
}

/** UI 文言を引く。差し込み記号は uiValues と引数 extra で埋める。
 * 埋め忘れは ui.js の fill が例外にする（黙って {deadline} と表示しない）。 */
function tr(key, extra) {
  const v = U[key];
  if (v === undefined) throw new Error(`UI 文言のキーが無い: ${key}`);
  return fill(v, extra ? { ...UVAL, ...extra } : UVAL);
}

function applyLocale(locale) {
  LOCALE = locale;
  SPECS = docSpecs(LOCALE);
  TXT = localeText(LOCALE);
  U = uiText(LOCALE);
  UVAL = uiValues(LOCALE);
  // 短縮名（結果ログ・所持リスト）は書類データ側が持つ。ロケールで変わるため。
  ITEMS.forEach((it) => { if (SPECS[it.id]) it.short = SPECS[it.id].short; });
}


/* ---------- モード ---------- */
const MODES = {
  /* chaseSpeed: 追跡時の速度（m/s）。null なら従来どおり「巡回速度 × 1.2」。
     【白は null のまま＝一切変えない】テストプレイで白は「ゲームに慣れた人でも3回死ぬ」
     ちょうどよさに達している、というのが実測の判断。触ると壊れる。
     【青は 4.0 の絶対値】プレイヤーは 3.6 m/s 固定なので速度差 0.4。距離4mで見つかってから
     追いつかれるまで約10秒で、視線を切るか隠れるかを選ぶ余地は残る。青は巡回速度に
     連動させない（時刻に関係なく「見つかったら 4.0 で来る」という一本の規則にする）。
     freeze: 発見した瞬間に怪人が立ち止まる秒数。白は 0（＝演出なし・従来のまま）。 */
  /* visitGap / visitSpread: 次の訪問までのゲーム内分（gap + 乱数(0..spread)）。
     白は従来の 18 + 乱数(0〜14)＝14〜32分（visitEarly 0）のまま。
     青は「ほぼ常時いるが息継ぎはある」に寄せる。
     chaseAccel: 足跡を辿り続けている間の加速。null なら加速しない（白）。
     minimapNoise: ミニマップに偽の反応を混ぜる（青のみ）。 */
  white: { labelKey: "modeWhite", forced: 2, p: 0.25, rp: 0.35, mps: 0.45, subtleW: 0.45, base: 34120, huntBonus: 0, visitEarly: 0,
           chaseSpeed: null, freeze: 0,   spotFx: false,
           visitGap: 18, visitSpread: 14, aggroMul: 1.5, aggroMax: 10, chaseAccel: null },
  blue:  { labelKey: "modeBlue", forced: 3, p: 0.5,  rp: 0.5,  mps: 0.55, subtleW: 0.75, base: 65480, huntBonus: 6, visitEarly: 0,
           chaseSpeed: 4.0,  freeze: 0.7, spotFx: true,
           /* 訪問間隔 6 + 乱数(0〜8) ゲーム内分。青は 0.55 分/秒なので**実時間で約11〜25秒**。
              【完全な常時徘徊にはしない】息継ぎが無いと緩急が消えて、恐怖ではなく作業疲労になる。
              11〜25秒は「急げば書類1枚を見極められるが、少しでも迷うと次の前触れ（9〜12秒）が
              始まってしまう」長さ。プレイヤーは検分をチキンレースとして強いられる。
              破棄ペナルティも青では緩める（min(3,…)）。元の min(10,…) は間隔18分が前提の値で、
              6分に対して10分引くと前触れが成立する前に次が始まってしまう。 */
           visitGap: 6,  visitSpread: 8, aggroMul: 1.0, aggroMax: 3,
           /* 【速度で殴らず、追われ続けた時間で殴る】初速は白と同じ「巡回×1.2」のまま。
              足跡を連続で辿っている間だけ every 秒ごとに per だけ速くなり、cap で頭打ち。
              単純な壁周回で逃げ続けると必ず追いつかれるので、**視線を切る／クローゼットに
              入る**ことに初めて意味が出る（必須ギミックにはせず、使えば効く形にする）。 */
           chaseAccel: { per: 0.2, every: 1.5, cap: 4.0 }, minimapNoise: true },
};
let mode = "white";

/* ---------- セーブ（異変図鑑・エンディング記録・周回） ---------- */
const SAVE_KEY = "kakushin_save_v1";
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === "object")
      return Object.assign({ found: {}, endings: {}, runs: 0, bestRank: "", audio: null, locale: null, sens: 100, gamma: 125, quality: "auto" }, s);
  } catch (e) {}
  // sens / gamma は「現行の実測値＝100 / 125」を基準にした百分率。
  // 明るさの既定は 1.25（docs/HANDOFF.md：実機で承認済みの v9 値）。**既定は下げない。**
  // プレイヤー側の調整は許すが、初期状態は必ずこの値から始める。
  return { found: {}, endings: {}, runs: 0, bestRank: "", audio: null, locale: null, sens: 100, gamma: 125, quality: "auto" };
}
const save = loadSave();
// ロケールはここで確定する（detectLocale が save を読むので、loadSave の後でなければならない）。
// これより前に SPECS / TXT を触るとどちらも null になる。
applyLocale(detectLocale());
// CSS は html[lang] で zh-Hans のスタックを切り替える（index.html の :root）。
// 日中で同じコードポイントの字形が違うため、ここが合っていないと
// 中国語の文章が日本の字形で組まれる。
document.documentElement.lang = LOCALE;
// 同梱フォントの読み込みを始める。canvas は @font-face を自動では読まないので、
// 書類を描く前にこの Promise を待つ（P2-7 / loadFonts のコメント参照）。
const fontsReady = loadFonts();
// 画面の文言を流し込む。type="module" は defer 相当なので、この時点で DOM は揃っている。
applyI18n();
function persistSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
const runLog = [];    // {short, fake, anomId, act, ok, revealed}
const newFound = [];
function registerFound(id) { if (id && !save.found[id]) { save.found[id] = true; newFound.push(id); } }

/** 図鑑名。ロケールごとに違うので anoms.js から取る。 */
const anomName = (id) => (id && ANOM_IDS.includes(id) ? anomMeta(id, LOCALE).name : "？？？");
/** 却下理由。プレイヤーが見たものと必ず一致させる。 */
const anomReject = (id) => anomMeta(id, LOCALE).reject;

/* 複製ごとの固定シード（v24）。異変の細部（年号のどちら／誤字の位置／化ける項目名）は
   applyAnom が rng で決める。ここを毎回 Math.random で振ると、同じ紙を開き直すたびに
   細部が変わり、**「変化した＝偽物」で間違い探しを迂回できてしまう**（本物は不変なので）。
   複製に紐づくシードから引けば、同じ一枚は何度開いても必ず同じ絵になる。 */
const mulberry32 = (a) => () => {
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function makeCopy(it, p) {
  const seed = (Math.random() * 4294967296) >>> 0;
  if (Math.random() >= p) return { fake: false, anomId: null, seed };
  const d = SPECS[it.id];
  const ok = ANOM_IDS.filter(id => canApply(id, d, LOCALE));
  const subtle = ok.filter(id => anomMeta(id, LOCALE).sub);
  const obvious = ok.filter(id => !anomMeta(id, LOCALE).sub);
  const pool = (Math.random() < MODES[mode].subtleW && subtle.length) ? subtle : obvious;
  return { fake: true, anomId: pool[Math.floor(Math.random() * pool.length)], seed };
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
  // docSpecs() は呼ぶたびに新しいオブジェクトを返し、年号年・発行日・氏名も真正値で
  // 埋まっている（L-8 / L-9d）。異変は applyAnom() が複製に当てて返す（L-16）。
  const d = SPECS[it.id];
  const s = { ...d, rows: d.rows.map(r => [...r]), stampFlip: false, mirror: false };
  return it.copy.fake ? applyAnom(it.copy.anomId, s, LOCALE, mulberry32(it.copy.seed)) : s;
}
/* canvas のフォントスタック（P2-7）。
   CSS 側は var(--f-serif) 等で一元化しているが、canvas の c.font は CSS 変数を
   解釈しないので、ここで同じ内容を持つ。**index.html の :root と揃えること。**

   同梱フォントを先頭に置く理由は Proton 対策（実機に日本語フォントが無い）。
   OS フォントは後ろに残す：実機に良いフォントがあるなら使わせない理由が無い。 */
const SC = () => (LOCALE === "zh-Hans");
const F_SERIF = () => (SC()
  ? `'Kakushin Serif SC','Kakushin Serif','Kakushin Gap',serif`
  : `'Kakushin Serif','Kakushin Serif SC','Kakushin Gap','Hiragino Mincho ProN','Yu Mincho',serif`);
const F_SANS = () => (SC()
  ? `'Kakushin Sans SC','Kakushin Sans','Kakushin Gap',sans-serif`
  : `'Kakushin Sans','Kakushin Sans SC','Kakushin Gap','Hiragino Sans','Yu Gothic',sans-serif`);
/* 等幅は金額・日付・暗証番号に使う。元の Noto Sans Mono は CJK を持たないので、
   「2025年6月30日」のような日付のために sans へ落ちる必要がある。 */
const F_MONO = () => `'Kakushin Mono',${F_SANS()}`;

/** 同梱フォントを実際に読み込む。
   **canvas は @font-face を自動では読まない。** c.font に名前を書いても、
   その face が未読込なら黙って次のフォントへ落ちる。つまり待たずに描くと
   初回の書類だけ OS フォント（Proton では豆腐）で描かれ、しかも
   2枚目からは直るので原因が分かりにくい。描く前に必ずここを待つ。 */
async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const fams = ["Kakushin Sans", "Kakushin Serif", "Kakushin Sans SC",
                "Kakushin Serif SC", "Kakushin Mono", "Kakushin Gap"];
  // load は「この文字列を描くのに要る face」を読む。ロケールでは分けず、
  // 和字・簡体字・数字・₽ を全部含む 1 つの文字列を渡す。
  // （分けると SC() を参照することになるが、loadFonts はモジュール上端から
  //   呼ぶので、その時点で const SC はまだ初期化されていない＝TDZ で落ちる。）
  const probe = "\u78ba\u6c47\u7b80" + "0\u20bd";
  await Promise.all(fams.flatMap((f) => [
    document.fonts.load(`16px '${f}'`, probe),
    document.fonts.load(`600 16px '${f}'`, probe),
    document.fonts.load(`16px '${f}'`, "0"),
  ])).catch(() => {});
  await document.fonts.ready;
}

/** text が maxW に収まる最大のフォントサイズを basePx 以下で選び、c.font に設定する。
 * 実測した幅を返す。多言語化で文字列長がロケールごとに大きく変わるため、
 * 固定サイズのままだと枠外へ流れて**異変が読めなくなる**（本作では致命的）。 */
function fitFont(c, text, maxW, basePx, tail, head = "") {
  let px = basePx;
  c.font = head + px + tail;
  let wdt = c.measureText(text).width;
  while (wdt > maxW && px > 8) {
    px -= 1;
    c.font = head + px + tail;
    wdt = c.measureText(text).width;
  }
  return wdt;
}

function drawDoc(spec) {
  const cv = $("docCv"), c = cv.getContext("2d"), w = cv.width, h = cv.height;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.textBaseline = "alphabetic";
  c.fillStyle = "#ece7d8"; c.fillRect(0, 0, w, h);
  if (spec.mirror) { c.translate(w, 0); c.scale(-1, 1); }
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
    c.textAlign = "center"; c.textBaseline = "middle";
    // 「呪」は1字だが、ラテン文字圏は VOID / NULO と複数字になる。幅に合わせて縮める。
    fitFont(c, TXT.curseMark, 92, 34, `px ${F_SERIF()}`);
    c.fillText(TXT.curseMark, 0, 0);
    c.restore();
  }
  /* 【「濡れた文字」の滲みは文字だけに掛ける】v22 まで、この shadowBlur は関数の頭で
     立てて末尾の restore() まで解除されず、**枠線・透かし・朱印・罫線を含む全ての
     fill/stroke がシャドウ付き**で描かれていた。Canvas の shadowBlur は通常描画より
     一桁近く重く、しかも異変の名前は「濡れた**文字**」なので枠や印まで滲むのは仕様違い。
     ここ（題字の直前）から、朱印の直前までの文字描画にだけ掛ける。 */
  if (spec.blur) { c.shadowColor = "rgba(40,38,30,0.85)"; c.shadowBlur = 3.5; }
  c.fillStyle = "#22201c"; c.textAlign = "center";
  // 題字はロケールで長さが大きく変わる（「支払調書」4字 と "Nonemployee Compensation" 24字）。
  // 固定サイズだと枠外へ流れて読めなくなるので、必ず幅に収める。
  fitFont(c, spec.title, w - 56, 32, `px ${F_SERIF()}`, "600 ");
  c.fillText(spec.title, w / 2, 78);
  c.textAlign = "right"; c.font = `15px ${F_SANS()}`; c.fillStyle = "#4a463c";
  c.fillText(spec.era, w - 28, 44);
  c.textAlign = "left"; c.strokeStyle = "#9a9484"; c.lineWidth = 1;
  c.strokeRect(26, 106, w - 52, 46);
  c.font = `14px ${F_SANS()}`; c.fillStyle = "#5a564a"; c.fillText(TXT.labelName, 38, 134);
  const nameX = 38 + c.measureText(TXT.labelName).width + 22;
  c.fillStyle = "#22201c";
  fitFont(c, spec.name, w - 52 - (nameX - 26) - 14, 21, `px ${F_SERIF()}`);
  c.fillText(spec.name, nameX, 136);
  spec.rows.forEach((r, i) => {
    const y = 172 + i * 60;
    c.strokeRect(26, y, w - 52, 48);
    // 項目名と値は同じ行に左右で並ぶ。項目名は幅の55%までに収め、残りを値に渡す。
    c.fillStyle = "#5a564a";
    const labW = fitFont(c, r[0], (w - 78) * 0.55, 13, `px ${F_SANS()}`);
    c.fillText(r[0], 38, y + 29);
    c.fillStyle = "#22201c";
    fitFont(c, r[1], w - 78 - labW - 12, 17, `px ${F_MONO()}`);
    c.textAlign = "right"; c.fillText(r[1], w - 40, y + 31); c.textAlign = "left";
  });
  c.fillStyle = "#3c3930";
  // 発行元は法人名なので長い（«Организация информационных систем...» 等）。
  // 印（右下）に重ならないよう、右端から100px 手前までに収める。
  const issued = `${TXT.labelIssuer}${TXT.colon}${spec.issuer}`;
  fitFont(c, issued, w - 30 - 100, 14, `px ${F_SANS()}`);
  c.fillText(issued, 30, h - 68);
  c.font = `14px ${F_SANS()}`;
  c.fillText(spec.date, 30, h - 38);
  c.save();
  c.shadowBlur = 0;   // 朱印は滲ませない（上の「文字だけ」の但し書きを参照）
  c.translate(w - 80, h - 78);
  if (spec.stampFlip) c.rotate(Math.PI);
  /* 朱印は書類であることの記号だが、顔として見たときは**目より目立ってはいけない**。
     0.85 の朱色は暗い体の中で唯一の彩度になり、視線がそこへ行っていた（agy）。
     かすれた古い印として、薄く細く残す。 */
  c.globalAlpha = 0.42; c.strokeStyle = "#8e4438"; c.lineWidth = 1.6;
  c.beginPath(); c.arc(0, 0, 30, 0, Math.PI * 2); c.stroke();
  if (spec.stampEye) {
    c.fillStyle = "#f4f0e6";
    c.beginPath(); c.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1a1815";
    c.beginPath(); c.arc(0, 0, 4.5, 0, Math.PI * 2); c.fill();
  } else {
    c.fillStyle = "#b23b2e"; c.textAlign = "center"; c.textBaseline = "middle";
    // 「印」は1字、「М.П.」「SELLO」は複数字。円（半径30）の内側に収める。
    fitFont(c, TXT.sealMark, 48, 26, `px ${F_SERIF()}`);
    c.fillText(TXT.sealMark, 0, 2);
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
  m.position.set(x, y + 0.35, z); m.userData.baseY = y + 0.35; showGlow(m, true);
}

/* ---------- three basics ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050507);
scene.fog = new THREE.Fog(0x050507, 6, 17);
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 50);

/* ---------- 画質プリセット（v23で追加） ----------
   v22 まで、モバイルとデスクトップが**完全に同一の設定**で回っていた（分岐が1つも無い）。
   影を落とす光源が7個（うち PointLight が5個＝それぞれキューブ6面レンダリング）、
   GTAO 16サンプル、UnrealBloom、MSAA、pixelRatio 上限2。スマホでは「ゲームとして
   動かすのがキツい」という報告になっていた。

   【端末判定は UA を見ない】UA 文字列は当てにならないうえ、同じ機種でも世代で性能が違う。
   触れる画面か・論理コア数・実メモリの3つで見て、**迷ったら low に倒す**（重くて遊べない
   より、少し地味でも動くほうがよい）。deviceMemory は Chromium 系にしか無いので、
   取れなければ「並」とみなす。
   save.quality に "high" / "low" があればそれを優先する（ポーズ画面で変更できる）。 */
const isTouch = matchMedia("(pointer: coarse)").matches;
function detectQuality() {
  if (save.quality === "high" || save.quality === "low") return save.quality;
  const cores = navigator.hardwareConcurrency || 4;
  const mem   = navigator.deviceMemory || 4;
  return (isTouch || cores <= 4 || mem <= 4) ? "low" : "high";
}
let QUALITY = detectQuality();
const LOW = () => QUALITY === "low";

// antialias は WebGL コンテキスト生成時にしか決められない（後から切り替えられない）ので、
// 起動時の判定で確定させる。ポーズ画面で品質を変えたときに再取得できない唯一の項目だが、
// MSAA は下の GTAO・シャドウに比べれば軽いので、ここだけ据え置きでも実害は小さい。
const renderer = new THREE.WebGLRenderer({
  antialias: !LOW(),
  powerPreference: "high-performance",   // 内蔵GPUではなく discrete を要求（未指定だと既定任せ）
});
renderer.setPixelRatio(LOW() ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// 【PCFSoftShadowMap を使わない理由】three r185 で**廃止済み**で、内部では PCFShadowMap に
// フォールバックしている。つまり見た目は既に PCF のもので、指定しても得られるものが無い。
// そのうえ WebGLShadowMap.render() が「deprecated」を**毎フレーム** console.warn する
// （three.core の warn は warnOnce と違って dedupe しない）。絵は変わらずログ生成コストだけ
// 払っていたので、実際に走っている型を明示して止める。
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// 既定 1.25 は実機で承認済みの値（docs/HANDOFF.md）。**既定を下げない。**
// プレイヤーが設定画面で変えた場合だけ save.gamma が効く。
renderer.toneMappingExposure = save.gamma / 100;
$("app").appendChild(renderer.domElement);
// 異方性フィルタは GPU の上限をそのまま使っていた（多くの環境で16）。床や壁を浅い角度で
// 見たときのボケ止めなので効果はあるが、サンプル数がそのまま帯域に効く。低画質では4に抑える
// （4→16 の差は、暗い夜の部屋を歩いている限りほぼ判別できない）。
const MAXANISO = Math.min(renderer.capabilities.getMaxAnisotropy(), LOW() ? 4 : 16);

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
    // 見つかっている度合い 0..1（v23）。ヴィネットと彩度をここで動かす。
    // 【DOM の #vignette ではなくシェーダでやる理由】彩度を落とすには元の色が要る。
    // DOM のオーバーレイは上に色を乗せることしかできないので、彩度は落とせない。
    spot: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; uniform float spot;
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
      /* 【見つかっている間の演出】画面中央の地形は必ず見えたまま保つ。
         パンくずで追われる以上、角とドアの位置を読んで逃げる必要があり、
         視界を奪う演出は「理不尽な死」に直結する。だから触るのは
         (1) 彩度（血の気が引く）と (2) 四隅（周辺視を締める）の2つだけで、
         中央の明度とコントラストには一切手を入れない。 */
      if (spot > 0.001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum), spot * 0.7);              // 完全なモノクロにはしない
        float edge = smoothstep(0.28, 0.88, length(d) * 1.15);
        col = mix(col, vec3(0.17, 0.02, 0.02), edge * spot * 0.7);   // 四隅から赤黒く侵食
      }
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
/* 【AO と Bloom は半解像度で回す】v22 までこの2つは「起動時は CSS ピクセル、resize が
   一度でも起きると composer 経由で dpr 倍」という一貫しない状態だった（EffectComposer が
   effectiveWidth = width * pixelRatio で setSize を掛け直すため）。dpr 2 の端末では
   **アドレスバーの開閉で resize が飛んだ瞬間にピクセル数が4倍になる**——モバイルで
   「遊び始めてしばらくしたら重くなる」の正体がこれ。

   どちらのパスも低周波な情報しか作らない（AO は接触部の陰り、Bloom は明部の滲み）ので、
   半分の解像度で作って全解像度に合成しても絵は保たれる。起動時から resize 後まで同じ
   倍率で走るようにして、上の「途中から4倍」も同時に潰す。 */
const FX_SCALE = 0.5;
const fxSize = (w, h) => [Math.max(1, Math.round(w * FX_SCALE)), Math.max(1, Math.round(h * FX_SCALE))];
const dpr0 = renderer.getPixelRatio();
const aoPass = new GTAOPass(scene, camera, ...fxSize(innerWidth * dpr0, innerHeight * dpr0));
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(...fxSize(innerWidth * dpr0, innerHeight * dpr0)), 0.28, 0.55, 0.9);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const filmPass = new ShaderPass(FilmShader);
composer.addPass(filmPass);

// composer は resize のたびに全パスへ effectiveWidth/Height を配る。AO と Bloom だけは
// そこに FX_SCALE を掛けて受け取らせる（内部のレンダーターゲットだけが縮む。合成先の
// writeBuffer は composer が持つフル解像度のままなので、絵の出力サイズは変わらない）。
for (const p of [aoPass, bloomPass]) {
  const base = p.setSize.bind(p);
  p.setSize = (w, h) => base(...fxSize(w, h));
}

addEventListener("resize", () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  filmPass.uniforms.res.value.set(innerWidth, innerHeight);
});

/* ---------- 画質の適用 ----------
   起動時（シーン構築後）と、ポーズ画面で品質を変えたときに呼ぶ。
   **シーンより後に呼ばれる前提**（光源を traverse するため）なので、定義はここでも
   呼び出しは下の applyLights(1) の隣にある。

   low で落とすもの（重い順）:
   1. 影を落とす光源を7→1灯。PointLight のシャドウはキューブ6面ぶんのシーン再描画で、
      天井灯4基＋PC画面グローの5灯だけで毎フレーム30面。ここが単独で最大の負荷。
   2. GTAO（16サンプル＋デノイズ）を丸ごと切る。夜の部屋の接触影は失われるが、
      そもそも描画が間に合わなければ絵の善し悪し以前の問題になる。
   3. Bloom を切る。発光体のグローが痩せるだけで、造形の情報は落ちない。
   4. pixelRatio を 1 に。dpr 3 の端末では**これだけでピクセル数が1/9**になる。
   MSAA(antialias) だけはコンテキスト生成時に決まるので、ここでは変えられない。 */
function applyQuality() {
  const low = LOW();
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  // EffectComposer は生成時の pixelRatio を自分で抱えていて、renderer 側を変えても
  // 追随しない（addons/postprocessing/EffectComposer.js の _pixelRatio）。明示的に渡す。
  // setPixelRatio は内部で setSize を呼ぶので、続けて setSize する必要はない。
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  filmPass.uniforms.res.value.set(innerWidth, innerHeight);
  aoPass.enabled    = !low;
  bloomPass.enabled = !low;
  scene.traverse((o) => {
    if (!o.isLight || !o.shadow) return;
    // 作者が意図した castShadow を最初の1回だけ控えておく（low→high で復元するため）。
    if (o.userData.wantShadow === undefined) o.userData.wantShadow = o.castShadow;
    o.castShadow = low ? !!o.userData.keepShadow : o.userData.wantShadow;
    // 残す1灯も 2048→512 に落とす。手持ちライトの影は輪郭が動き続けるので、
    // 解像度の粗さは「揺れる影」に紛れて目立たない。
    const want = low ? 512 : (o.userData.baseMapSize || o.shadow.mapSize.x);
    if (o.userData.baseMapSize === undefined) o.userData.baseMapSize = o.shadow.mapSize.x;
    if (o.shadow.mapSize.x !== want) {
      o.shadow.mapSize.set(want, want);
      // mapSize はテクスチャ確保後に変えても反映されない。捨てて作り直させる。
      if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    }
    /* 【静的な光源の影は焼いて固定する（v24）】
       renderer.shadowMap.autoUpdate は既定 true なので、v23 までは**部屋・家具・壁が
       1ミリも動かないのに、影を落とす7灯ぶんの影マップを毎フレーム描き直していた**。
       PointLight はキューブ＝1灯6面なので、点光源5灯＋スポット2灯で1フレーム32パス。
       実測で GPU 15.98ms のうち 12.5ms（78%）、draw call 4691本のうち 3762本がこれ。

       light.shadow.autoUpdate は**光源ごと**に効く（WebGLShadowMap が光源単位で
       `autoUpdate === false && needsUpdate === false` を見てスキップする）。そこで
       視線に追従する懐中電灯だけ毎フレーム更新し、残りは needsUpdate で一度だけ
       焼いて固定する。実測 15.98 → 6.20ms、46.5 → 60.6fps。

       代償として、**焼いた6灯は怪人の影を出さなくなる**（影マップは1枚の深度テクスチャ
       なので「静的な部分だけ焼く」はできない）。怪人の影は懐中電灯が落とすものだけになる。
       焼き直しが要るのは影を落とす形状が動いたときだけで、照明の減光（applyLights）は
       intensity しか触らないため再焼成は不要。 */
    o.shadow.autoUpdate = !!o.userData.dynamicShadow;
    if (!o.shadow.autoUpdate) o.shadow.needsUpdate = true;   // 次の1フレームで焼き直す
  });
}

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
    ...clothSurf(3.8, 6.8, 2.6),                   // 1.00×1.75m。26cm角のタイルを保つ。綿は光を拾うので強め
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
  const J = new THREE.Matrix3(), n = new THREE.Vector3(), o = new THREE.Vector3();
  const eps = 1e-3, m = new Array(9);
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
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    o.copy(n).applyMatrix3(J);
    /* 逆転置が信用できない2つの場合は、元の法線をそのまま残す。
       (1) 行列式が0だと Matrix3.invert() は零行列を返す（＝長さ0）。
       (2) **行列式が負のとき**、写像はその点で局所的に裏返っていて、逆転置は法線を
           裏（内側）へ向ける。結果その頂点だけ真っ黒な四角として画に出る。
           det を別に計算せず「元の法線と逆を向いたか」で判定する（det<0 でも法線が
           ほぼ元の向きなら害は無いので、症状そのものを見るほうが素直）。
       v24 のシーツと掛け布団で実際に踏んだ。裾の急な落ち込みと edge の水平揺らぎが
       重なった帯で det が −21 まで落ちていた。原因側は drape() で直したが、変位場を
       足すたびに同じ穴に落ちるので、ここで受け止める。 */
    if (o.lengthSq() > 1e-12 && o.dot(n) > 0) { o.normalize(); nor.setXYZ(i, o.x, o.y, o.z); }
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  g.computeBoundingSphere(); g.computeBoundingBox();
  return mesh;
}

/* 布の変位場。原点中心のボックス前提（cbox が作るもの）。
   ・fold: 主なうねりの振幅[m]。正弦3本の和で、1本目が幅方向に走る畝、2本目が直交する
     長い波、3本目が斜め成分。**3本目が無いとコーデュロイに見える**（v21 で薄い箱7本の
     畝を並べて失敗したのと同じ絵になる）。だから波長も詰めすぎない。
   ・edge: 輪郭を水平（x/z）に揺らす振幅[m]。輪郭が波打つのは光の向きにも視点にも
     依存しないので、どのカットでも効く。
     **これは厚み方向に一様（w で減衰させない）。** v24 では w を掛けていて、それが
     法線反転の原因だった: ∂dx/∂y = edge/H で、シーツは H=3cm しかないので 0.010/0.03
     ＝0.33 の剪断になり、裾の急な傾き ∂dy/∂x ≈ −2.8 と掛かって行列式が負に落ちる
     （det が最小 −21 まで行き、上面の 620 セルで法線が裏返って真っ黒になった）。
     物理的にも一様のほうが正しい: 一様なら側面が鉛直のまま輪郭ごと波打つが、
     w を掛けると天端だけずれて側面が斜めに歪む＝薄い板ほど破綻する。
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
       シルエットの揺れになる。edge は輪郭を水平に押すだけなので、裾の**長さ**の
       ばらつきはこちらでしか作れない。
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
  /* 裾の帯。sx/sz を省略すると帯を作らない。
     帯幅が 0 のときに 1e-6 で割ってはいけない。中心差分は eps=1e-3 だけ外へも踏み出すので、
     帯の外側の境目で tz が 1000 になり、∂dy/∂z が −70 という嘘の傾きになる（実際に
     シーツで踏んだ。sz 未指定なのに z の端の列だけ法線が壊れていた）。帯が無いなら
     そもそも t を計算しない、と分けておく。 */
  const useX = sx < ax, useZ = sz < az;
  const bx = useX ? sx : ax, bz = useZ ? sz : az;
  const spanX = useX ? ax - bx : 1, spanZ = useZ ? az - bz : 1;
  return deform(mesh, (x, y, z) => {
    const w = (y - y0) / H;
    const u = x / ax, v = z / az;                                       // -1..1 に正規化した面内座標
    const dy = fold * (0.60 * Math.sin(kx * x + phase) * (0.72 + 0.28 * Math.cos(kz * z * 0.6 + 1.1))
                     + 0.28 * Math.sin(kz * z + phase * 1.7)
                     + 0.16 * Math.sin(kx * 0.62 * x + kz * 1.35 * z + 2.3))
             - dome * (u * u * 0.55 + v * v * 0.45);
    // 裾: 左右は絶対値、足側は片側だけ。角は両方効くので hypot で合成し、いちばん低く垂れる。
    const tx = useX ? Math.min(1, Math.max(0, (Math.abs(x) - bx) / spanX)) : 0;
    const tz = useZ ? Math.min(1, Math.max(0, (z - bz) / spanZ)) : 0;
    const t = Math.min(1, Math.hypot(tx, tz)), s = t * t;
    const hem = drop * (1 + hemWave * (0.60 * Math.sin(kz * 1.1 * z + phase)
                                     + 0.40 * Math.sin(kx * 0.9 * x + phase + 1.9)));
    return [edge * Math.sin(kz * 0.8 * z + phase),
            w * dy - s * (hem + w * thin),
            edge * Math.sin(kx * 0.8 * x + phase + 1.3)];
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
  /* 敷きシーツ。
     v24b: 0.92 → 1.00 幅、裾 0.11 → 0.14、うねり 7mm → 16mm。撮影で掛け布団は布に
     見えるようになったのにシーツだけ白い箱のままだった。原因は2つあって、どちらも
     「裾を付けた」だけでは足りていなかった、ということ。
     (1) **裾の帯に分割が1つしか無かった。** 0.92 幅・sx 0.425 では帯幅が
         (0.46-0.425)=3.5cm で、nx=24 の刻み 3.8cm より狭い。つまり垂れは
         「1枚の四角を斜めに切った面」になり、t² の曲がりもシルエットの揺れも
         出しようがなかった。掛け布団の帯は 18cm/4cm＝4.5分割あったので効いていた。
         → 幅 1.00・sx 0.40 で帯 10cm、nx 40 で刻み 2.5cm ＝ 4分割。
     (2) **マットレスとシーツの色が近く（#d6d0c0 と #cfc7b6）、境目が読めなかった。**
         裾 11cm ではマットレス側面 18cm のうち 7cm が残り、その 7cm がシーツと
         同じ白に見えるので、2つ合わせて1個の白い塊になっていた。
         → 裾 0.14 で下端 y 0.343〜0.427。シーツの裾は |x|=0.50、マットレス側面は
           |x|=0.44 なので**横から見るとマットレスは完全に裾の裏に隠れる**。
           白い塊＝シーツだけになり、その下に濃いオークのフレーム側面(0.18〜0.32)が
           帯で残る＝縁が読める。下端 0.343 はフレーム天端 0.32 の 2cm 上なので貫通しない
           （裾は |x|=0.50 でフレーム外面 0.49 より 1cm 外を通るので、そもそも当たらない）。
     うねりは 7mm → 16mm、波長も 29×48cm → 19×24cm（kx 30 / kz 22）に詰めた。
     7mm/29cm は傾き 1.4° で、平らな白い面と見分けが付かない。16mm/19cm なら 10° 前後。
     天端は 0.539〜0.571 に収まり、掛け布団の天端の最低 0.581 を突き抜けない。
     材でやろうとしても無理：fabric001_normal の傾きは ±0.24 しかなく、この明るさで
     1.5m 離れると normalScale を上げても画に出ない（tools/texstat.mjs で計測）。
     皺は材ではなく形で作る、というのが v24 の結論。
     sz は指定しない＝足元は垂らさない。帯を取るほどの余りが無く、しかも足元は
     掛け布団の下に隠れる。
     底面は動かさないので 0.525 のまま＝マットレス天端 0.53 に 5mm 食い込む。
     柔らかい物どうしを数cm重ねるのは既存の方針どおりで、こうしないと縁が浮いて
     「乗せた紙」に見える。
     v25: 長さ 1.86 → 1.75、中心 z -4.7 → -4.755（足側だけ 11cm 詰めた）。
     1.86 だと足側の端が z -3.77 まで届くが、**掛け布団の裾が落ち始めるのは z -3.80**
     （掛け布団中心 -4.30 ＋ sz 0.50）なので、シーツの端の 3cm ほどが掛け布団の
     落ちていく面を突き抜けて表に出ていた。レイキャストで測ると 8頂点・最大 1.9cm、
     絵では布団の真ん中あたりに白い小片が乗っているように見えていた（C:/tmp/poke.mjs）。
     足側を -3.88 で止めると裾の落ち始めより 8cm 内側に入る。頭側は -5.63 のままで
     ヘッドボード前面 -5.625 の裏に 5mm 潜り込む＝端が見えない。 */
  drape(cbox(1.00, 0.03, 1.75, M.sheet, -6.55, 0.54, -4.755, 0, 40, 2, 40),
    { fold: 0.016, kx: 30, kz: 22, phase: 0.7, edge: 0.010,
      sx: 0.40, drop: 0.14, thin: 0.012, hemWave: 0.30 });
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
  /* 【怪人の背中一面に黒い破片が散っていた】面の重なりだと思って形を何度も直したが、
     --noshadow で撮ると一度に消えた。正体はシャドウアクネ（影の自己遮蔽）。
     怪人は半径 0.2〜0.3 の大きな曲面で出来ているので、光に対して寝た面が広く、
     normalBias 0.02 では 1024 の影マップ1テクセルぶんの厚みを吸収しきれない。
     部屋の家具は角ばっていてこの向きが少ないため、これまで表に出ていなかった。
     ※ normalBias を上げすぎると影が接地点から浮く（peter-panning）ので、
       壁の根元が浮かない範囲でいちばん大きい値を選ぶ。 */
  l.shadow.bias = -0.0009;
  l.shadow.normalBias = 0.055;
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
moon.shadow.bias = -0.0016;
moon.shadow.normalBias = 0.070;   // 月光は入射が浅く、怪人の曲面でアクネが出やすい
moon.shadow.camera.near = 0.05;   // カーテンが光源のすぐ室内側にあるので near は詰めておく
moon.shadow.camera.far = 9;
const moonTarget = new THREE.Object3D();
moonTarget.position.set(-6.4, 0, -2.6);  // 床（壁から約1.4m）を狙う。急角度なので足跡が窓形に収まる
scene.add(moon, moonTarget);
moon.target = moonTarget;
const flash = new THREE.SpotLight(0xfff0cf, 1.5, 15, Math.PI/5.2, 0.7, 1.6);   // 目線の懐中電灯。明るすぎたので 9→1.5 に減光
flash.castShadow = true;
// 低画質では影を落とす光源をこの1灯だけにする（applyQuality が userData を見る）。
// 【なぜ懐中電灯を残すか】プレイヤー視点に追従する唯一の光源で、怪人や家具の落ち影が
// 「自分が照らしている方向」に出る。ここが消えると部屋が平面の書き割りになり、
// 暗い部屋を手探りで進むという体験そのものが失われる。天井灯の落ち影は動かないので
// 情報量が少なく、削っても遊びには効かない。
flash.userData.keepShadow = true;
// 同じ理由で、**影を毎フレーム焼き直す唯一の光源**でもある（applyQuality を参照）。
flash.userData.dynamicShadow = true;
flash.shadow.mapSize.set(2048, 2048);
flash.shadow.bias = -0.002;
flash.shadow.normalBias = 0.04;
flash.shadow.camera.near = 0.2;
flash.shadow.camera.far = 15;
const flashTarget = new THREE.Object3D();
scene.add(flash, flashTarget);
flash.target = flashTarget;
/* 【懐中電灯を視点からずらす（v24）】v23 まで flash.position はカメラと**完全に同座標**
   だった。光源と視点が一致していると、物の影はその物自身の真裏に落ちて本体に隠れる
   ＝**影が一切見えない**。怪人を照らしても影が出ないのはこれが理由。
   右手・肩の高さぶんだけずらすと視差が生まれ、怪人を捉えた瞬間に影が横へ逃げて壁に伸びる。
   照射の的（flashTarget）は画面中央のまま動かさないので、狙いはズレず酔いも出ない。 */
const FLASH_OFF = { right: 0.30, down: 0.20 };
const flashRight = new V3();

/* ---------- item props ---------- */
const itemMeshes = {};
function makeGlow(x, y, z, color) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.021),                      // 存在感をさらに抑える（0.085→1/4）
    new THREE.MeshLambertMaterial({ color: 0xd8cba8, emissive: color, emissiveIntensity: 0.75 })
  );
  // マーカーは動く（拾う・湧き直す）が、静的な光源の影マップは焼いて固定してある。
  // 落ち影を持たせると、動いたあとに古い位置の影が residue として残る。2cm の粒なので
  // 影そのものに情報は無く、落とさないのが正しい。
  core.userData.noShadow = true;
  grp.add(core);
  const l = new THREE.PointLight(color, 0.22 * 3.2, 1.0, 2);  // 明かりもさらに減光（0.34→0.22）・レンジ短縮（1.5→1.0）
  grp.add(l);
  grp.position.set(x, y, z);
  grp.userData.on = true;
  grp.userData.baseY = y;           // 上下動の基準（frame の item bobbing が使う）
  grp.userData.lit = l.intensity;   // 点け直すときの明るさ（applyLights は触らない）
  scene.add(grp);
  return grp;
}
/* 【マーカーを消すときシーンから光源を外さないこと（v24）】
   three.js はシーン内のライトの**本数をシェーダに焼き込んで**プログラムを作る。
   本数が変わると視界にある全マテリアルのプログラムが作り直しになり、その完了を
   getProgramInfoLog が同期待ちするので、メインスレッドがまるごと止まる。
   マーカーは1個ずつ PointLight を抱えていて（本物5＋フェイク3＝8灯）、v23 までは
   受理で `visible = false`、フェイク回収で `scene.remove` していた。**そのたびに
   本数が1つ減り、実測で毎回 4.2〜4.4秒の完全停止**（RTX 3060 Ti で、である）。
   1周に8回起きるので合計30秒以上フリーズしていた。テストプレイの「何か選択した
   前後でしっかり止まってる（ロード挟んでる？）感じ」はこれ。
   そこで**光源は必ずシーンに残したまま、明るさを0にして芯だけ隠す**。本数が
   変わらないのでプログラムは1本も増えず、停止は完全に消える（実測で 28→28 本）。 */
function showGlow(grp, on) {
  grp.userData.on = on;
  grp.children[0].visible = on;                                 // 光る芯
  grp.children[1].intensity = on ? grp.userData.lit : 0;        // 光源は外さない
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
    c.font = `900 46px ${F_SANS()}`;
    // 縦書きの1字看板。ラテン文字圏は1字ずつ「PAY!」のように積む。
    c.fillText(tr("signPay"), 96, 66); c.fillText(tr("signTax"), 96, 122);
    c.fillText(tr("signDo1"), 96, 178); c.fillText(tr("signDo2"), 96, 234);
  } else {
    c.fillStyle = "#2b4a7a";
    // ポスターの内寸は約 174px。日本語は「確定申告」4字で収まるが、
    // 「¿Ya la has hecho?」「Федеральное налоговое управление」は確実にはみ出す。
    // 書類（drawDoc）と同じく、必ず幅に収めてから描く。
    fitFont(c, tr("posterTitle"), 164, 26, `px ${F_SERIF()}`, "bold ");
    c.fillText(tr("posterTitle"), 96, 88);
    fitFont(c, tr("posterAsk"), 164, 26, `px ${F_SERIF()}`, "bold ");
    c.fillText(tr("posterAsk"), 96, 128);
    c.fillStyle = "#55503f";
    fitFont(c, UVAL.authority, 164, 13, `px ${F_SANS()}`);
    c.fillText(UVAL.authority, 96, 220);
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
//
/* 【v25で作り直した理由】方向性（大柄・前傾・黒い作業着・通知書の顔・マチェーテ）は
   そのままに、「解像度」だけを上げる。v24 までは 35 個の素の円柱／箱を並べた造りで、
   四面図（tools/shot-mob.mjs）に出た欠点が3つあった。
   ・円柱の分割が 10〜14 しかなく、輪郭が多角形として見えていた。
   ・**円柱の平らな端面がそのまま露出**していて、肩・襟・胴の上端が「開いた樽」に見えた。
     関節も上腕と前腕が段差で突き合わさるだけで、肘・膝・手首が存在しない。
   ・作業着の法線タイリングが粗く（1.4×2.2）、縦に積んだ円柱に横縞が乗って
     「タイヤ積み」に見えていた。v24 は normalScale を 0.22 まで落として誤魔化していたが、
     縞の原因はタイリングの粗さなので、細かくして布の織り目に戻すのが本筋。

   【なぜ形を増やしてもコストが上がらないか】部品はすべて材質ごとのバケツに溜めて、
   最後に mergeGeometries で1メッシュに統合する。怪人は内部が一切アニメーションしない
   剛体なので統合して失うものが無く、**部品 35 個・ドローコール 35 → 部品 100 超・
   ドローコール 10** になる。頂点は増えるがドローコールとシェーダ切り替えは減るので、
   v24 で 1869 まで落としたドローコール予算を食わない。 */
function makeMonster() {
  const g = new THREE.Group();

  /* 形を崩すための乱数。**固定シード**にする――毎回 Math.random で振ると
     リロードのたびに別人になり、四面図での比較（改修前後の差分）が成立しない。 */
  const rr7 = mulberry32(0x51A2C3);

  // --- 怪人専用マテリアル（この個体だけで使うのでローカル定義） ---
  // 【明度を分ける】v24 は上着もズボンもブーツも同じ真っ黒で、四面図では全身が
  // 1枚のシルエットに潰れていた。上着／ズボン／革で明度と色相をずらすと、
  // 暗い部屋でも「服を着た体」として面が分かれて見える。
  const clothSet = loadPBRSet("fabric049", 13, 13);     // タイリングを細かく＝縞ではなく織り目に見せる
  /* 【明度に段を付ける】v25 の作り直しまで、上着も外套も革もすべて 0x1f〜0x33 の
     狭い帯に収まっていて、造形をどれだけ整えても全身が1枚の黒いシルエットに潰れていた。
     ホラーの暗い部屋で「服を着た大男」に見えるには、4段の明度が要る:
       外套 0x12(最暗) < 下に着ている服 0x4c(中) < 革 0x6a(明るい茶) < 紙・鋼(最明)。
     外套を最も暗くするのは、輪郭を闇に溶かしつつ、その手前の中間色で体の厚みを見せるため。 */
  /* 【暗闇で輪郭が消えるのを止める】v25の中盤まで、部屋の照明下では顔の紙以外が
     真っ黒に溶けて、巨体も得物もシルエットとして見えていなかった。原因は
     「一様に粗い黒」で、拡散反射しか返さないため光源の位置に関係なく同じ暗さになること。
     scene.environment（RoomEnvironment）は環境強度 0.06 まで絞ってあるが、
     **envMapIntensity は材質ごとに掛かる**ので、この個体だけ 2〜5 倍に上げれば、
     部屋の見た目を一切変えずに怪人の縁だけが鈍く光る。粗さも革は 0.45 まで下げて
     「濡れた革」に寄せる（0.2 まで落とすとプラスチックになるので下げすぎない）。 */
  const cloth     = new THREE.MeshStandardMaterial({ ...clothSet, color: 0x585c4c, roughness: 1.0, metalness: 0,
                                                     envMapIntensity: 0.12, normalScale: new THREE.Vector2(0.28, 0.28) });  // 上着（暗いオリーブ）
  const clothDark = new THREE.MeshStandardMaterial({ ...loadPBRSet("fabric049", 13, 13), color: 0x41453a, roughness: 1.0, metalness: 0,
                                                     envMapIntensity: 0.12, normalScale: new THREE.Vector2(0.28, 0.28) });  // ズボン・裏地
  /* 肌にも面の質を持たせる。ベタ塗りの肌色は、どんな形に作ってもゴム手袋か粘土に見える。
     革のノーマル／ラフネスを細かく敷くと、拡大しても毛穴と皺のある皮膚として読める。 */
  const skin    = new THREE.MeshStandardMaterial({ ...loadPBRSet("leather030", 9, 9), color: 0x5c4c3c,
                                                   roughness: 0.82, envMapIntensity: 1.2 });                    // くすんだ肌（手・首）
  const scalp   = new THREE.MeshStandardMaterial({ color: 0x0e0d0a, roughness: 1.0, envMapIntensity: 0.1 });                                      // 頭頂（汚れた髪/頭皮）＝白いオーブ化を防ぐ
  const boot    = new THREE.MeshStandardMaterial({ ...loadPBRSet("leather030", 2.4, 2.4), color: 0x4a3f31, roughness: 0.45, metalness: 0.08, envMapIntensity: 4.0 }); // 使い込んだ革のブーツ
  const bootSole= new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 0.95 });                                      // 靴底
  /* 【角い部品に貼ると真っ黒になった】strapM は loadPBRSet の拡散マップと
     ラフネスマップを持っている。丸い部品（紐・玉）では気付かなかったが、
     箱に貼ると面が一様なぶん、暗い拡散マップ×暗い色×低ラフネスの鏡面が
     そのまま出て、光を1つも返さない黒い板になる（腰帯・胸当ての金具）。
     この作りでの原則どおり、角い革は**法線だけ**にして色で決める。 */
  const beltM   = new THREE.MeshStandardMaterial({
    normalMap: loadTex("./assets/textures/leather030_normal.webp", false, 5, 5),
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0x3d3021, roughness: 0.74, metalness: 0.0, envMapIntensity: 0.55 });   // 腰帯・金具
  /* 【革が磨いたクロムの管に見えていた】roughness 0.45 に envMapIntensity 4.0 は、
     環境の明るさを 4 倍にして低い粗さで返す設定。顔のすぐ横で吊り紐だけが
     金属パイプのように光っていた。使い込んだ革はほとんど反射しない。 */
  /* 色も明るすぎた。leather030 の拡散マップ自体が明るい茶なので、0x6a5238 を掛けても
     顔の紙のすぐ横で吊り紐だけが浮く。決定稿の吊り紐は前掛けより一段**暗い**。 */
  /* 【暗くしすぎて存在しないことになった】0x3f3324 は体（ほぼ黒）との差が小さく、
     吊り紐がどの角度からも輪郭として出ていなかった（agy「エプロンの首ひもが無い」）。
     「顔の紙のすぐ横で浮く」という以前の問題は、紐を**肩ではなく首へ**回して
     お面の真下から外したことで解消しているので、いまは体から分離できる明度に戻せる。
     前掛けの布よりは暗い、というのが決定稿の関係。 */
  const strapM  = new THREE.MeshStandardMaterial({ ...loadPBRSet("leather030", 3.5, 3.5), color: 0x574733, roughness: 0.76, envMapIntensity: 0.8,
                                                   side: THREE.DoubleSide }); // 革ベルト・紙の縛り（腰帯は開いた面なので両面）
  /* 前掛けの革。ベルトと同じ強い艶（roughness 0.45 / envMap 4.0）を使うと、
     胸に黒光りする甲羅を着けたように見える。艶を落として、外套より一段明るくし、
     「布の上に革を一枚あてている」という層の重なりが読めるようにする。 */
  const apronM  = new THREE.MeshStandardMaterial({ ...loadPBRSet("leather030", 4.5, 4.5), color: 0x5b4a38,
                                                   roughness: 0.78, metalness: 0.02, envMapIntensity: 1.1 });
  const bladeM  = new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 0.30, metalness: 0.88, envMapIntensity: 5.0 }); // 金具（鎖・鋲・バックル）
  /* 刃だけは別材質にする。金具と同じ磨いた鋼だと、90cm の大鉈が「綺麗な銀色の板」に
     見えて質量が伝わらない。錆色・粗さ 0.65 の鈍い反射に落とし、刃先には血糊を重ねる。
     鎖や鋲の鋭いハイライトは暗所で怪人の動きを伝える情報なので、そちらは光らせたまま。 */
  /* 刃は錆びた鋼の明度まで上げる。得物が見えることは演出ではなく操作の前提。
     暗所で「何を持っているか」「今どう構えているか」が読めないと駆け引きにならない。 */
  const bladeRust = new THREE.MeshStandardMaterial({ color: 0x6a6055, roughness: 0.52, metalness: 0.80, envMapIntensity: 2.2 });
  const goreM   = new THREE.MeshStandardMaterial({ color: 0x2a0e0a, roughness: 0.94, metalness: 0.0 });   // こびりついた血糊
  /* 柄と刃が同じ暗さだと、持ち手から切っ先までが1本の鈍器に見える（agy）。
     決定稿の柄は木で、錆びた刃よりはっきり暗く、かつ茶色い。 */
  const handleM = new THREE.MeshStandardMaterial({ color: 0x3a2b1c, roughness: 0.88, envMapIntensity: 0.5 });                 // 大鉈の柄（木）
  const holeM   = new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1.0, metalness: 0 });                          // 刃の穴（抜けた向こうの闇）
  /* === 決定稿（concept4）の配色 ===
     決定稿が使っている色は4つしかない: ほぼ黒の体・カーキの前掛け・生成りの紙・錆色の刃。
     体には織り目もノーマルマップも無く、**滑らかなマネキン**として塗られている。
     ここまで使っていた布の法線マップを体から外すのは、質感を捨てるためではなく、
     決定稿の「陰影だけで丸みを見せる」塗りを成立させるため。丸い面に細かな凹凸が
     乗ると、光の勾配が割れて塊の丸みが読めなくなる。 */
  /* 【艶を落とす】roughness 0.46〜0.62・envMapIntensity 2.2〜3.4 で置いていたとき、
     丸めた背中に幅の広い白いハイライトが一本乗り、頭は磨いた兜に見えていた。
     決定稿の体は**つや消しの塗り**で、丸みは鏡面ではなく拡散の勾配だけで出ている。
     粗さを 0.78〜0.86 まで上げ、環境反射を 1.2〜1.6 に絞ると、
     光沢の帯が消えて面の向きの差だけが残る。
     ただしゼロにはしない――暗い部屋では、輪郭に乗るわずかな環境光が
     「そこに立体がある」ことを伝える唯一の手がかりになる。 */
  /* 【体にテクスチャを一切当てていなかった】色だけの単色マテリアルなので、
     どんなに形を整えても面に情報が無く「のっぺりしたグレーの粘土」に見える
     （agy が全ラウンドで指摘した最大の減点理由）。

     拡散マップは当てない――当てると color に乗算されて明度が半分になり、
     この怪人の「ほぼ黒」が成立しなくなる。必要なのは**面の質**だけなので、
     革の法線とラフネスだけを借りる（プロジェクト既定の clothSurf と同じ考え方）。
     タイリングは 6〜9 と細かめ。2〜5m 離れて見るので、粗いと縞に見える。
     normalScale は 0.55〜0.75――マネキンの表面は布ほど荒れていない。 */
  /* 【ラフネスマップは当てない】leather030_roughness を乗算すると、暗い画素の
     ところだけ実効ラフネスが下がって鏡面になり、体にツヤのあるまだら模様が出た
     （革の材質では正しくても、つや消しのマネキンでは破綻する）。
     必要なのは面の凹凸だけなので、**法線マップのみ**を借りてラフネスは一定に保つ。
     強さも 0.62 → 0.30。マネキンの表面は革ほど荒れていない。 */
  const skinSurf = (rx, ns) => ({
    normalMap:   loadTex("./assets/textures/leather030_normal.webp", false, rx, rx),
    normalScale: new THREE.Vector2(ns, ns),
  });
  /* 【プラスチックのテカりがある】決定稿の体は球体関節人形のつや消しで、
     光をほとんど返さない。envMapIntensity 1.4 は暗所で輪郭を拾うために上げた値だが、
     明るい場所では環境の映り込みが乗って樹脂に見える（agy）。
     輪郭は関節の合わせ目の線が受け持つようになったので、反射は落としてよい。 */
  const bodyM   = new THREE.MeshStandardMaterial({ ...skinSurf(7, 0.30), color: 0x2e2e33, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.55 });  // 体（つや消しの黒）
  const bodyDk  = new THREE.MeshStandardMaterial({ ...skinSurf(9, 0.34), color: 0x1f1f24, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.45 });  // 手・靴（一段暗い）
  /* 【関節が露骨なボールに見えていた】球の半径は筒の根元より 8mm 大きいだけで、
     輪郭としてはほとんど出ていない。目立っていたのは**明度差**のほう。
     0x38383f は体（0x2e2e33）より一段明るく、しかも環境反射も強いので、
     暗い体の上で関節だけが白い玉として浮いていた（agy）。
     参照のマネキンは、関節も同じ黒で、継ぎ目の線と面の切り替わりだけが見える。 */
  const jointM  = new THREE.MeshStandardMaterial({ ...skinSurf(6, 0.26), color: 0x333338, roughness: 0.91, metalness: 0.0, envMapIntensity: 0.50 });  // 関節の球
  /* 前掛けは決定稿でいちばん面積の大きい色。革というより厚手のキャンバス地で、
     艶はほとんど無い。ここだけ明度を 0x8a まで上げて、黒い体と紙の白の間を埋める。 */
  /* 色は**アルベド地図の上に乗る**ので、0x8a を指定しても革の地図で暗く沈み、
     最初の版では焦げ茶の前掛けになっていた。地図のぶんを見越して 0xc4 まで上げる。
     ここが黒い体と紙の白の中間調を担うので、沈むと画面が二値になる。 */
  const cSet = loadPBRSet("leather030", 3.0, 3.0);
  /* 【明るくしすぎた】0x9c8256 まで上げたら、スタジオ照明では前掛けが
     ほぼ紙と同じ明るさ（#d5c7a5 対 #e8e4d8）になり、腰の書類の束が
     前掛けに溶けて見分けられなくなった。決定稿の前掛けは紙のおよそ半分の明度
     （#6e6049 対 #ddd6c4）の、くすんだカーキ。中間調は担いだまま、
     紙とのあいだにはっきり段を付ける。 */
  /* 【ラフネスマップを外す】体で学んだのと同じ問題。乗算で暗い画素のところだけ
     実効ラフネスが下がり、布に鏡面のまだらが出て「明るすぎる硬い板」に見えていた。
     必要なのは織り目の凹凸だけなので法線のみ残す。 */
  /* ※ 55% を記録した回はここが「法線＋ラフネス、色 0x554730、粗さ 0.90」だった。
     14回目にラフネスマップ除去と減光を同時に入れて 40% へ落ちたので、まず戻して測る。
     複数を同時に変えたせいで切り分けに採点を1回余計に使っている。 */
  /* 【布がプラスチックの板に見えていた】原因は形ではなく反射。
     ・ラフネスマップは乗算で効くので、暗い画素のところだけ実効ラフネスが下がり、
       つや消しであるはずの布に鏡面のまだらが出る（体と外套で同じ結論に達している）
     ・envMapIntensity 0.9 は、環境の明るさを布が拾って「濡れたビニール」になる
     布に必要なのは織り目の凹凸だけ。法線だけ残して、反射は落とす。 */
  /* 【裾が定規で切ったように真っ直ぐだった】布に見えるかどうかを最後に決めるのは
     **縁の乱れ**。どれだけシワを入れても、裾が一直線なら断ち切った板に見える（agy）。
     外套で使っている裾抜きのアルファ（hemTex）をそのまま掛ける。
     v=0 が裾なので、そのまま貼れば下端だけがほつれ、途中に穴も開く。
     alphaTest なので半透明のソートは起きず、影も同じ形で落ちる。
     ※ hemTex は canvasM 専用ではないが、canvasM を使うのは前掛けだけ。 */
  const canvasM = new THREE.MeshStandardMaterial({ normalMap: cSet.normalMap,
                                                   color: 0x554730, roughness: 0.99, metalness: 0,
                                                   envMapIntensity: 0.14, side: THREE.DoubleSide });
  // ※ 裾抜きの hemTex はこの下で作るので、生成後に canvasM へ差し込む（下記）。
  const twineM  = new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.98, side: THREE.DoubleSide });                                          // 書類を縛る麻ひも
  /* 刃は体より明るくする。得物が何かを読ませるのは演出ではなく操作の前提で、
     暗所で体と同じ明度だと「腕の延長」に溶けて、振り上げが見えない。 */
  /* 【木の板に見えていた】0x8a6244・metalness 0.52 は明るい茶色で、金属というより
     かまぼこ板だった（agy が3ビューすべてで最大の減点に挙げた）。
     錆びた鋼は「暗い地に、面の向きで鋭く光が走る」もの。明度を落として金属質を上げ、
     粗さを下げると、同じ形のままでも板ではなく刃物として読める。 */
  /* metalness 0.82 の暗い色は、環境光の弱い部屋では拡散光をほとんど返さず
     ほぼ黒に沈む。錆は金属というより酸化物なので、金属質を下げて明度を上げる。 */
  /* 明度を上げすぎて、暗い部屋で顔の紙の次に明るい面になっていた。
     刃は「暗い地に縁だけ光る」のが正しく、面全体が光ると板に見える。 */
  /* 【白い板に見える】envMapIntensity 2.4 は面全体が環境光を拾い、暗い部屋で
     顔の紙の次に明るい面になっていた。錆びた鋼は「暗い地に、縁と一部の面だけが光る」。
     環境反射を 0.9 まで落とし、粗さを上げて拡散寄りにする。
     刃先の細い帯（edgeM）だけは光らせたまま残す――そこが刃物であることの手がかり。 */
  /* 【暗所で顔の紙と同格に光っていた】このキャラは「暗闇で白いのは顔の紙だけ」が核。
     刃が同じ明るさで光ると、視線が2か所に割れて設計が壊れる。
     明度と環境反射をさらに落とし、刃先の細い帯だけで刃物だと分からせる。 */
  /* 刃も単色だった。metal063 の法線だけを細かく敷くと、面に錆の凹凸が出て
     「塗った板」から「腐食した鋼」になる。ラフネスマップは体と同じ理由で当てない
     （まだらな鏡面が出る）。 */
  /* === 錆のマップ ===
     【なぜ頂点カラーでは足りないか】刃は ExtrudeGeometry で作っている。押し出しの
     面は**輪郭の点だけ**を三角形分割したもので、面の内側に頂点が1つも無い。
     体で効いた頂点カラーの汚しは、ここでは原理的に模様を描けない
     （agy「包丁は汚れが一つもない新品のよう」が何度直しても消えなかった理由）。
     面に情報を載せるにはマップが要る。写真素材は増やさない方針なので描いて焼く。
     赤錆は「広い斑」「刃の長さ方向へ流れた筋」「点々とした孔食」の3層で読める。 */
  const rcv = document.createElement("canvas");
  rcv.width = 256; rcv.height = 512;
  {
    const rc = rcv.getContext("2d");
    let rs = 20260831;
    const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    rc.fillStyle = "#9b9186"; rc.fillRect(0, 0, 256, 512);            // 地金（曇った鋼）
    /* 【錆が全面を覆って「茶色いまな板」になっていた】半径 14〜76 の斑を 150 個、
       不透明度 0.16〜0.68 で撒くと、256×512 の地金が**どこにも残らない**。
       地金の色をいくら曇った鋼（#9b9186）にしても、その上を茶色が塗り潰すので、
       出来上がりは一様な茶色い板になる（agy「木のパドル」「まな板」）。
       参照の刃は地金が半分ほど見えていて、そこに錆が**島として**乗っている。
       錆の情報は面積ではなく、地金との**境目**が持っている。数と濃さを落とす。 */
    for (let i = 0; i < 88; i++) {
      const x = rnd() * 256, y = rnd() * 512, r = 14 + rnd() * 58;
      const g = rc.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.14 + rnd() * 0.40;
      /* ※ r 100〜140 は明るい橙で、地金を明るくした（0x7d6e60 → 0x8d8a84）あとでは
         斑がピンクに転んで、2時方向では刃が「なめし革」に見えた。錆は橙ではなく
         **暗い赤茶**なので、赤を落として黒を足す。 */
      g.addColorStop(0, `rgba(${84 + rnd() * 30 | 0},${42 + rnd() * 20 | 0},24,${a})`);
      g.addColorStop(1, "rgba(120,60,30,0)");
      rc.fillStyle = g; rc.beginPath(); rc.arc(x, y, r, 0, 7); rc.fill();
    }
    // 刃を研いだ方向（長さ方向）へ流れる筋。錆と地金の境目がここで割れる
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 256, y = rnd() * 512;
      rc.strokeStyle = rnd() < 0.5
        ? `rgba(72,36,18,${0.06 + rnd() * 0.22})`
        : `rgba(176,168,156,${0.05 + rnd() * 0.16})`;
      rc.lineWidth = 0.6 + rnd() * 2.4;
      rc.beginPath(); rc.moveTo(x, y); rc.lineTo(x + (rnd() - 0.5) * 14, y + 24 + rnd() * 130); rc.stroke();
    }
    // 孔食。小さく濃い点。これが入ると「腐って穴が開き始めた鉄」になる
    for (let i = 0; i < 420; i++) {
      rc.fillStyle = `rgba(30,16,10,${0.40 + rnd() * 0.55})`;
      rc.beginPath(); rc.arc(rnd() * 256, rnd() * 512, 0.7 + rnd() * 2.6, 0, 7); rc.fill();
    }
  }
  const rustTex = new THREE.CanvasTexture(rcv);
  rustTex.colorSpace = THREE.SRGBColorSpace;
  rustTex.wrapS = rustTex.wrapT = THREE.RepeatWrapping;
  const cleaverM= new THREE.MeshStandardMaterial({
    map: rustTex,
    normalMap: loadTex("./assets/textures/metal063_normal.webp", false, 4, 4),
    normalScale: new THREE.Vector2(0.85, 0.85),
    /* 参照の刃は赤錆の上に鋼の地色が斑に覗く「明るい茶」で、暗い体から
       はっきり分離している。0x4a3c33 では体と同じ暗さに沈み、輪郭しか見えなかった。 */
    /* ※ 明るくしすぎると今度は白く飛んで「金属の板」になる。錆は反射しない。
       金属味は metalness ではなく、刃先の細い edgeM の線だけが受け持つ。 */
    /* 明るくすると煉瓦色の板、暗くすると「のっぺりした灰色の塊」（agy はこの両方を
       別々の回に指摘した）。錆のマップが読めるだけの明度は要る一方、彩度は要らない。
       中間の 0x7d6e60 に置き、模様の強さはマップ側のコントラストで作る。 */
    /* 錆の斑を減らして地金を出したので、掛け色も茶を抜いて中性の灰に寄せる。
       0x7d6e60 は茶色寄りで、錆の上からさらに茶を掛けていた。 */
    color: 0x86837d, roughness: 0.76, metalness: 0.26, envMapIntensity: 0.26 });   // 錆びた刃
  // 刃先だけは研いだ鋼。細い明るい線が1本入るだけで「切れるもの」に見える
  /* 【廃止】研ぎ面は箱（rbox + この材質）で作っていたが、実物に合わせて幅を広げたとたん
     「黒い帯の上に鋸歯の明線が乗ったもの」になった。箱には側面があるので、面に平置きすると
     側面が影になって黒く残る。いまは刃の頂点カラーで焼いている（大鉈のブロックを参照）。
     この材質はどこからも参照していないが、経緯として名前だけ残す。 */
  // const edgeM = new THREE.MeshStandardMaterial({ color: 0x8e867c, roughness: 0.30, metalness: 0.88, envMapIntensity: 2.6 });
  /* 書類そのものを衣装の一部として体に纏わせる（v25）。この怪人は「確定申告の化身」
     なので、腰から下げた申告書の束・体に貼り付いた通知・首から提げた木札が、
     そのままシルエットを壊す装飾になる。紙は1枚の共通テクスチャで、部品ごとに
     UV を 0..1 で使うため、何枚下げても統合後は1ドローコールに収まる。 */
  const scv = document.createElement("canvas");
  scv.width = 128; scv.height = 176;
  const sc = scv.getContext("2d");
  sc.fillStyle = "#cfc7b1"; sc.fillRect(0, 0, 128, 176);
  for (let i = 0; i < 10; i++) {
    sc.fillStyle = `rgba(120,104,74,${0.05 + Math.random() * 0.10})`;
    sc.fillRect(Math.random() * 128, Math.random() * 176, 10 + Math.random() * 40, 6 + Math.random() * 30);
  }
  sc.strokeStyle = "#6d6552"; sc.lineWidth = 2; sc.strokeRect(8, 8, 112, 160);
  sc.fillStyle = "rgba(52,46,34,0.6)";
  for (let r = 0; r < 9; r++) sc.fillRect(18, 26 + r * 16, 30 + Math.random() * 64, 4);
  sc.strokeStyle = "rgba(150,40,34,0.55)"; sc.lineWidth = 4;
  sc.beginPath(); sc.arc(96, 44, 20, 0, 7); sc.stroke();
  const scrapTex = new THREE.CanvasTexture(scv);
  scrapTex.colorSpace = THREE.SRGBColorSpace; scrapTex.anisotropy = MAXANISO;
  const paperM = new THREE.MeshStandardMaterial({ map: scrapTex, color: 0x9a9484, roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
  /* 【紙束の側面は「印刷面」ではなく「小口」】書類の束に印字テクスチャを
     そのまま巻くと、罫線が箱の全面に回り込んで**灰色の格子**になり、
     腰に付いたスピーカーか引き出しに見えていた。実際に見えているのは
     重なった紙の**切り口**なので、細い横縞だけのテクスチャを別に作る。
     縞の間隔と濃さを1本ずつ散らすのは、等間隔だと縞ではなく網に見えるため。 */
  const ecv = document.createElement("canvas");
  ecv.width = 8; ecv.height = 128;
  const ec = ecv.getContext("2d");
  ec.fillStyle = "#cdc5ad"; ec.fillRect(0, 0, 8, 128);
  for (let i = 0; i < 128; i++) {
    if (rr7() > 0.42) continue;
    ec.fillStyle = `rgba(96,88,68,${0.10 + rr7() * 0.26})`;
    ec.fillRect(0, i, 8, 1);
  }
  const edgeTex = new THREE.CanvasTexture(ecv);
  edgeTex.colorSpace = THREE.SRGBColorSpace;
  edgeTex.wrapS = edgeTex.wrapT = THREE.RepeatWrapping;
  const sheafM = new THREE.MeshStandardMaterial({ map: edgeTex, color: 0xa39b86, roughness: 0.99, metalness: 0,
    normalMap: loadTex("./assets/textures/cardboard001_normal.webp", false, 5, 5),
    normalScale: new THREE.Vector2(0.60, 0.60) });  // 紙束の小口
  /* 【束の「面」にまで小口を貼っていた】edgeTex は 8×128 の横縞で、これは紙の
     **切り口**の柄。ところが束を作っている板の6面すべてに同じ材質を割り当てていたので、
     いちばん手前を向いている面――つまり「いちばん上の紙の表」――にも横縞が出ていた。
     どれだけ枚数を増やしても縁を荒らしても、正面から見えるのが横縞である以上
     「溝を彫った木のブロック」「すだれ」からは出られない
     （agy が4回連続でここを指摘し、こちらも4回とも別の場所を直していた）。
     参照の束は、手前の1枚が**罫線と印字の入った書状**で、その下に小口が覗く。
     scrapTex には朱印の赤い丸が入っていて顔の紙の記号と被るので、印字だけの別版を起こす。 */
  const lcv = document.createElement("canvas");
  lcv.width = 128; lcv.height = 176;
  {
    const lc = lcv.getContext("2d");
    lc.fillStyle = "#d3cbb6"; lc.fillRect(0, 0, 128, 176);
    for (let i = 0; i < 12; i++) {                       // 古紙のむら
      lc.fillStyle = `rgba(122,106,76,${0.04 + rr7() * 0.09})`;
      lc.fillRect(rr7() * 128, rr7() * 176, 10 + rr7() * 40, 6 + rr7() * 30);
    }
    lc.strokeStyle = "#6d6552"; lc.lineWidth = 2; lc.strokeRect(9, 9, 110, 158);
    lc.fillStyle = "rgba(48,42,32,0.62)";
    lc.fillRect(20, 22, 58, 7);                          // 見出しの行（太い）
    lc.strokeStyle = "rgba(90,84,66,0.5)"; lc.lineWidth = 1;
    lc.beginPath(); lc.moveTo(20, 35); lc.lineTo(108, 35); lc.stroke();
    lc.fillStyle = "rgba(48,42,32,0.48)";
    for (let r = 0; r < 11; r++) lc.fillRect(20, 44 + r * 11, 26 + rr7() * 70, 3);
  }
  const letterTex = new THREE.CanvasTexture(lcv);
  letterTex.colorSpace = THREE.SRGBColorSpace; letterTex.anisotropy = MAXANISO;
  const letterM = new THREE.MeshStandardMaterial({ map: letterTex, color: 0x9e9787, roughness: 0.99,
    metalness: 0, side: THREE.DoubleSide,
    normalMap: loadTex("./assets/textures/cardboard001_normal.webp", false, 5, 5),
    normalScale: new THREE.Vector2(0.45, 0.45) });  // 束のいちばん上の1枚（書状の面）
  /* 【直線の縁が布を板に見せる】板をどれだけ薄くしても、輪郭が定規で切った直線である
     かぎり「黒い下敷き」にしか見えない（agy の指摘）。四角いポリゴンのまま輪郭だけを
     引き裂くには、アルファで抜くしかない。2×2 の並びに 4 種類の裂け方を描いて、
     部品ごとに UV を1マスへ寄せる。alphaTest なので半透明のソートは発生せず、
     影も同じ抜きで落ちる（three.js は深度用の材質に alphaMap と alphaTest を引き継ぐ）。 */
  const acv = document.createElement("canvas");
  acv.width = 256; acv.height = 512;
  const ac = acv.getContext("2d");
  ac.fillStyle = "#000"; ac.fillRect(0, 0, 256, 512);
  const rnd7 = (a, b) => a + rr7() * (b - a);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 128, oy = ((q / 2) | 0) * 256;
    ac.save(); ac.translate(ox, oy);
    ac.fillStyle = "#fff";
    ac.beginPath();
    ac.moveTo(rnd7(4, 14), 0); ac.lineTo(128 - rnd7(4, 14), 0);          // 上端は縫い付けてあるので直線
    for (let k = 0; k < 5; k++) ac.lineTo(128 - rnd7(2, 16), 30 + k * 34);   // 右の縁を波打たせる
    for (let k = 0; k < 7; k++) ac.lineTo(128 - rnd7(6, 52), 200 + k * 8);   // 裾を裂く
    for (let k = 0; k < 7; k++) ac.lineTo(rnd7(6, 52), 248 - k * 8);
    for (let k = 0; k < 5; k++) ac.lineTo(rnd7(2, 16), 166 - k * 34);        // 左の縁
    ac.closePath(); ac.fill();
    // 裾から垂れるほつれ糸。1本ごとに長さを変える（揃うとフリンジになる）
    for (let k = 0; k < 9; k++) {
      const tx = 12 + k * 13 + rnd7(-4, 4);
      ac.fillRect(tx, 200, rnd7(1.5, 3.5), rnd7(6, 48));
    }
    // 布に開いた穴。抜けた向こうが見えると一気に「傷んだ布」になる
    for (let k = 0; k < 3; k++) {
      ac.fillStyle = "#000"; ac.beginPath();
      ac.ellipse(rnd7(24, 104), rnd7(40, 180), rnd7(3, 11), rnd7(4, 15), rnd7(0, 3), 0, 7); ac.fill();
      ac.fillStyle = "#fff";
    }
    ac.restore();
  }
  const tornTex = new THREE.CanvasTexture(acv);
  /* 【布に環境反射を乗せない】暗闇で輪郭を出したくて envMapIntensity を上げていたが、
     ドレープ（縦ジワ）を入れたあとは、その反射が溝のハイライトになって
     「黒いゴミ袋」「波板トタン」に見えるようになった。輪郭を出す役目は
     革・鋼・紙に任せて、布は完全なつや消しにする。 */
  const tornMat = (color, rough) => new THREE.MeshStandardMaterial({
    ...loadPBRSet("fabric049", 13, 13), color, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.10, normalScale: new THREE.Vector2(0.38, 0.38),
    alphaMap: tornTex, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const rag     = tornMat(0x3e4436, 0.96);   // ほつれた布片（裾から垂れる切れ端）
  const ragDark = tornMat(0x1e2218, 0.98);   // 同・裏地側
  /* 【外套は「面」であって「短冊の山」ではない】板を何十枚も並べると、
     どれだけ角度と丈を振っても**1着の衣ではなく布切れの山**に見える。
     衣は連続した面で、裂けているのは裾と縁だけ――そこで、円筒の一部（arc）で
     面を張り、裾だけを抜くアルファを別に用意する。
     横方向は継ぎ目が出ないよう、左右の端の高さを揃えて描く。 */
  const hcv = document.createElement("canvas");
  hcv.width = 512; hcv.height = 256;
  const hc = hcv.getContext("2d");
  hc.fillStyle = "#000"; hc.fillRect(0, 0, 512, 256);
  hc.fillStyle = "#fff";
  hc.beginPath(); hc.moveTo(0, 0); hc.lineTo(512, 0);
  const edge = [];
  for (let k = 0; k <= 32; k++) edge.push(k === 0 || k === 32 ? 202 : 178 + rr7() * 68);
  for (let k = 32; k >= 0; k--) hc.lineTo(k * 16, edge[k]);
  hc.closePath(); hc.fill();
  for (let k = 0; k < 40; k++) {                 // 裾から垂れるほつれ糸
    const tx = rr7() * 512, base = edge[Math.min(32, Math.round(tx / 16))];
    hc.fillRect(tx, base - 6, 1.5 + rr7() * 3, rr7() * 62);
  }
  for (let k = 0; k < 10; k++) {                 // 布に開いた穴
    hc.fillStyle = "#000"; hc.beginPath();
    hc.ellipse(rr7() * 512, 40 + rr7() * 130, 3 + rr7() * 9, 4 + rr7() * 12, rr7() * 3, 0, 7);
    hc.fill(); hc.fillStyle = "#fff";
  }
  const hemTex = new THREE.CanvasTexture(hcv);
  hemTex.wrapS = THREE.RepeatWrapping; hemTex.repeat.set(3, 1);
  /* 前掛けの裾も裂く。ただし**外套と同じ抜きは使えない**。
     hemTex は丈 1m の外套用で、裂けが 30%・ほつれ糸が 24% の長さまで伸びる。
     丈 0.9m の前掛けに同じ比率で掛けると、下半分が消えて雑巾になる（実際なった）。
     前掛けの裾は「使い込んで縁がほつれた」程度なので、専用に浅いものを描く。 */
  /* 【草のスカートになっていた】前の版は 33 点のランダムな折れ線を 22px 振らせ、
     さらに 34 本のほつれ糸を垂らしたものを**横に2回繰り返して**いた。裾に 66 個の
     山と 68 本の糸が並ぶので、どの角度から見ても細かい三角形が一列に並ぶ
     ――布のほつれではなく蓑（みの）に見えていた。
     決定稿の裾は**ほぼ真っ直ぐに断ち切った縁**で、そこに深い裂けが2〜3本入っている。
     布らしさを作っているのは山の数ではなく、この「大きな裂けが数本」のほうなので、
     縁の揺れは 6px（≒2cm）まで落とし、裂けを 3 本だけ深く入れる。
     繰り返しも 2 → 1 にする（2 のままだと裂けが 6 本に増えて元の木阿弥）。 */
  const ahv = document.createElement("canvas");
  ahv.width = 512; ahv.height = 256;
  {
    const ah = ahv.getContext("2d");
    ah.fillStyle = "#000"; ah.fillRect(0, 0, 512, 256);
    ah.fillStyle = "#fff";
    ah.beginPath(); ah.moveTo(0, 0); ah.lineTo(512, 0);
    /* 端（k=0 と k=32）の高さを揃えないと、繰り返しの継ぎ目に段差が出る。 */
    const ae = [];
    for (let k = 0; k <= 32; k++) ae.push(k === 0 || k === 32 ? 240 : 236 + rr7() * 6);
    for (let k = 32; k >= 0; k--) ah.lineTo(k * 16, ae[k]);
    ah.closePath(); ah.fill();
    /* 深い裂け。幅は布の 2〜3%、深さは丈の 10% ほど（≒10cm）。位置は等間隔にしない。 */
    ah.fillStyle = "#000";
    for (const [sx, sw, sd] of [[142, 11, 214], [268, 8, 198], [396, 13, 220]]) {
      ah.beginPath();
      ah.moveTo(sx - sw / 2, 256); ah.lineTo(sx + sw / 2, 256);
      ah.lineTo(sx + sw * 0.18, sd); ah.lineTo(sx - sw * 0.22, sd + 6);
      ah.closePath(); ah.fill();
    }
    ah.fillStyle = "#fff";
    for (let k = 0; k < 9; k++) {                // 裾から垂れるほつれ糸（数本だけ・短く）
      const tx = rr7() * 512, base = ae[Math.min(32, Math.round(tx / 16))];
      ah.fillRect(tx, base - 3, 1.2 + rr7() * 1.8, 2 + rr7() * 5);
    }
    for (let k = 0; k < 5; k++) {                // 布に開いた小さな穴
      ah.fillStyle = "#000"; ah.beginPath();
      ah.ellipse(rr7() * 512, 70 + rr7() * 130, 2 + rr7() * 5, 3 + rr7() * 7, rr7() * 3, 0, 7);
      ah.fill(); ah.fillStyle = "#fff";
    }
  }
  const apronHemTex = new THREE.CanvasTexture(ahv);
  apronHemTex.wrapS = THREE.RepeatWrapping; apronHemTex.repeat.set(1, 1);
  canvasM.alphaMap = apronHemTex; canvasM.alphaTest = 0.5;
  /* 円弧は u が弧の全長（約2.1m）、v が丈（約1m）なので、同じ繰り返し数を掛けると
     織り目が 3:1 に伸びて縦縞に見える。u 側だけ倍率を上げて目を正方形に戻す。 */
  const hemMat = (color, rough) => new THREE.MeshStandardMaterial({
    ...loadPBRSet("fabric049", 40, 18), color, roughness: 1.0, metalness: 0,
    envMapIntensity: 0.10, normalScale: new THREE.Vector2(0.38, 0.38),
    alphaMap: hemTex, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  /* 【真っ黒にしない】外套を漆黒にすると、暗い部屋では顔の紙と手以外が完全に闇へ溶けて、
     巨体も得物も見えなくなる。ホラーの絵としては強いが、**得物を振り上げる予備動作が
     読めない**＝理不尽な死になる。輪郭がかろうじて拾える程度まで明度を上げる。 */
  const coatOut = hemMat(0x3e4436, 0.96);    // 外套の表
  const coatIn  = hemMat(0x1a1e14, 0.98);    // 外套の裏地
  /* 頭巾の裏当て。外套と同じ最暗色にしないと、板の隙間から覗いたときに
     そこだけ明るい「禿頭」として読めてしまう。頭皮も同じ暗さに合わせる。 */
  const hoodM  = new THREE.MeshStandardMaterial({ ...loadPBRSet("fabric049", 13, 13), color: 0x22261a,
                                                  roughness: 1.0, metalness: 0, envMapIntensity: 0.10,
                                                  normalScale: new THREE.Vector2(0.28, 0.28) });
  /* 「紐が太すぎ、かつ不自然な黄色で悪目立ちしている」（agy）。
     暗い部屋で光ってよいのは顔の紙だけなので、麻ひもは沈んだ茶へ落とす。 */
  const cordM  = new THREE.MeshStandardMaterial({ color: 0x6b5e46, roughness: 0.95 });                // 麻ひも
  const woodM  = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.88 });                // 木札・印鑑の柄
  /* 【関節が「くっつけた球」に見える理由】決定稿のマネキンは、関節ごとに**合わせ目の線**が
     一本入っている。これがあるから、同じ球でも「継いだ関節」として読める。
     線が無いまま球だけを出すと、ただ玉が刺さっているようにしか見えない
     （agy が「球体と筒をくっつけただけのおもちゃのロボット」と5回続けて指摘）。
     体よりわずかに明るい細い輪を、関節ごとに骨の向きへ直交させて置く。 */
  const seamM  = new THREE.MeshStandardMaterial({ color: 0x4c4c56, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.55 });

  /* === 体を「組み合わせたプリミティブ」から「1枚の皮膚」へ ===
     この怪人の造形がいつまでも人形に見える最大の理由は、**関節が球、腕が円柱のまま
     互いに突き刺さっている**こと。輪郭に硬い交差線が出るので、材質をどう作り込んでも
     「部品を組んだ物」に見える。スカルプトは使えないが、
     ・体の芯を capsule の距離場（SDF）として定義し、
     ・その合成を smooth-min（滑らかな和）で取り、
     ・各パーツの頂点をその等値面まで寄せる
     という手順なら、**継ぎ目に肉が付いて1枚の連続面になる**。
     頂点を動かすだけなので三角形は増えず、部品の配置コードもそのまま使える。

     距離場は z を 0.78 で割った空間で測る。胴も肩も奥行きが幅の 0.7〜0.8 なので、
     真円のカプセルを潰した空間で評価すれば、扁平な体をそのまま表せる。 */
  /* 距離場の芯を**前傾した背骨**に張り替える（決定稿 concept4 に合わせた作り直し）。
     骨盤 z=0.02 から肩 z=0.26 まで、上へ行くほど前へ送る。この4本を smooth-min で
     合成した等値面へ胴の部品を寄せると、腰から肩までが1本の曲がった塊に溶ける。
     **腕と脚の球はもう溶かさない**。決定稿は肩・肘・膝の関節球が露出したマネキンで、
     継ぎ目を消すことがそのまま絵柄を壊すため。 */
  const BONE_ZS = 0.90;
  /* 【x も潰す】距離場は x-y 平面では真円なので、weld を掛けた胴はどう置いても
     「幅＝奥行き」の丸太になる。決定稿の胴は肩甲骨のヨークで幅 0.45・奥行き 0.32 と
     **明らかに横へ広い**（正面図で胴が肩幅いっぱいに張り、側面図では薄い）。
     x を 1.44 で割った空間で測れば、同じ1本の芯のまま扁平な胴になる。
     【1.28 では足りなかった】ヨークの半幅が 0.225 にしかならず、
     肩の球（x±0.315・半径 0.082、内側の縁が 0.233）と 8mm しか重ならないので、
     遠近のついた正面図では胴と肩のあいだに隙間が開き、球が宙に浮いて見えた。
     参照のヨークは半幅 0.265 で、肩の球へ 2cm 食い込んでいる。 */
  const BONE_XS = 1.34;
  /** [ax, ay, az, bx, by, bz, r] — x を BONE_XS、z を BONE_ZS で割った空間での値
   *  （＝世界座標の z をここに書くときは BONE_ZS で割ってから書く）。
   *  【肩は胴の芯に入れない】決定稿の肩関節は胴の前端ではなく**弓なりの背の後ろ側**、
   *  ほぼ骨盤の真上に付いている（側面図で三角筋の輪が背の峰より 0.2m 後ろにある）。
   *  肩を距離場に入れると胴が横へ膨らんで、そこが「胸」に見えてしまうので入れない。 */
  const BONES = [
    /* 【尻が全身のいちばん後ろ】参照では高さ 0.40 の帯の後端が奥行き 0.000――
       つまり**臀部が全身でもっとも後ろに出ている点**。こちらは 0.034 で、
       尻が引けていたぶん、その下の 0.5〜0.7 の帯も丸ごと前へずれていた。
       骨盤の骨を後ろ下へ伸ばして、尻の塊を作る。 */
    /* 【背骨は円弧】下の spine() が返す弧の上に骨を並べる。z は BONE_ZS(0.90) で
       割った値なので、世界座標 0.020 → 0.022 のように書く。区間ごとに向きが
       少しずつ変わるので、繋ぎ目に折れ目が出ない。 */
    /* 【尻が出っ張って見えた】股関節を 1.088 → 1.132 へ上げたときに、この骨の
       終点を 1.088 のままにしていた。尻の塊が股関節より **15cm 下**に取り残され、
       腿の付け根の後ろに別の瘤としてぶら下がっていた（依頼主の指摘）。
       骨の終点を股関節（1.132）に合わせ、尻自体も 7cm 持ち上げて、
       腿がその塊から生えるようにする。 */
    /* 【まだ球として出っ張っていた】高さを合わせても、半径 0.150 の骨を骨盤の
       後ろ下に2本置いていたので、距離場の等値面がそこだけ膨らんで独立した球になる。
       絵で見ると胴の下に丸い塊があり、そこから腿が角度をつけて生えていた。
       骨を1本に減らし、半径も 0.118 まで落として骨盤に吸収させる。
       尻の丸みは「別の塊」ではなく**骨盤の後ろ下の張り**として出す。 */
    [0, 1.058, -0.014, 0, 1.132, 0.020, 0.100],  // 尻（骨盤の後ろ下の張り）
    /* 【骨が古い値のままだった】股関節を 1.088 → 1.132 へ動かしたのに、この4本を
       更新していなかった。距離場の芯が実際の背骨から最大 4cm ずれ、胴が意図より
       深く前へ倒れていた（agy「腰から真っ二つに折れ曲がって壊れたおもちゃに見える」）。
       基準点を動かしたら、それを参照している値を必ず洗い直すこと――同じ直し忘れを
       首・前掛け・尻・ここで 4 回繰り返している。
       あわせて弧を 124° → 106° に浅くし、胴が水平を越えて倒れないようにする。 */
    /* 【浅くしすぎた】106° に戻したのは誤りだった。agy が「腰から真っ二つに折れて
       壊れたおもちゃ」と言ったのは、**骨が古い値のままで意図より深く倒れていた**ことが
       原因で、弧の角度そのものは正しかった。骨を直した時点で角度も戻すべきだった。
       106° のままでは「腰がスッと伸びて直立に近い」と3方向すべてで減点される。118° に戻す。 */
    [0, 1.132, 0.022, 0, 1.303, 0.077, 0.164],   // 背骨 0°→32°（腰）
    [0, 1.303, 0.077, 0, 1.422, 0.224, 0.176],   // 背骨 32°→64°（中背）
    [0, 1.422, 0.224, 0, 1.454, 0.406, 0.180],   // 背骨 64°→94°（背の峰）
    [0, 1.454, 0.406, 0, 1.442, 0.480, 0.108],   // 背骨 94°→106°（肩甲骨のヨーク（首の手前で絞る））
    // ※ 首は距離場に含めない。細い管を胴と溶かすと、ヨークと首の境が消えて
    //    「胴から直接生えた首」になり、肩の塊が読めなくなる。
  ];
  /** 滑らかな最小値。k が大きいほど継ぎ目に肉が付く */
  const smin = (a, b, k) => {
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  function sdfBody(px, py, pz) {
    const x = px / BONE_XS, z = pz / BONE_ZS;
    let d = 1e9;
    for (const [ax, ay, az, bx, by, bz, br] of BONES) {
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const apx = x - ax, apy = py - ay, apz = z - az;
      const ll = abx * abx + aby * aby + abz * abz;
      const t = ll < 1e-9 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ll));
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      /* k はここでは 0.055 まで絞る。決定稿の体は**継ぎ目のあるマネキン**で、
         塊どうしの境目が線として見えているのが絵柄そのもの。0.085 まで開くと
         胴が1個のツルリとした甲虫になり、腰も胸も無い塊になった。 */
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - br, 0.055);
    }
    return d;
  }
  /** 頂点を SDF の表面（f=0）へ寄せる。ニュートン法を数回まわすだけで十分収束する。 */
  /* 【背中一面が割れた三角形で覆われていた】weld は部品を1つずつ距離場の等値面へ
     寄せる。骨盤・背骨の各節・背の峰は互いに重なっているので、重なった範囲では
     **2枚以上の殻がまったく同じ面の上に載る**。同一平面の面どうしは深度の比較が
     揺れるので、z ファイティングで黒い破片が散る（真横から見ると背中全面に出ていた）。

     殻を1枚に作り直すのが本筋だが、部品を積む今の作り方では、寄せる先を部品ごとに
     ほんの少しずつ内側へずらすだけで足りる。先に置いた部品が表、あとの部品は
     その内側に隠れる。露出するのはどこでも必ず1枚だけになる。
     ずらし幅は**三角形の弦のたるみより大きく**なければ効かない。半径 0.2 の球を
     28 分割すると、平らな三角形は滑らかな面から最大 1.3mm 内側へ落ち込む。
     0.7mm しかずらさなかった一度目は、この弦のたるみに埋もれて何も直らなかった。

     一方、全部の部品に別々の深さを与えると、いちばん深い部品が 1cm の窪みになる。
     重なるのは**隣り合う部品どうしだけ**なので、3色で塗り分ければ足りる
     （骨盤・尻・背骨4節・背の峰の並び順で 0 → 2.5 → 5.0mm を繰り返す）。
     こうすると同じ深さの部品どうしは決して重ならず、窪みも頭打ちになる。
     ※ 3色では背の峰と背骨の1節がまだ同じ深さで当たっていた。4色に増やすと消えた。 */
  let weldSeq = 0;
  function weldToBody(geo) {
    const pos = geo.attributes.position, e = 0.004;
    const bias = -0.0032 * (weldSeq++ % 4);   // 隣り合う部品が同じ深さにならないように
    /* 【三角形が折り返って黒い破片になっていた】smin で繋いだ距離場は真の距離では
       なく、繋ぎ目の付近では勾配の長さが 1 を大きく下回る。そこへ「d だけ進む」
       ニュートン法を素で当てると**面を突き抜けて反対側へ飛ぶ**。飛んだ頂点は
       隣の頂点と順序が入れ替わるので、三角形が裏返り、法線が反転して黒く出る。
       ・1歩を 0.8 に減衰させ、1回の移動量を 2cm で頭打ちにする（飛び越さない）
       ・そのぶん反復を 5 → 14 に増やして、離れた頂点も届くようにする */
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      for (let k = 0; k < 14; k++) {
        const d = sdfBody(x, y, z) - bias;
        if (Math.abs(d) < 0.0008) break;
        const gx = sdfBody(x + e, y, z) - sdfBody(x - e, y, z);
        const gy = sdfBody(x, y + e, z) - sdfBody(x, y - e, z);
        const gz = sdfBody(x, y, z + e) - sdfBody(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz);
        if (gl < 1e-9) break;
        const t = Math.max(-0.020, Math.min(0.020, d * 0.8));
        x -= t * gx / gl; y -= t * gy / gl; z -= t * gz / gl;
      }
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
  }

  /* --- 部品を材質ごとに溜める --- */
  const bucket = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
        _p = new THREE.Vector3(), _s = new THREE.Vector3();
  /** geo を o={x,y,z,rx,ry,rz,sx,sy,sz,uv,pre} で配置して材質バケツへ入れる。
   *  uv は UV の倍率（部品の大きさに応じて織り目の密度を揃えるため）。
   *  pre は親の行列（マチェーテのようにグループごと傾ける部品で使う）。 */
  function put(geo, mat, o = {}) {
    // mergeGeometries は属性の顔ぶれが完全に一致していないと通らない。
    // インデックスの有無も混在させられない（ExtrudeGeometry は非インデックス、
    // BoxGeometry はインデックス付き）ので、非インデックスに揃えてから足す。
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) geo.deleteAttribute(name);
    if (o.uv && geo.attributes.uv) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uv, uv.getY(i) * o.uv);
    }
    /* 径方向のうねり。円柱にも球にも効かせたいのでここに置く。
       完全な回転体は、どんなに材質を作り込んでも「ろくろで挽いた硬い物」に見える。 */
    if (o.wave) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const th = Math.atan2(x, z);
        const d = 1 + o.wave.amp * (Math.sin(o.wave.folds * th + 0.9) * 0.6
                                  + Math.sin(o.wave.folds * 1.7 * th + 2.4) * 0.4);
        pos.setX(i, x * d); pos.setZ(i, z * d);
      }
      geo.computeVertexNormals();
    }
    /* 【素のプリミティブに見えるのをやめる】円柱は円柱、球は球のままだと、
       材質をどれだけ作り込んでも「木製のデッサン人形」から出られない。スカルプトは
       使えないが、**法線方向へ低周波のノイズで頂点を押し引きする**ことはできる。
       同じ三角形数のまま輪郭が揺らぎ、肉のたるみや布の凹凸として読めるようになる。 */
    if (o.noise) {
      const pos = geo.attributes.position, nrm = geo.attributes.normal;
      const A = o.noise.amp, F = o.noise.freq;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const n = Math.sin(x * F + 1.3) * Math.sin(y * F * 1.31 + 2.1) * Math.sin(z * F * 0.93 + 0.7)
                + 0.5 * Math.sin(x * F * 2.17 + 4.2) * Math.sin(y * F * 2.03 + 1.1) * Math.sin(z * F * 1.87 + 3.3);
        pos.setXYZ(i, x + nrm.getX(i) * n * A, y + nrm.getY(i) * n * A, z + nrm.getZ(i) * n * A);
      }
      geo.computeVertexNormals();
    }
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    // order は回転の適用順。既定の XYZ は「rz→ry→rx」の順に効く。コートのパネルのように
    // 「先に向きを決めて（ry）、そのうえで自分の軸で傾ける（rx）」ものは YXZ を使う。
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || "XYZ"));
    _s.set(o.sx == null ? 1 : o.sx, o.sy == null ? 1 : o.sy, o.sz == null ? 1 : o.sz);
    _m.compose(_p, _q, _s);
    if (o.pre) _m.premultiply(o.pre);
    geo.applyMatrix4(_m);
    // 体のパーツは、ここで距離場の表面へ寄せて1枚の皮膚に融かす
    if (o.weld) weldToBody(geo);
    /* 【汚しを頂点カラーに焼く】テクスチャを増やさずに情報量を足せる唯一の手。
       ・足元ほど暗い（泥と埃は下から上がる）
       ・下を向いた面ほど暗い（環境光が回り込まない＝簡易AO）
       これが無いと、どの面も同じ明るさで返ってきて「のっぺりした樹脂」に見える。
       ワールド座標で見たいので、必ず行列を掛けたあとに計算すること。 */
    /* 呼び出し側が先に頂点カラーを焼いてある場合は、それを尊重して上書きしない。
       大鉈の研ぎ面はこの経路で入れている（刃**局所**の x が要るので、
       行列を掛けたあとのここでは計算できない）。 */
    if (!geo.getAttribute("color")) {
      const pos = geo.attributes.position, nrm = geo.attributes.normal;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        /* 【弱すぎた】0.74〜1.00 の 26% 幅では、暗い部屋で面の向きの差が出ない。
           法線マップを入れて面の質が出た今、頂点カラーの段差も釣り合う強さに上げる。
           3つの成分を掛け合わせる:
             low  足元ほど暗い（泥と埃は下から上がる）
             face 下を向いた面ほど暗い（環境光が回り込まない＝簡易AO）
             cav  部品の継ぎ目に溜まる汚れ。法線が水平に近い帯だけを落とすと、
                  関節や胴の切り替わりに影の線が入り、塊の境が読めるようになる */
        const y = pos.getY(i);
        if (o.soil) {
          /* 布の汚れ。厚手の帆布は、面が均一だと新品のシーツに見える。
             泥と油は**下から上がって上へ薄くなる**うえ、染みは不規則な斑で入る。
             低周波の斑と、裾に向かう暗さを掛け合わせる。 */
          const x = pos.getX(i), z = pos.getZ(i);
          const n = Math.sin(x * 11 + 0.4) * Math.sin(y * 9 + 1.9) * Math.sin(z * 13 + 3.3)
                  + 0.5 * Math.sin(x * 27 - 1.2) * Math.sin(y * 23 + 0.8);
          /* 【裾がガス状の靄に化けた】この式は「y=0.40 より下は一律 0.68 倍」で、
             丈 0.80（裾 y=0.490）の前掛けに合わせて書いてあった。丈を 0.945 に
             伸ばして裾が y=0.345 まで下りたとたん、下から 15cm ぶんが最も暗い
             0.68 で塗り潰され、暗い拡散色に環境光の青が勝って**灰青の靄**になった。
             世界座標のしきい値をベタ書きすると、丈を変えるたびにこうなる。
             前掛けの実寸（裾 0.345 / 上端 1.290）に合わせ、落差も浅くする。 */
          const hem = 0.82 + 0.18 * Math.min(1, Math.max(0, (y - 0.345) / 0.700));
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = hem * (0.80 + 0.20 * (0.5 + 0.5 * n));
          continue;
        }
        if (o.rust) {
          /* 【刃が新品に見える】刃は面が広くて平らなので、法線マップで凹凸を足しても
             「均一に塗った板」から出られない（agy「汚れが一つもない新品のよう」）。
             錆は**面の上を斑に食う**もので、明暗の分布そのものが情報になる。
             周期の違う3方向の正弦を掛けると、繰り返しの見えない低周波の斑ができる。
             さらに刃先（下）ほど研がれて地金が出るので、明るい側へ寄せる。 */
          const x = pos.getX(i), z = pos.getZ(i);
          const n1 = Math.sin(x * 23 + 0.7) * Math.sin(y * 19 + 2.3) * Math.sin(z * 27 + 1.1);
          const n2 = Math.sin(x * 61 + 3.1) * Math.sin(y * 53 + 0.4) * Math.sin(z * 67 + 5.2);
          /* ※ 明るさの帯を上げすぎると、刃が体から浮いた薄桃色の板になる。
             元の汚し（足元の暗さ）が刃に与えていた 0.47 前後を中心に、
             その上下へ振るだけにする。錆に必要なのは明度ではなく**むら**。 */
          /* マップが模様を受け持つので、頂点側は明度を少し散らすだけに留める。
             ここで大きく振ると、頂点の少ない押し出し面では三角形の縞になる。 */
          const mottle = 0.56 + 0.16 * (0.5 + 0.5 * (n1 * 0.72 + n2 * 0.28));
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = mottle;
          continue;
        }
        const low  = 0.52 + 0.48 * Math.min(1, Math.max(0, y / 1.34));
        const face = 0.70 + 0.30 * Math.max(0, nrm.getY(i));
        const cav  = 0.86 + 0.14 * Math.min(1, Math.abs(nrm.getY(i)) * 2.2);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = low * face * cav;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    if (!bucket.has(mat)) bucket.set(mat, []);
    bucket.get(mat).push(flat);
  }
  /* RoundedBoxGeometry の segments は 1 で足りる（1面 3×3＝108三角）。2 にすると
     1個 300三角になり、外套のパネルだけで 2万5千三角を食う。角が丸いことが分かれば
     目的は果たしているので、ここは最小で置く。 */
  const rbox = (w, h, d, r, mat, o)         => put(new RoundedBoxGeometry(w, h, d, 1, r), mat, o);
  const cyl  = (rt, rb, h, mat, o, seg = 20, open = false) => put(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat, o);
  const cap  = (r, len, mat, o, seg = 18)   => put(new THREE.CapsuleGeometry(r, len, 6, seg), mat, o);
  const sph  = (r, mat, o, w = 22, h = 14)  => put(new THREE.SphereGeometry(r, w, h), mat, o);
  const tor  = (r, tube, mat, o, seg = 24)  => put(new THREE.TorusGeometry(r, tube, 8, seg), mat, o);
  // 前を開けたコート・後ろだけのフードのように、**筒や球の一部**が要る場面のためのヘルパ。
  const arc  = (rt, rb, h, mat, o, t0, tlen, seg = 22) => put(new THREE.CylinderGeometry(rt, rb, h, seg, 1, true, t0, tlen), mat, o);
  /** 関節の合わせ目の線。p を中心に、from→to の向きへ直交する薄い輪を置く。
   *  半径は関節球より少し大きく取り、球の赤道に線として乗せる。 */
  const seam = (p, from, to, r) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    /* 幅 12mm では継ぎ目ではなく腕輪に見える。7mm まで詰めると線として読む。 */
    const l = Math.hypot(dx, dy, dz) || 1, h = 0.0035;
    const b = bone3({ x: p.x - (dx / l) * h, y: p.y - (dy / l) * h, z: p.z - (dz / l) * h },
                    { x: p.x + (dx / l) * h, y: p.y + (dy / l) * h, z: p.z + (dz / l) * h });
    cyl(r, r, b.len, seamM, { ...b }, 22);
  };
  /** ひだ（ドレープ）のある円弧。
   *  【なぜ要るか】外套を連続した面にした結果、今度は**完全な円柱**になり、
   *  「布を着た体」ではなく「硬いドラム缶」に見えるようになった。布が布に見えるのは、
   *  重力で寄った縦の大きなシワがあるからで、これは小物をいくら足しても代用できない。
   *  円柱の頂点を角度の関数で径方向へ動かすだけなので、**三角形は1枚も増えない**
   *  （分割数だけ上げる）。周期の違う2つの波を足して、規則正しい波打ちを避ける。 */
  function drapeArc(rt, rb, h, mat, o, t0, tlen, folds = 7, amp = 0.13, cinch = null, seg = 64, hseg = 12) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg, hseg, true, t0, tlen);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const th = Math.atan2(x, z);
      const t = (y + h / 2) / h;                       // 0 = 裾, 1 = 肩
      let k = amp * (1 - t * 0.70);                    // 裾ほどひだが深く開く
      let w = 1;
      /* ベルトで縛られたくびれ。cinch = { y: 局所高さ, amt: 絞る割合, w: 効く幅 }。
         これが無いと、腰に輪を通しただけの「縦溝の入った土管」に見える。
         くびれの位置ではシワの深さも一度潰して、布が帯に吸い込まれるようにする。 */
      if (cinch) {
        const g = Math.exp(-(((y - cinch.y) / cinch.w) ** 2));
        w = 1 - cinch.amt * g;
        k *= 1 - 0.80 * g;
      }
      const d = w * (1 + k * (Math.sin(folds * th + 0.7) * 0.62 + Math.sin(folds * 1.73 * th + 2.1) * 0.38));
      pos.setXYZ(i, x * d, y, z * d);
    }
    geo.computeVertexNormals();
    put(geo, mat, o);
  }
  const dome = (r, mat, o, p0, plen, tlen = Math.PI * 0.62, seg = 22) => put(new THREE.SphereGeometry(r, seg, 14, p0, plen, 0, tlen), mat, o);
  /** 首から吊った前掛け。上が狭く下が広い台形の面を、前へゆるく反らせて垂らす。
   *  円筒を切った drapeArc では作れない――あれは体に巻き付く面なので、
   *  決定稿の「前傾した体から離れて、鉛直にぶら下がっている」布にならない。
   *  bow は中央がどれだけ前へ張り出すか、amp は縦ジワの深さ。 */
  /** 首から吊った前掛け（胸当て → 腰 → 裾）。
   *
   *  【なぜ幅を3点で指定するか】前の版は上端と下端の2点を直線で結ぶだけだったので、
   *  幅がほぼ一定の短冊にしかならなかった。決定稿の前掛けは
   *  「胸当てで狭く（0.30）→ 腰紐で一度締まり（0.33）→ 裾で開く（0.48）」という
   *  3段の輪郭を持っていて、この**腰のくびれ**があるかどうかが、
   *  布に見えるか板に見えるかの分かれ目になる。
   *
   *  wChest 胸当ての幅 / wWaist 腰紐の位置での幅 / wHem 裾の幅
   *  tWaist 腰紐の高さ（0=裾, 1=胸当ての上端）
   *  bow    正面へどれだけ張り出すか（裾ほど大きく効かせて布の量を出す）
   *  folds  縦ジワの本数 / amp その深さ
   */
  /** 首から吊った前掛け。
   *
   *  【板に見えていた理由】前の版は面を鉛直に垂らして、中央を前へ膨らませるだけだった。
   *  布が板に見えるかどうかを決めるのは厚みではなく**輪郭が体と連動しているか**で、
   *  真っ直ぐ落ちる面はどれだけ膨らませてもダンボールに見える（agy が3回続けて指摘）。
   *  実際の前掛けは (1) 胸で体に触れ、(2) そこから離れて鉛直に落ち、
   *  (3) 裾が腿に当たって後ろへ振れる、という3段の軌跡を描く。
   *  その軌跡を sway（裾がどれだけ後ろへ振れるか）として面の中心線に持たせる。
   *
   *  さらに、垂れ布のシワは**上から下へ広がる扇**になる。上端は縫い付けられて
   *  動けないので浅く、裾へ向かって深くなる。等間隔の縦縞ではこれが出ない。
   *
   *  wChest 胸当ての幅 / wWaist 腰紐の位置での幅 / wHem 裾の幅
   *  bow    正面へどれだけ張り出すか / sway 裾がどれだけ後ろへ振れるか
   */
  function apronSheet(wChest, wWaist, wHem, h, bow, sway, mat, o, tWaist = 0.56, folds = 4, amp = 0.014) {
    const geo = new THREE.PlaneGeometry(1, h, 34, 30);
    const pos = geo.attributes.position;
    /* 【正弦波である以上、何をしても「プリーツカーテン」から出られない】
       ヒダは v25 から通算で、振幅（0.046→0.032→0.022→0.010）・本数（5→3→4）・
       第2倍音の比・位相の v 依存、と手を変えて8回いじり、そのたびに
       「波板」「トタン」「規則正しく折られたカーテン」と言われ続けた。
       原因は値ではなく**周期関数を使っていること**そのもの。正弦の和は
       どれだけ重ねても山と谷が等間隔に並び、人工物の周期として読まれる。
       実際の布のヒダは、山の位置も深さも幅もばらばらで、周期を持たない。
       そこで山の位置・深さ・幅を**乱数で先に決めた FOLD 表**にして、
       u に対して滑らかに内挿する。周期が存在しないので、どれだけ深くしても
       「折板屋根」には見えない。乱数は rr7（固定シード）なので毎回同じ形になる。 */
    const FOLD = [];
    for (let k = 0; k < 9; k++) {
      FOLD.push({ u: -0.5 + (k + 0.10 + rr7() * 0.80) / 9,   // 山の位置（等間隔にしない）
                  d: 0.35 + rr7() * 0.95,                     // 深さ
                  w: 0.030 + rr7() * 0.055,                   // 山の幅
                  s: rr7() < 0.5 ? -1 : 1,                    // 山か谷か
                  t: 0.25 + rr7() * 0.55 });                  // どの高さで最も深くなるか
    }
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), y = pos.getY(i);
      const v = (y + h / 2) / h;                        // 0 = 裾, 1 = 胸当ての上端
      // 腰を境に2区間で補間する（裾→腰→胸）
      const w = v < tWaist
        ? wHem + (wWaist - wHem) * (v / tWaist)
        : wWaist + (wChest - wWaist) * ((v - tWaist) / (1 - tWaist));
      /* 中央ほど前へ張り出させて布の厚みを出す。裾でいちばん膨らみ、
         胸当てでは体に貼り付くので効きを 0.25 まで落とす。 */
      /* 縁も v の滑らかな関数のままだと直線に見える。丈の途中で幅を揺らして、
         横の輪郭にたわみを出す。 */
      /* 【縁が直線に近く、布ではなく折り板に見えた】振幅 3%＋1.8% では、丈 1m の
         布の横輪郭が定規で引いた線とほとんど区別できない。襞の深さ（amp 0.022）は
         15章と17章で計6回振って全部戻っているので、もう触らない。
         布らしさを作っているのは**縁の乱れ**のほう（HANDOFF 17章）。ここを倍にする。 */
      const wob = 1 + 0.055 * Math.sin(v * 13.7 + 0.9) + 0.030 * Math.sin(v * 27.1 - 1.7);
      const q = Math.max(0, 1 - 4 * u * u);
      const swell = bow * q * (0.25 + 0.95 * (1 - v) * (1 - v));
      // 裾が腿に当たって後ろへ振れる。上端では効かせない（胸に留まっているので）
      /* 【折り紙のように2面で折れていた】後退量を (1-v)² で入れると、曲率が
         腰の一点に集中して、胸から一直線・裾へ一直線の「くの字」になる。
         smoothstep（t²(3-2t)）にすると両端で傾きがゼロになり、
         胸・腰・裾に曲率が分散して、布が連続して曲がって見える。 */
      /* 【全部の列が同じ形で落ちていた】後退量が v だけの関数だったので、
         どの縦列もまったく同じ軌跡を描き、裾が定規で引いた滑らかな弧になる。
         これが「段ボールを折り曲げた板」の正体。実際の布は、列ごとに
         たわみの深さが違うから裾が波打つ。u に依存する揺らぎを掛ける。 */
      const t = 1 - v;
      /* ※ ±0.35 も振ると、列ごとの落差が大きすぎて縦の襞が一本ずつ独立し、
         「厚い板を並べたプリーツカーテン」になった。揺らぎは輪郭をわずかに崩す程度でよい。 */
      /* 列ごとのたわみの深さの差。ここが小さいと裾が定規で引いた弧になる。
         ※ ±0.35 まで振ると襞が一本ずつ独立して「プリーツカーテン」になる（実測）。
         ±0.14 は、裾が波打つが襞は繋がったままの値。 */
      const lane = 1 + 0.14 * Math.sin(u * 17.3 + 1.1) + 0.07 * Math.sin(u * 41.7 - 2.4);
      const drift = sway * t * t * (3 - 2 * t) * lane;
      /* シワは裾へ向かって深くなる扇。位相を v で少しずらすと、
         1本のシワが上から下へ流れて見える。 */
      const cinch = Math.exp(-(((v - tWaist) / 0.10) ** 2));
      /* 【等間隔の深い溝は波板トタンになる】1本の正弦だけだと、山と谷が同じ幅・
         同じ深さで並ぶ。人工物の周期は目に付きやすく、布ではなく折板屋根に見える。
         周期が整数比にならない2本目を足すと、山ごとに幅と深さが変わって、
         同じ振幅でも「畳まれた布」として読めるようになる。 */
      /* 【ヒダが鉛直に走る「波板」だった】位相の v 依存が 0.9rad しかなく、丈 1m の
         あいだにヒダが 1/7 周期しかずれない。つまりどのヒダも上から下まで同じ u に
         留まり、平行な縦の稜線が数本立つ――これが「硬い波板／カーテン」の正体で、
         振幅（amp）をいくら下げても消えなかった（15章・17章で計6回振って全部戻した）。
         実際の布のヒダは、腰で寄せられて裾へ向かって**斜めに開いていく**。
         位相の v 依存を 3 倍にすると、ヒダが下るにつれて横へ流れ、途中で合流・分岐する。
         さらに周期の長い第3項を足して、大きなドレープを2つ作る。 */
      /* 山ごとに「どの高さでいちばん深くなるか」を変える。こうすると1本のヒダが
         途中で消えて別のヒダが立ち上がり、上から下まで通る稜線が無くなる。
         横方向のずれ（u + 0.10*(1-v)*...）は、裾へ向かってヒダが開く動き。 */
      let wrink = 0;
      for (const f of FOLD) {
        const du = (u - f.u - 0.11 * (1 - v) * (f.u * 2)) / f.w;
        const depth = Math.exp(-(((v - f.t) / 0.42) ** 2));    // 高さ方向の効き
        wrink += f.s * f.d * depth * du * Math.exp(-du * du);  // 山と谷が対になる形
      }
      wrink *= amp * 1.9 * (0.35 + 1.05 * (1 - v)) * (1 - 0.75 * cinch);
      // 縁は内側（体側）へ巻き込む。切りっぱなしの縁は板の断面に見える
      /* 巻き込みが強いと縁が内側へ折れ込みすぎて面が交差し、布の途中に
         穴が空いたように見える。効き始めを外側へ寄せ、係数も半分に落とす。 */
      /* 【1枚の平面に見える】縁の巻き込みが弱く、布が体の丸みに沿っていなかった。
         横から見ると厚みも回り込みも無い板になる。効き始めを内側へ寄せ、
         係数を上げて、左右の縁が体へ回り込むようにする。 */
      const curl = -Math.max(0, Math.abs(u) - 0.26) * 2.4 * bow;
      /* 【上端が「ひさし」として胸から突き出ていた】胸当ての上辺は切りっぱなしの
         直線で、しかも面が鉛直なので、斜めから見ると硬い板の小口が水平に光る。
         実際の前掛けは上端を三つ折りにして縫ってあるので、縁は体側へ丸く巻き込む。
         いちばん上の 1 割だけ後ろへ引くと、縁が消えて折り返しとして読める。 */
      const tuck = -0.030 * Math.max(0, v - 0.90) / 0.10;
      pos.setXYZ(i, u * w * wob, y, swell + wrink + drift + curl + tuck);
    }
    geo.computeVertexNormals();
    put(geo, mat, o);
  }
  const plate= (w, h, mat, o)                          => put(new THREE.PlaneGeometry(w, h, 1, 1), mat, o);
  /** 破れた布片。1枚ポリゴン（2三角）で、輪郭はアルファで抜く。
   *  q は 4 種類の裂け方のどれを使うか。skew は下辺を横へずらす量（台形にして歪みを出す）。 */
  function ragPanel(w, h, mat, o, q = (rr7() * 4) | 0, skew = 0) {
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) + skew);      // 下辺だけずらす＝台形
      uv.setXY(i, (uv.getX(i) + (q % 2)) / 2, (uv.getY(i) + (1 - ((q / 2) | 0))) / 2);
    }
    put(geo, mat, o);
  }

  /* === 骨格の寸法（全高 ≈ 2.10m）===
     足首 0.12 / 膝 0.47 / 股 0.90 / ベルト 1.06 / 胸 1.42 / 肩 1.60 / 襟 1.72 / 頭 1.90
     肩幅 0.61・胸幅 0.57・胴の奥行 0.39。**幅より縦に伸ばす**のがこの怪人の要点で、
     v25 の初稿は胸・腹・背を別々の球で積んだせいで肩幅 0.99m の団子になり、
     怖い大男ではなく丸いマスコットになっていた。 */

  /* ================= 決定稿（concept4）に合わせた作り直し =================
     参照: C:/tmp/mobref/concept4.png と、そこから起こした三面図。
     **頭巾・ケープ・外套・ボロ布の短冊・ベルト・ブーツの金具は全部消した。**
     決定稿はそれらを1つも持っていない。構成要素は次の5つだけ:
       (1) 深く前傾した、継ぎ目のあるマネキンのような黒い体
       (2) 頭に縛り付けた通知書（暗闇で白いのはここだけ）
       (3) 首から吊った、体から離れて垂れるカーキの前掛け
       (4) 前掛けの腰に紐で縛り付けた書類の束2つ
       (5) 引きずった錆びた大鉈
     絵の強さは装飾ではなく**姿勢**から出ている。ボーンが無いので姿勢は作り付けになる。
     前傾は背骨を折って作る: 骨盤 z=0.02 → 中背 z=0.11 → 肩 z=0.26 → 頭 z=0.60。
     頭が骨盤より 58cm 前に出るので、真横から見ると「く」の字に折れて見える。 */

  /* 【猫背は関節の屈曲で作る（作り直し）】
     前の版は「背骨を波打たせて丸め、首を 34cm 伸ばして頭を前へ出す」やり方だった。
     これは決定稿の読み違いで、出来上がったのは首の長い甲虫だった。
     決定稿の骨格は次のとおり:
       ・手足が**長い**。腿・すね・上腕・前腕がどれも 40cm 級ある。
       ・猫背は**股関節で胴を前へ倒して**作る。背骨自体はほぼまっすぐ。
       ・肘と膝が**曲がっている**。この屈曲が「覗き込んでいる」印象を作る。
       ・首は**短い**。頭は倒れた胴の先端にそのまま乗っている。
     胴を股関節から 60 度倒すと、長さ 58cm の胴の先（肩）は
     y=1.45・z=0.53 に来る。頭はそこから首 10cm ぶん前へ出るだけでよい。 */

  /* 【胴は「倒れた棒」ではなく「弓なりの弧」】
     輪郭を高さで正規化して参照画と突き合わせた（tools/silhouette-diff.mjs）ところ、
     頭の高さ（上から 0.19〜0.31）で自分の背中の後端が参照より 0.13〜0.22 も前にあった。
     胴を股関節から一直線に倒すと、上へ行くほど質量が前へ逃げて**背中の峰が消える**。
     参照は、腰からいったん**ほぼ垂直に立ち上がって**峰を作り、そこから**ほぼ水平に**
     前へ倒れて肩と頭に至る。だから頭の高さでも背中側に質量が残る。
     首を伸ばさずに頭を前へ出せているのは、この弧のおかげ。 */
  /* 【肩は背の後ろ、頭は首の先】ここが今回いちばん大きな直し。
     参照画を拡大して測ると、三角筋の輪（肩関節）は**背の峰より 0.2m 後ろ**、
     ほぼ骨盤の真上にある。胴そのものはあまり前へ倒れておらず（股関節→峰で
     前へ 0.17m しか進まない）、頭が前に出ているのは**首が長く前へ突き出す**から。
     前の版は肩を胴の前端（z=0.49）に置いていたので、腕が頭のすぐ下から生え、
     四面図では「胸から短い前脚が出た甲虫」になっていた。
     高さ 1.65m での実測値（正面図・側面図を高さ 1.0 に正規化して換算）:
       股関節 y1.12/z0.03 ・ 背の峰 y1.46/z0.20 ・ 首の付け根 y1.45/z0.35
       頭 y1.43/z0.64 ・ 肩関節 x±0.315 y1.45/z0.055 */
  /* === 骨格の基準点 ===
     この5点だけで姿勢が決まる。部品はすべてこの点のあいだに置くので、
     姿勢を変えたいときは部品ではなくここを動かす。

       HIP   股関節。胴を前へ折る支点。骨盤の球と腿の付け根がここに集まる
       LUMB  腰椎のあたり。HIP からほぼ垂直に立ち上がった先で、ここから前へ折れる
       CREST 背の峰＝丸めた背中のてっぺん。**全身でいちばん高い点**
       YOKE  肩甲骨のヨークの前端。ここに肩の球が付き、ここから首が出る
       HEAD  頭の中心。顔の紙・麻縄・留め具はすべてこの点を基準に置く

     【猫背は首ではなく関節の屈曲で作る】頭が骨盤より 61cm 前に出ているのは、
     首を伸ばしたからではなく、**股関節で胴を折り、背を弓なりにした**結果。
     首は 12cm しかない。
     一度この構造を「胴はほぼ直立・首を 30cm 伸ばす」に置き換えた版を作ったが、
     輪郭の計測値はほとんど同じままで、見た目だけが鶴のような別の生き物になった。
     **シルエットの一致は「長い首＋直立」と「短い首＋深い屈曲」を区別しない**ので、
     ここは計測ではなく構造の決めごととして守る。 */
  /* 【猫背は「くの字」ではなく「Cの字」】前の版は腰から上をほぼ垂直に立ち上げ、
     背の峰で一気に前へ折っていた。区間ごとの角度差が大きいので、横から見ると
     腰の一点でポキッと折れた**深いお辞儀**にしかならない（依頼主・agy とも同じ指摘）。
     決定稿は腰から首まで曲率が一定で、背中全体がなだらかな C を描いている。

     そこで背骨を**円弧そのもの**として定義する。股関節を弧の始点、真上を始点の
     接線として、半径 0.323m の弧を 122 度まわす。区間をどれだけ細かく切っても
     隣どうしの角度差が一定なので、折れ目が原理的に出ない。
     頭は弧の終端（＝ヨーク）から短い首で前へ出るだけ。首を伸ばして頭を運ぶのでは
     なく、**弧が頭を運ぶ**。 */
  /* 【重心を下げる】股関節を 1.168 → 1.088 へ 8cm 落とす。参照は膝を深く曲げて
     腰を落とし、重い上半身を下半身で支えている。股関節が高いままだと、
     どれだけ背中を丸めても「棒立ちで上体だけ倒した人」にしかならない。
     弧はここを始点にしているので、この1点で上半身ごと沈む。 */
  const HIP  = { y: 1.132, z: 0.020 };            // 股関節＝弧の始点
  const SPR  = 0.323;                              // 背骨の弧の半径
  const SPC  = { y: HIP.y, z: HIP.z + SPR };       // 弧の中心（股関節の真前）
  /** 股関節から測った角度[度]で、背骨の弧の上の点を返す */
  const spine = (deg) => {
    const a = deg * Math.PI / 180;
    return { y: SPC.y + SPR * Math.sin(a), z: SPC.z - SPR * Math.cos(a) };
  };
  const CREST = spine(94);    // 背の峰（弧の頂点／全身でいちばん高い）
  /* 【頭が飛び出して見える理由】ヨーク(1.422,0.485)と頭(1.344,0.800)の中心間が 32cm
     あり、そのうち首として見えているのは 8.5cm。残りは「何も無い距離」なので、
     頭が体から切り離されて前へ飛んでいるように見える（agy）。
     首を伸ばして埋めるのではなく、**弧をもう 8 度回してヨークを前へ出す**。
     中心間が 26.6cm に縮み、首の露出は 2.6cm の短いものになる。 */
  const YOKE  = spine(106);   // 弧の終端＝肩甲骨のヨーク＝首の付け根
  /* 頭は肩より **下**にある。参照では頭の中心が肩より一段低く、
     覗き込むというより「頭が垂れている」。前の版は肩と同じ高さだった。 */
  /* 【首が見えるための条件】頭とヨークの**中心間距離が、両者の半径の和より
     首の見える長さぶん大きい**こと。これが満たされないと、どんなに細い筒を
     間に置いても両側の塊に飲まれて首は現れない。
     前の版は 距離 0.267 に対し 半径の和 0.267 ――ちょうどゼロで、
     「胸板の正面に直接お面がめり込んでいる」状態だった（agy が2回続けて指摘）。
     ヨーク端 0.100・頭 0.132 に絞り、頭を前下へ出して距離 0.343 を確保する。
     0.343 − 0.232 = 0.111 が、首として見える長さ。 */
  /* 【前へ出しすぎた】首を「見える」ようにするため頭を z=0.874 まで送ったら、
     今度は「背中から細いチューブ状の首が水平に突き出し、その先に頭がぶら下がる」
     異様な構造になった（agy）。首は見えればよく、突き出す必要はない。
     0.800 まで戻すと、ヨーク端(0.635)との距離 0.245 に対し半径の和 0.232 で、
     首として見えるのは 1.3cm ――「短いが在る」状態になる。 */
  /* 頭が肩(1.318)より低く、しかも肩のあいだに収まっていたため「頭部が胸に
     めり込んでいる」ように見えた（agy）。肩と同じ高さまで上げて前へ出す。 */
  /* 頭は肩の間に沈めない。ヨークを浅くしたぶん頭も上げ、お面が真下ではなく
     斜め前を向くようにする（agy「頭が埋没してお面が見えない」）。 */
  /* 【背中が「首の後ろに付いた風船」に見えていた】決定稿では、いちばん高いのは
     丸めた背中と頭がほぼ同じ高さで、頭が 1% ほど上に出ている。こちらは背中の頂点が
     1.666、頭頂が 1.566 で、背中が頭より 10cm（全高の 6%）も高かった。
     そのため背中だけが独立した丸い塊として飛び出して見えていた（agy）。
     頭を上げて背中と肩を並べる。首・お面・紐は HEAD を基準に組んであるので追従する。 */
  /* 「首から前にぬっと出ている」感じが足りず、頭が胴に埋まって見えた（agy）。
     ヨークの前端（z=0.480）からの張り出しを 0.184 → 0.222 に伸ばす。 */
  /* 【首が無く、頭が胴にめり込んで見えた】ヨークの前面は z=0.480+0.132=0.612、
     頭の後端は 0.702-0.158=0.544。頭が**ヨークの中へ 6.8cm 入っていた**ので、
     どんなに首を作っても現れる余地が無かった（agy「首が全く存在しない」）。
     頭を前へ送り、ヨークを細めて、あいだに首の見える隙間を作る。 */
  const HEAD = { y: 1.470, z: 0.775 };   // 頭の中心（ヨークの前・やや上）
  /** 2点を結ぶ骨。put の {x,y,z,rx,rz,len} を返す。
   *  カプセル・円柱は局所 +y へ伸びるので、Euler XYZ（＝rz を先、rx を後に効かせる）で
   *  (0,1,0) は (-sin rz, cos rz·cos rx, cos rz·sin rx) へ行く。これを目的の向きに合わせる。
   *  seg() は y-z 平面しか扱えず、左右へ開く腕や脚を置けなかったので置き換えた。 */
  const bone3 = (a, b) => {
    const dx = (b.x || 0) - (a.x || 0), dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    return { x: ((a.x || 0) + (b.x || 0)) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
             rz: -Math.asin(Math.max(-1, Math.min(1, dx / len))),
             rx: Math.atan2(dz, dy), len };
  };

  /* === 脚（長い。膝で軽く曲げる）===
     決定稿の脚は腿もすねも 42cm あって、全高のちょうど半分を脚が占める。
     関節の球を**隠さずに見せる**のがこの絵柄の要点なので、脚には weld を掛けない。 */
  /* 【足元が薄い】参照は上から 0.88〜0.94 の帯で厚み 0.39〜0.48 もあるのに、
     自分は 0.12〜0.15 しか無かった。原因は2つ――足を左右にしか置いていないこと、
     靴が短いこと。左右対称に揃えて立たせると、剛体のこの怪人は「静止した人形」に
     見える。片脚を踏み出させると、止まっていても歩行の途中として読める。 */
  /* 踏み出しの幅は参照に合わせて広げた。足首の高さ（輪郭の上から 0.94）で、
     参照は後ろ足の踵から刃の先まで厚み 0.48 もある。踏み出しが浅く靴が薄いと、
     この帯が 0.03 まで痩せて「棒の先に点が2つ」になる。 */
  /* 【細くする】参照を高さで正規化して測ると、腿の直径は全高の 0.080（＝0.132m）、
     すねは 0.056、膝の球は 0.062 しかない。前の版は腿 0.180・膝 0.172 と
     参照の 1.3〜2.8 倍あり、決定稿の「痩せたマネキン」ではなく丸太の脚になっていた。
     【踏み出しを深くする】参照は足首の高さ（上から 0.90〜0.95）で前後の厚みが
     全高の 0.39〜0.48 もある。これは靴が長いからではなく、**前後の足が 0.5m 以上
     離れている**から。前の版は踏み出し 0.24m しかなく、この帯が 0.08 まで痩せて
     「棒の先に点が2つ」になっていた。 */
  /* ================= 手と足を独立した部品にする =================
     【なぜ切り出すか】これまで指も靴も、親（腕・脚）の座標へ world 座標で直接
     ばら撒いていた。そのため関節を1つ動かすたびに、追従しない部品が必ず残った
     ――指が拳の前に取り残される、靴が足首から離れて宙に浮く、爪先だけが向きを
     変えない。武器を独立させたときと同じ問題で、直し方も同じ。

     **部品は自分の座標系で組み立て、取り付け点と向きだけを外から受け取る。**
     こうすると部品の内部は絶対に崩れず、外から変えられるのは「どこに」「どちらを
     向けて」の2つだけになる。 */

  /* === 手 ===
       原点 = 手のひらの中心
       +y   = 手首 → 指の付け根（手の長軸）
       +x   = 手のひらを横切る向き
       +z   = 手の甲の向き
     grip に柄の軸（world）を渡すとその軸に指を巻き付けた握り拳、
     渡さなければ指を垂らした開き手になる。 */
  const handPart = (O, dir, s, grip) => {
    const hY = dir.clone().normalize();
    /* 基底は必ず右手系のままにする。左右を s で鏡映すると行列式が負になり、
       統合後に三角形の表裏が反転して面が消える。鏡映は**局所座標の符号**でやる。 */
    const hX = new THREE.Vector3().crossVectors(hY, new THREE.Vector3(0, 0, 1)).normalize();
    const hZ = new THREE.Vector3().crossVectors(hX, hY);
    const H = new THREE.Matrix4().makeBasis(hX, hY, hZ).setPosition(O.x, O.y, O.z);

    /* 指は**柄の軸のまわり**に置く。柄の軸を手の座標系に写してから、
       それに直交する2本のベクトルで円を張れば、柄の向きを変えても
       指は必ず柄を包む。指を先に置いて柄を後から通すことは絶対にしない。 */
    let e1 = null, e2 = null, u = null;
    if (grip) {
      const g = grip.clone().normalize();
      u = new THREE.Vector3(g.dot(hX), g.dot(hY), g.dot(hZ)).normalize();
      const ref = Math.abs(u.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      e1 = new THREE.Vector3().crossVectors(ref, u).normalize();
      e2 = new THREE.Vector3().crossVectors(u, e1);
    }
    /* 手のひらは球で。角ばったボックスだと機械の手に見える。
       【厚すぎた】sz=1.05 で半径 0.052 の球は奥行き 10.9cm あり、掌というより拳。
       マネキンの掌は板に近いので、奥行きだけ落として平たくする。
       【握っているときは掌を柄の芯に置かない】半径 0.052 を sz 0.82 で潰した板の
       中心に半径 0.036 の柄を通すと、柄が掌の薄い側を突き抜けて反対側へ出る
       （agy「柄が指や手のひらを不自然に貫通して浮いている」）。
       掌は指の付け根の側、つまり柄の外にある。e1（指が並ぶ側）へ 3.4cm 逃がす。 */
    /* 握っているときは、掌は柄の軸を**囲む**塊。WSHIFT を軸方向だけに制限したので
       拳の原点はいま柄の軸の上にあり、そこに置いた球はそのまま柄を包む。
       ただし開いた手の掌（sz 0.82 の平たい板）のままでは、半径 0.036 の柄が
       薄い側から顔を出す。握るときだけ一回り大きく・丸くする。 */
    if (grip)
      /* ※ 0.058 では、柄（直径 7.2cm）に対して拳が 2cm しかはみ出さず、寄って撮ると
         「柄に巻いた黒い襟」にしか見えなかった。手の甲の側へ寄せて一回り大きくする。 */
      sph(0.064, bodyDk, { x: e1.x * 0.022, y: e1.y * 0.022, z: e1.z * 0.022,
                           sx: 1.02, sy: 1.16, sz: 0.94, rx: 0.08, uv: 1.0, pre: H }, 18, 12);
    else
      sph(0.052, bodyDk, { sx: 0.88, sy: 1.26, sz: 0.82, rx: 0.08, uv: 1.0, pre: H }, 18, 12);

    /* 決定稿の指は細長い。第1・第2関節の2節だけで、爪も指先の球も置かない。 */
    if (grip) {
      /* 【指の輪を柄と連動させ忘れて、指が柄に埋まって消えた】柄を 0.031 → 0.036 に
         太らせたとき、この R を 0.040 のままにしていた。指（半径 0.0135）の芯が
         柄の表面（0.036）とほぼ同じ位置に来るので、指がまるごと柄の中に沈み、
         寄って撮ると**柄だけが宙に浮いた棒**になっていた（agy が独立に検出）。
         R は必ず「柄の半径 ＋ 指の半径」で決めること。
         ※ 一度 1.8 倍（0.059）まで広げたときは、指だけが外へ張り出して
           機械の爪になった。柄の表面に触れる値に留める。 */
      /* 【指が「柄の中心へ向かう放射状の棒」だった】前の版は、長さ 5.2cm の指を
         円周上の1点から**軸へ向かって**まっすぐ倒していた。柄の半径は 0.036 なので、
         指の内側 3.6cm は柄の中に埋まり、外に出るのは 1.3cm だけ。
         4本ぶん合わせても、柄に細い帯が一周巻いているようにしか見えず、
         寄って撮ると「握っている手が存在しない」ことになっていた
         （agy「右手が大きく開いたまま、柄が指や手のひらを貫通して浮いている」）。
         指は軸へ向かうのではなく、**円周に沿って柄を抱き込む**。
         関節点を円周上に3つ取って繋げば、どの角度から見ても指が柄の外側に出る。 */
      const R = 0.036 + 0.0125;
      const onArc = (a, r, along) =>
        e1.clone().multiplyScalar(Math.cos(a) * r)
          .addScaledVector(e2, Math.sin(a) * r)
          .addScaledVector(u, along);
      for (let i = 0; i < 4; i++) {
        const t = 1 - Math.abs(i - 1.1) * 0.10;
        const a0 = s * (-0.50 + i * 0.30);         // 指の付け根の角（手の甲の側）
        const along = (i - 1.5) * 0.026;           // 柄に沿ってずらす（指の並び）
        /* 付け根 → 第2関節 → 指先。先へ行くほど半径を詰めて、柄へ食い込ませる。 */
        const A = onArc(a0, R * 1.06, along);
        const B = onArc(a0 + s * 0.78 * t, R, along + s * 0.004);
        const C = onArc(a0 + s * 1.46 * t, R * 0.88, along + s * 0.008);
        const d1 = bone3(A, B), d2 = bone3(B, C);
        cap(0.0142 * t, d1.len, bodyDk, { ...d1, uv: 0.8, pre: H }, 8);
        cap(0.0118 * t, d2.len, bodyDk, { ...d2, uv: 0.8, pre: H }, 8);
      }
      // 親指は反対側から柄を押さえる。こちらも円周に沿わせる
      const T0 = onArc(s * -1.28, R * 1.02, -0.030);
      const T1 = onArc(s * -0.62, R * 0.94, 0.006);
      const dt = bone3(T0, T1);
      cap(0.0142, dt.len, bodyDk, { ...dt, uv: 0.8, pre: H }, 8);
    } else {
      /* 垂れている手。
         【節が離れていた】前の版は2つの節を「中心の y」と「長さ」で別々に置いていて、
         第1節の先(0.094)と第2節の元(0.122)のあいだに 2.8cm の空隙があった。
         寄って見ると、指ではなく浮いた粒が2列並んでいるだけに見える。
         関節の座標（付け根 A・中節 B・指先 C）を先に決めて、そのあいだに骨を渡す。
         こうすると B は両方の半球に必ず含まれ、空隙は原理的に作れない。 */
      for (let i = 0; i < 4; i++) {
        const fx = (i - 1.5) * 0.021 * s;
        const t = 1 - Math.abs(i - 1.1) * 0.10;
        /* 手のひらの +y 側の端は 0.052×1.30 = 0.068。付け根はその内側から始める。
           先へ行くほど z を負（手のひら側）へ送って、力を抜いた軽い屈曲にする。 */
        /* 【指が短く太い「機械のクロー」だった】指先は 0.040+0.096=0.136、
           掌の +y 端は 0.052×1.30=0.068。つまり掌から出ている指はたった 6.8cm で、
           太さは直径 2.6cm。掌の長さ 13.6cm に対して指が半分しかないので、
           手ではなく「ミトンに突起が4つ」に見えていた（agy）。
           参照のマネキンの指は**掌と同じかそれ以上に長く、先へ向かって細る**。
           伸ばすと同時に細くしないと、今度は太い棒が4本になる。 */
        /* 【指が伸びきってロボットの手だった】節を y へ真っ直ぐ並べていたので、
           力の抜けた手ではなく「開いて構えた手」になっていた（agy）。
           参照の左手は指がわずかに丸まって、ぶら下がったまま脱力している。
           第2節の z を深く引き、同時に y の伸びを詰めると、先が内へ巻く。 */
        const A = { x: fx, y: 0.040, z: 0.004 };
        const B = { x: fx, y: 0.040 + 0.076 * t, z: -0.024 };
        const C = { x: fx, y: 0.040 + 0.128 * t, z: -0.090 };
        const d1 = bone3(A, B), d2 = bone3(B, C);
        cap(0.0112 * t, d1.len, bodyDk, { ...d1, uv: 0.8, pre: H }, 8);
        cap(0.0086 * t, d2.len, bodyDk, { ...d2, uv: 0.8, pre: H }, 8);
      }
      // 親指は手のひらの側面から生やす。指と同じく2点を結ぶ
      const T0 = { x: -s * 0.030, y: 0.012, z: -0.010 };
      const T1 = { x: -s * 0.056, y: 0.080, z: -0.044 };
      const dt = bone3(T0, T1);
      cap(0.0126, dt.len, bodyDk, { ...dt, uv: 0.8, pre: H }, 8);
    }
  };

  /* === 足（長靴）===
       原点 = 足首の真下の**床**。+z = つま先の向き、+y = 上。
     靴の最も重要な条件は床に接していることなので、原点を床に取る。
     こうすると足首をどれだけ上下しても靴が浮いたり沈んだりしない
     （以前は靴の各段を world の絶対 y で書いていたので、脚を伸ばすたびに崩れた）。 */
  const bootPart = (an, s) => {
    const yaw = s * 0.17;                                    // つま先を外へ開く
    const fZ = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const fY = new THREE.Vector3(0, 1, 0);
    const fX = new THREE.Vector3().crossVectors(fY, fZ);
    const F = new THREE.Matrix4().makeBasis(fX, fY, fZ).setPosition(an.x, 0, an.z);
    /* 参照の靴は「低い甲」「前へ伸びた爪先」「一段下がった踵」の3つの塊で出来ている。
       箱1個と球1個では甲・爪先・踵の区別が出ない。
       ※ 段どうしは**十分に食い込ませる**こと。1mm しか重ねなかったときは
         ほぼ同一平面になって z ファイティングを起こし、足元に色の線が出た。 */
    /* 【板の上に箱を積んだ形だった】甲(上端 0.110) → 爪先(0.067) → 靴底(0.028) と
       高さが3段に割れ、しかも靴底が甲より前後へ大きくはみ出していたので、
       靴ではなく「かんじきの上に箱を載せたもの」に見えた。
       ・靴底は甲の真下に収め、縁は左右 1mm だけ出す（縫い代の分）
       ・爪先は甲と**高さを重ねて**繋ぐ。段差ではなく傾斜に見せる
       ・角の丸めを大きく取り、箱の稜線を消す */
    /* 【まだ板の上に箱が載っていた】靴底を甲より広く取ると、どれだけ薄くしても
       輪郭の外に縁が回り、履物ではなく「かんじき」に見える。
       靴の見た目を決めるのは**外側から順に幅が細くなること**。
         甲 0.126 ＞ 爪先 0.120 ＞ 踵 0.110 ＞ 靴底 0.116
       靴底をいちばん細くして甲の丸みの下へ完全に隠し、床に接する面だけを残す。
       高さも全部の塊が床の近くまで下りるようにして、段差ではなく一続きにする。 */
    rbox(0.116, 0.030, 0.286, 0.012, bodyDk, { x: s * 0.004, y: 0.015, z: 0.010, uv: 1.0, pre: F });  // 靴底（甲の下に隠れる）
    rbox(0.126, 0.132, 0.238, 0.032, bodyDk, { x: s * 0.004, y: 0.076, z: -0.008, uv: 1.0, pre: F }); // 甲
    /* 【爪先が甲と同じ幅・同じ高さで、履物ではなく箱だった】爪先 0.120×0.098 は
       甲（0.126×0.132）の 95%／74% あり、前へ伸びても**細くならない**。
       参照の靴は先の尖った革靴で、爪先へ向かって幅も高さも落ちていく。
       幅と高さを削って前へ送ると、同じ全長のまま尖った靴として読める。 */
    rbox(0.092, 0.062, 0.150, 0.030, bodyDk, { x: s * 0.020, y: 0.036, z: 0.116, uv: 1.0, pre: F });  // 爪先
    rbox(0.110, 0.094, 0.100, 0.026, bodyDk, { x: -s * 0.002, y: 0.050, z: -0.106, uv: 1.0, pre: F }); // 踵
  };

  for (const s of [-1, 1]) {
    const fwd = s < 0;                                   // 大鉈を持つ側の脚を前へ踏み出す
    /* 【膝の開きが足りなかった】膝の高さ（輪郭の上から 0.60）で、参照は前後に
       0.377＝約 62cm の厚みがあるのに、こちらは 0.267＝44cm しかなかった。
       踏み出しを足首だけで作って膝を寄せていたのが原因で、脚が「揃えて立った人」の
       ままだった。膝そのものを前後へ開くと、止まっていても歩行の途中に見える。 */
    /* 前足の踏み出しは 0.330 → 0.430。すねの高さ（上から 0.80）で前端が参照より
       0.071 手前で止まり、床の接地点も 0.07〜0.14 後ろにあった。どちらも
       前足が踏み出しきっていないことが原因で、足首を前へ送ると両方が同時に埋まる。 */
    /* 足首の前後は、すね（上から 0.80）と足首（0.90）の両方の帯を見ながら決める。
       前へ出しすぎると 0.80 は埋まるが 0.90 で靴が出て太る。0.370 / -0.158 が
       両方を ±0.03 に収める値。 */
    /* 【前脚のすねを立てる】参照の前端は膝→足首（上から 0.70〜0.90）でほぼ一定
       （0.428 / 0.413 / 0.407）なのに、こちらは 0.80 で 0.350 まで凹んでから
       0.90 で 0.425 に膨らんでいた。すねが後ろへ寝ていて、その先で靴だけが
       前に出ていたため。膝を 0.205 → 0.290 へ送ってすねを立てると凹みが消える。 */
    /* 【両膝とも曲げて前へ出す】後ろ脚の膝を股関節より **後ろ**（-0.105）に置いて
       いたため、後ろ脚が一本の突っ張り棒になり、参照の「両脚ともやや曲がって
       膝が前に出ている」姿勢と別物になっていた（依頼主の指摘）。
       膝を前・足首を前後に振ると、脚が「く」の字に曲がったまま踏み出す形になる。 */
    /* 【膝を深く曲げ、前後に大きく開く】膝を股関節より 36cm / 20cm 前へ出し、
       足首は前後へ 0.43 / -0.24 と振る。膝が足首より前にあるほど脚は深く曲がる。
       参照は両脚とも「く」の字に折れていて、前後の開きも大きい。 */
    /* 膝を 0.545 → 0.600 へ上げ、さらに前へ送る。膝が低いままだと腿が下へ落ちるだけで、
       参照の「太ももが斜め前へせり出して膝が鋭角に折れる」形にならない
       （agy「関節がもつれて内股に崩れ落ちているように見える」）。 */
    /* 【曲げすぎた】膝を 0.400/0.260 まで前へ送ったら、今度は「しゃがみ込んで
       崩れ落ちそう」に見えた（agy）。依頼主の言う「**やや**曲がって膝が前に出る」に
       戻す。あわせて足首の前後の開きを広げ、脚が中心に寄って重なるのを避ける。 */
    /* 【後ろ脚がジグザグだった】膝を前(0.130)・足首を後ろ(-0.310)へ大きく振っていたため、
       すねが強く後ろへ寝て「左足が不自然に伸びている」ように見えた（agy）。
       参照の後ろ脚はほぼ真っ直ぐ。膝と足首の前後差を詰める。 */
    /* 【上半身の重みを支えている感じが無い】決定稿は、重い上体をガニ股気味の脚で
       どっしり支えている。こちらは足幅が狭く膝も浅いので「棒が前に傾いているだけ」に
       見えていた（agy）。前脚の膝をもう一段前へ送って、支える形にする。
       ※ 一度 0.400 まで送って「しゃがみ込んで崩れそう」になった前例があるので、
         深くするのは前脚だけ・25cm 前までに留める。 */
    const kz = fwd ? 0.248 : 0.052, az = fwd ? 0.336 : -0.192;
    /* 【脚全体を前へ 6.5cm 送る】輪郭を重ねると（tools/silhouette-overlay.mjs）、
       高さ 0.5〜0.8 の帯で自分の脚だけが参照より後ろに出ていた。
       部位ごとの横切りを測ると、参照の後ろ脚は奥行き 0.082、こちらは 0.042 で、
       全高比 0.04＝約 6.5cm 後ろに引けている。前掛けを伸ばしても輪郭が
       まったく変わらなかったことで、中盤の差の正体が布ではなく脚だと確定した。
       股関節の球は骨盤（z=-0.14〜0.19）の中に収まる範囲で前へ出す。 */
    /* ※ 一度この脚を 6.5cm 前へ送ってみたが、奥行きが 0.619 → 0.582 に痩せて
       中盤の帯も悪化した（参照 0.622）。高さ 0.4〜0.7 の**後端を作っているのは
       脚ではなく臀部**で、脚を動かしても後ろの輪郭は変わらない。取り消した。 */
    /* 【左右の開きが足りない】正面図で足元（上から 0.88）の幅は、参照が全高の 0.521
       なのにこちらは 0.341 しかなかった。前後には踏み出していたが左右には閉じていて、
       正面から見ると両脚がくっついた1本の柱に見える。膝と足首を外へ振る。 */
    /* 腿の付け根は尻の塊の中に入れる。股関節の球を尻より前・少し下に置くと、
       腿が尻から生えているように繋がる。外に出すと尻だけが瘤として残る。 */
    const hp = { x: s * 0.152, y: HIP.y - 0.030,  z: HIP.z + 0.014 };
    /* 【脚を伸ばす】参照は股関節 0.712・膝 0.362・足首 0.068（全高比）で、
       股関節から足首まで 0.644 ある。こちらは 0.623 しかなく、依頼主から
       「元の参照画像に比べて足が短い」と指摘された。関節を全部上げて 0.63 → 0.66 に。 */
    const kn = { x: s * 0.266, y: 0.578,  z: HIP.z + kz };
    /* ※ 一度 0.322 まで開いたが「スタンスが不自然に広すぎる」と評価が下がった。
       正面の幅を数値で合わせにいった結果の行きすぎ。0.252 に戻す。 */
    /* 参照の足の間隔は全高の 0.37 前後。0.285 では狭く、正面から脚が閉じて見える。
       （0.322 まで開いて「広すぎる」と言われた前例があるので、その手前で止める） */
    const an = { x: s * 0.308, y: 0.112,  z: HIP.z + az };
    const th = bone3(hp, kn), sk = bone3(kn, an);
    /* 【手足は根元が太く、先へ向かって細くなる】カプセルは半径が一定なので、
       どの部位も同じ太さの筒になり、生き物ではなく配管に見える（依頼主の指摘）。
       円錐台（cyl の上下で半径を変えたもの）に置き換えて先細りにする。
       bone3 の局所 +y は a→b の向きなので、rt が「先」・rb が「根元」の半径。
       端は平らだが、両端の関節球の中に埋まるので見えない
       ――関節球はそれぞれ隣り合う端の半径より大きくしておくこと。 */
    /* 【細すぎた】「全体的に線が細く貧弱」（agy）。先細りは保ったまま一回り太くする。
       関節球も一緒に上げないと、球より筒が太くなって継ぎ目に円板が露出する。 */
    /* 【まだ細い】「手足が細い円柱のようで非常に貧弱」「ひょろひょろした案山子」
       （agy）。先細りは保ったまま、もう一回り太らせる。
       関節球は必ず隣り合う筒の端より大きく――逆転すると継ぎ目に円板が露出する。 */
    sph(0.100, jointM, hp, 22, 14);                                                       // 股関節の球
    cyl(0.072, 0.096, th.len, bodyM, { ...th, uv: 1.6 }, 20);                             // 腿（根元 0.096 → 膝 0.072）
    sph(0.076, jointM, kn, 20, 14);                                                       // 膝の球
    cyl(0.048, 0.068, sk.len, bodyM, { ...sk, uv: 1.6 }, 20);                             // すね（膝 0.068 → 足首 0.048）
    sph(0.054, jointM, an, 16, 12);                                                       // 足首の球
    seam(kn, hp, an, 0.079);                                                              // 膝の合わせ目
    seam(hp, { x: hp.x, y: hp.y + 0.2, z: hp.z }, kn, 0.103);                              // 股関節の合わせ目
    seam(an, kn, { x: an.x, y: an.y - 0.2, z: an.z }, 0.057);                              // 足首の合わせ目
    bootPart(an, s);
  }

  /* === 胴（股関節から前へ倒す）===
     骨盤・胴・肩の3塊。weld はこの3つにだけ掛けて1本の胴に溶かすが、
     k を 0.055 まで絞ってあるので塊の境目は線として残る。 */
  /* 部品の sx/sz は weld で消える（頂点は距離場の等値面へ寄せられる）ので、
     扁平さは BONE_XS / BONE_ZS が受け持つ。ここでの拡大は頂点の分布を
     等値面に近づけて、寄せたあとの三角形が偏らないようにするためだけのもの。 */
  sph(0.152, bodyM, { y: 0.996, z: 0.034, sx: 1.22, sy: 0.94, sz: 0.88, uv: 1.8, weld: true }, 26, 16);   // 骨盤
  /* 【尻が独立した瘤になっていた】前の版は尻を (y 1.000, z -0.030) に置いていたが、
     股関節は (y 1.120, z 0.030)。尻が股関節より **12cm 下・6cm 後ろ**にあるため、
     腿は股関節から下へ伸びるのに尻だけがその脇に取り残され、
     「お尻から脚が連続していない」（依頼主の指摘）状態になっていた。
     尻を股関節と同じ高さ帯まで持ち上げ、距離場の骨にも入れて骨盤と一体に溶かす。 */
  /* 【尻がまだ全身でいちばん出ていた】依頼主の指摘は3回目。半径 0.118 を骨盤より
     4cm 後ろに置くと、どれだけ距離場へ溶かしても後ろの輪郭がそこで最大になる。
     決定稿の腰は**背中の弧がそのまま腿へ流れていく**だけで、後ろへ張る塊は無い。
     半径を落として前へ寄せ、骨盤との差を張りとしてだけ残す。 */
  sph(0.098, bodyM, { y: 1.066, z: -0.008, sx: 1.12, sy: 0.92, sz: 0.94, uv: 1.8, weld: true }, 24, 16);  // 尻（骨盤の後ろ下の張り）
  {
    /* 弧を4区間に切って並べる。隣どうしの角度差が 32/32/30/28 度と揃っているので、
       繋ぎ目が「折れ目」ではなく「曲率」として読める。半径は中背をいちばん太くして
       ヨークで絞る――決定稿の胴は背の峰あたりがもっとも分厚い。 */
    /* 【首が無かった】最終区間を半径 0.152 のまま 122 度まで回していたので、
       ヨークの前端が z=0.666 まで届き、頭（z=0.660・半径 0.158、後端 0.502）と
       **16cm も重なって**いた。頭と胴のあいだに細い区間が一切存在せず、
       首が無い（依頼主の指摘）。弧を 116 度で止め、最終区間を 0.120 まで絞って
       ヨークを後ろで終わらせ、そのぶん頭を前へ出して首の入る隙間を作る。 */
    /* 半径の山を均す。0.172→0.184→0.180 と中背だけ太らせていたので、
       背中の頂点が丸いコブとして飛び出し、そこから腰へ急降下していた
       （agy「背中に別の塊が乗っかっているように見える」）。
       ほぼ一定にすると、弧そのものの曲率だけが輪郭に出る。 */
    const SEG = [0, 32, 64, 94, 106];
    /* 全区間をほぼ同じ太さにしたら、今度は「前傾したそら豆」になって
       肩の山が消えた（agy）。背の上部（64°→94°）だけ局所的に太らせて、
       首がそこに埋まっている窮屈なシルエットを作る。 */
    /* 「肩幅が広く分厚い胸板による重量感がない／単純な円柱を繋げただけで貧弱」
       （agy が3回とも指摘）。背の峰から肩にかけてを一段太らせて、胴に厚みを出す。 */
    /* 「胸から腹にかけての厚みが無く案山子に見える」（agy）。全区間を一回り太らせる。 */
    /* 【0.212 → 0.108 の落差が「風船と管」を作っていた】太さが背の峰で最大になった
       直後にヨークで半分になるので、丸い塊のうしろに細い柄が生えた形に読める。
       峰をわずかに下げ、ヨークを太らせて、腰から首まで連続して細っていく形にする。 */
    /* 【胴が太すぎた】真横から撮ると、胴が幅 0.53・奥行き 0.38 の芋になり、
       そこに頭（幅 0.29）が小さく付いている比率だった。決定稿の胴は
       **頭の 1.4〜1.5 倍**しかない。1.8 倍あると、猫背の人ではなく甲羅に見える。
       全区間を同じ比率（0.91 倍）で絞る。1区間だけ触ると弧の輪郭が波打つ。 */
    const RAD = [0.164, 0.176, 0.180, 0.108];   // 最終区間＝ヨーク端は首の手前で絞る
    for (let i = 0; i < 4; i++) {
      const b = bone3(spine(SEG[i]), spine(SEG[i + 1]));
      cap(RAD[i], b.len + 0.02, bodyM, { ...b, sx: 1.22, sz: 0.90, uv: 2.0, weld: true }, 28);
    }
  }
  /* 峰は全身の最高点。参照画では、いちばん高いのは頭でも肩でもなく丸めた背中で、
     頭頂はそこから 2〜3% 下に並ぶ。ここを潰すと「うつむいた直立」に戻る。 */
  /* 【球をそのまま埋め込んだように見えた】背骨の筒（半径 0.204）に対して
     0.170×0.96 の球はほぼ同じ大きさで、しかも真球に近い比率だった。
     同じ寸法の球と筒が交わると、交線がはっきり出て「別の部品を刺した」形になる。
     峰は**筒の上に乗る緩い盛り上がり**なので、低く長く潰す。 */
  /* 【瘤になっていた】半径 0.150 の球を半径 0.204 の筒の上に乗せていたので、
     真横から見ると背中の上に**独立したドーム**が乗り、決定稿の「腰から肩まで
     均一に弓なりの背」ではなく猫背の瘤になっていた。決定稿の背に瘤は無い。
     弧そのものの曲率で背中を作り、ここは筒の継ぎ目を埋めるだけの薄い盛りに落とす。 */
  sph(0.108, bodyM, { y: CREST.y - 0.012, z: CREST.z - 0.020, sx: 1.24, sy: 0.50, sz: 1.10,
                      uv: 2.0, weld: true }, 28, 16);                                                             // 背の峰

  /* === 肩甲骨のヨーク・首・頭 ===
     背の峰から前下がりに伸びる**太い塊**がヨーク（肩甲骨と僧帽筋にあたる部分）。
     頭を前へ運んでいるのはこのヨークであって、首ではない。
     首はヨークの前端から頭までの 12cm だけで、太さも 0.104 と胴に近い。
     ここを細く長い管にすると、猫背の怪人ではなく鶴になる。 */
  {
    // ヨークは背骨の弧の最終区間が兼ねるので、ここでは置かない                                   // 背の峰 → ヨークの前端
    const nk = bone3(YOKE, { y: HEAD.y + 0.008, z: HEAD.z - 0.020 }); // ヨークの前端 → 頭
   // ヨーク（肩甲骨まわりの塊）
    /* 【首は頭より明らかに細いこと】半径 0.104＝直径 0.208 は、全高比 0.127。
       頭の幅 0.170 の 75% もあり、横から見ると頭と胴が同じ太さの丸太で繋がって、
       首というより「胴の延長」に見えていた（依頼主の指摘）。参照では首の太さは
       頭の 4〜5割で、頭と胴のあいだに**はっきり細い区間**がある。
       0.062＝全高比 0.076 まで絞ると、頭が独立した塊として読める。 */
    /* 首は「細い管」ではなく**太く短い筒**。参照の首は頭より細いが胴に近い太さがあり、
       弱々しい管を渡すと今度は針金で頭を吊ったように見える。 */
    /* 0.072 では「細い棒か紐」に見えた（agy）。参照の首は頭に迫る太さがあって、
       巨体と釣り合っている。頭 0.132 の 7 割にあたる 0.092 まで太らせる。 */
    /* 頭の幅 0.29 に対して 0.092（＝直径 0.184、比 0.63）では、首ではなく胴の延長。
       参照の首は頭の 5 割ほど。0.078（比 0.54）まで絞ると、太いまま首として読める。 */
    cap(0.078, nk.len + 0.02, bodyM, { ...nk, uv: 1.4 }, 20);                         // 首（短く・太い）
  }
  const headM = new THREE.Matrix4().makeTranslation(0, HEAD.y, HEAD.z)
    /* 【お面が地面を向いていた】+0.10 は顔を下へ倒す向き。深い前傾のうえに
       顔まで俯かせると「うなだれて静止している人形」になり、決定稿の
       「背は丸めたまま顔だけを前へ上げて獲物を見る」不気味さが出ない（agy）。
       わずかに起こして、視線が正面へ抜けるようにする。 */
    .multiply(new THREE.Matrix4().makeRotationX(-0.07))
    .multiply(new THREE.Matrix4().makeTranslation(0, -HEAD.y, -HEAD.z));
  /* 頭は幅 0.27・高さ 0.35・奥行き 0.31 の卵。参照では**縦に長い**（正面図で
     顔の紙とほぼ同じ幅しかないのに、側面図では紙より高く飛び出している）。 */
  /* 頭も 0.158 → 0.145 に詰める。頭が大きいままだと、首を作るために前へ出しても
     頭の後端がヨークに届いてしまい、結局そこが埋まる。 */
  /* 【頭より紙のほうが大きかった】頭は幅 0.242（0.132×0.92×2）、紙は幅 0.302。
     紙が頭を覆いきって、横から見ると頭の輪郭が紙の後ろに完全に隠れていた。
     参照では紙の上下左右に頭の丸みが見えている。頭を一回り大きくする。 */
  sph(0.158, bodyM, { y: HEAD.y, z: HEAD.z, sx: 0.92, sy: 1.14, sz: 1.00, pre: headM }, 26, 18);
  /* 【背中に構造を入れる】背面から見ると継ぎ目の無い一枚の卵で、肩甲骨も脊柱も
     腰のくびれも無い。参照のマネキンは面の切り替わりに稜線がある。
     距離場に入れると溶けて消えるので、**weld を掛けずに**表面へ薄く乗せる。
     肩甲骨は左右2枚の扁平な板、仙骨は腰の中心の小さな窪みの縁として置く。 */
  for (const sd of [-1, 1]) {
    /* 扁平率 0.40 だと輪郭が出て「貼り付けた板」に見える。0.22 まで潰して
       面に沈め、陰影の変化だけが残るようにする。 */
    /* 【背中に鋭い稜線が出ていた】扁平率 0.22 の大きな円盤は、どれだけ体に沈めても
       縁がぐるりと一周する。斜め後ろから見ると、その縁が「尖って出っ張った肩甲骨」に
       見えていた（agy）。円盤ではなく**小さくて丸い盛り上がり**にすれば縁は出ない。 */
    sph(0.074, bodyM, { x: sd * 0.114, y: 1.362, z: 0.252, sx: 1.06, sy: 1.44, sz: 0.46,
                        rx: 0.55, rz: sd * -0.16, uv: 1.6 }, 20, 14);   // 肩甲骨
  }
  sph(0.092, bodyM, { y: 1.212, z: 0.058, sx: 1.32, sy: 1.10, sz: 0.20, rx: 0.30, uv: 1.4 }, 20, 14);  // 仙骨のふくらみ
  /* 紙を留めている麻縄。決定稿では紙の上端の高さに1本だけ横へ回して、
     結び目の輪が頭の後ろ上に飛び出している。頭は上へ行くほど細るので、
     縄の輪も頭の断面に合わせて（x 0.126 / z 0.179）小さくする。 */
  /* 【後ろから見ると紐が消えていた】半径 0.124 は頭（幅 0.132×0.92）の中に
     埋まってしまう。頭の表面より外を通るよう 0.146 まで広げる。 */
  /* 【背中を貫く黒い棒の正体】rx=π/2 で寝かせた輪に sy=1.30 を掛けていた。
     rx で回したあとの sy は**前後方向**を伸ばすので、輪が頭の奥行き（半径 0.132）より
     5.8cm 後ろへ飛び出し、斜めから見ると背中を水平に貫く棒に見えていた（agy が
     「明らかなエラー」と指摘）。伸ばさず、頭の表面のすぐ外を通す。 */
  /* 【頭を一直線に貫く棒に見えた】輪の半径 0.164 は、その高さの頭の半幅 0.139・
     半奥行 0.151 より大きい。つまり紐は頭のどこにも触れず、周りを 1〜2cm 浮いて
     回る輪だった（agy「紐が頭の丸みに沿わず貫通して見える」）。
     頭の面へわずかに食い込ませると、縛って締めた紐になる。 */
  /* 【硬いホースに見える】太さ 0.011＝直径 2.2cm の輪は、頭の幅 0.29 の 7.5%。
     参照の紐は麻ひもで、頭の 3% ほどしかない細い線。太いと顔まわりが野暮ったくなる。 */
  /* 【硬い輪が顔のまわりに浮いている】頭は幅 0.139・奥行 0.151（この高さで）、
     さらに前には紙が 0.164 まで出ている。真円の輪では、前で紙より奥に入って隠れるか、
     横で頭から浮くかのどちらかにしかならない。
     輪を頭＋紙の断面に合わせて**楕円**にすれば、横は頭に、前は紙に触れる。
     ※ 拡大は回転より先に効くので、rx=π/2 の輪では sy が世界の z を伸ばす。
       ここは以前この性質を取り違えて、輪を頭の後ろへ 5.8cm 突き出させた箇所。 */
  /* ※ 0.011 は「硬いホース」、0.0062 は「針金」と言われた。参照は麻縄で、
     頭の幅の 4〜5% ある。0.0088 がその中間。 */
  /* 【また頭を貫く棒になっていた】この輪は「頭を1周する真円」なので、前で紙の外を
     通す（半径 0.168）と、後ろでも同じ 0.168 になる。ところが後頭部には紙が無く、
     頭の半奥行きは 0.151 しかない。差の 1.7cm が後ろへ飛び出し、10時方向から見ると
     **頭を水平に貫く串**として輪郭に出る（HANDOFF 17 章の「背中を貫く黒い棒」と同型。
     あのときは sy の掛かる軸を取り違えた話で、今回は輪が真円であること自体が原因）。
     直し方は「細くする」でも「小さくする」でもなく、**輪の中心を前へずらす**こと。
     前は紙（z+0.170）に触れ、後ろは頭の面の内側（z-0.144）を通る楕円にする。
     ※ 拡大は回転より先に効くので、rx=π/2 の輪では sy が世界の z を伸ばす。 */
  tor(0.144, 0.0088, cordM, { y: HEAD.y + 0.052, z: HEAD.z + 0.013, rx: Math.PI / 2, sy: 1.056, uv: 2.0, pre: headM });
  /* 結び目は**頭の横**に来る。後頭部に置くとどの角度からも見えない。
     輪の中心を前へずらしたので、結び目も輪の上（いちばん外へ張る x=±0.150 の点）へ移す。 */
  tor(0.022, 0.0085, cordM, { x: -0.146, y: HEAD.y + 0.052, z: HEAD.z + 0.013, rx: 0.5, rz: 0.5, pre: headM }, 12);   // 結び目の輪
  for (const [ty, tz, tr] of [[-0.058, -0.030, 0.5], [-0.072, -0.008, 0.9]])      // 結び目から垂れる余り紐
    cap(0.0062, 0.062, cordM, { x: -0.148, y: HEAD.y + 0.052 + ty, z: HEAD.z + 0.013 + tz, rz: tr, pre: headM }, 8);

  /* === 腕（長い。肘で曲げる）===
     上腕は肩から**下がりつつ後ろへ**、前腕は肘から**下がりつつ前へ**。
     この「く」の字が決定稿の腕で、まっすぐ垂らすと途端に人形になる。
     fa = 前腕を鉛直から前へ倒す角。大きいほど深く曲がる。 */
  /* 【腕は 1.10m ある】参照を測ると 肩 y1.45 → 肘 y0.93 → 手首 y0.40。
     上腕・前腕とも 0.53〜0.57m で、指先はすねの中ほどまで届く。
     前の版は肩から手首まで 0.76m しかなく、腕が胴の脇に収まって
     「腕を組んで縮こまった人」に見えていた。
     肩は x±0.315 で胴の脇、肘は x±0.372 と**さらに外へ張り出して**から
     手首でわずかに戻る。この外への弓なりが、正面から見たときの
     「体と腕のあいだに開いた大きな隙間」を作っている（参照の正面幅は
     全高の 0.49、前の版は 0.33 しかなかった）。
     前後では、肘が**全身でいちばん後ろ**に出る点になる。 */
  /* 柄の付け根は拳からの固定オフセットで決まる。握る手の指をその軸に
     巻き付けるために、大鉈側と腕側の両方から参照できるようにここへ出す。 */
  /* 【刃を布から逃がす方向を間違えていた】前掛けと刃の交差を避けようと、
     刃の付け根を拳の **30cm 前方** へ押し出していた。結果、柄が長い斜めの棒になり
     （実測 dz=0.516）、拳と刃が分離して「板が宙に浮いている」状態になっていた。
     布は体の中心（x≈0）にあるので、逃がすべきは z ではなく **x（体の外側）**。
     付け根を拳のすぐ外・すぐ上に置けば、柄は 16cm の短い握りになり、
     刃は拳から素直に下がる。 */
  /* 【付け根が拳の 35cm 上にあった】刃を急角度で下へ向けていたため切っ先が床を割り、
     それを避けるために付け根を上げ続けた結果、刃が拳のはるか上から生える形になっていた
     （agy「板が不自然な角度で生えている」「持ち手が無い」）。
     参照を測ると拳は低く（全高の 0.23＝y≒0.37）、刃は**水平から 33 度**しか下がっていない。
     ほぼ寝かせて引きずる角度にすれば、付け根を拳のすぐ横に置いても床に当たらない。 */
  /* 付け根は拳の**やや下**でよい。手は柄を握るので、刃の付け根は握りの先にある。
     ここを拳より上に置くと、刃が手の上から生えて見える。 */
  /* 【この3つは連動する】刃の角度・刃渡り・付け根の高さのどれを変えても切っ先の
     高さが動く。解析で合わせようとすると刃幅の転がしぶんを落として毎回ずれるので、
     変えたら必ず最小 y を実測して詰める。0.095 は実測で切っ先が床に触れる値。 */
  /* ================= 大鉈の持ち方 =================
     【なぜ武器を独立させるか】これまでは刃の付け根を「拳からの相対位置」で置き、
     柄はそこから拳まで棒を渡すだけだった。そのため刃の角度を変えるたびに柄の長さと
     向きが変わり、拳の 30cm 前方に刃があったり、柄が拳に隠れて見えなかったりした。
     指も柄とは別の座標で並べていたので、握っている形にならなかった。

     ここでは順序を逆にする。**武器を自前の座標系で作り、それを手に合わせて置く。**
       ・武器の原点＝握りの中心。柄の軸＝局所 +y。刃は -y 側へ伸びる
       ・手はその原点に置き、指は同じ +y 軸のまわりに巻く
     こうすると、刃の角度・刃渡り・床とのクリアランスを、手の都合と切り離して
     この基底だけで調整できる。指と柄がずれることも原理的に起きない。

     WSHIFT 握りの中心を、拳（P）から**柄の軸に沿って**どれだけずらすか（スカラー）
     WDIR   刃の向き（握り → 切っ先）。参照実測で水平から 36 度下がる
     WROLL  刃の面をどれだけ回すか（0 で正面へ最も広く見える） */
  /* 【刃の下の角が床を割る理由】刃幅の方向 wX は cross(wY, +z) で決まるので、
     その y 成分は「刃を体の内側へどれだけ振ったか」に比例する。内側 0.60 で振ると
     wX.y=0.702 になり、刃幅 0.225 の下の角が軸より 14cm 下へ垂れて床を突き抜ける。
     内側を 0.30 に減らして前方 0.73 に振り替えると wX.y=0.442 まで下がり、
     垂れは 9cm に収まる。刃は体の前を横切ったまま、床とのクリアランスだけ稼げる。 */
  /* 【内側への振りを取り戻す】刃の下の角が床を割るのを避けるために内側を 0.30 まで
     減らしたら、刃が体の左外に収まって参照のように体の前を横切らなくなった。
     武器を独立した座標系にしたので、**柄を下へ伸ばせば握りを高く置ける**。
     握りを拳の 15cm 上に上げ、柄をそのぶん下へ伸ばして拳を柄の上に乗せたまま、
     刃を内側 0.55 まで振り戻す。刃渡りも 0.628 に伸ばして切っ先を床へ届かせる。
     ――これが「武器を別部品にする」ことの実利で、
     刃の姿勢と手の位置を独立に決められるようになった。 */
  /* 【握りが拳の 15cm 上にあった】刃が床を割るのを避けるために握りの原点を上げた結果、
     拳より上に 29cm の裸の棒と柄頭が突き出し、棒の末端を摘まんでいるように見えていた
     （依頼主「斧が変なところにくっついている」）。
     武器を独立させた以上、床を逃がすのに動かすべきは**刃の長さと角度**であって
     握りの位置ではない。握りは拳のほぼ真上に戻し、刃を詰めて角度で稼ぐ。 */
  /* 【ここが「指が柄に埋まって、柄だけが宙に浮く」の真因だった】
     WGRIP は握りの中心を拳から自由に動かせる**3成分のベクトル**だった。ところが
     指の輪は handPart のなかで**拳（P）を中心に**張られるので、WGRIP に軸と直交する
     成分があると、柄の軸だけが輪の中心からずれる。実測でずれは 2.84cm あり、
     指の輪の半径 0.0495 に対して、片側は柄の芯まで 0.021（＝半径 0.036 の柄の中に
     指が埋まって消える）、反対側は 0.078（＝柄の表面から 4cm 浮く）になっていた。
     HANDOFF が「握り位置を1点にまとめてから止まった」と書いた不具合は、
     実は**まだ半分残っていた**――原点は1つになったが、軸から外れていた。
     ずらしてよいのは**柄の軸に沿った方向だけ**。スカラー1つに落として、
     直交成分を作れないようにする（wY は下で WDIR から作る）。 */
  const WSHIFT = 0.019;   // 握りの中心を、拳から柄の軸に沿ってどれだけずらすか（+ は柄頭側）
  /* 【ぶら下げているだけに見える】刃を真下寄りに垂らしていたので、
     重い得物を意志を持って握っている感じが出ない（agy）。
     参照は刃をやや手前へ持ち上げて構えている。下向き成分を 0.611 → 0.470 に減らし、
     前方成分を 0.565 → 0.700 に増やすと、刃が前へ突き出す構えになる。 */
  /* 【刃が垂れ下がっていた】参照の大鉈は**ほぼ水平**に、脚の前を左手から
     右へ横切っている。こちらは 38 度下向きで、鞄を提げているように見えていた。
     刃を寝かせると、刃幅の方向 wX（= wY×z）は逆に立つ。
       WDIR y = -0.62 → wX.y = 0.48（刃の面が寝て、正面から細く見える）
       WDIR y = -0.17 → wX.y = 0.87（刃の面が立って、正面から広く見える）
     参照が「刃の腹をこちらへ大きく見せている」のは、刃を寝かせた結果。
     床とのクリアランスは刃を短くして稼ぐのではなく、この角度で稼ぐ。

     【カメラを向いていた】前へ 0.94 も出すと、刃はレンズを向いて完全に潰れ、
     正面から見ると細い板が1枚あるだけになる。参照で刃が大きく見えているのは、
     刃が**脚の前を左手から右へ横切って**いて、面を画面と平行に晒しているから。
     長軸の主成分は前後ではなく**左右**。左手(x=-0.37)から右脚の外側へ抜かせる。 */
  /* 前へ 0.59 でもまだ斜めで、刃渡り 0.43 の板が正面から 1:1 の四角に潰れていた。
     刃の比（1.6:1）を正面で読ませるには、長軸をほぼ左右に寝かせるしかない。 */
  /* 【刃渡りを 0.44 → 0.58 に伸ばすので、下向き成分を浅くして床を割らせない】
     切っ先の落差は「刃渡り × |WDIR.y|」。0.540×0.220 = 0.119 だったところへ
     刃渡りだけ 0.680 にすると 0.150 まで落ち、実測 2.3cm しかない床との隙間を割る。
     0.160 にすると 0.680×0.160 = 0.109 で、伸ばす前より落差が小さくなる。
     ※ 刃の角度・刃渡り・握りの高さは連動する。変えたら必ず tools/mob-bbox.mjs で
       切っ先の最小 y を実測すること（解析だけで合わせると毎回ずれる）。 */
  /* ※ 爪を刃（下）側に付けたので、刃のいちばん低い点が 4cm 下がった。
     このままでは切っ先が床を割る（実測 -0.06）。落差は「刃渡り × |WDIR.y|」なので、
     下向き成分をさらに寝かせて取り戻す。変えたら必ず tools/mob-bbox.mjs で実測すること。 */
  const WDIR  = new THREE.Vector3(0.88, -0.055, 0.42).normalize();
  const WROLL = 0.05;
  const arm = (s, grip) => {
    /* 【肩が背中の後ろに付いていた】前の版は肩 z=0.055・肘 z=-0.165 で、
       胴の奥行き（z=-0.24〜0.78）のうち**後ろから 24% の位置**に肩があった。
       腕が背骨の途中から生えているように見え、横から見ると腕と胴が絡んで読めない。
       参照の側面図で三角筋の輪を測ると、肩は奥行きの **60%**（z≒0.33）――
       つまり頭のすぐ下、胴の前寄りにある。そこから腕はほぼ垂直に下り、
       前腕だけが大きく後ろへ振れて、拳が足の上に来る。
       この「上腕は垂直・前腕は後ろへ」が参照の腕の形。 */
    /* 【肘が逆に折れていた】前の版は 肩 z=0.330 → 肘 z=0.306 → 手首 z=-0.052 で、
       前腕が上腕に対して**後ろへ**折れていた。人間の肘は前腕が前へ出る向きにしか
       曲がらないので、横から見ると腕が裏返って見える（依頼主の指摘）。
       さらに副作用として前腕が上腕より 35% 長くなっていた（0.395 対 0.293）――
       手首を後ろへ引きすぎたぶんが前腕の長さに化けていたため。

       正しい形は「肘が後ろへ張り出し、そこから前腕が前へ振り出される」。
       肩 z=0.330 → 肘 z=0.250（後ろへ）→ 手首 z=0.330（前へ戻る）とすると、
       上腕 0.502・前腕 0.462 で上腕のほうが長くなり、比率も人体に戻る。 */
    /* 肩幅は ±0.300 → ±0.332。丸めた背中の幅（半幅 0.265）に対して肩が内側に
       寄っていて、正面から見るとなで肩の小柄な体に見えていた。 */
    /* 【肩が高すぎた】背中のコブの側面、ほぼ最高点の高さに肩を付けていたので、
       頭とは無関係な場所から腕が生えているように見えた（agy の指摘）。
       参照の肩は背中の頂点より一段低く、少し前寄りにある。 */
    /* 【脇が空いている】肩を x±0.366 まで開いたので、上腕と胴のあいだに
       隙間ができて腕が体から浮いていた。参照は上腕が胴に触れている。
       胴の半幅（ヨークで 0.212×1.44/2 ≒ 0.153、肩の高さで約 0.28）に対して
       0.340 なら、三角筋の球（半径 0.094）が胴へ 3cm 食い込む。 */
    /* 【正面から腕が「A」の字に開いていた】胴を 0.91 倍に絞ったので、肩を
       ±0.340 のままにすると脇に隙間が開く。決定稿の腕は**体側にほぼ沿って**垂れ、
       肘がわずかに外へ張るだけ。肩を内へ寄せ、肘の張り出しも半分にする。
       ※ 縮めるのではなく、詰めたぶんを下へ回して指先を下げる
       （決定稿の指先はすねの中ほどまで届く）。 */
    /* 【腕の張り出しが参照より 5cm 広かった】正面のシルエットを実測すると、
       腕の外端どうしの幅は参照が全高の 0.458、こちらは 0.519。片側 5cm 広い。
       `tools/silhouette-diff.mjs` でも上から 0.15〜0.30 の帯（＝肩と上腕）だけが
       +0.035〜+0.060 太く、他の帯にはその偏りが無かった。
       ※ 縮めるのは x だけ。y と z（肘の後退・手首の前進）は「く」の字を作っている
         ので触らない。触ると腕が真っ直ぐな棒に戻る。
       ※ 3点を同じだけ内へ寄せたら、今度は上から 0.40〜0.70 の帯（＝前腕の高さ）が
         参照より 0.05〜0.10 細くなった。参照の腕は**肩が狭く、肘から先が外へ開く**。
         狭めるのは肩だけで、肘と手首は元の位置に戻す。 */
    const SH = { x: s * 0.284, y: 1.318, z: 0.352 };   // 肩（三角筋の中心）
    const EL = { x: s * 0.352, y: 0.856, z: 0.268 };   // 肘（後ろへ張り出す）
    const WR = { x: s * 0.332, y: 0.404, z: 0.352 };   // 手首（前へ戻る）
    const ua = bone3(SH, EL), fo = bone3(EL, WR);
    /* 関節球は筒より一回り大きくして、球体関節として**外へ出す**。
       球が筒に埋まっていると「ただの細い棒」に見える（agy）。 */
    /* 肩の球だけは輪郭の外へ出る位置にあるので、筒の根元（0.086）との差を詰める。 */
    sph(0.088, jointM, SH, 22, 14);                                          // 肩の球（三角筋）
    cyl(0.064, 0.086, ua.len, bodyM, { ...ua, uv: 1.6 }, 20);                // 上腕（肩 0.086 → 肘 0.064）
    sph(0.072, jointM, EL, 20, 14);                                          // 肘の球
    cyl(0.046, 0.062, fo.len, bodyM, { ...fo, uv: 1.6 }, 20);                // 前腕（肘 0.062 → 手首 0.046）
    sph(0.052, jointM, WR, 16, 12);                                          // 手首の球
    seam(EL, SH, WR, 0.075);                                                 // 肘の合わせ目
    seam(SH, { x: SH.x + s * 0.2, y: SH.y, z: SH.z }, EL, 0.091);             // 肩の合わせ目
    /* ※ P（手のひら）はこの下で作るので、ここでは前腕の延長で向きを出す。 */
    seam(WR, EL, { x: WR.x * 2 - EL.x, y: WR.y * 2 - EL.y, z: WR.z * 2 - EL.z }, 0.055);  // 手首の合わせ目
    /* 手のひらは前腕の延長線上に置く（前の版は固定オフセットで、腕を動かすと外れた）。
       ここから先は handPart が自分の座標系で組む。腕が受け持つのは
       「手のひらの位置」と「手の長軸」の2つだけ。 */
    const fd = new THREE.Vector3(WR.x - EL.x, WR.y - EL.y, WR.z - EL.z).divideScalar(fo.len);
    const P = { x: WR.x + fd.x * 0.058, y: WR.y + fd.y * 0.058, z: WR.z + fd.z * 0.058 };
    /* 握る手には**武器と同じ** WDIR を渡す。柄の軸を武器と手で共有しているので、
       刃の角度を変えても指が柄から外れることは原理的に起きない。 */
    /* 【手首が固定されて棒立ちに見えた】掌の長軸をそのまま前腕の延長 fd に取っていたので、
       肘から指先まで一直線で、重い得物を「ずるずる引きずっている」感じが出ない
       （agy「手首がまっすぐ固定されており、腕全体がやや棒立ち」）。
       握っている側だけ、掌の軸を柄の軸（wY = -WDIR）へ 3 割寄せる。
       指は handPart のなかで**柄の軸のまわり**に巻くので、掌の軸を傾けても
       指と柄の関係は変わらない――ここが武器を別アーティファクトにした利得。 */
    const hdir = grip
      ? fd.clone().lerp(WDIR.clone().negate(), 0.30).normalize()
      : fd;
    handPart(P, hdir, s, grip ? WDIR.clone().negate() : null);
    return P;
  };
  /* 大鉈は**画面左手**に持たせる。決定稿がそうなっている。四面図の front は
     怪人を π 回して撮るので、怪人のローカル -x が画面の左に出る。 */
  const GRIP = arm(-1, true);
  arm(1, false);

  /* === 前掛け ===
     首元 y=1.46 から裾 y=0.66 まで。**体には沿わせない**。前傾した胴から離れて
     鉛直に垂れ、体との間に隙間が見えることが決定稿の要点で、その隙間が
     「布が吊られている」という情報になる。z=0.40 前後に置くと、肩(z=0.26)より
     14cm 手前を通り、脚(z=0.05)の前に大きく開いた面ができる。 */
  /* 【大きさが足りていなかった】前掛けは決定稿でいちばん面積の大きい要素で、
     上端 y=1.26（顎のすぐ下）から裾 y=0.40（膝の下）まで 0.86m 垂れ、
     幅は上下ともほぼ 0.36m ある。前の版は上端 0.23m と細く、しかも位置が
     14cm 高かったので、四面図では体の陰に隠れた細い短冊にしかなっていなかった。 */
  /* 【裾を体へ寄せる】前の版は rx=0.02 でほぼ鉛直に吊っていたので、
     胸元（z≈0.39）の真下に裾も来て、脚（z≈0.03〜0.33）との間に
     20cm 以上の空隙ができ、横から見ると**体から離れて浮いた短冊**だった。
     実際の前掛けは腿に当たって後ろへ倒れるので、rx=0.30 で裾を 12cm 引き戻す。 */
  /* 【裾が高すぎた】輪郭を重ねると（tools/silhouette-overlay.mjs）、高さ 0.35〜0.68 の帯に
     参照だけの赤い面が大きく残っていた。裾 y=0.400 は参照の y≒0.28 より 12cm 高く、
     膝から下が布で覆われていなかった。丈を 0.855 → 0.975 に伸ばして裾を下げる。 */
  /* 【倒しすぎた】裾を体へ寄せようと rx=0.30 まで倒したが、輪郭を測ると
     膝〜すねの高さ（上から 0.60〜0.80）で前端が参照より 0.06〜0.07 手前で止まっていた。
     参照の前掛けはもっと**鉛直に近く**垂れて、裾が前へ張り出している。
     rx を 0.10 に戻すと裾の前端が 0.309 → 0.421 まで出て、参照の 0.413〜0.428 に乗る。 */
  /* bow（正面への張り出し）は 0.078 → 0.125。横から見たとき、平らな面は
     厚みゼロの線にしかならず、腰に下げた荷札に見えていた。中央を膨らませると
     側面の輪郭に 12cm の幅が出て、布として読めるようになる。 */
  /* 【体に沿わせる】股関節を 8cm 下げ、背骨を弧にしたことで胴の前面が z≒0.58 まで
     出たのに、前掛けは z=0.392 のまま吊っていた。布が体の**内側**を通ってしまい、
     首の下から硬い板が垂直に下りているだけに見えていた（agy「土管のよう」）。
     胸元 z=0.57 で体に触れ、そこから鉛直に落ちて裾が脚のあいだへ入る位置へ移す。
     rx を 0.10 → 0.16 に増やして裾を体側へ寄せ、布が脚に当たって流れる形にする。 */
  /* 幅と位置は控えめに。前へ出しすぎると、深く前傾した体では布の上端が頭の高さに
     並んでしまい、顔の紙と胸当てが同じ面に見えて体が読めなくなる。 */
  /* rx で面ごと倒すのはやめる。傾けると上端まで一緒に動いて胸から浮くので、
     体に触れる位置は変えずに sway で裾だけ後ろへ振る。 */
  /* 【裾が長すぎて脚を隠していた】丈 0.96 だと裾が y=0.28（ほぼ足首）まで届き、
     正面から見て黒い脚がほとんど見えず、胴から布が生えた寸胴に見えていた。
     参照では裾は膝のあたりで終わり、その下に脚の柱がはっきり残っている。
     丈を 0.76 に詰めて裾を y=0.48（膝の少し下）へ上げる。 */
  /* 丈を詰めたとき上端まで一緒に下がってしまい、「エプロンが首元ではなく
     胸の中心から生えている」ように見えていた。上端はヨーク（首の付け根）の
     高さに固定して、詰めるのは裾だけにする。 */
  /* 【布が脚の後ろを通っていた】全部品の外接寸法を測ったところ、前掛けの前面は
     z=0.617（局所）、前へ踏み出した足のつま先は z=0.736。**布が足より 12cm 後ろ**にあり、
     脚の裏を通っていた。「布が体から離れている」という見え方の正体はこれ。
     胸元（ヨーク前端 z=0.643）に触れ、かつ前足より手前に落ちる位置へ移す。 */
  /* ヒダは 5 本 → 3 本。細かい縦ヒダを等間隔で並べると、布ではなく**すだれ**に見える
     （agy）。本数を減らして 1 本を深くすると、大きなドレープとして読める。 */
  /* 【45cm 浮いていた】腰の高さ(y=1.0)で布は z=0.662、体（骨盤）は z=0.206。
     深く前傾しているので、胸から鉛直に落とすと骨盤のはるか前を通る。
     実際の前掛けは胸で触れたあと**腿に当たって後ろへ流れる**ので、
     sway（裾がどれだけ後ろへ振れるか）を -0.105 → -0.34 に強める。
     裾は z=0.428 まで戻り、前膝（前面 0.307）の 12cm 前を通る布になる。 */
  /* 【戻しすぎた】「45cm 浮いている」を直すために sway を -0.34 まで強めたら、
     今度は裾が腿を貫通した。smoothstep 化で曲線が後ろへ膨らんだぶんも重なっている。
     -0.22 が、胸に触れつつ裾が前膝の手前を通る値。
     ※ 浮きを直すときは動かした**あとの**接触を必ず測ること。往復を3回繰り返した。 */
  /* 【上端が胸の 18cm 前に浮いていた】布の上端 z=0.400 に対し、胸（ヨークの前面）は
     z=0.220。首から吊っているのに布が胸に触れていない。弧を 124°→106° に浅くして
     胸が後ろへ下がったのに、布を追従させていなかった（基準点の直し忘れ 5 回目）。
     14cm 引き戻すと上端が胸に接し、裾は前膝の手前に残る。 */
  /* 【幅の付き方が逆だった】決定稿の前掛けは**腰でいちばん広く、裾へ向けて少し狭まる**
     （胸 0.21 → 腰 0.41 → 裾 0.36）。こちらは腰 0.30・裾 0.43 で、上が細く下が広い
     三角形になっていた。正面のシルエットを参照と重ねると、腰から膝にかけて
     参照だけが残る大きな面が出る（＝布が足りない）のはこれが原因。
     丈も足りない。決定稿の裾は膝の下まで届いていて、脚の前半分を隠している。 */
  /* シワは 3 本・振幅 3cm では、1.7m の体に対して「大きく波打った板」でしかない。
     使い込んだ前掛けの縦ジワは指の幅ほどの間隔で入る。本数を増やして深くする。 */
  /* 【テントのように前へ浮いていた】bow は布の中央を前へ張り出させる量。0.112 は
     腰の幅（半幅 0.205）の半分以上あり、布が体から離れて前へ立ち上がる三角錐になる。
     決定稿の布は「胸で触れて、あとは垂れる」だけなので、張り出しは厚みぶんでよい。 */
  /* 裾抜きで下端が 1 割ほど消えるので、そのぶん丈を伸ばしておく（上端 1.290 は動かさない）。 */
  /* 【裾が前脚の後ろへ回っていた】前膝を 0.248 まで前へ送ったので、後退量 -0.235 では
     裾（z≒0.276）が膝の前面（z≒0.354）より奥に入り、布が脚の裏を通ってしまう。
     決定稿の前掛けは前腿の**上に**掛かっている。膝の前を通る量まで戻す。
     ※ 脚を動かしたら布の後退量も必ず見直すこと。ここは今回で3度目の取り違え。 */
  /* 【シワを入れるほど「波板」に見えた】0.046 → 0.032 → 0.022 と下げても、
     agy は毎回「波板／プリーツカーテン」と言い続けた。等間隔の縦の起伏は、
     振幅をいくら下げても人工物の周期として読まれる。
     布らしさを作っているのは起伏ではなく**縁の乱れ**（裾のほつれ）のほうなので、
     ※ ただし 0.010 まで落として完全に平らにすると、今度は本当にただの板になった。
     0.022 が、波板に見えずに面の起伏だけが残る値。 */
  /* 【幅の狭いカーテンが足首まで垂れていた】脚を ±0.308 まで開いたので、
     半幅 0.205 の布では脚のあいだに落ちる細い帯にしかならない。
     決定稿の前掛けは**腿の側面まで覆う**幅があり、丈は膝で終わる。
     幅を一回り広げ、裾を上げて膝丈にする（上端 1.290 は動かさない）。 */
  /* 【膝の上で終わっていた】輪郭を参照と数値で突き合わせると（tools/silhouette-diff.mjs）、
     正面・2時方向のどちらでも上から 0.40〜0.85 の帯だけが一貫して 0.03〜0.10 薄く、
     しかも他の帯にはその偏りが無かった。この帯を占めているのは前掛けだけなので、
     差の出どころは脚でも胴でもなく**布の面積**。裾は上から 0.70 で終わっていて、
     参照の 0.78（膝の下・すねの中ほど）に届いていない。
     ※ v25 で一度 0.96 まで伸ばして「脚が隠れる」と戻しているが、あれは脚が
       ±0.20 しか開いていなかった頃の話。いまは足が ±0.31 まで開いているので、
       布を広げても脚の柱は左右に残る。
     丈だけを伸ばすと上端まで下がるので、**上端 1.290 を固定して裾だけ**下げる。
     【幅は広げないこと】丈と一緒に腰 0.496 / 裾 0.462 まで広げたら、布が脚をほぼ
     覆い尽くして**ドレス**になった。薄かったのは正面の「幅」ではなく側面の「奥行き」で、
     正面の 0.40〜0.70 の帯を占めているのは布ではなく腕の外側。
     参照の布幅は全高比で腰 0.24・裾 0.22＝腰 0.40 / 裾 0.37 しかない。
     広げるのではなく、丈だけ伸ばして脚の柱を左右に残す。 */
  /* 【胸当てが無く、黒い胸郭が丸出しだった】胸元の幅 0.248 は腰（0.424）の 59% しかなく、
     上端も y=1.290＝みぞおちの高さで止まっていた。前掛けはそこから下だけを覆うので、
     正面から見ると細い短冊の左右に胴の黒がそのまま残る
     （agy が版Bへの第1の指摘に挙げた「鎖骨付近の2本のペグから布が吊るされているだけ」）。
     決定稿の胸当ては**胸を横切る幅の板**で、そこから紐が肩へ回る。
     上端を 4.6cm 上げ、胸元の幅を腰の 74% まで広げる。裾（y=0.345）は動かさない。 */
  /* sway（裾の後退）は -0.150 → -0.110。丈を 0.991 に伸ばしたぶん、同じ後退率でも
     裾が体の下へ深く巻き込み、面が光源から背いて**灰青に沈んだ靄**として写っていた
     （影を切っても消えないので、シャドウアクネではなく面の向きの問題）。
     浅くすると布が光を拾い直し、同時に側面の輪郭で足りていなかった前方への
     張り出し（上から 0.70〜0.85 の帯）も埋まる。 */
  apronSheet(0.312, 0.424, 0.376, 0.991, 0.068, -0.110, canvasM,
             { y: 0.8405, z: 0.494, uv: 1.0, soil: true }, 0.610, 4, 0.022);
  /* 吊り紐は前掛けと同じ布ではなく**濃い革**。決定稿では布より一段暗く、
     首の上を通って肩の後ろへ回っている。ここを布地の明るい色にすると、
     顔の紙のすぐ下に明るい線が2本走って、紙の輪郭が読めなくなる。 */
  for (const sd of [-1, 1]) {
    /* 【紐は首に掛かっていること】前の版は上端を (y=1.548, z=0.430) に置いていたが、
       そこはヨークの前端(y=1.436, z=0.492)より 11cm 高く 6cm 後ろ――つまり
       **体のどこにも触れていない空中**で、横から見ると紐が宙で切れていた。
       胸当ての上角からヨークの上を越える線に張り直す。 */
    /* 取り付け位置は**倒したあとの布の面**に合わせる。前掛けは中心 z=0.392 を軸に
       rx=0.30 で倒してあるので、上端(局所 y=+0.4275)は z が 0.4275·sin(0.30)=0.126
       だけ前へ動いて z≒0.518 にある。倒す前の 0.404 のまま留めると、
       紐と金具だけが布の 11cm 後ろ――体と布の隙間――に浮く。 */
    /* 【紐が見えない】太さ 0.014 の紐は 2〜5m 先で消える。参照の吊り紐は
       指2本ぶんの幅がある帯で、肩の上を越えて背中へ回るのがはっきり見える。
       上端をヨークの後ろ側まで伸ばし、太さも上げる。 */
    /* 前掛けの上端を 1.360 → 1.290 に下げたので、留め位置も一緒に下ろす。
       （基準点の直し忘れは、この作業でいちばん多い失敗） */
    /* 【短く太い棒に見えた】長さ 0.23・直径 4.4cm の丸太を、胸当てから斜め上へ
       1本渡しただけだったので、肩に掛かっているのではなく胸から生えた杭になっていた。
       参照の吊り紐は細い革帯で、肩の**上を越えて**背中側へ落ちる。
       上端をヨークの頂点より後ろまで伸ばし、太さを革帯の厚みまで落とす。 */
    /* 【首紐が無いように見えていた】胸当ての上端の半幅は 0.216/2 = 0.108 なのに、
       紐を x=±0.132 に付けていた。布の角より 2.4cm 外――つまり**布に付いていない**。
       さらに 0.0135 まで細くしたので、正面からは線としても読めなくなっていた。
       角に正しく留め、革帯として読める太さに戻す。 */
    /* 【顎の下に立った2本の杭に見えた】ほぼ真上へ短く伸ばしていたので、
       首の脇を通らず顔の真下で切れていた。**肩の上を外へ回して**背中へ落とすと、
       正面からは顔の左右に紐が見え、吊っている構造が読める。 */
    /* 【正面から紐が1本も見えなかった】お面は x=±0.136・z=0.78 にあり、紐は
       x=±0.10〜0.14・z=0.24〜0.54。つまり紐の全長がお面の真後ろに隠れていた
       （agy「首紐が存在しない」）。胸当ての幅が 0.248 になったので、
       留め位置を角（±0.124）まで開けば、お面の外を通って正面から見える。 */
    /* 【留め位置が布の 7.7cm 前の空中だった】上角を z=0.532 に置いていたが、
       apronSheet の面はその高さで z = 0.494 + 張り出し(0) + 縁の巻き込み(-0.039) = 0.455。
       紐も金具も布に触れておらず、胸の前に**2本の杭**が立っているだけだった
       （基準点の直し忘れ 6 回目。前掛けを動かしたらここも必ず計算し直すこと）。
       胸当てを広げたので、上角も x=±0.152 へ動く。 */
    /* 【肩へ渡すと、どうやっても「胸から生えた杭」にしかならない】
       この怪人は 90 度近く前傾しているので、胸当ての上端（y 1.320・z 0.460）と
       肩（y 1.318・z 0.352）は**高さがほぼ同じで、奥行きが 11cm 違うだけ**。
       そのあいだに帯を渡すと、長さ 17cm の短い棒が水平に突き出すことになり、
       帯としての向きが読めない（agy が2回続けて「前方へ突き出た黒いペグ」と指摘）。
       決定稿の前掛けは**首に掛けて**いる。首はヨーク前端(1.4425, 0.432)から
       頭(1.478, 0.755)へ伸びていて、胸当ての上角から見て斜め上・奥にある。
       そこへ張れば長さ 19cm の斜めの線になり、胸当てと首のあいだの
       開いた空間を横切るので、どの角度からも「吊っている紐」として読める。 */
    const st = bone3({ x: sd * 0.152, y: 1.320, z: 0.458 },    // 胸当ての上角（布の面の上）
                     { x: sd * 0.045, y: 1.450, z: 0.556 });   // 首の中（半径 0.078 の内側）
    /* ※ 終点は体の**中**に入れること。表面ちょうどで止めると、丸い端の蓋が
       そのまま見えて「肩から突き出た杭」になる。 */
    /* 【丸い棒ではなく平たい革帯】直径 3.7cm の丸棒は、どの角度から見ても
       円柱の稜線が出て「肩に渡した突っ張り棒」に見える。参照の吊り紐は
       幅 3cm・厚み 1cm の帯で、面がこちらを向くから帯として読める。 */
    rbox(0.032, st.len, 0.010, 0.003, strapM, { ...st, uv: 1.0 });
    /* 金具は布に沈める。厚み 1cm を布の前へ出すと、胸から突き出た杭に見える。 */
    rbox(0.026, 0.026, 0.008, 0.003, beltM, { x: sd * 0.152, y: 1.322, z: 0.464 });   // 胸当てに紐を留める金具
  }
  /* 腰帯。決定稿では前掛けの上から幅広の帯と麻縄が腰を回っていて、ここで布が一度締まる。
     【輪の中心は体ではなく前掛けに置く】体（z≈0.03）と前掛け（z≈0.42）の両方を囲む
     大きな輪にすると、横から見たときに体と布の間の空間を通る**フラフープ**になった。
     前掛け寄り（z=0.28・半径 0.21）に置くと、輪の後ろ半分が胴（前面 z≈0.18）に
     埋まって見えなくなり、前半分だけが「布を締めている帯」として残る。
     半径は前掛けの端（x±0.18, z 0.39）をちょうど通る値。 */
  /* 【輪にしてはいけない】体（z≈0.03）と前掛け（z≈0.42）の両方を囲む輪にすると、
     横からも正面からも**空中を通るフラフープ**として読めてしまう。決定稿の帯は
     前掛けの面の上を通っているだけなので、布と同じ曲率の弧として置く。
     apronSheet の反り（bow 0.058・半幅 0.18）を通る円は半径 0.573・中心 z=-0.154。
     端は前掛けの縁（x±0.18）をわずかに越えたところで切る。 */
  /* 【腰帯が黒い四角に化けていた】arc は openEnded の円柱、つまり**厚みの無い一枚の面**。
     帯の端では面が横を向くうえ、裏側は片面カリングで抜けるので、端の数区画が
     どの光も拾わず真っ黒な板として画に残っていた（2時方向で特に目立つ）。
     帯は本来ベルトなので、厚みのある閉じた塊で作る。弧に沿って短い箱を並べれば、
     どこから見ても表が向いていて、端も断面として素直に閉じる。 */
  /* 【腰が硬い四角いベルトになっていた】革帯の箱を弧に並べていたが、決定稿の腰は
     **荒縄**で、書類の束をそこへ縛り付けている。硬い構造物を置くと、
     「エプロンの上に棚板が付いている」ようにしか見えない（agy が2回指摘）。
     帯は取り払い、麻縄1本に任せる。 */
  /* 【縄の存在感が薄い】直径 3.8cm は前掛けの幅 0.42 の 9%。参照の腰縄はもっと太く、
     ここで布が一度締まって書類の束をぶら下げている、という構造の要になっている
     （agy「全体をまとめる腰の縄の存在感も薄い」）。太さを 1.4 倍にする。 */
  /* 【縄が布の 5mm 裏に埋まって、1本も見えていなかった】
     半径 0.280・中心 z=0.192 の弧の前端は z=0.472。ところが前掛けの丈と sway を
     変えたあと、腰の高さ(y=0.884)での布面は z=0.477 まで前へ出ていた。
     つまり縄の全長が布の裏にある。agy が「腰を一周するロープ自体が存在しない」と
     書いたのはこれで、**実際に作ってあるのに見えていなかった**
     （前掛けを動かしたときの追従漏れ。この版で7回目）。
     中心を z=0.212 へ送ると、前端 0.492 が布面 0.477 の 1.5cm 前、
     端（x=±0.19）でも布面 0.435 の 1mm 前を通る。
     あわせて**帯（arc）をやめて丸い縄にする**。arc は厚みの無い一枚の面なので、
     どれだけ太くしても横から見ると線に潰れ、麻縄には見えない。
     短いカプセルを弧に沿って並べ、高さを少し揺らして手で巻いた縄にする。 */
  {
    const RC = { y: 0.884, z: 0.212 }, RR = 0.280, RT0 = -0.76, RT1 = 0.76, RN = 11;
    const rp = (k) => {
      const a = RT0 + (RT1 - RT0) * (k / RN);
      return { x: Math.sin(a) * RR, y: RC.y + 0.005 * Math.sin(k * 1.9 + 0.7), z: RC.z + Math.cos(a) * RR };
    };
    for (let k = 0; k < RN; k++) {
      const b = bone3(rp(k), rp(k + 1));
      /* ※ 半径 0.0175（直径 3.5cm）＋高さの揺れ 1.1cm は、2回続けて
         「極端に太い」「太いしめ縄／粘土のチューブ」と言われた。参照の腰紐は
         もっと細くピンと張っている。太さを 6 割・揺れを半分にする。 */
      cap(0.0112, b.len + 0.006, twineM, { ...b, uv: 1.0 }, 8);   // 腰の荒縄（束を縛る）
    }
  }

  /* === 腰の書類の束2つ ===
     決定稿で唯一の持ち物。腰帯の紐に十字に縛って留めてある。
     白い点を**顔とこの2つだけ**に絞ることで、暗闇で追うべき箇所が決まる。
     参照では 1個が幅 0.20・高さ 0.25 と**縦に長い**書類の塊で、前掛けの縁から
     左右にはみ出している。前の版は 0.162×0.118 の平たい札で、腰の飾りに見えていた。 */
  for (const sd of [-1, 1]) {
    /* 束は前掛けの布に**接して**いること。ry を 0.34 も振ると内側の角が布から
       浮いて、腰から生えた引き出しの取っ手に見えた。z も前掛けの面（y=0.88 で
       z≈0.40）に合わせて置き直す。 */
    /* 束は前掛けの**面の上**に載る。前掛けを rx=0.30 で倒したので、
       腰紐の高さ(y=0.884)での布の z は 0.392 + 0.056·sin(0.30) ≒ 0.409。
       そこに布の張り出し(≈0.03)と束の厚みの半分を足した位置に置く。 */
    /* 束が「硬いレンガのように外側へ飛び出している」（agy）。布の面まで引き戻し、
       厚みも薄くして、縛り付けてあるように見せる。 */
    /* 「紙束が腹部ではなく胸に付いている」（agy）。前掛けの上端を基準に置いていたので、
       丈を変えるたびに高さがずれていた。腹（前掛けの中ほど）へ下げる。 */
    /* 束も同じ理由で布から浮いていた。腰の高さでの布面 z≒0.540 に、
       束の厚みの半分を足した位置に置く。 */
    /* 束は布の面に載る。sway を強めたぶん、腰の高さでの布面が後ろへ動いたので追従する。
       布面 z = 0.634 + swell(0.049) + drift(-0.34×0.29) = 0.585 */
    /* 【水平に浮いた木のブロックに見えた】厚み 4.4cm の直方体が布から離れて
       真横に突き出していた。紙の束は薄く、布に**もたれて**いる。
       厚みを削り、布の面へ押し込み、傾きを付けて垂れ下がって見せる。 */
    /* 腰の麻縄（y=0.878）より束の上端が高いと、縛っている紐が束の裏に隠れて
       「宙に貼り付いた箱」に見える。束を下げて、縄が上に出るようにする。 */
    /* 【左右が鏡像なので「見開きの本」になっていた】幅・高さ・角度・高さ位置まで
       完全に対称な札を x=±0.104 で中央に寄せて並べていたので、2つが1つの
       見開きページとして読める（agy が3回、こちらの目でも同じ）。
       決定稿の束は**2つとも向きも高さも違う**。片方は刷った面をこちらへ向け、
       もう片方は 60 度ひねって小口（紙の重なった断面）を見せている。
       高さも 4cm ずれていて、腰縄からそれぞれ勝手にぶら下がっている。
       対称を崩すこと自体が直しなので、寸法ではなく**振り分け**を入れる。 */
    const faceOn = sd < 0;                       // 片方は刷り面、もう片方は小口をこちらへ
    /* 【布の 7cm 前に浮いていた】bz=0.492 に対し、腰の高さでの前掛けの面は
       z≒0.428（張り出し +0.024・裾への後退 -0.091）。束は布に**もたれて**いるので、
       いちばん奥の紙が布に触れる位置まで引き戻す。
       ※ 前掛けの丈・sway を変えたらここも必ず計算し直すこと（取り違え4度目）。 */
    /* 【布に埋めすぎて張り出しが消えた】側面の輪郭を参照と比べると、参照には
       腰の高さ（上から 0.50〜0.65）に束のぶんの**前方への山**が +0.03 出ているが、
       こちらは滑らかな斜面のままだった。束は布に「もたれる」のであって
       「埋まる」のではない。いちばん奥の紙が布に触れる位置まで前へ戻す。 */
    const bx = sd * 0.138, by = faceOn ? 0.766 : 0.724, bz = 0.436, brz = sd * 0.11;
    /* 【正面から厚みが読めない】刷り面の側を sd*0.14 とほぼ正対させていたので、
       正面図では 8cm の嵩がすべて奥行き方向に消え、「ペラペラの紙切れ」に見えていた
       （agy が3回続けて指摘。厚みは足りているのに**向き**で隠れていた）。
       刷り面の側も一段ひねって、面と小口が同時に見えるようにする。 */
    const byaw = faceOn ? sd * 0.34 : sd * 0.72;   // 小口側は大きくひねる
    /* 束の本体は小口（切り口）。ここに印字を巻くと箱全体が罫線の格子になる。
       さらに面へ細かいノイズを掛けて**縁を不揃い**にする。角の揃った箱のままだと、
       紙の束ではなくカセットか弁当箱に見える。紙が不揃いに重なった塊に見えるかどうかは、
       枚数ではなく輪郭のガタつきで決まる。 */
    /* 角丸を 0.006 → 0.018 に。直方体のままだと「箱」にしか見えない。
       紙の束は角が潰れて丸い。 */
    /* 【溝を彫った木のブロックに見えていた】束を1個の箱で作り、小口のテクスチャで
       紙の重なりを描いていた。輪郭が1本の直線である以上、どんな模様を貼っても
       「線を引いた木」から出られない（agy が5回すべてで指摘）。
       紙の束に見えるかどうかを決めるのは**輪郭のガタつき**なので、
       薄い板を7枚、少しずつずらして重ねる。1枚ごとに縁が出るので、
       横から見ても斜めから見ても、必ずどこかに段差が見える。 */
    /* 7枚では1枚あたりが大きく、縁のまっすぐな板が数枚重なっているだけに見えた。
       枚数を増やして1枚を薄く小さくし、寸法と角度のばらつきを上げる。
       縁のノイズも強めて、断ち切った直線を残さない。 */
    /* 【薄すぎて「板」だった】10 枚 × 3.6mm ＝厚み 3.6cm。決定稿の束はもっと嵩があって、
       小口をこちらへ向けた側では**厚みそのものが形**になっている。
       枚数と間隔を上げて 6cm まで嵩を出す（1枚あたりは薄いまま）。 */
    /* 【まだ「四角い木のブロック」だった】枚数を増やしても、1枚ごとの寸法差 2cm・
       角度差 0.12rad・縁のノイズ 4mm では、重ねた結果の輪郭がほぼ1本の直線に揃う。
       紙の束に見えるかどうかは枚数ではなく**そろっていないこと**が決めるので、
       寸法・角度・縁の乱れを全部いちどに上げる（agy が版Bへの第3の指摘に挙げた）。 */
    /* 13 枚 × 4.6mm ＝ 6.0cm。参照の束はもう一回り嵩がある。16 × 5.0mm で 8.0cm。
       ※ 枚の間隔を変えたら、この下の書状の板と紐の z も一緒に直すこと。 */
    for (let i = 0; i < 16; i++) {
      const jx = (rr7() - 0.5) * 0.024, jy = (rr7() - 0.5) * 0.032;
      /* 【輪郭がまだ直方体だった】ry（左右の振り）と rz（面内の回転）だけを散らしても、
         全部の紙が**同じ平面に平行**なままなので、束を横から見た輪郭は1本の直線になる。
         紙は縛られて前後にも反る。rx を散らすと、重ねた縁が奥行き方向にも食い違って、
         どの角度から見ても段差が出る。 */
      rbox(0.128 + rr7() * 0.040, 0.160 + rr7() * 0.048, 0.0038, 0.0012, sheafM,
           { x: bx + jx, y: by + jy, z: bz - 0.016 + i * 0.0050,
             rx: (rr7() - 0.5) * 0.16,
             ry: byaw + (rr7() - 0.5) * 0.20, rz: brz + (rr7() - 0.5) * 0.19, uv: 1.0,
             noise: { amp: 0.0062, freq: 78 } });
    }
    /* 束からはみ出した数枚。角度と長さを散らして、束の輪郭の外へ紙を出す。
       これが無いと、どれだけ縁を荒らしても「整えて綴じた書類」に留まる。 */
    for (let i = 0; i < 3; i++)
      /* はみ出した紙にも scrapTex（朱印の赤い丸つき）が乗っていて、束の縁に
         赤い模様が覗いていた（agy）。朱印は顔の紙だけの記号なので、
         ここは小口と同じ生成りにする。 */
      plate(0.150 + rr7() * 0.040, 0.196 + rr7() * 0.030, letterM,
            { x: bx + (rr7() - 0.5) * 0.030, y: by + (rr7() - 0.5) * 0.040,
              /* 束の**うしろ**に置いていたので、前掛けの布を突き抜けていた
                 （agy が旧版について独立に見つけた不具合と同じ形）。
                 はみ出しは奥行きではなく上下左右へ出るものなので、束の中ほどに挟む。 */
              z: bz + 0.010 + i * 0.013,
              ry: byaw + (rr7() - 0.5) * 0.18, rz: brz + (rr7() - 0.5) * 0.16 });
    /* 印字が見えるのは**いちばん上の1枚だけ**。4枚重ねると、ずらした縁の
       罫線どうしが干渉して縞が二重に見え、紙束ではなく編んだ籠になっていた。 */
    /* 【「開いた本」に見えていた】束の面に scrapTex（朱印の赤い丸つき）を貼っていたので、
       左右の束が見開きのページに見え、赤い丸が謎のテクスチャとして目立っていた（agy）。
       束の上面は「いちばん上の紙」であって印刷面を見せる場所ではないので、
       小口と同じ生成りにして、朱印は顔の紙だけに残す。 */
    /* 【この1枚が束の厚みを隠していた】書状の板を 0.178×0.232 で置いていたが、
       束を作っている紙は 0.128〜0.168 × 0.160〜0.208。つまり**束より大きい板**を
       いちばん前に貼っていたので、斜めから見ると小口の段差がすべてその裏に隠れ、
       束が「ペラペラの下敷き1枚」に見えていた（絶対評価で最大の減点要因）。
       束より一回り小さくして、周りに小口の縁が残るようにする。 */
    plate(0.152, 0.198, letterM,
          { x: bx + sd * 0.008, y: by + 0.002, z: bz + 0.066, ry: byaw, rz: brz });
    /* 縛った紐は太く濃く。0.006 だと 2m 先で消えて、束が「縛られている」ことが
       伝わらない。十字に回って初めて書類の束として読める。 */
    /* 紐は束に**食い込む**。表面に載せるだけだと、縛ったのではなく置いただけに見える。
       束の厚み(0.044)の中ほどを通る高さに下げ、太さも上げる。 */
    cap(0.0078, 0.212, twineM, { x: bx, y: by, z: bz + 0.026, rz: Math.PI / 2 + brz, ry: byaw, uv: 1.0 }, 8);   // 横に回した紐
    cap(0.0078, 0.256, twineM, { x: bx, y: by, z: bz + 0.026, rz: brz, ry: byaw, uv: 1.0 }, 8);            // 縦に回した紐
    /* 【結んだ紐の「余り」が無い】十字に回した紐が両方とも束の外で切れているので、
       縛ったのではなく**輪ゴムを掛けた**ように見えていた（agy）。
       交点に小さな結び目を置き、そこから2本を長さも角度も変えて垂らす。 */
    tor(0.014, 0.0062, twineM, { x: bx + sd * 0.010, y: by + 0.004, z: bz + 0.034,
                                 rx: 1.2, ry: byaw, rz: brz }, 10);                       // 結び目
    for (const [tl, tr, tx] of [[0.086, 0.34, 0.004], [0.062, -0.52, -0.012]])
      cap(0.0055, tl, twineM, { x: bx + sd * 0.010 + tx, y: by - 0.004 - tl / 2, z: bz + 0.034,
                                rz: brz + tr, ry: byaw, uv: 1.0 }, 6);                    // 垂れた余り紐
  }

  /* === 大鉈 ===
     握りの中心を原点、柄の軸を +y、刃の幅を x、刃の厚みを z とした**武器自身の座標系**で
     組み立て、最後に1つの行列で手へ持たせる。刃渡りや角度を変えても、柄と指の関係は崩れない。 */
  {
    /* 手に持たせる基底。+y が柄の軸（握り → 柄頭）、x が刃の幅、z が刃の面の法線。
       WROLL で刃を長さ軸まわりに転がす（0 なら正面から最も広く見える）。 */
    const wY = WDIR.clone().negate();
    const wX0 = new THREE.Vector3().crossVectors(wY, new THREE.Vector3(0, 0, 1)).normalize();
    const wZ0 = new THREE.Vector3().crossVectors(wX0, wY);
    const wX = wX0.clone().multiplyScalar(Math.cos(WROLL))
                  .addScaledVector(wZ0, Math.sin(WROLL)).normalize();
    const wZ = new THREE.Vector3().crossVectors(wX, wY);
    /* 柄の軸（wY）に沿ってだけずらす。こうすると柄の軸は必ず拳を通るので、
       handPart が拳を中心に張った指の輪と原理的にずれない。 */
    const wO = new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z).addScaledVector(wY, WSHIFT);
    const W = new THREE.Matrix4().makeBasis(wX, wY, wZ).setPosition(wO);

    /* --- 柄。原点をまたいで上下に伸ばす ---
       拳の幅は 0.09 ほどなので、握りは上下に 0.10 ずつ出しておかないと
       指のあいだに埋まって「柄が無い」ように見える。 */
    /* 参照の柄尻は刃幅の 1/3 ほどしか拳から出ていない。長く残すと竿になる。 */
    /* 【刃を 0.58m に伸ばしたら柄が細く見えた】直径 6.2cm の柄は刃幅 0.28 の 22%。
       参照の柄は刃幅の 3 割近くあり、両手で振れる太さに描かれている
       （agy「柄も太く造形されている」）。刃を大きくしたら柄も釣り合わせる。 */
    cyl(0.036, 0.032, 0.228, handleM, { y: -0.005, pre: W }, 16);     // 柄（拳の中心を貫通する）
    /* 参照の柄尻はわずかに膨らんで丸く落ちている（agy「柄の後端が少しカーブしている」）。
       球の瘤を付けると杖や旗竿になるので、径を1割足した短い段だけにする。 */
    cyl(0.033, 0.040, 0.030, handleM, { y: 0.116, pre: W }, 16);      // 柄尻のふくらみ
    /* 参照の柄尻は握りと同じ太さで平らに切ってあるだけ。球の瘤を付けると
       杖や旗竿に見える。少しだけ膨らませて端を丸める程度に留める。 */
    sph(0.030, handleM, { y: 0.100, sy: 0.80, pre: W }, 14, 10);        // 柄尻
    for (const ty of [-0.034, 0.038]) {                                // 革巻き（握る場所を示す）
      sph(0.037, strapM, { y: ty, sy: 0.34, pre: W }, 14, 8);
    }
    /* 口金に磨いた金物（bladeM）を使うと、暗い体の中でここだけが白く光り、
       視線が刃ではなく継ぎ目へ行く。刃と同じ錆びた鋼にする。 */
    rbox(0.062, 0.022, 0.028, 0.006, cleaverM, { y: -0.092, pre: W });  // 口金

    /* --- 刃 --- 原点から下へ伸ばす。刃渡りは握りから 0.62m。
       参照の角度（水平から 36 度）で下ろすと落差 0.365m で、拳(y≒0.38)から床に触れる。 */
    const bs = new THREE.Shape();
    /* 【角の丸い長方形で、鉈に見えなかった】峰も刃も直線だったので、寄って見ると
       書類鞄にしか見えない。肉切り包丁の輪郭は「峰は真っ直ぐ、刃は腹がふくらんで
       切っ先へ跳ね上がる」。この非対称が刃物の情報そのものなので、直線をやめる。
       大きさも参照に合わせる（刃渡り 0.43m・刃幅 0.27m、比 1.6）。 */
    /* 【小ぶりだった】参照（ref2_side）で刃を測ると、刃渡りは全高の 0.35＝0.58m、
       刃幅は 0.17＝0.28m ある。こちらは 0.44×0.28 で、幅は合っていたが
       **刃渡りが 3 割足りない**。比が 1.6:1 では肉切り包丁の寸法で、
       決定稿の「両手で振るような巨大な鉈」にならない（agy「包丁が一回り小ぶり」）。
       幅はそのまま、峰と刃を先端側へ 0.14 伸ばして比を 2.1:1 にする。 */
    /* 【切っ先の上の角が丸くて締まらない】峰の先を quadraticCurveTo で丸めていたので、
       上の角が「角の取れた包丁」になり、得物として弱い（依頼主の指摘）。
       決定稿は肉切り包丁だが、**爪付き鉈**にする。爪付き鉈の見分けどころは、
       峰の先から前へ突き出す**鉤（爪）**と、爪と切っ先のあいだにできる**懐（えぐれ）**の2つ。
       ここが丸いか尖っているかで、道具としての性格が変わる。
       ・爪の長さは刃幅（0.282）の 1/4 ほど。長すぎるとピッケルになる。
       ・爪先は**丸めない**。ここだけは直線で角を出す（bevel 3.5mm ぶんは丸まる）。
       ・懐は爪先より 11cm 手前へ引く。ここが浅いと、爪ではなく「尖った角」に見える。
       ※ 楔のテーパは t = (x - EDGE)/(SPINE - EDGE) を 0..1 に丸めているので、
         爪（x > SPINE）は自動的に峰と同じ最大厚みになる。爪は厚くてよい。 */
    /* === 刃の輪郭 ===
       峰（背）は x=+0.026、刃先は x=-0.256。y は柄から前へ向かって負。

       【爪は「刃（下）側」に付く。峰側ではない】ここは5回作り直した。実物の写真を
       6倍に拡大してようやく確定した形はこう:
         研いだ刃は**切っ先まで届かず、手前で終わる**。その先に、刃の線より
         **外（下）へ張り出した研いでいない四角い塊**があり、これが爪。
         刃の終わりと爪の境が**鋭い内角**になっていて、そこが引っ掛ける懐。
         切っ先の前面は、峰の先の角から爪の外側の角まで**一直線に落ちる**
         （下へ行くほどわずかに前へ出る）。
       間違えた版の記録（同じ間違いを繰り返さないため）:
         ×「切っ先から前へ突き出す鉤」→ 槍先・トゲ・クチバシと言われ続けた（4版）
         ×「峰を彫り込んで段を作り、その先の高い部分が爪」→ **上下が逆**（1版）
       ・爪の張り出し ＝ 刃幅の 2 割弱（刃の線から 4cm ほど外）
       ・爪は研がない部分。楔のテーパは x が EDGE より外なので t が 0 に丸まり、
         いちばん薄くなってしまう。**爪は峰と同じくらい厚い**ので、EDGE の値を
         爪の外側まで下げず、刃の線に置いたままにしてある（t<0 は 0 に丸まる）。
         → 爪が薄くなるのが気になるなら、楔の式のほうを直すこと。

       【面に斜めの稜線が1本走る】ExtrudeGeometry の前後の蓋は**耳切り**で三角形に割られる。
       峰が1本の長い辺だと蓋が細長い三角形になり、そこへ下の楔（頂点の z を x に応じて
       縮める処理）を掛けると面が平面でなくなり、長い対角線が稜線として画に出る。
       ※ 影を切っても消えない（--noshadow で確認済み）ので、シャドウアクネではない。
       直し方は「楔をやめる」ではなく**輪郭の点を増やす**こと。峰を分割してある。 */
    bs.moveTo(0.026, -0.104);                                   // 峰（柄側）
    for (let i = 1; i <= 6; i++) bs.lineTo(0.026, -0.104 - (0.454 * i) / 6);   // 峰（分割して蓋の三角形を細かくする）
    bs.quadraticCurveTo(0.026, -0.598, 0.004, -0.608);          // 峰の先の角（わずかに丸める）
    /* ※ 爪の**後ろ側の壁**を斜めにすると、四角い塊ではなく「下向きのトゲ」に見える。
       壁は刃の線と直角（＝刃渡り方向に動かさず、刃幅方向へ真っ直ぐ）にすること。
       懐が直角に切れて初めて「引っ掛ける段」として読める。 */
    bs.lineTo(-0.296, -0.654);                                  // 切っ先の前面（爪の外側の角まで一直線に落ちる）
    bs.lineTo(-0.300, -0.600);                                  // 爪の外側（刃の線より外。刃と平行に走る）
    bs.lineTo(-0.248, -0.598);                                  // 爪の後ろの壁（刃と直角。ここが懐）
    bs.quadraticCurveTo(-0.256, -0.360, -0.212, -0.158);        // 刃（腹をふくらませる）
    bs.quadraticCurveTo(-0.202, -0.116, -0.168, -0.104);        // 顎（柄の手前で立ち上がる）
    bs.closePath();
    /* 押し出しは厚みが一定なので断面が長方形の板になる。峰が厚く刃先が薄い楔にするため、
       押し出したあと頂点の z を刃幅方向の位置に応じて縮める。 */
    {
      /* 【紙のように薄い】厚み 0.020 では、横から見ると刃が消える（agy）。
         肉切り包丁の峰は 5〜6mm あり、全長 0.6m の刃なら遠目にも厚みが読める。
         押し出しを 0.034 に上げ、楔の最小も 0.18 → 0.34 にして刃先まで肉を残す。 */
      /* 【薄っぺらい鉄板に見える】厚み 0.020 のうえ、楔の最小を 0.18 まで絞っていたので、
         刃の大半が 3mm 台の板だった。中華包丁の峰は 6mm 前後あり、
         「ずっしりした鉄の塊」に見えるかどうかはこの峰の厚みで決まる（agy が2回指摘）。 */
      /* ※ 0.030＋楔の最小 0.30 まで厚くしたら、今度は「刃物としてあり得ないほど分厚く、
         木のパドルに見える」と言われた。薄すぎ（0.020／0.18）と厚すぎ（0.030／0.30）の
         あいだを取る。峰は厚く、刃先は薄く――比のほうが絶対値より効く。 */
      const g2 = new THREE.ExtrudeGeometry(bs, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.0035,
                                                 bevelSize: 0.0035, bevelSegments: 1, curveSegments: 10 });
      const pos2 = g2.attributes.position;
      const EDGE = -0.256, SPINE = 0.026, MID = 0.012;
      for (let i = 0; i < pos2.count; i++) {
        const x = pos2.getX(i);
        const t = Math.max(0, Math.min(1, (x - EDGE) / (SPINE - EDGE)));
        /* 【爪がいちばん薄くなってしまう】楔は「刃先へ行くほど薄い」式なので、
           刃の線（EDGE）より外にある爪は t=0 に丸まって最薄になる。
           実物の爪は**研いでいない厚い塊**なので、EDGE より外は厚みを戻す。
           ここの分岐は爪のためだけにある（EDGE より外の頂点は爪にしか無い）。 */
        const claw = Math.max(0, Math.min(1, (EDGE - x) / 0.030));
        const k = Math.min(1, 0.20 + 0.80 * t + 0.78 * claw);
        pos2.setZ(i, MID + (pos2.getZ(i) - MID) * k);
      }
      g2.computeVertexNormals();
      /* === 研ぎ面 ===
         【箱を面に載せてはいけない】研ぎ面をずっと rbox（角丸の箱）で作っていたが、
         幅を広げたとたん「黒い帯の上に鋸歯の明線が乗ったもの」になった。箱には側面が
         あるので、面に平置きすると側面が影になって黒い帯として残る。
         研ぎ面は**面そのものの明るさ**なので、頂点カラーで焼く。刃の輪郭が弧を描いていても
         刃**局所**の x を見るだけで自動的に縁へ沿う（箱では弧に沿わせられない）。
         ※ put() は行列を掛けたあとの座標で汚しを焼くので、そちらでは刃局所の x が取れない。
           ここで色を入れておくと put() 側は上書きしない（そういう分岐を足してある）。
         ※ 爪（x < EDGE）は研がないので暗いまま。実物の写真でも、明るい研ぎ面が
           爪の根本の壁でぴたりと終わり、爪だけが黒く残っている。 */
      {
        const pc = g2.attributes.position, cc = new Float32Array(pc.count * 3);
        for (let i = 0; i < pc.count; i++) {
          const x = pc.getX(i), y = pc.getY(i), z = pc.getZ(i);
          /* 錆の斑（put() の rust と同じ狙い。ここは刃局所なので模様が刃に固定される） */
          const n1 = Math.sin(x * 23 + 0.7) * Math.sin(y * 19 + 2.3) * Math.sin(z * 27 + 1.1);
          const n2 = Math.sin(x * 61 + 3.1) * Math.sin(y * 53 + 0.4) * Math.sin(z * 67 + 5.2);
          const mottle = 0.56 + 0.16 * (0.5 + 0.5 * (n1 * 0.72 + n2 * 0.28));
          /* 研ぎ面。刃の線から峰側へ 22% の帯だけ持ち上げる。
             広げすぎると暗所で刃が顔の紙と同格に光るので、上限を掛ける（HANDOFF 17章）。 */
          const t2 = Math.max(0, Math.min(1, (x - EDGE) / (SPINE - EDGE)));
          /* 帯の縁は smoothstep で立てる。線形の斜面だと「なんとなく明るい」で終わり、
             研ぎ面として読めない（実物は面が切り替わるので境がはっきり出る）。 */
          const u2 = Math.max(0, Math.min(1, 1 - t2 / 0.24));
          const bev = x < EDGE ? 0 : u2 * u2 * (3 - 2 * u2);
          const v = Math.min(1.55, mottle * (1 + 2.1 * bev));
          cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = v;
        }
        g2.setAttribute("color", new THREE.BufferAttribute(cc, 3));
      }
      /* ExtrudeGeometry の UV は形の実寸（m）そのままなので、倍率 1 だと
         テクスチャの左下 27% だけが刃全体に引き伸ばされ、斑が数個しか出ない。
         3 倍に詰めると錆の粒が 5cm 前後になり、刃渡り全体に散る。 */
      put(g2, cleaverM, { z: -0.012, pre: W, rust: true, uv: 3.0 });
    }
    /* 【爪の付け根に段差が見える】この峰のリブは刃より 5mm 厚いので、終端が必ず段になる。
       終端を爪の立ち上がり（-0.588）のすぐ手前に置いていたため、段差が
       「爪を別部品で付けた継ぎ目」に見えていた（agy）。爪から十分離した位置で終える。 */
    rbox(0.026, 0.416, 0.034, 0.005, cleaverM, { x: 0.014, y: -0.312, z: 0, pre: W, rust: true });   // 峰の厚み
    /* 刃先の明るい線は**腹の曲線の内側**に置く。直線の棒なので、曲線から
       はみ出さない範囲（腹がいちばん張り出す y=-0.30 のあたり）だけに限る。 */
    /* 研ぎ面は**懐で終わる**（爪は研がない）。実物の写真でも、明るい研ぎ面が
       切っ先まで届かず、爪の手前でぷつりと切れている。ここが「爪付き鉈」の見分けどころ。 */
    /* 研ぎ面は上のブロックで頂点カラーとして焼いた。ここに箱は置かない。 */
    /* 【穴が空いていなかった】決定稿の刃には切っ先寄りに丸い穴があり、
       これがこの得物の見分けどころになっている。ブーリアンは使えないので、
       ふちの輪の内側に**刃より暗い円盤**を落として穴として読ませる。 */
    tor(0.019, 0.005, cleaverM, { x: -0.118, y: -0.598, z: 0.0, pre: W, rust: true }, 12);  // 先端の穴のふち
    cyl(0.016, 0.016, 0.040, holeM, { x: -0.118, y: -0.598, z: 0.0, rx: Math.PI / 2, pre: W }, 14);  // 穴の闇
  }

  /* --- ここまでの部品を材質ごとに1メッシュへ統合する --- */
  // 頂点カラーの汚しは、統合したメッシュの材質すべてで有効にする
  for (const [mat, geos] of bucket) {
    mat.vertexColors = true;
    g.add(new THREE.Mesh(mergeGeometries(geos, false), mat));
  }

  /* === 顔＝紙の通知書プレート（+z 面）===
     ユーザー要望で「前の顔」（ホッケーマスク導入前のデザイン）に戻したまま、
     文言は「重加算税」（仮装・隠蔽への懲罰的な追徴税）。
     【v22で写真テクスチャから戻した】monster_face.jpg は解像度と陰影があるぶん
     「作り込んだ顔」に見えてしまい、この怪人の怖さの源――事務書類がそのまま顔に
     なっている無機質さ――が薄れた。
     【v25で MeshBasic をやめた】陰影を受けないので、頭に縛り付けた紙ではなく
     画面に貼った UI に見えていた。MeshStandard にして面の傾きぶんの陰影を戻しつつ、
     emissiveMap で「暗い部屋でも白く浮く」という v22 の意図は残す。 */
  const FW = 512, FH = 640;
  const fcv = document.createElement("canvas");
  fcv.width = FW; fcv.height = FH;
  const fc = fcv.getContext("2d");
  const rnd = (a, b) => a + Math.random() * (b - a);
  fc.fillStyle = "#e8e4d8"; fc.fillRect(0, 0, FW, FH);
  // 古紙のむら。単色の紙は「塗った板」に見えるので、薄い染みを散らして面に情報を足す
  for (let i = 0; i < 26; i++) {
    const x = rnd(0, FW), y = rnd(0, FH), r = rnd(18, 90);
    const gr = fc.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,132,96,${rnd(0.03, 0.09)})`);
    gr.addColorStop(1, "rgba(150,132,96,0)");
    fc.fillStyle = gr; fc.beginPath(); fc.arc(x, y, r, 0, 7); fc.fill();
  }
  fc.strokeStyle = "#555"; fc.lineWidth = 4; fc.strokeRect(20, 20, FW - 40, FH - 40);
  fc.lineWidth = 1.5; fc.strokeRect(30, 30, FW - 60, FH - 60);
  /* 見出し。内寸 448px。「HEAVY PENALTY」等は日本語より長いので fitFont で詰める。
     【小さすぎて何の紙か読めなかった】52px は紙の丈 640px の 8%、実寸では 2.9cm。
     4文字でも紙幅の 41% にしかならず、2m 離れると罫線と区別がつかない
     （agy「張り紙の文字情報が失われていて、顔の印象が別物になっている」）。
     参照の見出しは**紙幅いっぱいに1行**で入っていて、それがこの怪人の名札になっている。
     fitFont は上限幅に収まるまで縮めるので、基準を上げても溢れない。 */
  fc.fillStyle = "#222"; fc.textAlign = "center";
  fitFont(fc, tr("posterHeavy"), 448, 104, `px ${F_SERIF()}`, "bold ");
  fc.fillText(tr("posterHeavy"), FW / 2, 128);
  fc.strokeStyle = "#333"; fc.lineWidth = 2;
  fc.beginPath(); fc.moveTo(56, 156); fc.lineTo(FW - 56, 156); fc.stroke();
  // 明細の表。枠だけでなく、かすれた印字を灰色の帯で入れて「印刷物」にする
  // 見出しを大きくしたぶん行を1段減らして、紙の下端からはみ出さないようにする
  for (let r = 0; r < 5; r++) {
    const y = 178 + r * 78;
    fc.strokeStyle = "#8d8878"; fc.lineWidth = 2; fc.strokeRect(44, y, FW - 88, 66);
    fc.strokeStyle = "#b3ae9e"; fc.lineWidth = 1;
    fc.beginPath(); fc.moveTo(160, y); fc.lineTo(160, y + 66); fc.stroke();
    fc.fillStyle = "rgba(60,56,48,0.55)";
    fc.fillRect(58, y + 26, rnd(52, 92), 9);
    for (let c = 0; c < 3; c++) fc.fillRect(178 + c * 96, y + 26, rnd(40, 84), 9);
  }
  // 綴じ穴（左端）。紙であることが輪郭以外からも分かる
  for (const hy of [200, 440]) {
    fc.fillStyle = "#8a8474"; fc.beginPath(); fc.arc(36, hy, 11, 0, 7); fc.fill();
    fc.fillStyle = "#cdc7b6"; fc.beginPath(); fc.arc(36, hy - 2, 9, 0, 7); fc.fill();
  }
  // 朱印。文字を入れると charset とロケールに縛られるので、二重丸と放射線だけの意匠にする
  fc.save(); fc.translate(FW - 104, 236); fc.rotate(-0.22);
  fc.strokeStyle = "rgba(168,40,36,0.72)"; fc.lineWidth = 6;
  fc.beginPath(); fc.arc(0, 0, 52, 0, 7); fc.stroke();
  fc.lineWidth = 3; fc.beginPath(); fc.arc(0, 0, 40, 0, 7); fc.stroke();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    fc.beginPath(); fc.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
    fc.lineTo(Math.cos(a) * 36, Math.sin(a) * 36); fc.stroke();
  }
  fc.restore();
  // 目の穴。切り抜いた紙の縁がほつれて見えるよう、黒の周りに不定形の影を置く
  /* 【目が小さすぎた】参照の目の穴は紙の幅の 1/6（横 0.17・縦 0.11）もあり、
     2〜5m 離れた暗い部屋で「顔」として読めるのはこの2つの黒だけ。
     44×48px では紙の模様に紛れて、白い板にしか見えなかった。 */
  for (const ex of [116, 316]) {
    fc.fillStyle = "rgba(20,18,14,0.30)";
    fc.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = i / 12 * Math.PI * 2, rr = 1 + Math.random() * 0.28;
      const px = ex + 40 + Math.cos(a) * 58 * rr, py = 267 + Math.sin(a) * 40 * rr;
      i ? fc.lineTo(px, py) : fc.moveTo(px, py);
    }
    fc.closePath(); fc.fill();
    /* 【目が小さすぎて読めない】80×64px は紙の幅の 16% しかなく、2〜5m 先では
       ただの汚れに見える。参照では目の穴が顔の主役で、紙の幅の 1/4 を占める。
       このキャラは暗闇でここだけが情報になるので、大きく取る。 */
    fc.fillStyle = "#0a0908"; fc.fillRect(ex - 8, 222, 124, 96);
  }
  // 折り目。縦の谷と山を1本ずつ入れる（法線を作らずに影だけで折れを示す）
  fc.fillStyle = "rgba(90,84,68,0.16)"; fc.fillRect(FW / 2 - 3, 30, 3, FH - 60);
  fc.fillStyle = "rgba(255,252,242,0.35)"; fc.fillRect(FW / 2, 30, 3, FH - 60);
  /* 【綺麗な紙は怖くない】ここまでの描画は「刷りたての通知書」で、白く整っていた。
     縁から内へ向かって血と泥の色で沈ませ、擦れと破れを足す。中央（見出しと目）は
     読めるまま残す――暗い部屋で情報として機能しているのはそこだけなので、
     汚しは輪郭側にだけ寄せる。 */
  const grime = fc.createRadialGradient(FW / 2, FH * 0.44, FW * 0.22, FW / 2, FH * 0.5, FW * 0.78);
  grime.addColorStop(0, "rgba(38,26,16,0)");
  grime.addColorStop(0.55, "rgba(38,26,16,0.30)");
  grime.addColorStop(1, "rgba(24,14,8,0.78)");
  fc.fillStyle = grime; fc.fillRect(0, 0, FW, FH);
  for (let i = 0; i < 14; i++) {                     // 錆色の染み（乾いた血のつもり）
    const x = rnd(0, FW), y = rnd(0, FH), r = rnd(14, 58);
    const st = fc.createRadialGradient(x, y, 0, x, y, r);
    st.addColorStop(0, `rgba(86,32,20,${rnd(0.10, 0.32)})`);
    st.addColorStop(1, "rgba(86,32,20,0)");
    fc.fillStyle = st; fc.beginPath(); fc.arc(x, y, r, 0, 7); fc.fill();
  }
  fc.strokeStyle = "rgba(30,22,14,0.5)"; fc.lineWidth = 2;   // 擦れた折り筋
  for (let i = 0; i < 7; i++) {
    fc.beginPath();
    let x = rnd(0, FW), y = rnd(0, FH);
    fc.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += rnd(-70, 70); y += rnd(-60, 60); fc.lineTo(x, y); }
    fc.stroke();
  }
  /* 目の穴のアルファ。紙の形はそのまま、目の位置だけ黒＝透明にする。
     face テクスチャの目の矩形（ex,235,80,64）と同じ座標で抜く。 */
  const acv2 = document.createElement("canvas");
  acv2.width = FW; acv2.height = FH;
  const ac2 = acv2.getContext("2d");
  /* 【硬い板に見えていた】紙の輪郭が定規で切った長方形のままだった。
     紙らしさを決めるのは面ではなく**縁**で、縁が直線であるかぎり
     プラスチックの札にしか見えない（agy が4回続けて指摘）。
     上端は紐で頭に留まっているのでほぼ直線、横と下は千切れて不揃いにする。 */
  ac2.fillStyle = "#000"; ac2.fillRect(0, 0, FW, FH);
  ac2.fillStyle = "#fff";
  {
    const N = 16;
    ac2.beginPath();
    for (let k = 0; k <= N; k++) ac2.lineTo((FW * k) / N, rnd(2, 9));            // 上端（留めてある）
    for (let k = 0; k <= N; k++) ac2.lineTo(FW - rnd(3, 26), (FH * k) / N);      // 右の縁
    /* 丈を 0.282 → 0.360 に伸ばしたので、同じ 42px の振れが 2.4cm の鋸歯になり、
       17 点の折れ線がそのまま「櫛の歯」として見えていた。振れを実寸で揃える。 */
    for (let k = N; k >= 0; k--) ac2.lineTo((FW * k) / N, FH - rnd(4, 20));      // 裾（いちばん裂ける）
    for (let k = N; k >= 0; k--) ac2.lineTo(rnd(3, 26), (FH * k) / N);           // 左の縁
    ac2.closePath(); ac2.fill();
    // 縁から食い込む小さな裂け目。輪郭のギザギザだけでは「切り抜き」に見える
    ac2.fillStyle = "#000";
    for (let k = 0; k < 9; k++) {
      const side = k % 2 ? FW - rnd(0, 18) : rnd(0, 18);
      ac2.beginPath();
      ac2.ellipse(side, rnd(FH * 0.15, FH * 0.95), rnd(6, 22), rnd(3, 9), rnd(0, 3), 0, 7);
      ac2.fill();
    }
    ac2.fillStyle = "#000";
  }
  /* 目の穴も、定規で切った長方形では紙に見えない。指で破った穴は縁がぼろつく。 */
  for (const ex of [116, 316]) {
    const x0 = ex - 2, y0 = 228, w0 = 112, h0 = 84;
    ac2.beginPath();
    /* ±7px では 112×84 の穴に対して 6% しか揺れず、まだ定規で切った窓に見えた。
       指で破いた穴は、辺ごとに大きく食い違う。 */
    for (let k = 0; k <= 6; k++) ac2.lineTo(x0 + (w0 * k) / 6 + rnd(-6, 6), y0 + rnd(-15, 13));
    for (let k = 0; k <= 5; k++) ac2.lineTo(x0 + w0 + rnd(-16, 12), y0 + (h0 * k) / 5 + rnd(-5, 5));
    for (let k = 6; k >= 0; k--) ac2.lineTo(x0 + (w0 * k) / 6 + rnd(-6, 6), y0 + h0 + rnd(-13, 15));
    for (let k = 5; k >= 0; k--) ac2.lineTo(x0 + rnd(-12, 16), y0 + (h0 * k) / 5 + rnd(-5, 5));
    ac2.closePath(); ac2.fill();
  }
  const faceAlpha = new THREE.CanvasTexture(acv2);
  const faceTex = new THREE.CanvasTexture(fcv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = MAXANISO;
  /* 紙を頭に「巻き付ける」。v25 の最初の2稿は平面を頭の前に置いただけで、
     紙の端と頭の表面が横で 10cm も離れ、顔ではなく**手前に掲げた看板**に見えていた。
     ・横方向は弧長を保って円筒に巻く（θ = x / FR）。伸ばして貼るのではなく、
       実際の紙のように曲げるので、印字の間隔が端で詰まらない。
     ・縦方向は巻かない。1枚の紙は縦横同時には曲がらず、上下の端が浮いて反る。
       この「反り」があるかどうかが、紙に見えるか板に見えるかの分かれ目になる。
     ・上端の角は少し内へ寄せる。真四角だと後ろから見たとき頭の輪郭の外に
       白い角が2つ飛び出して、耳のように見えてしまう。 */
  /* 【紙は頭を覆うのではなく、頭に留めて顎の下へ垂らす】
     丈 0.322 を頭の中心に置くと頭が完全に隠れ、正面から見て**紙の提灯**になった。
     かといって 0.24 まで詰めると、今度は輪郭の上から 0.25 の帯で参照より 0.17 も
     薄くなる――参照では紙がそこにまだ在るからで、実際 concept4 の紙は
     頭より縦に長く、顎の下まで垂れ下がっている。
     正しいのは「短くする」ではなく「**下げる**」。上端を頭の上寄りで留めて
     下へ 0.36 垂らせば、頭頂の丸みは紙の上に残り、下は胸元まで届く。 */
  /* 【紙は頭とほぼ同じ丈】参照を測ると紙は幅 0.265・高さ 0.354 で、頭（高さ 0.35）と
     ほとんど同じ。上端は頭頂のすぐ下、下端は顎より下に垂れる。前の版は
     中心を頭より 9.3cm 下げていたので、上端が目の高さまで落ちて
     「額の見えた覆面」になり、決定稿の「頭に貼った1枚の紙」から離れていた。 */
  /* 丈は 0.372 → 0.298。背骨を弧にして頭を 3cm 下げたことで、同じ丈のままだと
     紙の下端が胸の高さまで垂れ、輪郭の上から 0.30 の帯で参照より 0.17 も前へ出ていた。
     参照では紙の下端は顎のすぐ下で終わる。 */
  /* 巻き付け半径 0.170 は頭の表面（奥行き半径 0.132）より 3.8cm 外側で、
     紙が顔から浮いて空中に貼ってあるように見えていた（agy）。
     1.4cm の隙間まで詰めると、頭に密着した紙として読める。 */
  /* 紙は頭より小さく。幅 0.250 < 頭の幅 0.291、丈 0.262 < 頭の高さ 0.360。
     巻き付け半径は頭の表面（奥行き 0.158）のすぐ外側 0.172。 */
  /* 頭を大きくしたあと紙を 0.250 まで詰めたら、今度は顔の中央の小さな札になった。
     参照の紙は**顔面をほぼ覆う**大きさで、頭の輪郭がその外周にわずかに見える程度。
     頭の幅 0.291 に対して 0.278（96%）、高さ 0.360 に対して 0.300（83%）が適正。 */
  /* 【顎の下で紙が終わっていた】側面（2時方向）の輪郭を参照と突き合わせると、
     上から 0.25 の帯だけが飛び抜けて薄かった（参照 0.568 に対して 0.400）。
     この帯は**顎の下**で、参照ではそこにまだ紙が在る。決定稿の紙は頭に縄で留めて
     顎より下まで垂れ、下端は体から離れて前へ反っている。丈が足りないだけでなく、
     下端まで頭の丸みに沿わせていたのが原因で、紙が「顔に貼った札」で終わっていた。
     上端（頭頂のすぐ下 y=1.589）は動かさず、下だけ伸ばして前へ逃がす。 */
  /* 【頭が紙を突き抜けた】縁の浮きを詰めようと FR を 0.164 → 0.156 まで下げたが、
     頭の半奥行きは 0.158。**紙の中心が頭の面より 2mm 奥**に入り、顔の真ん中に
     黒い頭が露出して、目の穴と繋がった大きな黒い染みになった。
     FR は「頭の表面のすぐ外」以外に置けない。縁の浮きは FR ではなく
     **紙の幅と巻きの深さ**で詰めるしかない（幅 0.272 → 0.258、BEND 0.34 → 0.29 で
     縁の浮きは 8.0cm → 5.9cm）。 */
  const FR = 0.168, FPW = 0.258, FPH = 0.360;    // 巻き付ける半径・紙の幅・高さ
  const fgeo = new THREE.PlaneGeometry(FPW, FPH, 20, 16);
  const fp = fgeo.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), y = fp.getY(i);
    const v = y / (FPH / 2);
    /* 【バケツに見えていた】半径 FR=0.17 で巻くと、幅 0.30 の紙が 100 度も回り込み、
       円筒（バケツ・ランプシェード）になる（agy が4回すべてで指摘）。
       実際の紙は頭に当たって**ゆるく反る**だけで、ほとんど平らのまま。
       曲げの半径を 0.44 に落とすと回り込みは 39 度で済み、平らな紙に見える。
       ただし紙の位置は頭の前（半径 FR）に置きたいので、曲げの中心をずらして
       弧の中央が z=FR に来るよう補正する。 */
    /* 0.17 では幅 0.30 の紙が 100 度回り込んでバケツになり、0.44 では逆に
       ほとんど平らな板になって「顔に紐で縛った紙」ではなく「顔の前にかざした札」に
       見えていた（agy「お面が顔面から完全に離れて空中に浮いている」）。
       0.28 なら回り込みは片側 28 度・両側で 57 度。頭の丸みに乗りつつ筒にはならない。 */
    /* 0.28 まで巻いたら今度は「顔の前にはめた硬い筒状のカバー」になった（agy）。
       紙は頭の丸みに触れて反る程度でよい。0.34（片側 24 度）が、
       平らな札にも筒にもならない幅。 */
    /* 【縁が顔から 8cm 浮いていた】幅 0.272 の紙を半径 0.34 で曲げると、
       端（x=±0.136）での紙の z は 0.137。ところが頭は sx=0.92 で横に細いので、
       その x での頭の表面は z=0.055 しかない。**紙の左右の端だけが 8cm 前に残る**ので、
       横から見ると顔の前に板を掲げているように見える（agy「完全に平らな板が
       顔の前に空間を空けて浮いている」）。0.28 まで巻くと筒になるので、
       0.34 → 0.29 と、巻き付け半径 FR の 0.8cm ぶんを両方から詰める。 */
    /* 0.29 でもまだ「完全に真っ平らな板」と言われた（agy 2回）。0.28 は過去に
       「顔の前にはめた硬い筒状のカバー」と言われた値なので、そこには戻さず
       0.26 まで。片側の回り込みは 24 度 → 28 度。 */
    const BEND = 0.26;                                     // 紙の曲がりの半径（大きいほど平ら）
    /* 顎から下は頭に触れていないので、紙が自重で少し開く。上は絞り、下は広げる。 */
    const th = (x / BEND) * (1 - 0.10 * Math.max(0, v) + 0.12 * Math.max(0, -v - 0.30));
    const lift = 0.012 * v * v;                            // 上下の端が浮いて反る
    /* 【上端は頭の丸みに沿わせる】巻き付け半径を一定にすると、頭が細くなる頭頂側で
       紙だけが半径 0.17 のまま張り出し、横から見て頭の前に**白い庇**が突き出した。
       上へ行くほど半径を絞れば、紙は頭の卵形に沿って留まる。下側は顎から離れて
       垂れ下がっている布なので、絞らずそのまま落とす。 */
    const pinch = 1 - 0.26 * Math.max(0, v) ** 2;          // 上端は頭の丸みに沿わせる
    /* 【下端まで頭に沿わせない】pinch は上端だけを絞る式で、下端は半径 FR のまま
       頭の面に貼り付いていた。顎より下に頭は無いので、そこは紙が宙に垂れて
       前へ反る。反りが無いと、紙は「顔の大きさで切った札」にしか見えない。
       ※ 0.148（下端で 7.7cm）まで出したら、紙が水平近くまで反り返って
         **開いた巻物**になった。参照の紙はほぼ鉛直に垂れて、下端がわずかに
         外へ返るだけ。効き始めを顎の下まで下げ、量も半分に落とす。 */
    const hang = 0.062 * Math.max(0, -v - 0.44) ** 2;      // 顎より下は体から離れて前へ反る
    /* 【面が完全に滑らかだった】紙は必ず折れ皺と波を持っている。頂点は 21×17 あるので、
       周期の違う波を重ねて面を数ミリ押し引きするだけで、光の当たり方が場所ごとに
       変わり、「印刷した板」から「一度くしゃっとした紙」になる。
       振幅は 5mm ――これ以上入れるとアルミホイルになる。 */
    const crin = 0.0052 * (Math.sin(x * 46 + y * 17 + 0.6) * Math.sin(y * 38 - x * 11 + 2.2)
                         + 0.55 * Math.sin(x * 79 - y * 53 + 4.1));
    /* 【紐が「紙の上に置いてある」だけだった】参照では、縄で強く縛ってあるので
       紐の高さで紙が一度へこみ、その上下が膨らんでいる。この凹みが無いと、
       紐は紙に触れずに前を通る輪にしか見えない（agy「紐で強く縛られたことによる
       紙の深いシワが表現されていない」）。縄は紙の局所 y=+0.113（v≒0.63）を通る。 */
    /* ※ 0.011（1.1cm）では紙が平らなままに見えた（agy「紐が紙の上を真っ直ぐ
       通っているだけで、紙が変形していない」）。縄の直径は 1.8cm あるので、
       その半分ぶんは沈んでよい。帯も狭めて、折れ目として読ませる。 */
    const cinch = 0.022 * Math.exp(-(((v - 0.63) / 0.085) ** 2));
    const zc = Math.cos(th) * BEND - BEND + FR * pinch + lift + crin + hang - cinch;
    fp.setXYZ(i, Math.sin(th) * BEND, y, zc);
  }
  fgeo.computeVertexNormals();
  const face = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({
    map: faceTex, roughness: 0.94, metalness: 0,
    /* 紙も単色の面だった。段ボールの法線を細かく敷くと繊維と折れの陰影が出て、
       「印刷した板」ではなく紙に見える。強さは 0.45――紙は布ほど荒れていない。 */
    normalMap: loadTex("./assets/textures/cardboard001_normal.webp", false, 3, 3),
    normalScale: new THREE.Vector2(0.45, 0.45),
    /* 【目が黒く塗ってあるだけだった】穴として抜けていないので、暗所では
       「黒い四角を印刷した紙」に見え、覗き穴の奥行きが出ない（agy の指摘）。
       アルファで実際に抜くと、穴の向こうに頭の闇が見えて初めて目になる。 */
    alphaMap: faceAlpha, alphaTest: 0.5,
    // 「暗い部屋でも紙面が白く平坦に浮く」という v22 の狙いは emissive で残す。
    // ただし 0.42 では明るい場所で白飛びして、印字も折り目も全部消えていた。
    /* 【紙だけ白飛びしていた】0.11 でも、明るい場所では紙面が完全に飛んで
       印字も折り目も消え、周りの暗い体から浮いた発光板になっていた（agy）。
       暗所で顔を見失わないための下支えなので、効かせるのは最小限でよい。 */
    emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.02,
    /* 紙のテクスチャ自体がほぼ白なので、明るい場所では乗算しても飽和して
       印字が消える。生成りの色を掛けて、白飛びの手前に留める。 */
    color: 0xc8c2b4,
  }));
  /* 丈を 0.282 → 0.360 に伸ばしたぶん、中心を半分（3.9cm）下げて**上端を据え置く**。
     上端は頭頂のすぐ下（y≒1.589）＝縄で留めてある高さで、ここが動くと
     「額の見えた覆面」になる（v25 で一度やっている）。伸ばすのは下だけ。 */
  face.position.set(0, HEAD.y - 0.061, HEAD.z);   // 上端が頭頂のすぐ下・下端は顎より下へ垂れる
  face.rotation.x = 0.05;                  // わずかに見下ろす角度
  face.updateMatrix(); face.applyMatrix4(headM);   // 頭と同じだけ傾ける
  // ※ 紙の丈を頭の高さより短くしておくこと。はみ出すと背面から白い板として見える
  g.add(face);
  /* 紙の裏。DoubleSide で1枚に済ませると、横から見たとき**印字面と同じ白**が
     裏側にも出て、頭の横に明るい板が立っているように見える。実際の紙の裏は
     刷られていない鈍い生成りなので、裏面だけ別マテリアルで持つ。 */
  const faceBack = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({
    color: 0x484438, roughness: 1.0, metalness: 0, side: THREE.BackSide,
  }));
  faceBack.position.copy(face.position); faceBack.quaternion.copy(face.quaternion);
  g.add(faceBack);
  // 紙を留めているホチキス／画鋲。革ひもと合わせて「貼り付けてある」ことを示す。
  // 紙が円筒なので、留め具も同じ角度で法線方向へ向ける。
  const tack = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.010, 8), bladeM);
  for (const [tx, ty] of [[-0.076, 0.147], [0.076, 0.147]]) {   // 丈を伸ばしても留め具の絶対高さ(y≒1.556)は動かさない
    // 紙と同じ「上ほど絞る」半径に乗せる。定数 FR のままだと紙から浮いて宙に残る
    const rr = FR * (1 - 0.26 * (ty / (FPH / 2)) ** 2);
    const th = tx / FR, p = tack.clone();
    p.position.set(Math.sin(th) * rr, HEAD.y - 0.061 + ty, HEAD.z + Math.cos(th) * rr);
    p.rotation.set(Math.PI / 2, 0, 0); p.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), th);
    p.updateMatrix(); p.applyMatrix4(headM);
    g.add(p);
  }

  /* 【前傾したぶん全体を後ろへ寄せる】頭が原点より 76cm 前に出ているので、
     このまま出すと、当たり判定（原点基準の円柱）と見た目が大きくずれ、
     「頭を殴っているのに当たらない」「体をすり抜けた先で当たる」ことになる。
     質量の中心が原点近くへ来るよう、統合後のメッシュごと 32cm 後ろへ送る。
     ※ 統合メッシュは頂点に位置が焼き込まれているが、Mesh の position を動かせば
        まとめて平行移動できるので、頂点を触り直す必要はない。 */
  for (const c of g.children) c.position.z -= 0.27;

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
});
// 光源が出揃ったここで初めて画質を適用できる（applyQuality は光源を traverse する）。
applyQuality();
// 「訪問」のあいだだけ実在する
const WP = [[3.5,0.5],[0,-2.75],[-4.5,-3.5],[-1.75,0],[-5,3.5],[0,2.75],[3.5,4.5],[6.2,-4.0]];
const mob = { x: 0, z: 0, wp: 0, mode: "patrol", lostAt: 0, spokeAt: -99, stuck: 0, active: false,
               crumb: -1, freeze: 0,
               boost: 0, boostT: 0 };   // crumb = 追っているパンくずの通し番号（-1 は未追跡）
// boost = 追い続けて積み上がった加速ぶん（m/s）、boostT = その積算タイマー
function spawnMonster() {
  // プレイヤーから遠い候補の中からランダムに出現（毎回同じ場所からは出ない）
  const withD = WP.map((wp, i) => ({ i, wp, d: Math.hypot(wp[0]-ply.x, wp[1]-ply.z) }))
    .sort((a, b) => b.d - a.d);
  const pick = withD[Math.floor(Math.random() * Math.min(3, withD.length))];
  mob.x = pick.wp[0]; mob.z = pick.wp[1]; mob.wp = pick.i;
  mob.mode = "patrol"; mob.lostAt = 0; mob.stuck = 0; mob.active = true; mob.crumb = -1; mob.freeze = 0; mob.boost = 0; mob.boostT = 0;
  monster.visible = true;
  monster.position.set(mob.x, 0, mob.z);
  beep(85, 0.7, "sine", 0.16, 55);
  notice(tr("omenEntered"), 3.2);
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
  if (state === "INSPECT") { closeInspect(); subtitle(tr("omenLookedUp"), 1.8); }
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
  /* 次の訪問まで。白は従来どおり 18 + 乱数(0〜14) − 破棄ペナルティ。
     青は visitGap 3 + 乱数(0〜4) で、ゲーム内3〜7分（実時間で約5〜13秒）＝
     ほぼ常時いるが息継ぎはある、に寄せる。
     【下限を置く理由】破棄を重ねると aggro のぶん最大10分引かれるので、
     青の短い間隔では簡単に負になって「前触れが終わる前に次が始まる」状態になる。
     前触れ（9〜12秒）は青でも唯一の予告なので、必ず1回分は成立させる。 */
  const M = MODES[mode];
  visit.nextAt = gameMin + Math.max(2, M.visitGap - M.visitEarly + Math.random() * M.visitSpread - Math.min(M.aggroMax, aggro * M.aggroMul));
  restoreRoom();
  notice(tr("omenGone"), 2.6);
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
    // 絵文字（🔇🔈）は使わない。同梱フォント（Noto Sans/Serif JP・SC・Mono）は
    // どれも絵文字を持たず、Proton 環境には絵文字フォント自体が無いので豆腐になる。
    // 2字のために絵文字フォントを同梱する価値は無く、言葉で足りる（P2-7）。
    notice(m ? tr("muted") : tr("volumeAt", { pct: Math.round(audioPrefs.vol * 100) }), 1.4);
  }
  if (e.code === "Escape") {
    // 検分・e-Tax はそれぞれ閉じるのが先。何も開いていない PLAY 中だけポーズに入る。
    if (state === "INSPECT") bailInspect();   // Esc も「保留」と同じ扱い（抜け道にしない）
    else if (state === "ETAX") closeEtax();
    else if (state === "PAUSE") closePause();
    else if (state === "PLAY") openPause();
  }
});
addEventListener("keyup",   e => { keys[e.code] = false; });

/* pointer lock look */
/* 【閉じたら必ず掛け直す】v22 まで openInspect / openEtax / openPause / ending が
   exitPointerLock() を呼ぶのに、**掛け直す口はキャンバスの click と closePause しか
   無かった**。つまり書類の受理／破棄を押して検分ビューを閉じるたびに視点操作が死に、
   キャンバスをもう一度クリックするまで戻らない。検分はこのゲームのコアループそのもので
   1周に十数回通るので、「何か選択した前後でしっかり止まる」という体感の主因になっていた。
   閉じる処理はどれもクリックか Esc（＝ユーザー操作）から来るので、ここで requestPointerLock
   を呼ぶのは仕様上正当。 */
function relock() {
  if (isTouch || state !== "PLAY") return;
  if (document.pointerLockElement === renderer.domElement) return;
  // Chrome 111+ は Promise を返す。古い実装は undefined を返すので両方受ける。
  // 拒否は例外ではなく pointerlockerror なので、握り潰さず「クリックで復帰」を案内する
  // （Esc で解除した直後は約1.25秒ロックを受け付けない、というブラウザ側の連打防止がある）。
  const p = renderer.domElement.requestPointerLock();
  if (p && typeof p.catch === "function") p.catch(() => notice(tr("clickToLook"), 2.2));
}
addEventListener("pointerlockerror", () => {
  if (state === "PLAY" && !isTouch) notice(tr("clickToLook"), 2.2);
});
/* 【クリックでも調べる】タイトルのヘルプは v1 から「調べる：E またはクリック」と
   言っているが、実際にクリックを受けていたのは #prompt だけだった。ポインタロック中は
   カーソルが無くその要素をクリックできないので、**通常プレイ中はクリックが死んでいた**。
   ロックを持っていないクリックは「視点を掛け直す」ためのもの（clickToLook の案内）なので、
   そのクリックで手前のものを拾ってしまわないよう、掛け直しと interact は排他にする。 */
renderer.domElement.addEventListener("click", () => {
  if (state !== "PLAY" || isTouch) return;
  if (document.pointerLockElement === renderer.domElement) tryInteract();
  else renderer.domElement.requestPointerLock();
});
/** 視点の基準感度。v22までの実測値。save.sens はこれに対する百分率。 */
const LOOK_BASE = 0.0023;
const lookRate = () => LOOK_BASE * (save.sens / 100);
addEventListener("mousemove", e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const k = lookRate();
  ply.yaw   -= e.movementX * k;
  ply.pitch = Math.max(-1.2, Math.min(1.2, ply.pitch - e.movementY * k));
});

/* touch controls: dual fixed sticks (FPS style) */
// isTouch は画質プリセットの判定にも使うので、レンダラ生成より前（ファイル冒頭側）で宣言してある。
if (isTouch) document.body.classList.add("touch");
const stickMove = { x: 0, y: 0 };   // -1..1
const stickLook = { x: 0, y: 0 };   // -1..1 (rate)
function makeStick(el, out) {
  const knob = el.querySelector(".knob");
  let id = null;
  /* 【rect を毎 touchmove で取らない】getBoundingClientRect はレイアウトが汚れていれば
     強制リフローを起こす。touchmove は端末によって毎秒60〜120回飛び、しかもスティックは
     左右2本ある。スティックは画面に固定配置で、指を置いている間にサイズも位置も変わらない
     ので、touchstart で1回だけ測って、そのドラッグ中は使い回す。 */
  let rect = null;
  const update = (t) => {
    const r = rect || (rect = el.getBoundingClientRect());
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
    rect = null;   // このドラッグぶんの寸法をここで1回だけ測り直す
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
/* 【毎フレーム concat しない】hitsAny は moveCircle から呼ばれ、moveCircle は
   プレイヤー（毎フレーム最大2回）と怪人（アクティブ中は最大2回）から呼ばれる。
   v22 では**そのたびに walls.concat(solids) で新しい配列を作っていた**ので、
   怪人が出ている間は毎フレーム4本の配列がゴミになっていた。壁も家具も
   シーン構築中にしか push されない（実行時に増減しない）ので1回作れば足りる。
   念のため要素数が変わったら作り直す。 */
let blockers = null, blockersN = -1;
function allBlockers() {
  const n = walls.length + solids.length;
  if (blockers === null || n !== blockersN) { blockers = walls.concat(solids); blockersN = n; }
  return blockers;
}
function hitsAny(x, z, r) {
  for (const b of allBlockers()) {
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
/* ---------- パンくず：プレイヤーの足跡（v23で追加） ----------
   【なぜ要るか】怪人は経路探索を持たず、見失っている間もプレイヤーの**現在座標へ壁越しに
   直進**していた。部屋の中央には南北2箇所の開口を持つ間仕切り壁があり、プレイヤーは
   片方のドアから抜けてもう片方から戻る「壁を挟んだ周回」ができる。怪人は壁に貼り付いた
   まま追随できず、**周回しているだけで永久に振り切れた**（テストプレイの「部屋がぐるぐる
   回れちゃうから集められた」がこれ）。

   直進をやめて、プレイヤーが1m進むごとに置いた見えない足跡を古い順に辿らせる。
   足跡は必ず「実際に歩けた場所」なので、A* を書かずに角を曲がって追ってくるようになる。
   （追跡経路の方式としてパンくずを選んだのは、A* に比べて実装が小さく、かつ
     「怪人が匂いを辿っている」という見え方がホラーの様式にも合うため。）

   通し番号 n を持たせているのは、古いものを shift で捨てても怪人が追っている足跡を
   見失わないようにするため（配列の添字だと shift のたびに全部ずれる）。 */
const TRAIL_MAX = 40;          // 1m 刻みなので約40m ぶん。部屋の対角(約20m)の倍を持つ
const trail = [];              // { x, z, n } を古い順に
let trailN = 0, trailLastX = 0, trailLastZ = 0;
function trailPush() {
  if (trail.length && Math.hypot(ply.x - trailLastX, ply.z - trailLastZ) < 1.0) return;
  trailLastX = ply.x; trailLastZ = ply.z;
  trail.push({ x: ply.x, z: ply.z, n: trailN++ });
  if (trail.length > TRAIL_MAX) trail.shift();
}
/** 見失っている怪人が次に向かうべき足跡。無ければ null（＝プレイヤーへ直進に戻す）。 */
function trailTarget() {
  if (!trail.length) return null;
  let node = mob.crumb >= 0 ? trail.find(c => c.n === mob.crumb) : null;
  // まだ辿り始めていない／追っていた足跡が古くなって捨てられた場合は、
  // 自分に一番近い足跡＝プレイヤーの通り道が自分の近くをかすめた点から始める。
  if (!node) {
    let bd = Infinity;
    for (const c of trail) {
      const d = Math.hypot(c.x - mob.x, c.z - mob.z);
      if (d < bd) { bd = d; node = c; }
    }
  }
  // 足跡に着いたら、ひとつ新しい足跡へ進む（古い順に辿る＝プレイヤーの経路をなぞる）。
  while (node && Math.hypot(node.x - mob.x, node.z - mob.z) < 0.6) {
    const next = trail.find(c => c.n === node.n + 1);
    if (!next) { node = null; break; }   // 最新まで辿り着いた。あとは直進でよい
    node = next;
  }
  mob.crumb = node ? node.n : -1;
  return node;
}

/* ---------- 壁沿いのすべり（v23で追加） ----------
   怪人の移動は経路探索を持たない直線ステアリングで、衝突解決は moveCircle の
   「x を試す → z を試す」という軸別分離だけ。**斜めから角に入ると両軸とも弾かれて
   完全に停止する**（中央壁のドア開口は幅1.56mしかなく、家具のコライダーの角も同様）。
   これが「カクシン様がたまにスタックしてる」の正体で、v22 は復帰まで1.2秒その場で
   震えていた。

   ここでは、まっすぐ進めなかったときだけ進行方向の左右90度（＝壁に沿う向き）を試し、
   目標に近づくほうへ滑らせる。A* ではないので袋小路は抜けられないが、「角で止まる」
   という一番目につく破綻は消える。返り値は実際に動いた距離（呼び出し側の停滞判定用）。 */
function steer(o, dx, dz, r, tx, tz) {
  const ox = o.x, oz = o.z;
  const want = Math.hypot(dx, dz);
  moveCircle(o, dx, dz, r);
  let moved = Math.hypot(o.x - ox, o.z - oz);
  if (want < 1e-6 || moved > want * 0.5) return moved;
  // 接線は2つある（左90度と右90度）。目標に近づくほうから試す。
  const cands = [[-dz, dx], [dz, -dx]];
  const near = ([sx, sz]) => Math.hypot(ox + sx - tx, oz + sz - tz);
  if (near(cands[1]) < near(cands[0])) cands.reverse();
  for (const [sx, sz] of cands) {
    o.x = ox; o.z = oz;
    moveCircle(o, sx, sz, r);
    const m = Math.hypot(o.x - ox, o.z - oz);
    if (m > want * 0.5) return m;
  }
  // どちらの接線も塞がっていた。素直に進んだ結果（部分的にでも動けた分）に戻す。
  o.x = ox; o.z = oz;
  moveCircle(o, dx, dz, r);
  return moved;
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
/* 【背景は1回だけ焼く】ミニマップは毎フレーム描き直されるが、床・家具・壁は
   ゲーム中いっさい動かない。v22 では毎フレーム solids と walls を全部なめて
   fillRect し、そのたびに mmPos が座標ペアの配列を2本ずつ返していた（＝壁と家具の
   件数×2 のゴミが毎フレーム）。静的な層をオフスクリーンに1枚焼いて、毎フレームは
   その1枚を drawImage して動く2点（怪人・プレイヤー）だけ描く。 */
let mmBase = null;
function bakeMinimapBase() {
  const w = mmCanvas.width, h = mmCanvas.height;
  mmBase = document.createElement("canvas");
  mmBase.width = w; mmBase.height = h;
  const ctx = mmBase.getContext("2d");
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
}
function drawMinimap() {
  const ctx = mmCtx, w = mmCanvas.width, h = mmCanvas.height;
  if (!mmBase) bakeMinimapBase();
  ctx.drawImage(mmBase, 0, 0);
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
/* 【配列を作って sort しない】毎フレーム呼ばれる。v22 では候補オブジェクトの配列を
   組んでから sort していたが、欲しいのは最短の1件だけ。候補は最大でもアイテム5＋
   フェイク3＋机＋クローゼットの10件なので、線形に最小を取るほうが速いうえ、
   毎フレームのゴミが1オブジェクト（返り値）だけで済む。 */
function findNear() {
  if (ply.hidden) return { kind: "closet" };
  let best = null, bestD = Infinity;
  const keep = (d, obj) => { if (d < bestD) { bestD = d; best = obj; } };
  for (const it of ITEMS) {
    if (it.taken) continue;
    const d = Math.hypot(ply.x - it.x, ply.z - it.z);
    if (d < 1.45) keep(d, { d, kind: "item", ref: it });
  }
  FAKES.forEach((f, idx) => {
    if (f.taken) return;
    const d = Math.hypot(ply.x - f.x, ply.z - f.z);
    if (d < 1.45) keep(d, { d, kind: "fake", ref: f, idx });
  });
  const dd = Math.hypot(ply.x - 6.5, ply.z - (-2.0));
  if (dd < 1.6) keep(dd, { d: dd, kind: "desk" });
  const dc = Math.hypot(ply.x - CLOSET.x, ply.z - CLOSET.z);
  if (dc < 1.25) keep(dc, { d: dc, kind: "closet" });
  return best;
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
        notice(tr("seen"), 2.2);
        return;
      }
      ply.hidden = true;
      $("hideOv").style.display = "block";
      beep(140, 0.18, "sine", 0.1);
    }
    return;
  }
  if (nearTarget.kind === "item") {
    if (mob.active && mob.mode === "chase") { subtitle(tr("tooBusy"), 1.6); return; }
    openInspect(nearTarget.ref);
  } else if (nearTarget.kind === "fake") {
    const f = nearTarget.ref;
    f.taken = true;
    showGlow(fakeMeshes[nearTarget.idx], false);   // scene.remove は光源の本数を変える（showGlow のコメント参照）
    // 手掛かりを仕込んで2行になったので、既定の3.6秒では読み切れない
    notice(tr(f.gagKey), 6.4);
    beep(240, 0.3, "sawtooth", 0.08, 120);
  } else if (nearTarget.kind === "desk") {
    if (got < 5) {
      notice(tr("noticeNotEnough", { got }));
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
  relock();   // 掛け直さないと視点操作が死んだままになる（relock のコメント参照）
}
$("btnTake").addEventListener("click", () => {
  if (!inspectIt) return;
  const it = inspectIt;
  runLog.push({ short: it.short, fake: it.copy.fake,
    anomId: it.copy.anomId,
    act: "take", ok: !it.copy.fake, revealed: false });
  it.taken = true; got++;
  showGlow(itemMeshes[it.id], false);
  refreshSlots();
  notice(tr(it.gagKey), 6.4);   // マイナ・メモは手掛かりで2行になっている（上記 FAKES と同じ理由）
  beep(880, 0.1, "triangle", 0.12); beep(1180, 0.14, "triangle", 0.1);
  closeInspect();
});
$("btnTear").addEventListener("click", () => {
  if (!inspectIt) return;
  const it = inspectIt;
  runLog.push({ short: it.short, fake: it.copy.fake,
    anomId: it.copy.anomId,
    act: "tear", ok: it.copy.fake, revealed: it.copy.fake });
  if (it.copy.fake) registerFound(it.copy.anomId);
  aggro++;
  if (!it.copy.fake) tearGenuine++;
  it.copy = makeCopy(it, MODES[mode].rp);   // 新しい一枚が湧く（また偽物かもしれない）
  relocateItem(it);
  beep(1600, 0.16, "sawtooth", 0.05, 320); beep(120, 0.2, "sine", 0.08);
  notice(tr("noticeTorn"), 3);
  closeInspect();
});
/* 「保留」＝判断から降りる（v24）。怪人が来たときに検分を中断して逃げる手段は残す。
   ただしタダではない: **その一枚は手を離れ、部屋のどこかへ湧き直す**（破棄と同じ
   relocate。ただし aggro も還付ペナルティも図鑑登録も無い。払うのは探し直す時間だけ）。
   複製も引き直すので「保留して開き直して見比べる」も成立しない。
   怪人の出現でこちらの都合と関係なく閉じられる場合（enterVisit / 発見時）は、
   プレイヤーが選んだ結果ではないので relocate しない。 */
function bailInspect() {
  if (!inspectIt) return;
  const it = inspectIt;
  it.copy = makeCopy(it, MODES[mode].rp);
  relocateItem(it);
  beep(300, 0.1, "triangle", 0.05);
  notice(tr("noticeBailed"), 3);
  closeInspect();
}
$("btnBack").addEventListener("click", bailInspect);

/* ---------- e-Tax sequence（審査＝真贋の清算） ---------- */
let etaxTimer = 0;
// マイナンバーカード暗証番号の認証ゲート。
// 【生成場所が重要】openEtax() の中で作らない（W-03）。ウィンドウを閉じて開き直しても
// 試行回数（残り3回）が保持されるようにするため、モジュールのトップレベルで1つだけ作る。
// 正解と最大試行回数はここでだけ注入する（pin.js には書かない＝A-1, A-7）。
// 正解は「その国の申告期限を、その国の書き順で書いたもの」（L-30）。
// 日本 0315 / 米国 0415 / 中国 0630 / ロシア 3004 / スペイン 3006。
// anoms.js も正解文字列そのものは持たない（L-34c）ので、ここで組み立てる。
// セーブには残さない（1プレイ限り＝A-14。save 側に暗証番号関連のキーは追加しない）。
function pinAnswerFor(locale) {
  const d = deadline(locale);
  const pad = (n) => String(n).padStart(2, "0");
  return d.order === "MD" ? pad(d.month) + pad(d.day) : pad(d.day) + pad(d.month);
}
const pin = createPinGate({ answer: pinAnswerFor(LOCALE), maxAttempts: 3 });

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
    $("etaxMsg").textContent = tr("cardLocked");
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
    $("etaxMsg").textContent = st.attemptsUsed > 0 ? tr("pinAttemptsLeft", { n: st.attemptsLeft }) : "";
  }
  updateEtaxBtnState();
  $("etax").classList.remove("hidden");
  document.exitPointerLock && document.exitPointerLock();
}
function closeEtax() {
  if (state !== "ETAX") return;
  $("etax").classList.add("hidden");
  state = "PLAY";
  relock();   // closeInspect と同じ理由
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
      let html = tr("pinWrong", { n: r.attemptsLeft });
      if (r.finalWarning) {
        // 2回目のミス＝最終警告。既存の却下と同じ escalation（怪人を呼ぶ）に加え、
        // メモの手掛かりを再提示する。『いつもの』だけでは名前に結びつかないため、
        // 申告書の氏名欄（PLAYER_NAME）を引用して一歩踏み込む（答え0315そのものは書かない）。
        html += tr("pinLastChance") + pinHint(LOCALE);
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
        msg.innerHTML = tr("pinLocked");
        pinInput.disabled = true;
        btn.disabled = true;
        setTimeout(() => ending("shiyakusho"), 2200);
      }
      return;
    } else {
      // invalid（送信ボタンは4桁揃うまで無効なので、通常の操作では到達しない）
      msg.textContent = tr("pinFormat");
      updateEtaxBtnState();
      return;
    }
  }

  btn.disabled = true;
  msg.classList.remove("ok");
  msg.textContent = tr("etaxSending");
  setTimeout(() => {
    const bad = ITEMS.find(it => it.taken && it.copy.fake);
    if (bad) {
      etaxRejects++; aggro++;
      const why = anomReject(bad.copy.anomId);
      const entry = [...runLog].reverse().find(e =>
        e.short === bad.short && e.fake && e.act === "take" && !e.revealed);
      if (entry) entry.revealed = true;
      registerFound(bad.copy.anomId);
      bad.taken = false; got--;
      bad.copy = { fake: false, anom: null };  // 差し戻しの再交付は本物（終盤の救済）
      relocateItem(bad);
      refreshSlots();
      msg.innerHTML = tr("etaxRejected", { doc: bad.short, why });
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
      msg.textContent = tr("etaxAccepted", { receipt: "20260315230000000001" });
      beep(660, 0.4, "sine", 0.12); beep(830, 0.4, "sine", 0.1); beep(990, 0.6, "sine", 0.1);
      setTimeout(() => ending("refund"), 2200);
    }
  }, 1400 + Math.random() * 600);
});

/* ---------- endings ---------- */
const EDS = {
  refund: { tag: "endRefundTag", text: "endRefundText", money: 34120 },
  late:   { tag: "endLateTag", text: "endLateText" },
  sermon: { tag: "endSermonTag", text: "endSermonText" },
  // 暗証番号を3回間違えてカードがロックされた失敗系エンディング（sermon と同様、ランク計算には関与しない・何も解禁しない）
  shiyakusho: { tag: "endCityTag", text: "endCityText" },
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
    // 還付額は走行ごとに変わる。文言そのものを組み立てず、金額と後書きだけ差し替える
    //（文言を上書きすると、翻訳ではなく日本語がそのまま残ってしまう）。
    EDS.refund.money = yen;
    EDS.refund.suffix = pen === 0
      ? `<br><span style="font-size:.82em;opacity:.75">${tr("rankPerfect")}</span>`
      : `<br><span style="font-size:.82em;opacity:.75">${tr("rankMistakes", { rejects: etaxRejects, torn: tearGenuine })}</span>`;
    const mistakes = etaxRejects + tearGenuine;
    const left = 23 * 60 + 59 - gameMin;
    const rk = mistakes === 0 ? (left >= 60 ? tr("rankS") : tr("rankA"))
             : mistakes <= 1 ? tr("rankB")
             : mistakes <= 3 ? tr("rankC") : tr("rankD");
    rankLine = tr("rankLine", { blue: mode === "blue" ? tr("blueTag") : "", rank: rk });
    const RORDER = ["S", "A", "B", "C", "D"];
    if (!save.bestRank || RORDER.indexOf(rk[0]) < RORDER.indexOf(save.bestRank))
      save.bestRank = rk[0];
  }
  // 答え合わせ＋図鑑
  const rows = runLog.map(e => {
    const truth = e.fake ? (e.revealed ? tr("resultFake", { anom: anomName(e.anomId) }) : tr("resultFakeUnknown")) : tr("resultGenuine");
    return `<div class="rrow ${e.ok ? "rok" : "rng"}"><span>${e.short}</span><span>${truth} → ${e.act === "take" ? tr("actTake") : tr("actTear")}</span><span>${e.ok ? "○" : "×"}</span></div>`;
  }).join("");
  save.endings[key] = true; save.runs++;
  persistSave();
  const foundN = Object.keys(save.found).length;
  const newTxt = newFound.length
    ? `<br><span class="new">NEW　${newFound.map(anomName).join("・")}</span>` : "";
  $("recap").innerHTML =
    (runLog.length ? `<div class="rhead">${tr("resultHead")}</div>${rows}` : "") +
    `<div class="zukan">${tr("codex", { found: foundN, total: ANOM_IDS.length })}${newTxt}</div>` +
    (rankLine ? `<div class="zukan">${rankLine}</div>` : "") +
    (firstRefund ? `<div class="zukan new">${tr("blueUnlocked")}</div>` : "");
  $("etax").classList.add("hidden");
  $("inspect").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("vignette").style.opacity = 0;
  // EDS はキーだけを持つ。文言と金額はロケールから引く
  //（還付額を文言に直書きすると、通貨記号も桁区切りも日本のままになる）。
  const ed = EDS[key];
  $("edTag").textContent = tr(ed.tag);
  $("edText").innerHTML =
    (ed.money === undefined ? tr(ed.text) : tr(ed.text, { money: formatMoney(LOCALE, ed.money) })) +
    (ed.suffix || "");
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
    steer(mob, (EXIT_POS.x-mob.x)/d * sp * dt, (EXIT_POS.z-mob.z)/d * sp * dt, 0.4, EXIT_POS.x, EXIT_POS.z);
  } else if (mob.mode === "patrol") {
    visit.huntLeft -= dt;
    if (visit.huntLeft <= 0) {
      mob.mode = "leave"; visit.leaveT = 0;
    } else if (canSee) {
      mob.mode = "chase";
      /* ---------- 「見つかった」瞬間の演出（v23で追加） ----------
         【なぜ要るか】これまで発見の瞬間は明示されず、心音が速まったことで事後的に
         気づくしかなかった。白は怪人のほうが遅いのでそれでも成立していたが、青は
         怪人のほうが速い（4.0 vs 3.6）ので、**逃げる判断と方向転換の猶予が無いと
         ただの理不尽**になる。発見と同時に怪人を 0.7秒その場に止め、鋭い音を立てる。
         この 0.7秒がプレイヤーの反応時間そのものになる。
         白は freeze: 0 なので、この節は青でしか動かない（白は一切変えない方針）。 */
      mob.boost = 0; mob.boostT = 0;   // 加速は「この追跡で追われ続けた時間」だけを表す
      const fz = MODES[mode].freeze;
      if (fz > 0) {
        mob.freeze = fz;
        // 足音の帯域（120Hz中心の低い破裂）とは重ならない高い帯域で、下降させて「気づかれた」を作る。
        beep(2400, 0.18, "sawtooth", 0.09, 900);
        beep(160, 0.5, "sine", 0.13, 70);
      }
      if (state === "INSPECT") { closeInspect(); subtitle(tr("omenThere"), 2.2); }
      const now = performance.now()/1000;
      if (now - mob.spokeAt > 10) {
        mob.spokeAt = now;
        subtitle(tr("monsterLine"), 3);
        speak(tr("monsterLineBare"));
        beep(48, 1.2, "sine", 0.22, 36);
      }
    } else {
      const [tx, tz] = WP[mob.wp];
      const d = Math.hypot(tx - mob.x, tz - mob.z);
      if (d < 0.45) mob.wp = (mob.wp + 1) % WP.length;
      else {
        const moved = steer(mob, (tx-mob.x)/d * sp * dt, (tz-mob.z)/d * sp * dt, 0.4, tx, tz);
        if (moved < sp*dt*0.15) mob.wp = (mob.wp + 1) % WP.length;
      }
    }
  } else { // chase
    /* 追跡速度。初速は白青とも従来の「巡回×1.2」（21時台1.26〜23時台2.76）。
       青だけ、追い続けている間に少しずつ速くなって cap(4.0) で頭打ちになる。
       【なぜ最初から4.0にしないか】いきなりプレイヤー(3.6)より速いと、見つかった時点で
       ほぼ確定死になり「油断した自分が悪い」の納得感が出ない。追われた時間そのものを
       圧力に変えると、逃げ切れはするが**逃げ続けることはできない**——だから
       「どこかで視線を切る」という判断が要る遊びになる。 */
    sp *= 1.2;
    const acc = MODES[mode].chaseAccel;
    if (acc) {
      mob.boostT += dt;
      while (mob.boostT >= acc.every) { mob.boostT -= acc.every; mob.boost += acc.per; }
      sp = Math.min(acc.cap, sp + mob.boost);
    }
    // 発見直後の硬直。止まっているだけで、向き（monster.lookAt）と捕獲判定は生きている。
    if (mob.freeze > 0) { mob.freeze -= dt; sp = 0; }
    // 【見えている間は直進、見失ったら足跡を辿る】v22 はロスト猶予の2.8秒のあいだも
    // プレイヤーの現在座標へ壁越しに直進していたので、間仕切り壁を挟んで周回されると
    // 壁に貼り付いたまま置いていかれた。見えなくなった瞬間から、プレイヤーが実際に
    // 通った道（＝必ず歩ける道）をなぞる。
    let tx = ply.x, tz = ply.z;
    if (canSee) { mob.lostAt = 0; mob.crumb = -1; }
    else {
      mob.lostAt += dt;
      if (mob.lostAt > 2.8) { mob.mode = "patrol"; mob.lostAt = 0; mob.crumb = -1; }
      const node = trailTarget();
      if (node) { tx = node.x; tz = node.z; }
      /* 【足跡の終端に着いたら加速が抜けていく】trailTarget が null＝プレイヤーが実際に
         通った道を最後まで辿りきったのに姿が無い、という状態。匂いが切れた瞬間なので
         ここまでの加速を手放す。クローゼットに入る／視線を切って距離を取る、という
         プレイヤー側の行動がそのまま「怪人の速度を巻き戻す」報酬になる。
         【一瞬で戻さない】4.0 から 1.26 へ1フレームで落ちると、動きが物理的に不自然に見える
         （急に置物になる）。毎秒 1.0 m/s ずつ抜く。 */
      else { mob.boost = Math.max(0, mob.boost - dt); mob.boostT = 0; }
    }
    const d = Math.hypot(tx - mob.x, tz - mob.z) || 1;
    const moved = steer(mob, (tx-mob.x)/d * sp * dt, (tz-mob.z)/d * sp * dt, 0.4, tx, tz);
    if (moved < sp*dt*0.1) {
      mob.stuck += dt;
      // 【1.2秒 → 0.45秒】壁沿いのすべりを入れてもなお動けないのは、目標との間に
      // 家具や壁が厚く挟まっている＝直線ステアリングでは到達できない配置のとき。
      // 1.2秒その場で震えるのは見た目にはっきり「バグ」なので、早めに切り上げる。
      if (mob.stuck > 0.45) {
        // 【巡回に戻すが、順路の続きではなくプレイヤーに一番近い巡回点へ向かわせる】
        // v22 は素の patrol に戻していたので、角で詰まるたびに部屋の反対側へ去っていき、
        // プレイヤーは「壁の向こうで引っかかって諦めた敵」を見ることになっていた。
        // 巡回点は部屋中に散っているので、近い1点を選ぶだけで障害物を大きく迂回できる
        // （A* の代わりとして、既にあるウェイポイント網を経由路に使う）。
        let bi = mob.wp, bd = Infinity;
        WP.forEach((p, i) => {
          const dd = Math.hypot(p[0]-ply.x, p[1]-ply.z);
          if (dd < bd) { bd = dd; bi = i; }
        });
        mob.wp = bi;
        mob.mode = "patrol"; mob.stuck = 0;
      }
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
  // 接近ビネット。**検分中・e-Tax中も更新する**（v23）。
  // これらの画面でも怪人は近づき、捕獲判定も生きているのに、v22 では通常プレイ中しか
  // 更新されず、書類を睨んでいる間だけ視覚的な警告が止まっていた。心音は鳴り続けるので
  // 「音だけが頼り」という中途半端な状態になっていた。難易度ではなく公平性の問題なので
  // 白青どちらでも直す（CSS 側で z-index も 15→34 に上げてオーバーレイの手前に出した）。
  if (state === "PLAY" || state === "INSPECT" || state === "ETAX") {
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
    notice(tr("noticePhone"), 4.6);
  }
  if (gameMin >= 22*60 && !flags.n2200) {
    flags.n2200 = true; phase = 2;
    if (!mob.active && visit.state !== "omen") applyLights(1);
    notice(tr("notice22"));
  }
  if (gameMin >= flags.tvAt && !flags.tvDone) {
    flags.tvDone = true;
    M.tv.emissive.setHex(0x8fb0e8);
    beep(300, 0.5, "sawtooth", 0.14, 90);
    subtitle(tr("noticeTv"), 3);
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
    notice(tr("notice23"));
  }
  if (gameMin >= 23*60 + 59) ending("late");
}

/* ---------- main loop ---------- */
let last = performance.now();
let warmup = 4;   // タイトル表示中にシェーダを焼いておくフレーム数（下の opaqueOverlay を参照）
const warmDir = new V3();   // 焼き込み中に怪人をカメラの正面へ置くための作業用ベクトル
let spotFx = 0;   // 「見つかっている度合い」0..1。FilmShader の spot uniform へ渡す
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
      trailPush();
      clockUpdate(dt);
      // interact prompt
      nearTarget = findNear();
      if (nearTarget) {
        promptEl.classList.remove("hidden");
        promptEl.textContent =
          nearTarget.kind === "desk"   ? (got < 5 ? tr("pcNotEnough", { got }) : tr("promptEtax")) :
          nearTarget.kind === "closet" ? (ply.hidden ? tr("promptUnhide") : tr("promptHide")) :
          nearTarget.kind === "item"   ? tr("promptInspect") :
          tr("promptExamine");
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
    // 右ベクトル＝ dir × up。dir はこの直後に multiplyScalar で破壊されるので先に取る。
    flashRight.set(-dir.z, 0, dir.x).normalize();
    flash.position.copy(camera.position).addScaledVector(flashRight, FLASH_OFF.right);
    flash.position.y -= FLASH_OFF.down;
    flashTarget.position.copy(camera.position.clone().add(dir.multiplyScalar(6)));

    // item bobbing
    const t = now / 1000;
    for (const id in itemMeshes) {
      const m = itemMeshes[id];
      if (!m.userData.on) continue;
      m.children[0].rotation.y = t * 1.4;
      /* 加算ではなく代入。v23 まで `+=` で積分していたため、振幅がフレームレート依存
         （60fpsで約2.5cm、144fpsで約6cm）になっていた。基準の高さからの変位で置く。 */
      m.position.y = m.userData.baseY + Math.sin(t * 2.2) * 0.02;
    }
    fakeMeshes.forEach(m => { if (m.userData.on) m.children[0].rotation.y = t * 1.4; });

    drawMinimap();

    // timers
    if (subT > 0) { subT -= dt; if (subT <= 0) subtitleEl.textContent = ""; }
    if (noticeT > 0) { noticeT -= dt; if (noticeT <= 0) noticeEl.style.opacity = 0; }
  }

  /* ---------- 描画（状態に応じて手を抜く。v23で追加） ----------
     v22 までは state に関係なく毎フレーム composer.render() を呼んでいた。つまり
     **タイトル画面・ポーズ・エンディングという「不透明な DOM が画面全体を覆っている間」も、
     GTAO＋Bloom＋影7灯がフル解像度で回り続けていた**。1ピクセルも見えないものを描いている。

     オーバーレイの不透明度で3段に分ける（index.html の CSS がそのまま根拠）:
     - #title / #pause(0.9) / #ending は不透明 → 描画を丸ごと止める。
       最後に描いたフレームはキャンバスに残るので、絵が消えることはない。
     - #inspect(0.8) / #etax(0.55) は半透明で、背後の部屋が透けて見える。**e-Tax画面の
       向こうから怪人が近づいてくるのが見える**のは設計上の緊張なので、描画は止めない。
       ただし AO（接触部の陰り）と Bloom（明部の滲み）は、55〜80%の暗幕越しには
       まず判別できないので、この2パスだけ落とす。 */
  // 【タイトル中に数フレームだけ描く理由】不透明だからと最初から一度も描かないと、
  // シェーダのコンパイル（本体＋GTAO・Bloom・Output・Film の4パス）がまるごと
  // 「ゲーム開始の1フレーム目」に集中して、開始直後に必ず固まる。タイトルの裏で
  // 数フレーム焼いておけば、その分は待ち時間の中に隠れる。
  const opaqueOverlay = (state === "TITLE" || state === "PAUSE" || state === "END") && warmup <= 0;
  if (!opaqueOverlay) {
    /* 【怪人もここで焼く】怪人は 11 種類の材質を持つが、visible=false のあいだは
       一度も描かれず、シェーダは**初めて出現した瞬間**にまとめてコンパイルされる。
       v24 でアイテムの光源を外して直したのと同じ「選択の前後で固まる」現象が、
       いちばん緊張する場面で起きることになる。タイトルの暗幕の裏でカメラの前に
       置いて数フレーム描き、コンパイルを待ち時間の中に隠す。 */
    if (warmup > 0) {
      warmup--;
      monster.visible = true;
      camera.getWorldDirection(warmDir);
      monster.position.copy(camera.position).addScaledVector(warmDir, 2.2);
      monster.position.y = -0.2;                 // 目の高さに顔が来るよう少し沈める
      if (warmup === 0) { monster.visible = false; monster.position.set(0, 0, 0); }
    }
    const dimmed = state === "INSPECT" || state === "ETAX";
    aoPass.enabled    = !LOW() && !dimmed;
    bloomPass.enabled = !LOW() && !dimmed;
    /* 見つかっている度合いを滑らかに追従させる（v23）。
       立ち上がりを速く（0.22秒）・戻りを遅く（1.1秒）するのは、「見つかった瞬間」は
       即座に伝えたい一方、視線を切った直後に画面がパッと戻ると緊張が抜けすぎるため。
       白は spotFx:false なので常に 0＝この演出は青でしか出ない。 */
    const spotWant = (MODES[mode].spotFx && mob.active && mob.mode === "chase") ? 1 : 0;
    const spotRate = dt / (spotWant > spotFx ? 0.22 : 1.1);
    spotFx += Math.max(-spotRate, Math.min(spotRate, spotWant - spotFx));
    filmPass.uniforms.spot.value = spotFx;
    filmPass.uniforms.time.value = now / 1000;
    composer.render();
  }
}
requestAnimationFrame(frame);

/* ---------- title: mode select & 記録表示 ---------- */
function refreshTitleMeta() {
  const blueOpen = !!save.endings.refund;
  const mb = $("modeBlue");
  mb.disabled = !blueOpen;
  mb.textContent = blueOpen ? tr("modeBlue") : tr("modeBlueLocked");
  // エンディング数は EDS のキー数から数える（shiyakusho 追加で4つ目。ハードコードしない）
  const eN = Object.keys(EDS).filter(k => save.endings[k]).length;
  $("meta").textContent =
    tr("saveLine", { found: Object.keys(save.found).length, total: ANOM_IDS.length, endings: eN, endTotal: Object.keys(EDS).length })
    + (save.bestRank ? tr("saveBest", { rank: save.bestRank }) : "");
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

/* ---------- 画面の文言を流し込む（P2-9） ----------
   index.html の静的な文言は data-t / data-th を持つ。ここで一括で埋める。
   data-t  = textContent（素のテキスト）
   data-th = innerHTML（<b> や <br> を含む文言）

   **クレジット画面（#credits）の中身は対象外。** ライセンス表記の義務で
   置いてあるものなので、日本語のままにしてある（仕様書 §1.1 / §3.4）。
   見出し・案内・戻るボタンだけは data-t を持つので翻訳される。 */
function applyI18n() {
  for (const el of document.querySelectorAll("[data-t]")) {
    el.textContent = tr(el.dataset.t);
  }
  for (const el of document.querySelectorAll("[data-th]")) {
    el.innerHTML = tr(el.dataset.th);
  }
  // 題字は怪異の名前そのもの。作品タイトルの一部なので anoms.js から取る。
  $("titleName").textContent = TXT.monster;
  document.title = TXT.title;
  // 複数行をまとめて組む箇所（<br> 区切り）。
  $("prem").innerHTML = ["premise1", "premise2", "premise3", "premise4", "premise5"]
    .map((k) => tr(k)).join("<br>");
  $("ctrl").innerHTML =
    [tr("ctrlPc"), tr("ctrlTouch"), "", tr("ctrlHint1"), tr("ctrlHint2"), tr("ctrlHint3")].join("<br>");
}

/* ---------- ポーズ／設定（P2-4）とクレジット（P7-1） ----------
   ポーズ中は state を "PAUSE" にする。メインループが PLAY / ETAX / INSPECT でしか
   進まないので、これだけで時計も怪人も止まる（別途フラグを持たない）。 */
let pauseReturnState = "PLAY";

function openPause() {
  if (state !== "PLAY") return;
  pauseReturnState = state;
  state = "PAUSE";
  document.exitPointerLock && document.exitPointerLock();
  paintPause();
  $("pause").classList.remove("hidden");
  beep(420, 0.07, "triangle", 0.06);
}
function closePause() {
  $("pause").classList.add("hidden");
  $("credits").classList.add("hidden");
  if (state === "PAUSE") state = pauseReturnState;
  if (state === "PLAY" && !isTouch) renderer.domElement.requestPointerLock();
}

function paintPause() {
  $("pVol").value = String(Math.round(audioPrefs.vol * 100));
  $("pVolV").textContent = audioPrefs.muted ? tr("muted") : `${Math.round(audioPrefs.vol * 100)}%`;
  $("pSens").value = String(save.sens);
  $("pSensV").textContent = `${save.sens}%`;
  $("pGamma").value = String(save.gamma);
  $("pGammaV").textContent = (save.gamma / 100).toFixed(2);
  $("pQual").value = save.quality || "auto";
  // 「自動」を選んでいるときは、実際にどちらで走っているかを見せる（判定は端末任せなので、
  // 重い・軽いの原因がここにあると気付けるようにする）。
  $("pQualV").textContent = (save.quality || "auto") === "auto" ? tr(LOW() ? "qualityLow" : "qualityHigh") : "";
  $("pLang").value = LOCALE;
  $("pLangV").textContent = "";
}

$("pVol").addEventListener("input", () => { setVolume(Number($("pVol").value) / 100); paintPause(); });
$("pSens").addEventListener("input", () => {
  save.sens = Number($("pSens").value); persistSave(); paintPause();
});
$("pGamma").addEventListener("input", () => {
  save.gamma = Number($("pGamma").value);
  renderer.toneMappingExposure = save.gamma / 100;
  persistSave(); paintPause();
});
$("pQual").addEventListener("change", () => {
  save.quality = $("pQual").value;
  persistSave();
  QUALITY = detectQuality();
  applyQuality();   // pixelRatio・GTAO・Bloom・影はその場で切り替わる
  paintPause();
  // MSAA だけは WebGL コンテキスト生成時にしか決められないので、次回の起動から効く。
  // 影と GTAO に比べれば軽いので、ここで location.reload() まではしない（進行が消えるため）。
});
$("pLang").addEventListener("change", () => {
  const v = $("pLang").value;
  if (!LOCALES.includes(v) || v === LOCALE) return;
  // 言語を変えると書類・異変・暗証番号の正解がまるごと入れ替わる。暗証番号ゲートは
  // モジュール読み込み時に1つだけ作る設計（W-03）なので、途中で差し替えると
  // 試行回数の整合が壊れる。読み込み直すのが最も安全で、セーブは残る。
  save.locale = v;
  persistSave();
  location.reload();
});
$("pResume").addEventListener("click", closePause);
$("pTitle").addEventListener("click", () => { location.reload(); });
$("pCredits").addEventListener("click", () => {
  $("credits").classList.remove("hidden");
});
$("cBack").addEventListener("click", () => { $("credits").classList.add("hidden"); });

/* ---------- 音量スライダー（タイトル画面） ---------- */
{
  const sl = $("volSlider"), lab = $("volVal");
  const paint = () => {
    sl.value = String(Math.round(audioPrefs.vol * 100));
    lab.textContent = audioPrefs.muted ? tr("muted") : `${Math.round(audioPrefs.vol * 100)}%`;
  };
  paint();   // 保存された設定を復元して表示
  sl.addEventListener("input", () => { setVolume(Number(sl.value) / 100); paint(); });
}

/* ---------- start ---------- */
$("startBtn").addEventListener("click", async () => {
  // 同梱フォントを待ってから始める（P2-7）。読み込み前に書類を描くと
  // 1枚目だけ OS フォントになり、Proton では豆腐で読めない。
  // 待ち時間はほぼゼロ（読み込みはページ表示と同時に始めている）。
  await fontsReady;
  MIN_PER_SEC = MODES[mode].mps;
  assignCopies();   // モード確定後に偽物を配り直す
  $("title").classList.add("hidden");
  $("hud").classList.remove("hidden");
  audioInit();
  state = "PLAY";
  if (!isTouch) renderer.domElement.requestPointerLock();
  notice(mode === "blue" ? tr("noticeStartBlue") : tr("noticeStartWhite"), 4.6);
});

/* debug hook (テスト用) */
window.__dbg = { ply, mob, visit, ITEMS, FAKES, openInspect, enterVisit, startOmen, ending, save, runLog,
  // 検証用: 書類は目で見るしかないので tools/shot-doc.mjs から触れるようにする
  ANOM_IDS, buildSpec, drawDoc, canApply, anomMeta,
  DOCSPECS: () => SPECS, locale: () => LOCALE,
  // 検証用: ポスターと顔のテクスチャ。3D の中では正面から見る機会が少なく、
  // 文字が枠外へ流れていても気付けないので、描画結果を直接取り出せるようにする。
  posterCanvas: (bad) => makePosterTex(bad).image,
  // 顔の見出しは怪人生成の中でインラインに描いているので、幅だけ測れるようにする。
  measureFit: (text, maxW, basePx, serif) => {
    const c = document.createElement("canvas").getContext("2d");
    const w = fitFont(c, text, maxW, basePx, `px ${serif ? F_SERIF() : F_SANS()}`, "bold ");
    return { width: Math.round(w), font: c.font };
  },
  monster, spawnMonster,   // 検証用: 怪人の直接制御
  pin, openEtax,           // 検証用: 暗証番号ゲート本体とe-Taxの開閉（E2Eから残り回数を観測するため）
  st: () => state, gm: () => gameMin, setMin: v => { gameMin = v; },
  setMode: m => { mode = m; },
  // 検証用（v23）: 画質プリセットとポーズの開閉。tools/smoke-v23.mjs が
  // 「オーバーレイ中に描画を止めているか」「low で影が1灯になるか」を見るのに使う。
  quality: () => QUALITY, applyQuality, openPause, closePause,
  // 検証用（v24）: 懐中電灯のオフセットを撮影ハーネスから切り替える
  FLASH_OFF, roomLights, monster, showGlow,
  // 検証用（v23）: パンくず追跡。足跡を任意に敷いてから怪人を走らせて、
  // 間仕切り壁を回り込めるかを tools/smoke-v23.mjs で確かめる。
  trail, trailPush, trailTarget, endVisit,
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
