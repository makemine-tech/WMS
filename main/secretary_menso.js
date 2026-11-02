/* ============================================================
   AI 물류비서 — 맨소래담 사은품 미리 보기 (브라우저·Node 공용, 2026-11-01)

   이벗 주문서목록을 행사표로 계산해 구간별로 넣어야 할 건수를 낸다. 이벗에 쓰지 않는다.
   규칙(대표님 2026-11-01): 대상 브랜드가 든 주문이면 주문 전체 판매금액(할인 후, 배송비 제외)으로 보고,
   주문당 가장 높은 구간 하나. 연동몰은 대상 아님. 수령자 정보는 입력에도 결과에도 없다.
   행사표 campaign: { name, brand, site, basis:'reg'(등록일)|'order'(주문일), from, to, tiers:[{ min, label, gifts:[매칭 상품명 일부] }] }
============================================================ */
(function(root){
  'use strict';
  var GIFT_NAME = '사은품', CANCEL = '2', WAITING = '0', EXCLUDED_SITE = '맨소래담_연동몰', LIST = 20;
  var KNOWN_SITES = ['맨소레담공식스마트스토어', '멘소래담아시아퍼시픽', '맨소래담_연동몰', '멘소래담_화해', '맨소래담_올웨이즈', '맨소래담_기타', '맨소래담_젬페이스', '체험단'];

  function squeeze(s){ return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function dayOf(s){ return String(s || '').slice(0, 10); }

  /* 안 넣었음 / 맞음 / 구간과 다름 */
  function giftStatus(tier, have){
    if (!have.length) return 'need';
    var want = tier.gifts || [];
    if (!want.length) return 'done';   /* 매칭 상품명을 아직 안 적은 행사표: 들어갔는지만 봄 */
    var names = have.map(squeeze);
    var ok = names.length === want.length && want.every(function(w){ return names.some(function(n){ return n.indexOf(squeeze(w)) >= 0; }); });
    return ok ? 'done' : 'wrong';
  }

  function previewCampaign(read, c){
    var orders = {}, gifts = read.gifts || {}, tiers = (c.tiers || []).slice().sort(function(a, b){ return b.min - a.min; });
    (read.rows || []).forEach(function(r){
      if (String(r.fnsh) === CANCEL || r.siteName === EXCLUDED_SITE) return;
      var o = orders[r.no] || (orders[r.no] = { no: r.no, sum: 0, hit: false, site: r.siteName, reg: dayOf(r.regDate), order: dayOf(r.orderDate), names: [], waiting: false });
      if (String(r.fnsh) === WAITING) o.waiting = true;
      if (r.name === GIFT_NAME) return;
      o.sum += Number(r.amt) || 0;
      if (r.name.indexOf(c.brand) >= 0) { o.hit = true; o.names.push(r.name); }
    });

    var out = { name: c.name, brand: c.brand, basis: c.basis, from: c.from, to: c.to, orders: 0, under: 0, need: 0, outside: 0, past: 0,
                tiers: tiers.map(function(t){ return { min: t.min, label: t.label || '', need: 0, done: 0, wrong: 0 }; }).reverse(), wrong: [], needList: [], names: [] };
    var seen = {};
    Object.keys(orders).forEach(function(k){
      var o = orders[k];
      if (!o.hit || (c.site && o.site !== c.site)) return;
      var day = c.basis === 'order' ? (o.order || o.reg) : o.reg;
      if ((c.from && day < c.from) || (c.to && day > c.to)) { out.outside++; return; }
      out.orders++;
      o.names.forEach(function(n){ seen[n] = (seen[n] || 0) + 1; });
      var have = gifts[k] || [], tier = tiers.find(function(t){ return o.sum >= t.min; });
      if (!tier) {
        out.under++;
        if (have.length && !o.waiting) out.past++;
        else if (have.length && out.wrong.length < LIST) out.wrong.push({ no: k, amt: o.sum, have: have, why: '구간 미달인데 사은품 있음' });
        return;
      }
      var st = giftStatus(tier, have), row = out.tiers.find(function(t){ return t.min === tier.min; });
      /* 이미 나간 주문은 고칠 수 없으니 할 일로 치지 않고 수만 남긴다 */
      if (st !== 'done' && !o.waiting) { out.past++; return; }
      row[st]++;
      if (st === 'need') { out.need++; if (out.needList.length < LIST) out.needList.push({ no: k, amt: o.sum, min: tier.min }); }
      if (st === 'wrong' && out.wrong.length < LIST) out.wrong.push({ no: k, amt: o.sum, have: have, why: tier.min.toLocaleString('en-US') + '원 구간과 다름' });
    });
    out.names = Object.keys(seen).sort(function(a, b){ return seen[b] - seen[a]; }).slice(0, LIST).map(function(n){ return { name: n, rows: seen[n] }; });
    return out;
  }

  function preview(read, campaigns){
    var sites = {}, unknown = [], blockers = [];
    (read.rows || []).forEach(function(r){ sites[r.siteName] = true; });
    Object.keys(sites).forEach(function(s){ if (KNOWN_SITES.indexOf(s) < 0) unknown.push(s); });
    if (Number(read.total) !== (read.rows || []).length) blockers.push('이벗에는 ' + read.total + '줄이 있는데 ' + (read.rows || []).length + '줄만 읽혔습니다');
    if (unknown.length) blockers.push('처음 보는 판매처: ' + unknown.join(', '));
    var unmatched = (read.unmatched || []).length;
    if (unmatched) blockers.push('매칭 안 된 줄 ' + unmatched + '건');
    var list = (campaigns || []).filter(function(c){ return c.confirmed; }).map(function(c){ return previewCampaign(read, c); });
    list.forEach(function(p){ if (p.wrong.length) blockers.push(p.name + ': 구간과 다른 사은품 ' + p.wrong.length + '건'); });
    return { rows: (read.rows || []).length, orders: Object.keys((read.rows || []).reduce(function(m, r){ m[r.no] = 1; return m; }, {})).length,
             unmatched: unmatched, campaigns: list, drafts: (campaigns || []).filter(function(c){ return !c.confirmed; }).length, blockers: blockers, flow: flow(read, list) };
  }

  /* 흐름도: 앞 단계가 끝나야 다음 단계가 열린다. done 파랑, todo 빨강(지금 할 일), wait 회색, later 회색 점선(아직 연결 안 됨)
     단계 완료 여부는 이벗 자료로만 판단한다. 비서가 눌렀다는 기억으로 판단하지 않는다 */
  var STEPS = [
    { id: 'collect', name: '주문 수집', who: '직접' },
    { id: 'match', name: '주문 매칭', who: '직접' },
    { id: 'confirm', name: '묶음 출력확정', who: '직접' },
    { id: 'gift', name: '사은품', who: '직접' },
    { id: 'invoice', name: '송장번호', who: '직접' },
    { id: 'ship', name: '출고처리', who: '직접' }
  ];
  /* 비젬은 주문 수집 바로 뒤. 아직 연결 전이라 사람이 하는 칸. 이 칸이 없이 저장된 예전 결과에도 끼워 넣음 */
  function withBizem(steps){
    if (steps.some(function(s){ return s.id === 'bizem_collect'; })) return steps;
    var at = steps.findIndex(function(s){ return s.id === 'collect'; }) + 1;
    return steps.slice(0, at).concat([
      { id: 'bizem_collect', name: '비젬 주문수집', who: '연결 전', state: 'later', count: 0 },
      { id: 'bizem_import', name: '비젬 주문가져오기', who: '연결 전', state: 'later', count: 0 }
    ], steps.slice(at));
  }
  /* 비젬 건수로 칸 차례 표시. 주문확정이 남았으면 2번, 인쇄 대기만 남았으면 3번 */
  function bizemSteps(steps, site){
    var c = site && site.state === 'ok' ? site.counts : null;
    return withBizem(steps).map(function(s){
      if (s.id !== 'bizem_collect' && s.id !== 'bizem_import') return s;
      var n = !c ? 0 : s.id === 'bizem_collect' ? c.unconfirmed : (c.unconfirmed ? 0 : c.printWait);
      return { id: s.id, name: s.name, who: '직접', state: !c ? 'later' : n ? 'todo' : 'wait', count: n };
    });
  }
  function flow(read, campaigns){
    var waiting = {}, all = {};
    (read.rows || []).forEach(function(r){
      if (String(r.fnsh) === CANCEL || r.name === GIFT_NAME) return;
      all[r.no] = true;
      if (String(r.fnsh) !== WAITING) return;
      var w = waiting[r.no] || (waiting[r.no] = { noConfirm: false, noInvoice: false });
      if (!r.ivDate) w.noConfirm = true;
      if (!r.dno) w.noInvoice = true;
    });
    var nos = Object.keys(waiting), count = function(f){ return nos.filter(function(n){ return waiting[n][f]; }).length; };
    var giftTodo = (campaigns || []).reduce(function(a, c){ return a + (Number(c.need) || 0) + (c.wrong || []).length; }, 0);
    var todo = { collect: Object.keys(all).length ? 0 : -1, match: (read.unmatched || []).length, confirm: count('noConfirm'), gift: giftTodo, invoice: count('noInvoice'), ship: nos.length };
    var open = false, hasWork = Object.keys(all).length > 0;
    var steps = STEPS.map(function(s){
      var n = todo[s.id], state;
      if (!hasWork) state = 'wait';
      else if (open) state = 'wait';
      else if (n > 0) { state = 'todo'; open = true; }
      else state = 'done';
      return { id: s.id, name: s.name, who: s.who, state: state, count: Math.max(n, 0) };
    });
    steps.push({ id: 'send', name: '이벗 송장전송', who: '직접', state: 'later', count: 0 });
    steps.push({ id: 'bizem', name: '비젬 송장전송', who: '연결 전', state: 'later', count: 0 });
    return { orders: Object.keys(all).length, waiting: nos.length, steps: withBizem(steps) };
  }

  var API = { withBizem: withBizem, bizemSteps: bizemSteps, preview: preview, previewCampaign: previewCampaign, giftStatus: giftStatus, flow: flow };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_MENSO = API;
})(typeof window !== 'undefined' ? window : this);
