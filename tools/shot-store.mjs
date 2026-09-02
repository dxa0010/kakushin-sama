/* ============================================================
   Steam ストア用スクリーンショット・ハーネス（P6-2）
   ------------------------------------------------------------
   tools/shot.mjs との違いは3つ。造形の検分ではなく**売るための絵**を撮る。

   (1) **1920x1080**。Steam の要件は「1920x1080 以上・16:9」。
       shot.mjs は 1280x800（造形検分用の 16:10）なので流用できない。
   (2) **HUD を残す。** Steam の規約はスクリーンショットに
       「ゲームプレイのみ。コンセプトアート・ムービー・受賞歴・宣伝文は不可」を課す。
       HUD を消すとレンダリング作品に見えてしまい、規約の趣旨から外れる。
   (3) **状態を作ってから撮る。** 書類検分・怪人の出現・e-Tax・隠れは
       通常の探索では同時に撮れないので、__dbg 経由で状態を組み立てる。

   ⚠️ **明るさに手を入れないこと。** `--light`（inspectLight）は造形検分用で、
   実際のゲームより明るい。ストアの絵で使うと「買ったら真っ暗だった」になる。
   ここでは意図的に公開していない。暗いのが本作の見た目である。

   前提: リポジトリルートで `python -m http.server 8765`
   実行: playwright は npm のグローバルにしかなく ESM は NODE_PATH を無視するので、
         このファイルを playwright のあるディレクトリへコピーして実行する。
     cp tools/shot-store.mjs "$APPDATA/npm/node_modules/"
     cd "$APPDATA/npm/node_modules"
     node shot-store.mjs --out C:/tmp/store            # 全部
     node shot-store.mjs --out C:/tmp/store s2_doc     # 名前を指定

   オプション:
     --out <dir>      出力先（既定 C:/tmp/store）
     --locale <loc>   ja | en | zh-Hans | ru | es（既定 ja）。英語ストア用は en で撮り直す
   ============================================================ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 撮影する状態。setup は page.evaluate に渡してブラウザ側で走る。
   カメラは [視点x, 視点z, 対象x, 対象y, 対象z]（視点の高さは常に目線 1.6）。 */
const SHOTS = {
  /* 1) 主光源が PC 画面だけの机。**引きの1枚目**。
        「深夜・締切前夜・書類」が1枚で伝わる。ライブラリのヒーロー下地にも使う。 */
  s1_desk: { cam: [6.85, -3.60, 6.85, 1.13, -2.10] },

  /* 2) 書類検分（異変あり）。**本作の核**。
        label = 項目名の混同文字（Amount→Arnount / 金→全）。
        「読んで気づく」ゲームだと伝わる唯一の絵なので、必ず1枚は入れる。 */
  s2_doc: {
    cam: [6.85, -3.60, 6.85, 1.13, -2.10],
    setup: () => {
      const d = window.__dbg;
      const it = d.ITEMS.find(i => i.id === "iryohi");
      it.copy = { fake: true, anomId: "label", seed: 20260902 };
      d.openInspect(it);
    },
    wait: 900,
  },

  /* 3) 怪人。玄関側に立たせ、居間から懐中電灯を当てて見る。
        ⚠️ 寄りすぎない。本作の怪人は**遠くに居ることが怖い**設計で、
        寄って撮ると造形の粗（P8-2 が未完）がそのまま出る。3〜4m が上限。 */
  s3_monster: {
    cam: [3.50, -1.00, 6.50, 1.30, -4.40],
    setup: () => {
      const d = window.__dbg;
      d.monster.visible = true;
      d.monster.position.set(6.5, 0, -4.4);
      d.monster.rotation.y = Math.atan2(3.5 - 6.5, -1.0 - (-4.4));
      d.mob.x = 6.5; d.mob.z = -4.4;
    },
    wait: 600,
  },

  /* 4) 部屋の引き。間取りと「探索するゲーム」だと伝わる絵。 */
  s4_room: { cam: [-1.80, 4.20, 1.20, 1.00, -3.60] },

  /* 5) e-Tax の暗証番号ゲート。**パズルがあると伝わる絵**。
        4桁マスクとカウントダウンが同時に写る。 */
  s5_etax: {
    cam: [6.85, -3.60, 6.85, 1.13, -2.10],
    setup: () => { window.__dbg.openEtax(); },
    wait: 1200,
  },

  /* 6) 2枚目の書類。**言語を読めなくても「おかしい」と分かる異変**を選ぶ。
        four（数値がすべて4）は字が読めなくても数字で伝わるので、英語圏ストア向けに効く。
        s2 の label（混同文字）が「読ませる」側の代表、こちらが「見せる」側の代表。

        ⚠️ mirror / ju / mark / blur / stamp / eye は**使えない**。
        anoms.js は `spec.flags.*` に書くが drawDoc は `spec.*` を読むので、
        この6種は書類の見た目に一切出ない（実測。詳細は docs/STEAM-RELEASE.md §15）。 */
  s6_doc2: {
    cam: [6.85, -3.60, 6.85, 1.13, -2.10],
    setup: () => {
      const d = window.__dbg;
      const it = d.ITEMS.find(i => i.id === "shiharai");
      it.copy = { fake: true, anomId: "four", seed: 315 };
      d.openInspect(it);
    },
    wait: 900,
  },

  /* 7) 壁のポスターの異変。**異変は書類だけではない**と伝わる絵。
        startOmen() は前兆を4種からランダムに選ぶので、poster が当たるまで振り直す。
        ⚠️ **必ず最後に撮る。** 振り直しの過程で clock の前兆（時計が 56:71 になる）も
        引き当ててしまい、その状態は解除する口が __dbg に無い。後続の絵に漏れる。 */
  s7_poster: {
    cam: [-3.40, -4.60, -3.40, 1.70, -5.97],
    setup: () => {
      const d = window.__dbg;
      for (let i = 0; i < 60 && d.visit.omen !== "poster"; i++) d.startOmen();
    },
    wait: 500,
  },
};

