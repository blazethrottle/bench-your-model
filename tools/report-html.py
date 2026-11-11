# Builds the standalone report page (data/report.html) from data/report.json, the appendix table and the video stills.
import json, base64, html, os
R = json.load(open('data/report.json')); A = json.load(open('data/report-appendix.json'))
sheet = base64.b64encode(open('data/stills/sheet.jpg', 'rb').read()).decode() if os.path.exists('data/stills/sheet.jpg') else ''
e = html.escape
COLS = ['coding-6', 'research-5', 'planning-5', 'repeat-5', 'openAvg', 'debug-5', 'debug-6', 'web-1', 'writing-1', 'video-1', 'video-2', 'shortAvg', 'shortSec', 'timeouts']
GROUPS = [('정답이 없는 고난도 과제 (3회)', 5), ('프로젝트 과제 (1회)', 2), ('웹 · 문서 · 동영상 (2회)', 4), ('일반 과제 33개 (1회)', 2), ('안정성', 1)]
title = {c['id']: c for c in R['columns']}
def table(rep):
    h = '<div class="scroll"><table class="score"><thead><tr><th rowspan="2" class="first">모델 · 추론 강도</th>' + ''.join(f'<th colspan="{n}" class="grp">{e(t)}</th>' for t, n in GROUPS) + '</tr><tr>' + ''.join(f'<th>{e(title[c]["title"])}</th>' for c in COLS) + '</tr></thead><tbody>'
    for r in rep['rows']:
        fam = 'grok' if r['provider'] == 'grok' else 'claude'
        h += f'<tr><td class="first"><span class="dot {fam}"></span>{e(r["label"])}<small>{e(r["sub"].replace("추론 강도 ", ""))}</small></td>'
        for c in COLS:
            x = r['cells'].get(c)
            if not x: h += '<td class="na">미측정</td>'; continue
            mark = {'best': '<b class="mk">●</b>', 'tie': '<b class="mk tie">○</b>'}.get(x.get('mark'), '')
            style = f' style="background:color-mix(in oklab, var(--heat) {round(max(0, min(100, x["score"])) * 0.42)}%, transparent)"' if isinstance(x.get('score'), (int, float)) and c not in ('shortSec',) else ''
            sub = f'<small class="{"warn" if x.get("warn") else ""}">{e(x["s"])}</small>' if x.get('s') else ''
            h += f'<td{style}>{e(x["v"])}{mark}{sub}</td>'
        h += '</tr>'
    return h + '</tbody></table></div>'
def crit():
    return '<div class="scroll"><table class="crit"><thead><tr><th>업무</th><th>먼저 쓸 조합</th><th>대안</th><th>근거</th></tr></thead><tbody>' + ''.join(f'<tr><td class="w">{e(c["work"])}</td><td class="p {"g" if "Grok" in c["pick"] else ""}">{e(c["pick"])}</td><td>{e(c.get("alt") or "-")}</td><td class="y">{e(c["why"])}</td></tr>' for c in R['criteria']) + '</tbody></table></div>'
