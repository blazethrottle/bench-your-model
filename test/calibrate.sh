#!/bin/zsh
# Calibration for one candidate task: weakest model twice (run-to-run spread) and one strong model once.
# Usage: test/calibrate.sh <task-id>[,<task-id>...]     (the service must be running on 127.0.0.1:4173)
B=http://127.0.0.1:4173
T=$(echo "$1" | sed 's/,/","/g')
wait_done() { until curl -s $B/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"'; do sleep 15; done; }
start() { curl -s -X POST -H 'content-type: application/json' -d "$1" $B/api/run | head -c 120; echo; }
show() {
  curl -s $B/api/current | python3 -c "
import json,sys
r=json.load(sys.stdin)
for m in r['models']:
    print('==',m['label'],m['status'],(m.get('error') or '')[:100])
    for k,t in m['tasks'].items():
        print('  ',k,'점수',t['score'],'|',t['kind'],'|',round(t['ms']/1000),'초 |',t.get('turns'),'턴 | 입력',t['inTokens'],'출력',t['outTokens'],'| 거부',len(t.get('denials') or []))
        print('     ',t['detail'][:260])
"
}
start "{\"models\":[\"claude:claude-haiku-5-5\"],\"taskIds\":[\"$T\"],\"repeat\":2,\"depth\":\"long\",\"mode\":\"asused\"}"
wait_done; show
start "{\"models\":[\"claude:claude-opus-5-5\"],\"taskIds\":[\"$T\"],\"depth\":\"long\",\"mode\":\"asused\"}"
wait_done; show
