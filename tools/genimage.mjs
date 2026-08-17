/* ============================================================
   agy（Antigravity CLI）経由で画像テクスチャを生成する薄いラッパ
   ------------------------------------------------------------
   agy は `generate_image` ツールを持っていて、headless（`agy -p`）から
   そのまま叩ける。認証は OAuth トークンが
   `~/.gemini/antigravity-cli/antigravity-oauth-token` に既に置かれているので、
   APIキーの受け渡しは要らない。

   ラッパを噛ませる理由は3つある。素で叩くと毎回同じ罠を踏む。

   (1) **agy は出力パスの指定を無視する。**
       「C:/tmp/foo.png に保存して」と頼んでも、実際には
         ~/.gemini/antigravity-cli/brain/<conversationId>/<slug>_<epochMs>.jpg
       に落ちる。conversationId は実行ごとに変わる乱数なので、
       事前にパスを組み立てられない。**stdout に印字されたパスが唯一の handle**。
       だからここで受け取って `--out` にコピーする。

   (2) **`--output-format json` でないと stdout が信用できない。**
       text モードの stdout はモデルの散文なので、前置きが付いたり
       パスが引用符で囲まれたりする。json なら
         {conversation_id, status, response, duration_seconds, num_turns, usage}
       という安定した封筒になり、`status` で成否を機械判定できる。

   (3) **プロンプトで shell を明示的に禁じないと丸ごと失敗する。**
       headless には権限プロンプトが出せないので、モデルが `run_command` を
       使う気になった瞬間（出力先ディレクトリを mkdir しようとする等）
         「no output produced — a tool required the "command" permission
           that headless mode cannot prompt for, so it was auto-denied」
       で画像も含めて何も返らない。生成そのものは `generate_image` だけで
       完結するので、「shell を使うな」と釘を刺しておけば通る。

   ------------------------------------------------------------
   使いどころと、使ってはいけないところ（実測。2026-08-17）

   ○ 向く: 布・紙の地合い・木目・コンクリ・ステンレスといった**文字の無い素材**。
     1024x1024 で写実的、`--edit` で既存画像の構造を保ったまま色だけ振れる
     （キルトの縫い目と織り目を保持して色だけ変えられた）。
     つまり1枚のマスターから色違いの一族を作れる。

   × 向かない: **文字を含む資産**（ポスター・書類・異変時の文字差し替え）。
     短い数行なら正しい日本語が出るが、文字量が増えると崩壊する。
     実測で「6曜日」「1週罰10mの前に休み外します」「ブゴルフィスト」
     「古紙日はやゐに必けるやゴミみをはずく施しております」といった
     非日本語が混ざった。プレイヤーが読む文字は Canvas 描画のまま維持する
     （書類・ポスター・怪人の顔を Canvas へ戻した判断はこれで裏が取れた）。

   × 向かない: **アルファが必要なもの**。出力は JPEG 固定で透過を持てない。

   △ 注意: 「平面スキャン」を頼んでも縁に地の色が1本残ることがある。
     テクスチャに使う前に必ず目で見る。タイリングも保証されない。

   所要時間: 初回は起動と認証で 150 秒ほどかかるが、温まると 15〜25 秒。

   ------------------------------------------------------------
   実行例:
     node tools/genimage.mjs --out assets/tex/quilt.jpg \
       "quilted linen bedspread, diagonal stitching, beige"

     # 既存画像の構造を保って色だけ振る
     node tools/genimage.mjs --out assets/tex/quilt_blue.jpg \
       --edit assets/tex/quilt.jpg \
       "recolor the fabric to a faded dusty blue-gray, keep the stitching identical"

     # 縦長（ポスター枠など、文字を載せない下地に）
     node tools/genimage.mjs --out assets/tex/paper.jpg --aspect 3:4 \
       "yellowed blank sheet of paper, faint stains, no text"

   オプション:
     --out <path>        コピー先（必須）
     --edit <path>       入力画像。指定すると編集モードになる
     --aspect <w:h>      アスペクト比（既定 1:1）
     --conversation <id> 前回の会話を継いで同じ画を詰める。id は本ツールが印字する
     --scene             「平面スキャン」の縛りを外す（情景として描かせたいとき）
     --timeout <dur>     agy 側の待ち時間（既定 4m）
   ============================================================ */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";

