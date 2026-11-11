// Work types outside pure text-and-code: live lookups on the web, a long written report, and video work.
//   web-1      look up current facts; the grader fetches the same facts at grading time and compares
//   writing-1  a long report from a brief; format checks plus blind judging by both model families
//   video-1    edit a given clip to a spec; the grader inspects the result files with ffprobe
//   video-2    produce a short clip from scratch; the grader checks properties, motion and sound, and keeps stills
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJson } from './util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lazy = (fn) => { let v; return () => (v === undefined ? (v = fn()) : v); };

// ---------- web-1 ----------
const NPM = ['typescript', 'vite', 'eslint', 'prettier'], PYPI = ['django', 'numpy', 'fastapi', 'pandas'], CRATES = ['serde', 'tokio'];
const getJson = async (url) => { const r = await fetch(url, { headers: { 'user-agent': 'llm-benchmarker (local tool)', accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); };
async function webTruth() {
  const t = {};
  await Promise.all([
    ...NPM.map(async (p) => { t[`npm_${p}`] = (await getJson(`https://registry.npmjs.org/${p}/latest`)).version; }),
    ...PYPI.map(async (p) => { const j = await getJson(`https://pypi.org/pypi/${p}/json`); t[`pypi_${p}`] = j.info.version; t[`pypi_${p}_date`] = (j.urls || []).map((u) => u.upload_time_iso_8601 || '').sort()[0].slice(0, 10); }),
    ...CRATES.map(async (p) => { t[`crate_${p}`] = (await getJson(`https://crates.io/api/v1/crates/${p}`)).crate.max_stable_version; }),
    (async () => { const idx = await getJson('https://nodejs.org/dist/index.json'); const rel = idx.filter((x) => /^v\d+\.\d+\.\d+$/.test(x.version)); t.node_current = rel[0].version.slice(1); t.node_lts = rel.find((x) => x.lts).version.slice(1); })(),
  ]);
  return t;
}
const WEB_KEYS = [...NPM.map((p) => `npm_${p}`), ...PYPI.flatMap((p) => [`pypi_${p}`, `pypi_${p}_date`]), ...CRATES.map((p) => `crate_${p}`), 'node_current', 'node_lts'];
export const webTask = {
  id: 'web-1', cat: 'web', title: '최신 정보 실시간 조회', long: true, openEnded: true, timeoutSec: 600, ref: '기준 풀이',
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라. 제한 시간은 10분이다.

아래 항목의 **지금 이 순간의** 값을 인터넷에서 직접 조회해 답하라. 기억에 있는 값은 오래됐을 가능성이 높으므로 반드시 공식 출처에서 확인하라. 채점기는 채점 시점에 같은 공식 출처를 조회해 대조한다.

1. npm 패키지 ${NPM.join(', ')} 각각의 latest 태그 버전 (출처: registry.npmjs.org)
2. PyPI 패키지 ${PYPI.join(', ')} 각각의 최신 정식 버전과 그 버전이 올라온 날짜(UTC, YYYY-MM-DD) (출처: pypi.org)
3. Rust 크레이트 ${CRATES.join(', ')} 각각의 최신 정식 버전 (출처: crates.io)
4. Node.js의 가장 최신 버전(node_current)과 가장 최신 LTS 버전(node_lts) (출처: nodejs.org)

버전은 앞의 v 없이 숫자와 점만 쓴다. 확인하지 못한 항목은 null로 둔다. 추측으로 채우지 마라.

최종 답은 응답 본문 맨 끝에 \`\`\`json 코드블록 하나로만 제시하라. 키는 다음과 같다:
${WEB_KEYS.join(', ')}`,
  async score(answer) {
    const a = extractJson(answer);
    if (!a || typeof a !== 'object') return { score: 0, detail: '답 형식 오류' };
    let truth; try { truth = await webTruth(); } catch (e) { try { truth = await webTruth(); } catch (e2) { throw new Error(`기준값 조회 실패: ${e2.message}`); } }
    const norm = (v) => String(v ?? '').trim().replace(/^v/, '');
    const wrong = WEB_KEYS.filter((k) => norm(a[k]) !== norm(truth[k]));
    const nulls = WEB_KEYS.filter((k) => a[k] === null || a[k] === undefined).length;
    const ok = WEB_KEYS.length - wrong.length;
    return { score: Math.round((100 * ok) / WEB_KEYS.length), detail: `일치 ${ok}/${WEB_KEYS.length}${nulls ? `, 미확인 ${nulls}` : ''}${wrong.length ? ` · 불일치: ${wrong.map((k) => `${k}(답 ${norm(a[k]) || '없음'}, 기준 ${truth[k]})`).join(', ')}` : ''}`.slice(0, 600), raw: { ok, total: WEB_KEYS.length, nulls } };
  },
};

// ---------- writing-1 ----------
const BRIEF = `회사: 온결(가상의 회사). 서울 성수동에서 원두 정기배송 서비스를 운영한다.
현황(2026년 3분기):
- 유료 구독자 4,200명, 월 구독료 평균 23,000원, 월 매출 약 9,660만원
- 월 해지율 6.8% (1년 전 4.1%)
- 신규 구독자 획득 비용 1인당 38,000원 (1년 전 21,000원)
- 해지 설문(응답 310명): "원두가 남는다" 41%, "가격 부담" 27%, "취향에 안 맞는다" 19%, 기타 13%
- 구독 3개월 차에 해지가 가장 많다(전체 해지의 34%)
- 배송 주기는 2주 고정이고 건너뛰기 기능이 없다
- 직원 9명, 월 고정비 5,200만원, 원두와 배송의 변동비는 매출의 46%
- 보유 현금 2억 1천만원, 추가 투자 유치 계획 없음
- 대표의 요구: 6개월 안에 월 해지율을 4.5% 이하로 낮추고, 그동안 월 현금 흐름이 적자가 되지 않아야 한다
- 제약: 개발자는 1명이며 외주 예산은 총 1,500만원까지다`;
const SECTIONS = ['1. 결론', '2. 현황 진단', '3. 실행 방안', '4. 재무 영향', '5. 위험과 대응', '6. 6개월 일정'];
const MUST = ['6.8', '4.5', '38,000', '41%', '1,500만'];
export const writingTask = {
  id: 'writing-1', cat: 'writing', title: '경영 보고서 작성 (긴 문서)', long: true, openEnded: true, timeoutSec: 600, ref: '기준 풀이',
  judge: { context: `아래 자료만으로 대표에게 올리는 해지율 개선 보고서(2,500~3,500자)를 쓰는 과제다. 정해진 여섯 개의 절로 구성해야 한다.\n\n${BRIEF}`, maxChars: 9000, detWeight: 0.3,
    rubric: [['논리', '진단에서 방안, 재무 영향, 일정까지 주장이 근거로 이어지는가. 앞뒤가 어긋나는 곳이 없는가'], ['근거 활용', '주어진 수치를 정확히 쓰고, 자료에 없는 사실을 지어내지 않았는가. 계산이 맞는가'], ['실행 가능성', '개발자 1명, 외주 1,500만원, 현금 흐름 적자 금지라는 제약 안에서 실제로 할 수 있는 방안인가. 우선순위가 분명한가'], ['문장', '군더더기 없이 읽히는가. 대표가 한 번 읽고 결정할 수 있는가']] },
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라. 제한 시간은 10분이다. 파일을 만들지 말고 응답 본문에 보고서 전문을 직접 써라.

아래 자료만 가지고, 대표에게 올리는 해지율 개선 보고서를 써라.

[자료]
${BRIEF}

[형식]
- 분량은 공백을 포함해 2,500자 이상 3,500자 이하다.
- 다음 여섯 개의 절 제목을 이 순서와 표기 그대로 쓴다: ${SECTIONS.join(' / ')}
- 자료에 없는 사실이나 수치를 지어내지 마라. 가정이 필요하면 가정이라고 밝혀라.
- 재무 영향 절에는 방안을 실행했을 때의 월 현금 흐름을 계산 과정과 함께 제시하라.
- 보고서 본문만 쓰고, 앞뒤에 인사말이나 설명을 붙이지 마라.`,
  async score(answer) {
    const text = String(answer || '').trim(); const len = text.length;
    if (len < 800) return { score: 0, detail: `분량 부족 (${len}자)` };
    const pos = SECTIONS.map((s) => text.indexOf(s)); const found = pos.filter((p) => p >= 0).length;
    const ordered = pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));
    const used = MUST.filter((m) => text.includes(m)).length;
    const lenPts = len >= 2500 && len <= 3500 ? 30 : len >= 2200 && len <= 3900 ? 15 : 0;
    const score = Math.round(lenPts + 40 * (found / SECTIONS.length) + (ordered ? 10 : 0) + 20 * (used / MUST.length));
    return { score, detail: `분량 ${len}자, 절 ${found}/${SECTIONS.length}${ordered ? '' : '(순서 다름)'}, 핵심 수치 ${used}/${MUST.length}` };
  },
};

// ---------- video ----------
const FF = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((d) => join(d, 'ffmpeg')).find(existsSync) || null;
const FP = FF ? join(dirname(FF), 'ffprobe') : null;
// Files a model produced are untrusted media: inspect them with network access denied and a time limit.
const tool = (bin, args, timeout = 30000) => {
  const wrap = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)', bin, ...args] : [bin, ...args];
  return spawnSync(wrap[0], wrap.slice(1), { timeout, maxBuffer: 3e7, env: {} });
};
function probe(file) {
  if (!FP || !existsSync(file) || statSync(file).size < 200) return null;
  const r = tool(FP, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  let j; try { j = JSON.parse(r.stdout.toString()); } catch { return null; }
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)), a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const fr = v && v.avg_frame_rate ? v.avg_frame_rate.split('/').map(Number) : null;
  return { duration: Number(j.format && j.format.duration) || 0, size: statSync(file).size, video: v ? { codec: v.codec_name, w: v.width, h: v.height, fps: fr && fr[1] ? Math.round((fr[0] / fr[1]) * 100) / 100 : null } : null, audio: a ? { codec: a.codec_name } : null };
}
const frame = (file, at, n = 16) => { const r = tool(FF, ['-v', 'error', ...(at < 0 ? ['-sseof', String(at)] : ['-ss', String(at)]), '-i', file, '-frames:v', '1', '-vf', `scale=${n}:${n}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return r.stdout && r.stdout.length === n * n * 3 ? r.stdout : null; };
const meanRgb = (buf) => { if (!buf) return null; const s = [0, 0, 0]; for (let i = 0; i < buf.length; i++) s[i % 3] += buf[i]; return s.map((x) => Math.round(x / (buf.length / 3))); };
const diff = (a, b) => { if (!a || !b) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const spread = (buf) => { if (!buf) return 0; let mn = 255, mx = 0; for (const x of buf) { if (x < mn) mn = x; if (x > mx) mx = x; } return mx - mn; };
const still = (file, at) => { const r = tool(FF, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '7', '-']); return r.stdout && r.stdout.length > 500 && r.stdout.length < 80000 ? r.stdout.toString('base64') : null; };
const loudness = (file) => { const r = tool(FF, ['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], 60000); const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(String(r.stderr)); return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : null; };

const source = lazy(() => {
  const f = join(ROOT, 'data', 'cache', 'source-v1.mp4');
  if (!existsSync(f) && FF) {
    mkdirSync(dirname(f), { recursive: true });
    const cols = ['FF0000', '00FF00', '0000FF', 'FFFF00'];
    spawnSync(FF, ['-v', 'error', '-y', ...cols.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=0x${c}:s=1920x1080:r=30:d=3`]), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-map', '4:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '12', f], { timeout: 120000 });
  }
  return existsSync(f) ? readFileSync(f) : Buffer.alloc(0);
});
const EDIT_README = `# 동영상 편집

\`source.mp4\`(12초, 1920x1080, 30fps, 소리 있음)를 편집해 아래 두 파일을 이 폴더에 만든다. 이 기기에는 ffmpeg가 설치되어 있다.

## out.mp4
- 원본의 3.0초부터 9.0초까지 구간(길이 6초)
- 해상도 1280x720
- 초당 24프레임
- 소리 없음(오디오 트랙 자체가 없어야 한다)
- 영상 코덱 H.264, 컨테이너 MP4

## audio.mp3
- 같은 구간(3.0초~9.0초)의 소리만 담은 MP3 파일
`;
const near = (v, t, tol) => typeof v === 'number' && Math.abs(v - t) <= tol;
export const videoEditTask = {
  id: 'video-1', cat: 'video', title: '동영상 편집 (구간, 해상도, 프레임, 소리)', long: true, openEnded: true, timeoutSec: 600, ref: '기준 풀이',
  get files() { return { 'README.md': EDIT_README, 'source.mp4': source() }; }, keep: ['__inspect.json'],
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라. 제한 시간은 10분이다. 시간이 지나면 그때까지 작업 폴더에 남긴 파일만으로 채점한다.

현재 작업 폴더에 동영상 편집 과제가 있다. README.md에 만들 파일과 조건이 적혀 있다. 조건을 모두 지킨 out.mp4와 audio.mp3를 이 폴더에 만들어라. 만든 뒤 조건을 지켰는지 직접 확인하라. 작업은 이 폴더 안에서만 하라. 끝나면 사용한 명령을 세 줄 이내로 요약해 응답하라.`,
  async inspect(cwd) {
    const out = join(cwd, 'out.mp4'), mp3 = join(cwd, 'audio.mp3');
    const o = probe(out), a = probe(mp3);
    return { out: o, mp3: a, first: o && o.video ? meanRgb(frame(out, 0.1, 8)) : null, last: o && o.video ? meanRgb(frame(out, -0.3, 8)) : null };
  },
  async score(_answer, work) {
    let x; try { x = JSON.parse(work['__inspect.json']); } catch { return { score: 0, detail: '결과 파일을 확인하지 못함' }; }
    const o = x.out;
    if (!o || !o.video) return { score: 0, detail: 'out.mp4 가 없거나 동영상이 아님' };
    const isCol = (c, i) => Array.isArray(c) && c[i] > 150 && c.every((v, k) => k === i || v < 110);
    const checks = [['길이 6초', near(o.duration, 6, 0.2)], ['1280x720', o.video.w === 1280 && o.video.h === 720], ['24프레임', near(o.video.fps, 24, 0.1)], ['소리 없음', !o.audio], ['H.264', o.video.codec === 'h264'], ['시작 지점', isCol(x.first, 1)], ['끝 지점', isCol(x.last, 2)], ['mp3 있음', !!(x.mp3 && x.mp3.audio && !x.mp3.video && x.mp3.audio.codec === 'mp3')], ['mp3 길이', !!x.mp3 && near(x.mp3.duration, 6, 0.3)]];
    const bad = checks.filter((c) => !c[1]).map((c) => c[0]);
    return { score: Math.round((100 * (checks.length - bad.length)) / checks.length), detail: `조건 ${checks.length - bad.length}/${checks.length} 충족${bad.length ? ` · 어긋난 조건: ${bad.join(', ')}` : ''}`, raw: { ok: checks.length - bad.length, total: checks.length } };
  },
};

const MAKE_README = `# 동영상 제작

가상의 서비스 "모닝브루"(원두 정기배송)의 소개 영상 \`intro.mp4\`를 이 폴더에 만든다. 원본 소재는 주어지지 않는다. 쓸 수 있는 도구(동영상 생성 기능, ffmpeg, 코드로 그리기 등)는 무엇이든 써도 된다. 이 기기에는 ffmpeg가 설치되어 있다.

## 조건
- 길이 8초 이상 12초 이하
- 해상도 1280x720, 초당 30프레임, H.264, MP4
- 서로 다른 장면이 세 개 이상이고, 장면 안에서도 움직임이 있어야 한다(정지 화면의 나열은 감점)
- 화면에 서비스 이름 "모닝브루"가 글자로 나온다
- 소리가 들어 있어야 한다(무음 트랙은 인정하지 않는다)
`;
export const videoMakeTask = {
  id: 'video-2', cat: 'video', title: '동영상 제작 (소개 영상)', long: true, openEnded: true, timeoutSec: 600, ref: '기준 풀이',
  files: { 'README.md': MAKE_README }, keep: ['__inspect.json'],
  prompt: `무인 실행이다. 질문하거나 계획만 내놓지 말고 끝까지 수행하라. 확인을 구하지 마라. 제한 시간은 10분이다. 시간이 지나면 그때까지 작업 폴더에 남긴 파일만으로 채점한다.

현재 작업 폴더에 동영상 제작 과제가 있다. README.md에 조건이 적혀 있다. 조건을 모두 지킨 intro.mp4를 이 폴더에 만들어라. 보기 좋은 영상일수록 좋다. 만든 뒤 조건을 지켰는지 직접 확인하라. 작업은 이 폴더 안에서만 하라. 끝나면 어떤 방법으로 만들었는지 세 줄 이내로 요약해 응답하라.`,
  async inspect(cwd) {
    const f = join(cwd, 'intro.mp4'); const p = probe(f);
    if (!p || !p.video || !(p.duration > 0)) return { probe: p };
    const N = 24, fr = Array.from({ length: N }, (_, i) => frame(f, (p.duration * (i + 0.5)) / N));
    const steps = fr.slice(1).map((b, i) => Math.round(diff(fr[i], b) * 10) / 10);
    return { probe: p, steps, detail: Math.round(Math.max(...fr.map(spread))), loud: p.audio ? loudness(f) : null, stills: [0.15, 0.5, 0.85].map((t) => still(f, p.duration * t)) };
  },
  async score(_answer, work) {
    let x; try { x = JSON.parse(work['__inspect.json']); } catch { return { score: 0, detail: '결과 파일을 확인하지 못함' }; }
    const p = x.probe;
    if (!p || !p.video) return { score: 0, detail: 'intro.mp4 가 없거나 동영상이 아님' };
    const steps = x.steps || []; const cuts = steps.filter((d) => d > 18).length, moving = steps.filter((d) => d > 0.4).length;
    const checks = [['길이 8~12초', p.duration >= 7.9 && p.duration <= 12.1], ['1280x720', p.video.w === 1280 && p.video.h === 720], ['30프레임', near(p.video.fps, 30, 0.1)], ['H.264', p.video.codec === 'h264'], ['소리 있음', !!p.audio && typeof x.loud === 'number' && x.loud > -60], ['장면 3개 이상', cuts >= 2], ['움직임', moving >= steps.length * 0.6], ['빈 화면 아님', x.detail > 60]];
    const bad = checks.filter((c) => !c[1]).map((c) => c[0]);
    return { score: Math.round((100 * (checks.length - bad.length)) / checks.length), detail: `조건 ${checks.length - bad.length}/${checks.length} 충족 (장면 전환 ${cuts}회, 움직임 구간 ${moving}/${steps.length}, 음량 ${x.loud ?? '-'}dB)${bad.length ? ` · 어긋난 조건: ${bad.join(', ')}` : ''} · 글자 표시와 보기 좋은 정도는 저장한 장면 사진으로 사람이 확인`, raw: { ok: checks.length - bad.length, total: checks.length, cuts, moving } };
  },
};

export const EXTRA_TASKS = [webTask, writingTask, videoEditTask, videoMakeTask];
export const EXTRA_CATEGORIES = [{ id: 'web', name: '실시간 조회', desc: '지금 시점의 값을 인터넷에서 조회하게 하고, 채점 시점에 같은 출처와 대조합니다.' }, { id: 'writing', name: '긴 문서 작성', desc: '자료를 주고 긴 보고서를 쓰게 한 뒤 형식 검사와 맹검 평가로 채점합니다.' }, { id: 'video', name: '동영상', desc: '동영상을 편집하거나 만들게 하고 결과 파일의 속성을 검사합니다.' }];
