/* =====================================================================
 * anoms.js ── 異変の多言語データとロジック（ゲーム非依存・純粋関数）
 *
 * 仕様書: docs/test-specs/anoms-i18n.md
 *
 * 【なぜ別ファイルか】ブラウザ無しで node --test から検証できるようにするため。
 * DOM / three / localStorage / Math.random / Date には一切触れない。
 * 乱数は必ず呼び出し側（src/game.js）から `rng` として注入する（L-17）。
 * 暗証番号の正解値はここには書かない（src/pin.js と同じ規律＝L-13a）。
 *
 * 【設計の要点】
 *  - 舞台は日本のまま。通貨は全ロケール ¥、元号は原語の音写（L-1）
 *  - 異変は「現実の税制知識」ではなく「ゲーム内の他の書類との矛盾」で気づける（L-2）
 *  - 文化固有の恐怖は置き換えず、図鑑の由来文で教える（L-3 / codexOrigin）
 *  - 氏名は全ロケールで漢字のまま。読めなくても字形比較で判定できる（L-4 / L-9）
 * ===================================================================== */

export const LOCALES = ["ja", "en", "zh-Hans", "ru", "es"];

/** src/game.js の ANOMS と同じ16種・同じ順序（L-2a）。 */
export const ANOM_IDS = [
  "era", "typo", "minus", "stamp", "name", "mirror", "issuer", "date",
  "soul", "four", "kami", "eye", "blur", "mark", "ju", "label",
];

/** 巧妙系（青色申告で出やすい）。ロケールによらず同一（L-2c）。 */
const SUB_IDS = new Set(["typo", "stamp", "name", "date", "mark", "label"]);

/* =====================================================================
 * ロケール共通の定数
 * ===================================================================== */

const PLAYER_NAME = "三月 十五";   // 暗証番号のフォールバック手掛かりでもある（L-9）
const PLAYER_NAME_ALT = "三月 十六"; // 一字ちがい。十五/十六 は字形が明確に違う
const MINUS = "−";                 // U+2212。U+002D でも括弧記法でもない（L-5）

/* =====================================================================
 * ロケールごとの語彙
 * ===================================================================== */

const TEXT = {
  ja: {
    currency: "¥", eraName: "令和",
    eraGenuine: "令和8年分", eraInf: "令和∞年分", eraBad: "昭和107年分",
    dateGenuine: "令和8年2月14日", dateBad: "令和8年2月30日",
    playerName: PLAYER_NAME, playerNameAlt: PLAYER_NAME_ALT,
    monster: "カクシン様", fakeIssuer: "株式会社カクシン", soul: "魂",
  },
  en: {
    currency: "¥", eraName: "Reiwa",
    eraGenuine: "Reiwa 8", eraInf: "Reiwa ∞", eraBad: "Shōwa 107",
    dateGenuine: "February 14, Reiwa 8", dateBad: "February 30, Reiwa 8",
    playerName: PLAYER_NAME, playerNameAlt: PLAYER_NAME_ALT,
    monster: "Kakushin-sama", fakeIssuer: "Kakushin Co., Ltd.", soul: "Soul",
  },
  "zh-Hans": {
    currency: "¥", eraName: "令和",
    eraGenuine: "令和8年度", eraInf: "令和∞年度", eraBad: "昭和107年度",
    dateGenuine: "令和8年2月14日", dateBad: "令和8年2月30日",
    playerName: PLAYER_NAME, playerNameAlt: PLAYER_NAME_ALT,
    monster: "确信大人", fakeIssuer: "确信株式会社", soul: "灵魂",
  },
  ru: {
    currency: "¥", eraName: "Рэйва",
    eraGenuine: "8 год Рэйва", eraInf: "∞ год Рэйва", eraBad: "107 год Сёва",
    dateGenuine: "14 февраля 8 года Рэйва", dateBad: "30 февраля 8 года Рэйва",
    playerName: PLAYER_NAME, playerNameAlt: PLAYER_NAME_ALT,
    monster: "Какусин-сама", fakeIssuer: "ООО «Какусин»", soul: "Душа",
  },
  es: {
    currency: "¥", eraName: "Reiwa",
    eraGenuine: "Reiwa 8", eraInf: "Reiwa ∞", eraBad: "Shōwa 107",
    dateGenuine: "14 de febrero de Reiwa 8", dateBad: "30 de febrero de Reiwa 8",
    playerName: PLAYER_NAME, playerNameAlt: PLAYER_NAME_ALT,
    monster: "Kakushin-sama", fakeIssuer: "Kakushin, S.A.", soul: "Alma",
  },
};

