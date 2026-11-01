/* ============================================================
   메이크창고 전담비서 — 판단 모듈 (secretary.html 짝꿍, 브라우저·Node 공용, 2026-11-01)

   화면과 Firebase 를 모르는 순수 함수만 둔다. 설계서 docs/superpowers/specs/2026-10-31-secretary-phase1-pc-design.md
   1단계 헤드비서는 도우미에 ping·read 만 보낸다. 저장·출력 명령은 여기서 막는다.
============================================================ */
(function(root){
  'use strict';
  var MIN = 60 * 1000;
  var RUNNER_ALIVE = 3 * MIN;     /* 생존 신호 1분. 뒤에 깔린 탭의 타이머 지연까지 봐서 3분 */
  var COMMAND_TTL = 10 * MIN;     /* 크롬 지킴이 5분 + 헤드비서 탭 복귀 시간 */
  var HELPER_CMDS = ['ping', 'read'];
  var COMMAND_TYPES = ['start'];
  var PAGE_VER = '2026-11-01a';   /* 고치면 올린다. 헤드비서 탭이 새 판을 보고 작업이 없을 때 새로고침함 */

  var SITES = [
    { id: 'ezadmin', name: '이지어드민', url: 'https://ga89.ezadmin.co.kr/template40.htm?template=DG00', tab: 'mkw_sec_ez', from: 'ez-helper', to: 'ez-helper',
      origin: /^https:\/\/[a-z0-9-]+\.ezadmin\.co\.kr$/ },
    { id: 'ebut', name: '이벗', url: 'https://ebut3pl.co.kr/main', tab: 'mkw_sec_ebut', from: 'ebut-helper', to: 'ebut-helper',
      origin: /^https:\/\/([a-z0-9-]+\.)?ebut3pl\.co\.kr$/ }
  ];
  var RECIPES = { check: { id: 'check', name: '연결·로그인 점검' } };

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
  function startBlock(s){
    if (runnerState(s.runner, s.now) !== 'on') return '상시 컴퓨터가 꺼져 있습니다';
    if (s.control && s.control.pause) return '전체 멈춤 상태입니다';
    if (s.job && s.job.state === 'running') return '진행 중인 작업이 있습니다';
    if (quietHours(s.now)) return '23:30~00:30 에는 시작하지 않습니다';
    return '';
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

  var API = { HELPER_CMDS: HELPER_CMDS, COMMAND_TYPES: COMMAND_TYPES, PAGE_VER: PAGE_VER, SITES: SITES, RECIPES: RECIPES, assertSafeCmd: assertSafeCmd, runnerState: runnerState,
              commandExpired: commandExpired, quietHours: quietHours, kstDate: kstDate, startBlock: startBlock, jobKey: jobKey, nextRound: nextRound, siteState: siteState };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_CORE = API;
})(typeof window !== 'undefined' ? window : this);
