/* 품질문서 발행센터 — 「자료로 작성」
   기능성 보고서(PDF) · 전성분표(엑셀, 함량 포함) · 반제품성적서(PDF, 스캔본 OK) · 제조업체(제조업 등록필증)
   → 제품표준서 · 완제품성적서 초안 자동 작성
   필요한 라이브러리(pdf.js · SheetJS · tesseract.js)는 처음 쓸 때 인터넷에서 불러온다. */
'use strict';
(function () {
const LIB = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfw: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  tess: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  tessOpts: {}
};
const MK = (window.MAKERS && window.MAKERS.items) || [];
const loaded = {};
function loadScript(u) {
  if (loaded[u]) return loaded[u];
  return loaded[u] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => { delete loaded[u]; rej(new Error('라이브러리를 불러오지 못했습니다 (인터넷 연결 확인): ' + u.split('/').pop())); }; document.head.appendChild(s); });
}
async function pdfjs() {
  await loadScript(LIB.pdf); const lib = window.pdfjsLib;
  if (!lib.__w && window.QDOC_ENV === 'artifact') {
    // 공유 페이지: 다른 곳의 작업자(worker)를 못 띄우므로 작업자 코드를 화면에서 바로 돌림 (pdfjsWorker 전역)
    await loadScript(LIB.pdfw); lib.GlobalWorkerOptions.workerSrc = LIB.pdfw; lib.__w = 1;
  }
  if (!lib.__w) { try { const code = await (await fetch(LIB.pdfw)).text(); lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); } catch (e) { lib.GlobalWorkerOptions.workerSrc = LIB.pdfw; } lib.__w = 1; }
  return lib;
}
let TW = null;
async function tessWorker() {
  if (TW) return TW; await loadScript(LIB.tess);
  try { TW = await Tesseract.createWorker('kor+eng', 1, LIB.tessOpts || {}); }
  catch (e) { console.error(e); throw new Error('글자 인식기(OCR)를 시작하지 못했습니다' + (window.QDOC_ENV === 'artifact' ? ' — 이 화면에서 막혔으면 PC의 발행센터(발행센터_열기.bat)에서 올려 주세요' : '') + ` (${e.message || e})`); }
  await TW.setParameters({ tessedit_pageseg_mode: '6' }); return TW;
}

/* ---------- 파일 보관 (IndexedDB: 원본·쪽 그림) ---------- */
const IDB = window.IDB = {
  db: null,
  async open() { if (this.db) return this.db; this.db = await new Promise((res, rej) => { const r = indexedDB.open('qdoc-center', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this.db; },
  async put(o) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(o); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
  async get(id) { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async del(id) { const db = await this.open(); return new Promise(res => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = res; }); }
};

/* ---------- 공통 ---------- */
const N = s => String(s ?? '').replace(/\s+/g, '');
const mkey = s => norm(String(s || '').replace(/주식회사|\(주\)|㈜|\(유\)|유한회사|co\.?,?\s*ltd\.?/gi, ''));
function normDate(s) { const m = String(s || '').match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/); return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : ''; }
function fmtPct(v) { if (v == null || v === '') return ''; const n = Number(v); if (isNaN(n)) return String(v); return String(+n.toFixed(6)); }
function compOf(s) { const t = String(s || ''); let m = t.match(/(\d)\s*제(?![가-힣])/); if (m) return m[1] + '제'; m = t.match(/step\s*(\d)/i); if (m) return m[1] + '제'; return ''; }
const roadKey = a => { const m = String(a || '').replace(/\s+/g, '').match(/([가-힣0-9]+(?:로|길)\d+(?:-\d+)?)/); return m ? m[1] : ''; };
function findMaker(name) { const k = mkey(name); if (!k) return null; return MK.find(m => [m.name, m.label, m.company].some(x => mkey(x) === k)) || MK.find(m => [m.name, m.label, m.company].some(x => mkey(x) && (mkey(x).includes(k) || k.includes(mkey(x))))) || null; }
const makerShort = m => m ? (m.label || m.name) : '';

/* ---------- PDF ---------- */
async function visualLines(page) {
  const tc = await page.getTextContent();
  const its = tc.items.filter(t => t.str.trim()).map(t => ({ s: t.str.trim(), x: t.transform[4], y: t.transform[5] }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  its.forEach(t => { const L = lines.find(l => Math.abs(l.y - t.y) < 4); if (L) L.i.push(t); else lines.push({ y: t.y, i: [t] }); });
  lines.sort((a, b) => b.y - a.y);
  return lines.map(l => { l.i.sort((a, b) => a.x - b.x); const cells = l.i.map(t => t.s); return { cells, text: cells.join(' | ') }; });
}
/* 제조사 제품표준서 안의 「벌크(반제품)시험기준서」·「완제품시험기준서」 표 — 글자 위치로 칸을 나눔
   (칸 안 글자가 여러 조각·여러 줄로 쪼개져 줄 단위로는 못 읽음) → { bulk: [...], finished: [...] }, 줄 = { code, item, basis, spec, note } */
async function parseSpecPages(doc) {
  const out = { bulk: [], finished: [] };
  const joinCell = ts => {
    const lines = []; ts.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(t => { const L = lines.find(l => Math.abs(l.y - t.y) < 3); if (L) L.t.push(t); else lines.push({ y: t.y, t: [t] }); });
    let s = '';
    lines.sort((a, b) => b.y - a.y).forEach(l => {
      let line = ''; let prev = null;
      l.t.sort((a, b) => a.x - b.x).forEach(t => { if (prev) { const gap = t.x - (prev.x + prev.w); line += gap > 1.5 ? ' ' : ''; } line += t.s; prev = t; });
      // 줄 바꿈 이음: 글자 중간에서 끊긴 줄(엑셀식 줄바꿈)은 붙이고, 「규정」「별표」 같은 낱말 경계는 띄움
      const wordGap = /(규정|기준|시험법|방법)$/.test(s) && /^(별표|원료|제\d|\d+\.)/.test(line);
      if (!s) s = line; else s += !wordGap && ((/[가-힣(\-/,]$/.test(s) && /^[가-힣)\d]/.test(line)) || /[-/]$/.test(s)) ? line : ' ' + line;
    });
    return s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  };
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const its = tc.items.filter(t => t.str.trim()).map(t => ({ s: t.str.trim(), x: t.transform[4], y: t.transform[5], w: t.width || 0 }));
    const all = its.map(t => t.s).join('').replace(/\s+/g, '');
    const kind = /완제품시험기준서/.test(all) ? 'finished' : /(벌크|반제품)시험기준서/.test(all) ? 'bulk' : null;
    if (!kind) continue;
    const lines = []; its.forEach(t => { const L = lines.find(l => Math.abs(l.y - t.y) < 4); if (L) L.t.push(t); else lines.push({ y: t.y, t: [t] }); });
    const head = lines.find(l => { const t = l.t.map(x => x.s).join('').replace(/\s/g, ''); return /항목/.test(t) && /(규격|기준)/.test(t); });
    if (!head) continue;
    // 머리 칸: 가까운 글자끼리 묶음 (「관 리 규 격」처럼 한 글자씩 떨어져 있어도)
    const H = []; head.t.sort((a, b) => a.x - b.x).forEach(t => { const L = H[H.length - 1]; if (L && t.x - L.x1 < 20) { L.s += t.s; L.x1 = t.x + t.w; } else H.push({ s: t.s, x0: t.x, x1: t.x + t.w }); });
    const names = H.map(h => h.s.replace(/\s/g, ''));
    const ci = re => names.findIndex(n => re.test(n));
    const cCode = ci(/코드|^no\.?$/i), cItem = ci(/항목명|시험항목|^항목$/), cBasis = ci(/근거|방법/), cSpec = ci(/규격|기준$/), cNote = ci(/비고/);
    if (cItem < 0 || cSpec < 0) continue;
    const stopY = Math.max(-1e9, ...its.filter(t => /특이사항/.test(t.s) && t.y < head.y).map(t => t.y));
    const B = its.filter(t => t.y < head.y - 3 && t.y > stopY + 3);
    // 열 왼쪽 끝 = 머리 아래 글자 x 빈도 꼭지 → 어느 머리 칸 사이에 있는지로 열 정함
    const cnt = new Map(); B.forEach(t => { const k = Math.round(t.x / 2) * 2; cnt.set(k, (cnt.get(k) || 0) + 1); });
    // 열 j 의 왼쪽 끝: 앞 머리 끝 ~ 이 머리 시작 사이에서 가장 자주 나오는 글자 시작 위치 (줄마다 첫 글자가 왼쪽 끝에 붙음)
    const L = H.map((h, j) => {
      if (!j) return -1e9;
      const lo = H[j - 1].x1 - 2, hi = h.x0 + 12, ps = [...cnt.entries()].filter(([x, n]) => n >= 2 && x > lo && x <= hi).sort((a, b) => b[1] - a[1] || a[0] - b[0]); // 2번 이상 나온 위치만 (앞 칸 긴 글의 꼬리 조각 제외)
      return ps.length ? ps[0][0] : h.x0 - 4; // 빈 칸(예: 비고)은 머리 시작 바로 앞 — 앞 칸의 긴 글이 넘어오지 않게
    });
    const colOf = x => { let c = 0; for (let j = 0; j < H.length; j++) if (x >= L[j] - 3) c = j; return c; };
    const anchors = B.filter(t => colOf(t.x) === cCode && /^\d{3,6}$/.test(t.s)).map(t => t.y).sort((a, b) => b - a); // 위에서 아래 순서
    if (!anchors.length) continue;
    const rows = anchors.map(() => H.map(() => []));
    B.forEach(t => { if (colOf(t.x) === cCode && /^\d{3,6}$/.test(t.s)) return; let k = 0; anchors.forEach((y, j) => { if (Math.abs(y - t.y) < Math.abs(anchors[k] - t.y)) k = j; }); rows[k][colOf(t.x)].push(t); });
    anchors.forEach((y, j) => {
      const code = (B.find(t => t.y === y && colOf(t.x) === cCode) || {}).s || '';
      const cell = c => c >= 0 ? joinCell(rows[j][c]) : '';
      const item = cell(cItem).replace(/[-\s]*\(?\b(RSSC|KFCC|CSTM)\b\)?/g, '').replace(/-?\s*허가사항\s*\*?/g, '').replace(/\s*\*+\s*$/, '').trim();
      // 관리규격 끝의 상·하한 숫자(예: 「5.200~ 7.200」)는 기계용 범위라 뺌
      const spec = cell(cSpec).replace(/\s*-?\d+(\.\d+)?\s*~\s*-?\d+(\.\d+)?\s*$/, '').trim();
      if (item) out[kind].push({ code, item, basis: cell(cBasis), spec, note: cell(cNote) });
    });
  }
  return out;
}
async function pageImages(doc, maxW = 1240) {
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const pg = await doc.getPage(i); const v0 = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: maxW / v0.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise; out.push(c.toDataURL('image/jpeg', 0.82));
  }
  return out;
}

/* ---------- 1) 기능성 보고서 ---------- */
function labelVal(lines, re) {
  for (const L of lines) { let acc = ''; for (let i = 0; i < L.cells.length; i++) { acc += N(L.cells[i]); if (re.test(acc)) { const rest = L.cells.slice(i + 1).filter(x => x.trim()); if (rest.length) return rest; break; } } }
  return null;
}
function section(lines, startRe) {
  const i = lines.findIndex(l => startRe.test(N(l.text))); if (i < 0) return '';
  const out = []; for (let j = i + 1; j < lines.length; j++) { if (/^\[[^\]]+\]$/.test(N(lines[j].text))) break; out.push(lines[j].cells.join(' ')); }
  return out.join('\n').trim();
}
function parseFuncReport(pages) {
  const all = pages.flat(), txt = all.map(l => l.text).join('\n');
  const r = { kind: /심사\s*제외/.test(txt) ? '기능성화장품 심사제외품목 보고서' : '기능성화장품 심사 관련 서류' };
  r.productName = (labelVal(all, /^제품명$/) || [''])[0];
  r.ph = (labelVal(all, /^제품의pH$/) || [''])[0];
  r.standard = (labelVal(all, /^고시한기준및시험방법$/) || [''])[0];
  const ap = labelVal(all, /^상호$/) || []; r.applicant = ap[0] || ''; const ri = ap.indexOf('등록번호'); r.applicantRegNo = ri >= 0 ? ap[ri + 1] || '' : '';
  r.receiptNo = (txt.match(/접수번호[\s:|]*(\d{12})/) || [])[1] || '';
  r.seq = (txt.match(/(?<!\d)(20\d{8})(?!\d)/) || [])[1] || '';
  r.reportDate = normDate((txt.match(/보고완료일[\s:|]*([\d./-]{8,10})/) || [])[1]) || normDate((txt.match(/(20\d{2}년\s*\d{1,2}월\s*\d{1,2}일)/) || [])[1]);
  // 제조소
  r.makers = [];
  pages.forEach(pl => {
    if (pl.some(l => /보고사항|신청인/.test(N(l.text)))) return; // 1쪽 요약표('별첨')는 건너뜀
    const hi = pl.findIndex(l => /^제조소/.test(N(l.text)));
    if (hi < 0 || !pl.some(l => /제조회사명/.test(N(l.text)))) return;
    const names = [], addrs = [];
    pl.slice(hi + 1).forEach(l => { const t = N(l.text); if (/제조소|제조회사명|소재지|^제조국/.test(t)) return; if (/(로|길)\d/.test(t) && /(시|군|구|도)/.test(t)) addrs.push(l.cells.join(' ')); else if (l.cells.length) names.push(l.cells); });
    names.forEach((c, i) => r.makers.push({ name: c[0], country: c[1] || '', address: addrs[i] || '' }));
  });
  // 원료 및 분량
  r.actives = []; r.base = ''; r.form = '';
  pages.forEach(pl => {
    if (!pl.some(l => /원료약품/.test(N(l.text)))) return;
    const t = pl.map(l => l.text).join('\n'); const b = t.match(/본\s*품\s*([\d.]+)\s*(그램|밀리리터|g|mL)\s*중/); if (b) r.base = `본품 ${b[1]} ${b[2]} 중`;
    const f = t.match(/-\s*([가-힣]+제)\b/); if (f) r.form = f[1];
    pl.forEach(l => { if (l.cells.length >= 3 && /^[\d.]+$/.test(l.cells[1])) r.actives.push({ name: l.cells[0], amount: +l.cells[1], unit: l.cells[2] }); });
    r.baseAmount = b ? +b[1] : 100;
  });
  r.effect = section(all, /^\[효능효과\]$/);
  r.usage = section(all, /^\[용법용량\]$/);
  r.cautions = section(all, /^\[사용할때의주의사항\]$/);
  return r;
}

/* ---------- 성분사전 (대한화장품협회 표준화명칭목록, data/ingdict.js — 처음 쓸 때 불러옴) ----------
   영문명(INCI)·구명칭만 있어도 표준 성분명(국문)으로. 같은 영문명이 여러 표준명이면 우리 원료목록 보고에서 쓴 이름 우선 */
let DICT = null;
async function ingDict() {
  if (DICT) return DICT;
  if (!window.ING_DICT) { try { await loadScript('data/ingdict.js?v=1571fc0b'); } catch (e) { console.warn('성분사전 없음', e); } }
  const D = window.ING_DICT || { rows: [], old: [] }, byEn = new Map(), byKo = new Map(), byCode = new Map(), byCas = new Map();
  const used = new Set(((window.RAW_REPORTS || {}).ing || []).map(norm));
  const add = (m, k, r) => { const key = norm(k); if (!key) return; if (!m.has(key)) m.set(key, []); if (!m.get(key).includes(r)) m.get(key).push(r); };
  D.rows.forEach(r => { byCode.set(r[0], r); add(byKo, r[1], r); add(byEn, r[2], r); add(byKo, r[3], r); add(byEn, r[4], r); String(r[5] || '').split(/[\s,;/]+/).filter(c => /^\d{2,7}-\d{2}-\d$/.test(c)).forEach(c => add(byCas, c, r)); });
  (D.old || []).forEach(([code, oko, oen]) => { const r = byCode.get(code); if (r) { add(byKo, oko, r); add(byEn, oen, r); } });
  const pick = (list, exactIdx, key) => { if (!list || !list.length) return null; const ex = list.filter(r => norm(r[exactIdx]) === key); const L = ex.length ? ex : list; return L.find(r => used.has(norm(r[1]))) || L.slice().sort((a, b) => +a[0] - +b[0])[0]; };
  DICT = {
    version: D.version || '', size: D.rows.length,
    // 국문이 표준명/구명칭이면 표준명으로, 국문이 없거나 사전에 없으면 영문명으로 찾음
    std(ko, en, cas) {
      const k = norm(ko), e = norm(en), cs = String(cas || '').split(/[\s,;/]+/).filter(c => /^\d{2,7}-\d{2}-\d$/.test(c));
      const byC = () => { for (const c of cs) { const L = byCas.get(norm(c)); if (L && L.length) return L.find(r => used.has(norm(r[1]))) || L.slice().sort((a, b) => +a[0] - +b[0])[0]; } return null; };
      if (/^(fragrance|parfum|perfume)$/.test(e) && !k) return { ko: '향료', en, code: '', how: '영문명으로 찾음' };
      const rk = k ? pick(byKo.get(k), 1, k) : null;
      let re = e ? pick(byEn.get(e), 2, e) : null;
      if (e && cs.length && (byEn.get(e) || []).length > 1) { const cr = (byEn.get(e) || []).find(r => cs.some(c => String(r[5] || '').includes(c))); if (cr) re = cr; } // 같은 영문명 여럿이면 CAS 로
      // 국문·영문이 서로 다른 성분을 가리키면 영문명(INCI)을 믿음 (예: 황련추출물 + Coptis Japonica Root Extract → 황련뿌리추출물)
      if (rk && re && e && norm(rk[2] || '') !== e && norm(rk[4] || '') !== e && rk !== re) return { ko: re[1], en: re[2] || en, code: re[0], how: '영문명 기준 표준명' };
      if (rk) return { ko: rk[1], en: rk[2] || en || '', code: rk[0], how: norm(rk[1]) === k ? '' : '구명칭→표준명' };
      if (re) return { ko: re[1], en: re[2] || en, code: re[0], how: ko ? '영문명으로 표준명' : '영문명으로 찾음' };
      const rc = byC(); if (rc) return { ko: rc[1], en: rc[2] || en, code: rc[0], how: 'CAS No.로 찾음' };
      return { ko: String(ko || '').trim(), en: en || '', code: '', how: ko ? '' : '사전에 없음' };
    }
  };
  return DICT;
}

/* ---------- 2) 전성분표 (엑셀) ---------- */
async function parseIngredientXlsx(blob) {
  await loadScript(LIB.xlsx);
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  const out = { productName: '', date: '', address: '', single: null, rms: null };
  wb.SheetNames.forEach(sn => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true });
    const flat = rows.map(r => r.filter(v => v != null).join(' '));
    flat.forEach(t => { const m = t.match(/PRODUCT\s*NAME\s*:\s*(.+)/i) || t.match(/제품명\s*:\s*(.+)/); if (m && !out.productName) out.productName = m[1].trim(); const d = t.match(/Date\s*:\s*([\d.\-/]+)/i); if (d && !out.date) out.date = normDate(d[1]); });
    if (!out.address) out.address = flat.find(t => /\d+.*(-ro|-gil|로|길)/i.test(t)) || '';
    // 머리 줄: 「No.」와 성분명 칸이 같이 있는 줄 우선 (제목 줄 「전 성 분(문안) (한글명, 영문명)」을 머리로 잡지 않게)
    let h = rows.findIndex(r => r.some(v => /^no\.?$/i.test(String(v || '').trim())) && r.some(v => /한글명|성분명|원료명/.test(String(v || ''))));
    if (h < 0) h = rows.findIndex(r => r.some(v => /한글명|성분명|원료명/.test(String(v || ''))));
    if (h < 0) h = rows.findIndex(r => r.some(v => /ingredient\s*name|^inci\b|^ingredients?$/i.test(String(v || '').trim())) && r.some(v => /%|cas|function/i.test(String(v || ''))));  // 영문 처방표 (예: 코스맥스 FORMULAR INGREDIENTS STATEMENT)
    if (h < 0) return;
    const H = rows[h].map(v => String(v || '').replace(/\s+/g, ' ').trim());
    const ci = re => H.findIndex(x => re.test(x));
    const cNo = ci(/^no\.?$/i), cKo = ci(/한글명|성분명|원료명/), cEn = ci(/^(ingredients?|inci|icid|영문)/i), cFn = ci(/function|기능|배합목적/i), cCas = ci(/cas/i);
    const cRm = ci(/rm or|in fla|배합량|원료.*%/i), cIn = ci(/in rm/i), cAct = ci(/actual/i), cPct = ci(/%\s*\(w\/w\)|^%$|함량|content/i);
    const body = rows.slice(h + 1).filter(r => r.some(v => v != null) && !/^\*/.test(String(r[0] ?? '')) && !/^\s*(total|합\s*계)\s*$/i.test(String(r[0] ?? '')));
    const cKey = cKo >= 0 ? cKo : cEn; // 국문 칸이 없으면 영문명 칸으로
    if (cRm >= 0 && cAct >= 0) {
      const rms = []; let cur = null;
      body.forEach(r => { const ko = r[cKo]; if (ko == null) return; const isNew = r[cNo] != null && String(r[cNo]).trim() !== ''; const part = { ko: String(ko).trim(), en: cEn >= 0 ? String(r[cEn] ?? '') : '', inRm: cIn >= 0 ? r[cIn] : null, actual: r[cAct], func: cFn >= 0 ? String(r[cFn] ?? '') : '' };
        // 병합 셀 때문에 배합량이 빈 원료는 (실제 함량 ÷ 원료 중 함량)으로 되살림
        const own = r[cRm] != null && r[cRm] !== '' ? +r[cRm] : (part.actual != null && part.inRm ? +part.actual * 100 / +part.inRm : null);
        if (isNew || !cur) { cur = { no: r[cNo], pct: own, parts: [part] }; rms.push(cur); } else cur.parts.push(part); });
      out.rms = rms;
    } else if (cPct >= 0) {
      out.single = body.filter(r => r[cKey] != null && String(r[cKey]).trim()).map(r => ({ no: r[cNo], ko: cKo >= 0 ? String(r[cKo] ?? '').trim() : '', en: cEn >= 0 ? String(r[cEn] ?? '') : '', pct: r[cPct], cas: cCas >= 0 ? String(r[cCas] ?? '') : '', func: cFn >= 0 ? String(r[cFn] ?? '') : '' }));
    } else {
      // 전성분(문안): 함량 없이 순서대로 국문·영문명만 (예: 코스맥스 「전성분(문안)(알러젠)」) — 「한글명(new)」 칸이 있으면 그것
      const cNew = ci(/\(new\)|신규|표준/i), cK = cNew >= 0 ? cNew : cKo;
      const list = body.filter(r => (r[cK] != null && String(r[cK]).trim()) || (cEn >= 0 && r[cEn] != null && String(r[cEn]).trim()))
        .map(r => ({ no: r[cNo], ko: String(r[cK] ?? '').replace(/\*.*$/, '').replace(/\s+/g, '').trim(), en: cEn >= 0 ? String(r[cEn] ?? '').trim() : '' }))
        .filter(x => x.ko || x.en);
      if (list.length && (!out.names || (cNew >= 0 && !out.namesNew))) { out.names = list; out.namesNew = cNew >= 0; }
    }
  });
  if (!out.single && !out.rms && !out.names) throw new Error('엑셀에서 성분 표(한글명·영문명 열)를 찾지 못했습니다');
  // 성분사전으로 표준 성분명 맞추기 (구명칭 → 표준명, 영문명만 있으면 국문 찾기)
  const D = await ingDict();
  const fix = x => { const s = D.std(x.ko, x.en, x.cas); if (s.ko) { if (s.how) x.std = s.how; x.ko = s.ko; } else if (!x.ko) x.nostd = true; if (!x.en && s.en) x.en = s.en; return x; };
  (out.single || []).forEach(fix); (out.names || []).forEach(fix); (out.rms || []).forEach(rm => rm.parts.forEach(fix));
  out.dict = D.version;
  return out;
}

