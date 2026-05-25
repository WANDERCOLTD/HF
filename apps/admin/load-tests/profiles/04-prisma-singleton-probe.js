// Profile 4 — direct evidence test for #191's 22 remaining new-PrismaClient
// routes. 50 VU for 60s, hitting 5 routes round-robin.
//
// Pass criteria:
//   - Zero 5xx responses
//   - Zero connection timeouts (status 0)
//   - p95 < 1500ms (these are list-ish GETs, not heavy queries)
//
// If this FAILS, that's the direct evidence #191 needs — we then know which
// route pattern triggers pool exhaustion, and can fix the others without
// guessing.
//
// Requires SESSION_COOKIE env var (admin session cookie). Pull from your
// browser dev tools after logging into the target env. Cookie name varies
// by env; check Network tab.

import { prismaSingletonProbe } from '../scenarios/prisma-singleton-probe.js';

export const options = {
  scenarios: {
    probe: {
      executor: 'ramping-vus',
      exec: 'probeExec',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '60s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:prisma_probe}': ['p(95)<1500'],
    'http_req_failed{scenario:prisma_probe}': ['rate<0.01'],
  },
};

export function probeExec() {
  prismaSingletonProbe();
}
