// Profile 2 — Market-test target capacity proof.
// 100 VU concurrent, ramped (NOT thundering herd), 15 min total.
//
// Scope (Phase 1A safe): health + vapi-webhook only. AI-heavy scenarios
// (extraction-trigger, chat-stream) are Phase 1B — they would trip OpenAI
// 30K TPM and add no signal about the OUR app's concurrency handling.
//
// Pass criteria (per #762 + k6.config.js THRESHOLDS):
//   p95 /api/health        < 200ms
//   p95 /api/system/ready  < 500ms
//   p95 POST vapi-webhook  < 500ms
//   overall error rate     < 1%
//
// Runtime: ~16 min wall (2m ramp + 10m hold + 4m ramp-down)

import { THRESHOLDS } from '../k6.config.js';
import { healthCheck } from '../scenarios/health-check.js';
import { vapiWebhook } from '../scenarios/vapi-webhook.js';

export const options = {
  scenarios: {
    health: {
      executor: 'ramping-vus',
      exec: 'healthExec',
      startVUs: 0,
      stages: [
        { duration: '2m',  target: 50 },   // 0 → 50
        { duration: '3m',  target: 100 },  // 50 → 100
        { duration: '10m', target: 100 },  // hold 100
        { duration: '4m',  target: 0 },    // ramp down
      ],
      gracefulStop: '30s',
    },
    webhook: {
      executor: 'ramping-vus',
      exec: 'webhookExec',
      startVUs: 0,
      stages: [
        { duration: '2m',  target: 50 },
        { duration: '3m',  target: 100 },
        { duration: '10m', target: 100 },
        { duration: '4m',  target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: THRESHOLDS,
};

export function healthExec() {
  healthCheck();
}

export function webhookExec() {
  vapiWebhook();
}