const argv = process.argv.slice(2);
let OUT = "C:/tmp/store", LOCALE = "ja";
const names = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") OUT = argv[++i];
  else if (argv[i] === "--locale") LOCALE = argv[++i];
  else names.push(argv[i]);
}
const unknown = names.filter(n => !(n in SHOTS));
if (unknown.length) { console.error("unknown shot:", unknown.join(", ")); process.exit(1); }
const shots = Object.entries(SHOTS).filter(([n]) => !names.length || names.includes(n));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--ignore-gpu-blocklist", "--enable-webgl"],
});
// deviceScaleFactor は 1 のまま。2 にすると 3840x2160 になるが SwiftShader では現実的でない。
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", e => console.log("PAGE-EXC:", e.message));

// ロケールは save に書いてから読み込ませる（applyLocale は起動時に一度だけ走る）。
await page.addInitScript((loc) => {
  try {
    const k = "kakushin_save_v1";
    const s = JSON.parse(localStorage.getItem(k) || "{}") || {};
    s.locale = loc;
    localStorage.setItem(k, JSON.stringify(s));
  } catch (e) {}
}, LOCALE);

await page.goto("http://localhost:8765/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.click("#startBtn").catch(() => {});
await page.waitForFunction(() => window.__dbg && window.__dbg.st() === "PLAY", { timeout: 20000 });
// 導入文（notice）が画に被る。shot.mjs の実測どおり 9 秒待たないと消えきらない。
await page.waitForTimeout(9000);

for (const [name, sh] of shots) {
  // 状態は撮るたびに戻す。前の撮影の overlay が残ると次が撮れない。
  await page.evaluate(() => {
    const d = window.__dbg;
    document.getElementById("inspect").classList.add("hidden");
    document.getElementById("etax").classList.add("hidden");
    d.monster.visible = false;
    d.ply.hidden = false;
  });

  const [px, pz, tx, ty, tz] = sh.cam;
  await page.evaluate(({ px, pz, tx, ty, tz }) => {
    const d = window.__dbg;
    d.ply.x = px; d.ply.z = pz;
    const dx = tx - px, dz = tz - pz, dist = Math.hypot(dx, dz);
    d.ply.yaw = Math.atan2(-dx, -dz);
    d.ply.pitch = Math.asin(Math.max(-1, Math.min(1, (ty - 1.6) / Math.hypot(dist, ty - 1.6))));
  }, { px, pz, tx, ty, tz });

  if (sh.setup) await page.evaluate(sh.setup);
  await page.waitForTimeout(sh.wait || 350);
  /* 導入の字幕（「3月15日 21:00 —— 自宅。」）は 9 秒待っても消えない。
     プレイヤーが動くまで出したままにする作りなので、時間では解けない。
     字幕そのものはゲームプレイの一部だが、**画面中央で被って構図を潰す**ので、
     シャッターの直前だけ空にする。描画（canvas）には触っていない。 */
  await page.evaluate(() => {
    for (const id of ["subtitle", "notice"]) {
      const el = document.getElementById(id);
      if (el) el.textContent = "";
    }
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", `${OUT}/${name}.png`);
}
await browser.close();
