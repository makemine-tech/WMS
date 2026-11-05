/* ============================================================
   메이크창고 전담비서 — 판단 모듈 (secretary.html 짝꿍, 브라우저·Node 공용, 2026-11-01)

   화면과 Firebase 를 모르는 순수 함수만 둔다. 설계서 docs/superpowers/specs/2026-10-31-secretary-phase1-pc-design.md
   이 단계의 헤드비서는 도우미에 ping·read·search 만 보낸다. 저장·채우기·출력 명령은 여기서 막는다.
============================================================ */
(function(root){
  'use strict';
  var MIN = 60 * 1000;
  var RUNNER_ALIVE = 3 * MIN;     /* 생존 신호 1분. 뒤에 깔린 탭의 타이머 지연까지 봐서 3분 */
  var COMMAND_TTL = 10 * MIN;     /* 크롬 지킴이 5분 + 헤드비서 탭 복귀 시간 */
  var HELPER_CMDS = ['ping', 'read', 'search', 'orders', 'matchRead', 'matchSearch', 'relogin', 'counts', 'collectCheck', 'collectStatus', 'confirmCheck', 'confirmStatus', 'formCheck', 'storeCheck', 'storeStatus'];   /* search = 이지어드민 검색 버튼, relogin = 로그인 버튼 한 번, 나머지 = 이벗 읽기. 업무 저장 없음 */
  var HELPER_WRITE = ['matchSave', 'storeGo', 'formPage', 'collectGo', 'confirmGo', 'uploadMenso', 'login', 'fill', 'reset', 'commit', 'printPrep', 'printGo', 'printStatus', 'printEnd', 'printClose'];   /* 합포 분할 화면(사람이 누름)의 요청으로만 보냄. 페이지가 바뀌어도 다시 보내지 않음 */
  var RELAY_CMDS = ['search', 'fill', 'reset', 'commit'];
  /* 송장출력은 불안정해 AI 물류비서에서 뺌 (대표님 2026-11-02). 곡물도감은 일괄합포제외까지, 출력은 합포 분할 화면에서 직접. 다시 켜려면 이 목록을 RELAY_CMDS 에 더하고 흐름도 칸을 되살림 */
  var RELAY_PRINT = ['printPrep', 'printGo', 'printStatus', 'printEnd', 'printClose'];   /* secretary/ezcall 로 받는 합포 분할 화면 요청 */
  var LOGIN_TTL = 2 * MIN;        /* 잠긴 로그인 값의 수명 */
  var RELAY_TTL = 2 * MIN;        /* 늦게 처리된 요청이 저절로 저장되지 않게 */
  var PRINT_IDLE = 3 * MIN;       /* 출력 중 화면 요청이 이만큼 끊기면 화면이 닫힌 것으로 보고 헤드비서가 마무리 */
  var RELAY_HOLD = 30 * MIN;      /* 불러오기·채우기 뒤 사람이 화면을 보는 동안 이지어드민 탭을 새로 열지 않음 */
  var COMMAND_TYPES = ['start', 'menso', 'match_read', 'match_search', 'bizem_check', 'bizem_collect', 'bizem_confirm', 'bizem_form', 'bizem_import', 'ebut_check', 'ebut_collect', 'match_save'];
  var COLLECT_POLL = 5000;        /* 비젬 주문수집 진행 확인 간격 */
  var COLLECT_MAX = 15 * MIN;     /* 이만큼 끝 소식이 없으면 작업을 풀고 사람에게 넘김. 다시 누르지 않음 */
  var MATCH_TERMS = ['아크네스', '멘소래담', '하다라보', '멜라노', '로토', '소프트립스', '핸드베일', '사은품'];   /* 매칭 화면에 미리 읽어 둘 상품 */
  var MENSO_CUST = '2237';        /* 이벗 고객사 맨소레담아시아퍼시픽 */
  var KEEP_ALIVE_MS = 10 * MIN;   /* 로그인 유지 점검 간격 */
  var KEEP_ALIVE_ON = false;      /* 점검이 이지어드민 탭을 새로 열어 송장출력 중 페이지가 넘어감. 안정될 때까지 끔 (대표님 2026-11-02) */
  var PAGE_VER = '2026-11-05b';   /* 고치면 올린다. 헤드비서 탭이 새 판을 보고 작업이 없을 때 새로고침함 */

  var SITES = [
    { id: 'ezadmin', name: '이지어드민', url: 'https://ga89.ezadmin.co.kr/template40.htm?template=DG00', login: 'https://www.ezadmin.co.kr/get_login_server.php', tab: 'mkw_sec_ez', from: 'ez-helper', to: 'ez-helper',
      origin: /^https:\/\/[a-z0-9-]+\.ezadmin\.co\.kr$/ },
    { id: 'ebut', name: '이벗', url: 'https://ebut3pl.co.kr/main', login: 'https://ebut3pl.co.kr/home/docs/login.html', tab: 'mkw_sec_ebut', from: 'ebut-helper', to: 'ebut-helper',
      origin: /^https:\/\/([a-z0-9-]+\.)?ebut3pl\.co\.kr$/ },
    { id: 'bizem', name: '비젬', url: 'https://partner.bizesm.com/Home/MainPage', login: 'https://www.bizesm.com/Home/Login', tab: 'mkw_sec_bizem', from: 'bizem-helper', to: 'bizem-helper', minExt: '1.2.0',
      origin: /^https:\/\/([a-z0-9-]+\.)?bizesm\.com$/ }
  ];
  var RECIPES = { ez_daily: { id: 'ez_daily', name: '이지어드민 비서 미리 보기 (읽기 전용)', supplier: '곡물도감' },
                  menso_read: { id: 'menso_read', name: '맨소래담 사은품 미리 보기 (읽기 전용)' } };
  var DEFAULT_RANGE_DAYS = 7;     /* ez_split 첫 기본값과 같음 */

  function assertSafeCmd(cmd){
    if (HELPER_CMDS.indexOf(cmd) < 0) throw new Error('허용되지 않은 명령: ' + cmd);
  }
  function runnerState(runner, now){
    return runner && runner.ts && now - runner.ts <= RUNNER_ALIVE ? 'on' : 'off';
  }
  function commandExpired(cmd, now){
    return !cmd || !cmd.at || now - cmd.at > COMMAND_TTL;
  }
  /* PDF 가 날짜 폴더로 나뉘는 시간대라 시작하지 않는다 */
  function kstParts(now){
    var d = new Date(Number(now) + 9 * 60 * MIN);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function quietHours(now){
    var p = kstParts(now), m = p.h * 60 + p.mi;
    return m >= 23 * 60 + 30 || m < 30;
  }
  function kstDate(now){
    var p = kstParts(now);
    return p.y + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }
  /* 발주일 기간: 잘못된 시작일은 끝일(오늘) 기준 7일 전으로 */
  function dateRange(from, now){
    var to = kstDate(now);
    var ok = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) && String(from) <= to;
    return { from: ok ? String(from) : kstDate(Number(now) - DEFAULT_RANGE_DAYS * 24 * 60 * MIN), to: to };
  }
  function startBlock(s){
    if (runnerState(s.runner, s.now) !== 'on') return '상시 컴퓨터가 꺼져 있습니다';
    if (s.control && s.control.pause) return '전체 멈춤 상태입니다';
    if (s.job && s.job.state === 'running') return '진행 중인 작업이 있습니다';
    if (quietHours(s.now)) return '23:30~00:30 에는 시작하지 않습니다';
    return '';
  }
  /* 시작 버튼을 어디서 처리할지.
     send = 지금 실행 PC 에 맡김 · ask = 이 컴퓨터로 가져올지 물음 · take = 이 컴퓨터가 맡음 · need_ext = 확장이 없어 못 함 */
  function startChoice(s){
    var on = runnerState(s.runner, s.now) === 'on', mine = !!s.runner && s.runner.id === s.myId;
    if (s.isHead || (on && mine)) return 'send';
    if (!s.hasExt) return on ? 'send' : 'need_ext';
    if (!on) return 'take';
    return s.jobRunning || s.runner.busy ? 'send' : 'ask';
  }
  function jobKey(recipe, date, round){ return recipe + ':' + date + ':' + round; }
  function nextRound(jobs, recipe, date){
    var prefix = recipe + ':' + date + ':', max = 0;
    Object.keys(jobs || {}).forEach(function(k){
      if (k.indexOf(prefix) === 0) max = Math.max(max, Number(k.slice(prefix.length)) || 0);
    });
    return max + 1;
  }
  /* 도우미 ping 응답 → 사이트 상태. 이지어드민은 로그인이 풀리면 DG00 화면이 안 뜬다 */
  function siteState(siteId, r){
    if (siteId === 'ezadmin') return r && r.page === 'DG00' ? { state: 'ok', msg: '로그인 유지, 일괄합포제외 화면 확인' } : { state: 'login', msg: '로그인이 필요합니다' };
    if (r && r.checked === false) return { state: 'error', msg: '이벗 조회 실패: ' + (r.err || '원인 모름') };
    return r && r.login ? { state: 'ok', msg: '로그인 유지' } : { state: 'login', msg: '로그인이 필요합니다' };
  }

  /* 픽셀 사무실에 보여 줄 방 목록. 왼쪽 화면과 같은 실제 상태만 쓰고, 아직 없는 비서의 방은 만들지 않는다 */
  function officeRooms(s){
    var keys = Object.keys(s.jobs || {}).sort(function(a, b){ return (s.jobs[b].at || 0) - (s.jobs[a].at || 0); });
    function latest(recipe){ var k = keys.find(function(x){ return (s.jobs[x].recipe || 'ez_daily') === recipe; }); return k ? s.jobs[k] : null; }
    var job = latest('ez_daily'), menso = latest('menso_read');
    var running = keys.length > 0 && s.jobs[keys[0]].state === 'running', runRecipe = running ? (s.jobs[keys[0]].recipe || 'ez_daily') : '', split = latest('ez_split');
    var on = runnerState(s.runner, s.now) === 'on', sites = s.sites || {}, ok = 0;
    SITES.forEach(function(x){ if (x.id !== 'bizem' && sites[x.id] && sites[x.id].state === 'ok') ok++; });   /* 램프는 방이 있는 비서만 */
    function siteRoom(id, name, idleSay, workSay){
      var v = sites[id];
      if (!on) return { id: id, name: name, mode: 'off', say: '퇴근', count: 0 };
      if (running && runRecipe === 'ez_split' && id === 'ezadmin') return { id: id, name: name, mode: 'work', say: s.jobs[keys[0]].step || '일괄합포제외 중', count: 0 };
      if (running && runRecipe !== 'ez_split' && (runRecipe === 'ez_daily' || id === 'ebut')) return { id: id, name: name, mode: 'work', say: /^(bizem|ebut|match)_/.test(runRecipe) ? (s.jobs[keys[0]].step || '비젬 일하는 중') : runRecipe === 'menso_read' ? '주문 읽는 중' : workSay, count: 0 };
      if (v && v.state !== 'ok') return { id: id, name: name, mode: 'alert', say: v.msg, count: 0 };
      return { id: id, name: name, mode: 'idle', say: idleSay, count: 0 };
    }
    var head = !on ? { id: 'head', name: '헤드비서', mode: 'off', say: '상시 컴퓨터 꺼짐', count: 0 }
      : running ? { id: 'head', name: '헤드비서', mode: 'work', say: '지시 전달 중', count: ok + 1 }
      : s.control && s.control.pause ? { id: 'head', name: '헤드비서', mode: 'alert', say: '전체 멈춤', count: ok + 1 }
      : { id: 'head', name: '헤드비서', mode: 'idle', say: '대기 중', count: ok + 1 };

    var preview = job && job.preview, ez = siteRoom('ezadmin', '이지어드민 비서', preview ? '송장 ' + (preview.invoices || 0) + '장 · 주문 ' + (preview.orders || 0) + '건' : '대기 중', '주문 읽는 중');
    if (ez.mode === 'idle' && job && job.state === 'stopped' && (!preview || ezOpenBlockers(job).length)) { ez.mode = 'alert'; ez.say = '확인 필요'; }
    if (ez.mode === 'idle' && split && split.state !== 'done' && (!job || (split.at || 0) > (job.at || 0))) { ez.mode = 'alert'; ez.say = '일괄합포제외 확인 필요'; }
    if (preview && ez.mode !== 'off') ez.count = Math.ceil((preview.invoices || 0) / 25);   /* 송장 25장마다 묶음 하나 */

    var need = 0, mp = menso && menso.menso;
    if (mp) (mp.campaigns || []).forEach(function(c){ need += Number(c.need) || 0; });
    var eb = siteRoom('ebut', '이벗 비서', mp ? '사은품 넣을 주문 ' + need + '건' : '대기 중', '접속 확인 중');
    if (eb.mode === 'idle' && menso && menso.state === 'stopped') { eb.mode = 'alert'; eb.say = '확인 필요'; }

    var notes = Number(s.noteCount) || 0;
    return [
      { id: 'ceo', name: '대표실', mode: notes ? 'alert' : 'idle', say: notes ? '확인할 일 ' + notes + '건' : '보고 없음', count: 0 },
      head, eb, ez   /* 아래층 왼쪽 이벗, 오른쪽 이지어드민 */
    ];
  }

  /* 사람이 보고 넘길 수 있는 멈춤. 줄 수 불일치·건수 상한은 확인으로 넘기지 못함 */
  var EZ_ACKABLE = /^(모르는 상품|60박스 넘침)/;
  function ezOpenBlockers(job){
    var list = (job && job.preview && job.preview.blockers) || [];
    return job && job.ack ? list.filter(function(b){ return !EZ_ACKABLE.test(b); }) : list;
  }
  /* 이지어드민 흐름도. 합포 분할 화면에서 불러오기를 해야 미리 보기가 생기므로 일괄합포제외가 1번 (대표님 2026-11-03).
     로그인이 풀리면 칸이 아니라 「로그인 필요」 버튼으로 알림. 칸 상태는 시동 때 읽은 곡물도감 자료로만 판단: 나눌 묶음이 있으면 합포제외 차례, 없으면 끝 */
  function ezFlow(site, job, split){
    var loginOk = !!site && site.state === 'ok', p = job && job.preview, open = ezOpenBlockers(job);
    var blocked = !!p && open.length > 0, orders = p ? Number(p.orders) || 0 : 0, packs = p ? Number(p.splitPacks) || 0 : 0;
    var previewOk = loginOk && !!p && !blocked, splitTodo = (loginOk && !p) || (previewOk && packs > 0), doneSplit = previewOk && !packs && orders > 0;
    var splitRun = !!split && split.state === 'running';
    return [
      { id: 'ez_split', name: '일괄합포제외', who: '직접', state: splitRun ? 'run' : splitTodo ? 'todo' : doneSplit ? 'done' : 'wait', count: packs },
      { id: 'ez_preview', name: '주문 미리 보기', who: '비서', state: !loginOk || !p ? 'wait' : blocked ? 'todo' : 'done', count: blocked ? open.length : 0 }
    ];
  }

  /* 사람이 확인한 모르는 상품·60박스 넘침이 그대로면 다음 읽기에도 확인을 이어 감 */
  function ezAckCarry(prev, p){
    var a = prev && prev.preview;
    if (!prev || !prev.ack || !a) return null;
    var has = function(list, key, v){ return (list || []).some(function(x){ return x[key] === v; }); };
    var comps = (p.overComps || []).every(function(c){ return has(a.overComps, 'comp', c.comp); });
    var prods = (p.unknownProds || []).every(function(c){ return has(a.unknownProds, 'prd', c.prd); });
    return comps && prods && ((p.flags || {}).unknown || 0) <= ((a.flags || {}).unknown || 0) ? prev.ack : null;
  }

  var API = { COLLECT_POLL: COLLECT_POLL, COLLECT_MAX: COLLECT_MAX, startChoice: startChoice, LOGIN_TTL: LOGIN_TTL, RELAY_PRINT: RELAY_PRINT, PRINT_IDLE: PRINT_IDLE, EZ_ACKABLE: EZ_ACKABLE, ezAckCarry: ezAckCarry, RELAY_CMDS: RELAY_CMDS, RELAY_TTL: RELAY_TTL, RELAY_HOLD: RELAY_HOLD, HELPER_WRITE: HELPER_WRITE, ezFlow: ezFlow, ezOpenBlockers: ezOpenBlockers, KEEP_ALIVE_ON: KEEP_ALIVE_ON, KEEP_ALIVE_MS: KEEP_ALIVE_MS, officeRooms: officeRooms, MENSO_CUST: MENSO_CUST, MATCH_TERMS: MATCH_TERMS, HELPER_CMDS: HELPER_CMDS, COMMAND_TYPES: COMMAND_TYPES, PAGE_VER: PAGE_VER, SITES: SITES, RECIPES: RECIPES, assertSafeCmd: assertSafeCmd, runnerState: runnerState,
              commandExpired: commandExpired, quietHours: quietHours, kstDate: kstDate, dateRange: dateRange, startBlock: startBlock, jobKey: jobKey, nextRound: nextRound, siteState: siteState };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_CORE = API;
})(typeof window !== 'undefined' ? window : this);
