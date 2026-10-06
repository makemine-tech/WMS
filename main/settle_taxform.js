/* ============================================================
   세금계산서 일괄발행 양식 (대표님 2026-10-06: 「표본 양식이라 바뀌면 안 되고, 첨부 양식에 그대로」)
   홈택스 엑셀 업로드 양식(.xls, 엑셀 97-2003)을 그대로 두고 7행부터 데이터 칸 값만 넣는다.
     - SheetJS 로 .xls 를 새로 쓰면 색·칸 모양이 사라지고 엑셀이 「보호를 위해 열지 않음」으로 막음 → 원본 파일의 BIFF 기록을 직접 고침
     - 고치는 것: 첫 시트의 칸 표(ROW·칸·DBCELL) · INDEX · DIMENSIONS · 공유 문자열표(SST·EXTSST) · 시트 위치(BOUNDSHEET)
     - 나머지(글꼴·색·테두리·열 너비·병합·안내 시트)는 원본 바이트 그대로
   쓰는 법: SETTLE_TAXFORM.build(양식 bytes, [[칸0, 칸1, … 칸58], …]) → Uint8Array(.xls)
            칸 값: 문자열 = 글자 칸, 숫자 = 숫자 칸, '' / null = 빈 칸 (모양은 양식 7행 그 열의 모양)
   쓰는 전역: XLSX (XLSX.CFB)
============================================================ */
var SETTLE_TAXFORM = (function(){
  'use strict';
  var T = { BOF: 0x809, EOF: 0x0a, INDEX: 0x20b, DIM: 0x200, ROW: 0x208, DBCELL: 0xd7, SST: 0xfc, EXTSST: 0xff, CONT: 0x3c, BOUND: 0x85, LABELSST: 0xfd, NUMBER: 0x203, BLANK: 0x201, MULBLANK: 0xbe, DEFCOLW: 0x55 };
  var CELL = {}; [0xfd, 0x203, 0x201, 0xbe, 0x27e, 0xbd, 0x06, 0x207, 0x205, 0x204, 0xd6].forEach(function(t){ CELL[t] = 1; });
  function u16(b, p){ return b[p] | (b[p + 1] << 8); }
  function u32(b, p){ return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; }
  function w16(a, v){ a.push(v & 255, (v >> 8) & 255); }
  function w32(a, v){ a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
  function recs(b){ var out = [], p = 0; while (p + 4 <= b.length){ var t = u16(b, p), l = u16(b, p + 2); out.push({ t: t, d: b.subarray(p + 4, p + 4 + l) }); p += 4 + l; } return out; }

  /* 공유 문자열표 읽기 — SST + CONTINUE (글자 도중에 끊기면 다음 조각 첫 바이트 = 새 grbit) */
  function readSST(parts){
    var pi = 0, p = 8, cur = parts[0], out = [], n = u32(parts[0], 4);
    var need = function(k){ if (p + k > cur.length){ pi++; cur = parts[pi]; p = 0; } };
    var byte = function(){ need(1); return cur[p++]; };
    var w = function(){ need(2); var v = u16(cur, p); p += 2; return v; };
    var d = function(){ need(4); var v = u32(cur, p); p += 4; return v; };
    var take = function(k){ var a = []; while (k > 0){ if (p >= cur.length){ pi++; cur = parts[pi]; p = 0; } var s = Math.min(k, cur.length - p); for (var j = 0; j < s; j++) a.push(cur[p + j]); p += s; k -= s; } return a; };
    for (var i = 0; i < n; i++){
      var cch = w(), g = byte(), hi = g & 1, rich = g & 8, ext = g & 4, runs = rich ? w() : 0, cbExt = ext ? d() : 0, s = '';
      while (s.length < cch){
        if (p >= cur.length){ pi++; cur = parts[pi]; p = 0; hi = cur[p++] & 1; }
        if (hi){ s += String.fromCharCode(u16(cur, p)); p += 2; } else { s += String.fromCharCode(cur[p]); p += 1; }
      }
      out.push({ s: s, runs: runs ? take(runs * 4) : null, ext: cbExt ? take(cbExt) : null });   /* 글자색 섞인 칸(빨간 「(01:일반, 02:영세율)」) 서식 그대로 */
    }
    return out;
  }
  /* 공유 문자열표 쓰기 → { recs:[SST, CONTINUE…], pos:[[조각 번호, 조각 안 위치] 문자열마다] } */
  function writeSST(strs, total){
    var MAX = 8224, pieces = [[]], pos = [], cur = pieces[0];
    w32(cur, total); w32(cur, strs.length);
    strs.forEach(function(o){
      var s = o.s, runs = o.runs, ext = o.ext, hi = /[^\x00-\xff]/.test(s) ? 1 : 0, cw = hi ? 2 : 1, head = 3 + (runs ? 2 : 0) + (ext ? 4 : 0);
      if (cur.length + head + cw > MAX){ cur = []; pieces.push(cur); }   /* 머리 + 첫 글자는 같은 조각에 */
      pos.push([pieces.length - 1, cur.length]);
      w16(cur, s.length); cur.push(hi | (runs ? 8 : 0) | (ext ? 4 : 0));
      if (runs) w16(cur, runs.length / 4); if (ext) w32(cur, ext.length);
      for (var i = 0; i < s.length; i++){
        if (cur.length + cw > MAX){ cur = [hi]; pieces.push(cur); }
        var c = s.charCodeAt(i); if (hi) w16(cur, c); else cur.push(c);
      }
      [runs, ext].forEach(function(arr){ (arr || []).forEach(function(bt){ if (cur.length + 1 > MAX){ cur = []; pieces.push(cur); } cur.push(bt); }); });
    });
    return { pieces: pieces, pos: pos };
  }
  function rec(t, data){ var a = []; w16(a, t); w16(a, data.length); for (var i = 0; i < data.length; i++) a.push(data[i]); return a; }

  function build(tplBytes, data, opt){
    opt = opt || {};
    var cfb = XLSX.CFB.read(tplBytes, { type: tplBytes instanceof ArrayBuffer ? 'array' : (typeof Buffer !== 'undefined' && Buffer.isBuffer(tplBytes) ? 'buffer' : 'array') });
    var ent = XLSX.CFB.find(cfb, 'Workbook') || XLSX.CFB.find(cfb, 'Book');
    var B = ent.content instanceof Uint8Array ? ent.content : new Uint8Array(ent.content);
    var R = recs(B);
    /* 묶음: 전역 / 시트들 (BOF~EOF) */
    var subs = [], cur = null;
    R.forEach(function(r){ if (r.t === T.BOF){ cur = []; subs.push(cur); } cur.push(r); });
    var glob = subs[0], sheets = subs.slice(1), S0 = sheets[0];
    /* 문자열표 */
    var iS = -1; glob.forEach(function(r, i){ if (r.t === T.SST) iS = i; });
    var parts = [glob[iS].d]; for (var k = iS + 1; k < glob.length && glob[k].t === T.CONT; k++) parts.push(glob[k].d);
    var strs = readSST(parts), sIdx = {};
    var useStr = function(o){ if (!o || typeof o !== 'object') o = { s: String(o) }; var k = o.s + '\u0001' + (o.runs || '') + '\u0001' + (o.ext || ''); if (sIdx[k] == null){ sIdx[k] = strs2.length; strs2.push(o); } return sIdx[k]; };
    var strs2 = [], total = 0;
    /* 시트마다 칸 표 읽기 → 모형 { rows: {r: ROW data}, cells: {r: [{c, t, d}]} } (문자열은 다시 번호 매김) */
    function model(sh){
      var M = { pre: [], post: [], rows: {}, cells: {}, iIdx: -1, iDim: -1 }, phase = 0;
      sh.forEach(function(r){
        var isTbl = r.t === T.ROW || r.t === T.DBCELL || CELL[r.t];
        if (phase === 0 && isTbl) phase = 1;
        if (phase === 1 && !isTbl) phase = 2;
        if (phase === 0){ if (r.t === T.INDEX) M.iIdx = M.pre.length; if (r.t === T.DIM) M.iDim = M.pre.length; M.pre.push(r); }
        else if (phase === 1){
          if (r.t === T.ROW) M.rows[u16(r.d, 0)] = new Uint8Array(r.d);
          else if (CELL[r.t]){ var rw = u16(r.d, 0), c = u16(r.d, 2), d = new Uint8Array(r.d);
            (M.cells[rw] = M.cells[rw] || []).push({ c: c, t: r.t, d: d, s: r.t === T.LABELSST ? strs[u32(r.d, 6)] : null }); }
        } else M.post.push(r);
      });
      return M;
    }
    var Ms = sheets.map(model), M0 = Ms[0];
    /* 양식 7행(0부터 6) 각 열 모양(XF) · ROW 모양 */
    var FIRST = opt.firstRow != null ? opt.firstRow : 6, NC = opt.cols || 59, xf = [], rowTpl = M0.rows[FIRST + 1] || M0.rows[FIRST] || M0.rows[FIRST - 1];   /* 데이터 둘째 줄 = 보통 높이 */
    if (!opt.xf){
      (M0.cells[FIRST] || []).forEach(function(cl){
        if (cl.t === T.MULBLANK){ var last = u16(cl.d, cl.d.length - 2); for (var c = cl.c, j = 0; c <= last; c++, j++) xf[c] = u16(cl.d, 4 + j * 2); }
        else xf[cl.c] = u16(cl.d, 4);
      });
    } else xf = opt.xf.slice();
    for (var c0 = 0; c0 < NC; c0++) if (xf[c0] == null) xf[c0] = xf[c0 - 1] != null ? xf[c0 - 1] : 15;
    /* 7행부터 지우고 새 데이터 */
    if (!opt.keep) Object.keys(M0.cells).forEach(function(r){ if (+r >= FIRST){ delete M0.cells[r]; delete M0.rows[r]; } });
    (opt.keep ? [] : data || []).forEach(function(vals, i){
      var r = FIRST + i, list = [];
      for (var c = 0; c < NC; c++){
        var v = vals[c], x = xf[c], d;
        if (v == null || v === ''){ d = []; w16(d, r); w16(d, c); w16(d, x); list.push({ c: c, t: T.BLANK, d: d }); }
        else if (typeof v === 'number'){ d = []; w16(d, r); w16(d, c); w16(d, x); var f = new Uint8Array(new Float64Array([v]).buffer); for (var q = 0; q < 8; q++) d.push(f[q]); list.push({ c: c, t: T.NUMBER, d: d }); }
        else list.push({ c: c, t: T.LABELSST, d: null, s: String(v), r: r, x: x });
      }
      M0.cells[r] = list;
      var rd = new Uint8Array(rowTpl || [0, 0, 0, 0, NC, 0, 0xff, 0, 0, 0, 0, 0, 0, 1, 0x0f, 0]); rd[0] = r & 255; rd[1] = (r >> 8) & 255; rd[2] = 0; rd[3] = 0; rd[4] = NC & 255; rd[5] = NC >> 8;
      M0.rows[r] = rd;
    });
    /* 문자열 번호 다시 매기기 (쓰는 것만 — 원본 8월 업체 이름 같은 남은 문자열은 버림) */
    Ms.forEach(function(M){ Object.keys(M.cells).forEach(function(r){ M.cells[r].forEach(function(cl){ if (cl.t !== T.LABELSST) return; total++;
      var id = useStr(cl.s), d = cl.d ? Array.prototype.slice.call(cl.d, 0, 6) : (function(){ var a = []; w16(a, cl.r); w16(a, cl.c); w16(a, cl.x); return a; })();
      w32(d, id); cl.d = d; }); }); });
    var SST = writeSST(strs2, total);

    /* 시트 칸 표 쓰기 → 바이트 + INDEX 안 DBCELL 위치(시트 시작 기준) */
    function sheetBytes(M){
      var out = [], rowsK = Object.keys(M.rows).map(Number).concat(Object.keys(M.cells).map(Number)).filter(function(v, i, a){ return a.indexOf(v) === i; }).sort(function(a, b){ return a - b; });
      var preIdx = -1, preDim = -1, dbPos = [], defcolw = -1;
      M.pre.forEach(function(r, i){
        if (i === M.iIdx){ preIdx = out.length; var n = Math.ceil(rowsK.length / 32), a = []; w32(a, 0); w32(a, rowsK.length ? rowsK[0] : 0); w32(a, rowsK.length ? rowsK[rowsK.length - 1] + 1 : 0); w32(a, 0); for (var k = 0; k < n; k++) w32(a, 0); out.push.apply(out, rec(T.INDEX, a)); return; }
        if (r.t === T.DEFCOLW) defcolw = out.length;
        if (i === M.iDim){ preDim = out.length; var mc = 0; rowsK.forEach(function(rw){ (M.cells[rw] || []).forEach(function(cl){ var last = cl.t === T.MULBLANK || cl.t === 0xbd ? u16(cl.d, cl.d.length - 2) : cl.c; if (last + 1 > mc) mc = last + 1; }); });
          var a2 = []; w32(a2, rowsK.length ? rowsK[0] : 0); w32(a2, rowsK.length ? rowsK[rowsK.length - 1] + 1 : 0); w16(a2, 0); w16(a2, mc || u16(r.d, 10)); w16(a2, 0); out.push.apply(out, rec(T.DIM, a2)); return; }
        out.push.apply(out, rec(r.t, r.d));
      });
      for (var b0 = 0; b0 < rowsK.length; b0 += 32){
        var blk = rowsK.slice(b0, b0 + 32), firstRow = out.length;
        blk.forEach(function(rw){ var rd = M.rows[rw]; if (!rd){ rd = new Uint8Array([rw & 255, rw >> 8, 0, 0, 0, 0, 0xff, 0, 0, 0, 0, 0, 0, 1, 0x0f, 0]); } out.push.apply(out, rec(T.ROW, rd)); });
        var cellStart = [], afterRows = out.length;
        blk.forEach(function(rw){ cellStart.push(out.length); (M.cells[rw] || []).sort(function(a, b){ return a.c - b.c; }).forEach(function(cl){ out.push.apply(out, rec(cl.t, cl.d)); }); });
        var db = []; w32(db, out.length - firstRow);
        /* rgdb: 첫 값 = 둘째 ROW 시작 → 첫 칸 / 나머지 = 앞 줄 첫 칸 → 이 줄 첫 칸 */
        blk.forEach(function(rw, k){ w16(db, k === 0 ? cellStart[0] - (firstRow + 20) : cellStart[k] - cellStart[k - 1]); });
        dbPos.push(out.length); out.push.apply(out, rec(T.DBCELL, db));
      }
      M.post.forEach(function(r){ out.push.apply(out, rec(r.t, r.d)); });
      return { b: out, preIdx: preIdx, dbPos: dbPos, defcolw: defcolw, rowsN: rowsK.length };
    }
    var SB = Ms.map(sheetBytes);

    /* 전역 다시 쓰기: SST·CONTINUE·EXTSST 갈아끼우고, BOUNDSHEET 위치는 나중에 채움 */
    var G = [], boundAt = [], sstAt = [];
    for (var i = 0; i < glob.length; i++){
      var r = glob[i];
      if (r.t === T.SST){
        SST.pieces.forEach(function(pc, k){ sstAt.push(G.length); G.push.apply(G, rec(k ? T.CONT : T.SST, pc)); });
        while (i + 1 < glob.length && glob[i + 1].t === T.CONT) i++;
        /* EXTSST: 8개마다 그 문자열의 절대 위치·조각 안 위치 */
        var dsst = Math.max(8, Math.ceil(strs2.length / 128)), ex = []; w16(ex, dsst);
        for (var s = 0; s < strs2.length; s += dsst){ var ps = SST.pos[s]; w32(ex, 0); w16(ex, 4 + ps[1]); w16(ex, 0); ex._p = ex._p || []; ex._p.push([ex.length - 8, sstAt[ps[0]] + 4 + ps[1]]); }
        var exAt = G.length; G.push.apply(G, rec(T.EXTSST, ex)); (ex._p || []).forEach(function(q){ var v = q[1], o = exAt + 4 + q[0]; G[o] = v & 255; G[o + 1] = (v >>> 8) & 255; G[o + 2] = (v >>> 16) & 255; G[o + 3] = (v >>> 24) & 255; });
        continue;
      }
      if (r.t === T.EXTSST) continue;
      if (r.t === T.BOUND) boundAt.push(G.length);
      G.push.apply(G, rec(r.t, r.d));
    }
    /* 시트 위치 · INDEX(DBCELL 절대 위치, DEFCOLW 위치) 채우기 */
    var all = G.slice(), at = G.length;
    SB.forEach(function(sb, k){
      var o = boundAt[k] + 4; all[o] = at & 255; all[o + 1] = (at >>> 8) & 255; all[o + 2] = (at >>> 16) & 255; all[o + 3] = (at >>> 24) & 255;
      if (sb.preIdx >= 0){ var base = sb.preIdx + 4, put = function(off, v){ sb.b[base + off] = v & 255; sb.b[base + off + 1] = (v >>> 8) & 255; sb.b[base + off + 2] = (v >>> 16) & 255; sb.b[base + off + 3] = (v >>> 24) & 255; };
        if (sb.defcolw >= 0) put(12, at + sb.defcolw);
        sb.dbPos.forEach(function(p, j){ put(16 + j * 4, at + p); }); }
      all.push.apply(all, sb.b); at += sb.b.length;
    });
    var outB = new Uint8Array(all);
    ent.content = outB; ent.size = outB.length;
    var res = XLSX.CFB.write(cfb, { type: 'array', fileType: 'cfb' });
    return res instanceof Uint8Array ? res : new Uint8Array(res);
  }
  return { build: build, _recs: recs, _readSST: readSST };
})();
if (typeof window !== 'undefined') window.SETTLE_TAXFORM = SETTLE_TAXFORM;
