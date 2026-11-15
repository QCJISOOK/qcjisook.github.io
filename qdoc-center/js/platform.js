/* 품질문서 발행센터 — 실행 환경
   · 이 PC (발행센터_열기.bat, localhost:5283): 브라우저 저장소 + 인쇄 + 내보내기 폴더 저장
   · claude.ai 공유 페이지 (Artifact): 팀 공동 저장소(db) + 첨부 그림(assets) + 파일 받기(downloads)
   어느 쪽이든 앱 코드는 notify / askConfirm / askText / saveFile / Cloud 만 쓴다. */
'use strict';
(function () {
const IS_ART = !!(window.claude && typeof window.claude.use === 'function');
window.QDOC_ENV = IS_ART ? 'artifact' : 'local';


/* ---------- 알림 · 확인 창 (공유 페이지에서는 alert/confirm/prompt가 막혀 있음) ---------- */
function layer() {
  let L = document.getElementById('qnLayer');
  if (!L) { L = document.createElement('div'); L.id = 'qnLayer'; L.className = 'qn-layer'; L.setAttribute('role', 'status'); L.setAttribute('aria-live', 'polite'); document.body.appendChild(L); }
  return L;
}
function notify(msg, kind = 'info', ms = 5200) {
  const t = document.createElement('div'); t.className = 'qn ' + kind;
  const m = document.createElement('div'); m.className = 'qn-m'; m.textContent = String(msg ?? ''); t.appendChild(m);
  const x = document.createElement('button'); x.className = 'qn-x'; x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.textContent = '×'; x.onclick = () => t.remove(); t.appendChild(x);
  layer().appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
  return t;
}
function dialog(msg, { input = null, ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'modal qd';
    const box = document.createElement('div'); box.className = 'box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const p = document.createElement('div'); p.className = 'qd-msg'; p.textContent = msg; box.appendChild(p);
    let inp = null;
    if (input !== null) { inp = document.createElement('input'); inp.id = 'qdInput'; inp.value = input; inp.style.marginTop = '10px'; box.appendChild(inp); }
    const bar = document.createElement('div'); bar.className = 'qd-bar';
    const bNo = document.createElement('button'); bNo.type = 'button'; bNo.className = 'btn'; bNo.textContent = cancel;
    const bOk = document.createElement('button'); bOk.type = 'button'; bOk.className = 'btn pri' + (danger ? ' red' : ''); bOk.textContent = ok;
    bar.append(bNo, bOk); box.appendChild(bar); bg.appendChild(box); document.body.appendChild(bg);
    const done = v => { bg.remove(); document.removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(input !== null ? null : false); } if (e.key === 'Enter' && (inp ? document.activeElement === inp : true)) { e.preventDefault(); done(inp ? inp.value : true); } };
    document.addEventListener('keydown', key, true);
    bNo.onclick = () => done(input !== null ? null : false);
    bOk.onclick = () => done(inp ? inp.value : true);
    bg.addEventListener('mousedown', e => { if (e.target === bg) done(input !== null ? null : false); });
    setTimeout(() => (inp || bOk).focus(), 0);
  });
}
const askConfirm = (msg, o) => dialog(msg, o || {});
const askText = (msg, def = '') => dialog(msg, { input: String(def ?? '') });

/* ---------- 라이브러리 불러오기 ---------- */
const loaded = {};
function loadScript(u) {
  if (loaded[u]) return loaded[u];
  return loaded[u] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => { delete loaded[u]; rej(new Error('라이브러리를 불러오지 못했습니다: ' + u.split('/').pop())); }; document.head.appendChild(s); });
}

/* ---------- 파일 받기 ---------- */
async function saveFile(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (IS_ART) {
    let d = null; try { d = await claude.use('downloads'); } catch (e) { }
    if (!d) { notify('이 화면에서는 파일을 받을 수 없습니다. claude.ai에 로그인한 상태로 열어 주세요.', 'bad'); return false; }
    try { await d.save({ filename: name, data: blob }); return true; }
    catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && e.code === 'rate_limited') { notify('저장 창이 이미 열려 있습니다. 그 창을 먼저 닫아 주세요.', 'warn'); return false; }
      notify('파일을 받지 못했습니다 (' + ((e && (e.code || e.message)) || '알 수 없음') + ').', 'bad'); return false;
    }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