ASSIGN = [
 ('Claude', 'Sonnet 5.5 · low', '기본값', '짧은 질문과 요약, 분류, 계산 · 명세가 분명한 코드 수정 · 최신 값 실시간 조회 · 동영상 편집', '일반 평균 92.3점, 응답 7.5초(전 조합 중 가장 빠름) · 결함 수정 100점 27초 · 조회 100점 17초'),
 ('Claude', 'Haiku 5.5 · low', '대량 처리', '같은 형식의 짧은 작업을 많이 돌릴 때 · 단순 조회와 변환', '일반 평균 92.4점, 응답 10.5초 · 수요 예측 32점, 로그 압축 45점으로 깊은 분석에는 부적합'),
 ('Claude', 'Opus 5.5 · low', '정확도 우선', '코드 검토(결함 찾기) · 비정형 자료를 정리하는 프로그램 작성 · 코드로 그리는 동영상 제작', '코드 검토 100점 89초 · 메모 정규화 세 번 모두 100점 71초 · 일반 평균 93.7점'),
 ('Claude', 'Sonnet 5.5 · high', '분석과 문서의 대안', '긴 보고서와 기획 문서 · 데이터 분석(Opus 한도를 아낄 때)', '긴 문서 79점(Opus high와 같음) · 수요 예측 87점 · low로 내리면 수요 예측 57점'),
 ('Claude', 'Opus 5.5 · high', '깊은 작업', '데이터 분석과 예측 모델 · 제약이 많은 계획과 일정 최적화 · 대표 보고용 긴 문서', '수요 예측 90점 · 일정 최적화 88점(범위 85~88, 가장 일정함) · 긴 문서 79점 · 일반 평균 94.8점'),
 ('Claude', 'Fable 5.2', '마지막 수단', '위 조합으로 두 번 시도해도 풀리지 않는 문제', '고난도 평균 92~95점(전 조합 중 최고) · 주간 한도 소모가 커서 상시 사용 제외'),
 ('Grok', 'Grok 4.7 Build Fast · low', '성능 코딩 · 대체', '압축률이나 처리 속도를 끝까지 끌어올리는 코딩(몇 분 대기 가능할 때) · Claude 한도가 부족할 때의 정답형 업무', '로그 압축 79점(Opus high 66점) · 결함 수정, 코드 검토, 조회, 동영상 편집 100점 · 시간 초과 55건 중 1건'),
 ('Grok', 'Grok 4.7 · low', '성능 코딩', '위와 같은 용도 · 압축 과제 최고점이나 속도는 더 느림', '로그 압축 84점 · 수요 예측 77점 · 시간 초과 55건 중 7건, 과제당 8~10분'),
 ('Grok', 'Grok 4.7 계열 · high', '사용 금지', '여러 단계 작업에 쓰지 않음', '측정한 과제 8건 모두 10분 제한 초과, 7건 0점'),
]
assign = '<div class="scroll"><table class="crit"><thead><tr><th>구분</th><th>조합</th><th>역할</th><th>맡길 업무</th><th>측정 근거</th></tr></thead><tbody>' + ''.join(f'<tr><td><span class="dot {"grok" if a[0]=="Grok" else "claude"}"></span>{a[0]}</td><td class="p {"g" if a[0]=="Grok" else ""}">{e(a[1])}</td><td class="w">{e(a[2])}</td><td>{e(a[3])}</td><td class="y">{e(a[4])}</td></tr>' for a in ASSIGN) + '</tbody></table></div>'
STEPS = [
 ('정답이 정해진 일인가', '코드 수정, 자료 정리, 조회, 변환, 짧은 질문이면 Claude Sonnet 5.5 · low. 양이 많으면 Haiku 5.5 · low.'),
 ('틀리면 손해가 큰 검토인가', '코드 검토처럼 빠뜨리면 안 되는 일이면 Claude Opus 5.5 · low.'),
 ('더 좋은 답을 찾아야 하는 일인가', '데이터 분석, 예측, 일정 최적화, 긴 보고서이면 Claude Opus 5.5 · high. 한도를 아끼려면 Sonnet 5.5 · high.'),
 ('성능 수치를 끝까지 끌어올리는 코딩인가', '압축률, 처리 속도처럼 수치로 겨루는 구현이고 5~10분을 기다릴 수 있으면 Grok 4.7 Build Fast · low.'),
 ('Claude 한도가 부족한가', '1번과 2번 업무는 Grok 4.7 Build Fast · low로 넘겨도 점수가 같음. 대기 시간만 몇 분 늘어남.'),
 ('두 번 시도해도 안 풀리는가', '그때만 Claude Fable 5.2.'),
]
steps = ''.join(f'<li><b>{e(q)}</b><span>{e(a)}</span></li>' for q, a in STEPS)
page = f'''<title>Grok · Claude 업무 분담 성적서</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* layout: one reading column for conclusions, full-width scrolling tables for the score sheet */
:root {{ --bg:#f6f7f4; --card:#ffffff; --fg:#161a17; --sub:#5a645d; --line:#d9ded8; --claude:#b4532a; --grok:#1f5fa8; --heat:#2f8f6b; --warn:#b3261e; --font:"IBM Plex Sans KR","Apple SD Gothic Neo","Noto Sans KR",sans-serif; --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#111512; --card:#191e1a; --fg:#e7ece7; --sub:#9aa69d; --line:#2b332d; --claude:#e58a5f; --grok:#6aa6ea; --heat:#3fae84; --warn:#ff8a80; color-scheme:dark }} }}
:root[data-theme="dark"] {{ --bg:#111512; --card:#191e1a; --fg:#e7ece7; --sub:#9aa69d; --line:#2b332d; --claude:#e58a5f; --grok:#6aa6ea; --heat:#3fae84; --warn:#ff8a80; color-scheme:dark }}
body {{ background:var(--bg); color:var(--fg); font:15px/1.65 var(--font); padding-block:28px 56px; padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)) }}
main {{ max-width:1180px; margin:0 auto; display:flex; flex-direction:column; gap:28px }}
h1 {{ font-size:28px; line-height:1.25; margin:0; text-wrap:balance }} h2 {{ font-size:19px; margin:0 0 12px; text-wrap:balance }} p {{ margin:0 }}
.meta {{ color:var(--sub); font-size:13px }} .lead {{ max-width:68ch; display:flex; flex-direction:column; gap:10px }}
section {{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:22px; min-width:0 }}
.split {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px }}
.side {{ border-top:4px solid var(--claude); padding-top:12px }} .side.g {{ border-top-color:var(--grok) }}
.side h3 {{ margin:0 0 8px; font-size:16px }} .side ul {{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px }}
.scroll {{ overflow-x:auto }} table {{ border-collapse:collapse; width:100%; font-size:13.5px }}
th, td {{ border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top }}
thead th {{ color:var(--sub); font-weight:600; font-size:12.5px; white-space:nowrap }}
.score td, .score th {{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums }} .score .first {{ text-align:left; position:sticky; left:0; background:var(--card) }}
.score .grp {{ text-align:center; border-left:1px solid var(--line) }} .score td {{ font-family:var(--mono); font-size:13px }} .score td.first {{ font-family:var(--font); font-weight:600 }}
small {{ display:block; color:var(--sub); font-weight:400; font-size:11.5px; font-family:var(--font) }} small.warn {{ color:var(--warn) }} .na {{ color:var(--sub); font-family:var(--font) !important; font-size:12px !important }}
.mk {{ color:var(--heat); margin-left:3px; font-size:10px }} .dot {{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; background:var(--claude) }} .dot.grok {{ background:var(--grok) }}
.crit td.p {{ font-weight:600; color:var(--claude); white-space:nowrap }} .crit td.p.g {{ color:var(--grok) }} .crit td.w {{ font-weight:600; min-width:150px }} .crit td.y {{ color:var(--sub); min-width:300px }}
ol.steps {{ margin:0; padding-left:22px; display:flex; flex-direction:column; gap:10px; max-width:80ch }} ol.steps b {{ display:block }} ol.steps span {{ color:var(--sub) }}
ul.notes {{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; max-width:90ch }} figure {{ margin:0 }} figcaption {{ color:var(--sub); font-size:13px; margin-top:8px }} img {{ border-radius:6px; border:1px solid var(--line) }}
</style>
<main>
<header class="lead">
 <p class="meta">구독 LLM 벤치마크 · 2026-11-11 · 실사용 환경 · 호출 714건</p>
 <h1>Grok · Claude 업무 분담 성적서</h1>
 <p>대부분의 업무에서 두 계열의 점수가 같고, 그런 업무에서는 Claude가 대체로 2배 이상 빠릅니다. 따라서 기본 창구는 Claude이고, Grok은 성능 수치를 끝까지 끌어올리는 코딩과 Claude 한도가 부족할 때의 대체 창구입니다.</p>
 <p class="meta">측정 대상은 Grok Build 명령줄에서 모델과 추론 강도를 지정해 돌린 결과입니다. Grok Bot은 모델을 자동으로 고르므로 Grok 쪽 수치는 Grok Bot의 근사치입니다.</p>
</header>
<section><h2>1. 결론: 창구별 분담</h2>
 <div class="split">
  <div class="side"><h3><span class="dot"></span>Claude에 맡길 업무</h3><ul>
   <li>짧은 질문, 요약, 분류, 계산, 명세가 분명한 코드 수정 (점수 같음, 응답 7~17초 대 Grok 18~24초)</li>
   <li>코드 검토, 비정형 자료 정리 (100점, 1~2분 대 Grok 5~10분)</li>
   <li>데이터 분석과 예측 (Opus high 90점 대 Grok 4.7 low 77점)</li>
   <li>계획과 일정 최적화 (Opus high 88점 대 Grok 75~76점)</li>
   <li>긴 보고서와 기획 문서 (79점 대 60~68점)</li>
   <li>최신 값 조회, 동영상 편집과 제작 (점수 같음, 조회와 제작은 Claude가 2배 이상 빠름)</li></ul></div>
  <div class="side g"><h3><span class="dot grok"></span>Grok에 맡길 업무</h3><ul>
   <li>성능 수치를 끝까지 끌어올리는 코딩 (로그 압축 79~84점 대 Opus high 66점, 대신 7~10분 소요)</li>
   <li>Claude 한도가 부족할 때의 정답형 업무 대체 (코드 수정, 검토, 정리, 조회, 편집에서 97~100점)</li>
   <li>그림 파일 생성 (Claude에는 없는 기능, 점수 비교 대상 아님)</li>
   <li>강도는 항상 low. high는 측정한 8건 모두 10분 제한 초과</li></ul></div>
 </div></section>
<section><h2>2. 모델과 추론 강도별 업무 지정</h2>{assign}</section>
<section><h2>3. 작업 지정 요령</h2><p class="meta" style="margin-bottom:12px">위에서부터 차례로 묻고, 처음으로 해당하는 줄의 조합을 사용</p><ol class="steps">{steps}</ol></section>
<section><h2>4. 통합 성적표</h2>{table(R)}<p class="meta" style="margin-top:10px">{e(R["legend"])} 칸 아래 작은 글씨는 점수 범위 · 측정 횟수 · 걸린 시간(중앙값)입니다.</p></section>
<section><h2>5. 업무별 선택 기준과 근거</h2>{crit()}</section>
{f'<section><h2>6. 동영상 제작 결과의 장면 비교</h2><figure><div class="scroll"><img src="data:image/jpeg;base64,{sheet}" alt="모델별 소개 영상의 장면 사진 세 장씩" width="960"></div><figcaption>위에서부터 Opus 5.5 high, Sonnet 5.5 high, Haiku 5.5 high, Grok 4.7 low, Grok 4.7 Build Fast low. 각 영상의 15%, 50%, 85% 지점. 모든 영상은 코드와 ffmpeg로 그린 결과이며 자동 검사 조건 8개를 모두 통과.</figcaption></figure></section>' if sheet else ''}
<section><h2>7. 한계와 미확인 사항</h2><ul class="notes">{''.join(f'<li>{e(n)}</li>' for n in R['notes'])}</ul></section>
<section><h2>부록: 이전 세대 Grok 모델 (참고)</h2>{table(A)}<p class="meta" style="margin-top:10px">Grok 4.6과 Grok 4.5는 Grok Bot이 4.7 이상을 쓴다는 전제에 따라 선택 기준에서 제외. 이 표의 ●와 ○는 표 안의 네 조합끼리 비교한 표시.</p></section>
</main>
'''
open('data/report.html', 'w', encoding='utf8').write(page)
print(len(page), '—' in page)
