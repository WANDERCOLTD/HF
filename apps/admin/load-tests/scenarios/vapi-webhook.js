// VAPI end-of-call-report simulator. HMAC-SHA256 signed to match
// lib/vapi/auth.ts::verifyVapiRequest.
//
// Synthetic payloads only — does NOT trigger a real voice call.

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { baseUrl, vapiSecret } from '../k6.config.js';

/** Build a minimal end-of-call-report payload matching the webhook schema. */
function buildPayload(iter) {
  return JSON.stringify({
    message: {
      type: 'end-of-call-report',
      call: {
        id: `load-test-call-${__VU}-${iter}-${Date.now()}`,
        startedAt: new Date(Date.now() - 60000).toISOString(),
        endedAt: new Date().toISOString(),
      },
      transcript: 'Load test synthetic transcript. The learner said hello and the tutor responded.',
      endedReason: 'customer-ended-call',
    },
  });
}

/** HMAC-SHA256 sign — k6 native crypto, no Node dependency. */
function signPayload(body, secret) {
  if (!secret) return ''; // empty = dev passthrough on staging
  return crypto.hmac('sha256', secret, body, 'hex');
}

export function vapiWebhook() {
  const base = baseUrl();
  const secret = vapiSecret();
  const payload = buildPayload(__ITER);
  const signature = signPayload(payload, secret);

  const headers = {
    'Content-Type': 'application/json',
    ...(signature ? { 'x-vapi-signature': signature } : {}),
  };

  const r = http.post(`${base}/api/vapi/webhook`, payload, {
    headers,
    tags: { scenario: 'vapi_webhook' },
  });

  check(r, {
    'webhook 200': (resp) => resp.status === 200,
    'webhook not 401': (resp) => resp.status !== 401, // 401 = HMAC mismatch — fail loud
  });

  sleep(1);
}
