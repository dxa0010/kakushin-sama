/* UI 文言の多言語化（P2-9）。
 * 仕様書: docs/test-specs/ui-i18n.md
 *
 * 純粋モジュール。DOM・three・localStorage・Math.random・Date を触らない。
 * anoms.js と同じ規律で、**既定値を持たない**。未知のロケールは例外にする。
 * 黙って日本語に落ちる作りにすると、未訳が実機まで見つからない。
 *
 * 対象は「ゲームの中身としてユーザが触れるもの」。
 * クレジット画面（#credits）はライセンス表記の義務で置いてあるものなので、
 * **意図的に日本語のまま**にしてある（翻訳しないこと。仕様書 §1.1 / §3.4）。
 *
 * 日付・金額・氏名は直書きしない。{deadline} などの差し込み記号を持ち、
 * 呼び出し側が deadline() / formatMoney() / localeText().playerName から埋める。
 * 直書きすると、期限を変えたときに文言だけ古くなる（仕様書 §3.3）。
 */

export const UI_LOCALES = ["ja", "en", "zh-Hans", "ru", "es"];

function assertLocale(locale) {
  if (!UI_LOCALES.includes(locale)) {
    throw new Error(
      `未対応の locale です（受け取った値: ${JSON.stringify(locale)}／対応: ${UI_LOCALES.join(", ")}）`
    );
  }
}

/* ============================================================
   日本語（基準）
   ここが一次資料。他言語はこの構造をそのまま写す。
   ============================================================ */
const T = {};

T.ja = {
  // ---- HUD ----
  datebar: "{deadline} ── 自宅",
  hideOverlay: "クローゼットの中 ── 時計は、止まらない",
  promptInspect: "［E］書類を検分する",
  promptExamine: "［E］調べる",
  promptEtax: "［E］e-Taxを開く",
  promptHide: "［E］クローゼットに隠れる",
  promptUnhide: "［E］クローゼットを出る",
  pcNotEnough: "PC ── 書類が足りない（{got}/5）",

  // ---- タイトル ----
  titleSub: "確定申告からは逃げられない",
  titleBrand: "KAKUSHIN — NO ESCAPE FROM YOUR TAX RETURN",
  premise1: "{deadline}、午後9時。あなたの名前は「{name}」。",
  premise2: "まだ、何もやっていない。",
  premise3: "書類を5つ集め、e-Taxで送信せよ。",
  premise4: "ただし──部屋の書類には、偽物が混ざっている。",
  premise5: "期限は今夜、23時59分。",
  modeWhite: "白色申告",
  modeBlue: "青色申告",
  modeBlueLocked: "青色申告（還付ENDで解禁）",
  start: "開 始",
  again: "もう一度",
  ctrlPc: "移動：WASD ／ 視点：マウス ／ 調べる：E またはクリック ／ ミュート：M",
  ctrlTouch: "スマホ：左スティック移動 ／ 右スティック視点 ／ ボタンで調べる",
  ctrlHint1: "書類は拾う前に検分できる。偽物には一箇所だけ「ありえない」がある。",
  ctrlHint2: "偽物のまま送信すると、審査で却下され──あれが、来る。",
  ctrlHint3: "{monster}は常には居ない。だが、部屋の異変は前触れだ。クローゼットには隠れられる。",
  saveLine: "異変図鑑 {found}/{total} ／ エンディング {endings}/{endTotal}",
  saveBest: " ／ 最高ランク {rank}",

  // ---- 検分 ----
  inspectHint1: "よく見ろ。偽物には、どこか一箇所だけ「ありえない」がある。",
  inspectHint2: "検分している間も、時計は進む。",
  inspectTake: "本物だ ── 受け取る",
  inspectTear: "偽物だ ── 破り捨てる",
  inspectBack: "保留する ── 手放す",

  // ---- ポーズ／設定 ----
  pauseTitle: "一時停止",
  pauseNote: "時計は止まっている",
  optVolume: "音量",
  optSens: "マウス感度",
  optGamma: "明るさ",
  optQuality: "画質",
  qualityAuto: "自動",
  qualityHigh: "高（PC向け）",
  qualityLow: "軽量（スマホ向け）",
  clickToLook: "画面をクリックすると視点が戻る",
  optLang: "言語 / Language",
  resume: "再開する",
  credits: "クレジット",
  toTitle: "タイトルへ戻る",
  back: "戻る",
  creditsTitle: "クレジット",
  creditsScrollHint: "▼ スクロールすると続きがあります",
  muted: "ミュート",
  volumeAt: "音量 {pct}%",

  // ---- e-Tax ----
  etaxTitle: "e-Tax（国税電子申告・納税システム）",
  etaxSubtitle: "{taxYear} 所得税及び復興特別所得税の申告",
  etaxReady1: "申告書データの作成が完了しました。",
  etaxReady2: "内容を確認のうえ、送信してください。",
  etaxPinAsk: "マイナンバーカードの暗証番号（4桁）を入力してください。",
  etaxSend: "送信する",
  etaxSending: "送信中──審査しています…",
  etaxRejected: "審査結果：<b>却下</b>　『{doc}』──{why}。<br>該当書類は差し戻されました。<span style=\"opacity:.7\">……部屋のどこかへ。</span>",
  etaxAccepted: "受付結果：受付完了　受付番号 {receipt}",
  pinAttemptsLeft: "残り{n}回です。",
  pinWrong: "暗証番号が違います。残り{n}回です。",
  pinLastChance: "<br>次に間違えるとカードがロックされます。<br>",
  pinLocked: "暗証番号が違います。カードがロックされました。<br>再登録は市役所の窓口でのみ受け付けます。",
  pinFormat: "4桁の数字で入力してください。",
  cardLocked: "カードがロックされています。市役所の窓口でのみ再登録できます。",

  // ---- 通知・演出 ----
  noticeStartWhite: "{deadline} 21:00 ── 自宅。<br>まだ、何もやっていない。<br><span style=\"opacity:.6\">……今夜の書類は、どこか様子がおかしい。</span>",
  noticeStartBlue: "{deadline} 21:00 ── 自宅。<br>青色申告。書類は多く、偽物は巧妙だ。<br><span style=\"opacity:.6\">……今夜は、あちらも本気らしい。</span>",
  noticePhone: "スマホ：<b>【{authority}】確定申告の期限が近づいています</b><br>提出期限：{deadline} 23:59",
  noticeTv: "テレビ「確定申告は、お早めに」",
  notice22: "22:00 ── 部屋が、暗くなった気がする。",
  notice23: "23:00 ── 冷蔵庫が、止まった。<br>部屋が、静かになりすぎた。あと1時間しかない。",
  noticeTorn: "破り捨てた。<br><span style=\"opacity:.65\">……紙を裂く音が、静かな部屋に響いた。</span>",
  noticeBailed: "手放した。<br><span style=\"opacity:.65\">……その書類は、部屋のどこかへ紛れた。</span>",
  noticeNotEnough: "書類がまだ足りない。（{got} / 5）",
  omenEntered: "── 何かが、部屋に入ってきた。",
  omenLookedUp: "──顔を上げた。",
  omenGone: "……気配が、消えた。",
  omenThere: "──顔を上げると、そこに居た。",
  monsterLine: "「提出期限は、{deadlineNext}です」",
  monsterLineBare: "提出期限は、{deadlineNext}です",
  seen: "見られている。隠れられない！",
  tooBusy: "それどころじゃない！",

  // ---- アイテム（短縮名は anoms.js 側。ここは説明文） ----
  // 【暗証番号の手掛かり①：形式】必須アイテムなので、桁数と「数字だけ」は必ず伝わる
  gagShiharai: "支払調書の束。1月に届いていた。開封すらしていなかった。",
  gagIryohi: "医療費のレシート束。一部、インクが消えて金額が読めない。",
  gagMycard: "マイナンバーカード。電子証明書の期限は……セーフ。<br>あと2ヶ月だった。暗証番号は4桁。数字だけの、あれだ。",
  gagPrior: "ICカードリーダー。テレビの裏に落ちていた。3年前に買って、使ったのは1回だけ。",
  // 【暗証番号の手掛かり②：探索への誘導】『いつもの』で行き止まりにしない
  gagPassword: "e-Taxパスワードのメモ。『いつもの』と書いてある。どれだ。<br>……他の紙にも書き残していた気がする。<br>部屋に、何か落ちていなかったか。",
  // 【暗証番号の手掛かり③】3つ揃うと「いつもの4桁＝期限の日付」に辿り着く。
  // **日付は必ずそのロケールの期限に合わせること**（仕様書 §3.2）。
  gagFake1: "ふるさと納税の証明書……ワンストップ特例で提出済みだ。<br>寄付サイトのログインも『いつもの』にした。<br>どのサイトも、同じ4桁を使い回している。",
  gagFake2: "医療費控除の明細書……よく見たら去年の日付だった。<br>去年もこの時期、同じ4桁を打ち込んだ。<br>日付をそのまま並べただけの、覚えやすいあれを。",
  gagFake3: "領収書の束——中身は全部、深夜の牛丼屋のものだった。<br>日付は毎年、{mon}{d1}日と{d2}日に集中している。<br>この2日だけ、生活が壊れる。",

  // ---- 結末 ----
  endRefundTag: "還付 END",
  endRefundText: "受付完了。<br>あなたは生き延びた。<br><br>還付金：{money}",
  endLateTag: "期限後申告 END",
  endLateText: "{deadlineNext} 0:00。<br>{monster}は、静かに頭を下げた。<br>「期限後申告について、ご案内します」<br><br>無申告加算税があなたに課された。",
  endSermonTag: "説教 END",
  endSermonText: "捕まった。<br><br>あなたは税務署で3時間、丁寧に説教された。<br>担当者は、最後までずっと敬語だった。",
  endCityTag: "市役所 END",
  endCityText: "マイナンバーカードがロックされた。<br>再登録は市役所の窓口でのみ受け付けている。<br>市役所は平日9時〜17時。<br><br>今夜、あなたはe-Taxで送信できなかった。",

  // ---- 結果画面 ----
  resultHead: "今夜の書類 ── 答え合わせ",
  resultGenuine: "本物",
  resultFake: "偽物〈{anom}〉",
  resultFakeUnknown: "偽物〈？？？〉",
  actTake: "受理",
  actTear: "破棄",
  rankLine: "{blue}判定ランク　{rank}",
  blueTag: "【青色】",
  rankS: "S ── 国税査察官",
  rankA: "A ── 税理士",
  rankB: "B ── 経理のベテラン",
  rankC: "C ── 一般納税者",
  rankD: "D ── 駆け込み申告者",
  rankPerfect: "──完璧な申告。書類を見る目が、あなたを守った。",
  rankMistakes: "──却下{rejects}件、本物の破棄{torn}件。だいぶ疑われた。",
  codex: "異変図鑑　{found} / {total}",
  codexNew: "NEW　{names}",
  blueUnlocked: "高難度モード『青色申告』が解禁された。",

  // ---- 3D 看板・ポスター（世界の一部なので翻訳する） ----
  signPay: "納",
  signTax: "税",
  signDo1: "シ",
  signDo2: "ロ",
  posterTitle: "確定申告",
  posterAsk: "お済みですか",
  posterHeavy: "重加算税",
};

