#!/bin/zsh
# LLM 벤치마커를 켜고 브라우저로 엽니다. 이 창을 닫으면 서비스가 꺼집니다.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$HOME/.grok/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)"; fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js를 찾지 못했습니다. Claude에게 '벤치마커가 node를 못 찾는다'고 알려 주세요."
  read -r "?Enter를 누르면 닫힙니다."
  exit 1
fi
if curl -s -o /dev/null http://127.0.0.1:4173/api/config; then
  echo "이미 실행 중입니다. 브라우저를 엽니다."
  open "http://127.0.0.1:4173"
  exit 0
fi
(sleep 1; open "http://127.0.0.1:4173") &
echo "LLM 벤치마커를 시작합니다. 끄려면 이 창을 닫거나 Control+C를 누르세요."
node server.mjs