/* =====================================================================
 * 書類（5枚）
 *
 * 金額の桁区切りは全ロケールで「,」に固定する。ロシア語圏・スペイン語圏は
 * 日常では「.」や空白を使うが、これは「日本の税務書類」なので日本の様式が
 * フィクション内で正しい（L-1）。
 * ===================================================================== */

const DOCS = {
  ja: {
    shiharai: { title: "支払調書", issuer: "株式会社ホワイト商事", rows: [
      ["支払金額", "¥1,200,000"], ["源泉徴収税額", "¥122,526"], ["区分", "原稿料"]] },
    iryohi: { title: "医療費のお知らせ", issuer: "全国健康保険協会", rows: [
      ["医療費合計", "¥184,320"], ["対象期間", "1月〜12月"], ["受診回数", "14回"]] },
    mycard: { title: "個人番号カード", issuer: "地方公共団体情報システム機構", rows: [
      ["個人番号", "1234 5678 9012"], ["有効期限", "令和10年5月"], ["住所", "県道市町 1-2-3"]] },
    reader: { title: "保証書", issuer: "ヨドバチカメラ", rows: [
      ["品名", "ICカードリーダー"], ["型番", "CR-2026W"], ["購入金額", "¥2,980"]] },
    password: { title: "パスワード控え", issuer: "本人控え", rows: [
      ["利用者識別番号", "1234 5678 9012 3456"], ["暗証番号", "＊＊＊＊"], ["メモ", "『いつもの』"]] },
  },

  en: {
    shiharai: { title: "Payment Record", issuer: "White Trading Co., Ltd.", rows: [
      ["Payment amount", "¥1,200,000"], ["Withholding tax", "¥122,526"], ["Category", "Manuscript fee"]] },
    // 「受診回数」は "Number of visits" ではなく "Outpatient visits"。
    // 混同表の O→0 の当たり先を作るため（L-12b）。
    iryohi: { title: "Notice of Medical Expenses", issuer: "Japan Health Insurance Association", rows: [
      ["Total medical expenses", "¥184,320"], ["Period covered", "January–December"], ["Outpatient visits", "14"]] },
    mycard: { title: "Individual Number Card", issuer: "Local Government Information Systems Organization", rows: [
      ["Individual number", "1234 5678 9012"], ["Valid until", "May, Reiwa 10"], ["Address", "1-2-3 Kendo, Michi City"]] },
    reader: { title: "Warranty", issuer: "Yodobachi Camera", rows: [
      ["Item", "IC card reader"], ["Model", "CR-2026W"], ["Purchase amount", "¥2,980"]] },
    password: { title: "Password Memo", issuer: "Personal copy", rows: [
      ["User ID", "1234 5678 9012 3456"], ["PIN", "＊＊＊＊"], ["Note", "“the usual”"]] },
  },

  "zh-Hans": {
    shiharai: { title: "支付记录", issuer: "白色商事株式会社", rows: [
      ["支付金额", "¥1,200,000"], ["预扣税额", "¥122,526"], ["类别", "稿费"]] },
    iryohi: { title: "医疗费通知", issuer: "全国健康保险协会", rows: [
      ["医疗费合计", "¥184,320"], ["对象期间", "1月～12月"], ["就诊次数", "14次"]] },
    mycard: { title: "个人编号卡", issuer: "地方公共团体信息系统机构", rows: [
      ["个人编号", "1234 5678 9012"], ["有效期限", "令和10年5月"], ["住所", "县道市町 1-2-3"]] },
    reader: { title: "保证书", issuer: "淀梁照相机", rows: [
      ["品名", "IC读卡器"], ["型号", "CR-2026W"], ["购买金额", "¥2,980"]] },
    password: { title: "密码备忘", issuer: "本人留存", rows: [
      ["用户识别号", "1234 5678 9012 3456"], ["密码", "＊＊＊＊"], ["备注", "“老样子”"]] },
  },

  ru: {
    shiharai: { title: "Справка о выплатах", issuer: "ООО «Вайто Сёдзи»", rows: [
      ["Сумма выплаты", "¥1,200,000"], ["Удержанный налог", "¥122,526"], ["Категория", "Авторский гонорар"]] },
    iryohi: { title: "Извещение о медицинских расходах", issuer: "Всеяпонская ассоциация медицинского страхования", rows: [
      ["Итого медицинских расходов", "¥184,320"], ["Период", "январь–декабрь"], ["Число посещений", "14"]] },
    mycard: { title: "Карта личного номера", issuer: "Организация информационных систем местного самоуправления", rows: [
      ["Личный номер", "1234 5678 9012"], ["Срок действия", "май 10 года Рэйва"], ["Адрес", "Кэндо, г. Мити, 1-2-3"]] },
    // 「品名」は «Наименование» ではなく «Название»。混同表の з→э の当たり先を作るため（L-12b）。
    reader: { title: "Гарантийный талон", issuer: "«Ёдобати Камера»", rows: [
      ["Название", "Считыватель IC-карт"], ["Модель", "CR-2026W"], ["Сумма покупки", "¥2,980"]] },
    password: { title: "Памятка с паролем", issuer: "Личная копия", rows: [
      ["Идентификационный номер", "1234 5678 9012 3456"], ["Пароль", "＊＊＊＊"], ["Примечание", "«как всегда»"]] },
  },

  es: {
    shiharai: { title: "Registro de pagos", issuer: "Jaito Shōji, S.A.", rows: [
      ["Importe del pago", "¥1,200,000"], ["Impuesto retenido", "¥122,526"], ["Categoría", "Honorarios de autor"]] },
    // 「対象期間」は «Período cubierto» ではなく «Meses cubiertos»。
    // í→i を当てると "Periodo" になるが、RAE は "periodo" も正しい綴りとして認めており、
    // 異変が異変にならない（L-2 の公平性違反）。曖昧さの無い語に替える。
    iryohi: { title: "Aviso de gastos médicos", issuer: "Asociación Japonesa del Seguro de Salud", rows: [
      ["Total de gastos médicos", "¥184,320"], ["Meses cubiertos", "enero–diciembre"], ["Número de consultas", "14"]] },
    mycard: { title: "Tarjeta de número personal", issuer: "Organización de Sistemas de Información de la Administración Local", rows: [
      ["Número personal", "1234 5678 9012"], ["Válido hasta", "mayo de Reiwa 10"], ["Dirección", "Kendo, Michi, 1-2-3"]] },
    reader: { title: "Garantía", issuer: "Yodobachi Cámara", rows: [
      ["Descripción", "Lector de tarjetas IC"], ["Modelo", "CR-2026W"], ["Importe de compra", "¥2,980"]] },
    password: { title: "Nota de contraseña", issuer: "Copia personal", rows: [
      ["Número de identificación", "1234 5678 9012 3456"], ["Contraseña", "＊＊＊＊"], ["Observación", "“lo de siempre”"]] },
  },
};

