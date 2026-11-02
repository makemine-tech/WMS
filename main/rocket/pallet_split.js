/* 쿠팡 발주 엑셀 → 파렛트 분할 (packing.html 2-1)
 * 묶음 = 입고예정일 + 물류센터 + 출고지. 묶음마다 파렛트번호를 1번부터 매긴다.
 * 한 묶음 안에서 수량 많은 SKU 부터 기준 수량으로 나누고, 자투리는 합친다.
 * XRC·RC 센터는 1파렛트 1SKU 원칙(어기면 회송) — 다른 SKU 끼리는 절대 합치지 않는다. */
(function (root) {
  const EPS = 1e-9;
  const SUMMARY_SHEET = '출고지별요약';

  /* 발주현황 이름 → 1파렛트 기준 수량. 모르는 제품이면 null */
  function baseOf(label) {
    const s = String(label == null ? '' : label).replace(/\(.*?\)/g, '').replace(/\s+/g, '');
    if (/^(당쉼|검은콩|결명자)/.test(s)) return 72;
    if (/15$/.test(s)) return 125;
    if (/30$/.test(s)) return 72;
    if (/45$/.test(s)) return 54;
    return null;
  }

  function isOneSkuCenter(center) { return /rc/i.test(String(center || '')); }

  function normOrigin(s) {
    return String(s == null ? '' : s).replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
  }

  /* rows: [{ label, skuId, center, origin, eta, qty, ... }]
   * 반환: 묶음 배열 [{ center, origin, eta, oneSku, pallets: [{ no, fill, unknown, merged, lines: [{ row, qty }] }] }] */
  function planPallets(rows) {
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.eta}::${r.center}::${normOrigin(r.origin)}`;
      if (!groups.has(key)) groups.set(key, { center: r.center, origin: r.origin, eta: r.eta, oneSku: isOneSkuCenter(r.center), rows: [] });
      groups.get(key).rows.push(r);
    }
    const out = [...groups.values()];
    for (const g of out) {
      g.pallets = buildPallets(g.rows, g.oneSku);
      g.pallets.forEach((p, i) => { p.no = i + 1; });
    }
    return out;
  }

  function buildPallets(rows, oneSku) {
    /* 같은 SKU 는 발주번호가 달라도 한 제품 — 합계 큰 제품부터 (같으면 원본 순서) */
    const skus = new Map();
    for (const r of rows) {
      const k = String(r.skuId);
      if (!skus.has(k)) skus.set(k, { total: 0, rows: [] });
      const s = skus.get(k);
      s.total += r.qty;
      s.rows.push(r);
    }
    const ordered = [...skus.values()].sort((a, b) => b.total - a.total);

    const pallets = [];
    for (const s of ordered) {
      const rs = [...s.rows].sort((a, b) => b.qty - a.qty);
      let cur = null;
      for (const r of rs) {
        const base = baseOf(r.label);
        /* 기준에 없는 제품은 나누지 않고 1파렛트로 — 번호를 비우면 2-2 가 그 줄을 빼버린다 */
        if (!base) {
          pallets.push({ fill: 1, unknown: true, lines: [{ row: r, qty: r.qty }] });
          cur = null;
          continue;
        }
        let left = r.qty;
        while (left > 0) {
          if (!cur || cur.used >= cur.base || cur.base !== base) {
            cur = { fill: 0, used: 0, base, lines: [] };
            pallets.push(cur);
          }
          const take = Math.min(left, base - cur.used);
          cur.lines.push({ row: r, qty: take });
          cur.used += take;
          cur.fill = cur.used / base;
          left -= take;
        }
      }
    }
    return oneSku ? pallets : mergeRemainders(pallets);
  }

  /* 다른 제품 자투리 합치기 — 파렛트별 적재율 합이 100% 이하일 때만. 큰 자투리부터 앞 파렛트에 채운다 */
  function mergeRemainders(pallets) {
    const partial = pallets.filter(p => !p.unknown && p.fill < 1 - EPS).sort((a, b) => b.fill - a.fill);
    const hosts = [];
    const absorbed = new Set();
    for (const p of partial) {
      const host = hosts.find(h => h.fill + p.fill <= 1 + EPS);
      if (host) {
        host.lines.push(...p.lines);
        host.fill += p.fill;
        host.merged = true;
        absorbed.add(p);
      } else {
        hosts.push(p);
      }
    }
    return pallets.filter(p => !absorbed.has(p));
  }

  /* ---------- 엑셀 읽기·쓰기 (SheetJS) ---------- */

  function findCol(headers, names) {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  }

  function readRows(XLSX, ws) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
      headers[c] = cell ? String(cell.v).trim() : '';
    }
    const col = {
      label: findCol(headers, ['발주현황']),
      skuId: findCol(headers, ['SKU ID', 'SKU']),
      center: findCol(headers, ['물류센터']),
      eta: findCol(headers, ['입고예정일']),
      order: findCol(headers, ['발주수량']),
      qty: findCol(headers, ['확정수량']),
      box: findCol(headers, ['박스수']),
      origin: findCol(headers, ['출고지', '출고 지', '출고장']),
      palletT: findCol(headers, ['파렛트수', '팔레트수']),
      palletN: findCol(headers, ['파렛트번호', '팔레트번호']),
    };
    const need = { label: '발주현황', skuId: 'SKU ID', center: '물류센터', eta: '입고예정일', qty: '확정수량' };
    const missing = Object.keys(need).filter(k => col[k] === -1).map(k => need[k]);
    if (missing.length) throw new Error('엑셀에서 다음 열을 찾을 수 없습니다: ' + missing.join(', '));

    const val = (r, c) => {
      if (c === -1) return '';
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      return cell ? cell.v : '';
    };
    const rows = [];
    const warnings = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      let filled = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== '' && cell.v != null) { filled = true; break; }
      }
      if (!filled) continue;
      const line = r + 1;
      const center = String(val(r, col.center)).trim();
      const label = String(val(r, col.label)).trim();
      const qty = Number(val(r, col.qty));
      if (!center) { warnings.push(`${line}행: 물류센터가 비어 있어 뺐습니다.`); continue; }
      if (!(qty > 0)) { warnings.push(`${line}행 ${center} ${label}: 확정수량이 없어 뺐습니다.`); continue; }
      const order = col.order === -1 ? qty : Number(val(r, col.order));
      const box = col.box === -1 ? qty : Number(val(r, col.box));
      if (order !== qty || box !== qty) {
        warnings.push(`${line}행 ${center} ${label}: 발주 ${order} · 확정 ${qty} · 박스 ${box} 가 달라 확정수량 기준으로 나눴습니다.`);
      }
      const origin = String(val(r, col.origin)).trim();
      if (!origin) warnings.push(`${line}행 ${center} ${label}: 출고지가 비어 있습니다.`);
      if (!baseOf(label)) warnings.push(`${line}행 ${center} '${label}': 기준에 없는 제품이라 나누지 않고 1파렛트로 뒀습니다.`);
      rows.push({ srcRow: r, label, skuId: String(val(r, col.skuId)).trim(), center, origin, eta: val(r, col.eta), qty });
    }
    return { rows, headers, col, range, warnings };
  }

  function etaText(XLSX, v) {
    if (typeof v === 'number') return XLSX.SSF.format('yyyy-mm-dd', v);
    return String(v == null ? '' : v).trim();
  }

  function sortGroups(XLSX, groups) {
    return groups.sort((a, b) => {
      const ea = etaText(XLSX, a.eta), eb = etaText(XLSX, b.eta);
      if (ea !== eb) return ea < eb ? -1 : 1;
      const c = a.center.localeCompare(b.center, 'ko');
      if (c !== 0) return c;
      return String(a.origin).localeCompare(String(b.origin), 'ko');
    });
  }

  function summarize(XLSX, groups) {
    return groups.map(g => {
      const lines = g.pallets.flatMap(p => p.lines);
      const qty = lines.reduce((s, l) => s + l.qty, 0);
      const merged = g.pallets.filter(p => p.merged).map(p =>
        `${p.no}번: ` + p.lines.map(l => `${l.row.label} ${l.qty}`).join(' + '));
      return {
        eta: etaText(XLSX, g.eta), origin: g.origin, center: g.center, oneSku: g.oneSku,
        pallets: g.pallets.length, boxes: qty, qty, merged,
        unknown: g.pallets.some(p => p.unknown),
      };
    });
  }

  /* 엑셀 칸 너비 기준 글자 수 — 한글은 2칸 */
  function textWidth(v) {
    return [...String(v == null ? '' : v)].reduce((t, ch) => t + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  function buildSheet(XLSX, ws, parsed, groups) {
    const { col, range } = parsed;
    const out = { '!ref': ws['!ref'] };
    /* 제목줄 그대로, 파렛트 열이 없으면 맨 뒤에 붙인다 */
    let lastCol = range.e.c;
    const palletT = col.palletT !== -1 ? col.palletT : ++lastCol;
    const palletN = col.palletN !== -1 ? col.palletN : ++lastCol;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const a = XLSX.utils.encode_cell({ r: range.s.r, c });
      if (ws[a]) out[a] = { ...ws[a] };
    }
    if (col.palletT === -1) out[XLSX.utils.encode_cell({ r: range.s.r, c: palletT })] = { t: 's', v: '파렛트수' };
    if (col.palletN === -1) out[XLSX.utils.encode_cell({ r: range.s.r, c: palletN })] = { t: 's', v: '파렛트번호' };

    const dateCols = new Set();
    let r = range.s.r + 1;
    for (const g of groups) {
      for (const p of g.pallets) {
        for (const l of p.lines) {
          for (let c = range.s.c; c <= range.e.c; c++) {
            const src = ws[XLSX.utils.encode_cell({ r: l.row.srcRow, c })];
            if (!src) continue;
            const cell = { ...src };
            delete cell.w;
            if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) dateCols.add(c);
            /* 바코드가 2.88E+13 으로 보이지 않게 */
            if (cell.t === 'n' && cell.v >= 1e11 && (!cell.z || cell.z === 'General')) cell.z = '0';
            out[XLSX.utils.encode_cell({ r, c })] = cell;
          }
          for (const c of [col.order, col.qty, col.box]) {
            if (c !== -1) out[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: l.qty };
          }
          out[XLSX.utils.encode_cell({ r, c: palletT })] = { t: 'n', v: g.pallets.length };
          out[XLSX.utils.encode_cell({ r, c: palletN })] = { t: 'n', v: p.no };
          r++;
        }
      }
    }
    out['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: r - 1, c: lastCol } });
    /* 내용에 맞춰 모든 열 너비를 정한다 — 너비 없는 열은 엑셀에서 숨김으로 보이고, 좁으면 ##### 가 된다 */
    const cols = [];
    for (let c = range.s.c; c <= lastCol; c++) {
      let w = 6;
      for (let y = range.s.r; y < r; y++) {
        const cell = out[XLSX.utils.encode_cell({ r: y, c })];
        if (cell) w = Math.max(w, textWidth(cell.v));
      }
      cols[c] = { wch: dateCols.has(c) ? 17 : Math.min(w + 2, 70) };
    }
    out['!cols'] = cols;
    return out;
  }

  function buildSummarySheet(XLSX, summary, warnings) {
    const aoa = [['입고예정일', '출고지', '물류센터', '구분', '파렛트수', '박스수', '납품수량', '합친 파렛트']];
    for (const s of summary) {
      aoa.push([s.eta, s.origin, s.center, s.oneSku ? '1파렛트 1SKU' : '일반', s.pallets, s.boxes, s.qty, s.merged.join(' / ')]);
    }
    aoa.push(['합계', '', '', '',
      summary.reduce((t, s) => t + s.pallets, 0),
      summary.reduce((t, s) => t + s.boxes, 0),
      summary.reduce((t, s) => t + s.qty, 0), '']);
    if (warnings.length) {
      aoa.push([]);
      aoa.push(['확인 필요']);
      warnings.forEach(w => aoa.push([w]));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 60 }];
    return ws;
  }

  /* 파일 내용(ArrayBuffer) → { workbook, summary, warnings, totals } */
  function splitWorkbook(XLSX, data) {
    const src = XLSX.read(data, { type: 'array', cellNF: true });
    const name = src.SheetNames[0];
    const ws = src.Sheets[name];
    if (!ws || !ws['!ref']) throw new Error('데이터가 비어 있습니다.');
    const parsed = readRows(XLSX, ws);
    if (!parsed.rows.length) throw new Error('나눌 수 있는 줄이 없습니다.');

    const groups = sortGroups(XLSX, planPallets(parsed.rows));
    const inQty = parsed.rows.reduce((s, r) => s + r.qty, 0);
    const outQty = groups.reduce((s, g) => s + g.pallets.reduce((t, p) => t + p.lines.reduce((u, l) => u + l.qty, 0), 0), 0);
    if (inQty !== outQty) throw new Error(`수량 합계가 맞지 않습니다 (원본 ${inQty} / 분할 ${outQty}).`);

    const summary = summarize(XLSX, groups);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet(XLSX, ws, parsed, groups), name);
    XLSX.utils.book_append_sheet(wb, buildSummarySheet(XLSX, summary, parsed.warnings), SUMMARY_SHEET);
    return {
      workbook: wb, summary, warnings: parsed.warnings,
      totals: { pallets: summary.reduce((t, s) => t + s.pallets, 0), qty: inQty, rows: parsed.rows.length },
    };
  }

  const api = { SUMMARY_SHEET, baseOf, isOneSkuCenter, planPallets, splitWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PalletSplit = api;
})(this);
