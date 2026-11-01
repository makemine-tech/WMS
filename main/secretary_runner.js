/* ============================================================
   메이크창고 전담비서 — 헤드비서 실행기 (secretary.html?run=1 짝꿍, 브라우저·Node 공용, 2026-11-01)

   명령을 받아 정해진 작업만 한다. Firebase 와 탭은 deps 로 받는다.
     deps.store    claimRunner·getRunner·claimCommand·setCommand·getJobs·setJob·getControl·setSite
     deps.openSite 사이트 탭을 열어 도우미 ping 응답을 돌려줌. 안 되면 throw
   1단계 작업은 연결·로그인 점검(check) 하나. 송장·합포를 건드리는 경로가 없다.
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
      var key = C.jobKey('check', date, C.nextRound(jobs, 'check', date));
      await store.setJob(key, { state: 'running', recipe: 'check', trigger: 'start', by: cmd.by || '', at: now, cmd: id });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var results = await checkSites();
        var bad = results.filter(function(r){ return r.state !== 'ok'; });
        var sites = {};
        results.forEach(function(r){ sites[r.id] = { state: r.state, msg: r.msg }; });
        await store.setJob(key, {
          state: bad.length ? 'stopped' : 'done', endedAt: deps.now(), sites: sites,
          notes: bad.map(function(r){ return r.name + ': ' + r.msg; }).join(' / ')
        });
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        /* 진행 중으로 남으면 다음 시동이 계속 막힌다 */
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '점검 중 오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    async function process(id, cmd){
      if (!(await store.claimCommand(id))) return;
      var now = deps.now();
      if (C.commandExpired(cmd, now)) { await store.setCommand(id, { status: 'expired', doneAt: now }); return; }
      if (cmd.type === 'start') return runStart(id, cmd);
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
