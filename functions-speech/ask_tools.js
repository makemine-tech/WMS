/* ===========================================================
   창고 AI 질문 — 조회 도구 (읽기 전용)

   AI 가 직접 세거나 추측하지 않도록, 숫자는 전부 여기서 계산해 넘긴다.
   "M열 빈칸 몇 개" 같은 질문을 AI 가 목록을 보고 세면 틀리기 쉽다.

   창고 구조 (wms.html / wms_voice.html 과 같은 규칙):
     cells["행-열"] = { type:'rack'|'shelf'|…, divR, divC, slots:{"sr-sc": {name, exp, qty}} }
     유닛 이름 = 열 알파벳 + '-' + (행+1)   예) 0-12 → M-1
     층 = divR - sr   (1층 = 칸 분할의 맨 아래 줄)
     유통기한 exp = 'YYMMDD' 문자열
=========================================================== */

function colName(c) {
  let s = String.fromCharCode(65 + (c % 26));
  if (c >= 26) s = String.fromCharCode(65 + Math.floor(c / 26) - 1) + s;
  return s;
}
function colIndex(name) {
  const s = String(name || '').trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(s)) return -1;
  return s.length === 1 ? s.charCodeAt(0) - 65 : (s.charCodeAt(0) - 64) * 26 + (s.charCodeAt(1) - 65);
}
function fmtExp(e) {
  const d = String(e || '').replace(/\D/g, '');
  if (d.length === 6) return '20' + d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4, 6);
  if (d.length === 8) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  return e ? String(e) : '';
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s·.,_\-()]/g, '');

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* 창고 데이터 → 칸(자리) 목록. 적재 가능한 자리만 (rack/shelf) */
function buildIndex(wh) {
  const cells = (wh && wh.cells) || {};
  const positions = [];
  Object.keys(cells).forEach((key) => {
    const c = cells[key];
    if (!c || (c.type !== 'rack' && c.type !== 'shelf')) return;
    const [r, cc] = key.split('-').map(Number);
    const dR = +c.divR || 1, dC = +c.divC || 1;
    const col = colName(cc), unit = col + '-' + (r + 1);
    for (let sr = 0; sr < dR; sr++) {
      for (let sc = 0; sc < dC; sc++) {
        const s = (c.slots || {})[sr + '-' + sc] || null;
        const floor = dR - sr;
        positions.push({
          unit, col, row: r + 1, floor, levels: dR, kind: c.type === 'rack' ? '랙' : '보관',
          loc: unit + ' ' + floor + '층' + (dC > 1 ? '(' + (sc + 1) + '번째)' : ''),
          item: s && s.name ? { name: String(s.name), exp: String(s.exp || ''), qty: +s.qty || 0 } : null,
        });
      }
    }
  });
  positions.sort((a, b) => (a.col < b.col ? -1 : a.col > b.col ? 1 : 0) || a.row - b.row || a.floor - b.floor);
  const names = [...new Set(positions.filter((p) => p.item).map((p) => p.item.name))].sort();
  return { name: (wh && wh.name) || '', rows: +(wh && wh.rows) || 0, cols: +(wh && wh.cols) || 0, positions, names };
}

/* 말한 상품명 → 창고에 있는 상품명들. 띄어쓰기·대소문자 무시, 없으면 부분일치, 그래도 없으면 비슷한 이름 */
function resolveProduct(idx, q) {
  const nq = norm(q);
  if (!nq) return { names: [], note: '상품명이 비었어요' };
  const exact = idx.names.filter((n) => norm(n) === nq);
  if (exact.length) return { names: exact };
  const part = idx.names.filter((n) => norm(n).includes(nq) || nq.includes(norm(n)));
  if (part.length) return { names: part, note: part.length > 1 ? '여러 상품이 걸림 — 필요하면 사용자에게 어느 것인지 확인' : '' };
  const near = idx.names.map((n) => ({ n, d: lev(norm(n), nq) })).filter((x) => x.d <= Math.max(1, Math.floor(nq.length / 3)))
    .sort((a, b) => a.d - b.d).map((x) => x.n);
  if (near.length) return { names: near.slice(0, 5), note: '정확히 같은 이름은 없고 비슷한 이름 — 사용자에게 확인 권장' };
  return { names: [], note: '창고에 그런 상품이 없어요', similar: idx.names.slice(0, 40) };
}

