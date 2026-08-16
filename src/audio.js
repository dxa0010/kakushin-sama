/* =====================================================================
 * audio.js ── 音の生成エンジン（ゲーム非依存）
 *
 * 【なぜ別ファイルか】`tools/audio-lab.html` から単体で読み込んで音を試聴・調整
 * できるようにするため。`game.js` を import するとシーン全体が起動してしまうので、
 * 音だけを切り出してある。**このファイルはゲームの状態（ply/save/scene等）を
 * 一切参照しないこと。** 参照した瞬間に単体試聴ができなくなる。
 *
 * 【音声アセットは1つも無い】すべて WebAudio のランタイム合成。理由：
 *   - ダウンロード0バイト（テクスチャを4.1MBまで削った成果を潰さない）
 *   - ライセンス表記の管理が増えない（商用化を想定しているため）
 *   - ループの繰り返しに気付かれない（静かなゲームでは10秒ループは必ずバレる）
 *
 * 【バス構成】新しい音は必ず BUS のどれかに繋ぐこと。destination に直結すると
 * 音量調整とミュートが効かない音になる（v13以前が全部その状態だった）。
 *
 *   AC.destination
 *     └─ masterGain … ユーザー音量 × ミュート
 *          ├─ BUS.amb   … 環境音（部屋鳴り・冷蔵庫）。鳴り続けるもの
 *          ├─ BUS.sfx   … 効果音（beep/thump/足音/秒針/心音）。単発のもの
 *          └─ BUS.voice … 怪人の声
 *
 * 【v15で雨とドローンを削除した】どちらも実装・実測済みだったが、実聴の結果として
 * 不採用になった。理由を残しておく：
 *   - 雨   … 窓の夜景テクスチャが「星と三日月の晴れた夜空」なので、そもそも画と
 *            矛盾していて鳴らせなかった（v14でも呼んでいない）。
 *   - ドローン … 52/54.7Hz のうなりで不安を煽る意図だったが、「合成音が鳴っている」
 *            とはっきり分かってしまい、生活音（部屋鳴り＋冷蔵庫）だけの方が静かで怖い。
 * 復活させたくなったら git log で v14 以前の audio.js を見ること。
 * ===================================================================== */

export let AC = null;
export let masterGain = null;
export const BUS = { amb: null, sfx: null, voice: null };
export const audioPrefs = { vol: 0.8, muted: false };

// 設定が変わったときに呼ばれる。game.js 側が localStorage 保存を差し込む。
// （このファイルから直接 localStorage を触ると、試聴ツールがゲームのセーブを壊す）
export let onPrefsChange = null;
export function setOnPrefsChange(fn) { onPrefsChange = fn; }

const running = new Set();   // 停止し忘れ防止のため、鳴っているループを把握しておく

/* ---------- 初期化 ---------- */
// 【重要】必ずユーザー操作（クリック等）のハンドラから呼ぶこと。
// ブラウザの自動再生ポリシー上、操作を経ずに AudioContext を作ると suspended で始まり
// 音が出ない。ゲーム側では startBtn のクリックハンドラで呼んでいる。
export function audioInit(prefs) {
  if (AC) return AC;
  if (prefs) Object.assign(audioPrefs, prefs);
  AC = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = AC.createGain();
  masterGain.gain.value = audioPrefs.muted ? 0 : audioPrefs.vol;
  masterGain.connect(AC.destination);
  for (const k of Object.keys(BUS)) {
    BUS[k] = AC.createGain();
    BUS[k].gain.value = 1;
    BUS[k].connect(masterGain);
  }
  return AC;
}

// タブ切り替え・モバイルの復帰で suspended のまま無音になるのを防ぐ
addEventListener("visibilitychange", () => {
  if (AC && !document.hidden && AC.state === "suspended") AC.resume().catch(() => {});
});