T.en = {
  // ---- HUD ----
  datebar: "{deadline} ── Home",
  hideOverlay: "Inside the closet ── the clock does not stop",
  promptInspect: "[E] Inspect the document",
  promptExamine: "[E] Examine",
  promptEtax: "[E] Open e-File",
  promptHide: "[E] Hide in the closet",
  promptUnhide: "[E] Leave the closet",
  pcNotEnough: "PC ── not enough documents ({got}/5)",

  // ---- タイトル ----
  titleSub: "No Escape from Your Tax Return",
  // sub2 と同じ文になるため、ここはブランド名だけにする（二重表示を避ける）。
  titleBrand: "KAKUSHIN",
  premise1: "{deadline}, 9 PM. Your name is \"{name}\".",
  premise2: "You have not started.",
  premise3: "Gather five documents and file them through e-File.",
  premise4: "But ── some of the papers in this room are forgeries.",
  premise5: "The deadline is tonight, 11:59 PM.",
  modeWhite: "Standard Return",
  modeBlue: "Itemized Return",
  modeBlueLocked: "Itemized Return (unlocked by the Refund ending)",
  start: "S T A R T",
  again: "Play again",
  ctrlPc: "Move: WASD / Look: mouse / Examine: E or click / Mute: M",
  ctrlTouch: "Touch: left stick to move / right stick to look / button to examine",
  ctrlHint1: "You can inspect a document before picking it up. A forgery has exactly one impossible thing.",
  ctrlHint2: "Submit a forgery and it will be rejected in review ── and then, it comes.",
  ctrlHint3: "{monster} is not always present. But a disturbance in the room is a warning. You can hide in the closet.",
  saveLine: "Anomaly codex {found}/{total} / Endings {endings}/{endTotal}",
  saveBest: " / Best rank {rank}",

  // ---- 検分 ----
  inspectHint1: "Look closely. A forgery has exactly one thing that cannot possibly be there.",
  inspectHint2: "The clock keeps running while you inspect.",
  inspectTake: "Genuine ── accept it",
  inspectTear: "Forged ── tear it up",
  inspectBack: "Set it aside ── let it go",

  // ---- ポーズ/設定 ----
  pauseTitle: "Paused",
  pauseNote: "The clock has stopped",
  optVolume: "Volume",
  optSens: "Mouse sensitivity",
  optGamma: "Brightness",
  optQuality: "Graphics",
  qualityAuto: "Auto",
  qualityHigh: "High (desktop)",
  qualityLow: "Light (mobile)",
  clickToLook: "Click the screen to regain mouse look",
  optLang: "言語 / Language",
  resume: "Resume",
  credits: "Credits",
  toTitle: "Back to title",
  back: "Back",
  creditsTitle: "Credits",
  creditsScrollHint: "▼ Scroll for more",
  muted: "Muted",
  volumeAt: "Volume {pct}%",

  // ---- e-Tax ----
  etaxTitle: "e-File (Electronic Filing System)",
  etaxSubtitle: "{taxYear} Individual Income Tax Return",
  etaxReady1: "Your return has been prepared.",
  etaxReady2: "Review the contents and submit.",
  etaxPinAsk: "Enter the 4-digit PIN for your identity card.",
  etaxSend: "Submit",
  etaxSending: "Submitting ── under review…",
  etaxRejected: "Result: <b>REJECTED</b> — \"{doc}\" ── {why}.<br>The document has been returned to you.<span style=\"opacity:.7\">…somewhere in the room.</span>",
  etaxAccepted: "Result: Accepted — Receipt no. {receipt}",
  pinAttemptsLeft: "{n} attempts remaining.",
  pinWrong: "Incorrect PIN. {n} attempts remaining.",
  pinLastChance: "<br>One more failure will lock the card.<br>",
  pinLocked: "Incorrect PIN. The card is now locked.<br>It can only be re-registered at a government office counter.",
  pinFormat: "Enter four digits.",
  cardLocked: "The card is locked. It can only be re-registered at a government office counter.",

  // ---- 通知・演出 ----
  noticeStartWhite: "{deadline} 9:00 PM ── home.<br>You have not started.<br><span style=\"opacity:.6\">…something about tonight's paperwork is off.</span>",
  noticeStartBlue: "{deadline} 9:00 PM ── home.<br>Itemized return. More documents, subtler forgeries.<br><span style=\"opacity:.6\">…tonight, it is serious too.</span>",
  noticePhone: "Phone: <b>[{authority}] Your filing deadline is approaching</b><br>Deadline: {deadline} 11:59 PM",
  noticeTv: "TV: \"File early, file safely.\"",
  notice22: "10:00 PM ── the room feels darker than before.",
  notice23: "11:00 PM ── the refrigerator stopped.<br>The room has gone too quiet. One hour left.",
  noticeTorn: "Torn up.<br><span style=\"opacity:.65\">…the sound of tearing paper filled the quiet room.</span>",
  noticeBailed: "You let it go.<br><span style=\"opacity:.65\">…that document is somewhere else in the flat now.</span>",
  noticeNotEnough: "Still not enough documents. ({got} / 5)",
  omenEntered: "── something has entered the room.",
  omenLookedUp: "── it raised its head.",
  omenGone: "…the presence is gone.",
  omenThere: "── you looked up, and it was there.",
  monsterLine: "\"The filing deadline is {deadlineNext}.\"",
  monsterLineBare: "The filing deadline is {deadlineNext}",
  seen: "You have been seen. You cannot hide!",
  tooBusy: "No time for that!",

  // ---- アイテム ----
  gagShiharai: "A stack of 1099-NEC forms. They arrived in January. You never opened them.",
  gagIryohi: "A bundle of medical receipts. On some, the ink has faded and the amount is unreadable.",
  gagMycard: "Your identity card. The certificate expiry date… still valid, barely.<br>Two months to spare. The PIN is four digits. Digits only, that one.",
  gagPrior: "A card reader. It was behind the TV. Bought three years ago, used exactly once.",
  gagPassword: "A note with the e-File password. It says \"the usual one\". Which one.<br>…you think you wrote it down on other papers too.<br>Wasn't there something on the floor.",
  gagFake1: "A charitable donation receipt… already filed under the simplified rule.<br>You used \"the usual one\" to log into the donation sites too.<br>Every site, the same four digits.",
  gagFake2: "A medical deduction statement… on a closer look, it is last year's.<br>You typed the same four digits this time last year.<br>The easy one ── just a date, the digits straight in order.",
  gagFake3: "A bundle of receipts — all of them from late-night diners.<br>Every year the dates cluster on {mon} {d1} and {d2}.<br>Only on those two days does your life fall apart.",

  // ---- 結末 ----
  endRefundTag: "REFUND END",
  endRefundText: "Accepted.<br>You survived.<br><br>Refund: {money}",
  endLateTag: "LATE FILING END",
  endLateText: "{deadlineNext}, 12:00 AM.<br>{monster} quietly bowed its head.<br>\"Allow me to explain late filing.\"<br><br>A failure-to-file penalty has been imposed on you.",
  endSermonTag: "LECTURE END",
  endSermonText: "Caught.<br><br>You were lectured politely for three hours at the tax office.<br>The officer stayed courteous to the very end.",
  endCityTag: "GOVERNMENT OFFICE END",
  endCityText: "Your identity card is locked.<br>Re-registration is only accepted at a government office counter.<br>They open weekdays, 9 to 5.<br><br>Tonight, you could not file.",

  // ---- 結果画面 ----
  resultHead: "Tonight's documents ── the answers",
  resultGenuine: "Genuine",
  resultFake: "Forged <{anom}>",
  resultFakeUnknown: "Forged <???>",
  actTake: "accepted",
  actTear: "discarded",
  rankLine: "{blue}Rank {rank}",
  blueTag: "[ITEMIZED]",
  rankS: "S ── Revenue Investigator",
  rankA: "A ── Tax Accountant",
  rankB: "B ── Veteran Bookkeeper",
  rankC: "C ── Ordinary Taxpayer",
  rankD: "D ── Last-Minute Filer",
  rankPerfect: "── a flawless return. Your eye for documents protected you.",
  rankMistakes: "── {rejects} rejected, {torn} genuine ones destroyed. They grew suspicious.",
  codex: "Anomaly codex {found} / {total}",
  codexNew: "NEW {names}",
  blueUnlocked: "Hard mode \"Itemized Return\" has been unlocked.",

  // ---- 3D 看板・ポスター ----
  signPay: "P",
  signTax: "A",
  signDo1: "Y",
  signDo2: "!",
  posterTitle: "TAX RETURN",
  posterAsk: "Have you filed?",
  posterHeavy: "HEAVY PENALTY",
};

