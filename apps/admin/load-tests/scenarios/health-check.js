// Health + readiness probes. No auth needed. Cheap latency anchor.
// k6 scenarios run inside a VU loop — caller sets the iteration cadence.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl } from '../k6.config.js';

export function healthCheck() {
  const base = baseUrl();

  // /api/health — 200ms p95 target
  const h = http.get(`${base}/api/health`, { tags: { scenario: 'health' } });
  check(h, {
    'health 200': (r) => r.status === 200,
    'health body ok': (r) => r.json('ok') === true,
  });

  // /api/system/readiness — 500ms p95 target (hits DB)
  const r = http.get(`${base}/api/system/readiness`, { tags: { scenario: 'readiness' } });
  check(r, {
    'readiness 200': (resp) => resp.status === 200,
    'readiness db connected': (resp) => resp.json('checks.database.ok') === true,
  });

  sleep(1); // 1s pacing between iterations per VU
}
