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
  } else if (type === "pink") {
    /* ピンクノイズ（-3dB/oct）。ホワイトとブラウンの中間。
     * 【なぜ必要か】足音の中域層を暗くしたいとき、ローパスを急峻にすると帯域が狭まって
     * 音高が立つ（v16で踏んだ罠）。ピンクノイズなら**帯域幅を保ったまま**高域を落とせる。
     * 実装は Paul Kellett の近似フィルタ。係数の意味は個別には無く、全体で
     * -3dB/oct に合うよう決められた定数なので、いじらないこと。 */
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
      b6 = w * 0.115926;
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

/* ---------- 足音（v16で「芯を抜いた」） ----------
 *
 * 【最重要：オシレーターを1つも使わないこと】
 * v14/v15 は胴体を「正弦波を 72Hz→46Hz に下降させる」で作っていた。これは**バスドラム
 * （TR-808キック）の合成方法そのまま**で、どれだけローパスを重ねてクリックを削っても
 * 「ドッ」というバスドラ感が消えなかった。原因はフィルタではなく**音源に確定した音高が
 * あること**。正弦波は単一の周波数にエネルギーが集中するので、耳は必ずそこに「芯」を聴く。
 * 下降スイープはさらに悪く、キックの最も分かりやすい署名である。
 * → 3層すべてノイズにした。ノイズは音高を持たないので、原理的に芯が立たない。
 * **ここに音程のある音源を足すと、バスドラ感が即座に戻る。**
 *
 * 【次の罠：狭い帯域のノイズにも音高がある】
 * 正弦波を消したあと「もっと鈍く」しようとしてローパスを 2〜4段重ねて 130Hz で切ったら、
 * **芯が戻った**。狭帯域ノイズは局所的に周期波形になるので、耳は音高を聴いてしまう
 * （実測：自己相関のピークが 0.70、さらに 70Hz まで絞ると 0.89 まで悪化した。
 * 正弦波が 1.00 なので、ほとんど正弦波と同じ扱いになっていた）。
 * → **段数を1段に減らし、カットオフを上げて帯域を広く取る**のが正解だった。
 * 総当たりで測った結論は「ブラウンノイズ＋lowpass(320Hz) 1段」で、自己相関 0.275。
 * **鈍くしたくてカットオフを下げたり段数を増やしたりすると、必ず芯が戻る。**
 * 暗さはブラウンノイズ自体の -6dB/oct の傾きが担っており、急峻なフィルタは要らない。
 *
 * 【v17：「ペタペタ感」を出すために中域層を作り直した】
 * v16 の中域層は **狭い bandpass（Q=0.6、中心700Hz）** で、これは靴底が床をこする
 * 「擦れ／コツ」の音だった。実聴では「硬さの上限」を最低（500Hz）まで下げて
 * この層を潰した状態が最良と判断された——実測すると、その設定ではエネルギーの
 * **96.4% が 250Hz 未満**、中域はわずか 3.6% で、擦れ層は事実上鳴っていなかった。
 * つまり「狭い帯域の中域」は足音として要らない、というのが実聴の結論。
 *
 * 一方で欲しいのは「ペタペタ」＝素足やスリッパが硬い床を叩く音であり、これには
 * 中域のエネルギーが必要になる。矛盾しているように見えるが、**別の音**である：
 *   - 擦れ／コツ … 狭帯域（bandpass Q高め）＝乾いた「シュッ」「カツッ」。要らない
 *   - ペタ      … **広帯域の短い破裂**＝柔らかいものが面を叩く音。これが欲しい
 * → 中域層を bandpass から **highpass + lowpass の緩い1段ずつ（約2オクターブ幅）** に
 *   変えた。低域層で学んだのと同じ「幅が音高を殺す」が、ここでは同時に
 *   「シュッ」を「ペタ」に変える働きをする。
 *
 * 【ペタペタ感の核は帯域ではなく減衰の速さ】
 * 柔らかいもの（皮膚・ゴム）が当たると床はすぐ制振されるので、余韻が残らない。
 * 余韻が長いと同じ帯域でも「ドスッ」に聞こえる。だから中域層は 55ms 前後で切る。
 * 迷ったら **`snap` を短くするのが一番ペタペタに効く**。
 *
 * 【層の役割】
 *   (a) 胴体 … ブラウンノイズ＋緩いローパス1段。床が叩かれた重み。音高が立たない
 *   (b) ペタ … 広い中域の短い破裂。素足が床を叩く本体。`peta` で量を決める
 *
 * 【v18：既定値を実聴で確定した】ユーザーが試聴台で決めた値をそのまま既定にしてある：
 * body=120 / peta=0.12 / snap=25ms / tone=720Hz。**ペタは 12% と非常に小さい。**
 * v17 の既定（55%）から見ると「ペタを足す」のではなく「暗い胴体に**気配として**混ぜる」
 * 使い方で、素足の柔らかい当たりはこの薄さで成立するという判断。**大きくしないこと。**
 * body=120 は「狭帯域ノイズには音高がある」として v16 で避けた領域だが、
 * 実測で芯が許容範囲に収まることを確認して採用している（数値は HANDOFF.md 参照）。
 *
 * 【v18：1歩ごとにばらつかせる（`vary`）】
 * ばらつきの実装をここに置いてゲーム側に置かないのは、試聴台とゲームでばらつき方が
 * 食い違うと**試聴で決めた音が本編で鳴らない**ため。`vary` は 0〜1 の強さで、
 * **既定は 0（完全に固定）**。試聴台で正確な値を聴くには固定が必要なので、
 * ばらつきは呼び出し側が明示的に有効にする。
 *
 * 【測定で分かった重要な事実：音の物理量はもともと大きく散っている】
 * 20発撃って測ると、**vary=0 の時点でピーク振幅の変動係数が既に 30%**（範囲 0.027〜0.083）、
 * 重心も 296〜923Hz に散っていた。ノイズバッファの読み出し位置がランダムなためで、
 * ブラウンノイズはランダムウォークなので**読み出し位置が違うと局所的な振幅が大きく違う**。
 * つまり「同じ音の連打に聞こえる」のは、音量や帯域が揃っているせいでは**ない**。
 * 実際 vary=1 にしてもピークの変動係数は 30.8% で、統計的に区別できなかった
 * （±22%の一様ジッタは変動係数 12.7% 相当で、元からある 30% に埋もれる）。
 * → **効いているのはパラメータのばらつきより「鳴る間隔のばらつき」の方**という読みで、
 *   間隔の崩しはゲーム側（`stepGap`）に入れてある。ここのジッタは補助と考えること。
 * → それでも `peta` のばらつきは意味がある。5%〜19% の間で「ペタが聴こえる歩」と
 *   「胴体だけの歩」が入れ替わるので、**音量の差ではなく音色の差**として出る。
 * → **ジッタを広げるときは、元からある 30% より広くしないと数値には出ない。**
 *   逆に言えば「測っても差が出ない」ことと「聴いて差が無い」ことは別なので、
 *   最終判断は必ず試聴台の「6歩続けて」で耳で行うこと。
 *
 * opts: { pan, bus,
 *         body（胴体の上限Hz）, peta（ペタの量 0〜1.2）,
 *         tone（ペタの上限Hz＝明るさ）, snap（ペタの減衰ms＝ペタペタ感）,
 *         vary（1歩ごとのばらつき 0〜1。既定0＝固定） } */
export function footstep(vol = 0.35, opts = {}) {
  if (!AC) return;
  const t = AC.currentTime;
  // ノイズバッファの読み出し位置を毎回ずらす。**これが無いと全ての足音が波形レベルで
  // 完全に同一になり**、「同じ音の連打」として人工的に聞こえる（2秒バッファを共有しているため）
  const jit = () => Math.random() * 1.4;

  /* ばらつき。vary=1 で基準値の ±pct の範囲に散らす。
   * 中心をずらさない（対称にする）のが重要：片側だけに振ると実聴で決めた音そのものが
   * 変わってしまい、「ばらつかせた」のではなく「別の音にした」ことになる。 */
  const vary = Math.max(0, Math.min(1, opts.vary ?? 0));
  const wob = (base, pct) => base * (1 + (Math.random() * 2 - 1) * pct * vary);

  // 音量。1歩ごとの体重の乗り方に相当する
  vol = wob(vol, 0.30);

  // (a) 胴体：ブラウンノイズ＋**ローパス1段だけ**。段数を増やすと芯が戻る（上記参照）
  const nb = noiseSource(false, "brown");
  // 【body のばらつきは ±18% まで】120Hz なら 98〜142Hz。下に振ると帯域が狭まって
  // 音高が立つ側だが、実測では 110Hz で芯 0.486・134Hz で 0.515 と 120Hz 単独（0.602）を
  // 上回らないので、この幅なら悪化しない。**これ以上広げるなら測り直すこと。**
  const blp = filterChain("lowpass", wob(opts.body ?? 120, 0.18), 1, 0.5);
  const bg = AC.createGain();
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(vol * 1.1, t + 0.014);
  // 【余韻を v16 の 210ms から詰めた】長いと同じ帯域でも「ドスッ」に寄る
  const bdec = wob(0.115, 0.20);
  bg.gain.exponentialRampToValueAtTime(0.0005, t + bdec);
  nb.connect(blp.input); blp.output.connect(bg);
  panned(bg, opts.pan, opts.bus);
  nb.start(t, jit()); nb.stop(t + bdec + 0.04);

  // (b) ペタ：highpass と lowpass を1段ずつで**広い**帯域を作る。
  // bandpass（狭い）にすると「シュッ」という擦れに戻ってペタペタ感が消える
  // 【peta のばらつきは広く取る（±55%）】既定 12% に対して 5〜19% に振れる。
  // これは音量の差ではなく**音色の差**として出る（ペタが聴こえる歩と胴体だけの歩が
  // 入れ替わる）ので、元からある振幅のばらつき 30% に埋もれない唯一のジッタ
  const peta = wob(opts.peta ?? 0.12, 0.55);
  if (peta > 0.002) {
    const snap = wob((opts.snap ?? 25) / 1000, 0.32);
    const tone = wob(opts.tone ?? 720, 0.16);
    // 【ピンクノイズを使う理由】ホワイトだと重心が 1355Hz まで上がって「紙が擦れる」音に
    // 近づいた（実測）。ローパスを急峻にすれば下がるが、それは帯域を狭めるので音高が立つ。
    // ピンク（-3dB/oct）なら**幅を保ったまま**暗くできる。これが v16 の教訓の応用。
    const n = noiseSource(false, "pink");
    const hp = filterChain("highpass", 260, 1, 0.5);
    const lp = filterChain("lowpass", tone, 1, 0.5);
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(vol * peta, t + 0.004);  // 柔らかい当たり（4ms）
    ng.gain.exponentialRampToValueAtTime(0.0005, t + snap);
    n.connect(hp.input); hp.output.connect(lp.input); lp.output.connect(ng);
    panned(ng, opts.pan, opts.bus);
    n.start(t, jit()); n.stop(t + snap + 0.03);
  }
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
  // 読み出し位置を毎回ずらす。**1秒ごとに鳴るものが波形レベルで完全に同一だと**、
  // 足音以上にはっきり「サンプルの再生」と分かってしまう（共有バッファのため）
  n.start(t, Math.random() * 1.9); n.stop(t + 0.05);
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
