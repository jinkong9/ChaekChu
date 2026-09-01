#!/bin/bash
# 30분마다 한 줄. 부재 중에 무슨 일이 있었는지 나중에 읽기 위한 것이다.
S=$(~/status.sh | tr "\n" " ")
printf "%s %s\n" "$(TZ=Asia/Seoul date +%m-%d\ %H:%M)" "$S"
