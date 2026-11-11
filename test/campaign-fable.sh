#!/bin/zsh
# Waits for the main campaign script to finish, then repeats the open tasks twice for Fable.
cd "$(dirname "$0")/.."
while pgrep -f "test/campaign.sh" > /dev/null; do sleep 30; done
until curl -s http://127.0.0.1:4173/api/current | grep -q '"status":"\(done\|aborted\|error\)","env"'; do sleep 20; done
echo "#### Fable open x2"
./test/run-and-show.sh '{"models":["claude:claude-fable-5-2"],"efforts":["low","high"],"repeat":2,"taskIds":["coding-6","research-5","planning-5","repeat-5"],"depth":"long","mode":"asused","parallel":2}'
