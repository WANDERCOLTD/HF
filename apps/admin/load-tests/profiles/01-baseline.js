// Profile 1 — Baseline. 10 VU × 5 min. Cheap, runnable any time.
// Pass criteria (per #762 + k6.config.js THRESHOLDS):
//   p95 /api/health        < 200ms
//   p95 /api/system/ready  < 500ms
//   p95 POST /api/vapi/webhook < 500ms
//   overall error rate     < 1%

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
        { duration: '30s', target: 10 },
        { duration: '4m',  target: 10 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '30s',
    },
    webhook: {
      executor: 'ramping-vus',
      exec: 'webhookExec',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '4m',  target: 10 },
        { duration: '30s', target: 0 },
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