T["zh-Hans"] = {
  // ---- HUD ----
  datebar: "{deadline} ── 家中",
  hideOverlay: "衣柜里 ── 时钟不会停",
  promptInspect: "［E］查验文件",
  promptExamine: "［E］查看",
  promptEtax: "［E］打开个税汇算",
  promptHide: "［E］躲进衣柜",
  promptUnhide: "［E］离开衣柜",
  pcNotEnough: "电脑 ── 文件还不够（{got}/5）",

  // ---- タイトル ----
  titleSub: "逃不掉的个税汇算",
  titleBrand: "KAKUSHIN",
  premise1: "{deadline}，晚上九点。你的名字是“{name}”。",
  premise2: "你还什么都没做。",
  premise3: "收集五份文件，通过汇算系统提交。",
  premise4: "但是──房间里的文件中，混着伪造品。",
  premise5: "期限是今晚23:59。",
  modeWhite: "简易申报",
  modeBlue: "综合申报",
  modeBlueLocked: "综合申报（退税结局后解锁）",
  start: "开 始",
  again: "再来一次",
  ctrlPc: "移动：WASD ／ 视角：鼠标 ／ 查看：E 或点击 ／ 静音：M",
  ctrlTouch: "手机：左摇杆移动 ／ 右摇杆视角 ／ 按钮查看",
  ctrlHint1: "文件可以在拾取前查验。伪造品只有一处“不可能”。",
  ctrlHint2: "带着伪造品提交，会在审核中被驳回──然后，那个会来。",
  ctrlHint3: "{monster}并非一直都在。但房间的异变是前兆。可以躲进衣柜。",
  saveLine: "异变图鉴 {found}/{total} ／ 结局 {endings}/{endTotal}",
  saveBest: " ／ 最高评级 {rank}",

  // ---- 検分 ----
  inspectHint1: "仔细看。伪造品一定有一处不可能存在的地方。",
  inspectHint2: "查验的时候，时钟照样在走。",
  inspectTake: "是真的 ── 收下",
  inspectTear: "是假的 ── 撕掉",
  inspectBack: "暂缓 ── 放手",

  // ---- ポーズ／設定 ----
  pauseTitle: "暂停",
  pauseNote: "时钟已经停下",
  optVolume: "音量",
  optSens: "鼠标灵敏度",
  optGamma: "亮度",
  optQuality: "画质",
  qualityAuto: "自动",
  qualityHigh: "高（电脑）",
  qualityLow: "轻量（手机）",
  clickToLook: "点击画面即可恢复视角操作",
  optLang: "言語 / Language",
  resume: "继续游戏",
  credits: "制作名单",
  toTitle: "返回标题",
  back: "返回",
  creditsTitle: "制作名单",
  creditsScrollHint: "▼ 向下滚动还有内容",
  muted: "静音",
  volumeAt: "音量 {pct}%",

  // ---- e-Tax ----
  etaxTitle: "个人所得税综合所得年度汇算",
  etaxSubtitle: "{taxYear} 个人所得税年度汇算申报",
  etaxReady1: "申报表数据已生成。",
  etaxReady2: "请确认内容后提交。",
  etaxPinAsk: "请输入身份证件的四位密码。",
  etaxSend: "提交",
  etaxSending: "提交中──正在审核…",
  etaxRejected: "审核结果：<b>驳回</b>　《{doc}》──{why}。<br>该文件已被退回。<span style=\"opacity:.7\">……回到了房间的某处。</span>",
  etaxAccepted: "受理结果：受理完成　受理编号 {receipt}",
  pinAttemptsLeft: "还剩{n}次。",
  pinWrong: "密码错误。还剩{n}次。",
  pinLastChance: "<br>再错一次，证件就会被锁定。<br>",
  pinLocked: "密码错误。证件已被锁定。<br>只能到办事大厅窗口重新登记。",
  pinFormat: "请输入四位数字。",
  cardLocked: "证件已被锁定。只能到办事大厅窗口重新登记。",

  // ---- 通知・演出 ----
  noticeStartWhite: "{deadline} 21:00 ── 家中。<br>你还什么都没做。<br><span style=\"opacity:.6\">……今晚的文件，总觉得有点不对劲。</span>",
  noticeStartBlue: "{deadline} 21:00 ── 家中。<br>综合申报。文件更多，伪造更精巧。<br><span style=\"opacity:.6\">……今晚，那边也是认真的。</span>",
  noticePhone: "手机：<b>【{authority}】您的汇算期限即将到期</b><br>提交期限：{deadline} 23:59",
  noticeTv: "电视“汇算请尽早办理”",
  notice22: "22:00 ── 房间好像变暗了。",
  notice23: "23:00 ── 冰箱停了。<br>房间安静得过头了。只剩一个小时。",
  noticeTorn: "撕掉了。<br><span style=\"opacity:.65\">……撕纸的声音在安静的房间里回响。</span>",
  noticeBailed: "放手了。<br><span style=\"opacity:.65\">……那份文件已经混进房间的某处。</span>",
  noticeNotEnough: "文件还不够。（{got} / 5）",
  omenEntered: "── 有什么东西，进了房间。",
  omenLookedUp: "──抬起了头。",
  omenGone: "……气息，消失了。",
  omenThere: "──一抬头，它就在那里。",
  monsterLine: "“提交期限是{deadlineNext}”",
  monsterLineBare: "提交期限是{deadlineNext}",
  seen: "被看到了。躲不掉了！",
  tooBusy: "现在顾不上这个！",

  // ---- アイテム ----
  gagShiharai: "一叠劳务报酬凭证。一月就寄到了。你连拆都没拆。",
  gagIryohi: "一叠医疗费收据。有几张墨迹褪了，金额看不清。",
  gagMycard: "身份证件。电子证书的有效期……还好。<br>还剩两个月。密码是四位。只有数字的那个。",
  gagPrior: "读卡器。掉在电视机后面。三年前买的，只用过一次。",
  gagPassword: "写着汇算密码的便条。上面写着“老样子”。是哪个。<br>……好像在别的纸上也写过。<br>房间里，是不是还掉着什么。",
  gagFake1: "公益捐赠票据……已经按简易方式申报过了。<br>捐赠网站的登录也用了“老样子”。<br>每个网站，都是同样的四位数。",
  gagFake2: "医疗费扣除明细……仔细一看是去年的日期。<br>去年这个时候，也输过同样的四位数。<br>就是把日期照着排下来的，那个好记的。",
  gagFake3: "一叠收据——里面全是深夜小吃店的。<br>日期每年都集中在{mon}{d1}日和{d2}日。<br>只有这两天，生活会崩掉。",

  // ---- 結末 ----
  endRefundTag: "退税 结局",
  endRefundText: "受理完成。<br>你活下来了。<br><br>退税款：{money}",
  endLateTag: "逾期申报 结局",
  endLateText: "{deadlineNext} 0:00。<br>{monster}静静地低下了头。<br>“关于逾期申报，容我为您说明”<br><br>你被课以未申报滞纳金。",
  endSermonTag: "训话 结局",
  endSermonText: "被抓住了。<br><br>你在税务局被客客气气地训了三个小时。<br>经办人自始至终都彬彬有礼。",
  endCityTag: "办事大厅 结局",
  endCityText: "身份证件被锁定了。<br>重新登记只能在办事大厅窗口办理。<br>办事大厅工作日9:00到17:00。<br><br>今晚，你没能提交。",

  // ---- 結果画面 ----
  resultHead: "今晚的文件 ── 对答案",
  resultGenuine: "真",
  resultFake: "伪〈{anom}〉",
  resultFakeUnknown: "伪〈？？？〉",
  actTake: "收下",
  actTear: "撕掉",
  rankLine: "{blue}评级　{rank}",
  blueTag: "【综合】",
  rankS: "S ── 税务稽查员",
  rankA: "A ── 税务师",
  rankB: "B ── 资深会计",
  rankC: "C ── 普通纳税人",
  rankD: "D ── 卡点申报者",
  rankPerfect: "──完美的申报。看文件的眼力保护了你。",
  rankMistakes: "──驳回{rejects}件，撕掉真件{torn}件。已经很被怀疑了。",
  codex: "异变图鉴　{found} / {total}",
  codexNew: "NEW　{names}",
  blueUnlocked: "高难度模式《综合申报》已解锁。",

  // ---- 3D 看板・ポスター ----
  signPay: "纳",
  signTax: "税",
  signDo1: "去",
  signDo2: "吧",
  posterTitle: "个税汇算",
  posterAsk: "办好了吗",
  posterHeavy: "加收滞纳金",
};

