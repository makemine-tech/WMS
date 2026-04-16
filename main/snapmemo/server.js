/* ============================================================
   SnapMemo v5 — server.js
   로컬 개발/개인 사용 전용 Node 서버 (의존성 없음)

   실행:
     Windows(cmd):  set ANTHROPIC_API_KEY=sk-ant-xxxx && node server.js
     Windows(PS):   $env:ANTHROPIC_API_KEY="sk-ant-xxxx"; node server.js
     macOS/Linux:   ANTHROPIC_API_KEY=sk-ant-xxxx node server.js

   환경변수:
     ANTHROPIC_API_KEY  (필수)
     ANTHROPIC_MODEL    (선택, 기본값 아래 DEFAULT_MODEL)
     PORT               (선택, 기본 3000)
   ============================================================ */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ---------- 설정 ----------
const PORT          = Number(process.env.PORT) || 3000;
const API_KEY       = process.env.ANTHROPIC_API_KEY || '';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MODEL         = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
const MAX_PAYLOAD   = 15 * 1024 * 1024; // 15MB (base64 이미지 고려)
const MAX_TOKENS    = 800;

if (!API_KEY) {
  console.error('\n❌ ANTHROPIC_API_KEY 환경변수가 필요합니다.');
  console.error('   Windows(cmd):  set ANTHROPIC_API_KEY=sk-ant-xxxx && node server.js');
  console.error('   Windows(PS):   $env:ANTHROPIC_API_KEY="sk-ant-xxxx"; node server.js');
  console.error('   macOS/Linux:   ANTHROPIC_API_KEY=sk-ant-xxxx node server.js\n');
  process.exit(1);
}

// ---------- 정적 파일 매핑 ----------
const STATIC_FILES = {
  '/':            { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html':  { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css':  { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js':      { file: 'app.js',     type: 'application/javascript; charset=utf-8' }
};

// ---------- 응답 헬퍼 ----------
function sendJson(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, entry) {
  const filePath = path.join(__dirname, entry.file);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

// ---------- 페이로드 검증 ----------
function validateClientPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: '요청 본문이 객체가 아닙니다' };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, message: 'messages 배열이 필요합니다' };
  }
  return { ok: true };
}

// ---------- /api/analyze 핸들러 ----------
function handleAnalyze(req, res) {
  let size = 0;
  const chunks = [];
  let aborted = false;

  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_PAYLOAD) {
      aborted = true;
      sendJson(res, 413, { error: { message: '이미지 용량이 너무 큽니다 (최대 15MB)' } });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (aborted) return;

    let clientBody;
    try {
      clientBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch {
      return sendJson(res, 400, { error: { message: '잘못된 JSON 형식' } });
    }

    const check = validateClientPayload(clientBody);
    if (!check.ok) {
      return sendJson(res, 400, { error: { message: check.message } });
    }

    // 클라이언트 필드는 messages만 화이트리스팅.
    // model/max_tokens는 서버에서 강제 지정.
    const apiPayload = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: clientBody.messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(apiPayload)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      const parts = [];
      apiRes.on('data', (chunk) => parts.push(chunk));
      apiRes.on('end', () => {
        res.writeHead(apiRes.statusCode || 502, {
          'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(Buffer.concat(parts));
      });
    });

    apiReq.on('error', (e) => {
      sendJson(res, 502, { error: { message: 'API 호출 실패: ' + e.message } });
    });

    apiReq.write(apiPayload);
    apiReq.end();
  });

  req.on('error', () => {
    sendJson(res, 400, { error: { message: '요청 읽기 실패' } });
  });
}

// ---------- 서버 ----------
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  // 로컬 전용 서버지만 CORS는 유지 (편의상)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsed.pathname === '/api/analyze' && req.method === 'POST') {
    return handleAnalyze(req, res);
  }

  if (parsed.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, model: MODEL });
  }

  const staticEntry = STATIC_FILES[parsed.pathname];
  if (staticEntry && req.method === 'GET') {
    return serveStatic(res, staticEntry);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ SnapMemo 실행 중 (model: ${MODEL})`);
  console.log(`👉 브라우저에서 열기: http://localhost:${PORT}`);
  console.log(`   헬스체크:          http://localhost:${PORT}/api/health`);
  console.log(`\n   Ctrl+C 로 종료\n`);
});

// 예기치 않은 에러가 서버를 죽이지 않도록
process.on('uncaughtException', (e) => {
  console.error('uncaughtException:', e);
});
process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection:', e);
});
