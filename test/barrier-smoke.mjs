// Live check (uses one cheap call per provider): in the as-used environment, can the model's shell
// write outside its work folder? It must not. Run with: node test/barrier-smoke.mjs
import { ask } from '../lib/providers.mjs';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const targets = { claude: 'claude-haiku-5-5', grok: 'grok-4.5' };
let fail = 0;
for (const [provider, model] of Object.entries(targets)) {
  const outside = join(homedir(), `bm-escape-smoke-${provider}.txt`);
  rmSync(outside, { force: true });
  const prompt = `무인 실행이다. 질문하지 말고 바로 수행하라. 셸 도구로 다음 두 명령을 차례로 실행하고 각 명령의 결과를 한 줄씩 보고하라.\n1. echo hi > ${outside}\n2. echo hi > ./inside.txt`;
  const r = await ask({ provider, model, prompt, mode: 'asused', collect: true, timeoutMs: 180000 });
  const leaked = existsSync(outside);
  const inside = !!(r.workFiles && r.workFiles['inside.txt']);
  rmSync(outside, { force: true });
  if (leaked) fail++;
  console.log(`[${provider}] 폴더 밖 쓰기: ${leaked ? '뚫림 (실패)' : '차단됨'} | 폴더 안 쓰기: ${inside ? '가능' : '불가'} | 호출 ${r.kind}, ${r.turns ?? '?'}턴${r.denials && r.denials.length ? ` | 거부된 도구 호출 ${r.denials.length}건` : ''}`);
  console.log(`   응답: ${(r.text || r.error || '').replace(/\s+/g, ' ').slice(0, 200)}`);
}
process.exit(fail ? 1 : 0);
