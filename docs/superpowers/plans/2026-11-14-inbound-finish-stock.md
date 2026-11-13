# 입고검수 작업 종료 → 재고 자동 입고 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고 시스템(star_coupang.html)의 작업 종료 버튼이 검수 결과를 재고관리 입고 기록으로 올리고(초과 제외) 세션을 정리한다.

**Architecture:** 순수 계산 함수 `inboundBuildEntries` 가 rows·boxes 로 입고 기록 목록과 특이사항을 만든다. 버튼은 재고관리 로그를 한 번 읽어 겹침(같은 박스·동시입출고)을 확인하고 미리 보기 창을 띄운 뒤, 확인 시 `wms_sync/groups/{gid}/star_instock/logs` 에 한 번에 update 하고 기존 세션 정리를 실행한다.

**Tech Stack:** 단일 HTML 페이지(바닐라 JS, Firebase RTDB compat 10.13.2), 시험은 node vm 하네스.

**Spec:** docs/superpowers/specs/2026-11-14-inbound-finish-stock-design.md

## Global Constraints
- 입고 기록 형식 = star_instock 엑셀 일괄 입고와 같음: `{type:'in', source:'excel', batchId:'B'+시각, batchName:'입고검수 '+작업명, box, brand, code, barcode, altBarcode, name, material, color, size, origin, qty, defQty, note:'', ts, by}`.
- 정상 입고 = min(실입고, 목표), 목표 = 입고예정 − 기존수량 (classifyRow 와 같음). 목표 ≤ 0 이거나 예정 리스트가 없는 작업(startedEmpty)은 자르지 않는다.
- 넘친 수량은 마지막에 찍은 박스(ts 큰 순)부터 뺀다. 불량(defItems)은 자르지 않는다.
- 예정에 없는 신규 행(isNew)은 기본 제외, 미리 보기 체크 시 포함.
- 대체바코드는 행 값 그대로 (추측·변형 금지).
- 같은 박스바코드의 입고 기록이 재고관리에 이미 있으면 기본으로 막는다.
- 문구는 한국어.

## Review Focus
- 같은 품목이 여러 박스에 나뉜 채 초과 → 마지막 박스부터 빠지고 합계 = 목표.
- 예정 0·기존수량 ≥ 예정인 행에 스캔 있음 → 전부 초과로 빠지고 특이사항에 표시.
- 자료 없이 시작한 작업(startedEmpty) → 자르지 않고 스캔 그대로.
- 불량만 있는 박스·행 → defQty 만 있는 기록 (qty 0) 으로 남음.
- 이미 엑셀로 올린 작업 → 박스 겹침으로 막히고 「입고 없이 정리」로 끝낼 수 있음.

---

### Task 1: 입고 기록 계산 함수

**Files:**
- Modify: `main/star_coupang.html` (downloadForInstock 바로 위에 함수 추가)
- Test: scratchpad `t_inbound.js` (node vm 하네스 — 함수 추출 후 실행)

**Interfaces:**
- Produces: `inboundBuildEntries(opts) -> { entries: Array<log>, trimmed: Array<{rowIdx, name, barcode, recv, target, cut}>, newRows: Array<{rowIdx, barcode, name, qty}>, totals: {qty, def, lines} }`
  - `opts = { rows, boxes, startedEmpty:bool, includeNew:bool, batchId, batchName, by, ts }`

- [ ] **Step 1: 시험 작성** — 하네스 사례:
  - 행0 예정 10·기존 0, 박스 B1(ts1) 6 + B2(ts2) 6 → B1 qty 6, B2 qty 4, trimmed[0].cut 2.
  - 행1 예정 5·기존 5, B1 3개 → 기록 없음, trimmed cut 3.
  - 행2 isNew, B2 2개 → includeNew false 면 기록 없음·newRows 1건, true 면 qty 2.
  - 행3 예정 4, B1 정상 0·불량 2 → qty 0·defQty 2 기록.
  - startedEmpty true 면 행0 B1 6·B2 6 그대로.
- [ ] **Step 2: 실행해 실패 확인** — `node t_inbound.js main/star_coupang.html` → "inboundBuildEntries 없음".
- [ ] **Step 3: 구현** — 행별 recv 합 → cut = max(0, recv − max(0,target)) (startedEmpty·isNew 포함 시 cut 0), 박스를 ts 내림차순으로 돌며 cut 소진, 그 뒤 박스 ts 오름차순 × 품목 순으로 기록 생성 (downloadForInstock 와 같은 열 매핑).
- [ ] **Step 4: 실행해 통과 확인**.
- [ ] **Step 5: 커밋**.

### Task 2: 미리 보기 창 · 입고 반영 · 버튼

**Files:**
- Modify: `main/star_coupang.html` — 698행 버튼 문구, `finishWorkAndClear()` 를 미리 보기 흐름으로, 새 함수 `inboundOpenPreview()`, `inboundCommit()`, `finishClearOnly()`.

**Interfaces:**
- Consumes: `inboundBuildEntries` (Task 1).
- Produces: 버튼 `🏁 작업 종료 + 입고 잡기 + 세션 종료` → `inboundOpenPreview()`; 창 안 버튼 「📥 입고 잡고 종료」 → `inboundCommit()`, 「입고 없이 세션만 정리」 → `finishClearOnly()`(기존 finishWorkAndClear 본문).

- [ ] **Step 1:** 재고관리 로그 1회 읽기(`star_instock/logs`) → 같은 박스바코드 입고 기록 수, 최근 30일 동시입출고(source 'crossdock', type 'in') 와 겹치는 바코드를 🔴(미정리)/🟡(수량 같음)/🟢 로 분류.
- [ ] **Step 2:** 창 표시: 품목 줄 수·입고 수량·불량, 특이사항(초과 잘라냄 목록, 신규 바코드 + 「포함」 체크, 동시입출고 겹침, 같은 박스 이미 입고 n건 — 있으면 입고 버튼 잠금 + 「그래도 입고」 체크로만 풀림), 미완료 행 수.
- [ ] **Step 3:** `inboundCommit`: entries 를 push key 로 한 번에 `firebase.database().ref().update`, 성공 시 완료 안내(건수·수량·batchName) 후 `finishClearOnly(true)`(확인창 생략). 실패 시 세션 유지·오류 표시.
- [ ] **Step 4:** node 문법 검사 + Task 1 하네스 재실행.
- [ ] **Step 5:** 커밋 · main 푸시 · 라이브 반영 확인 (`curl makewon.com/star_coupang.html | grep inboundBuildEntries`).
- [ ] **Step 6:** 로그인 상태면 브라우저에서 현재 작업(1020입고_AG813_AG884_AG887)으로 `inboundBuildEntries` 결과만 계산해 합계·잘린 수량 확인 (반영은 대표님이 버튼으로).