T.ru = {
  // ---- HUD ----
  datebar: "{deadline} ── дома",
  hideOverlay: "В шкафу ── часы не останавливаются",
  promptInspect: "[E] Осмотреть документ",
  promptExamine: "[E] Осмотреть",
  promptEtax: "[E] Открыть личный кабинет",
  promptHide: "[E] Спрятаться в шкаф",
  promptUnhide: "[E] Выйти из шкафа",
  pcNotEnough: "ПК ── документов не хватает ({got}/5)",

  // ---- タイトル ----
  titleSub: "От налоговой не убежать",
  titleBrand: "KAKUSHIN",
  premise1: "{deadline}, девять вечера. Вас зовут «{name}».",
  premise2: "Вы ещё ничего не сделали.",
  premise3: "Соберите пять документов и подайте декларацию через личный кабинет.",
  premise4: "Но ── среди бумаг в комнате есть подделки.",
  premise5: "Срок ── сегодня до 23:59.",
  modeWhite: "Обычная декларация",
  modeBlue: "Полная декларация",
  modeBlueLocked: "Полная декларация (открывается после концовки «Возврат»)",
  start: "Н А Ч А Т Ь",
  again: "Ещё раз",
  ctrlPc: "Движение: WASD / Обзор: мышь / Осмотр: E или клик / Звук: M",
  ctrlTouch: "Телефон: левый стик ── движение / правый ── обзор / кнопка ── осмотр",
  ctrlHint1: "Документ можно осмотреть до того, как поднять. У подделки ровно одно «так не бывает».",
  ctrlHint2: "Подадите подделку ── её отклонят при проверке, и тогда придёт оно.",
  ctrlHint3: "{monster} здесь не всегда. Но странности в комнате ── это предвестие. В шкафу можно спрятаться.",
  saveLine: "Каталог аномалий {found}/{total} / Концовки {endings}/{endTotal}",
  saveBest: " / Лучший ранг {rank}",

  // ---- 検分 ----
  inspectHint1: "Смотрите внимательно. У подделки ровно одно место, которого быть не может.",
  inspectHint2: "Пока вы осматриваете, часы идут.",
  inspectTake: "Подлинный ── принять",
  inspectTear: "Подделка ── порвать",
  inspectBack: "Отложить ── выпустить из рук",

  // ---- ポーズ/設定 ----
  pauseTitle: "Пауза",
  pauseNote: "Часы остановлены",
  optVolume: "Громкость",
  optSens: "Чувствительность мыши",
  optGamma: "Яркость",
  optQuality: "Графика",
  qualityAuto: "Авто",
  qualityHigh: "Высокая (ПК)",
  qualityLow: "Лёгкая (смартфон)",
  clickToLook: "Нажмите на экран, чтобы вернуть обзор мышью",
  optLang: "言語 / Language",
  resume: "Продолжить",
  credits: "Титры",
  toTitle: "В главное меню",
  back: "Назад",
  creditsTitle: "Титры",
  creditsScrollHint: "▼ Прокрутите, дальше есть ещё",
  muted: "Без звука",
  volumeAt: "Громкость {pct}%",

  // ---- e-Tax ----
  etaxTitle: "Личный кабинет налогоплательщика",
  etaxSubtitle: "Декларация 3-НДФЛ за {taxYear}",
  etaxReady1: "Данные декларации сформированы.",
  etaxReady2: "Проверьте содержимое и отправьте.",
  etaxPinAsk: "Введите четырёхзначный код удостоверения личности.",
  etaxSend: "Отправить",
  etaxSending: "Отправка ── идёт проверка…",
  etaxRejected: "Результат проверки: <b>ОТКАЗ</b> — «{doc}» ── {why}.<br>Документ возвращён вам.<span style=\"opacity:.7\">…куда-то в комнату.</span>",
  etaxAccepted: "Результат: принято — Номер регистрации {receipt}",
  pinAttemptsLeft: "Осталось попыток: {n}.",
  pinWrong: "Неверный код. Осталось попыток: {n}.",
  pinLastChance: "<br>Ещё одна ошибка ── и карта будет заблокирована.<br>",
  pinLocked: "Неверный код. Карта заблокирована.<br>Перерегистрация возможна только в отделении МФЦ.",
  pinFormat: "Введите четыре цифры.",
  cardLocked: "Карта заблокирована. Перерегистрация возможна только в отделении МФЦ.",

  // ---- 通知・演出 ----
  noticeStartWhite: "{deadline} 21:00 ── дома.<br>Вы ещё ничего не сделали.<br><span style=\"opacity:.6\">…с сегодняшними бумагами что-то не так.</span>",
  noticeStartBlue: "{deadline} 21:00 ── дома.<br>Полная декларация. Документов больше, подделки тоньше.<br><span style=\"opacity:.6\">…сегодня и оно взялось всерьёз.</span>",
  noticePhone: "Телефон: <b>[{authority}] Приближается срок подачи декларации</b><br>Срок подачи: {deadline} 23:59",
  noticeTv: "Телевизор: «Подавайте декларацию заранее»",
  notice22: "22:00 ── кажется, в комнате стало темнее.",
  notice23: "23:00 ── холодильник затих.<br>В комнате стало слишком тихо. Остался час.",
  noticeTorn: "Порвано.<br><span style=\"opacity:.65\">…звук рвущейся бумаги разнёсся по тихой комнате.</span>",
  noticeBailed: "Вы отпустили его.<br><span style=\"opacity:.65\">…этот документ теперь где-то в квартире.</span>",
  noticeNotEnough: "Документов всё ещё не хватает. ({got} / 5)",
  omenEntered: "── что-то вошло в комнату.",
  omenLookedUp: "──оно подняло голову.",
  omenGone: "…присутствие исчезло.",
  omenThere: "──вы подняли голову, и оно было там.",
  monsterLine: "«Срок подачи ── {deadlineNext}»",
  monsterLineBare: "Срок подачи ── {deadlineNext}",
  seen: "Вас увидели. Не спрятаться!",
  tooBusy: "Сейчас не до этого!",

  // ---- アイテム ----
  gagShiharai: "Пачка справок о доходах. Пришли ещё в январе. Вы их даже не вскрыли.",
  gagIryohi: "Пачка чеков за лечение. На части чернила выцвели, суммы не разобрать.",
  gagMycard: "Удостоверение личности. Срок сертификата… пронесло.<br>Оставалось два месяца. Код ── четыре знака. Только цифры, тот самый.",
  gagPrior: "Считыватель карт. Валялся за телевизором. Куплен три года назад, использован один раз.",
  gagPassword: "Записка с паролем от кабинета. На ней написано «как обычно». Какой именно.<br>…кажется, вы записывали его и на других бумагах.<br>Не валялось ли чего в комнате.",
  gagFake1: "Справка о благотворительном взносе… уже подана в упрощённом порядке.<br>Для входа на сайты пожертвований вы взяли «как обычно».<br>На всех сайтах ── одни и те же четыре цифры.",
  gagFake2: "Реестр расходов на лечение… приглядевшись, дата прошлогодняя.<br>В это же время в прошлом году вы вводили те же четыре цифры.<br>Тот самый лёгкий код ── просто дата, выписанная подряд.",
  gagFake3: "Пачка чеков — все из ночных забегаловок.<br>Каждый год даты собираются на {d1} и {d2} {mon}.<br>Только в эти два дня жизнь разваливается.",

  // ---- 結末 ----
  endRefundTag: "КОНЦОВКА «ВОЗВРАТ»",
  endRefundText: "Принято.<br>Вы выжили.<br><br>Возврат: {money}",
  endLateTag: "КОНЦОВКА «ПРОСРОЧКА»",
  endLateText: "{deadlineNext}, 0:00.<br>Перед вами {monster}. Оно молча склонило голову.<br>«Позвольте разъяснить порядок подачи с опозданием»<br><br>На вас наложен штраф за непредставление декларации.",
  endSermonTag: "КОНЦОВКА «НОТАЦИЯ»",
  endSermonText: "Попались.<br><br>Вам три часа вежливо читали нотацию в налоговой.<br>Инспектор до самого конца обращался на «вы».",
  endCityTag: "КОНЦОВКА «МФЦ»",
  endCityText: "Удостоверение личности заблокировано.<br>Перерегистрация ── только в отделении МФЦ.<br>Отделение работает по будням с 9 до 17.<br><br>Сегодня вы не смогли подать декларацию.",

  // ---- 結果画面 ----
  resultHead: "Сегодняшние документы ── разбор",
  resultGenuine: "Подлинный",
  resultFake: "Подделка «{anom}»",
  resultFakeUnknown: "Подделка «???»",
  actTake: "принят",
  actTear: "уничтожен",
  rankLine: "{blue}Ранг {rank}",
  blueTag: "[ПОЛНАЯ]",
  rankS: "S ── налоговый инспектор",
  rankA: "A ── налоговый консультант",
  rankB: "B ── опытный бухгалтер",
  rankC: "C ── обычный налогоплательщик",
  rankD: "D ── подающий в последний час",
  rankPerfect: "──безупречная декларация. Вас спас намётанный глаз.",
  rankMistakes: "──отказов: {rejects}, уничтожено подлинных: {torn}. Вас изрядно заподозрили.",
  codex: "Каталог аномалий {found} / {total}",
  codexNew: "NEW {names}",
  blueUnlocked: "Открыт сложный режим «Полная декларация».",

  // ---- 3D 看板・ポスター ----
  // 縦4文字。「ПЛАТ」は単語にならないので НДФЛ（所得税の正式略称）を積む。
  // 事務的な略号がそのまま貼ってあるほうが、この作品の脅しには合う。
  signPay: "Н",
  signTax: "Д",
  signDo1: "Ф",
  signDo2: "Л",
  posterTitle: "ДЕКЛАРАЦИЯ",
  posterAsk: "Вы уже подали?",
  posterHeavy: "ШТРАФ",
};