/* ---------- 3) 반제품(벌크) 성적서 — 표 칸 찾기 + 칸별 글자 인식 ---------- */
function detectGrid(cv) {
  const W = cv.width, H = cv.height, d = cv.getContext('2d').getImageData(0, 0, W, H).data, dk = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dk[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) < 160 ? 1 : 0;
  const merge = a => { const r = []; a.forEach(v => { const L = r[r.length - 1]; if (L && v - L.e <= 3) L.e = v; else r.push({ s: v, e: v }); }); return r; };
  const hl = []; for (let y = 0; y < H; y++) { let run = 0, mx = 0; const o = y * W; for (let x = 0; x < W; x++) { if (dk[o + x]) { if (++run > mx) mx = run; } else run = 0; } if (mx >= W * 0.3) hl.push(y); }
  const HL = merge(hl), rows = [];
  for (let k = 0; k < HL.length - 1; k++) {
    const y0 = HL[k].e + 1, y1 = HL[k + 1].s - 1; if (y1 - y0 < 14) continue;
    const vs = []; for (let x = 0; x < W; x++) { let c = 0; for (let y = y0; y <= y1; y++) c += dk[y * W + x]; if (c >= (y1 - y0 + 1) * 0.85) vs.push(x); }
    const V = merge(vs), cells = []; for (let j = 0; j < V.length - 1; j++) { const x0 = V[j].e + 1, x1 = V[j + 1].s - 1; if (x1 - x0 > 10) cells.push([x0, x1]); }
    if (cells.length) rows.push({ y0, y1, cells });
  }
  return { rows, dk, W };
}
function cropCell(cv, g, x0, x1, y0, y1) {
  const p = 4, ww = x1 - x0 - 2 * p, hh = y1 - y0 - 2 * p; if (ww < 4 || hh < 4) return null;
  let ink = 0; for (let y = y0 + p; y < y1 - p; y++) for (let x = x0 + p; x < x1 - p; x++) ink += g.dk[y * g.W + x];
  if (ink / (ww * hh) < 0.002) return null;
  const c = document.createElement('canvas'); c.width = ww + 40; c.height = hh + 40;
  const t = c.getContext('2d'); t.fillStyle = '#fff'; t.fillRect(0, 0, c.width, c.height); t.drawImage(cv, x0 + p, y0 + p, ww, hh, 20, 20, ww, hh); return c;
}
const TYPO = [[/이불질/g, '이물질'], [/표준풀/g, '표준품'], [/적햡|적핞/g, '적합'], [/점액싱/g, '점액상']];
const fixTypo = s => TYPO.reduce((a, [re, to]) => a.replace(re, to), String(s || ''));
const fixCrit = s => fixTypo(s).replace(/(\d)\s*\+\s*(\d)/g, '$1 ± $2').replace(/\s+/g, ' ').trim();
const phDot = s => String(s || '').replace(/(^|[^\d.])(\d)(\d{2})(?![\d.,])/g, (m, a, b, c) => `${a}${b}.${c}`); // pH 592 → 5.92
function fixItem(item, crit) {
  let s = String(item || '').replace(/\s+/g, ' ').trim();
  if (/^([가-힣]\s){1,5}[가-힣]$/.test(s)) s = s.replace(/\s/g, '');
  if (/^ph$/i.test(s)) return 'pH';
  if ((!/[가-힣]{2,}/.test(s) || s.length <= 1) && /^\s*\d{1,2}(\.\d+)?\s*(±|\+|~|-|–)\s*\d/.test(crit || '') && parseFloat(crit) < 14) return 'pH';
  return s;
}
const fixJudge = s => /부\s*적/.test(s) ? '부적합' : /적|합/.test(s) ? '적합' : String(s || '').trim();
function interpretGrid(T) {
  const hi = T.findIndex(r => r.some(c => /항목/.test(N(c))) && r.some(c => /결과/.test(N(c))));
  const LBL = [[/^(제품명|품명|품목명|제품명칭)$/, 'productName'], [/^(시험번호|성적서번호|관리번호)$/, 'testNo'], [/^(로트번호|lotno\.?|lot|로트)$/i, 'lotNo'], [/^(제조번호|batchno\.?)$/i, 'lot'], [/^(제조일자|제조일|제조년월일)$/, 'mfgDate'], [/^(제조량|제조단위|배치량|batchsize)$/i, 'batch'], [/^(시험의뢰일자|의뢰일자|의뢰일|시험의뢰일)$/, 'requestDate'], [/^(시험일자|시험일|검사일자|검사일)$/, 'testDate'], [/^(시험담당자|검사자)$/, 'testerName'], [/^(판정일|판정일자)$/, 'judgeDate'], [/^(판정결과|종합판정|최종판정|판정)$/, 'verdict']];
  const info = {};
  T.forEach((r, ri) => { if (ri === hi) return; r.forEach((c, j) => { const k = N(c); LBL.forEach(([re, key]) => { if (re.test(k) && info[key] == null && j + 1 < r.length) info[key] = r[j + 1]; }); }); });
  const rows = [];
  if (hi >= 0) {
    const H = T[hi].map(N), col = re => H.findIndex(h => re.test(h));
    const ci = { no: col(/^(no\.?|번호|순번)$/i), item: col(/항목/), crit: col(/기준|규격/), method: col(/방법/), date: col(/일자|일시/), result: col(/결과/), judge: col(/판정/), tester: col(/시험자|검사자|담당/), note: col(/비고/) };
    for (let r = hi + 1; r < T.length; r++) {
      const row = T[r]; if (row.length < Math.max(4, H.length - 1)) break;
      if (/담당자|판정일|특이사항/.test(N(row[0]))) break;
      const g = k => ci[k] >= 0 ? String(row[ci[k]] || '').trim() : '';
      if (!g('item') && !g('crit') && !g('result')) continue;
      let crit = fixCrit(g('crit')); const item = fixItem(g('item'), crit); let result = fixTypo(g('result')).replace(/\s+/g, ' ');
      if (item === 'pH') { crit = phDot(crit); result = phDot(result); }
      rows.push({ no: g('no'), item, crit, method: fixTypo(g('method') || g('note')).replace(/\s+/g, ' '), date: normDate(g('date')) || g('date'), result, judge: ci.judge >= 0 ? fixJudge(g('judge')) : (/부\s*적/.test(result) ? '부적합' : /적합/.test(result) ? '적합' : ''), tester: g('tester').replace(/^[|\[]+/, '') });
    }
  }
  const tn = String(info.testNo || ''); const tnm = tn.match(/[A-Z]{2,}[A-Z0-9-]*\d{3,}/);
  const bt = String(info.batch || '').replace(/(\d)\s+(?=\d)/g, '$1'), bn = bt.match(/([\d,.]+)\s*(kg|g|l|ml|ea|개|톤)?/i);
  const v = String(info.verdict || '');
  let bNum = bn ? bn[1].replace(/,/g, '') : '', bUnit = bn && bn[2] ? (/^l$/i.test(bn[2]) ? 'L' : bn[2].toLowerCase()) : 'kg';
  if (bUnit === 'g' && +bNum >= 1000) { bNum = String(+bNum / 1000); bUnit = 'kg'; } // 224000 G → 224 kg
  const verdict = /부적/.test(v) ? '부적합' : /적합|적|합/.test(v) ? '적합' : '';
  const td = normDate(info.testDate);
  rows.forEach(r => { if (!r.judge && verdict === '적합' && String(r.result).trim()) r.judge = '적합'; if (!r.date && td) r.date = td; });
  return {
    productName: String(info.productName || '').replace(/\s+/g, ' ').trim(), testNo: tnm ? tnm[0] : tn.trim().split(/\s+/).pop() || '',
    lot: String(info.lotNo || info.lot || '').replace(/\s+/g, ''), mfgNo: String(info.lot || '').replace(/\s+/g, ''), mfgDate: normDate(info.mfgDate), batch: bNum ? `${Number(bNum).toLocaleString('ko-KR')} ${bUnit}` : bt.trim(), batchNum: bNum, batchUnit: bUnit,
    requestDate: normDate(info.requestDate), testDate: String(info.testDate || '').trim(), judgeDate: normDate(info.judgeDate), verdict,
    rows, grid: T
  };
}
async function parseBulkCoa(doc, onProg) {
  const pg = await doc.getPage(1), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 2000 / v0.width });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const tc = await pg.getTextContent();
  const items = tc.items.filter(t => t.str.trim()).map(t => { const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]); return { s: t.str, x, y, w: (t.width || 0) * vp.scale }; });
  // 칸 안 글자 잇기: 붙어 있는 조각은 띄우지 않고, 줄바꿈으로 끊긴 한글 낱말은 이어 붙임 (예: 나이아|신아마이드)
  const joinCell = arr => {
    const lines = []; arr.sort((a, b) => a.y - b.y || a.x - b.x).forEach(it => { const L = lines.find(l => Math.abs(l.y - it.y) < 6); if (L) L.i.push(it); else lines.push({ y: it.y, i: [it] }); });
    const txt = lines.sort((a, b) => a.y - b.y).map(l => { l.i.sort((a, b) => a.x - b.x); let s = ''; l.i.forEach((it, k) => { if (k) { const p = l.i[k - 1]; s += it.x - (p.x + p.w) > 4 ? ' ' : ''; } s += it.s; }); return s.trim(); });
    let out = ''; txt.forEach((t, k) => { out += k && /[가-힣]$/.test(out) && /^[가-힣]/.test(t) ? t : (k ? ' ' : '') + t; });
    return out.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+,/g, ',');
  };
  const hasText = items.length > 25;
  if (!hasText && window.QDOC_ENV === 'artifact') {
    // 공유 페이지는 글자 인식기(OCR)를 못 띄움 → 빈 표를 주고 직접 입력
    const out = interpretGrid([]); out.ocr = false; out.manual = true;
    out.rows = ['성상', '향취', 'pH', '점도', '비중', '미생물한도', '이물'].map(item => ({ no: '', item, crit: '', method: '', date: '', result: '', judge: '', tester: '' }));
    return out;
  }
  const g = detectGrid(cv);
  if (g.rows.length < 4) throw new Error('표를 찾지 못했습니다. 아래 표에 직접 입력해 주세요.');
  const w = hasText ? null : await tessWorker();
  const total = g.rows.reduce((a, r) => a + r.cells.length, 0); let done = 0; const T = [];
  for (const r of g.rows) {
    const cells = [];
    for (const [x0, x1] of r.cells) {
      let t = '';
      if (hasText) t = joinCell(items.filter(it => it.x >= x0 - 3 && it.x <= x1 + 3 && it.y >= r.y0 - 3 && it.y <= r.y1 + 8));
      else { const c = cropCell(cv, g, x0, x1, r.y0, r.y1); if (c) t = (await w.recognize(c)).data.text; }
      cells.push(t.replace(/\s+/g, ' ').trim()); done++;
      if (done % 6 === 0) onProg && onProg(`${hasText ? '읽는 중' : '글자 인식'} ${Math.round(done / total * 100)}%`);
    }
    T.push(cells);
  }
  const out = interpretGrid(T); out.ocr = !hasText; return out;
}

