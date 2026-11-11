#!/bin/zsh
# Second round: the short tier that the usage limit cut off, then the web, writing and video tasks.
cd "$(dirname "$0")/.."
B=http://127.0.0.1:4173
wait_idle() { until curl -s $B/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"\|^null$'; do sleep 20; done }
EXTRA='["web-1","writing-1","video-1","video-2"]'
ALL7='"claude:claude-opus-5-5","grok:grok-4.7","claude:claude-sonnet-5-5","grok:grok-4.5","claude:claude-haiku-5-5","grok:grok-4.6","grok:grok-4.7-build-fast"'
HI5='"claude:claude-opus-5-5","grok:grok-4.5","claude:claude-sonnet-5-5","grok:grok-4.6","claude:claude-haiku-5-5"'
run() { wait_idle; echo "#### $1"; ./test/run-and-show.sh "$2"; }
run "extra low x2"   "{\"models\":[$ALL7],\"efforts\":[\"low\"],\"repeat\":2,\"taskIds\":$EXTRA,\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "extra high x2"  "{\"models\":[$HI5],\"efforts\":[\"high\"],\"repeat\":2,\"taskIds\":$EXTRA,\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "short high"     "{\"models\":[\"claude:claude-opus-5-5\",\"claude:claude-sonnet-5-5\",\"claude:claude-haiku-5-5\"],\"efforts\":[\"high\"],\"depth\":\"full\",\"mode\":\"asused\",\"parallel\":3}"
echo "#### campaign2 finished"
