#!/usr/bin/env bash
# 怪人「カクシン様」の絶対評価を agy に取らせる。
#
#   bash tools/agy-mob-eval.sh [レンダの置き場]     # 既定 C:/tmp/ev
#
# レンダは tools/shot-mob.mjs で撮る（正面 / 2時 / 10時）:
#   node shot-mob.mjs --out C:/tmp/ev --studio --flat --yaws=0,55,-55 --zoom=1.75 --ty=0.83
#
# 【重要】この絶対値は当てにならない。同等のモデルで 23〜70% まで振れる（HANDOFF 17章）。
# 版どうしの優劣は必ず tools/agy-mob-ab.sh（強制A/B）で判定すること。
# この台本は「％」ではなく**後半の指摘の本文**を読むために回す。
set -eu
EV="${1:-C:/tmp/ev}"
REF="$(cd "$(dirname "$0")/../docs/mobref" && pwd -W 2>/dev/null || cd "$(dirname "$0")/../docs/mobref" && pwd)"
AGY="$LOCALAPPDATA/agy/bin/agy.exe"
"$AGY" --model gemini-3.1-pro-high --effort high --dangerously-skip-permissions \
  --print-timeout 12m --add-dir "$EV" --add-dir "$REF" -p "3Dキャラクターモデルが、コンセプトアートの再現としてどこまで到達しているかを見てほしい。

参照（コンセプトアート）と、それを再現した3Dモデルのレンダリングを、同じ向きどうしで3組並べる。

1組目（正面）
  参照: $REF/v_front.png
  モデル: $EV/yaw0.png
2組目（斜め前・片側から）
  参照: $REF/ref2_side.png
  モデル: $EV/yaw55.png
3組目（斜め前・反対側から）
  参照: $REF/v_q_left.png
  モデル: $EV/yaw-55.png

各組について、参照とモデルの一致度を0〜100%で答え、最後に3組の平均を出してほしい。
そのうえで、一致度を下げている要因を重要な順に挙げ、それぞれ何がどう違うのかを具体的に述べてほしい。数値やパラメータではなく、見たままの言葉で。

なお全体の設定として、デザイン元の完成形はこれ: $REF/concept4.png"