/* =====================================================================
 * 混同表（L-12）
 *
 * どれも「その言語で現実に通用する詐称の型」であること。
 * 全エントリがいずれかの項目名に出現しなければならない（L-12b）。
 * ===================================================================== */

const CONFUSABLES = {
  // 漢字の字形。src/game.js の LOOKA を引き継ぐ。
  ja: { 金: "全", 医: "圧", 番: "蕃", 期: "斯", 額: "顎", 号: "呂" },

  // ラテン文字のホモグリフ。ドメイン詐称の実手法。1文字が2文字に増える場合がある。
  en: { m: "rn", W: "VV", l: "I", d: "cl", O: "0" },

  // 簡体字→繁体/日本字形への化け。簡体字話者は「古い・よそのもの」として即座に感じ取る。
  "zh-Hans": { 户: "戸", 医: "醫", 号: "號", 额: "額", 类: "類", 备: "備", 编: "編", 费: "費" },

  // キリル文字内の紛らわしい対。ь→ъ は1918年に廃止された革命前正書法で、
  // 「書類が本来より古い」という恐怖のビートになる。
  // ラテン文字の混入（а→a 等）は採用しない：フォントが同形に描くと見えず、L-2 に反する。
  ru: { ь: "ъ", е: "ё", и: "й", щ: "ш", ц: "ч", з: "э" },

  // ダイアクリティカルの脱落。位置ずれ（Número→Numeró）は2箇所変更になるので使わない。
  // Año→Ano は語義が卑語になるため意図的に除外（ゲーム側はボケない）。
  es: { í: "i", ú: "u", ó: "o", é: "e", á: "a", ñ: "n" },
};