function productStock(idx, { product }) {
  const res = resolveProduct(idx, product);
  if (!res.names.length) return res;
  const out = res.names.map((name) => {
    const ps = idx.positions.filter((p) => p.item && p.item.name === name);
    const byExp = {};
    ps.forEach((p) => {
      const k = p.item.exp || '';
      const g = byExp[k] || (byExp[k] = { exp: fmtExp(k) || '유통기한 없음', pallets: 0, qty: 0, locations: [] });
      g.pallets++; g.qty += p.item.qty; g.locations.push(p.loc);
    });
    const groups = Object.keys(byExp).sort((a, b) => (a || '99999999').localeCompare(b || '99999999')).map((k) => {
      const g = byExp[k];
      if (g.locations.length > 40) { g.moreLocations = g.locations.length - 40; g.locations = g.locations.slice(0, 40); }
      return g;
    });
    return { product: name, totalPallets: ps.length, totalQty: ps.reduce((a, p) => a + p.item.qty, 0),
      byExpiry_soonestFirst: groups };
  });
  return { matched: out, note: res.note || '' };
}

function filterPositions(idx, { column, unit }) {
  let ps = idx.positions;
  if (unit) {
    const u = String(unit).toUpperCase().replace(/\s/g, '').replace(/^([A-Z]{1,2})(\d)/, '$1-$2');
    ps = ps.filter((p) => p.unit === u);
  } else if (column) {
    const c = String(column).toUpperCase().replace(/[^A-Z]/g, '');
    ps = ps.filter((p) => p.col === c);
  }
  return ps;
}

function emptyPositions(idx, { column, unit, kind }) {
  let ps = filterPositions(idx, { column, unit });
  if (kind === '랙' || kind === '보관') ps = ps.filter((p) => p.kind === kind);
  const empty = ps.filter((p) => !p.item);
  const byCol = {};
  ps.forEach((p) => {
    const g = byCol[p.col] || (byCol[p.col] = { column: p.col, positions: 0, empty: 0 });
    g.positions++; if (!p.item) g.empty++;
  });
  return {
    scope: unit ? '유닛 ' + unit : column ? String(column).toUpperCase() + '열' : '창고 전체',
    totalPositions: ps.length, emptyPositions: empty.length, filled: ps.length - empty.length,
    byColumn: (unit || column) ? undefined : Object.values(byCol),
    emptyList: empty.slice(0, 80).map((p) => p.loc + ' (' + p.kind + ')'),
    emptyListTruncated: empty.length > 80 ? empty.length - 80 : 0,
  };
}

function unitContents(idx, { unit, column }) {
  const ps = filterPositions(idx, { unit, column });
  if (!ps.length) return { error: (unit || column) + ' 에 적재 가능한 칸이 없어요 (없는 유닛이거나 통로·빈공간)' };
  const lines = ps.map((p) => p.loc + ': ' + (p.item ? p.item.name + ' · ' + (fmtExp(p.item.exp) || '유통기한 없음') + ' · ' + p.item.qty + '개' : '비어 있음'));
  return { scope: unit || column, positions: ps.length, filled: ps.filter((p) => p.item).length, lines: lines.slice(0, 200) };
}

