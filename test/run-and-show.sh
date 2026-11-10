#!/bin/zsh
# Starts one run through the local API with the given JSON body, waits for it, and prints per-task results.
# Usage: test/run-and-show.sh '<json body>'     (the service must be running on 127.0.0.1:4173)
B=http://127.0.0.1:4173
curl -s -X POST -H 'content-type: application/json' -d "$1" $B/api/run | head -c 100; echo
until curl -s $B/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"'; do sleep 15; done
curl -s $B/api/current | python3 -c "
import json,sys
r=json.load(sys.stdin)
for m in r['models']:
    print('==',m['label'],m['status'],(m.get('error') or '')[:160])
    for k,t in m['tasks'].items():
        print('  ',k,'점수',t['score'],'|',t['kind'],'|',round(t['ms']/1000),'초 |',t.get('turns'),'턴 | 입력',t['inTokens'],'출력',t['outTokens'],'| 정가',t.get('costUsd'),'| 거부',len(t.get('denials') or []))
        print('     ',t['detail'][:300])
"