/* =====================================================================
 * 図鑑名と却下理由（16種 × 5ロケール）
 * ===================================================================== */

const META = {
  ja: {
    era:    ["存在しない年号",   "年号が存在しません"],
    typo:   ["入れ替わった題字", "書類の名称に誤りがあります"],
    minus:  ["負の金額",         "金額が負の値になっています"],
    stamp:  ["逆さの印",         "押印が逆さまです"],
    name:   ["一字ちがいの氏名", "氏名が申告者と一致しません"],
    mirror: ["鏡の書類",         "書類全体が鏡文字です"],
    issuer: ["実在しない発行元", "発行元が実在しません"],
    date:   ["存在しない日付",   "発行日が存在しません"],
    soul:   ["魂の対価",         "金額が通貨ではありません"],
    four:   ["四づくし",         "数値がすべて4です"],
    kami:   ["名乗る書類",       "氏名が人間ではありません"],
    eye:    ["見ている印",       "印影が瞬きしました"],
    blur:   ["濡れた文字",       "書類が濡れています"],
    mark:   ["透かしの顔",       "不正な透かしが検出されました"],
    ju:     ["朱の呪",           "確認できない印が押されています"],
    label:  ["化けた項目名",     "項目名に誤りがあります"],
  },
  en: {
    era:    ["A Year That Never Was",        "No such era year."],
    typo:   ["Transposed Title",             "The title of this document is incorrect."],
    minus:  ["Negative Sum",                 "The amount is negative."],
    stamp:  ["The Inverted Seal",            "The seal is upside down."],
    name:   ["One Character Off",            "The name does not match the filer."],
    mirror: ["The Mirrored Form",            "The entire document is mirror-written."],
    issuer: ["An Issuer That Does Not Exist","The issuer does not exist."],
    date:   ["A Date That Never Was",        "No such date of issue."],
    soul:   ["Payment in Soul",              "The amount is not currency."],
    four:   ["The Number of Death",          "All figures are four."],
    kami:   ["The Form That Names Itself",   "The name is not that of a person."],
    eye:    ["The Watching Seal",            "The seal impression blinked."],
    blur:   ["Wet Ink",                      "The document is wet."],
    mark:   ["The Face in the Watermark",    "An unauthorized watermark was detected."],
    ju:     ["The Vermilion Curse",          "An unverifiable seal has been affixed."],
    label:  ["Corrupted Field Name",         "A field name is incorrect."],
  },
  "zh-Hans": {
    era:    ["不存在的年号",     "该年号不存在。"],
    typo:   ["颠倒的标题",       "文书名称有误。"],
    minus:  ["负数金额",         "金额为负值。"],
    stamp:  ["倒盖的印章",       "印章倒盖。"],
    name:   ["一字之差的姓名",   "姓名与申报人不一致。"],
    mirror: ["镜像文书",         "整份文书为镜像文字。"],
    issuer: ["不存在的发行方",   "发行方不存在。"],
    date:   ["不存在的日期",     "发行日期不存在。"],
    soul:   ["以魂支付",         "金额并非货币。"],
    four:   ["满是四",           "所有数值均为四。"],
    kami:   ["自报姓名的文书",   "姓名并非人类。"],
    eye:    ["注视的印章",       "印影眨眼了。"],
    blur:   ["湿透的字迹",       "文书已被浸湿。"],
    mark:   ["水印中的脸",       "检测到非法水印。"],
    ju:     ["朱红之咒",         "盖有无法核实的印章。"],
    label:  ["化形的项目名",     "项目名称有误。"],
  },
  ru: {
    era:    ["Год, которого не было",        "Такого года эры не существует."],
    typo:   ["Переставленный заголовок",     "Название документа указано неверно."],
    minus:  ["Отрицательная сумма",          "Сумма отрицательна."],
    stamp:  ["Перевёрнутая печать",          "Печать поставлена вверх ногами."],
    name:   ["Имя, отличное на один знак",   "Имя не совпадает с именем заявителя."],
    mirror: ["Зеркальный документ",          "Весь документ написан зеркально."],
    issuer: ["Несуществующий эмитент",       "Эмитент не существует."],
    date:   ["Дата, которой не было",        "Такой даты выдачи не существует."],
    soul:   ["Плата душой",                  "Сумма указана не в валюте."],
    four:   ["Число смерти",                 "Все числа — четвёрки."],
    kami:   ["Документ, назвавший себя",     "Имя принадлежит не человеку."],
    eye:    ["Смотрящая печать",             "Оттиск печати мигнул."],
    blur:   ["Размокшие буквы",              "Документ намок."],
    mark:   ["Лицо в водяном знаке",         "Обнаружен недопустимый водяной знак."],
    ju:     ["Багряное проклятие",           "Поставлена печать, которую невозможно проверить."],
    label:  ["Подменённое имя графы",        "Название графы указано неверно."],
  },
  es: {
    era:    ["Un año que no existió",        "Ese año de era no existe."],
    typo:   ["Título transpuesto",           "El nombre del documento es incorrecto."],
    minus:  ["Importe negativo",             "El importe es negativo."],
    stamp:  ["El sello invertido",           "El sello está boca abajo."],
    name:   ["Un carácter de diferencia",    "El nombre no coincide con el del declarante."],
    mirror: ["El documento reflejado",       "Todo el documento está escrito en espejo."],
    issuer: ["Un emisor que no existe",      "El emisor no existe."],
    date:   ["Una fecha que no existió",     "Esa fecha de emisión no existe."],
    soul:   ["Pago en alma",                 "El importe no es una moneda."],
    four:   ["El número de la muerte",       "Todas las cifras son cuatro."],
    kami:   ["El documento que se nombra",   "El nombre no es de un ser humano."],
    eye:    ["El sello que observa",         "El sello parpadeó."],
    blur:   ["Tinta mojada",                 "El documento está mojado."],
    mark:   ["El rostro en la filigrana",    "Se ha detectado una filigrana no autorizada."],
    ju:     ["La maldición bermellón",       "Se ha estampado un sello imposible de verificar."],
    label:  ["Nombre de campo alterado",     "El nombre de un campo es incorrecto."],
  },
};