T.es = {
  // ---- HUD ----
  datebar: "{deadline} ── en casa",
  hideOverlay: "Dentro del armario ── el reloj no se detiene",
  promptInspect: "[E] Examinar el documento",
  promptExamine: "[E] Examinar",
  promptEtax: "[E] Abrir la sede electrónica",
  promptHide: "[E] Esconderse en el armario",
  promptUnhide: "[E] Salir del armario",
  pcNotEnough: "PC ── faltan documentos ({got}/5)",

  // ---- タイトル ----
  titleSub: "De Hacienda no se escapa",
  titleBrand: "KAKUSHIN",
  premise1: "{deadline}, nueve de la noche. Tu nombre es «{name}».",
  premise2: "Todavía no has hecho nada.",
  premise3: "Reúne cinco documentos y preséntalos por la sede electrónica.",
  premise4: "Pero ── entre los papeles de la habitación hay falsificaciones.",
  premise5: "El plazo termina esta noche, a las 23:59.",
  modeWhite: "Declaración simple",
  modeBlue: "Declaración detallada",
  modeBlueLocked: "Declaración detallada (se desbloquea con el final «Devolución»)",
  start: "E M P E Z A R",
  again: "Otra vez",
  ctrlPc: "Moverse: WASD / Mirar: ratón / Examinar: E o clic / Silenciar: M",
  ctrlTouch: "Móvil: stick izquierdo para moverse / derecho para mirar / botón para examinar",
  ctrlHint1: "Puedes examinar un documento antes de recogerlo. Una falsificación tiene exactamente un «esto no puede ser».",
  ctrlHint2: "Si presentas una falsificación, la rechazan en la revisión ── y entonces viene.",
  ctrlHint3: "{monster} no está siempre. Pero las anomalías de la habitación son un aviso. Puedes esconderte en el armario.",
  saveLine: "Catálogo de anomalías {found}/{total} / Finales {endings}/{endTotal}",
  saveBest: " / Mejor rango {rank}",

  // ---- 検分 ----
  inspectHint1: "Fíjate bien. Una falsificación tiene exactamente un punto imposible.",
  inspectHint2: "Mientras examinas, el reloj sigue corriendo.",
  inspectTake: "Auténtico ── aceptarlo",
  inspectTear: "Falso ── romperlo",
  inspectBack: "Aplazar ── soltarlo",

  // ---- ポーズ/設定 ----
  pauseTitle: "Pausa",
  pauseNote: "El reloj está detenido",
  optVolume: "Volumen",
  optSens: "Sensibilidad del ratón",
  optGamma: "Brillo",
  optQuality: "Gráficos",
  qualityAuto: "Automático",
  qualityHigh: "Alta (PC)",
  qualityLow: "Ligera (móvil)",
  clickToLook: "Haz clic en la pantalla para recuperar la vista",
  optLang: "言語 / Language",
  resume: "Continuar",
  credits: "Créditos",
  toTitle: "Volver al título",
  back: "Volver",
  creditsTitle: "Créditos",
  creditsScrollHint: "▼ Desplázate para ver más",
  muted: "Silenciado",
  volumeAt: "Volumen {pct}%",

  // ---- e-Tax ----
  etaxTitle: "Sede electrónica tributaria",
  etaxSubtitle: "Declaración de la Renta {taxYear}",
  etaxReady1: "Los datos de la declaración están preparados.",
  etaxReady2: "Revisa el contenido y preséntala.",
  etaxPinAsk: "Introduce el PIN de cuatro dígitos de tu documento de identidad.",
  etaxSend: "Presentar",
  etaxSending: "Enviando ── en revisión…",
  etaxRejected: "Resultado: <b>RECHAZADA</b> — «{doc}» ── {why}.<br>El documento ha sido devuelto.<span style=\"opacity:.7\">…a algún lugar de la habitación.</span>",
  etaxAccepted: "Resultado: admitida — Número de registro {receipt}",
  pinAttemptsLeft: "Quedan {n} intentos.",
  pinWrong: "PIN incorrecto. Quedan {n} intentos.",
  pinLastChance: "<br>Un fallo más y la tarjeta quedará bloqueada.<br>",
  pinLocked: "PIN incorrecto. La tarjeta ha quedado bloqueada.<br>Solo puede volver a registrarse en una oficina de atención presencial.",
  pinFormat: "Introduce cuatro dígitos.",
  cardLocked: "La tarjeta está bloqueada. Solo puede volver a registrarse en una oficina de atención presencial.",

  // ---- 通知・演出 ----
  noticeStartWhite: "{deadline} 21:00 ── en casa.<br>Todavía no has hecho nada.<br><span style=\"opacity:.6\">…hay algo raro en los papeles de esta noche.</span>",
  noticeStartBlue: "{deadline} 21:00 ── en casa.<br>Declaración detallada. Más documentos y falsificaciones más finas.<br><span style=\"opacity:.6\">…esta noche, el otro también va en serio.</span>",
  noticePhone: "Móvil: <b>[{authority}] Se acerca el plazo de tu declaración</b><br>Plazo: {deadline} 23:59",
  noticeTv: "Televisión: «Presenta la declaración cuanto antes»",
  notice22: "22:00 ── parece que la habitación se ha oscurecido.",
  notice23: "23:00 ── la nevera se ha parado.<br>La habitación se ha quedado demasiado silenciosa. Queda una hora.",
  noticeTorn: "Roto.<br><span style=\"opacity:.65\">…el sonido del papel al rasgarse llenó la habitación en silencio.</span>",
  noticeBailed: "Lo has soltado.<br><span style=\"opacity:.65\">…ese documento está ahora en otra parte del piso.</span>",
  noticeNotEnough: "Aún faltan documentos. ({got} / 5)",
  omenEntered: "── algo ha entrado en la habitación.",
  omenLookedUp: "──levantó la cabeza.",
  omenGone: "…la presencia ha desaparecido.",
  omenThere: "──levantaste la vista, y estaba ahí.",
  monsterLine: "«El plazo de presentación es el {deadlineNext}»",
  monsterLineBare: "El plazo de presentación es el {deadlineNext}",
  seen: "Te ha visto. ¡No puedes esconderte!",
  tooBusy: "¡No es momento para eso!",

  // ---- アイテム ----
  gagShiharai: "Un montón de certificados de retenciones. Llegaron en enero. Ni los abriste.",
  gagIryohi: "Un fajo de recibos médicos. En algunos la tinta se ha borrado y no se lee el importe.",
  gagMycard: "Tu documento de identidad. La validez del certificado… por los pelos.<br>Quedaban dos meses. El PIN es de cuatro dígitos. Solo números, ese de siempre.",
  gagPrior: "Un lector de tarjetas. Estaba detrás del televisor. Comprado hace tres años, usado una sola vez.",
  gagPassword: "Una nota con la contraseña de la sede. Pone «la de siempre». Cuál.<br>…crees que también la anotaste en otros papeles.<br>¿No había algo tirado por la habitación?",
  gagFake1: "Un certificado de donación… ya presentado por el procedimiento simplificado.<br>Para entrar en las webs de donaciones también usaste «la de siempre».<br>En todas, los mismos cuatro dígitos.",
  gagFake2: "Un desglose de gastos médicos… mirándolo bien, es del año pasado.<br>Por estas fechas, el año pasado, tecleaste los mismos cuatro dígitos.<br>Ese tan fácil: la fecha puesta tal cual, uno detrás de otro.",
  gagFake3: "Un fajo de recibos — todos de bares de madrugada.<br>Cada año las fechas se concentran en el {d1} y el {d2} de {mon}.<br>Solo esos dos días se te descuadra la vida.",

  // ---- 結末 ----
  endRefundTag: "FINAL «DEVOLUCIÓN»",
  endRefundText: "Admitida.<br>Has sobrevivido.<br><br>Devolución: {money}",
  endLateTag: "FINAL «FUERA DE PLAZO»",
  endLateText: "{deadlineNext}, 0:00.<br>{monster} inclinó la cabeza en silencio.<br>«Permítame explicarle la presentación fuera de plazo»<br><br>Se te ha impuesto un recargo por no declarar.",
  endSermonTag: "FINAL «SERMÓN»",
  endSermonText: "Te han atrapado.<br><br>Te sermonearon con toda educación durante tres horas en la delegación.<br>El funcionario te trató de usted hasta el final.",
  endCityTag: "FINAL «OFICINA»",
  endCityText: "Tu documento de identidad ha quedado bloqueado.<br>Volver a registrarlo solo se hace en una oficina presencial.<br>Abren de lunes a viernes, de 9 a 17.<br><br>Esta noche no has podido presentar la declaración.",

  // ---- 結果画面 ----
  resultHead: "Los documentos de esta noche ── las respuestas",
  resultGenuine: "Auténtico",
  resultFake: "Falso «{anom}»",
  resultFakeUnknown: "Falso «???»",
  actTake: "aceptado",
  actTear: "destruido",
  rankLine: "{blue}Rango {rank}",
  blueTag: "[DETALLADA]",
  rankS: "S ── inspector de Hacienda",
  rankA: "A ── asesor fiscal",
  rankB: "B ── contable veterano",
  rankC: "C ── contribuyente corriente",
  rankD: "D ── declarante de última hora",
  rankPerfect: "──una declaración impecable. Tu ojo para los papeles te protegió.",
  rankMistakes: "──{rejects} rechazos y {torn} auténticos destruidos. Levantaste bastantes sospechas.",
  codex: "Catálogo de anomalías {found} / {total}",
  codexNew: "NEW {names}",
  blueUnlocked: "Se ha desbloqueado el modo difícil «Declaración detallada».",

  // ---- 3D 看板・ポスター ----
  signPay: "P",
  signTax: "A",
  signDo1: "G",
  signDo2: "A",
  posterTitle: "LA RENTA",
  posterAsk: "¿Ya la has hecho?",
  posterHeavy: "RECARGO",
};

