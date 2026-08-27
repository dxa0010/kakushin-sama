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

const MINUS = "−";   // U+2212。U+002D でも括弧記法でもない（L-5）

/* =====================================================================
 * 通貨モデル（§9.2 / L-31）
 *
 * ru と es は通貨記号が後置で、桁区切りも「,」ではない。
 * 「¥ 始まりの行を探す」という前提はここで捨てる。
 * ===================================================================== */

const MONEY = {
  ja:        { symbol: "¥", position: "pre",  thousands: ",", decimal: "." },
  en:        { symbol: "$", position: "pre",  thousands: ",", decimal: "." },
  "zh-Hans": { symbol: "¥", position: "pre",  thousands: ",", decimal: "." },
  // ロシアは桁区切りが空白（本来は不分割空白だが、フォントのサブセットを
  // 増やさないため通常の空白で組む＝設計時の判断）
  ru:        { symbol: "₽", position: "post", thousands: " ", decimal: "," },
  // スペインは「.」が桁区切り、「,」が小数点。英語圏と逆
  es:        { symbol: "€", position: "post", thousands: ".", decimal: "," },
};

/** 整数を桁区切りしてロケールの通貨表記にする。 */
function groupDigits(n, sep) {
  const s = String(Math.trunc(Math.abs(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += sep;
    out += s[i];
  }
  return out;
}
function fmt(locale, n) {
  const m = MONEY[locale];
  const body = groupDigits(n, m.thousands);
  return m.position === "pre" ? m.symbol + body : body + " " + m.symbol;
}

/** 忌み数（§9.1 / L-33）。日本と中国は 四＝死 を共有する（L-28）。 */
const UNLUCKY = { ja: "4", en: "13", "zh-Hans": "4", ru: "13", es: "13" };

/** 申告期限とその国の日付の書き順（§9.5 / L-30）。
 * 暗証番号はここから導出する。正解値そのものはこのファイルに書かない（L-34c）。 */
const DEADLINE = {
  ja:        { month: 3, day: 15, order: "MD" },
  en:        { month: 4, day: 15, order: "MD" },
  "zh-Hans": { month: 6, day: 30, order: "MD" },
  ru:        { month: 4, day: 30, order: "DM" },
  es:        { month: 6, day: 30, order: "DM" },
};

/** 税務当局。すべてパロディ名（L-35b）。
 * 実在する当局の正式名称・記章・書式を再現しない（docs/HANDOFF.md の既存制約）。
 * 米国の IRS の記章は 31 U.S.C. § 333 で保護されている。 */
const AUTHORITY = {
  ja: "国税院",
  en: "United States Revenue Bureau",
  "zh-Hans": "国家税务总署",
  ru: "Федеральное налоговое управление",
  es: "Agencia Estatal de Recaudación",
};

/* =====================================================================
 * ロケールごとの語彙
 *
 * eraGenuine / eraInf / eraBad は「税年度」。日本以外に元号は無いので、
 * 異変 era は「他の4枚と食い違う年」で成立させる（§9.4）。
 * ===================================================================== */

const TEXT = {
  ja: {
    eraName: "令和",
    eraGenuine: "令和8年分", eraInf: "令和∞年分", eraBad: "昭和107年分",
    dateGenuine: "令和8年2月14日", dateBad: "令和8年2月30日",
    playerName: "三月 十五", playerNameAlt: "三月 十六",
    monster: "カクシン様", fakeIssuer: "株式会社カクシン", soul: "魂",
    title: "カクシン様 ─ 確定申告からは逃げられない",
    system: "確定申告", channel: "e-Tax",
  },
  en: {
    eraName: "Tax Year",
    eraGenuine: "Tax Year 2025", eraInf: "Tax Year ∞", eraBad: "Tax Year 2027",
    dateGenuine: "February 14, 2026", dateBad: "February 30, 2026",
    playerName: "April Fifteen", playerNameAlt: "Apryl Fifteen",
    monster: "Kakushin-sama", fakeIssuer: "KAKUSHIN Holdings, Inc.", soul: "Soul",
    title: "KAKUSHIN — No Escape from Your Tax Return",
    system: "Form 1040", channel: "e-File",
  },
  "zh-Hans": {
    eraName: "年度",
    eraGenuine: "2025年度", eraInf: "∞年度", eraBad: "2027年度",
    dateGenuine: "2026年2月14日", dateBad: "2026年2月30日",
    playerName: "六月 三十", playerNameAlt: "六月 三千",
    // L-24:「确信」は quèxìn と読まれ KAKUSHIN と音が繋がらないので使わない。
    monster: "KAKUSHIN大人", fakeIssuer: "KAKUSHIN控股有限公司", soul: "灵魂",
    title: "KAKUSHIN — 逃不掉的个税汇算",
    system: "综合所得年度汇算", channel: "个人所得税",
  },
  ru: {
    eraName: "год",
    eraGenuine: "2025 год", eraInf: "∞ год", eraBad: "2027 год",
    dateGenuine: "14.02.2026", dateBad: "30.02.2026",
    playerName: "Апрелий Тридцатов", playerNameAlt: "Апрелей Тридцатов",
    monster: "Какусин-сама", fakeIssuer: "ООО «KAKUSHIN»", soul: "Душа",
    title: "KAKUSHIN — От налоговой не убежать",
    system: "3-НДФЛ", channel: "Личный кабинет",
  },
  es: {
    eraName: "ejercicio",
    eraGenuine: "ejercicio 2025", eraInf: "ejercicio ∞", eraBad: "ejercicio 2027",
    dateGenuine: "14/02/2026", dateBad: "30/02/2026",
    playerName: "Junio Treinta", playerNameAlt: "Iunio Treinta",
    monster: "Kakushin-sama", fakeIssuer: "KAKUSHIN Inversiones, S.L.", soul: "Alma",
    title: "KAKUSHIN — De Hacienda no se escapa",
    system: "Declaración de la Renta", channel: "Renta WEB",
  },
};

/* =====================================================================
 * 書類（5枚）── §9.3
 *
 * 4枚目 `prior` は「前年の申告書控え」。米国は AGI、スペインは casilla 505、
 * ロシアは前年控えが本人確認・控除継続に実際に要る（L-27）。
 * 日本だけ例外で、前年控えの提出要件が無いためICカードリーダーの保証書を残す。
 *
 * 項目名は混同表（CONFUSABLES）の全エントリに当たり先を用意すること（L-12b）。
 * 死んだ表エントリがあると、その異変は永遠に発火しない。
 * ===================================================================== */

const DOCS = {
  ja: {
    shiharai: { title: "支払調書", issuer: "株式会社ホワイト商事", rows: [
      ["支払金額", fmt("ja", 1200000)], ["源泉徴収税額", fmt("ja", 122526)], ["区分", "原稿料"]] },
    iryohi: { title: "医療費のお知らせ", issuer: "全国健康保険協会", rows: [
      ["医療費合計", fmt("ja", 184320)], ["対象期間", "1月〜12月"], ["受診回数", "14回"]] },
    mycard: { title: "個人番号カード", issuer: "地方公共団体情報システム機構", rows: [
      ["個人番号", "1234 5678 9012"], ["有効期限", "令和10年5月"], ["住所", "県道市町 1-2-3"]] },
    prior: { title: "保証書", issuer: "ヨドバチカメラ", rows: [
      ["品名", "ICカードリーダー"], ["型番", "CR-2026W"], ["購入金額", fmt("ja", 2980)]] },
    password: { title: "パスワード控え", issuer: "本人控え", rows: [
      ["利用者識別番号", "1234 5678 9012 3456"], ["暗証番号", "＊＊＊＊"], ["メモ", "『いつもの』"]] },
  },

  en: {
    // 混同表の当たり先: m(compensation) / W(Withholding) / l(Total) / d(withheld) / O(Outpatient)
    shiharai: { title: "Nonemployee Compensation", issuer: "Whitfield Trading LLC", rows: [
      ["Nonemployee compensation", fmt("en", 18400)],
      ["Federal income tax withheld", fmt("en", 2760)],
      ["Withholding agent", "Whitfield Trading LLC"]] },
    iryohi: { title: "Medical Expense Summary", issuer: "Meridian Health Network", rows: [
      ["Total medical expenses", fmt("en", 9180)],
      ["Months covered", "January–December"],
      ["Outpatient visits", "14"]] },
    mycard: { title: "Social Security Card", issuer: "United States Social Insurance Office", rows: [
      ["Social security number", "123-45-6789"],
      ["Issued", "May 2018"],
      ["Address", "412 Kendrick Ave, Milton City"]] },
    // 前年の申告書控え。米国の e-File は前年 AGI で本人確認する（L-27）
    prior: { title: "Form 1040 (2024) — Taxpayer Copy", issuer: "Personal copy", rows: [
      ["Adjusted gross income", fmt("en", 61204)],
      ["Total tax", fmt("en", 7436)],
      ["Filed on", "April 15, 2025"]] },
    password: { title: "Password Memo", issuer: "Personal copy", rows: [
      ["User ID", "1234 5678 9012 3456"], ["PIN", "＊＊＊＊"], ["Note", "“the usual”"]] },
  },

  "zh-Hans": {
    // 混同表の当たり先: 额 / 类 / 医 / 费 / 号 / 编 / 户 / 备
    shiharai: { title: "劳务报酬所得明细", issuer: "白鹭商贸有限公司", rows: [
      ["收入额", fmt("zh-Hans", 120000)],
      ["已预扣税额", fmt("zh-Hans", 12252)],
      ["所得类别", "稿酬所得"]] },
    iryohi: { title: "医疗费用汇总单", issuer: "明德医疗集团", rows: [
      ["医疗费合计", fmt("zh-Hans", 18432)],
      ["覆盖月份", "1月～12月"],
      ["就诊次数", "14次"]] },
    mycard: { title: "居民身份证", issuer: "公安机关", rows: [
      ["公民身份号码", "1234 5678 9012"], ["证件编号", "2026 1201"], ["住址", "明德市 光明路 12 号"]] },
    prior: { title: "上年度汇算清缴记录", issuer: "本人留存", rows: [
      ["已缴税额", fmt("zh-Hans", 7436)],
      ["开户银行", "白鹭银行"],
      ["申报日期", "2025年6月30日"]] },
    password: { title: "密码备忘", issuer: "本人留存", rows: [
      ["用户识别号", "1234 5678 9012 3456"], ["密码", "＊＊＊＊"], ["备注", "“老样子”"]] },
  },

  ru: {
    // 混同表の当たり先: ь(Стоимость) / щ(Общая, посещений) / ц(Медицинские) /
    //                   з(Название) / е・и(多数)
    shiharai: { title: "Справка о доходах", issuer: "ООО «Белояр»", rows: [
      ["Общая сумма дохода", fmt("ru", 1200000)],
      ["Удержанный налог", fmt("ru", 156000)],
      ["Название организации", "ООО «Белояр»"]] },
    iryohi: { title: "Справка об оплате медицинских услуг", issuer: "Медцентр «Меридиан»", rows: [
      ["Стоимость услуг", fmt("ru", 184320)],
      ["Медицинские услуги", "январь–декабрь"],
      ["Число посещений", "14"]] },
    mycard: { title: "Свидетельство ИНН", issuer: "Федеральное налоговое управление", rows: [
      ["Серия и номер", "12 34 567890"],
      ["Дата выдачи", "май 2018"],
      ["Адрес", "г. Мытищи, ул. Кедровая, 12"]] },
    prior: { title: "Декларация 3-НДФЛ за 2024 год", issuer: "Личная копия", rows: [
      ["Сумма налога", fmt("ru", 156000)],
      ["Дата подачи", "30.04.2025"],
      ["Стоимость услуг представителя", fmt("ru", 8000)]] },
    password: { title: "Памятка с паролем", issuer: "Личная копия", rows: [
      ["Идентификационный номер", "1234 5678 9012 3456"],
      ["Пароль", "＊＊＊＊"],
      ["Примечание", "«как всегда»"]] },
  },

  es: {
    // 混同表の当たり先: í(íntegros) / ú(Número) / ó(Retención) / é(médicos) /
    //                   á(máximo) / ñ(Compañía)
    // Año は使わない。ñ→n が "Ano" になり、異変ではなく下ネタになる（L-12e）
    shiharai: { title: "Certificado de retenciones", issuer: "Blanquil Comercial, S.L.", rows: [
      ["Rendimientos íntegros", fmt("es", 18400)],
      ["Retención practicada", fmt("es", 2760)],
      ["Clave de percepción", "Actividades profesionales"]] },
    iryohi: { title: "Certificado de gastos médicos", issuer: "Clínica Meridiano", rows: [
      ["Total de gastos médicos", fmt("es", 9180)],
      ["Importe máximo deducible", fmt("es", 1500)],
      ["Compañía aseguradora", "Mutua Meridiano"]] },
    mycard: { title: "Documento Nacional de Identidad", issuer: "Dirección General de Registro Civil", rows: [
      ["Número de documento", "12345678Z"],
      ["Fecha de expedición", "12/05/2018"],
      ["Domicilio", "C/ Quintana 12, 3.º B, Madrid"]] },
    // casilla 505 は参照番号の取得に実際に要る（L-27）
    prior: { title: "Declaración de la Renta 2024 — copia", issuer: "Copia personal", rows: [
      ["Casilla 505", fmt("es", 61204)],
      ["Cuota resultante", fmt("es", 7436)],
      ["Fecha de presentación", "30/06/2025"]] },
    password: { title: "Nota de contraseña", issuer: "Copia personal", rows: [
      ["Número de identificación", "1234 5678 9012 3456"],
      ["Contraseña", "＊＊＊＊"],
      ["Observación", "“lo de siempre”"]] },
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
    era:    ["A Year That Never Was",        "No such tax year."],
    typo:   ["Transposed Title",             "The title of this document is incorrect."],
    minus:  ["Negative Sum",                 "The amount is negative."],
    stamp:  ["The Inverted Seal",            "The seal is upside down."],
    name:   ["One Character Off",            "The name does not match the filer."],
    mirror: ["The Mirrored Form",            "The entire document is mirror-written."],
    issuer: ["An Issuer That Does Not Exist","The issuer does not exist."],
    date:   ["A Date That Never Was",        "No such date of issue."],
    soul:   ["Payment in Soul",              "The amount is not currency."],
    four:   ["The Number of Death",          "Every figure is thirteen."],
    kami:   ["The Form That Names Itself",   "The name is not that of a person."],
    eye:    ["The Watching Seal",            "The seal impression blinked."],
    blur:   ["Wet Ink",                      "The document is wet."],
    mark:   ["The Face in the Watermark",    "An unauthorized watermark was detected."],
    ju:     ["The Vermilion Curse",          "An unverifiable seal has been affixed."],
    label:  ["Corrupted Field Name",         "A field name is incorrect."],
  },
  "zh-Hans": {
    era:    ["不存在的年度",     "该年度不存在。"],
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
    era:    ["Год, которого не было",        "Такого налогового года не существует."],
    typo:   ["Переставленный заголовок",     "Название документа указано неверно."],
    minus:  ["Отрицательная сумма",          "Сумма отрицательна."],
    stamp:  ["Перевёрнутая печать",          "Печать поставлена вверх ногами."],
    name:   ["Имя, отличное на один знак",   "Имя не совпадает с именем заявителя."],
    mirror: ["Зеркальный документ",          "Весь документ написан зеркально."],
    issuer: ["Несуществующий эмитент",       "Эмитент не существует."],
    date:   ["Дата, которой не было",        "Такой даты выдачи не существует."],
    soul:   ["Плата душой",                  "Сумма указана не в валюте."],
    four:   ["Число смерти",                 "Все числа — тринадцать."],
    kami:   ["Документ, назвавший себя",     "Имя принадлежит не человеку."],
    eye:    ["Смотрящая печать",             "Оттиск печати мигнул."],
    blur:   ["Размокшие буквы",              "Документ намок."],
    mark:   ["Лицо в водяном знаке",         "Обнаружен недопустимый водяной знак."],
    ju:     ["Багряное проклятие",           "Поставлена печать, которую невозможно проверить."],
    label:  ["Подменённое имя графы",        "Название графы указано неверно."],
  },
  es: {
    era:    ["Un año que no existió",        "Ese ejercicio fiscal no existe."],
    typo:   ["Título transpuesto",           "El nombre del documento es incorrecto."],
    minus:  ["Importe negativo",             "El importe es negativo."],
    stamp:  ["El sello invertido",           "El sello está boca abajo."],
    name:   ["Un carácter de diferencia",    "El nombre no coincide con el del declarante."],
    mirror: ["El documento reflejado",       "Todo el documento está escrito en espejo."],
    issuer: ["Un emisor que no existe",      "El emisor no existe."],
    date:   ["Una fecha que no existió",     "Esa fecha de emisión no existe."],
    soul:   ["Pago en alma",                 "El importe no es una moneda."],
    four:   ["El número de la muerte",       "Todas las cifras son trece."],
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
    four: "Thirteen is the floor that buildings skip. A revenue office skips nothing.",
    ju:   "Vermilion ink was once used to ward off spirits. Nothing guarantees which side is holding the seal.",
  },
  "zh-Hans": {
    four: "四与「死」同音。税务机关不会为此重新编号。",
    ju:   "朱红本是辟邪之色。但持印的一方，未必就是辟邪的那一方。",
  },
  ru: {
    four: "Тринадцать — число, которое пропускают в западных домах. Налоговая не пропускает ничего.",
    ju:   "Багряная тушь когда-то отгоняла злых духов. Ничто не говорит о том, на чьей стороне печать.",
  },
  es: {
    four: "Aquí el día aciago es el martes 13, no el viernes. Hacienda no descansa ninguno de los dos.",
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
  // L-30: 各国の暗証番号はその国の締切を「その国の書き順で」書いたもの。
  // 日本語版と違い、月・日の順序を注記する必要が無い（ru の 3004 は 30.04 として自明）。
  ja: `メモには『いつもの』とだけ書いてある。……申告書の氏名欄には、いつもの名前があった。「${TEXT.ja.playerName}」。`,

  en: `The memo says only “the usual.” …And in the name field of the return, the usual name: ${TEXT.en.playerName}.`,

  "zh-Hans": `备忘上只写着“老样子”。……而申报表的姓名栏里，是那个熟悉的名字。「${TEXT["zh-Hans"].playerName}」。`,

  ru: `В памятке только: «как всегда». …А в графе имени на декларации — то же имя: ${TEXT.ru.playerName}.`,

  es: `La nota solo dice: “lo de siempre”. …Y en la casilla del nombre de la declaración, el nombre de siempre: ${TEXT.es.playerName}.`,
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

/** 金額欄を持つ行の添字。無ければ -1。
 * ru / es は通貨記号が後置なので「¥ 始まり」では見つからない（L-31）。
 * ロケールの通貨記号を含むかどうかで判定する。 */
function moneyRowIndex(d, locale) {
  const sym = MONEY[locale].symbol;
  return d.rows.findIndex((r) => r[1].includes(sym));
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

/** 「1つの数値」＝数字と桁区切り（, / . / 空白）の最長連続。
 * 3桁グループを前提にすると、桁の切り方が不規則な番号（"123 45 6789" のような
 * 社会保障番号）で途中で切れて "13 1313" のような残骸になる。g フラグは replace 用。 */
const NUM_RUN = /[0-9][0-9 ,.]*[0-9]|[0-9]/g;
/** can の判定用。g フラグ付きを .test() に使うと lastIndex が進んで結果が揺れる。 */
const HAS_NUM = /[0-9]/;
const DIGIT = /[0-9]/g;

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
    can: (d, locale) => moneyRowIndex(d, locale) >= 0,
    apply: (s, locale) => {
      // 括弧記法 (1,200,000) は英語・スペイン語の会計慣習として「正しい」ので使わない（L-5）。
      // U+2212 は値の文字列の先頭に置く。前置記号のロケールは「−¥1,200,000」、
      // 後置記号のロケールは「−1 200 000 ₽」となり、どちらも現地の負数表記として自然（L-32）。
      const i = moneyRowIndex(s, locale);
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
    can: (d, locale) => moneyRowIndex(d, locale) >= 0,
    apply: (s, locale) => {
      const i = moneyRowIndex(s, locale);
      s.rows[i][1] = TEXT[locale].soul;
    },
  },

  four: {
    can: (d) => d.rows.some((r) => HAS_NUM.test(r[1])),
    // 忌み数はロケールで違う（L-33）。1桁（4）なら「数字を1文字ずつ」置き換えて
    // 桁の見た目を保ち、2桁（13）なら「数値ごと」置き換える。
    // 13 で1文字ずつ置換すると ¥13131313... になり、異変ではなく壊れたデータに見える。
    apply: (s, locale) => {
      const n = UNLUCKY[locale];
      s.rows.forEach((r) => {
        r[1] = n.length === 1
          ? r[1].replace(DIGIT, n)
          : r[1].replace(NUM_RUN, n);
      });
    },
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
      // L-20: 候補「箇所」から一様に引くと、その言語で頻出する字に偏る。
      // ru を実測すると и→й が 47箇所中22、いっぽう最も効く ь→ъ（1918年以前の
      // 正書法＝革命前の綴り）は 3 しかなく、実質ほとんど出なかった。
      // まず「置換の種類」を一様に引き、そのうえで箇所を引く。
      // 16種の異変が一様に出る設計と揃う（種類が異変の味であって、箇所ではない）。
      const kinds = [...new Set(cands.map((c) => c[2]))];   // 出現順＝決定的
      const ch = kinds[pick(rng, kinds.length)];
      const sites = cands.filter((c) => c[2] === ch);
      const [ri, ci] = sites[pick(rng, sites.length)];
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

/** そのロケールの通貨モデル（記号・位置・桁区切り・小数点）＝L-31。 */
export function money(locale) {
  assertLocale(locale);
  return { ...MONEY[locale] };
}

/** 整数をそのロケールの通貨表記にする。 */
export function formatMoney(locale, amount) {
  assertLocale(locale);
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error(`formatMoney: amount は有限の数値が必要です（受け取った値: ${JSON.stringify(amount)}）`);
  }
  return fmt(locale, amount);
}

/** そのロケールの忌み数（L-33）。日本と中国は "4" を共有する。 */
export function unluckyNumber(locale) {
  assertLocale(locale);
  return UNLUCKY[locale];
}

/** そのロケールの申告期限と日付の書き順（L-30）。
 * 暗証番号はここから導出する。正解値そのものはこのモジュールに書かない（L-34c）。 */
export function deadline(locale) {
  assertLocale(locale);
  return { ...DEADLINE[locale] };
}

/** そのロケールの税務当局（すべてパロディ名＝L-35b）。 */
export function authority(locale) {
  assertLocale(locale);
  return AUTHORITY[locale];
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