function applyPrefs() {
  if (masterGain) masterGain.gain.value = audioPrefs.muted ? 0 : audioPrefs.vol;
  if (onPrefsChange) onPrefsChange({ vol: audioPrefs.vol, muted: audioPrefs.muted });
}
export function setVolume(v) {
  audioPrefs.vol = Math.max(0, Math.min(1, v));
  audioPrefs.muted = false;
  applyPrefs();
}
export function toggleMute() { audioPrefs.muted = !audioPrefs.muted; applyPrefs(); return audioPrefs.muted; }
export function isMuted() { return audioPrefs.muted; }

/* ---------- 基本ヘルパー ---------- */
// ホワイトノイズのループ用バッファ。2秒あれば繰り返しは知覚されない
// （周期性のある音と違い、ノイズはループ点が分からないため）
const _noiseBufs = {};
// type: "white" … 全帯域に等エネルギー。フィルタで削って使う
//       "brown" … 積分ノイズ。-6dB/oct で自然に低域へ寄る。
//                 ホワイト＋ローパスで低い音を作ろうとすると、カットオフより上に残る
//                 広大な帯域の総エネルギーが勝ってしまい、いくら段数を重ねても
//                 「サー」というヒスが残る。低い唸り・部屋鳴りは最初からブラウンで作る。
function noiseBuffer(seconds = 2, type = "white") {
  const key = type + seconds;
  if (_noiseBufs[key]) return _noiseBufs[key];
  const len = Math.floor(AC.sampleRate * seconds);
  const b = AC.createBuffer(1, len, AC.sampleRate);
  const d = b.getChannelData(0);
  if (type === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  _noiseBufs[key] = b;
  return b;
}
function noiseSource(loop = true, type = "white") {
  const s = AC.createBufferSource();
  s.buffer = noiseBuffer(2, type);
  s.loop = loop;
  return s;
}
function dest(bus) { return BUS[bus] || BUS.sfx; }

/* フィルタを直列に重ねて傾斜を急にする。
 * 【なぜ必要か】biquad 1段は -12dB/oct しかなく、ホワイトノイズのように
 * 全帯域に等しくエネルギーがある信号だと、カットオフより上に残る帯域が
 * 広すぎて総エネルギーで通過帯域を上回ってしまう。
 * 実測例：ノイズ→lowpass(240Hz) 1段 のスペクトル重心は 1771Hz にもなった
 * （狙いは 400Hz 未満）。3段重ねると意図どおり低域だけが残る。 */
function filterChain(type, freq, stages = 2, Q = 0.6) {
  const nodes = [];
  for (let i = 0; i < stages; i++) {
    const f = AC.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    if (i > 0) nodes[i - 1].connect(f);
    nodes.push(f);
  }
  return { input: nodes[0], output: nodes[nodes.length - 1],
           setFreq(v) { for (const n of nodes) n.frequency.value = v; } };
}

// 音源を左右に振る。pan は -1(左)〜+1(右)
function panned(node, pan, bus) {
  const out = dest(bus);
  if (pan !== undefined && pan !== null && AC.createStereoPanner) {
    const p = AC.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); p.connect(out);
  } else {
    node.connect(out);
  }
}

/* ---------- 単発の効果音 ---------- */
// opts: { pan: -1..1, bus: "sfx"|"amb"|"voice" }
export function beep(freq, dur = 0.12, type = "sine", vol = 0.18, glideTo = null, opts = {}) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, AC.currentTime + dur);
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g);
  panned(g, opts.pan, opts.bus);
  o.start(); o.stop(AC.currentTime + dur + 0.02);
}

export function thump(vol = 0.5, opts = {}) {
  beep(58, 0.28, "sine", vol, 40, opts);
  beep(180, 0.05, "square", vol * 0.3, null, opts);
}