/* ---------- 3) 미생물시험성적서 (외부 시험기관: KATRI·KTR·KCL 등) ---------- */
function parseMicroReport(pages) {
  const lines = pages.flat(), txt = lines.map(l => l.text).join('\n'), flat = txt.replace(/\s*\|\s*/g, ' ');
  const m = re => (flat.match(re) || [])[1] || '';
  const r = {
    lab: m(/([가-힣A-Z]*(?:시험연구원|연구원|시험원|검사소|분석센터))장?/) || m(/\b(KATRI|KTR|KCL|KOTITI|FITI)\b/),
    reportNo: m(/(?:KATRI\s*NO|KTR\s*NO|성적서\s*번호|접수\s*번호|문서\s*번호)\s*[:：]?\s*([A-Z]{2,}[A-Z0-9-]*\d{3,})/i),
    issueDate: normDate(m(/발급\s*일자\s*[:：]?\s*(20\d\d[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2})/)),
    receiptDate: normDate(m(/접수\s*일자\s*[:：]?\s*(20\d\d[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2})/)),
    productName: m(/시료\s*1\s*[:：]\s*([^\[\n]+?)(?:\s*\[|\n|$)/).trim(),
    lot: m(/제조번호[^:：\n]*[:：]\s*([A-Za-z0-9-]+)/), exp: normDate(m(/제조번호\s*\/\s*(?:유통|사용)기한\s*[:：]\s*[A-Za-z0-9-]+\s*\/\s*(20\d\d[.\-/]\d{1,2}[.\-/]\d{1,2})/)),
    testerName: m(/시\s*험\s*자\s*[:：]\s*([가-힣]\s?[가-힣]\s?[가-힣]?)/).replace(/\s/g, ''),
    rows: []
  };
  const seen = new Set();
  lines.forEach(l => {
    const cells = l.cells.map(c => String(c).trim()).filter(Boolean), t = cells.join(' ');
    if (/미생물한도|희석배수/.test(t)) return;
    const nm = (t.match(/(총\s*호기성\s*생균수(?:\s*\((?:세균|진균)\))?|대장균|녹농균|황색\s*포도상구균)/) || [])[1]; if (!nm) return;
    const item = nm.replace(/\s+/g, ' ').replace('총 호기성 생균수', '총호기성생균수').replace(/\s*\(/, '(');
    if (seen.has(item)) return; seen.add(item);
    const rest = cells.filter(c => !c.includes(nm.split(/\s/)[0]) || c.length > nm.length + 2).join(' ').replace(nm, '').trim();
    const crit = (rest.match(/(총\s*[\d,]+\s*이하|[\d,]+\s*(?:개|cfu)?[^\s]*\s*이하|불검출)/i) || [])[1] || (/균$/.test(item) ? '불검출' : '');
    const result = (rest.replace(crit, '').match(/(불검출|검출|음성|양성|[<≤]?\s*[\d,]+)/) || [])[1] || '';
    r.rows.push({ item, result: result.trim(), crit: crit.trim() });
  });
  if (!r.rows.length) throw new Error('미생물 시험 항목(총호기성생균수·특정세균)을 찾지 못했습니다');
  return r;
}
const microOk = x => !/^(검출|양성)$/.test(x.result) && !(/^[\d,]+$/.test(x.result) && /([\d,]+)\s*이하/.test(x.crit) && +x.result.replace(/,/g, '') > +(x.crit.match(/([\d,]+)/)[1].replace(/,/g, '')));

/* ---------- 파일 처리 ---------- */
function ing() { if (!S.ingest) S.ingest = { info: { nameKo: '', nameEn: '', code: '', type: '기초화장용 제품류', shelfMonths: '', packUnit: '', weights: {}, makerName: '' }, files: [] }; return S.ingest; }
const SPECIFIC = /대장균|녹농균|황색포도상|특정세균|병원성/; // 특정세균 항목 (외부 미생물성적서의 '세균'·'진균' 수는 총호기성생균수 쪽)
const MFGK = '제조지시 및 공정 기록서'; // 선택 자료: 있으면 제품표준서 별첨2로
const PSK = '제조사 제품표준서'; // 선택 자료: 제품명·품번·성상·보관·용법·전성분·기능성 보고 내용을 읽음 — 원본은 제품표준서에 넣지 않음 (사용자 요청)
const CODE_RE = /(?<![A-Za-z0-9])(?:SB|MC|MT)\d{4}(?!\d)/g; // ERP 품번 (성분에디터 SB · 마미케어 MC · 밀크터치 MT)
function kindByName(n) { return /제품표준서/.test(n) ? PSK : /제조지시|공정\s*기록|제조\s*기록|BMR/i.test(n) ? MFGK : /미생물/.test(n) ? '미생물시험성적서' : /기능성|보고서|심사/.test(n) ? '기능성보고서' : /\.xlsx?$/i.test(n) || /전성분/.test(n) ? '전성분표' : /성적서|coa|시험/i.test(n) ? '반제품성적서' : ''; }
async function processRec(rec, blob, forceKind) {
  rec.status = '읽는 중'; rec.err = ''; draw();
  if (/\.xlsx?$/i.test(rec.name)) {
    rec.kind = '전성분표'; rec.data = await parseIngredientXlsx(blob); rec.codes = rec.name.match(CODE_RE) || [];
    await IDB.put({ id: rec.id, name: rec.name, blob, pages: [] });
    rec.comp = rec.comp || compOf(rec.data.productName) || compOf(rec.name) || '단품';
    rec.status = '완료'; return;
  }
  const lib = await pdfjs(); const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages = []; for (let i = 1; i <= Math.min(doc.numPages, 20); i++) pages.push(await visualLines(await doc.getPage(i)));
  const txt = pages.flat().map(l => l.text).join('\n');
  rec.status = '쪽 그림 저장'; draw();
  const imgs = await pageImages(doc);
  await IDB.put({ id: rec.id, name: rec.name, blob, pages: imgs });
  // 공유 페이지: 별첨으로 찍힐 쪽 그림을 공동 저장소에 올려 다른 사람도 보게
  if (window.Cloud && Cloud.art && Cloud.shared()) { rec.status = '쪽 그림 공유'; draw(); const ids = await Cloud.uploadImages(imgs); if (ids) rec.pageAssets = ids; }
  const tight = txt.replace(/\s+/g, '');
  rec.codes = [...new Set([...(rec.name.match(CODE_RE) || []), ...(tight.match(CODE_RE) || [])])]; // 파일 이름·본문에 적힌 ERP 품번
  const isMicro = /시험연구원|연구원장|KATRI|KTR|KCL/.test(tight) && /호기성생균수|미생물한도/.test(tight) && !/벌크/.test(tight);
  const isMakerPS = /제품표준서/.test(tight) && /제품코드|벌크코드|품목코드/.test(tight) && !/시험성적서/.test(tight);
  let kind = forceKind || (kindByName(rec.name) === PSK || isMakerPS ? PSK : kindByName(rec.name) === MFGK || /제조지시/.test(tight) && /기록서/.test(tight) && !/시험성적서/.test(tight) ? MFGK : /기능성화장품/.test(txt) && /보고|심사/.test(txt) ? '기능성보고서' : isMicro || kindByName(rec.name) === '미생물시험성적서' ? '미생물시험성적서' : (kindByName(rec.name) === '기능성보고서' && txt.length < 50 ? '기능성보고서' : '반제품성적서'));
  rec.kind = kind;
  if (kind === MFGK) { rec.data = { pages: imgs.length }; rec.comp = rec.comp || compOf(rec.name) || '단품'; rec.status = '완료'; return; }
  if (kind === PSK) {
    rec.data = parseMakerPS(txt, tight, imgs.length);
    try { rec.data.specs = await parseSpecPages(doc); } catch (e) { console.warn('시험기준서 표', e); } // 벌크·완제품 시험기준서 (항목·시험근거·관리규격)
    // 제조사 제품표준서에 기능성 보고서가 들어 있으면 그것도 읽음 (효능·효과·용법·주의사항·주성분·보고번호)
    if (/기능성화장품/.test(tight) && /보고서|심사/.test(tight)) { try { // 보고서 쪽만 (첫 「보고서」 쪽 ~ 「사용할 때의 주의사항」 쪽) — 뒤의 전성분·시험기준서가 섞이지 않게
      const si = pages.findIndex(pl => pl.some(l => /기능성화장품/.test(l.text)) && pl.some(l => /보고서|보고사항|심사/.test(l.text.replace(/\s+/g, ''))));
      const ei = si < 0 ? -1 : pages.findIndex((pl, i) => i >= si && pl.some(l => /\[사용할\s*때의\s*주의사항\]/.test(l.text)));
      const rp = si < 0 ? [] : pages.slice(si, (ei >= 0 ? ei : Math.min(si + 4, pages.length - 1)) + 1);
      const fr = parseFuncReport(rp); if ((fr.actives || []).length || fr.effect) rec.data.report = fr; } catch (e) { console.warn(e); } }
    rec.comp = rec.comp || compOf(rec.name) || '단품'; rec.status = '완료'; return;
  }
  if (kind === '미생물시험성적서') rec.data = parseMicroReport(pages);
  else if (kind === '기능성보고서') { rec.data = parseFuncReport(pages); if (!rec.data.productName && !rec.data.actives.length) throw new Error('보고서 글자를 읽지 못했습니다 (스캔본이면 의약품안전나라에서 받은 원본 PDF를 올려 주세요)'); }
  else {
    rec.data = await parseBulkCoa(doc, p => { rec.status = p; draw(true); });
    // 반제품성적서에 찍힌 제조사 이름(예: 코스맥스(주))으로 제조업체 추정
    const hint = MK.find(m => { const k = mkey(m.label || m.name); return k.length >= 2 && tight.includes(k); });
    if (hint) rec.data.makerHint = hint.name;
    if (rec.data.manual) notify(`${rec.name}\n스캔본이라 이 화면에서는 글자를 읽을 수 없습니다. 「표 확인·수정」에서 제품명·제조번호·제조량과 시험 결과를 직접 입력해 주세요. PC의 발행센터에서 올리면 자동으로 읽습니다.`, 'warn', 14000);
  }
  rec.comp = rec.comp || compOf(rec.data.productName) || compOf(rec.name) || '단품';
  rec.status = '완료';
}
async function addFiles(list) {
  const I = ing();
  for (const f of list) {
    if (!/\.(pdf|xlsx|xls)$/i.test(f.name)) { notify(`${f.name}: PDF 또는 엑셀만 올릴 수 있습니다.`); continue; }
    const rec = { id: uid('f'), name: f.name, kind: kindByName(f.name), comp: compOf(f.name), status: '대기', err: '', data: null, size: f.size };
    I.files.push(rec); draw();
    try { await processRec(rec, f); } catch (e) { console.error(e); rec.status = '오류'; rec.err = e.message; }
    save(); draw();
  }
  autoInfo(); save(); draw();
}
window.ingestFromUrls = async urls => { const fs = []; for (const u of urls) { const b = await (await fetch(u)).blob(); fs.push(new File([b], decodeURIComponent(u.split('/').pop()), { type: b.type })); } await addFiles(fs); return S.ingest.files.map(f => [f.name, f.kind, f.comp, f.status, f.err]); };

/* ---------- 모으기 · 교차 점검 ---------- */
function model() {
  const I = ing(), comps = {};
  I.files.filter(f => f.status === '완료' && f.data && f.kind !== MFGK && f.kind !== PSK).forEach(f => {
    const k = f.comp || '단품'; const c = comps[k] = comps[k] || { key: k, report: null, single: null, comp: null, bulk: null, micro: null, files: [] };
    c.files.push(f);
    if (f.kind === '기능성보고서') c.report = f.data;
    else if (f.kind === '전성분표') { if (f.data.single) c.single = f.data; if (f.data.rms) c.comp = f.data; if (f.data.names) c.names = f.data; }
    else if (f.kind === '반제품성적서') c.bulk = f.data;
    else if (f.kind === '미생물시험성적서') c.micro = f.data;
  });
  // 영문 처방(함량)의 국문명: 함께 올린 국문·영문 대조표(전성분 문안 등 국문+영문이 같이 있는 표)에서 먼저 — 없으면 성분사전 값 그대로
  const pairs = new Map();
  I.files.filter(f => f.kind === '전성분표' && f.status === '완료' && f.data).forEach(f => [...(f.data.names || []), ...(f.data.single || [])].forEach(x => { if (x.ko && x.en && !/영문명|CAS/.test(x.std || '') && !x.pairKo) { const k = norm(x.en); if (!pairs.has(k)) pairs.set(k, x.ko); } }));
  if (pairs.size) I.files.filter(f => f.kind === '전성분표' && f.status === '완료' && f.data?.single).forEach(f => f.data.single.forEach(x => {
    const ko = pairs.get(norm(x.en)); if (!ko) return;
    if (x.pairKo === undefined) x.dictKo = x.ko;
    x.pairKo = ko; x.ko = ko; x.std = '국문·영문 대조표';
  }));
  const psr = I.files.find(f => f.kind === PSK && f.status === '완료' && f.data?.report)?.data.report;
  if (psr) {
    if (!Object.keys(comps).length) comps['단품'] = { key: '단품', report: null, single: null, comp: null, bulk: null, micro: null, files: [] };
    const cs = Object.values(comps); if (cs.length === 1 && !cs[0].report) cs[0].report = psr;
  }
  return Object.values(comps).sort((a, b) => a.key.localeCompare(b.key, 'ko'));
}
const mfgFiles = () => ing().files.filter(f => f.kind === MFGK && f.status === '완료');
/* 별첨2 넣기: 올린 원본이 있으면 기본으로 켬, 끄거나 문서명·번호만 적어 켤 수도 있음 — 자료가 하나도 없으면 빠짐 */
const mfgOption = () => { const I = ing(); const on = I.info.mfgOn ?? mfgFiles().length > 0; return !!on && (mfgFiles().length > 0 || !!String(I.info.mfgDoc || '').trim()); };
function maker() { const I = ing(); return MK.find(m => m.name === I.info.makerName) || null; }
/* 2. 제품 정보 자동 기입 — 빈 칸만 채움 (사용자가 쓴 값은 그대로)
   제품명: 올린 자료에서 읽은 이름과 가장 닮은 기능성 자료(의약품안전나라 보고 품목) 이름 → 없으면 읽은 이름 그대로
   품번(제품코드): 문서·파일 이름의 ERP 품번 (칸 없이 표준서·성적서 제품코드에 들어감)
   사용기한·개봉 후·표시용량·제조업체: 제조사 제품표준서 → 반제품성적서 → 기능성 보고서 → ERP 품목 순 */
function nameFromFile(n) {
  const parts = String(n || '').replace(/(\.pdf|\.xlsx?)+$/i, '').replace(/TalkFile_?/i, '').replace(/\((성적서|사본|최종)\)/g, '').split(/[_]/);
  return parts.map(x => x.trim()).filter(x => /[가-힣]{3,}/.test(x)).sort((a, b) => b.replace(/[^가-힣]/g, '').length - a.replace(/[^가-힣]/g, '').length)[0] || '';
}
const capOf = s => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*(ml|g|매)(?![a-z])/i); return m ? m[1] + m[2].toLowerCase() : ''; }; // 표시용량 (예: 2ml)
const cleanName = s => String(s || '').replace(/\([^)]*\)/g, ' ').replace(/\d+(\.\d+)?\s*(ml|g|매|ea|개입?)\b.*$/i, '').replace(/\s*\d\s*제\s*$/, '').replace(/rev\.?\s*\d+/i, '').trim();
function dice(a, b) {
  const bg = s => { const k = norm(s), o = new Map(); for (let i = 0; i < k.length - 1; i++) { const g = k.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1); } return o; };
  const A = bg(a), B = bg(b); let n = 0, ta = 0, tb = 0; A.forEach(v => ta += v); B.forEach(v => tb += v); A.forEach((v, g) => n += Math.min(v, B.get(g) || 0));
  return ta + tb ? 2 * n / (ta + tb) : 0;
}
function bestFunc(cands) {
  const list = productNames().filter(o => (o.seqs || []).length || o.raw); let best = null; // 기능성 보고 + 원료목록 보고(비기능성)
  cands.forEach((c, ci) => { const q = cleanName(c); if (norm(q).length < 4) return; list.forEach(o => { const sc = dice(q, o.name) - ci * 0.002; if (!best || sc > best.sc) best = { sc, o }; }); });
  return best && best.sc >= 0.72 ? best.o : null;
}
function parseMakerPS(txt, tight, pages) {
  const t = txt.replace(/\s*\|\s*/g, ' ');
  const brands = (typeof BRAND_CODE !== 'undefined' ? BRAND_CODE.map(x => x[0]) : ['성분에디터', '마미케어', '밀크터치']).join('|');
  const names = [...new Set((t.match(new RegExp(`(?:${brands})[가-힣A-Za-z0-9]{3,40}`, 'g')) || []).map(cleanName).filter(n => norm(n).length >= 6))]; // 칸 사이 공백에서 끊김
  const mk = MK.find(m => { const k = mkey(m.label || m.name); return k.length >= 2 && tight.includes(k); });
  // 전성분 및 함량 표 (「No. | 성분명 | 성분 함량(%)」, 함량은 품질·안전관리 영향 성분만 — 나머지는 비공개)
  const ingredients = []; let on = false;
  txt.split('\n').forEach(l => {
    if (/전성분/.test(l) && /함량/.test(l)) { on = true; return; }
    if (!on) return;
    if (/^\s*\*/.test(l) && ingredients.length) { on = false; return; }
    const m = l.match(/^\s*(\d{1,3})\s*\|\s*([^|]+?)\s*(?:\|\s*(\d+(?:\.\d+)?)\s*)?(?:\|.*)?$/);
    if (m && /[가-힣A-Za-z]/.test(m[2]) && !ingredients.some(x => x.no === +m[1])) ingredients.push({ no: +m[1], name: m[2].trim(), pct: m[3] ? String(+(+m[3]).toFixed(6)) : '' });
  });
  ingredients.sort((a, b) => a.no - b.no);
  const g = re => ((txt.match(re) || [])[1] || '').trim();
  return {
    names, productName: names[0] || '', makerHint: mk ? mk.name : '', pages, ingredients,
    appearance: g(/성\s*\|?\s*상\s*\|\s*(?:[0-9A-Z]{6,}\s*[:：]\s*)?([^|\n]+)/),
    reportNo: g(/허가번호\s*및[\s|]*(\d{8,})/), reportDate: normDate(g(/허가일\s*및[\s|]*(20\d\d[./-]\d{1,2}[./-]\d{1,2})/)),
    storage: g(/보관\s*조건\s*\|\s*([^|\n]+)/), usage: g(/용법\s*[,·]?\s*용량\s*\|\s*([^|\n]+)/),
    bulkCode: g(/벌크\s*코드\s*[:：]\s*([0-9A-Z]{6,})/),
    shelfMonths: (t.match(/사용\s*기한\s*[:：]?\s*(\d{1,3})\s*개월/) || [])[1] || '',
    packUnit: ((t.match(/포장\s*단위\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:ml|mL|ML|g|G))/) || [])[1] || '').replace(/\s+/g, '').replace(/ML$/i, 'ml'),
    psCode: (t.match(/제품\s*코드\s*[:：]?\s*([0-9A-Z]{6,})/) || [])[1] || ''
  };
}
/* 제조업체 이름 맞추기 (엄격): 같은 이름이거나, 한쪽이 다른 쪽을 품고 길이가 비슷할 때만 — 「인코코스메틱」을 「코코」로 잘못 잡지 않게 */
function findMakerStrict(name) {
  const k = mkey(name); if (!k) return null;
  const keys = m => [m.name, m.label, m.company].map(mkey).filter(Boolean);
  return MK.find(m => keys(m).some(x => x === k)) || MK.find(m => keys(m).some(x => (x.includes(k) || k.includes(x)) && Math.min(x.length, k.length) / Math.max(x.length, k.length) >= 0.7)) || null;
}
function applyRaw(info) {
  const ri = rawFor(info.nameKo); if (!ri) return;
  if (!info.makerName && ri.maker) { const mk = findMakerStrict(ri.maker); if (mk) info.makerName = mk.name; }
  const t = typeOf(ri.type);
  if (t && (!info.type || info.type === '기초화장용 제품류' || info.typeAuto)) { info.type = t.cls; info.typeSub = t.sub; info.typeAuto = true; }
}
function autoInfo() {
  const I = ing(), M = model(), info = I.info, done = I.files.filter(f => f.status === '완료' && f.data);
  const r = M.find(c => c.report)?.report, b = M.find(c => c.bulk)?.bulk, mic = M.find(c => c.micro)?.micro, ps = done.find(f => f.kind === PSK)?.data;
  const cands = [r?.productName, ...(ps?.names || []), b?.productName, mic?.productName, ...done.map(f => nameFromFile(f.name))].filter(Boolean);
  if (!info.nameKo) {
    const hit = bestFunc(cands);
    if (hit) { info.nameKo = hit.name; info.pickedSeqs = hit.seqs || []; }
    else { const n = cleanName(cands[0]); if (n) info.nameKo = n; }
  }
  applyRaw(info); // 원료목록 보고: 제조업체·유형
  if (!info.code) { const c = [...done.filter(f => f.kind === PSK), ...done].flatMap(f => f.codes || []).find(c => ITEMS.some(it => it.c === c)); if (c) info.code = c; }
  const it = info.code ? ITEMS.find(x => x.c === info.code) : null;
  if (!info.shelfMonths) info.shelfMonths = ps?.shelfMonths || (+(it?.life) ? it.life : '');
  if (!info.packUnit && ps?.packUnit) info.packUnit = ps.packUnit;
  if (!info.openMonths && +(it?.open)) info.openMonths = it.open;
  if (M.length === 1) { info.weights = info.weights || {}; const k = M[0].key; if (!info.weights[k]) info.weights[k] = ps?.packUnit || capOf(it?.s) || capOf(it?.n) || ''; }
  if (!info.makerName) { const mk = (b?.makerHint && MK.find(m => m.name === b.makerHint)) || (ps?.makerHint && MK.find(m => m.name === ps.makerHint)) || findMaker(r?.makers?.[0]?.name || '') || (it?.v ? findMaker(it.v) : null); if (mk) info.makerName = mk.name; }
}
function checks(M) {
  const out = [], add = (k, lvl, ok, t, m = '') => out.push({ k, lvl, ok, t, m });
  const mk = maker();
  M.forEach(c => {
    const K = `[${c.key}]`, r = c.report, s = c.single?.single, rms = c.comp?.rms, b = c.bulk;
    if (s) { const sum = s.reduce((a, x) => a + (+x.pct || 0), 0); add(K, '확인', Math.abs(sum - 100) < 0.01, `전성분표 함량 합계 ${+sum.toFixed(4)}%`, Math.abs(sum - 100) < 0.01 ? '' : '100%가 아님'); }
    if (rms) { const sum = rms.reduce((a, x) => a + (+x.pct || 0), 0); add(K, '확인', Math.abs(sum - 100) < 0.01, `원료(복합) 배합량 합계 ${+sum.toFixed(4)}%`); }
    if (r && s) r.actives.forEach(a => { const base = r.baseAmount || 100, pct = a.amount / base * 100; const hit = s.find(x => N(x.ko) === N(a.name)); add(K, '필수', hit && Math.abs(+hit.pct - pct) < 1e-6, `기능성 원료 ${a.name}: 보고서 ${+pct.toFixed(4)}% ↔ 전성분표 ${hit ? +(+hit.pct).toFixed(4) + '%' : '없음'}`, hit && Math.abs(+hit.pct - pct) < 1e-6 ? '' : '함량 불일치 — 보고 내용과 처방이 다름'); });
    if (r && b) { const ph = b.rows.find(x => x.item === 'pH'); const ctr = ph ? parseFloat(ph.crit) : NaN; if (r.ph) add(K, '확인', ph && Math.abs(ctr - parseFloat(r.ph)) < 0.006, `pH: 보고서 ${r.ph} ↔ 반제품 기준 ${ph ? ph.crit : '없음'}`); }
    if (r && b) { const miss = r.actives.filter(a => !b.rows.some(x => N(x.item + x.crit + x.method).includes(N(a.name)))); add(K, '필수', !miss.length, '반제품성적서에 기능성 주성분 시험', miss.length ? `${miss.map(a => a.name).join('·')} 확인·함량시험 결과 없음 → 완제품성적서 함량 결과를 채울 근거 없음. 제조사에 주성분 함량 성적서 요청 또는 자사(위탁) 시험 필요` : ''); }
    if (b) { const mi = b.rows.find(x => /미생물/.test(x.item)); add(K, '권장', mi && /진균|총호기|대장균|녹농|황색/.test(mi.crit), '미생물 시험 범위', mi ? (/진균|총호기|대장균|녹농|황색/.test(mi.crit) ? '' : `'${mi.crit}'만 있음 — 유통화장품 안전관리 기준은 총호기성생균수(세균+진균) + 대장균·녹농균·황색포도상구균 불검출`) : '미생물 시험 없음'); }
    if (b) add(K, '확인', b.verdict === '적합' || (b.rows.length && b.rows.every(x => x.judge === '적합')), `반제품 판정 ${b.verdict || (b.rows.every(x => x.judge === '적합') ? '전 항목 적합' : '확인 필요')} · ${b.rows.length}항목 · 제조번호 ${b.lot || '?'}`);
    if (r && b) add(K, '확인', N(r.productName) === N(b.productName), `제품명: 보고서 「${r.productName}」 ↔ 반제품 「${b.productName}」`);
    if (r && b && r.reportDate && b.mfgDate) add(K, '확인', b.mfgDate >= r.reportDate, `보고완료(${r.reportDate}) 이후 제조(${b.mfgDate})`);
    if (r) { const it = FDmap.get(r.seq); add(K, '확인', !!it, `의약품안전나라 공개 목록 대조 (보고일련번호 ${r.seq || '?'})`, it ? `「${it.name}」 보고완료 ${it.date}` : '공개 목록에서 찾지 못함 — 기능성자료_갱신 후 다시 확인'); }
    if (r && mk) { const ra = roadKey(r.makers?.[0]?.address); const ok = ra && (mk.sites || []).some(s => roadKey(s) === ra); add(K, '필수', ok, `제조소: 보고서 「${r.makers?.[0]?.name || ''} ${r.makers?.[0]?.address || ''}」 ↔ 제조업 등록필증`, ok ? `${mk.regNo} 등록 소재지와 일치` : `필증 소재지 (${(mk.sites || []).join(' / ')})에 없음`); }
    if (!r) add(K, '권장', false, '기능성 보고서 없음', '기능성화장품이 아니면 무시');
    if (!s && !rms) add(K, '필수', false, '전성분표(함량) 없음', '별첨1 원료·분량을 채울 수 없음');
    if (!b) add(K, '필수', false, '반제품성적서 없음', '벌크 기준·시험결과·제조번호를 채울 수 없음');
  });
  if (mk) { const sc = (mk.scope || []).join(' '); add('제조사', '확인', !sc || /직접|위탁/.test(sc), `${makerShort(mk)} 제조업 등록필증 ${mk.regNo || ''}`, sc ? `영업 범위: ${(mk.scope || []).map(s => s.replace(/화장품(을|의)?\s*/, '').replace(/하는 영업|을 하는 영업/, '')).join(', ')}` : ''); }
  else add('제조사', '필수', false, '제조업체 미지정', '아래 제품 정보에서 제조업체를 고르세요');
  return out;
}
const FEAS = M => {
  const has = k => M.some(c => c[k]); const r = has('report'), s = M.some(c => c.single || c.comp), b = has('bulk'), mk = !!maker();
  const A = (cond, ok, no) => cond ? ok : no;
  return [
    ['제품표준서', '제품명·작성연월일', A(r || b, '자동', '입력'), '보고서 제품명 / 입력값'],
    ['제품표준서', '원료명·분량·제조단위당 기준량', A(s && b, '자동', '입력'), '전성분표(복합) 원료별 배합량 × 반제품성적서 제조량 (원료코드·상품명은 제조사 자료 필요)'],
    ['제품표준서', '효능·효과·사용할 때의 주의사항', A(r, '자동', '입력'), '기능성 보고서'],
    ['제품표준서', '원료 함량 일부 미공개 확인 (별첨1)', '입력', '제조업자가 처방 전체를 주지 않을 때만 — 영향 성분 수·책임자 (코스맥스 보증서 방식)'],
    ['제품표준서', '벌크·완제품 기준 및 시험방법 (규격 유형·적용 주기·결과 적용)', A(b, '자동', '입력'), '벌크=반제품성적서(자가 규격·매 배치), 기능성 주성분=보고서(허가 규격), 완제품=충전품/완제품 구분 + 결과 적용 자동'],
    ['제품표준서', '보관조건', '템플릿', '보고서 주의사항 + 표준 문구'],
    ['제품표준서', '제조지시 및 공정 기록서 (별첨2)', '제조사 요청', '제조업자 문서 이름·번호를 별첨2에 적음 — 공정흐름도·작업내용·작업 중 주의사항을 갈음'],
    ['제품표준서', '사용기한·개봉 후 사용기간', '입력', '개월 수 입력 (안정성 근거 별첨 권장)'],
    ['제품표준서', '변경이력', '자동', '신규 제정 1줄'],
    ['제품표준서', '제조업자 (상호·소재지·등록번호)', A(mk, '자동', '입력'), '제조업 등록필증 + 보고서 제조소'],
    ['제품표준서', '전성분', A(M.some(c => c.single), '자동', '입력'), '전성분표(단일)'],
    ['완제품성적서', '제조번호·제조일', A(b, '자동', '입력'), '반제품성적서 (충전 LOT가 다르면 수정)'],
    ['완제품성적서', '관능·이화학 결과', A(b, '자동', '입력'), '반제품성적서 결과 인용 (시험자=제조사)'],
    ['완제품성적서', '미생물 (미생물한도·특정세균)', A(has('micro'), '자동', '입력'), '외부 미생물시험성적서(KATRI 등) 결과만 — 제조사 자체 미생물 시험은 넣지 않음'],
    ['완제품성적서', '기능성 주성분 함량 결과', A(b && M.every(c => !c.report || c.report.actives.every(a => c.bulk?.rows.some(x => N(x.item + x.crit).includes(N(a.name))))), '자동', '제조사 요청'), '반제품성적서에 있어야 함'],
    ['완제품성적서', '표시기재사항·외관·포장사양·내용량·이물', '입력', '입고검사(자사) 결과 — 시험자 칸은 「자사 (입고검사)」로 미리 채움'],
    ['완제품성적서', '판정·출고 승인', '입력', '품질관리 책임자']
  ];
};
const FCHIP = { '자동': 'good', '템플릿': 'warn', '입력': 'mute', '제조사 요청': 'bad', '제조업자 참조': 'mute' };