/* =====================================================================
 * 図鑑の由来文（L-3 / L-10）
 *
 * 文化固有の恐怖は異変を差し替えず、ここで教える。
 * ===================================================================== */

const CODEX_ORIGIN = {
  ja: {
    four: "四は「死」と同じ音で読まれる。税務署は番号を振り直さない。",
    ju:   "朱肉の赤は、古くは魔を退けるための色だった。退ける側が押しているとは限らない。",
  },
  en: {
    four: "In Japan, four is read shi — the same sound as death. Tax offices do not renumber.",
    ju:   "Vermilion ink was once used to ward off spirits. Nothing guarantees which side is holding the seal.",
  },
  "zh-Hans": {
    four: "四与「死」同音。税务机关不会为此重新编号。",
    ju:   "朱红本是辟邪之色。但持印的一方，未必就是辟邪的那一方。",
  },
  ru: {
    four: "В Японии «четыре» читается «си» — так же, как «смерть». Налоговая не меняет нумерацию из-за этого.",
    ju:   "Багряная тушь когда-то отгоняла злых духов. Ничто не говорит о том, на чьей стороне печать.",
  },
  es: {
    four: "En Japón, cuatro se lee shi — igual que muerte. La oficina tributaria no renumera por eso.",
    ju:   "La tinta bermellón servía para ahuyentar a los espíritus. Nada garantiza de qué lado está el sello.",
  },
};

