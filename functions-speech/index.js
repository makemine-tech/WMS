/* ===========================================================
   WMS 음성 입출고 — 서버 음성 인식 (Google Speech-to-Text v2)

   왜 필요한가:
     브라우저 Web Speech API(webkitSpeechRecognition)는 범용 받아쓰기라
     "서리태15" / "에이 십" / "파렛트" 같은 현장 어휘를 알려줄 통로가 없다.
     (표준의 SpeechGrammarList 는 크롬이 무시한다.)
     STT v2 는 inline PhraseSet 으로 어휘를 boost 할 수 있어서,
     그 창고에 실제로 등록된 상품명을 우선적으로 듣도록 디코딩이 바뀐다.

   호출: firebase.app().functions('asia-southeast1').httpsCallable('sttVoice')
     입력  { audio: base64, mime: 'audio/webm;codecs=opus', phrases: ['서리태15', ...] }
     출력  { ok, alts: [문장…], adapted: bool, model: 'short', ms }

   인증 필수. 오디오는 저장하지 않고 메모리에서 인식 후 버린다.
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { SpeechClient } = require('@google-cloud/speech').v2;

if (!admin.apps.length) admin.initializeApp();

const FUNC_REGION = 'asia-southeast1';
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
/* 어휘 부스트(model adaptation)는 global 엔드포인트의 short/long 모델에서 동작한다 */
const STT_LOCATION = 'global';
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;   /* 약 20초 분량의 opus — 명령 한 마디로 충분 */
const MAX_PHRASES = 400;                    /* inline PhraseSet 안전 한도 */

let _client = null;
function client() {
  if (!_client) _client = new SpeechClient();   /* ADC — 같은 프로젝트 서비스 계정, API 키 없음 */
  return _client;
}

/* ─── 어휘 목록 만들기 ───
   상품명은 강하게, 위치 알파벳·동작어는 중간 세기로 올린다.
   boost 는 20 을 넘기면 오히려 없는 말을 만들어내므로 올리지 않는다. */
const LETTER_SAY = ['에이','비','씨','디','이','에프','지','에이치','아이','제이','케이','엘','엠',
  '엔','오','피','큐','알','에스','티','유','브이','더블유','엑스','와이','제트'];
const COMMAND_WORDS = ['입고','출고','입고대기','출고대기','파렛트','유통기한','수량','층','개','씩',
  '취소','되돌려','뭐야','뭐 있어','이동','등록'];

function buildPhrases(rawProducts) {
  const seen = new Set();
  const out = [];
  const add = (value, boost) => {
    const v = String(value || '').trim().slice(0, 100);
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, boost });
  };
  (Array.isArray(rawProducts) ? rawProducts : []).slice(0, MAX_PHRASES).forEach((p) => add(p, 20));
  LETTER_SAY.forEach((l) => add(l, 12));
  COMMAND_WORDS.forEach((w) => add(w, 12));
  return out.slice(0, MAX_PHRASES);
}

function recognizeConfig(phrases) {
  const config = {
    autoDecodingConfig: {},        /* webm/opus 를 헤더에서 알아서 판별 — v2 의 장점 */
    languageCodes: ['ko-KR'],
    model: 'short',                /* 짧은 명령어에 최적화된 모델 */
    features: { maxAlternatives: 5 },
  };
  if (phrases.length) {
    config.adaptation = { phraseSets: [{ inlinePhraseSet: { phrases } }] };
  }
  return config;
}

function altsFrom(response) {
  const alts = [];
  (response.results || []).forEach((r) => {
    (r.alternatives || []).forEach((a, i) => {
      const t = String(a.transcript || '').trim();
      if (!t) return;
      if (!alts[i]) alts[i] = '';
      alts[i] = (alts[i] ? alts[i] + ' ' : '') + t;
    });
  });
  return alts.filter(Boolean);
}

exports.sttVoice = onCall(
  {
    region: FUNC_REGION,
    memory: '512MiB',
    timeoutSeconds: 60,
    cors: true,
  },
  async (request) => {
    const t0 = Date.now();
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

    const data = request.data || {};
    const b64 = typeof data.audio === 'string' ? data.audio : '';
    if (!b64) throw new HttpsError('invalid-argument', '오디오가 비어 있어요');

    let audio;
    try {
      audio = Buffer.from(b64, 'base64');
    } catch (e) {
      throw new HttpsError('invalid-argument', '오디오 형식이 올바르지 않아요');
    }
    if (!audio.length) throw new HttpsError('invalid-argument', '오디오가 비어 있어요');
    if (audio.length > MAX_AUDIO_BYTES) {
      throw new HttpsError('invalid-argument', '녹음이 너무 길어요 — 한 문장씩 말씀해 주세요');
    }

    const phrases = buildPhrases(data.phrases);
    const recognizer = `projects/${PROJECT_ID}/locations/${STT_LOCATION}/recognizers/_`;

    /* 1차: 어휘 부스트 켜고 시도.
       모델·언어 조합에 따라 adaptation 이 거부될 수 있으므로, 그때는 끄고 한 번 더. */
    let response;
    let adapted = phrases.length > 0;
    try {
      [response] = await client().recognize({
        recognizer,
        config: recognizeConfig(phrases),
        content: audio,
      });
    } catch (err) {
      const code = err && err.code;
      const retryable = adapted && (code === 3 || code === 9);   /* INVALID_ARGUMENT / FAILED_PRECONDITION */
      if (!retryable) {
        logger.error('STT 실패', { uid, code, message: err && err.message });
        if (code === 7) {
          throw new HttpsError('permission-denied',
            'Speech-to-Text 권한이 없어요 — 서비스 계정에 speech.client 역할이 필요해요');
        }
        throw new HttpsError('internal', '음성 인식에 실패했어요: ' + ((err && err.message) || err));
      }
      logger.warn('어휘 부스트 미지원 — 부스트 없이 재시도', { code, message: err && err.message });
      adapted = false;
      [response] = await client().recognize({
        recognizer,
        config: recognizeConfig([]),
        content: audio,
      });
    }

    const alts = altsFrom(response);
    const ms = Date.now() - t0;
    logger.info('STT 완료', { uid, adapted, phrases: phrases.length, bytes: audio.length, alts: alts.length, ms });
    return { ok: true, alts, adapted, model: 'short', ms };
  }
);