/* ---------- 足音（v15で「鈍い」音に調整） ----------
 * 実際の足音は
 *   (a) 靴底が床に当たる広帯域のクリック  (b) 床が響く低い胴体
 * の2層でできているので、そう組む。（v13以前は70Hzの正弦波1本で「ブーン」だった）
 *
 * 【鈍さは何で決まるか】v14 は click=1400Hz・ゲイン vol*0.5・立ち上がり0秒 で、
 * 「コツッ」という硬い革靴の音だった。鈍い（＝厚手のスリッパで絨毯を踏むような）音に
 * するために効いたのは、下の3つ。周波数を下げるだけでは足りない：
 *   1. クリックの帯域を下げる（1400→900Hz）
 *   2. **その上にローパスを重ねて上を閉じる**（tone=1800Hz）。bandpass の Q は 0.7 と
 *      緩いので裾が高域まで伸びており、これを塞がないと下げても硬さが残る。
 *   3. **立ち上がりに4msの傾斜をつける**。ゼロ秒アタックは物理的にありえない
 *      不連続で、それ自体が「硬さ」として聞こえる。ここが体感差は一番大きかった。
 * さらにクリックを相対的に下げ（0.5→0.30）、胴体を長く低くして重心を下げている。
 *
 * opts: { pan, click（クリックの帯域Hz）, tone（上を閉じるHz）, body（胴体Hz）, bus } */
export function footstep(vol = 0.35, opts = {}) {
  if (!AC) return;
  const t = AC.currentTime;
  // (a) クリック：帯域を絞ったうえで、さらにローパスで上を閉じる
  const n = noiseSource(false);
  const bp = AC.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = opts.click ?? 900; bp.Q.value = 0.7;
  const lp = filterChain("lowpass", opts.tone ?? 1800, 2, 0.5);
  const ng = AC.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(vol * 0.30, t + 0.004);   // 4ms のアタック＝鈍さの主因
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
  n.connect(bp); bp.connect(lp.input); lp.output.connect(ng);
  panned(ng, opts.pan, opts.bus);
  n.start(t); n.stop(t + 0.08);
  // (b) 胴体：低い正弦をわずかに下降させる。v14 より低く長く（82→72Hz, 130→165ms）
  const o = AC.createOscillator(), og = AC.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(opts.body ?? 72, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.15);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  og.gain.exponentialRampToValueAtTime(0.0005, t + 0.165);
  o.connect(og);
  panned(og, opts.pan, opts.bus);
  o.start(t); o.stop(t + 0.19);
}

/* ---------- 心音（接近時の緊張） ----------
 * lub-dub の2拍。1拍目を強く、2拍目をやや弱く短く。 */
export function heartbeat(vol = 0.5, opts = {}) {
  if (!AC) return;
  const t = AC.currentTime;
  const beat = (at, v, f0, f1, dur) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + 0.012);   // 速いアタック
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    o.connect(g);
    panned(g, opts.pan, opts.bus);
    o.start(at); o.stop(at + dur + 0.02);
  };
  beat(t, vol, 62, 38, 0.17);                 // lub
  beat(t + 0.19, vol * 0.62, 55, 34, 0.14);   // dub
}

/* ---------- 時計の秒針 ----------
 * 短いノイズを高めの帯域で切り出す。tick と tock でわずかに音程を変えると
 * 「カチ・コチ」と交互に聞こえて機械らしくなる。 */
export function clockTick(tock = false, vol = 0.12, opts = {}) {
  if (!AC) return;
  const t = AC.currentTime;
  const n = noiseSource(false);
  const bp = AC.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = tock ? 2100 : 2800;
  bp.Q.value = 9;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.028);
  n.connect(bp); bp.connect(g);
  panned(g, opts.pan, opts.bus);
  n.start(t); n.stop(t + 0.05);
}

/* =====================================================================
 * ループする環境音。すべて handle を返す：{ stop(), set(name, value) }
 * ===================================================================== */

/* ---------- 部屋鳴り（room tone） ----------
 * 「無音」は不自然で、逆に安っぽく聞こえる。ほとんど聞こえない低域のノイズを
 * 敷いておくと、静けさに実体が出る。単体で聴くとほぼ何も聞こえないのが正常。 */