/* =====================================================================
 * 暗証番号の手掛かり文（L-13）
 *
 * 正解値はここに書かない。氏名（漢字のまま）を再提示し、その意味だけを開示する。
 * 日付が日先行のロケールには「月、そして日」を明示する。
 * ===================================================================== */

const PIN_HINT = {
  ja: `メモには『いつもの』とだけ書いてある。……申告書の氏名欄には、いつもの名前があった。「${PLAYER_NAME}」。`,

  en: `The memo says only “the usual.” …And in the name field of the return, the usual name: ${PLAYER_NAME} — Sangatsu Jūgo. March. Fifteen. Month, then day.`,

  "zh-Hans": `备忘上只写着“老样子”。……而申告书的姓名栏里，是那个熟悉的名字。「${PLAYER_NAME}」。三月，十五日。`,

  ru: `В памятке только: «как всегда». …А в графе имени на декларации — то же имя: ${PLAYER_NAME}, Сангацу Дзюго. Март. Пятнадцать. Сначала месяц, затем день.`,

  es: `La nota solo dice: “lo de siempre”. …Y en la casilla del nombre de la declaración, el nombre de siempre: ${PLAYER_NAME}, Sangatsu Jūgo. Marzo. Quince. Primero el mes, luego el día.`,
};

/* =====================================================================
 * 内部ヘルパ
 * ===================================================================== */

function assertLocale(locale) {
  if (!LOCALES.includes(locale)) {
    throw new Error(
      `未対応の locale です（受け取った値: ${JSON.stringify(locale)}／対応: ${LOCALES.join(", ")}）`
    );
  }
}

function assertId(id) {
  if (!ANOM_IDS.includes(id)) {
    throw new Error(`未知の異変IDです: ${JSON.stringify(id)}`);
  }
}

function assertRng(rng) {
  if (typeof rng !== "function") {
    throw new Error(`rng は関数として注入してください（受け取った値: ${JSON.stringify(rng)}）`);
  }
}

/** 書類を深くコピーする。rows は配列ごと複製し、元を共有しない（L-16b）。 */
function cloneDoc(d) {
  return {
    ...d,
    rows: d.rows.map((r) => [...r]),
    flags: { ...(d.flags || {}) },
  };
}

