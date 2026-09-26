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

    /* 최저임금 점검 — 2024년부터 식대 등 복리후생비·정기상여 전액 산입. 연장·야간·휴일수당은 제외 */
    var mh = monthHours(emp.sched), minPay = n(row.base) + n(row.pos) + n(row.etc) + n(row.meal) + n(row.car);
    if (n(row.base) > 0 && minPay < R.minWage * mh) notes.push('최저임금 미달 의심: 월 ' + mh + '시간 기준 ' + Math.round(R.minWage * mh).toLocaleString() + '원 이상이어야 함');

    var dedTotal = 0;
    DED_ITEMS.forEach(function (it) { dedTotal += ded[it.k]; });
    var coTotal = co.pension + co.health + co.ltc + co.emp + co.empStab + co.accident;

    return {
      taxable: taxable, nontax: nontax, gross: gross, insBase: insBase,
      auto: auto, ded: ded, dedTotal: dedTotal, net: gross - dedTotal,
      co: co, coTotal: coTotal, durunuri: duru, age: age, notes: notes
    };
  }

  /* ═══════════ 근태 ═══════════ */

  /* 공휴일 (관공서의 공휴일에 관한 규정 — 5인 이상 사업장은 유급휴일).
     2026: 노동절(5/1)·제헌절(7/17) 공휴일 지정. 설·추석은 토요일과 겹쳐도 대체공휴일 없음.
     회사별 추가·삭제는 설정 화면(settings.holidayAdd / holidayDel)에서. */
  var HOLIDAYS = {
    2026: {
      '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
      '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)', '2026-05-01': '노동절', '2026-05-05': '어린이날',
      '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)', '2026-06-03': '지방선거일', '2026-06-06': '현충일',
      '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
      '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
      '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)', '2026-10-09': '한글날', '2026-12-25': '성탄절'
    }
  };
  function holidayName(date, settings) {
    settings = settings || {};
    var add = settings.holidayAdd || {}, del = settings.holidayDel || {};
    if (del[date]) return '';
    if (add[date]) return add[date];
    var y = HOLIDAYS[+date.slice(0, 4)] || {};
    return y[date] || '';
  }

  var DEFAULT_SCHED = { in: '09:00', out: '18:00', brk: 60, days: [1, 2, 3, 4, 5] };
  function schedOf(emp) {
    var s = (emp && emp.sched) || {};
    return { in: s.in || DEFAULT_SCHED.in, out: s.out || DEFAULT_SCHED.out, brk: s.brk != null && s.brk !== '' ? n(s.brk) : DEFAULT_SCHED.brk, days: s.days && s.days.length ? s.days : DEFAULT_SCHED.days };
  }
  function toMin(t) { if (!t) return null; var m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function schedDailyH(s) { var a = toMin(s.in), b = toMin(s.out); if (a == null || b == null) return 8; if (b <= a) b += 1440; return Math.max(0, (b - a - n(s.brk)) / 60); }
  /* 월 소정근로시간 = (주 소정시간 + 주휴시간) × 365/7/12 — 주 40시간이면 209시간 */
  function monthHours(sched) {
    var s = schedOf({ sched: sched });
    var weekly = Math.min(40, Math.min(8, schedDailyH(s)) * s.days.length);
    if (weekly <= 0) return 209;
    var paidRest = weekly >= 15 ? weekly / 5 : 0;              /* 주 15시간 미만은 주휴 없음 */
    if (paidRest > 8) paidRest = 8;
    return Math.round((weekly + paidRest) * 365 / 7 / 12);
  }

  var DAY_TYPES = {                     /* paid: 소정근로를 한 것으로 봄, leave: 연차 차감일수 */
    work:   { label: '근무' },
    annual: { label: '연차',     paid: 1, leave: 1 },
    halfAm: { label: '오전반차', paid: 1, leave: 0.5, halfWork: 1 },
    halfPm: { label: '오후반차', paid: 1, leave: 0.5, halfWork: 1 },
    sick:   { label: '병가(무급)' },
    paidOff:{ label: '유급휴가', paid: 1 },
    event:  { label: '경조휴가', paid: 1 },
    absent: { label: '결근' },
    off:    { label: '휴무' }
  };

  /* 22:00~06:00 과 겹치는 분 */
  function nightMinutes(a, b) {
    var tot = 0;
    for (var d = -1440; d <= 1440; d += 1440) {
      tot += Math.max(0, Math.min(b, d + 1440 + 360) - Math.max(a, d + 1320));
    }
    return tot;
  }

  /* 하루 계산. kind: 'work'(소정근무일) | 'rest'(무급휴무일, 예: 토) | 'holiday'(주휴일·공휴일) */
  function dayCalc(rec, sched, kind) {
    rec = rec || {};
    var t = DAY_TYPES[rec.type || 'work'] || DAY_TYPES.work, r = { workMin: 0, nightMin: 0, late: 0, early: 0, absent: 0, leave: t.leave || 0, paid: !!t.paid, kind: kind, type: rec.type || 'work' };
    var a = toMin(rec.in), b = toMin(rec.out);
    if (a != null && b != null) {
      if (b <= a) b += 1440;                                   /* 자정 넘김 */
      /* 휴게 미입력 시 (근로기준법 54조: 4시간 30분, 8시간 1시간 이상)
         체류 8시간 30분 이상 → 소정 휴게(최소 60분), 4시간 초과 → 30분 */
      var span = b - a;
      var brk = rec.brk != null && rec.brk !== '' ? n(rec.brk) : (span >= 510 ? Math.max(60, n(sched.brk)) : (span > 240 ? 30 : 0));
      r.workMin = Math.max(0, b - a - brk);
      r.nightMin = Math.max(0, nightMinutes(a, b) - (rec.nightBrk ? n(rec.nightBrk) : 0));
      if (kind === 'work' && (rec.type || 'work') === 'work') {
        var sa = toMin(sched.in), sb = toMin(sched.out); if (sb != null && sa != null && sb <= sa) sb += 1440;
        if (sa != null && a > sa) r.late = a - sa;
        if (sb != null && b < sb) r.early = sb - b;
      }
    } else if (kind === 'work' && (rec.type || 'work') === 'absent') r.absent = 1;
    return r;
  }

  /* 한 달 요약. days = { 'DD': rec }, 주 단위(월~일) 40시간 초과분도 연장으로 합산.
     월 경계에 걸친 주는 이 달에 속한 날만 본다(근사). */
  function monthSummary(days, emp, ym, settings) {
    days = days || {};
    var s = schedOf(emp), y = +ym.slice(0, 4), m = +ym.slice(5, 7), last = new Date(y, m, 0).getDate();
    var S = { workDays: 0, workMin: 0, otMin: 0, nightMin: 0, holMin: 0, restMin: 0, late: 0, lateCnt: 0, early: 0, earlyCnt: 0, absent: 0, leave: 0, paidDays: 0, weeksNoRest: 0, daily: {} };
    /* 단시간근로자(소정 1일 8시간 미만)는 소정시간 초과분부터 초과근로 (기간제법 6조) */
    var capDay = Math.min(480, Math.round(schedDailyH(s) * 60)) || 480, capWeek = Math.min(2400, capDay * s.days.length) || 2400;
    var weekReg = 0, weekAbsent = false, weekHasWork = false;
    for (var d = 1; d <= last; d++) {
      var dd = String(d).padStart(2, '0'), date = ym + '-' + dd, dow = new Date(y, m - 1, d).getDay();
      var hol = holidayName(date, settings);
      var kind = hol ? 'holiday' : (s.days.indexOf(dow) >= 0 ? 'work' : (dow === 0 ? 'holiday' : 'rest'));
      var r = dayCalc(days[dd], s, kind);
      r.holiday = hol; r.dow = dow;
      if (kind === 'holiday') S.holMin += r.workMin;
      else if (kind === 'rest') { S.otMin += r.workMin; S.restMin += r.workMin; }
      else {
        var reg = Math.min(r.workMin, capDay), dayOt = Math.max(0, r.workMin - capDay);
        if (weekReg + reg > capWeek) { dayOt += weekReg + reg - capWeek; reg = Math.max(0, capWeek - weekReg); }
        weekReg += reg; S.otMin += dayOt; r.otMin = dayOt;
        if (r.workMin > 0) { S.workDays++; weekHasWork = true; }
        if (r.paid) S.paidDays += (DAY_TYPES[r.type].halfWork ? 0.5 : 1);
        if (r.late) { S.late += r.late; S.lateCnt++; }
        if (r.early) { S.early += r.early; S.earlyCnt++; }
        if (r.absent) { S.absent++; weekAbsent = true; }
      }
      if (kind !== 'work' && r.workMin > 0) S.workDays++;
      S.workMin += r.workMin; S.nightMin += r.nightMin; S.leave += r.leave;
      S.daily[dd] = r;
      if (dow === 0 || d === last) {                          /* 주 마감(일요일) */
        if (weekAbsent && weekHasWork) S.weeksNoRest++;
        weekReg = 0; weekAbsent = false; weekHasWork = false;
      }
    }
    var h = function (min) { return Math.round(min / 6) / 10; }; /* 0.1시간 단위 */
    S.workH = h(S.workMin); S.otH = h(S.otMin); S.nightH = h(S.nightMin); S.holH = h(S.holMin);
    return S;
  }

  /* 연차 (근로기준법 60조, 입사일 기준). usedFn(from,to) → 기간 내 사용일수 */
  function leaveInfo(emp, today, usedFn) {
    if (!emp.joined) return null;
    var j = new Date(emp.joined + 'T00:00:00'), t = new Date(today + 'T00:00:00');
    var months = (t.getFullYear() - j.getFullYear()) * 12 + (t.getMonth() - j.getMonth()) - (t.getDate() < j.getDate() ? 1 : 0);
    var from, to, grant;
    if (months < 12) {
      grant = Math.min(11, Math.max(0, months));            /* 1년 미만: 1개월 개근마다 1일 */
      from = emp.joined; var e = new Date(j); e.setFullYear(e.getFullYear() + 1); e.setDate(e.getDate() - 1); to = iso(e);
    } else {
      var yrs = Math.floor(months / 12);
      grant = Math.min(25, 15 + Math.floor((yrs - 1) / 2));
      var s = new Date(j); s.setFullYear(j.getFullYear() + yrs); var e2 = new Date(s); e2.setFullYear(e2.getFullYear() + 1); e2.setDate(e2.getDate() - 1);
      from = iso(s); to = iso(e2);
    }
    var used = usedFn ? usedFn(from, to) : 0;
    return { grant: grant, used: used, left: grant - used, from: from, to: to, firstYear: months < 12 };
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* 통상시급 · 연장/야간/휴일 수당 (근로기준법 56조)
     5인 미만 사업장(under5)은 가산 미적용: 연장·휴일 ×1.0, 야간 가산 없음 */
  function hourly(row, mh) { return Math.round((n(row.base) + n(row.pos)) / (mh || 209)); }
  function overtimePay(row, opt) {
    opt = opt || {};
    var h = n(row.hourly) || hourly(row, opt.monthHours);
    var u5 = !!opt.under5, hh = n(row.holH);
    return {
      hourly: h, under5: u5,
      ot: Math.round(h * (u5 ? 1 : 1.5) * n(row.otH)),
      night: u5 ? 0 : Math.round(h * 0.5 * n(row.nightH)),
      hol: u5 ? Math.round(h * hh) : Math.round(h * 1.5 * Math.min(hh, 8) + h * 2 * Math.max(hh - 8, 0))
    };
  }

  var api = {
    RATES: RATES, STAB_LABEL: STAB_LABEL,
    PAY_ITEMS: PAY_ITEMS, NONTAX_ITEMS: NONTAX_ITEMS, DED_ITEMS: DED_ITEMS,
    ratesFor: ratesFor, pensionBounds: pensionBounds, taxTableFor: taxTableFor,
    incomeTax: incomeTax, calcRow: calcRow, birthFrom: birthFrom, ageAt: ageAt,
    hourly: hourly, overtimePay: overtimePay,
    HOLIDAYS: HOLIDAYS, holidayName: holidayName, DAY_TYPES: DAY_TYPES, DEFAULT_SCHED: DEFAULT_SCHED,
    schedOf: schedOf, monthHours: monthHours, dayCalc: dayCalc, monthSummary: monthSummary, leaveInfo: leaveInfo, toMin: toMin
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PayrollCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
