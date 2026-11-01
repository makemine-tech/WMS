/* ============================================================
   메이크창고 전담비서 — 헤드비서 실행기 (secretary.html?run=1 짝꿍, 브라우저·Node 공용, 2026-11-01)

   명령을 받아 정해진 작업만 한다. Firebase 와 탭은 deps 로 받는다.
     deps.store    claimRunner·getRunner·claimCommand·setCommand·getJobs·setJob·getControl·setSite
     deps.openSite 사이트 탭을 열어 도우미 ping 응답을 돌려줌. 안 되면 throw
     deps.ezPreview({ from, to }) 곡물도감 검색 후 secretary_ez.preview 결과를 돌려줌
   지금 작업은 연결·로그인 점검 + 읽기 전용 미리 보기(ez_daily A 단계). 송장·합포를 저장하는 경로가 없다.
============================================================ */
(function(root){
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./secretary_core.js') : root.SECRETARY_CORE;

  function createRunner(deps){
    var store = deps.store;
    var chain = Promise.resolve();

    async function claim(){
      var ok = await store.claimRunner(deps.runnerId, deps.info || {});
      if (!ok) return false;
      /* 앞 탭이 작업 중에 꺼졌으면 진행 중으로 남아 있음. 시동을 막지 않게 정리 */
      var jobs = (await store.getJobs()) || {};
      for (var k of Object.keys(jobs)) {
        if (!jobs[k] || jobs[k].state !== 'running') continue;
        await store.setJob(k, { state: 'interrupted', endedAt: deps.now(), notes: '헤드비서 탭이 다시 켜져 중단 처리' });
        if (jobs[k].cmd) await store.setCommand(jobs[k].cmd, { status: 'interrupted', doneAt: deps.now() });
      }
      return true;
    }

    async function checkSites(){
      var results = [];
      for (var site of C.SITES) {
        var r;
        try {
          var reply = await deps.openSite(site);
          r = C.siteState(site.id, reply);
          r.ver = (reply && reply.ver) || '';
        } catch (e) {
          r = { state: 'error', msg: String((e && e.message) || e), ver: '' };
        }
        r.checkedAt = deps.now();
        await store.setSite(site.id, r);
        results.push({ id: site.id, name: site.name, state: r.state, msg: r.msg });
      }
      return results;
    }

    async function runStart(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('ez_daily', date, C.nextRound(jobs, 'ez_daily', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'ez_daily', trigger: 'start', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var results = await checkSites();
        var bad = results.filter(function(r){ return r.state !== 'ok'; });
        var sites = {};
        results.forEach(function(r){ sites[r.id] = { state: r.state, msg: r.msg }; });
        var notes = bad.map(function(r){ return r.name + ': ' + r.msg; });
        var ez = results.find(function(r){ return r.id === 'ezadmin'; });
        var stop = !ez || ez.state !== 'ok';   /* 이벗 문제는 이지어드민 비서를 막지 않고 알리기만 함 */
        var patch = { endedAt: 0, sites: sites };
        if (!stop) {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.preview = await deps.ezPreview(range);
            if (patch.preview.blockers.length) { stop = true; notes = notes.concat(patch.preview.blockers); }
          } catch (e) {
            stop = true;
            notes.push('주문 읽기 실패: ' + String((e && e.message) || e));
          }
        }
        patch.state = stop ? 'stopped' : 'done';
        patch.notes = notes.join(' / ');
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        /* 진행 중으로 남으면 다음 시동이 계속 막힌다 */
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '점검 중 오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    /* 맨소래담: 이벗 로그인 점검 → 주문서목록 읽기 → 행사표로 사은품 대상 계산. 이벗에 쓰지 않음 */
    async function runMenso(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('menso_read', date, C.nextRound(jobs, 'menso_read', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'menso_read', trigger: 'menso', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var ebut = C.SITES.find(function(s){ return s.id === 'ebut'; }), r;
        try { var reply = await deps.openSite(ebut); r = C.siteState('ebut', reply); r.ver = (reply && reply.ver) || ''; }
        catch (e) { r = { state: 'error', msg: String((e && e.message) || e), ver: '' }; }
        r.checkedAt = deps.now();
        await store.setSite('ebut', r);
        var patch = { state: 'stopped', endedAt: 0, notes: '' };
        if (r.state !== 'ok') patch.notes = '이벗: ' + r.msg;
        else {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.menso = await deps.mensoPreview(range);
            patch.notes = patch.menso.blockers.join(' / ');
            if (!patch.menso.blockers.length) patch.state = 'done';
          } catch (e) { patch.notes = '주문 읽기 실패: ' + String((e && e.message) || e); }
        }
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    async function process(id, cmd){
      if (!(await store.claimCommand(id))) return;
      var now = deps.now();
      if (C.commandExpired(cmd, now)) { await store.setCommand(id, { status: 'expired', doneAt: now }); return; }
      if (cmd.type === 'start') return runStart(id, cmd);
      if (cmd.type === 'menso') return runMenso(id, cmd);
      await store.setCommand(id, { status: 'refused', why: '모르는 명령', doneAt: now });
    }

    /* 명령은 한 번에 하나씩. 실패해도 다음 명령을 막지 않음 */
    function handleCommand(id, cmd){
      var run = chain.then(function(){ return process(id, cmd); });
      chain = run.catch(function(){});
      return run;
    }

    return { claim: claim, checkSites: checkSites, handleCommand: handleCommand };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRunner: createRunner };
  else root.SECRETARY_RUNNER = { createRunner: createRunner };
})(typeof window !== 'undefined' ? window : this);