/* data: URL → Blob (fetch 없이) */
function dataUrlBlob(u) {
  const m = String(u).match(/^data:([^;,]+)?(;base64)?,(.*)$/s); if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  if (m[2]) { const bin = atob(m[3]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type }); }
  return new Blob([decodeURIComponent(m[3])], { type });
}
function blobDataUrl(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }

/* ---------- 공동 저장소 (claude.ai db) ---------- */
const COLLS = ['products', 'coas', 'issues'];
const ID_OK = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) o[k] = sortKeys(v[k]); }); return o; } return v; }
const stable = v => JSON.stringify(sortKeys(v));
const MODE_TEXT = {
  local: '', connecting: '공유 저장소 연결 중…', slow: '공유 저장소 응답 없음 · 이 브라우저에 임시 보관',
  shared: '공유 저장됨', readonly: '보기 전용 · 고친 내용은 저장되지 않음', alone: '로그인하지 않아 이 브라우저에만 저장', error: '공유 저장 실패'
};
const Cloud = {
  art: IS_ART, db: null, mode: IS_ART ? 'connecting' : 'local', synced: false,
  last: { products: new Map(), coas: new Map(), issues: new Map() }, got: {},
  busy: false, again: false, t: 0, hooks: {}, assets: undefined,
  shared() { return this.mode === 'shared' || this.mode === 'error'; },
  usesLocal() { return !IS_ART || this.mode === 'alone' || this.mode === 'slow'; },
  setMode(m, note) { this.mode = m; this.hooks.status && this.hooks.status(m, (MODE_TEXT[m] || '') + (note || '')); },
  async start(hooks) {
    this.hooks = hooks || {};
    if (!IS_ART) return;
    this.setMode('connecting');
    const timer = setTimeout(() => { if (!this.synced) { this.setMode('slow'); this.hooks.fallback && this.hooks.fallback(); } }, 10000);
    let db = null; try { db = await claude.use('db'); } catch (e) { }
    if (!db) { clearTimeout(timer); this.setMode('alone'); this.hooks.fallback && this.hooks.fallback(); return; }
    this.db = db;
    try { const u = await claude.use('user'); if (u) { const w = await u.can('data.write'); if (w === false) this.readonly = true; } } catch (e) { }
    COLLS.forEach(c => {
      try { db.collection(c).onSnapshot(s => this.onSnap(c, s, timer), e => this.onSubErr(c, e)); }
      catch (e) { this.onSubErr(c, e); }
    });
  },
  onSnap(coll, snap, timer) {
    const out = [];
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') { if (this.last[coll].has(id)) { this.last[coll].delete(id); out.push({ type: 'removed', id }); } return; }
      let data = JSON.parse(JSON.stringify(ch.doc.data() || {}));
      if (!data.id) data.id = id;
      try { data = (this.hooks.normalize ? this.hooks.normalize(coll, data) : data) || data; } catch (e) { console.warn(e); }
      const s = stable(data);
      if (this.last[coll].get(id) === s) return;
      this.last[coll].set(id, s);
      out.push({ type: 'upsert', id, data, s });
    });
    if (!snap.metadata.fromCache && !this.got[coll]) {
      this.got[coll] = true;
      if (COLLS.every(c => this.got[c]) && !this.synced) {
        this.synced = true; clearTimeout(timer);
        this.setMode(this.readonly ? 'readonly' : 'shared');
        this.hooks.firstSync && this.hooks.firstSync();
      }
    }
    if (out.length && this.hooks.apply) this.hooks.apply(coll, out);
  },
  onSubErr(coll, e) {
    console.warn('db', coll, e);
    if (!this.synced) { this.setMode('slow'); this.hooks.fallback && this.hooks.fallback(); }
    else this.setMode('error', ' — 새로고침해 주세요');
  },
  queue() {
    if (!this.db || !this.synced || this.readonly) return;
    clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 900);
  },
  async flush() {
    if (!this.db || !this.synced || this.readonly) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; let wrote = 0, failed = null;
    try {
      for (const coll of COLLS) {
        const items = (this.hooks.items && this.hooks.items(coll)) || [];
        const seen = new Set();
        for (const it of items) {
          if (!it || !ID_OK.test(String(it.id || ''))) continue;
          seen.add(it.id);
          const s = stable(it);
          if (this.last[coll].get(it.id) === s) continue;
          if (s.length > 250000) { failed = failed || { code: 'too_big', id: it.id }; continue; }
          const prev = this.last[coll].get(it.id);
          this.last[coll].set(it.id, s);
          try { await this.db.collection(coll).doc(it.id).set(JSON.parse(s)); wrote++; }
          catch (e) { if (prev === undefined) this.last[coll].delete(it.id); else this.last[coll].set(it.id, prev); failed = e; if (e && e.code === 'invalid_argument') { this.readonly = true; break; } }
        }
        if (this.readonly) break;
        for (const id of [...this.last[coll].keys()]) {
          if (seen.has(id)) continue;
          const prev = this.last[coll].get(id); this.last[coll].delete(id);
          try { await this.db.collection(coll).doc(id).delete(); wrote++; } catch (e) { this.last[coll].set(id, prev); failed = e; }
        }
      }
    } finally {
      this.busy = false;
      if (this.readonly) this.setMode('readonly');
      else if (failed) {
        const c = failed.code;
        this.setMode('error', c === 'too_big' ? ' — 문서 하나가 너무 큽니다 (256KB 한도)' : c === 'quota_exceeded' ? ' — 저장 공간이 찼습니다' : ' — 잠시 뒤 다시 저장합니다');
        if (c === 'unavailable' || c === 'resource_exhausted') setTimeout(() => this.queue(), 4000 + Math.random() * 3000);
      } else if (wrote) this.setMode('shared', ' ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (this.again) { this.again = false; this.flush(); }
    }
  },
  /* 첨부 쪽 그림을 공동 저장소에 올림 → 다른 사람도 미리보기·발행 때 볼 수 있음 */
  async assetsNs() { if (this.assets !== undefined) return this.assets; if (!IS_ART) return this.assets = null; try { this.assets = await claude.use('assets'); } catch (e) { this.assets = null; } return this.assets; },
  async uploadImages(dataUrls) {
    const a = await this.assetsNs(); if (!a || !dataUrls || !dataUrls.length) return null;
    const ids = [];
    for (const u of dataUrls) {
      const b = dataUrlBlob(u); if (!b) return null;
      try { const r = await a.upload(b, { type: b.type === 'image/png' ? 'image/png' : 'image/jpeg' }); ids.push(r.id); }
      catch (e) { console.warn('assets', e); notify('첨부 그림을 공동 저장소에 올리지 못했습니다 (' + (e.code || e.message) + '). 이 브라우저에서만 보입니다.', 'warn'); return null; }
    }
    return ids;
  }
};

/* 문서 HTML에 들어간 공동 저장소 그림을 파일 안에 넣음 (받은 파일을 따로 열어도 보이게) */
async function inlineImages(root) {
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) continue;
    try { const b = await (await fetch(src)).blob(); img.setAttribute('src', await blobDataUrl(b)); } catch (e) { }
  }
}

/* 미리보기 쪽들을 그림 PDF로 (공유 페이지는 인쇄 창을 못 엶) */
async function pagesToPdf(pages, name, progress) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < pages.length; i++) {
    progress && progress(i + 1, pages.length);
    const pg = pages[i]; const sh = pg.style.boxShadow, mg = pg.style.margin; pg.style.boxShadow = 'none'; pg.style.margin = '0';
    const cv = await window.html2canvas(pg, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
    pg.style.boxShadow = sh; pg.style.margin = mg;
    if (i) pdf.addPage('a4', 'p');
    pdf.addImage(cv.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    await new Promise(r => setTimeout(r, 0));
  }
  return saveFile(name, pdf.output('blob'), 'application/pdf');
}

Object.assign(window, { notify, askConfirm, askText, saveFile, Cloud, inlineImages, pagesToPdf, qLoadScript: loadScript, dataUrlBlob });
})();
