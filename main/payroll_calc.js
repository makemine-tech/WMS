/* ============================================================
   급여 계산 엔진 — 4대보험 · 근로소득세 (2026년 기준)

   순수 함수만 둔다(화면·DB 무관) → Node 에서도 그대로 검산 가능.
   요율은 RATES[연도] 한 곳에서만 관리한다. 새 해가 오면 RATES 에 한 덩어리 추가.

   반올림 규칙 (공단 실무 기준)
     - 보험료·세액: 10원 미만 절사
     - 국민연금 기준소득월액: 1,000원 미만 절사 후 상·하한 적용
============================================================ */
(function (root) {
  'use strict';

  var RATES = {
    2026: {
      label: '2026년',
      pension: {                 /* 국민연금 9.5% (근로자·사업주 각 4.75%) — 2026.1 연금개혁 */
        rate: 0.095,
        periods: [               /* 기준소득월액 상·하한 (매년 7월 변경) */
          { from: '2025-07', min: 400000, max: 6370000 },
          { from: '2026-07', min: 410000, max: 6590000 }
        ],
        maxAge: 60               /* 만 60세부터 의무가입 제외 */
      },
      health: { rate: 0.0719, min: 280383, max: 127056982 },   /* 건강보험 7.19% (각 3.595%) */
      ltc: { ofHealth: 0.1314 },                               /* 장기요양 = 건강보험료 × 13.14% (소득 대비 0.9448%) */
      emp: {                                                   /* 고용보험 — 실업급여 각 0.9% + 사업주 고용안정·직업능력 */
        worker: 0.009, employer: 0.009,
        stab: { lt150: 0.0025, ge150p: 0.0045, lt1000: 0.0065, ge1000: 0.0085 }
      },
      durunuri: { limit: 2700000, support: 0.8, months: 36 },  /* 10인 미만 · 월보수 270만원 미만 신규가입 · 80% */
      nontax: { meal: 200000, car: 200000, child: 200000 },   /* 식대 · 자가운전보조금 · 6세 이하 보육수당 월 한도 */
      minWage: 10320,
      stdMonthHours: 209
    }
  };

  var STAB_LABEL = { lt150: '150인 미만 (0.25%)', ge150p: '150인 이상 우선지원대상 (0.45%)', lt1000: '150~1,000인 미만 (0.65%)', ge1000: '1,000인 이상·국가 (0.85%)' };

  /* ── 항목 정의 ── */
  var PAY_ITEMS = [          /* 과세 지급 */
    { k: 'base',  label: '기본급' },
    { k: 'pos',   label: '직책수당' },
    { k: 'ot',    label: '연장근로수당' },
    { k: 'night', label: '야간근로수당' },
    { k: 'hol',   label: '휴일근로수당' },
    { k: 'bonus', label: '상여금' },
    { k: 'etc',   label: '기타수당' }
  ];
  var NONTAX_ITEMS = [       /* 비과세 지급 (한도 초과분은 과세로 자동 편입) */
    { k: 'meal',  label: '식대',          limitKey: 'meal' },
    { k: 'car',   label: '자가운전보조금', limitKey: 'car' },
    { k: 'child', label: '보육수당',       limitKey: 'child' },
    { k: 'ntEtc', label: '기타비과세' }
  ];
  var DED_ITEMS = [          /* 공제 — 앞 6개는 자동계산, 뒤 2개는 수기 */
    { k: 'incomeTax', label: '소득세',     auto: true },
    { k: 'localTax',  label: '지방소득세', auto: true },
    { k: 'pension',   label: '국민연금',   auto: true },
    { k: 'health',    label: '건강보험',   auto: true },
    { k: 'ltc',       label: '장기요양',   auto: true },
    { k: 'emp',       label: '고용보험',   auto: true },
    { k: 'dedEtc',    label: '기타공제' },
    { k: 'yearEnd',   label: '연말정산' }
  ];

  function n(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function floor10(v) { return Math.floor(v / 10) * 10; }
  function floor1000(v) { return Math.floor(v / 1000) * 1000; }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function ratesFor(ym) {
    var y = parseInt(String(ym).slice(0, 4), 10);
    var ks = Object.keys(RATES).map(Number).sort(function (a, b) { return a - b; });
    var pick = ks[0];
    ks.forEach(function (k) { if (k <= y) pick = k; });
    return RATES[pick];
  }
  function pensionBounds(R, ym) {
    var p = R.pension.periods[0];
    R.pension.periods.forEach(function (x) { if (x.from <= ym) p = x; });
    return p;
  }

  /* ── 근로소득 간이세액 ── */
  function taxTableFor(ym) {
    var T = (root.PAYROLL_TAX_TABLES || {});
    var best = null;
    Object.keys(T).forEach(function (k) { if (T[k].from <= ym && (!best || T[k].from > best.from)) best = T[k]; });
    if (!best) Object.keys(T).forEach(function (k) { if (!best || T[k].from < best.from) best = T[k]; });
    return best;
  }
  /* 가족수 1~11 기준 표 세액 (자녀공제 전) */
  function tableTax(T, monthly, fam) {
    var k = monthly / 1000;                    /* 천원 단위 */
    if (k < T.rows[0][0]) return 0;
    var col = Math.min(Math.max(fam, 1), 11);
    if (k < 10000) {
      var rows = T.rows, lo = 0, hi = rows.length - 1;
      while (lo <= hi) {                        /* 이분 탐색: rows[i][0] <= k < rows[i][1] */
        var mid = (lo + hi) >> 1;
        if (k < rows[mid][0]) hi = mid - 1; else if (k >= rows[mid][1]) lo = mid + 1; else return rows[mid][1 + col];
      }
      return 0;
    }
    var base = T.top[col - 1], x = monthly;
    if (x <= 10000000) return base;
    if (x <= 14000000) return base + (x - 10000000) * 0.98 * 0.35 + 25000;
    if (x <= 28000000) return base + 1397000 + (x - 14000000) * 0.98 * 0.38;
    if (x <= 30000000) return base + 6610600 + (x - 28000000) * 0.98 * 0.40;
    if (x <= 45000000) return base + 7394600 + (x - 30000000) * 0.40;
    if (x <= 87000000) return base + 13394600 + (x - 45000000) * 0.42;
    return base + 31034600 + (x - 87000000) * 0.45;
  }
  /* 간이세액표 비고 3·4호 반영: 11명 초과 가족, 8~20세 자녀 공제, 80/100/120% 선택 */
  function incomeTax(ym, monthly, fam, kids, pct) {
    var T = taxTableFor(ym);
    if (!T || monthly <= 0) return 0;
    fam = Math.max(1, Math.floor(n(fam) || 1));
    var t;
    if (fam > 11) {
      var t11 = tableTax(T, monthly, 11), t10 = tableTax(T, monthly, 10);
      t = t11 - (t10 - t11) * (fam - 11);
    } else t = tableTax(T, monthly, fam);
    kids = Math.max(0, Math.floor(n(kids)));
    var cc = T.childCredit, credit = 0;
    if (kids === 1) credit = cc.one; else if (kids === 2) credit = cc.two; else if (kids >= 3) credit = cc.two + (kids - 2) * cc.extra;
    t = Math.max(0, t - credit);
    var p = n(pct) || 100;
    return floor10(t * p / 100);
  }

  /* ── 나이 (주민번호/생년월일 → 해당 월 말일 기준 만 나이) ── */
  function birthFrom(emp) {
    if (emp.birth && /^\d{4}-\d{2}-\d{2}$/.test(emp.birth)) return emp.birth;
    var r = String(emp.rrn || '').replace(/\D/g, '');
    if (r.length >= 7) {
      var g = r.charAt(6), c = (g === '1' || g === '2' || g === '5' || g === '6') ? '19' : (g === '9' || g === '0') ? '18' : '20';
      return c + r.slice(0, 2) + '-' + r.slice(2, 4) + '-' + r.slice(4, 6);
    }
    return '';
  }
  function ageAt(birth, ym) {
    if (!birth) return null;
    var by = +birth.slice(0, 4), bm = +birth.slice(5, 7);
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var a = y - by; if (m < bm) a--;          /* 월 단위 근사 (해당 월 기준) */
    return a;
  }
  function monthsBetween(a, b) {               /* 'YYYY-MM' 차이 */
    return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  }

  /* ── 한 사람 한 달 계산 ──
     emp  : 사원정보 (fam, kids, taxPct, ex{tax,pension,health,ltc,emp}, durunuri, durunuriFrom, reportWage)
     row  : 그 달 입력값 (PAY_ITEMS·NONTAX_ITEMS·dedEtc·yearEnd 금액, ovr{공제수기값})
     opt  : { ym:'YYYY-MM', stab:'lt150', accidentRate:0.0 } */
  function calcRow(emp, row, opt) {
    emp = emp || {}; row = row || {}; opt = opt || {};
    var ym = opt.ym, R = ratesFor(ym), ex = emp.ex || {}, notes = [];

    var taxable = 0;
    PAY_ITEMS.forEach(function (it) { taxable += n(row[it.k]); });
    var nontax = 0, overLimit = 0;
    NONTAX_ITEMS.forEach(function (it) {
      var v = n(row[it.k]);
      var lim = it.limitKey ? R.nontax[it.limitKey] : Infinity;
      if (v > lim) { overLimit += v - lim; nontax += lim; notes.push(it.label + ' 한도 초과 ' + (v - lim).toLocaleString() + '원 과세 편입'); }
      else nontax += v;
    });
    taxable += overLimit;
    var gross = taxable + nontax;

    var insBase = n(emp.reportWage) > 0 ? n(emp.reportWage) : taxable;
    var age = ageAt(birthFrom(emp), ym);

    /* 두루누리 */
    var duru = false;
    if (emp.durunuri && insBase < R.durunuri.limit) {
      var from = emp.durunuriFrom || ym;
      var used = monthsBetween(from, ym);
      if (used >= 0 && used < R.durunuri.months) duru = true;
      else if (used >= R.durunuri.months) notes.push('두루누리 ' + R.durunuri.months + '개월 지원 종료');
    } else if (emp.durunuri) notes.push('두루누리: 보수 ' + (R.durunuri.limit / 10000) + '만원 이상 → 미적용');

    var auto = {}, co = {};
    /* 국민연금 */
    if (ex.pension) { auto.pension = 0; co.pension = 0; }
    else if (age !== null && age >= R.pension.maxAge) { auto.pension = 0; co.pension = 0; notes.push('만 ' + age + '세 — 국민연금 제외'); }
    else if (insBase <= 0) { auto.pension = 0; co.pension = 0; }
    else {
      var pb = pensionBounds(R, ym);
      var pBase = clamp(floor1000(insBase), pb.min, pb.max);
      var share = floor10(pBase * R.pension.rate / 2);
      auto.pension = duru ? share - floor10(share * R.durunuri.support) : share;
      co.pension = auto.pension;
    }
    /* 건강 · 장기요양 */
    if (ex.health || insBase <= 0) { auto.health = 0; co.health = 0; }
    else {
      var hBase = clamp(insBase, R.health.min, R.health.max);
      auto.health = floor10(hBase * R.health.rate / 2); co.health = auto.health;
    }
    if (ex.ltc || ex.health || !auto.health) { auto.ltc = 0; co.ltc = 0; }
    else { auto.ltc = floor10(auto.health * R.ltc.ofHealth); co.ltc = auto.ltc; }
    /* 고용 */
    var stabRate = R.emp.stab[opt.stab || 'lt150'] || 0;
    if (ex.emp || taxable <= 0) { auto.emp = 0; co.emp = 0; co.empStab = 0; }
    else {
      var es = floor10(taxable * R.emp.worker);
      auto.emp = duru ? es - floor10(es * R.durunuri.support) : es;
      var ce = floor10(taxable * R.emp.employer);
      co.emp = duru ? ce - floor10(ce * R.durunuri.support) : ce;
      co.empStab = floor10(taxable * stabRate);
    }
    co.accident = floor10(taxable * n(opt.accidentRate));
    /* 소득세 · 지방소득세 */
    if (ex.tax) { auto.incomeTax = 0; }
    else auto.incomeTax = incomeTax(ym, taxable, emp.fam || 1, emp.kids || 0, emp.taxPct || 100);

    /* 수기 수정값 적용 (지방소득세는 소득세가 수기라도 자동 연동) */
    var ovr = row.ovr || {}, ded = {};
    ['incomeTax', 'pension', 'health', 'ltc', 'emp'].forEach(function (k) {
      ded[k] = (ovr[k] !== undefined && ovr[k] !== null && ovr[k] !== '') ? n(ovr[k]) : auto[k];
    });
    auto.localTax = floor10(ded.incomeTax * 0.1);
    ded.localTax = (ovr.localTax !== undefined && ovr.localTax !== null && ovr.localTax !== '') ? n(ovr.localTax) : auto.localTax;
    ded.dedEtc = n(row.dedEtc);
    ded.yearEnd = n(row.yearEnd);

    var dedTotal = 0;
    DED_ITEMS.forEach(function (it) { dedTotal += ded[it.k]; });
    var coTotal = co.pension + co.health + co.ltc + co.emp + co.empStab + co.accident;

    return {
      taxable: taxable, nontax: nontax, gross: gross, insBase: insBase,
      auto: auto, ded: ded, dedTotal: dedTotal, net: gross - dedTotal,
      co: co, coTotal: coTotal, durunuri: duru, age: age, notes: notes
    };
  }

  /* 통상시급 · 연장/야간/휴일 수당 (근로기준법 56조) */
  function hourly(row) { return Math.round((n(row.base) + n(row.pos)) / 209); }
  function overtimePay(row) {
    var h = n(row.hourly) || hourly(row);
    return {
      hourly: h,
      ot: Math.round(h * 1.5 * n(row.otH)),
      night: Math.round(h * 0.5 * n(row.nightH)),
      hol: Math.round(h * 1.5 * Math.min(n(row.holH), 8) + h * 2 * Math.max(n(row.holH) - 8, 0))
    };
  }

  var api = {
    RATES: RATES, STAB_LABEL: STAB_LABEL,
    PAY_ITEMS: PAY_ITEMS, NONTAX_ITEMS: NONTAX_ITEMS, DED_ITEMS: DED_ITEMS,
    ratesFor: ratesFor, pensionBounds: pensionBounds, taxTableFor: taxTableFor,
    incomeTax: incomeTax, calcRow: calcRow, birthFrom: birthFrom, ageAt: ageAt,
    hourly: hourly, overtimePay: overtimePay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PayrollCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
