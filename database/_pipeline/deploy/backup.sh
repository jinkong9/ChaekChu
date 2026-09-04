#!/bin/bash
# 수집 결과 스냅샷. EC2 안에 둔다.
#
# PC 로 자동 회수는 못 한다 — 야간에 PC 가 꺼져 있으면 끌어올 수도 받을 수도
# 없다. 그래서 같은 디스크에 세대별로 남긴다. 인스턴스 자체가 사라지는 것은
# 못 막지만, 실제로 더 자주 일어나는 것들은 막는다:
#   - trim_trailing_misses 의 truncate() 가 잘못 자르는 경우
#   - 사람이 지우는 경우
#   - 잘못된 배포로 파일이 훼손되는 경우
set -u
DIR=$HOME/backups
KEEP=5

# 정보나루와 카카오를 모두 받는다. 예전에는 정보나루만 대상이라
# EC2 에서만 늘어나는 카카오 수집분은 사본이 없었다 (2026-09-04 추가).
SOURCES="$HOME/pipeline_data/data4library/d4l_usage.jsonl
$HOME/pipeline_data/kakao_enriched.jsonl"

for SRC in $SOURCES; do
  NAME=$(basename "$SRC" .jsonl)
  if [ ! -s "$SRC" ]; then
    echo "$(date -Is) [$NAME] 원본이 없거나 비었다 — 건너뜀"
    continue
  fi
  LINES=$(wc -l < "$SRC")

  # **줄어들었으면 덮지 않는다.** 훼손된 파일로 멀쩡한 백업을 밀어내면
  # 백업이 있으나 마나다.
  LAST=$(ls -1t "$DIR"/"${NAME}"_*.jsonl 2>/dev/null | head -1)
  if [ -n "$LAST" ]; then
    PREV=$(wc -l < "$LAST")
    if [ "$LINES" -lt "$PREV" ]; then
      echo "$(date -Is) [$NAME] 경고: 줄수 감소 ($PREV -> $LINES). 백업하지 않는다."
      continue
    fi
  fi

  DST=$DIR/${NAME}_$(TZ=Asia/Seoul date +%Y%m%d_%H%M).jsonl
  cp "$SRC" "$DST"
  echo "$(date -Is) [$NAME] 백업 $LINES줄 -> $(basename "$DST")"

  # 오래된 것부터 지운다 (최신 KEEP 개 유지)
  ls -1t "$DIR"/"${NAME}"_*.jsonl 2>/dev/null | tail -n +$((KEEP+1)) | while read -r f; do
    echo "$(date -Is) [$NAME] 오래된 백업 제거 $(basename "$f")"
    rm -f "$f"
  done
done
