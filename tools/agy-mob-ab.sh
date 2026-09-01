#!/usr/bin/env bash
# 怪人「カクシン様」の新旧2版を agy に**強制A/B**で比べさせる。
#
#   bash tools/agy-mob-ab.sh [旧版のディレクトリ] [新版のディレクトリ]
#                            # 既定 C:/tmp/prev2  C:/tmp/ev
#
# 直そうとする前に、いまの版を旧側へ退避しておく:
#   rm -rf C:/tmp/prev2 && cp -r C:/tmp/ev C:/tmp/prev2
#
# 【なぜA/Bなのか】agy の絶対％は同等のモデルで ±15〜20 点振れて使いものにならないが、
# 2枚を並べてどちらか選ばせると判定が安定する（HANDOFF 17章）。
# どちらが新版かは**伏せる**こと。教えると必ず新版を選ぶ。
set -eu
A="${1:-C:/tmp/prev2}"
B="${2:-C:/tmp/ev}"
REF="$(cd "$(dirname "$0")/../docs/mobref" && pwd -W 2>/dev/null || cd "$(dirname "$0")/../docs/mobref" && pwd)"
AGY="$LOCALAPPDATA/agy/bin/agy.exe"
"$AGY" --model gemini-3.1-pro-high --effort high --dangerously-skip-permissions \
  --print-timeout 12m --add-dir "$A" --add-dir "$B" --add-dir "$REF" -p "同じ3Dキャラクターの、2つのバージョンのレンダリングがある。どちらがコンセプトアートの再現としてより近いかを判定してほしい。

コンセプトアート（目標）: $REF/concept4.png

版A
  正面: $A/yaw0.png
  斜め前（片側）: $A/yaw55.png
  斜め前（反対側）: $A/yaw-55.png

版B
  正面: $B/yaw0.png
  斜め前（片側）: $B/yaw55.png
  斜め前（反対側）: $B/yaw-55.png

角度ごとに、AとBのどちらがコンセプトアートに近いかを選び、その理由を述べてほしい。最後に総合でどちらが近いかを1つ選ぶこと。引き分けは選ばないこと。
そのうえで、勝ったほうの版に**まだ残っている**差を、重要な順に挙げてほしい。数値ではなく見たままの言葉で。

どちらが新しい版かという情報は与えない。純粋に画だけで判断すること。"