/* ============================================================
   公開 API
   ============================================================ */

/** そのロケールの UI 文言をまるごと返す。差し込み記号は未解決のまま。 */
export function uiText(locale) {
  assertLocale(locale);
  return { ...T[locale] };
}

/** 文言に含まれる差し込み記号（{name} など）の一覧。テストと fill が使う。 */
export function placeholdersIn(s) {
  return [...String(s).matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]);
}

/** 差し込み記号を values で埋める。
 * **埋め忘れは例外にする。** 黙って {deadline} のまま表示すると、
 * その言語だけ穴あきの文章が出て、しかも気付きにくい。 */
export function fill(template, values) {
  const missing = [];
  const out = String(template).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, key) => {
    if (!(key in values)) { missing.push(key); return whole; }
    return String(values[key]);
  });
  if (missing.length) {
    throw new Error(
      `差し込み記号が埋まっていません: ${[...new Set(missing)].map((k) => `{${k}}`).join(", ")}` +
      `／対象: ${String(template).slice(0, 60)}`
    );
  }
  return out;
}

/** 全ロケールのキー集合（テスト用）。 */
export function uiKeys() {
  return Object.keys(T.ja).sort();
}

/* ============================================================
   日付の書式（差し込み用）
   ------------------------------------------------------------
   Date を使わない（純粋モジュールを保つ）。うるう年は考慮しない ──
   対象の期限は 3/15・4/15・4/30・6/30 で、2月に掛からないため。
   もし2月の期限を足すなら、ここを直すこと。
   ============================================================ */
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MONTH_NAME = {
  en: ["January", "February", "March", "April", "May", "June",
       "July", "August", "September", "October", "November", "December"],
  // ロシア語は「30 апреля」＝生格。主格（апрель）ではない。
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня",
       "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
       "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** {month, day} を1日ずらす。月またぎを正しく扱う（6/30 → 7/1）。 */
export function shiftDay({ month, day }, delta) {
  let m = month, d = day + delta;
  if (d < 1) { m -= 1; if (m < 1) m = 12; d = DIM[m - 1]; }
  else if (d > DIM[m - 1]) { m += 1; if (m > 12) m = 1; d = 1; }
  return { month: m, day: d };
}

/** そのロケールの書き方で「月日」を組む。 */
export function formatDate(locale, month, day) {
  assertLocale(locale);
  if (locale === "ja" || locale === "zh-Hans") return `${month}月${day}日`;
  if (locale === "en") return `${MONTH_NAME.en[month - 1]} ${day}`;
  if (locale === "ru") return `${day} ${MONTH_NAME.ru[month - 1]}`;
  return `${day} de ${MONTH_NAME.es[month - 1]}`;   // es
}

/** 「同じ月の2日を並べる」ときに使う月の見出し。
 * 手掛かり③は「期限日とその前日」を並べるので、日付を2回書くと
 * 「3月14日と3月15日」のように冗長になる。月を1回だけ出すために分ける。
 * **前日が同じ月にあることが前提**（期限が1日なら成り立たない）。 */
export function monthLabel(locale, month) {
  assertLocale(locale);
  if (locale === "ja" || locale === "zh-Hans") return `${month}月`;
  if (locale === "en") return MONTH_NAME.en[month - 1];
  if (locale === "ru") return MONTH_NAME.ru[month - 1];
  return MONTH_NAME.es[month - 1];   // es
}