/* ---------- 제품표준서 · 성적서 만들기 ---------- */
/* 같은 제품의 등록된 제품표준서 (품번이 같거나 제품명이 같으면, 가장 최근 것) */
function findExistingPS(info) {
  const nk = norm(String(info.nameKo || '').replace(/\s*\d\s*제$/, ''));
  return S.products.map((p, i) => [p, i]).filter(([p]) => (info.code && p.code === info.code) || (nk && norm(String(p.nameKo || '').replace(/\s*\d\s*제$/, '')) === nk))
    .sort((a, b) => String(b[0].date || '').localeCompare(String(a[0].date || '')) || b[1] - a[1])[0]?.[0] || null; // 같은 날이면 나중에 만든 것
}
function build(withCoa, coaOnly = false) {
  const I = ing(), M = model(), mk = maker(), info = I.info;
  if (!M.length) { notify('읽은 자료가 없습니다.'); return; }
  const p = newProduct();
  const single = M.length === 1 && M[0].key === '단품';
  if (coaOnly) { // 완제품성적서만: 등록된 제품표준서가 있으면 거기에 이번 LOT 성적서만 추가
    const ex = findExistingPS(info);
    if (ex) { const mk0 = mk ? (mk.company || mk.label || mk.name) : ''; const c = makeCoa(ex, M, mk, mk0, single, num(info.shelfMonths) || num(ex.shelfLife?.months)); S.coas.push(c); save(); return { p: ex, c, existing: true }; }
  }
  const site = (() => { const ra = roadKey(M.find(c => c.report)?.report?.makers?.[0]?.address); return (mk?.sites || []).find(s => roadKey(s) === ra) || (mk?.sites || [])[0] || ''; })();
  const mkName = mk ? (mk.company || mk.label || mk.name) : (M.find(c => c.report)?.report?.makers?.[0]?.name || '');
  const mkSite = site.replace(/^\d공장:\s*/, '') || M.find(c => c.report)?.report?.makers?.[0]?.address || '';
  const rep = M.find(c => c.report)?.report;
  const mps0 = I.files.find(f => f.kind === PSK && f.status === '완료')?.data; // 제조사 제품표준서 (전성분·함량, 문서 번호)
  p.nameKo = info.nameKo || (rep?.productName || '').replace(/\d제$/, ''); p.nameEn = info.nameEn; p.code = info.code;
  p.nameSub = single ? '' : M.map(c => `[${c.key}] ${c.bulk?.productName || c.report?.productName || ''}`).join('\n');
  p.author = '품질관리팀';
  p.typeClass = info.type || '기초화장용 제품류'; p.typeDiv = rep ? '기능성화장품' : '화장품'; p.typeSub = info.typeSub || '';
  p.funcClass = rep ? (/미백/.test(rep.effect) && /주름/.test(rep.effect) ? '미백 + 주름개선' : /미백/.test(rep.effect) ? '미백' : /주름/.test(rep.effect) ? '주름개선' : /자외선/.test(rep.effect) ? '자외선 차단' : '') : '';
  p.type = (info.type || '기초화장용 제품류') + (rep ?`\n${/미백/.test(rep.effect) && /주름/.test(rep.effect) ? '미백·주름개선 이중' : /미백/.test(rep.effect) ? '미백' : /주름/.test(rep.effect) ? '주름개선' : ''} 기능성화장품 (${/심사제외/.test(rep.kind) ? '심사제외 보고' : '심사'})` : '');
  p.weight = M.filter(c => (info.weights || {})[c.key]).map(c => `${single ? '' : `[${c.key}] `}${info.weights[c.key]}`).join('\n');
  p.appearance = M.map(c => { const x = c.bulk?.rows.find(r => /성상/.test(r.item)); return x ? `${single ? '' : `[${c.key}] `}${x.crit}` : ''; }).filter(Boolean).join('\n');
  p.packUnit = info.packUnit || '';
  p.makers = [{ type: '화장품제조업자', name: mkName, role: (mk?.scope || []).some(s => /포장/.test(s)) ? '내용물(벌크) 제조 및 충전·1차 포장' : '내용물(벌크) 제조' }];
  p.rev = '1'; p.revisions = [{ rev: '1', date: today(), effDate: today(), author: '', content: '신규 제정', reason: '', approver: '' }]; // 첫 판 = Rev.1
  { const first = M.map(c => c.bulk?.mfgDate).filter(Boolean).sort()[0], d = first ? dayBefore(first) : ''; // 제정일자는 제조일 전 (가장 이른 벌크 제조일 하루 전)
    if (d && d < today()) { p.date = d; p.revisions[0].date = p.revisions[0].effDate = d; } }
  p.components = M.map(c => {
    const k = newComp(c.key); const r = c.report; let b = c.bulk;
    k.fullName = b?.productName || r?.productName || c.key; k.maker = makerShort(mk) || mkName; k.functional = r ? '예' : '아니오';
    k.batchSize = b?.batchNum || ''; k.batchUnit = b?.batchUnit || 'kg';
    if (c.comp?.rms) k.ingredients = c.comp.rms.map(rm => ({ code: '', name: '', inci: rm.parts.map(x => x.ko).join(', '), purpose: (rm.parts[0].func || '').split(':')[0].trim(), spec: 'ICID', pct: fmtPct(rm.pct), qty: '', note: rm.parts.length > 1 ? '복합원료' : '' }));
    else if (c.single?.single) k.ingredients = c.single.single.map(x => ({ code: '', name: '', inci: x.ko || x.en, purpose: (x.func || '').split(':')[0].trim(), spec: 'ICID', pct: fmtPct(x.pct), qty: '', note: x.ko ? '' : '표준명 없음 (영문)' }));
    // 전성분표가 없으면 제조사 제품표준서의 「전성분 및 함량」 (함량은 공개된 성분만, 나머지는 제조업자 제품표준서 참조)
    if (!k.ingredients.length && M.length === 1 && (mps0?.ingredients || []).length) {
      k.ingredients = mps0.ingredients.map(x => ({ code: '', name: '', inci: x.name, purpose: '', spec: '', pct: x.pct, qty: '', note: x.pct ? '' : '함량 비공개' }));
      if (mps0.psCode) k.makerPsNo = mps0.psCode;
    }
    // 전성분(문안): 함량 없는 성분 목록
    if (!k.ingredients.length && c.names?.names) k.ingredients = c.names.names.map(x => ({ code: '', name: '', inci: x.ko || x.en, purpose: '', spec: '', pct: '', qty: '', note: x.ko ? '' : '표준명 없음 (영문)' }));
    // 그래도 없으면 원료목록 보고의 원료 이름 (함량 없음 — 분량은 전성분표·제조사 자료로)
    if (!k.ingredients.length && M.length === 1) { const ri = rawFor(p.nameKo || info.nameKo); const ns = rawIngs(ri); if (ns.length) k.ingredients = ns.map(n => ({ code: '', name: '', inci: n, purpose: '', spec: '', pct: '', qty: '', note: '' })); }
    k.fullIngredients = (c.single?.single || c.names?.names || []).map(x => x.ko || x.en);
    if (!k.fullIngredients.length && k.ingredients.length && !(c.single || c.comp)) k.fullIngredients = k.ingredients.map(x => x.inci);
    const en = (c.single?.single || c.names?.names || []).map(x => String(x.en || '').trim());
    if (en.some(Boolean)) k.fullIngredientsEn = en;
    k.composition = (c.single?.single || []).map(x => ({ ko: x.ko, pct: x.pct }));
    if (!(b?.rows || []).length && M.length === 1 && (mps0?.specs?.bulk || []).length) b = { rows: mps0.specs.bulk.map(x => ({ item: x.item, crit: x.spec, method: x.basis })) }; // 반제품성적서가 없으면 제조사 벌크시험기준서
    k.bulkSpecs = (b?.rows || []).map(x => ({ item: x.item, criterion: x.crit, method: ownStd(cleanMethod(x.method), makerShort(mk) || mkName), basis: (String(x.method || '').match(/「[^」]+」/) || [''])[0] || (/미생물|세균/.test(x.item) ? '화장품 안전기준 등에 관한 규정' : ''), specType: '자가 규격', freq: '매 배치', note: '' }));
    (r?.actives || []).forEach(a => { if (!k.bulkSpecs.some(x => N(x.item).includes(N(a.name)))) { const pct = +(a.amount / (r.baseAmount || 100) * 100).toFixed(4); k.bulkSpecs.push({ item: `${a.name} 확인시험`, method: `「기능성화장품 기준 및 시험방법」 ${r.standard || ''}`, criterion: '주피크의 유지시간은 표준품과 같다', basis: '기능성 보고서', specType: '허가 규격', freq: '매 배치', note: '반제품성적서에 없음 — 제조사 요청' }, { item: `${a.name} 함량시험`, method: `「기능성화장품 기준 및 시험방법」 ${r.standard || ''}`, criterion: `표시량의 90.0% 이상 (${pct}%)`, basis: '기능성 보고서', specType: '허가 규격', freq: '매 배치', note: '반제품성적서에 없음 — 제조사 요청' }); } });
    return k;
  });
  // 표시사항·효능
  p.usage = M.map(c => c.report?.usage).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('\n');
  p.labeling.maker = `${mkName}${mkSite ? ' / ' + mkSite : ''}`;
  p.labeling.functionalLabel = rep ? `${single ? '' : M.filter(c => c.report).map(c => c.key).join('·') + ' '}${p.type.split('\n')[1]?.replace(/\s*\(.*\)/, '') || ''}` : '';
  p.labeling.cautions = rep?.cautions || '';
  p.labeling.fullIng = M.map(c => `${single ? '' : `[${c.key}] `}${(c.single?.single || []).map(x => x.ko).join(', ')}`).join('\n');
  p.efficacy.effect = rep?.effect || '';
  p.efficacy.actives = M.filter(c => c.report).map(c => `${single ? '' : `[${c.key}] `}${c.report.actives.map(a => `${a.name} ${+(a.amount / (c.report.baseAmount || 100) * 100).toFixed(4)}%`).join(' / ')}`).join('\n');
  p.efficacy.reviewNo = M.filter(c => c.report).map(c => `${single ? '' : `[${c.key}] `}보고일련번호 ${c.report.seq} · 부서접수번호 ${c.report.receiptNo}`).join(' / ');
  p.efficacy.reviewDate = rep?.reportDate || '';
  p.cautionsCommon = rep?.cautions || '';
  p.funcLinks = [...new Set([...M.map(c => c.report?.seq), ...(info.pickedSeqs || [])])].filter(s => s && FDmap.has(s));
  const fdi = !rep && p.funcLinks.length ? FDmap.get(p.funcLinks[0]) : null; // 보고서 원본이 없으면 기능성 자료(공개 정보)로
  if (fdi) {
    p.efficacy.effect = fdi.effect || ''; p.usage = p.usage || fdi.usage || ''; p.labeling.cautions = p.cautionsCommon = fdi.cautions || '';
    p.efficacy.reviewNo = p.funcLinks.map(q => FDmap.get(q)).map(x => `보고일련번호 ${x.seq} · 부서접수번호 ${x.receiptNo || ''}`).join(' / '); p.efficacy.reviewDate = fdi.date || '';
    p.typeDiv = '기능성화장품'; p.funcClass = /미백/.test(fdi.effect) && /주름/.test(fdi.effect) ? '미백 + 주름개선' : /미백/.test(fdi.effect) ? '미백' : /주름/.test(fdi.effect) ? '주름개선' : /자외선/.test(fdi.effect) ? '자외선 차단' : '';
    p.components.forEach(k => { k.functional = '예'; });
  }
  const mps = I.files.find(f => f.kind === PSK && f.status === '완료')?.data; // 제조사 제품표준서 번호
  // 공정·주의·기준 템플릿
  p.precautions = [
    { name: '일반사항', content: '1. 제조 계획된 제품의 제조 공정도인지 확인\n2. 각 제조에 따른 기계시설의 이상유무 확인\n3. 작업장의 청결상태, 작업원의 복장상태(장갑·마스크·두건), 기계·기구의 세척상태 및 보관상태를 작업 전 점검한다.' },
    { name: '칭량', content: '1. 각 원료의 이상유무 확인\n2. 원료 순서에 따라 칭량하고 칭량된 원료를 재확인하며, 칭량 직후 파트별 구분 표시를 부착한다.\n3. 칭량 지시서에 명시된 원료의 함량을 칭량 후 재확인한다.' },
    { name: '제조', content: '1. 제조지시 및 기록서의 지시 사항에 따라 제조한다.\n2. 인수된 원료를 칭량 지시서 및 제조지시 및 기록서의 명칭·함량과 일치하는지 확인한다.\n3. 저장 통의 혼용으로 내용물의 이상이 생기지 않도록 유의한다.' },
    { name: '충전', content: '1. 벌크제품은 최대 보관기간 이내의 적합품만 사용한다.\n2. 충전량은 표시량 이상이 되도록 공정 중 중량을 수시 점검한다.\n3. 누액·이물 혼입이 없도록 확인하고, 라인 교체 시 이전 제품의 잔류가 없도록 청소 및 라인 클리어런스를 실시한다.' },
    { name: '포장 (포장작업 시 주의사항)', content: '1. 포장지시서의 자재 코드·수량과 실물이 일치하는지 확인한다.\n2. 제조번호(LOT)·사용기한 인쇄 위치와 내용을 첫 제품에서 확인하고 수시 점검한다.\n3. 표시사항 오기재·자재 혼입이 없도록 하고, 잔여 자재는 반납·폐기 기록을 남긴다.' }
  ];
  p.rawSpecs = [
    { type: '원료', item: '성상·확인시험 등', method: '원료 규격서(제조사)에 따름', criterion: '원료별 규격서에 적합', doc: `${makerShort(mk) || '제조사'} 원료 규격서 (별도관리)`, note: '' },
    { type: '자재(포장재)', item: '외관, 치수, 인쇄상태', method: '표준품과 비교(육안·계측)', criterion: '포장재 규격서에 적합', doc: '포장재 규격서 · 자재 표준품 (별도관리)', note: '' }
  ];
  p.semiNA = true;
  const fs = [
    { item: '표시기재사항', sub: '', criterion: '표준품과 동일 (화장품법 제10조 기재사항)', method: '자재 표준품과 비교', note: '' },
    { item: '외관 (자재 이상 유무)', sub: '', criterion: '표준품과 동일', method: '육안 비교', note: '' },
    { item: '포장사양', sub: '', criterion: '포장 기준서와 일치', method: '포장 기준서 대조', note: '' }];
  M.forEach(c => {
    const sub = single ? '' : c.key, br = c.bulk?.rows || [], r = c.report;
    const pick = re => br.find(x => re.test(x.item));
    const push = (item, crit, method) => fs.push({ item, sub, criterion: crit, method: ownStd(cleanMethod(method), makerShort(mk) || mkName), note: '' });
    // 시험방법은 제조사 반제품시험성적서에 적힌 방법 우선. 미생물을 외부 시험기관이 했으면 시험방법 = 그 기관 이름 (예: KATRI시험연구원)
    const mic = c.micro || M.find(k => k.micro)?.micro, lab = mic ? (mic.lab || '외부 시험기관') : '';
    const micHas = re => !!mic && (mic.rows || []).some(x => re.test(x.item));
    const sx = pick(/성상/); push('성상', sx?.crit || '표준품과 동일', sx?.method || '표준품과 비교 및 육안확인');
    const hx = pick(/향/); push('향취', hx?.crit || '표준품과 동일', hx?.method || '표준품과 비교');
    const px = pick(/^pH\b/i); push('pH', px?.crit || (r?.ph ? `${r.ph} ± 1.00` : ''), px?.method || '「기능성화장품 기준 및 시험방법」 pH 측정법');
    const vx = pick(/점도/); if (vx) push('점도', vx.crit, vx.method);
    const gx = pick(/비중/); if (gx) push('비중', gx.crit, gx.method);
    (r?.actives || []).forEach(a => {
      const pct = +(a.amount / (r.baseAmount || 100) * 100).toFixed(4), def = `「기능성화장품 기준 및 시험방법」 ${r.standard || ''}`;
      const ax = kind => br.find(x => N(x.item).includes(N(a.name)) && x.item.includes(kind));
      push(`${a.name} 확인시험`, '주피크의 유지시간은 표준품과 같다', ax('확인')?.method || def);
      push(`${a.name} 함량시험`, `표시량의 90.0% 이상 (${pct}%)`, ax('함량')?.method || def);
    });
    const SAFE = '「화장품 안전기준 등에 관한 규정」 유통화장품 안전관리 기준';
    const mx = br.find(x => /총호기성|미생물/.test(N(x.item)));
    push('미생물한도 (총호기성생균수)', mx?.crit || '1,000 cfu/g(mL) 이하', micHas(/^총호기성생균수$/) ? lab : mx?.method || SAFE);
    const px2 = br.find(x => /병원성|특정세균|대장균/.test(N(x.item + x.crit)));
    push('특정세균 (대장균·녹농균·황색포도상구균)', '불검출', micHas(SPECIFIC) ? lab : px2?.method || SAFE);
    push('내용량', '표기량의 97% 이상 (3개 평균)', '「화장품 안전기준 등에 관한 규정」 유통화장품 안전관리 기준');
    const ix = pick(/이물/); push('이물', ix?.crit || '이물질이 없어야 함', ix?.method || '육안 측정');
  });
  fs.forEach(f => { if (/미생물|특정세균/.test(f.item)) f.basis = '화장품 안전기준 등에 관한 규정'; });
  p.finishedSpecs = fs;
  if ((mps0?.specs?.finished || []).length) { // 제조사 제품표준서가 있으면 완제품 기준(성적서 시험항목)은 그 「완제품시험기준서」 항목·관리규격 그대로 (사용자 요청)
    const mkS = makerShort(mk) || mkName;
    p.finishedSpecs = mps0.specs.finished.map(r => ({ item: r.item, sub: '', stage: '완제품', criterion: r.spec, method: ownStd(cleanMethod(r.basis), mkS), basis: '', apply: /미생물|병원성|세균/.test(r.item) ? '위탁시험 / 제조사' : '입고검사', note: r.note || '' }));
  }
  p.packMethod = { lotExp: '제조번호(LOT)·사용기한은 1차 용기와 2차 포장(단상자)에 표시 — 위치는 자재 표준품 기준', primary: '', secondary: '', outbox: '' };
  p.storage = [{ type: '원자재', target: '원료 및 자재', condition: '지정된 보관구역에서 원료·자재별 규격서에 정한 조건으로 보관', maxStorage: '', note: '선입선출' },
    ...M.map((c, i) => ({ type: `벌크제품 ${'①②③④'[i] || i + 1}`, target: c.bulk?.productName || c.key, condition: '밀폐 용기에 넣어 지정 장소에 보관, 고온·직사광선을 피함', maxStorage: '', note: `${makerShort(mk)} 기준` })),
    { type: '완제품', target: '충진·포장 완료품', condition: /직사광선/.test(rep?.cautions || '') ? '직사광선을 피하고 어린이의 손이 닿지 않는 곳에 보관' : '서늘하고 직사광선이 없는 곳에 보관', maxStorage: '', note: '' }];
  if (mps0) { // 제조사 제품표준서 값으로 빈 곳 채우기
    if (!p.appearance && mps0.appearance) p.appearance = mps0.appearance;
    if (mps0.bulkCode) p.bulkCode = mps0.bulkCode;
    if (!p.packUnit && mps0.packUnit) p.packUnit = mps0.packUnit;
    if (!p.usage && mps0.usage) p.usage = mps0.usage;
    const finS = p.storage.find(s => s.type === '완제품'); if (finS && mps0.storage) finS.condition = mps0.storage;
    if (!p.efficacy.reviewNo && mps0.reportNo) { p.efficacy.reviewNo = `접수번호 ${mps0.reportNo}`; p.efficacy.reviewDate = mps0.reportDate || ''; }
  }
  const mo = num(info.shelfMonths); p.shelfLife = { life: mo ? `제조일로부터 ${mo}개월` : '', months: mo || '', basis: mo ? '벌크 제조일' : '', note: info.erp ? `ERP 품목 ${info.erp.code} 기준` : '' };
  const om = num(info.openMonths); if (om) p.openLife = { life: `개봉 후 ${om}개월`, basis: '개봉일', note: '' };
  // 별첨·근거
  const mfgOn = mfgOption();
  p.mfgDoc = mfgOn ? (String(info.mfgDoc || '').trim() || mfgFiles().map(f => f.name.replace(/\.pdf$/i, '')).join(', ')) : '';
  p.uploads = I.files.filter(f => f.status === '완료').map(f => ({ fileId: f.id, kind: f.kind, comp: single || f.kind === MFGK ? '' : f.comp, name: f.name, print: f.kind !== '전성분표' && f.kind !== PSK && f.kind !== '반제품성적서' && f.kind !== '미생물시험성적서' /* 제조사 제품표준서·반제품·미생물 성적서 원본은 넣지 않음 (값만 읽음) */ && (f.kind !== MFGK || mfgOn), ...(f.pageAssets ? { pageAssets: f.pageAssets } : {}) }));
  p.attachments = [
    ...M.filter(c => c.report).map(c => ({ name: `기능성화장품 보고서 (심사제외)${single ? '' : ' — ' + c.key}`, no: `보고일련번호 ${c.report.seq}`, rev: c.report.reportDate, location: '본 문서 뒤 첨부 (원본)', note: `부서접수번호 ${c.report.receiptNo}` })),
    ...M.filter(c => c.single || c.comp).map(c => ({ name: `전성분표 (함량 포함)${single ? '' : ' — ' + c.key}`, no: '', rev: (c.single || c.comp).date, location: '자료로 작성 · 원본 파일', note: makerShort(mk) })),
    ...M.filter(c => c.micro).map(c => ({ name: `미생물 시험성적서 (외부)${single ? '' : ' — ' + c.key}`, no: c.micro.reportNo, rev: c.micro.issueDate, location: '본 문서 뒤 첨부 (원본)', note: c.micro.lab })),
    ...M.filter(c => c.bulk).map(c => ({ name: `반제품(벌크) 시험성적서${single ? '' : ' — ' + c.key}`, no: c.bulk.testNo, rev: c.bulk.mfgDate, location: '본 문서 뒤 첨부 (원본)', note: `제조번호 ${c.bulk.lot}` })),
    ...(mk ? [{ name: `화장품 제조업 등록필증 — ${makerShort(mk)}`, no: mk.regNo || '', rev: mk.lastChange || mk.firstDate || '', location: '구글 드라이브 (제조사 관리)', note: (mk.scope || []).length ? '영업: ' + mk.scope.map(s => /직접/.test(s) ? '직접제조' : /위탁/.test(s) ? '위탁제조' : /포장/.test(s) ? '1차포장' : s).join('·') : '' }] : [])
  ];
  p.toc = { '1': '기능성 보고서 · 제조업 등록필증', '2': '전성분표(복합) · 반제품성적서(제조량)', '7': '반제품성적서 · 기능성 보고서', '8': rep ? `기능성 보고서 ${M.filter(c => c.report).map(c => c.report.seq).join(', ')}` : '', '9': '전성분표(단일) · 기능성 보고서', '6': '자사 표준 문구 (제조사 기준 확인)', '10': '포장재 규격서 · 자재 표준품', '12': '사용기한: ERP 품목 · 안정성 자료' };
  p.sourceIngest = { at: nowStr(), files: I.files.map(f => f.name) };
  p.scope = '전체'; p.makerRef = [...new Set([...p.components.map(c => c.makerPsNo).filter(x => x !== mps?.psCode), mps?.psCode ? `${makerShort(mk) || '제조사'} 제품표준서 ${mps.psCode}` : ''].filter(Boolean))].join(', ');
  p.keyIngredients = []; keyCandidates(p);
  p.psNo = nextPsNo(p); // OI-브랜드-연도-순번 (제품명·품번이 정해진 뒤)
  p.v2m = false; S.products.push(p); fixProduct(p);
  let c = null;
  if (withCoa) { c = makeCoa(p, M, mk, mkName, single, num(info.shelfMonths)); S.coas.push(c); }
  save();
  return { p, c };
}
/* 완제품성적서 한 건: 제품표준서(p)의 완제품 기준을 시험항목으로, 올린 반제품·미생물 성적서 결과를 채움 */
function makeCoa(p, M, mk, mkName, single, mo) {
    const c = newCoa(p);
    c.lots = M.map(k => ({ label: single ? '' : k.key, lot: k.bulk?.lot || '', maker: makerShort(mk), mfgDate: k.bulk?.mfgDate || '' }));
    c.labelQty = p.weight.replace(/\n/g, ' / ');
    const KEYS = ['성상', '향', 'pH', '점도', '비중', '미생물', '이물'];
    c.results.forEach(r => {
      const comp = M.find(k => (single ? '' : k.key) === (r.sub || '')) || (single ? M[0] : null); const br = comp?.bulk?.rows || [];
      const isSpec = /특정세균|병원성/.test(r.item), isTotal = !isSpec && /미생물|총호기성/.test(r.item); // 미생물2(병원성균) = 특정세균, 미생물1(총호기성생균수) = 미생물한도
      const key = KEYS.find(k => r.item.includes(k)); let hit = key && !isSpec && !isTotal ? br.find(x => x.item.includes(key)) : null;
      if (!hit) hit = br.find(x => N(x.item) === N(r.item));
      const act = (r.item.match(/^(.+?)\s*(확인시험|함량시험)$/) || []);
      if (!hit && act[1]) hit = br.find(x => N(x.item).includes(N(act[1])) && x.item.includes(act[2].replace('시험', '')));
      if (!hit && isTotal) hit = br.find(x => /총호기성|미생물1|미생물한도/.test(N(x.item)));
      if (!hit && isSpec) hit = br.find(x => /병원성|특정세균|대장균/.test(N(x.item + x.crit)));
      // 외부 미생물시험성적서가 있으면 미생물·특정세균은 그것을 우선
      const mic = comp?.micro || M.find(k => k.micro)?.micro;
      const mrows = mic ? (isTotal ? mic.rows.filter(x => /^총호기성생균수$/.test(x.item)) : isSpec ? mic.rows.filter(x => SPECIFIC.test(x.item)) : []) : [];
      if (mrows.length) { r.result = mrows.map(x => x.result).join(' / '); r.judge = mrows.every(microOk) ? '적합' : '부적합'; r.tester = mic.lab || '외부 시험기관'; r.method = mic.lab || '외부 시험기관'; r.date = mic.issueDate || ''; r.note = `외부 시험 ${mic.lab || ''} ${mic.reportNo || ''}`.trim(); return; }
      if (hit && r.apply !== '입고검사') { r.result = hit.result; r.judge = hit.judge || ''; if (String(hit.method || '').trim()) r.method = ownStd(cleanMethod(hit.method), makerShort(mk) || mkName); r.tester = makerShort(mk) || '제조사'; r.date = hit.date || ''; r.note = `벌크 시험자료 적용 (반제품 ${comp.bulk.testNo})`; }
    });
    // 미생물(미생물한도·특정세균)은 외부 시험기관 결과로 채운 줄만 남김 — 제조사(코스맥스 등) 자체 미생물 시험·빈 줄은 넣지 않음 (사용자 요청 2026-11-16)
    c.results = c.results.filter(r => !isMicroRow(r) || /^외부 시험/.test(r.note || ''));
    c.remarks = String(ing().info.coaRemarks || '').trim(); // 특이사항은 「3. 만들기」에 쓴 내용만 (자동 문구 없음 — 사용자 요청)
    const ds = c.lots.map(l => l.mfgDate).filter(Boolean).sort(); if (ds[0] && mo) c.expiry = addMonths(ds[0], mo);
    c.requestDate = ''; c.receiptDate = today();
    return c;
}

