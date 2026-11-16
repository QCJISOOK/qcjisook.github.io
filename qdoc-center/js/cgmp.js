/* 품질문서 발행센터 — 「CGMP 기준」 탭
   출처: 식품의약품안전처 「우수화장품 제조 및 품질관리기준(CGMP) 해설서」(민원인 안내서, 2024.12) · 고시 제2024-46호
   쪽 번호는 해설서 인쇄 쪽 */
'use strict';
(function () {
const PS_REQ = [
  { no: '1', t: '제품명', d: '국문으로, 제품에 표기된 명칭과 일치 (부록2 예시 4.1.1)', sec: 's1', chk: x => x.label === '제품명' },
  { no: '2', t: '작성연월일', d: '제·개정일', sec: 'cover', chk: x => /작성/.test(x.label) },
  { no: '3', t: '효능·효과(기능성화장품의 경우) 및 사용할 때의 주의사항', d: '주의사항은 시행규칙 [별표 3] 유형별, 효능·효과는 심사·보고받은 내용 (부록2 p254)', sec: 's8', chk: x => /효능|주의사항/.test(x.label) && x.sec === 's8' },
  { no: '4', t: '원료명, 분량 및 제조단위당 기준량', d: '보완사례 15-1: 기준량 누락 지적', sec: 's2', chk: x => x.sec === 's2' && x.lvl === '필수' },
  { no: '5', t: '공정별 상세 작업내용 및 제조공정흐름도', d: '보완사례 17-1: 표준서 공정과 제조지시·기록서 공정이 달라 지적', sec: 'sMfg', chk: x => /5호/.test(x.label) },
  { no: '7', t: '작업 중 주의사항', d: '예시: 칭량·제조·충전·포장 시 주의사항 (부록2 p272)', sec: 'sMfg', chk: x => /7호/.test(x.label) },
  { no: '8', t: '원자재·반제품·벌크제품·완제품의 기준 및 시험방법', d: '벌크제품 = 충전(1차 포장) 전까지 제조를 마친 것 (제2조)', sec: 's7', chk: x => x.sec === 's7' && x.lvl === '필수' },
  { no: '9', t: '제조 및 품질관리에 필요한 시설 및 기기', d: '보완사례 15-2: 제조소 보유 설비 전체를 나열해 지적 → 이 제품에 쓰는 것만', sec: 'sMfg', chk: x => /9호/.test(x.label) },
  { no: '10', t: '보관조건', d: '보관 온도·습도는 안정성시험 결과를 참고해 설정 (p100)', sec: 's8', chk: x => x.label === '보관조건' },
  { no: '11', t: '사용기한 또는 개봉 후 사용기간', d: '', sec: 's8', chk: x => /사용기한 또는/.test(x.label) },
  { no: '12', t: '변경이력', d: '', sec: 'rev', chk: x => x.label === '변경이력' },
  { no: '14', t: '그 밖에 필요한 사항', d: '기능성 심사결과통지서(또는 보고서) 사본 등 → 기능성보고서 별첨', sec: 's13' }
];
const PS_REC = [
  ['품목마다 최초 생산 이전에 작성·비치', '해설 p84', '—'],
  ['기능성화장품 심사결과통지서(또는 심사제외품목보고서) 사본과 참고자료(기술제휴사 자료 등) 첨부', '해설 p84', '기능성보고서 별첨 · 올린 보고서 원본 자동 첨부'],
  ['개정 시 구본 사본은 현장에서 회수·폐기, 원본은 문서관리 부서에서 "무효본" 표시 후 보관', '해설 p84', '— (사내 문서관리 절차)'],
  ['문서 양식을 정해 통일성 있게, 페이지 번호, 제·개정 이력을 관리하기 쉽게', '해설 p84', '모든 쪽 머리·꼬리말 · 개정내역'],
  ['원본은 품질보증부서 비치, 관련 부서는 필요한 부분 사본 비치', '부록2 p255', '— (사내 문서관리 절차)'],
  ['제품표준서 작성 시 품질보증부서장 승인 후 효력 발생, 변경 시 즉시 개정', '부록2 p255', '표지 「검토 및 승인」 · 개정(Rev +1)'],
  ['예시 기재항목: 이론 생산량·수율관리기준, 제품 시험성적서, 제조지시 및 기록서(표준서 번호·제조번호·제조단위·원료 시험번호·실 사용량·설비명·지시자)', '부록2 p253~254', '완제품성적서 탭 (수율은 제조사 문서)'],
  ['예시 양식 1장 일반사항: 표준서번호·제품명·성상·보관조건·제조단위·포장단위·용법용량·효능효과·주의사항·표시성분(국/영문)·사용기한·이론수율', '부록2 p258', '제품 개요 (1쪽)'],
  ['예시 양식 2장 원료: 코드·배합목적·상품명·원료명·규격·함량', '부록2 p259', '별첨1 성분표'],
  ['예시 양식 8·9장 시설: 등록번호·설비명·규격 및 모델·Maker', '부록2 p270~271', '— (제조업자 설비 대장)']
];
const COA_REQ = [
  ['제조번호(뱃치)별로 시험기록 작성·유지', '제20조②', '성적서 1건 = LOT 1건'],
  ['시험결과 적합 또는 부적합인지 분명히 기록', '제20조③', '항목별 판정 칸'],
  ['적합 판정된 것만 사용·출고', '제20조④', '상태: 작성 중 → 승인 완료'],
  ['모든 시험이 적절했는지 시험기록 검토 후 적합·부적합·보류 판정', '제20조⑥', '항목별 판정 · 검토 서명'],
  ['기준일탈 시 책임자에게 보고 후 조사, 일탈·부적합·보류를 명확히 판정', '제20조⑦', '— (일탈 보고 절차)'],
  ['시험결과 적합으로 판정되고 품질부서 책임자가 출고 승인한 것만 출고 (긴급 출하도 동일 — 보완사례 19-2)', '제19조②', '승인 (품질관리 책임자) 서명 · 출고 기록은 별도'],
  ['완제품 보관용 검체: 제조단위별 사용기한까지 보관, 개봉 후 사용기간 표시품은 제조일로부터 3년', '제21조③', '— (보관용 검체 관리대장)'],
  ['시험용 검체 용기 표시: 명칭 또는 확인코드, 제조번호, 검체채취 일자', '제21조②', '— (검체 용기 라벨)']
];
const COA_REC = [
  ['검체', '명칭, 제조원, 제조번호, 식별코드번호, 채취일, 입고일 또는 제조일, 검체량', '제품명·제품코드·제조원·LOT·입고량 (채취일·입고일·검체량은 시험의뢰서·검체 라벨)'],
  ['시험방법', '사용 시험방법 기재 (또는 시험방법이 기재된 근거)', '시험방법 열 · 기준 근거(제품표준서 번호·개정번호)'],
  ['데이터', '원자료(raw data) — 기록·그래프·차트·스펙트럼', '특이사항(제조사 성적서 시험번호) · 반제품성적서 원본'],
  ['기준 및 판정', '판정결과와 고찰', '항목별 판정'],
  ['날짜·서명', '담당자·확인자 서명·날인, 책임자 검토·승인(기록의 정당성·완전성·적합성)', '작성·검토·승인']
];
const COA_REC2 = [
  ['표준서에 설정한 항목을 각각 따로가 아니라 한 장의 성적서에 기록', '해설 p105', '시험항목은 제품표준서 완제품시험기준서에서 자동'],
  ['시험의뢰서·검체채취기록·원자료·계산결과 등 그 뱃치의 시험 기록과의 관계를 알 수 있게', '해설 p104', '— (시험의뢰서)'],
  ['붙임7-1 양식: 제품명·품목코드·제조번호·생산수량·용량·제조일·충전일·시험번호·검체 채취일·채취량·시험 의뢰일·시험항목/기준/결과/검사자/비고·최종판정·판정일·담당·검토·승인', '부록2 p269', '성적서 양식 전체 (검사자 → 시험자 열)'],
  ['보관용 검체는 각 뱃치별로 제품시험을 2번 할 수 있는 양, 가장 안정한 조건에서', '해설 p99', '— (보관용 검체 관리대장)'],
  ['화장품 원료시험은 원료공급자의 검사결과 신뢰기준(대한화장품협회 자율규약)을 충족하면 공급자 성적서로 갈음 가능', '해설 p103', '— (원료)']
];
const CASES = [
  ['11-2', '자재 검수 성적서에서 입고일을 확인할 수 없음', '— (입고 기록)'],
  ['15-1', '제품표준서에 원료 분량·제조단위당 기준량, 이론생산량·수율, 시설·기기 미기재', '별첨1 기준량 자동 계산 · 제조지시 및 공정 기록서(자료 있을 때 별첨)'],
  ['15-2', '제품표준서 시설·기기에 제조소 보유 설비 전체를 기재', '— (제조업자 문서)'],
  ['17-1', '제품표준서 제조공정과 제조지시 및 기록서 공정이 서로 다름', '제조지시 및 공정 기록서 (자료 있을 때 별첨)'],
  ['19-2', '긴급 출하 시 품질책임자 출고 승인 없이 성적서로 출고', '성적서 출고 승인 칸 (필수)'],
  ['20-3', '시험 기록 검토 절차 없음 → 성적서 하단에 검토자 서명란 추가', '성적서 확인(검토) 서명 · 점검'],
  ['21-1', '시험용 검체 용기에 검체채취 일자 없음', '— (검체 라벨)'],
  ['21-2', '완제품 보관용 검체의 채취량·보관기한 미설정', '성적서 보관용 검체 칸'],
  ['21-3', '검체를 채취한 원자재에 채취 표시를 하지 않음', '— (현장 표시)']
];

function renderCgmp(m) {
  if (!V.cgPid || !prod(V.cgPid)) V.cgPid = S.products[S.products.length - 1]?.id || '';
  const p = prod(V.cgPid), ch = p ? psChecks(p) : [];
  const tb = el(`<div class="toolbar"><div class="ttl"></div></div>`); // 제목·출처 줄은 사용자 요청으로 뺌
  const sel = el(`<select style="width:auto;min-width:260px"><option value="">— 점검할 제품 —</option>${S.products.map(x => `<option value="${x.id}" ${x.id === V.cgPid ? 'selected' : ''}>${esc(x.code || '')} ${esc(x.nameKo)}</option>`).join('')}</select>`);
  sel.onchange = () => { V.cgPid = sel.value; render(); };
  tb.appendChild(el('<span class="hint">제품별 충족 여부</span>')); tb.appendChild(sel);
  m.appendChild(tb);
  const link = (sec, label) => { if (!sec || !p) return esc(label || ''); return `<a class="go" data-sec="${sec}" style="color:var(--navy);text-decoration:underline;cursor:pointer">${esc(label)}</a>`; };
  const secName = s => (SECS.find(x => x[0] === s) || [s, s])[1];

  // 0. 책임판매업자 간소본 기준 (작성 범위 '책임판매'일 때만)
  const lite = !!p && isLite(p);
  const c0 = el(`<div class="card" style="border-color:#b9cbe6"><h3>책임판매업자 간소본 — 작성 항목 <span class="r hint">표지 「작성 범위」가 '책임판매'인 제품 · 화장품법 시행규칙 제11조·제12조 · 한국콜마 발송본(MF10117403) 구성 대조</span></h3>
    <div style="line-height:1.7;margin-bottom:8px">· 제품표준서 <b>작성·보관 의무는 화장품제조업자</b>에게 있습니다 (시행규칙 제11조①2). CGMP 제15조②도 제조업자 대상입니다.<br>
    · 제조업자는 그중 <b>품질관리에 필요한 사항</b>을 책임판매업자에게 내야 하고, ODM 방식이면 품질·안전관리에 영향이 없는 영업비밀은 빼도 됩니다 (제11조①6 나목).<br>
    · 책임판매업자는 <b>받은 제품표준서를 보관</b>하고 (제12조3), <b>제조번호별 품질검사 후 유통</b>합니다 (제12조5). → 직접 쓰는 제품표준서는 이 품질관리에 필요한 범위만 담습니다.</div>
    <table class="list"><thead><tr><th style="width:40px">장</th><th>작성 항목</th><th>왜 필요한가</th><th style="width:150px">대시보드</th><th style="width:110px">${p ? esc(p.code || '선택 제품') : '충족'}</th></tr></thead><tbody></tbody></table>
    <div class="sub">작성하지 않고 '제조업자 문서 참조'로만 적는 항목</div>
    <div class="hint" style="color:var(--ink2)">${LITE_REF.map(esc).join(' · ')} — 한국콜마도 발송본에서 이 항목들을 "별첨·별책·지침 참조"로만 표시합니다. 표지의 '제조업자 제품표준서 (참조 문서)'에 번호를 적어 연결하세요.</div></div>`);
  const t0 = c0.querySelector('tbody'), chL = p ? psChecksLite(p) : [];
  LITE_TOC.forEach(([s, t, why], i) => {
    const rel = chL.filter(x => x.sec === s && x.lvl === '필수'), bad = rel.filter(x => !x.ok);
    const st = !p ? '<span class="hint">—</span>' : !rel.length ? chip('—', 'mute') : bad.length ? chip(`미충족 ${bad.length}`, 'bad') : chip('충족', 'good');
    t0.appendChild(el(`<tr><td>${i + 1}</td><td><b>${esc(t)}</b></td><td class="hint" style="color:var(--ink2)">${esc(why)}</td><td>${link(s, LITE_LABEL[s])}</td><td>${st}</td></tr>`));
  });
  // 1. 제품표준서 필수 (CGMP 제15조② — 기본)
  const c1 = el(`<div class="card" style="border-color:#b9cbe6"><h3>제품표준서 필수 기재사항 — CGMP 고시 제15조② (12개 항목)</h3><table class="list"><thead><tr><th style="width:44px">호</th><th>기재사항</th><th>해설·주의</th><th style="width:170px">대시보드 위치</th><th style="width:110px">${p ? esc(p.code || '선택 제품') : '충족'}</th></tr></thead><tbody></tbody></table></div>`);
  const t1 = c1.querySelector('tbody');
  PS_REQ.forEach(r => {
    let st = '<span class="hint">—</span>';
    if (p && lite && ['4', '5', '7', '9'].includes(r.no)) st = chip('제조업자 참조', 'mute');
    else if (p && lite && r.chk) { const rel = psChecksFull(p).filter(x => x.lvl === '필수' && r.chk(x)); const bad = rel.filter(x => !x.ok); st = !rel.length ? '<span class="hint">—</span>' : bad.length ? chip(`미충족 ${bad.length}`, 'bad') : chip('충족', 'good'); }
    else if (p && r.chk) { const rel = ch.filter(x => x.lvl === '필수' && r.chk(x)); const bad = rel.filter(x => !x.ok); st = !rel.length ? '<span class="hint">—</span>' : bad.length ? chip(`미충족 ${bad.length}`, 'bad') : chip('충족', 'good'); }
    else if (r.del) st = '<span class="hint">삭제</span>';
    t1.appendChild(el(`<tr style="${r.del ? 'color:var(--muted)' : ''}"><td>${r.no}</td><td><b>${esc(r.t)}</b></td><td class="hint" style="color:var(--ink2)">${esc(r.d)}</td><td>${r.sec ? link(r.sec, secName(r.sec)) : '—'}</td><td>${st}</td></tr>`));
  });
  m.appendChild(c1);
  if (lite) m.appendChild(c0);

  // 2. 제품표준서 권장
  const c2 = el(`<div class="card"><h3>제품표준서 — 해설서 권장 · 부록2 기준서 예시</h3><table class="list"><thead><tr><th>내용</th><th style="width:120px">근거</th><th style="width:260px">대시보드에서</th></tr></thead><tbody>${PS_REC.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="hint">${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table></div>`);
  m.appendChild(c2);

  // 3. 성적서 필수
  const c3 = el(`<div class="card"><h3>완제품성적서 — 고시 필수 (제19조·제20조·제21조) <span class="r hint">해설서 p97~112</span></h3><table class="list"><thead><tr><th>내용</th><th style="width:90px">근거</th><th style="width:280px">대시보드에서</th></tr></thead><tbody>${COA_REQ.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table></div>`);
  m.appendChild(c3);

  // 4. 성적서 권장
  const c4 = el(`<div class="card"><h3>완제품성적서 — 해설서 【시험성적서】 구성 (제조번호별) <span class="r hint">해설서 p106</span></h3><table class="list"><thead><tr><th style="width:110px">구분</th><th>기재 내용</th><th style="width:320px">대시보드 성적서 칸</th></tr></thead><tbody>${COA_REC.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table>
    <div class="sub">그 밖의 권장</div><table class="list"><thead><tr><th>내용</th><th style="width:110px">근거</th><th style="width:320px">대시보드에서</th></tr></thead><tbody>${COA_REC2.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="hint">${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table></div>`);
  m.appendChild(c4);

  // 5. 보완사례
  const c5 = el(`<div class="card"><h3>실사 보완(지적) 사례 — 양식에 반영할 것 <span class="r hint">해설서 부록4 p298~321</span></h3><table class="list"><thead><tr><th style="width:70px">사례</th><th>지적 내용</th><th style="width:320px">대시보드 반영</th></tr></thead><tbody>${CASES.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</tbody></table>
    <div class="hint" style="margin-top:8px">※ 해설서는 법적 효력이 없는 민원인 안내서이나, 고시(제15조②·제19조~제21조)에서 정한 기재사항은 반드시 기재해야 합니다(해설서 FAQ p280).</div></div>`);
  m.appendChild(c5);

  m.querySelectorAll('a.go').forEach(a => a.onclick = () => go('ps', { pid: p.id, sec: a.dataset.sec }));
}
RENDER.cgmp = renderCgmp;
})();