const argv = process.argv.slice(2);
let out = null, edit = null, aspect = "1:1", conversation = null;
let flat = true, timeout = "4m";
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") out = argv[++i];
  else if (a === "--edit") edit = argv[++i];
  else if (a === "--aspect") aspect = argv[++i];
  else if (a === "--conversation") conversation = argv[++i];
  else if (a === "--scene") flat = false;
  else if (a === "--timeout") timeout = argv[++i];
  else words.push(a);
}
const subject = words.join(" ").trim();
if (!out || !subject) {
  console.error("usage: node tools/genimage.mjs --out <path> [--edit <path>] [--aspect w:h] [--scene] \"<prompt>\"");
  process.exit(2);
}
if (edit) {
  edit = resolve(edit);
  if (!existsSync(edit)) { console.error("no such input image:", edit); process.exit(2); }
}
// agy の出力は JPEG 固定。拡張子が違うと後段（three.js の loader やビルド）で
// 中身と名前が食い違うので、黙って通さずここで止める。
if (extname(out).toLowerCase() !== ".jpg" && extname(out).toLowerCase() !== ".jpeg")
  console.error(`warn: agy always emits JPEG but --out is "${extname(out)}"; the bytes will be JPEG regardless`);

/* プロンプトの組み立て。素の題材の前後に「必ず守らせたいこと」を挟む。
   generate_image を1回だけ呼ばせるのは、複数枚出すと stdout に出るパスが
   どれなのか決まらなくなるから。 */
const parts = ["Call generate_image exactly once."];
if (edit) parts.push(`Use this existing image as the input to edit: ${edit.replace(/\\/g, "/")} .`,
                     "Preserve its structure, geometry and detail exactly; change only what the instruction below asks for.");
parts.push(`Aspect ratio ${aspect}.`);
if (flat) parts.push(
  "The result must be a flat orthographic image: no perspective, no wall or table behind it,",
  "no frame, no drop shadow, no vignette. The subject fills the frame edge to edge.");
parts.push(`Subject / instruction: ${subject}`);
parts.push("Do NOT call run_command or any shell tool.",
           "Then print ONLY the absolute path of the generated file, nothing else.");
const prompt = parts.join(" ");

const args = ["-p", prompt, "--output-format", "json", "--print-timeout", timeout];
if (conversation) args.push("--conversation", conversation);

let raw;
try {
  raw = execFileSync("agy", args, { encoding: "utf8", maxBuffer: 1 << 24 });
} catch (e) {
  console.error("agy failed:", e.stdout || e.stderr || e.message);
  process.exit(1);
}

/* 念のため「JSON として読める最後の行」を採る。将来 agy が警告行を
   先に吐くようになっても壊れないようにしておく。 */
let env = null;
for (const line of raw.split(/\r?\n/)) {
  const s = line.trim();
  if (!s.startsWith("{")) continue;
  try { env = JSON.parse(s); } catch { /* JSON でない行は捨てる */ }
}
if (!env) { console.error("could not parse agy output as JSON:\n" + raw); process.exit(1); }
if (env.status !== "SUCCESS") { console.error(`agy status=${env.status}:\n` + raw); process.exit(1); }

const src = String(env.response || "").trim().replace(/^["']|["']$/g, "");
if (!src || !existsSync(src)) {
  // ここに来るのは大抵、モデルがパスだけでなく説明も返したか、
  // run_command が自動拒否されて画像が作られなかったとき。
  console.error("agy did not report a usable image path. raw response was:\n" + JSON.stringify(env.response));
  process.exit(1);
}

const dst = resolve(out);
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`saved ${dst}`);
console.log(`  from ${src}`);
console.log(`  conversation ${env.conversation_id}  (${env.duration_seconds.toFixed(1)}s)`);
console.log(`  iterate with: --conversation ${env.conversation_id}`);