/** 0 以上 n 未満の整数を rng から取る。rng が 1 を返しても範囲外にならない。 */
function pick(rng, n) {
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

/** 金額欄（¥ 始まりの値）を持つ行の添字。無ければ -1。 */
function moneyRowIndex(d) {
  return d.rows.findIndex((r) => r[1].startsWith("¥"));
}

/** 混同表に当たる (行, 文字位置, 元の字) の候補をすべて列挙する。 */
function labelCandidates(d, locale) {
  const tbl = CONFUSABLES[locale];
  const out = [];
  d.rows.forEach((r, ri) => {
    [...r[0]].forEach((ch, ci) => {
      if (tbl[ch]) out.push([ri, ci, ch]);
    });
  });
  return out;
}

/** アルファベット系の題字で、単語内の隣接2文字を転置できる位置の候補。
 * 先頭文字は保つ（i >= 1）。空白を挟がない。同じ字同士は転置しても変化しないので除く。 */
function transposeCandidates(title) {
  const ch = [...title];
  const out = [];
  for (let i = 1; i < ch.length - 1; i++) {
    if (/\s/.test(ch[i]) || /\s/.test(ch[i + 1])) continue;
    if (ch[i] === ch[i + 1]) continue;
    out.push(i);
  }
  return out;
}

const IS_CJK_LOCALE = (locale) => locale === "ja" || locale === "zh-Hans";

/* =====================================================================
 * 異変の適用規則
 *
 * can: その書類に適用できるか（省略時は常に可）
 * apply: 複製済みの書類 s を破壊的に書き換える（呼び出し元が複製済み）
 * ===================================================================== */

const RULES = {
  era: {
    apply: (s, locale, rng) => {
      const T = TEXT[locale];
      // 一方は「数でない年（∞）」、他方は「別の元号」。どちらも真正値と必ず違う。
      s.era = rng() < 0.5 ? T.eraInf : T.eraBad;
    },
  },

  typo: {
    apply: (s, locale, rng) => {
      if (IS_CJK_LOCALE(locale)) {
        // 1文字＝1形態素なので、先頭2文字の入れ替えが強い違和感になる。
        const t = [...s.title];
        [t[0], t[1]] = [t[1], t[0]];
        s.title = t.join("");
        return;
      }
      // アルファベット系は単語内の隣接2文字を転置する。
      // 先頭2文字を崩すと "aPyment" となり、異変ではなくバグに見える（巧妙系に反する）。
      const cands = transposeCandidates(s.title);
      if (cands.length === 0) throw new Error(`typo: 転置できる位置がありません（can 違反）: ${s.title}`);
      const i = cands[pick(rng, cands.length)];
      const t = [...s.title];
      [t[i], t[i + 1]] = [t[i + 1], t[i]];
      s.title = t.join("");
    },
  },

  minus: {
    can: (d) => moneyRowIndex(d) >= 0,
    apply: (s) => {
      // 括弧記法 (1,200,000) は英語・スペイン語の会計慣習として「正しい」ので使わない（L-5）。
      const i = moneyRowIndex(s);
      s.rows[i][1] = MINUS + s.rows[i][1];
    },
  },

  stamp:  { apply: (s) => { s.flags.stampFlip = true; } },

  name: {
    apply: (s, locale) => { s.name = TEXT[locale].playerNameAlt; },
  },

  mirror: { apply: (s) => { s.flags.mirror = true; } },

  issuer: {
    apply: (s, locale) => { s.issuer = TEXT[locale].fakeIssuer; },
  },

  date: {
    apply: (s, locale) => { s.date = TEXT[locale].dateBad; },
  },

  soul: {
    can: (d) => moneyRowIndex(d) >= 0,
    apply: (s, locale) => {
      const i = moneyRowIndex(s);
      s.rows[i][1] = TEXT[locale].soul;
    },
  },

  four: {
    can: (d) => d.rows.some((r) => /\d/.test(r[1])),
    apply: (s) => { s.rows.forEach((r) => { r[1] = r[1].replace(/\d/g, "4"); }); },
  },

  kami: {
    apply: (s, locale) => { s.name = TEXT[locale].monster; },
  },

  eye:  { apply: (s) => { s.flags.stampEye = true; } },
  blur: { apply: (s) => { s.flags.blur = true; } },
  mark: { apply: (s) => { s.flags.mark = true; } },
  ju:   { apply: (s) => { s.flags.ju = true; } },

  label: {
    can: (d, locale) => labelCandidates(d, locale).length > 0,
    apply: (s, locale, rng) => {
      const cands = labelCandidates(s, locale);
      const [ri, ci, ch] = cands[pick(rng, cands.length)];
      const arr = [...s.rows[ri][0]];
      arr[ci] = CONFUSABLES[locale][ch];   // 1文字が2文字に増えることがある（m→rn 等）
      s.rows[ri][0] = arr.join("");
    },
  },
};

/* =====================================================================
 * 公開 API
 * ===================================================================== */

/** そのロケールの語彙（通貨・元号・氏名・怪異の名など）。 */
export function localeText(locale) {
  assertLocale(locale);
  return { ...TEXT[locale] };
}

/** そのロケールの書類5枚。呼ぶたびに新しいオブジェクトを返す（L-16c）。 */
export function docSpecs(locale) {
  assertLocale(locale);
  const T = TEXT[locale];
  const out = {};
  for (const [key, d] of Object.entries(DOCS[locale])) {
    out[key] = {
      title: d.title,
      issuer: d.issuer,
      era: T.eraGenuine,       // 真正な書類は全て同一の年号年（L-8a）
      date: T.dateGenuine,
      name: T.playerName,
      showsName: true,         // 氏名は全5枚に印字される（L-9d：比較対象が要る）
      rows: d.rows.map((r) => [...r]),
      flags: {},
    };
  }
  return out;
}

/** そのロケールの混同表（L-12）。 */
export function confusables(locale) {
  assertLocale(locale);
  return { ...CONFUSABLES[locale] };
}

/** 混同表が出力しうる字をロケールごとに列挙する。
 * フォントのサブセット生成はここを必ず読むこと（L-14）。
 * 素の本文には現れない字が含まれるため、本文だけを拾うと異変が豆腐になる。 */
export function confusableOutputs() {
  const out = {};
  for (const locale of LOCALES) {
    const set = new Set();
    for (const to of Object.values(CONFUSABLES[locale])) for (const ch of to) set.add(ch);
    out[locale] = [...set].join("");
  }
  return out;
}

/** 異変の図鑑名・却下理由・巧妙かどうか。 */
export function anomMeta(id, locale) {
  assertId(id);
  assertLocale(locale);
  const [name, reject] = META[locale][id];
  return { id, name, reject, sub: SUB_IDS.has(id) };
}

/** 図鑑に載せる由来文。無い異変は空文字。 */
export function codexOrigin(id, locale) {
  assertId(id);
  assertLocale(locale);
  return CODEX_ORIGIN[locale][id] || "";
}

/** 暗証番号の手掛かり文。正解値そのものは含まない（L-13a）。 */
export function pinHint(locale) {
  assertLocale(locale);
  return PIN_HINT[locale];
}

/** その書類にその異変を適用できるか。 */
export function canApply(id, doc, locale) {
  assertId(id);
  assertLocale(locale);
  const rule = RULES[id];
  if (!rule.can) return true;
  return rule.can(doc, locale);
}

/**
 * 書類に異変を適用し、新しい書類を返す。入力は変更しない（L-16）。
 * rng は必ず注入する（L-17）。can を満たさない書類に当てると例外（L-19）。
 */
export function applyAnom(id, doc, locale, rng) {
  assertId(id);
  assertLocale(locale);
  assertRng(rng);
  if (!canApply(id, doc, locale)) {
    throw new Error(`${id}: この書類には適用できません（can 条件を満たしません）`);
  }
  const s = cloneDoc(doc);
  RULES[id].apply(s, locale, rng);
  return s;
}