/* ---------- 화면 ---------- */
let drawT = 0;
function draw(light) {
  if (V.tab !== 'ingest') return;
  if (light) { const now = Date.now(); if (now - drawT < 400) return; drawT = now; const tb = document.querySelector('#ingFiles'); if (tb) { tb.replaceWith(fileTable()); return; } }
  const m = $('#main'); if (!m) return; m.innerHTML = ''; renderIngest(m);
}
function fileTable() {
  const I = ing();
  const t = el(`<div id="ingFiles"><table class="list"><thead><tr><th>파일</th><th style="width:130px">종류</th><th style="width:90px">구성품</th><th style="width:120px">상태</th><th>읽은 내용</th><th style="width:150px"></th></tr></thead><tbody></tbody></table></div>`);
  const tb = t.querySelector('tbody');
  if (!I.files.length) tb.innerHTML = '<tr><td colspan="6" class="empty">아직 올린 자료가 없습니다.</td></tr>';
  I.files.forEach(f => {
    const d = f.data || {};
    const sum = f.status !== '완료' ? esc(f.err || '') : f.kind === '기능성보고서' ? `${esc(d.productName)} · 보고일련번호 ${esc(d.seq)} · ${esc(d.reportDate)} · pH ${esc(d.ph)} · ${esc((d.actives || []).map(a => a.name + ' ' + a.amount + a.unit).join(', '))}`
      : f.kind === '미생물시험성적서' ? `${esc(d.lab)} · ${esc(d.reportNo)} · 발급 ${esc(d.issueDate)} · ${esc(d.productName)}${d.lot ? ' · 제조번호 ' + esc(d.lot) : ''} · ${esc((d.rows || []).map(x => x.item + ' ' + x.result).join(', '))}`
      : f.kind === MFGK ? `${d.pages || 0}쪽 — 제품표준서 별첨2로 붙음` : f.kind === PSK ? `${esc(d.productName)}${(f.codes || []).length ? ' · 품번 ' + esc(f.codes.join(', ')) : ''}${d.shelfMonths ? ' · 사용기한 ' + esc(d.shelfMonths) + '개월' : ''}${d.packUnit ? ' · 포장단위 ' + esc(d.packUnit) : ''}${d.appearance ? ' · 성상 ' + esc(d.appearance) : ''}${(d.ingredients || []).length ? ` · 전성분 ${d.ingredients.length}종` : ''}${d.report ? ` · 기능성 보고 ${esc(d.report.seq || '')} (${esc((d.report.actives || []).map(a => a.name).join('·'))})` : ''} · ${d.pages || 0}쪽 (값만 읽고 원본은 넣지 않음)` : f.kind === '전성분표' ? `${esc(d.productName)} · ${d.single ? `단일 ${d.single.length}종` : ''}${d.rms ? ` 복합원료 ${d.rms.length}종` : ''}${d.names ? ` 전성분(문안) ${d.names.length}종 · 함량 없음` : ''}${(() => { const xs = [...(d.single || []), ...(d.names || []), ...(d.rms || []).flatMap(r => r.parts)], n = xs.filter(x => x.std && x.std !== '국문·영문 대조표').length, m = xs.filter(x => x.std === '국문·영문 대조표').length; return (m ? ` · 국문·영문 대조표로 국문명 ${m}건` : '') + (n ? ` · 성분사전으로 표준명 ${n}건` : ''); })()} · ${esc(d.date)}`
      : `${esc(d.productName)} · 제조번호 ${esc(d.lot)} · 제조일 ${esc(d.mfgDate)} · 제조량 ${esc(d.batch)} · ${esc(d.testNo)} · ${(d.rows || []).length}항목${d.ocr ? ' <span class="pill">글자 인식</span>' : ''}`;
    const st = f.status === '완료' ? chip('완료', 'good') : f.status === '오류' ? chip('오류', 'bad') : chip(f.status, 'warn');
    const tr = el(`<tr><td>${esc(f.name)}</td><td></td><td></td><td>${st}</td><td style="font-size:12px">${sum}</td><td></td></tr>`);
    const ks = el(`<select>${['반제품성적서', '미생물시험성적서', '기능성보고서', '전성분표', MFGK, PSK].map(k => `<option ${k === f.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>`);
    ks.onchange = async () => { const r = await IDB.get(f.id); if (!r) return; try { await processRec(f, r.blob, ks.value); } catch (e) { f.status = '오류'; f.err = e.message; } autoInfo(); save(); draw(); };
    tr.children[1].appendChild(ks);
    const cs = el(`<input value="${esc(f.comp)}" placeholder="1제·단품">`); cs.onchange = () => { f.comp = cs.value.trim() || '단품'; save(); draw(); }; tr.children[2].appendChild(cs);
    const act = tr.children[5];
    if (f.kind === '반제품성적서' && f.status === '완료') act.appendChild(button('표 확인·수정', () => { V.ingOpen = V.ingOpen === f.id ? null : f.id; draw(); }));
    act.appendChild(button('✕', async () => { if (!await askConfirm(`${f.name}을(를) 목록에서 뺄까요?`, { ok: '빼기' })) return; I.files = I.files.filter(x => x !== f); await IDB.del(f.id); save(); draw(); }, 'btn sm danger'));
    tb.appendChild(tr);
    if (V.ingOpen === f.id && f.data) {
      const row = el('<tr><td colspan="6" style="background:#f8fafc"><div style="display:grid;grid-template-columns:1fr 360px;gap:12px;align-items:start"><div class="ed"></div><div class="img hint">원본 불러오는 중…</div></div></td></tr>');
      const ed = row.querySelector('.ed');
      ed.appendChild(form([['제품명', inp(f.data, 'productName')], ['시험번호', inp(f.data, 'testNo')], ['제조번호', inp(f.data, 'lot')], ['제조일자', inp(f.data, 'mfgDate', { type: 'date' })], ['제조량', inp(f.data, 'batchNum', { onch: v => f.data.batch = v + ' ' + f.data.batchUnit })], ['판정', inp(f.data, 'verdict', { opts: ['', '적합', '부적합'] })]]));
      ed.appendChild(el('<div class="hint" style="margin:6px 0">글자 인식 결과입니다. 원본과 다르면 고쳐 주세요 (고친 내용이 제품표준서·성적서에 들어갑니다).</div>'));
      ed.appendChild(tedit(f.data.rows, [{ k: 'item', label: '시험항목', w: '13%' }, { k: 'crit', label: '시험기준', w: '19%' }, { k: 'method', label: '시험방법' }, { k: 'result', label: '결과', w: '14%' }, { k: 'judge', label: '판정', w: '9%', opts: ['', '적합', '부적합'] }, { k: 'tester', label: '시험자', w: '10%' }]));
      IDB.get(f.id).then(r => { const box = row.querySelector('.img'); box.innerHTML = r?.pages?.[0] ? `<a href="${r.pages[0]}" target="_blank"><img src="${r.pages[0]}" style="width:100%;border:1px solid var(--line)"></a>` : '원본 그림 없음'; });
      tb.appendChild(row);
    }
  });
  return t;
}
function renderIngest(m) {
  const I = ing(), M = model(), mk = maker();
  const tb = el('<div class="toolbar"><div class="ttl">자료로 작성<small>반제품성적서 · 미생물시험성적서(외부) · 기능성 보고서를 넣으면 제품표준서·완제품성적서 초안을 만듭니다 (전성분표·제조지시 및 공정 기록서는 있을 때만)</small></div></div>');
  tb.appendChild(button('새로 시작', async () => { if (I.files.length && !await askConfirm('올린 자료와 입력값을 비우고 새로 시작할까요? 이미 만든 제품표준서는 남습니다.', { ok: '새로 시작' })) return; for (const f of I.files) await IDB.del(f.id); S.ingest = null; save(); draw(); }, 'btn'));
  m.appendChild(tb);
  // 1. 자료
  const c1 = el(`<div class="card"><h3>1. 자료 올리기 <span class="r hint">PDF · 엑셀 여러 개를 한 번에 · 파일 이름의 '1제/2제'로 구성품을 나눕니다</span></h3>
    <div id="drop" style="border:2px dashed #b9cbe6;border-radius:10px;padding:22px;text-align:center;cursor:pointer;background:#f7faff;margin-bottom:10px">여기에 끌어다 놓거나 <b>눌러서 파일 고르기</b><br><span class="hint">반제품성적서(PDF, 스캔본도 글자 인식) · 미생물시험성적서(외부 시험기관 PDF) · 기능성 보고서(의약품안전나라 PDF) · 전성분표(엑셀, 선택) · 제조지시 및 공정 기록서·제조사 제품표준서(PDF, 선택)</span></div>
    <input type="file" id="ingIn" multiple accept=".pdf,.xlsx,.xls" hidden></div>`);
  const drop = c1.querySelector('#drop'), fi = c1.querySelector('#ingIn');
  drop.onclick = () => fi.click(); fi.onchange = () => { addFiles([...fi.files]); fi.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.style.background = '#e8f0fd'; }; drop.ondragleave = () => drop.style.background = '#f7faff';
  drop.ondrop = e => { e.preventDefault(); drop.style.background = '#f7faff'; addFiles([...e.dataTransfer.files]); };
  c1.appendChild(fileTable()); m.appendChild(c1);
  // 2. 제품 정보
  const c2 = el('<div class="card"><h3>2. 제품 정보 <span class="r hint">자료에서 읽은 값이 먼저 들어갑니다 · 고쳐 쓰면 그 값으로 만듭니다</span></h3></div>');
  const sel = el(`<select><option value="">— 제조업체 선택 —</option>${MK.map(x => `<option value="${esc(x.name)}" ${x.name === I.info.makerName ? 'selected' : ''}>${esc(x.label || x.name)}${x.regNo ? ' · ' + esc(x.regNo) : ''}</option>`).join('')}</select>`);
  sel.onchange = () => { I.info.makerName = sel.value; save(); draw(); };
  if (I.files.some(f => f.status === '완료') && !I.info.nameKo && !I.info.autoTried) { autoInfo(); I.info.autoTried = true; save(); } // 예전에 올려 둔 자료도 한 번 채움
  const nk = inp(I.info, 'nameKo', { ph: '기능성·원료목록 보고 제품명 일부 — 예) 들깨', onch: v => { const it = FDmap.get((I.info.pickedSeqs || [])[0]); if (it && norm(String(it.name).replace(/\s*\d\s*제$/, '')) !== norm(v)) I.info.pickedSeqs = []; } });
  const nkBox = document.createElement('div'); nkBox.appendChild(nk);
  suggest(nk, o => { I.info.pickedSeqs = o.seqs || []; I.info.typeAuto = I.info.typeAuto ?? true; applyRaw(I.info); save(); draw(); }, { mode: 'func' }); // 제품명은 기능성 자료(의약품안전나라 보고 품목)에서
  c2.appendChild(form([['제품명', nkBox, true], ['화장품 유형', inp(I.info, 'type', { onch: () => { I.info.typeAuto = false; } })],    ['사용기한 (개월)', inp(I.info, 'shelfMonths', { type: 'number', ph: '예) 30' })], ['개봉 후 사용기간 (개월)', inp(I.info, 'openMonths', { type: 'number', ph: '예) 12' })], ['포장단위', inp(I.info, 'packUnit', { ph: '예) 1제 30ml + 2제 30ml / 1세트' })], ['제조업체', sel]]));
  { const fd = (I.info.pickedSeqs || []).map(q => FDmap.get(q)).filter(Boolean), it = I.info.code ? ITEMS.find(x => x.c === I.info.code) : null, ri = rawFor(I.info.nameKo);
    if (ri) c2.appendChild(el(`<div class="hint" style="margin-top:6px">원료목록 보고: <b>${esc(ri.name)}</b> · 유형 ${esc(ri.type || '-')}${typeOf(ri.type)?.sub ? ' ' + esc(typeOf(ri.type).sub.replace(/\s*\(.*\)$/, '')) : ''} · 제조업자 ${esc(ri.maker || '-')} · 원료 ${(ri.ings || []).length}종${ri.func ? ' · 기능성 ' + esc(ri.func) : ''}</div>`));
    if (fd.length || I.info.code) {
      const h = el(`<div class="hint" style="margin-top:6px;line-height:1.7">${fd.length ? `기능성 자료: <b>${esc(fd[0].name.replace(/\s*\d\s*제$/, ''))}</b> · 보고일련번호 ${esc(fd.map(x => x.seq).join(', '))} · ${esc(fd[0].date || '')} <span class="pill">효능·용법·주의사항에 씀</span>` : ''}${fd.length && I.info.code ? '<br>' : ''}${I.info.code ? `읽은 품번: <b>${esc(I.info.code)}</b>${it ? ' ' + esc(it.n) : ''} — 제품표준서·성적서 제품코드 칸에 들어갑니다 ` : ''}</div>`);
      if (I.info.code) h.appendChild(button('품번 빼기', () => { I.info.code = ''; save(); draw(); }, 'btn sm'));
      c2.appendChild(h);
    } }
  if (mk) c2.appendChild(el(`<div class="funcbox" style="margin-top:8px"><b>${esc(mk.company || mk.label)}</b> · 화장품 제조업 등록필증 ${esc(mk.regNo || '번호 판독 불가')} · 대표자 ${esc(mk.ceo || '-')} · ${esc(mk.issuer || '')}<br>소재지: ${esc((mk.sites || []).join(' / ') || '-')}<br>영업 범위: ${esc((mk.scope || []).join(' / ') || '-')} <span class="hint">· 판독 신뢰도 ${esc(mk.confidence || '-')}${mk.note ? ' · ' + esc(mk.note) : ''}</span>${mk.fileId ? ` · <a href="https://drive.google.com/file/d/${esc(mk.fileId)}/view" target="_blank" rel="noopener">필증 원본</a>` : ''}</div>`));
  if (M.length) { const w = el('<div class="form" style="margin-top:8px"></div>'); I.info.weights = I.info.weights || {}; M.forEach(c => { w.appendChild(el(`<label>표시용량 ${esc(c.key)}</label>`)); const d = document.createElement('div'); d.appendChild(inp(I.info.weights, c.key, { ph: '예) 30ml' })); w.appendChild(d); }); c2.appendChild(w); }
  m.appendChild(c2);
  // 3. 만들기
  const c4 = el(`<div class="card"><h3>3. 만들기</h3></div>`);
  const ok = M.length && M.every(c => c.bulk || c.single || c.comp || c.names || c.report || c.micro);
  const b1 = button('제품표준서 + 완제품성적서 만들기', () => { const r = build(true); if (r) go('ps', { pid: r.p.id, sec: 's1' }); }, 'btn pri');
  const b2 = button('제품표준서만 만들기', () => { const r = build(false); if (r) go('ps', { pid: r.p.id, sec: 's1' }); }, 'btn');
  const b3 = button('완제품성적서만 만들기', () => { const r = build(true, true); if (!r) return; notify(r.existing ? `등록된 제품표준서(${r.p.psNo} Rev.${r.p.rev})에 이번 성적서를 추가했습니다.` : '같은 제품의 제품표준서가 없어 제품표준서도 함께 만들었습니다.', 'good'); go('coa', { cid: r.c.id }); }, 'btn');
  if (!ok) { b1.disabled = b2.disabled = b3.disabled = true; }
  // 선택: 별첨2 제조지시 및 공정 기록서 (자료 있을 때만)
  { const mf = mfgFiles(), on = I.info.mfgOn ?? mf.length > 0;
    const opt = el(`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fbfcfe"><label style="display:flex;align-items:center;gap:6px;font-weight:700;cursor:pointer"><input type="checkbox" ${on ? 'checked' : ''}> 별첨2 제조지시 및 공정 기록서 넣기</label><span class="mfst hint"></span></div>`);
    const cb = opt.querySelector('input'), st = opt.querySelector('.mfst');
    cb.onchange = () => { I.info.mfgOn = cb.checked; save(); draw(); };
    if (on) { const d = inp(I.info, 'mfgDoc', { ph: mf.length ? mf.map(f => f.name.replace(/\.pdf$/i, '')).join(', ') : '문서명 · 문서번호' }); d.style.minWidth = '320px'; d.style.flex = '1'; opt.appendChild(d); }
    st.textContent = !on ? '빼고 만듭니다' : mf.length ? `올린 원본 ${mf.length}개를 별첨2 뒤에 붙임` : String(I.info.mfgDoc || '').trim() ? '' : '자료가 없으면 빼고 만듭니다';
    c4.appendChild(opt); }
  { const rm = el('<div style="margin-bottom:12px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">완제품성적서 특이사항 <span class="hint" style="font-weight:400">쓴 내용이 성적서 「특이사항」 칸에 그대로 들어갑니다 · 비우면 빈칸</span></div></div>');
    rm.appendChild(inp(I.info, 'coaRemarks', { rows: 2, ph: '예) 반제품 시험성적서 26B104181 인용' })); c4.appendChild(rm); }
  c4.appendChild(inl(b1, b2, b3)); m.appendChild(c4);
}
RENDER.ingest = renderIngest;
// 첫 화면이 「자료로 작성」이라, 본체가 먼저 그려 「불러오는 중…」으로 남아 있으면 이 파일이 들어온 뒤 바로 다시 그림
if (typeof V !== 'undefined' && V.tab === 'ingest' && typeof render === 'function') render();
window.__ingest = { parseFuncReport, parseIngredientXlsx, interpretGrid, model, checks, build, parseMakerPS, ingDict,
  specsOf: async url => { const lib = await pdfjs(); const doc = await lib.getDocument({ data: new Uint8Array(await (await fetch(url)).arrayBuffer()) }).promise; return parseSpecPages(doc); }, makeCoa,
  // 점검용: PDF 쪽별 줄 글자 (화면에는 안 씀)
  textOf: async (url, from = 1, to = 20) => { const lib = await pdfjs(); const doc = await lib.getDocument({ data: new Uint8Array(await (await fetch(url)).arrayBuffer()) }).promise; const out = []; for (let i = from; i <= Math.min(to, doc.numPages); i++) out.push((await visualLines(await doc.getPage(i))).map(l => l.text)); return out; } };
})();