export function startRoomTone(opts = {}) {
  if (!AC) return null;
  const o = Object.assign({ vol: 0.05, cutHz: 240 }, opts);
  const out = AC.createGain(); out.gain.value = o.vol; out.connect(BUS.amb);
  // ブラウンノイズ＋ローパス3段。ホワイトノイズだとローパスを何段重ねても
  // 高域が残って「サー」というヒスになった（実測：1段で重心1771Hz、3段でも841Hz）
  const n = noiseSource(true, "brown");
  const lp = filterChain("lowpass", o.cutHz, 3, 0.5);
  n.connect(lp.input); lp.output.connect(out); n.start();
  const h = {
    stop(fade = 1.0) {
      out.gain.linearRampToValueAtTime(0.0001, AC.currentTime + fade);
      setTimeout(() => { try { n.stop(); } catch (e) {} }, fade * 1000 + 100);
      running.delete(h);
    },
    set(k, v) { if (k === "vol") out.gain.value = v; else if (k === "cutHz") lp.setFreq(v); },
  };
  running.add(h);
  return h;
}

/* ---------- 冷蔵庫のうなり ----------
 * 商用電源由来の低い唸り（基音＋倍音）＋コンプレッサーの機械ノイズ。
 * 実際の冷蔵庫は数十分おきに運転/停止を繰り返すので、cycle:true にすると
 * ゆっくり入り切りする。「ずっと鳴っている」より生活感が出る。 */
export function startFridge(opts = {}) {
  if (!AC) return null;
  const o = Object.assign({ vol: 0.06, baseHz: 118, cycle: false }, opts);
  const out = AC.createGain(); out.gain.value = o.vol; out.connect(BUS.amb);

  const mk = (f, v) => {
    const osc = AC.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
    const g = AC.createGain(); g.gain.value = v;
    osc.connect(g); g.connect(out); osc.start(); return osc;
  };
  const o1 = mk(o.baseHz, 0.6);              // 基音
  const o2 = mk(o.baseHz * 2, 0.18);         // 2倍音
  const o3 = mk(o.baseHz * 0.5, 0.25);       // 半分（ゴロゴロ感）
  // 機械のざらつき
  const n = noiseSource();
  const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
  const ng = AC.createGain(); ng.gain.value = 0.10;
  n.connect(lp); lp.connect(ng); ng.connect(out); n.start();

  let timer = null;
  if (o.cycle) {
    let on = true;
    const flip = () => {
      on = !on;
      out.gain.linearRampToValueAtTime(on ? o.vol : 0.0001, AC.currentTime + 2.5);
      timer = setTimeout(flip, (on ? 45 : 28) * 1000);
    };
    timer = setTimeout(flip, 45000);
  }
  const h = {
    stop(fade = 1.0) {
      if (timer) clearTimeout(timer);
      out.gain.linearRampToValueAtTime(0.0001, AC.currentTime + fade);
      setTimeout(() => { try { o1.stop(); o2.stop(); o3.stop(); n.stop(); } catch (e) {} }, fade * 1000 + 100);
      running.delete(h);
    },
    set(k, v) {
      if (k === "vol") out.gain.value = v;
      else if (k === "baseHz") { o1.frequency.value = v; o2.frequency.value = v * 2; o3.frequency.value = v * 0.5; }
    },
  };
  running.add(h);
  return h;
}

/* ---------- 全停止（試聴ツール用） ---------- */
export function stopAll() { for (const h of Array.from(running)) h.stop(0.15); }

/* ---------- 怪人の声 ----------
 * ブラウザのTTS。**ja-JP の音声が入っていない環境では無音になる**ので、
 * 字幕が唯一の伝達手段になる。字幕を消さないこと。
 * WebAudio のグラフ外で鳴るため masterGain を通らない。音量/ミュートは手動で反映する。 */
export function speak(text) {
  try {
    if (audioPrefs.muted) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 0.82; u.pitch = 0.4;
    u.volume = 0.9 * audioPrefs.vol;
    speechSynthesis.speak(u);
  } catch (e) { /* no speech — subtitle only */ }
}
