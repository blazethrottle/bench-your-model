#!/bin/zsh
# Third round: everything Fable missed while its weekly limit was exhausted.
cd "$(dirname "$0")/.."
while pgrep -f "test/campaign2.sh" > /dev/null; do sleep 30; done
B=http://127.0.0.1:4173
wait_idle() { until curl -s $B/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"\|^null$'; do sleep 20; done }
FAB='"claude:claude-fable-5-2"'
run() { wait_idle; echo "#### $1"; ./test/run-and-show.sh "$2"; }
run "Fable open x2"  "{\"models\":[$FAB],\"efforts\":[\"low\",\"high\"],\"repeat\":2,\"taskIds\":[\"coding-6\",\"research-5\",\"planning-5\",\"repeat-5\"],\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "Fable extra x2" "{\"models\":[$FAB],\"efforts\":[\"low\",\"high\"],\"repeat\":2,\"taskIds\":[\"web-1\",\"writing-1\",\"video-1\",\"video-2\"],\"depth\":\"long\",\"mode\":\"asused\",\"parallel\":4}"
run "Fable short"    "{\"models\":[$FAB],\"efforts\":[\"low\",\"high\"],\"depth\":\"full\",\"mode\":\"asused\",\"parallel\":2}"
echo "#### campaign3 finished"
