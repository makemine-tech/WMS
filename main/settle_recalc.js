/* ============================================================
   정산관리 — 엑셀 수식 다시 계산 (대표님 2026-11-05)
     초안은 지난달 확정본을 틀로 값만 바꿔 쓰기 때문에, 수식 칸에 저장된 결과는 지난달 값 그대로 남는다.
     엑셀은 「편집 사용」을 눌러야 다시 계산 → 그 전(보호된 보기)이나 웹이 읽을 때는 지난달 금액이 보임.
     → 초안을 쓰기 전에, 그리고 완료 확정으로 올린 파일도, 웹에서 수식을 모두 계산해 결과를 채워 넣는다.
   계산 엔진: HyperFormula 2.7.1 (cdn.jsdelivr.net, 처음 쓸 때 불러옴)
   SETTLE_RECALC.run(ExcelJS 통합문서) → Promise { formulas, changed, errors:[칸], samples:[[칸, 전, 후]] }
============================================================ */
(function(root){
  'use strict';
  var CDN = 'https://cdn.jsdelivr.net/npm/hyperformula@2.7.1/dist/hyperformula.full.min.js', loading = null;
  function load(){
    if (root.HyperFormula) return Promise.resolve(root.HyperFormula);
    if (typeof document === 'undefined') return Promise.reject(new Error('HyperFormula 없음'));
    if (!loading) loading = new Promise(function(ok, no){ var s = document.createElement('script'); s.src = CDN;
      s.onload = function(){ ok(root.HyperFormula); }; s.onerror = function(){ loading = null; no(new Error('수식 계산 엔진을 불러오지 못함')); }; document.head.appendChild(s); });
    return loading;
  }
  /* 엑셀 한글 함수 NUMBERSTRING(수, 1) = 「팔백삼십팔만삼천삼백삼십오」 (거래명세표 「일금 …」) — 계산 엔진에 없어서 직접 */
  function numberString(n){
    n = Math.round(Math.abs(+n || 0)); if (!n) return '영';
    var D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], S = ['', '십', '백', '천'], B = ['', '만', '억', '조', '경'], out = '', g = 0;
    while (n > 0){ var q = n % 10000, t = ''; n = Math.floor(n / 10000);
      for (var i = 0; i < 4; i++){ var d = q % 10; q = Math.floor(q / 10); if (d) t = D[d] + S[i] + t; }
      if (t) out = t + B[g] + out; g++; }
    return out;
  }
  var plugged = false;
  function plug(NS){
    var FP = NS.FunctionPlugin, FAT = NS.FunctionArgumentType, H = NS.buildFromSheets ? NS : NS.HyperFormula;
    if (plugged || !FP || !FAT) return; plugged = true;
    var P = class extends FP {
      knumstr(ast, state){ return this.runFunction(ast.args, state, this.metadata('KNUMSTR'), function(n){ return numberString(n); }); } };
    P.implementedFunctions = { KNUMSTR: { method: 'knumstr', parameters: [{ argumentType: FAT.NUMBER }, { argumentType: FAT.NUMBER, optionalArg: true }] } };
    H.registerFunctionPlugin(P, { enGB: { KNUMSTR: 'KNUMSTR' } });
  }
  var EPOCH = Date.UTC(1899, 11, 30);
  function plain(v){   /* ExcelJS 칸 값 → 계산용 값 */
    if (v == null) return null;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v;
    if (v instanceof Date) return (v.getTime() - EPOCH) / 864e5;
    if (v.richText) return v.richText.map(function(t){ return t.text; }).join('');
    if (v.text != null) return String(v.text);
    if ('result' in v) return plain(v.result);
    return null;
  }
  function run(wb){
    return load().then(function(NS){
      var HF = NS.buildFromSheets ? NS : NS.HyperFormula;   /* 브라우저 묶음은 이름공간 안에 HyperFormula 가 있음 */
      var names = [], data = {}, F = [];
      wb.eachSheet(function(ws){ names.push(ws.name); });
      /* 시트 이름 앞뒤에 ' 를 붙여야 한글·기호 이름을 알아봄 — 긴 이름부터 */
      var byLen = names.slice().sort(function(a, b){ return b.length - a.length; });
      var esc = function(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
      var RE = byLen.map(function(n){ return [new RegExp("(^|[^'\\w가-힣])" + esc(n) + '!', 'g'), "$1'" + n.replace(/'/g, "''") + "'!"]; });
      plug(NS);
      var fix = function(f){ f = String(f).replace(/^=/, ''); RE.forEach(function(x){ f = f.replace(x[0], x[1]); }); return '=' + f.replace(/_xlfn\./g, '').replace(/\bNUMBERSTRING\(/gi, 'KNUMSTR('); };
      wb.eachSheet(function(ws){
        var a = [];
        ws.eachRow({ includeEmpty: false }, function(row, r){
          row.eachCell({ includeEmpty: false }, function(c, k){
            if (c.isMerged && c.master !== c) return;   /* 병합된 칸은 첫 칸만 */
            var v = c.value, f = null;
            if (v && typeof v === 'object' && (v.formula || v.sharedFormula)){ try { f = c.formula; } catch (e) { f = null; } }
            (a[r - 1] = a[r - 1] || [])[k - 1] = f ? fix(f) : plain(v);
            if (f) F.push([ws, c, r - 1, k - 1]);
          }); });
        for (var i = 0; i < a.length; i++){ a[i] = a[i] || []; for (var j = 0; j < a[i].length; j++) if (a[i][j] === undefined) a[i][j] = null; }
        data[ws.name] = a;
      });
      var out = { formulas: F.length, changed: 0, errors: [], samples: [] };
      if (!F.length) return out;
      var hf = HF.buildFromSheets(data, { licenseKey: 'gpl-v3' });
      F.forEach(function(x){
        var ws = x[0], c = x[1], id = hf.getSheetId(ws.name), v;
        try { v = hf.getCellValue({ sheet: id, row: x[2], col: x[3] }); } catch (e) { v = { type: 'ERROR' }; }
        if (v != null && typeof v === 'object'){ out.errors.push(ws.name + '!' + c.address); return; }   /* 못 푸는 수식은 저장값 그대로 */
        var old = c.value.result;
        var same = old === v || (typeof old === 'number' && typeof v === 'number' && Math.abs(old - v) < 1e-6) || ((old == null || old === '') && (v == null || v === '' || v === 0));   /* 저장값 없음 ↔ 0 은 같은 것으로 */
        if (!same){ out.changed++; if (out.samples.length < 30) out.samples.push([ws.name + '!' + c.address, old, v]); }
        c.value = Object.assign({}, c.value, { result: v == null ? '' : v });
      });
      hf.destroy();
      return out;
    });
  }
  var api = { run: run, load: load };
  root.SETTLE_RECALC = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