function expiring(idx, { before, product }) {
  const lim = String(before || '').replace(/\D/g, '');
  if (lim.length !== 8) return { error: 'before 는 YYYY-MM-DD 형식이어야 해요' };
  const names = product ? resolveProduct(idx, product).names : null;
  const groups = {};
  idx.positions.forEach((p) => {
    if (!p.item || !p.item.exp) return;
    if (names && names.indexOf(p.item.name) < 0) return;
    const e = fmtExp(p.item.exp).replace(/\D/g, '');
    if (e.length !== 8 || e > lim) return;
    const k = p.item.name + '|' + e;
    const g = groups[k] || (groups[k] = { product: p.item.name, exp: fmtExp(p.item.exp), pallets: 0, qty: 0, locations: [] });
    g.pallets++; g.qty += p.item.qty; if (g.locations.length < 20) g.locations.push(p.loc);
  });
  const list = Object.values(groups).sort((a, b) => a.exp.localeCompare(b.exp));
  return { before: fmtExp(lim), groups: list.slice(0, 60), totalPallets: list.reduce((a, g) => a + g.pallets, 0) };
}

function summary(idx) {
  const byProd = {};
  idx.positions.forEach((p) => {
    if (!p.item) return;
    const g = byProd[p.item.name] || (byProd[p.item.name] = { product: p.item.name, pallets: 0, qty: 0 });
    g.pallets++; g.qty += p.item.qty;
  });
  const filled = idx.positions.filter((p) => p.item).length;
  return {
    warehouse: idx.name, grid: idx.cols + '열 × ' + idx.rows + '행', columns: idx.cols ? colName(0) + '~' + colName(idx.cols - 1) : '',
    positions: idx.positions.length, filledPallets: filled, emptyPositions: idx.positions.length - filled,
    products: Object.values(byProd).sort((a, b) => b.pallets - a.pallets),
  };
}

function pendingLists(wh) {
  const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : x ? Object.values(x).filter(Boolean) : []);
  const cnt = (list, keyFn) => {
    const m = {};
    list.forEach((it) => { const k = keyFn(it); const g = m[k] || (m[k] = { key: k, pallets: 0 }); g.pallets++; });
    return Object.values(m);
  };
  return {
    출고대기_창고화면: cnt(arr(wh.pendOut), (x) => (x.date ? x.date + '일 ' : '') + (x.loc || '') + ' · ' + ((x.slot && x.slot.name) || '?')),
    출고대기_음성: arr(wh.voiceOut).map((x) => ({ product: x.product, exp: fmtExp(x.exp), total: +x.total || 0, left: +x.left || 0 })),
    입고대기: cnt(arr(wh.inQ), (x) => (x.name || '?') + ' · ' + (fmtExp(x.exp) || '유통기한 없음') + ' · ' + (+x.qty || 0) + '개'),
  };
}

function txHistory(logs, { from, to, type, product }) {
  const f = String(from || '').slice(0, 10), t = String(to || from || '').slice(0, 10);
  const nq = product ? norm(product) : '';
  const rows = logs.filter((x) => x && x.date && x.date >= f && x.date <= t
    && (!type || x.type === type) && (!nq || norm(x.name).includes(nq)));
  const m = {};
  rows.forEach((x) => {
    const k = x.date + '|' + x.type + '|' + x.name + '|' + (x.exp || '');
    const g = m[k] || (m[k] = { date: x.date, type: x.type === 'in' ? '입고' : x.type === 'out' ? '출고' : x.type, product: x.name, exp: fmtExp(x.exp), pallets: 0, qty: 0 });
    g.pallets += +x.pallets || 0; g.qty += +x.qty || 0;
  });
  const list = Object.values(m).sort((a, b) => a.date.localeCompare(b.date));
  const tot = (tp) => list.filter((g) => g.type === tp).reduce((a, g) => a + g.pallets, 0);
  return { from: f, to: t, 입고파렛트: tot('입고'), 출고파렛트: tot('출고'), rows: list.slice(0, 120), truncated: Math.max(0, list.length - 120) };
}

module.exports = { buildIndex, resolveProduct, productStock, emptyPositions, unitContents, expiring, summary, pendingLists, txHistory, fmtExp, colName, colIndex };
