// smoke.js — минимальный smoke-тест Kilo Code /chat/completions
//
// 10 запросов, форма запроса как в max_perf.js, без контекста и пауз.
//
// Запуск:
  // k6 run \
  //   --env BASE_URL=https://alfagen.alfabank.ru/continue-dev/v1 \
  //   --env MODEL=deepseek-ai/DeepSeek-V4-Flash-0731 \
  //   --env API_KEY=20a41642-7a5b-4d03-bdc0-8e876063a001 \
  //   smoke.js

import http from 'k6/http';
import { check } from 'k6';

// ============================ ENV ============================
const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
const MODEL = __ENV.MODEL || 'default';
const API_KEY = __ENV.API_KEY || '';

// ======================= STATIC PAYLOAD ======================
const SYSTEM_PROMPT = 'You are Kilo Code, a highly skilled software engineer.';
const USER_TEXT = 'Reply with a single word: OK.';

// ======================== OPTIONS ============================
export const options = {
  scenarios: {
    smoke: {
      executor: 'shared-iterations',
      vus: 1,                    // один VU — последовательные 10 запросов
      iterations: 10,            // ровно 10 итераций
    },
  },
  thresholds: {
    'http_req_failed': ['rate<=0.1'],       // smoke: допускаем 1 ошибку из 10
    'http_req_duration': ['p(95)<120000'],  // p95 < 2 мин
  },
};

// ========================= DEFAULT ===========================
export default function () {
  const sessionAffinity = `ses_smoke_${__VU}_${__ITER}`;

  const payload = {
    model: MODEL,
    max_tokens: 64,                       // smoke: короткий ответ
    top_p: 0.95,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'text', text: USER_TEXT }] },
    ],
    stream: true,
    stream_options: { include_usage: true },
  };

  const res = http.post(`${BASE_URL}/chat/completions`, JSON.stringify(payload), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Kilo-Code/7.3.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13',
      'http-referer': 'https://kilocode.ai',
      'x-title': 'Kilo Code',
      'x-session-affinity': sessionAffinity,
    },
    timeout: '120s',
    tags: { name: 'chat/completions' },   // чтобы все 10 запросов были в одной серии
  });

  const hasSse = res.body && res.body.indexOf('data:') !== -1;
  const hasDone = res.body && res.body.indexOf('[DONE]') !== -1;

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has SSE data: lines': () => hasSse,
    'has [DONE]': () => hasDone,
  });

  if (!ok) {
    console.log(
      `FAIL iter=${__ITER} status=${res.status} duration=${res.timings.duration}ms ` +
      `body=${res.body ? res.body.slice(0, 300) : '<empty>'}`
    );
  }
}