/* ============================================================
   정산 파일함 — 파일 종류 판별 규칙 (settlement.html)

   파일 이름은 매달 바뀌므로(end200edit_…, stm403main_…) 이름이 아니라
   시트 이름·제목줄(헤더) 같은 '내용'으로 종류를 알아본다.

   cat    : 'common' = 매달 공통으로 한 개씩 필요한 파일 (같은 종류를 다시 올리면 교체)
            'vendor' = 업체별 정산 때 쓰는 파일 (여러 개 가능)
   test(f): f = { ext, name, sheets:[{ name, headers:Set, hdr:제목줄위치, rows }], allHeaders:Set }
   판별은 위에서부터 차례로 — 처음 맞는 종류로 정한다(거래내역서를 맨 앞에: 안에 배송비·용차비 시트가 있어서).
   summary(f, wb): 목록에 보일 한 줄 요약 (개인정보 없이 건수·업체명 정도만)

   새 종류는 여기 SETTLE_TYPES 에 추가하거나, 화면에서 '종류 지정'으로 가르치면
   (settlement/sigs) 다음 달부터 같은 모양의 파일을 자동으로 알아본다.
============================================================ */
(function(){
  'use strict';

  function hasAll(set, arr){ for (var i = 0; i < arr.length; i++) if (!set.has(arr[i])) return false; return true; }
  function sheetWith(f, arr){ for (var i = 0; i < f.sheets.length; i++) if (hasAll(f.sheets[i].headers, arr)) return f.sheets[i]; return null; }
  function sheetNamed(f, nm){ for (var i = 0; i < f.sheets.length; i++) if (f.sheets[i].name === nm) return f.sheets[i]; return null; }
  function nf(n){ return (n || 0).toLocaleString('ko-KR'); }

  /* 한 열의 값별 개수 상위 n개 — "A 120 · B 30 …" (제목줄 위치 s.hdr 부터 읽는다) */
  function topCounts(wb, s, header, n){
    try {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { defval: '', range: s.hdr || 0 });
      var m = {};
      rows.forEach(function(r){ var k = String(r[header] == null ? '' : r[header]).trim(); if (k) m[k] = (m[k] || 0) + 1; });
      var ks = Object.keys(m).sort(function(a, b){ return m[b] - m[a]; });
      return ks.slice(0, n || 4).map(function(k){ return k + ' ' + nf(m[k]); }).join(' · ') + (ks.length > (n || 4) ? ' 외 ' + (ks.length - (n || 4)) + '곳' : '');
    } catch (e) { return ''; }
  }

  var T = [
    /* ── 완료된 거래내역서 (먼저 판별) ── */
    { key:'statement', cat:'vendor', label:'거래내역서 (지난 정산서·표본)', icon:'📑',
      hint:'완료된 업체 거래명세표 — 업체 등록 때 표본으로 사용',
      test:function(f){ return /^\d{1,2}월_거래내역서_/.test(f.name) || (f.sheets.length >= 2 && /^(거래명세표|거래명세서|메이크창고_거래명세표|토탈합계)/.test(f.sheets[0].name)); },
      summary:function(f){ return '시트 ' + f.sheets.length + '개 (' + f.sheets.slice(0, 3).map(function(s){ return s.name; }).join(' · ') + (f.sheets.length > 3 ? ' …' : '') + ')'; } },

    /* ── 공통 ── */
    { key:'ebut_orders', cat:'common', label:'이벗 전체주문목록', icon:'📋',
      hint:'이벗 → 주문목록 전체 다운로드 (송장·주소 매칭용, 제주 추가운임·연동몰 판매처 판별)',
      test:function(f){ var s = sheetWith(f, ['고객사','판매처','송장번호','매칭상품명']); return s && s.rows >= 3000; },
      summary:function(f, wb){ var s = sheetWith(f, ['고객사','판매처','송장번호']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '고객사', 4); } },
    { key:'bnc_courier', cat:'common', label:'박스앤캔 택배비 (우체국)', icon:'📮',
      hint:'박스앤캔에서 받는 월 택배비 엑셀 — 청구내역서·발송·반품 시트',
      test:function(f){ var a = sheetNamed(f, '발송'), b = sheetNamed(f, '반품'); return !!(a && b && a.headers.has('등기번호')); },
      summary:function(f, wb){ var a = sheetNamed(f, '발송'), b = sheetNamed(f, '반품');
        return '발송 ' + nf(a.rows) + ' · 반품 ' + nf(b.rows) + ' · ' + topCounts(wb, a, '발송인명', 3).replace(/메이크창고\(/g, '').replace(/\)/g, ''); } },
    { key:'freight', cat:'common', label:'화물 청구서 (용차·운송비)', icon:'🚚',
      hint:'운송업체 월 청구서 — 일자·출발지·도착지·차종·금액·업체명',
      test:function(f){ return !!sheetWith(f, ['출발지','도착지','차종']); },
      summary:function(f, wb){ var s = sheetNamed(f, '결제금액명세서') || sheetWith(f, ['출발지','도착지','차종']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '업체명', 4); } },
    { key:'cargo_io', cat:'common', label:'화물 입출고 내역 (파렛트)', icon:'🏗️',
      hint:'창고 파렛트 입출고 기록 — 보관비·입출고비 계산용',
      test:function(f){ return !!sheetWith(f, ['업체명','파렛트수']) && !!(sheetWith(f, ['입출고-기타','업체명']) || sheetNamed(f, '입출고내역')); },
      summary:function(f, wb){ var s = sheetWith(f, ['입출고-기타','업체명','파렛트수']) || sheetWith(f, ['업체명','파렛트수']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '업체명', 4); } },
    { key:'labor', cat:'common', label:'도급비 청구서 (알바·인력)', icon:'👷',
      hint:'인력업체 월 도급비 — 청구·근태 시트',
      test:function(f){ return !!(sheetNamed(f, '청구') && sheetNamed(f, '근태')); },
      summary:function(f){ return '청구·근태 시트'; } },
    { key:'settle_mgmt', cat:'common', label:'삼자물류 정산관리표', icon:'🗂️',
      hint:'00_삼자물류정산관리 — 업체별 정산금액·계산서 발행 관리',
      test:function(f){ return !!sheetWith(f, ['업체명','정산금액']); },
      summary:function(f){ return '시트 ' + f.sheets.length + '개 (' + f.sheets[0].name + ' …)'; } },
    { key:'tax_form', cat:'common', label:'세금계산서 등록양식', icon:'🧾',
      hint:'홈택스 일괄발행 엑셀 업로드 양식',
      test:function(f){ return !!sheetNamed(f, '엑셀업로드양식'); },
      summary:function(f){ var s = sheetNamed(f, '엑셀업로드양식'); return nf(s.rows) + '행'; } },

    /* ── 업체별 ── */
    { key:'ebut_shiplist', cat:'vendor', label:'이벗 택배비 리스트', icon:'📦',
      hint:'이벗 출고 송장 리스트(택배크기 포함) — 업체 배송비 시트 원본',
      test:function(f){ return !!sheetWith(f, ['등록일','출고일','판매처명','택배크기','송장번호']); },
      summary:function(f, wb){ var s = sheetWith(f, ['판매처명','택배크기','송장번호']); return nf(s.rows) + '건 · ' + topCounts(wb, s, '출력양식', 3); } },
    { key:'ebut_stock', cat:'vendor', label:'이벗 재고현황', icon:'📊',
      hint:'이벗 재고 다운로드 — 월말 전산재고 시트',
      test:function(f){ return !!sheetWith(f, ['가용재고수량','불량재고수량','옵션코드']); },
      summary:function(f){ var s = sheetWith(f, ['가용재고수량','불량재고수량']); return nf(s.rows) + '품목'; } },
    { key:'ebut_orders_part', cat:'vendor', label:'이벗 주문목록 (일부)', icon:'🧾',
      hint:'위탁판매·초콜릿·쉽먼트 등 일부만 뽑은 주문목록',
      test:function(f){ var s = sheetWith(f, ['고객사','판매처','송장번호']); return s && s.rows < 3000; },
      summary:function(f, wb){ var s = sheetWith(f, ['고객사','판매처','송장번호']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '판매처', 3); } },
    { key:'coupang_po', cat:'vendor', label:'쿠팡 발주서·입고내역', icon:'🛒',
      hint:'쿠팡 발주번호·SKU·물류센터 목록',
      test:function(f){ return !!sheetWith(f, ['발주번호','물류센터']) && !!(sheetWith(f, ['SKU ID']) || sheetWith(f, ['SKU 이름'])); },
      summary:function(f){ var s = sheetWith(f, ['발주번호','물류센터']); return nf(s.rows) + '행'; } },
    { key:'p9_row', cat:'vendor', label:'포인트나인크루 출고 ROW', icon:'🥛',
      hint:'곡물도감·셀시어스·오리진케어 출고 원본(WorkSheet)',
      test:function(f){ return !!sheetWith(f, ['발주일','모데명','송장번호','관리번호']); },
      summary:function(f){ var s = sheetWith(f, ['발주일','모데명','송장번호']); return nf(s.rows) + '행 · 시트 ' + f.sheets.length + '개'; } },
    { key:'jeju_stock', cat:'vendor', label:'제주맥주 재고파악', icon:'🍺',
      hint:'제주맥주 월말 재고현황·출고·입고 목록',
      test:function(f){ return !!sheetWith(f, ['현재실재고','불량재고']); },
      summary:function(f){ return '시트 ' + f.sheets.map(function(s){ return s.name; }).join(' · '); } },
    { key:'pdf', cat:'vendor', label:'PDF 문서', icon:'📄',
      hint:'거래내역서·원장·명세서 PDF',
      test:function(f){ return f.ext === 'pdf'; },
      summary:function(f){ return 'PDF'; } },
    { key:'image', cat:'vendor', label:'이미지', icon:'🖼️',
      hint:'계좌 사본 등 이미지',
      test:function(f){ return /^(png|jpe?g|gif|webp)$/.test(f.ext); },
      summary:function(f){ return '이미지'; } }
  ];

  window.SETTLE_TYPES = T;
  window.SETTLE_TYPE = function(key){ for (var i = 0; i < T.length; i++) if (T[i].key === key) return T[i]; return null; };
})();
