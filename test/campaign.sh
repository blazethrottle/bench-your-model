#!/bin/zsh
# Runs the remaining measurement rounds one after another through the local API.
# Each line is one run; a run starts only after the previous one has finished.
cd "$(dirname "$0")/.."
B=http://127.0.0.1:4173
wait_idle() { until curl -s $B/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"'; do sleep 20; done }
OPEN='["coding-6","research-5","planning-5","repeat-5"]'
CL3='"claude:claude-opus-5-5","claude:claude-sonnet-5-5","claude:claude-haiku-5-5"'
ALL7='"claude:claude-opus-5-5","grok:grok-4.7","claude:claude-sonnet-5-5","grok:grok-4.5","claude:claude-haiku-5-5","grok:grok-4.6","grok:grok-4.7-build-fast"'
HI5='"claude:claude-opus-5-5","grok:grok-4.5","claude:claude-sonnet-5-5","grok:grok-4.6","claude:claude-haiku-5-5"'
FAB='"claude:claude-fable-5-2"'
run() { wait_idle; echo "#### $1"; ./test/run-and-show.sh "$2"; }
run "Fable open x1"        "{\"models\":[$FAB],\"efforts\":[\"low\",\"high\"],\"taskIds\":$OPEN,\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":2}"
run "low open x2"          "{\"models\":[$ALL7],\"efforts\":[\"low\"],\"repeat\":2,\"taskIds\":$OPEN,\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "high open x2"         "{\"models\":[$HI5],\"efforts\":[\"high\"],\"repeat\":2,\"taskIds\":$OPEN,\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "project low"          "{\"models\":[$ALL7,$FAB],\"efforts\":[\"low\"],\"taskIds\":[\"debug-5\",\"debug-6\"],\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "project high"         "{\"models\":[$HI5,$FAB],\"efforts\":[\"high\"],\"taskIds\":[\"debug-5\",\"debug-6\"],\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "short low"            "{\"models\":[$ALL7,$FAB],\"efforts\":[\"low\"],\"depth\":\"full\",\"mode\":\"asused\",\"parallel\":4}"
run "short high"           "{\"models\":[$HI5,$FAB],\"efforts\":[\"high\"],\"depth\":\"full\",\"mode\":\"asused\",\"parallel\":4}"
echo "#### campaign finished"
