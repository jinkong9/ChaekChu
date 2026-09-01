#!/bin/bash
# 감시용 한 줄 상태. 필드가 밀리지 않게 key=value 로만 낸다.
# grep -c 는 0건일 때 종료코드 1 이라 "|| echo 0" 을 쓰면 0 이 두 번 나온다.
D=$HOME/pipeline_data/data4library
RET=$(grep -c "소진 —" $HOME/collect.log 2>/dev/null)
RSS=$(ps -eo rss,cmd | grep "[e]nrich_from_data4library" | head -1 | awk "{print int(\$1/1024)}")
echo "lines=$(wc -l < $D/d4l_usage.jsonl 2>/dev/null)"
echo "active=$(systemctl is-active d4l-collector 2>/dev/null)"
echo "rss=${RSS:-0}"
echo "retired=${RET:-0}"
echo "restarts=$(systemctl show d4l-collector -p NRestarts --value 2>/dev/null)"
echo "usage=$(tr -d " \n" < $D/d4l_key_usage.json 2>/dev/null)"
echo "disk=$(df --output=pcent / | tail -1 | tr -d " %")"
