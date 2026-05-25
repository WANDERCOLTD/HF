// #191 smoking-gun scenario — drives concurrent VUs against the 5 GET routes
// that ship `new PrismaClient()` per request. Each request opens an extra
// connection pool on its Cloud Run instance. Under enough concurrency, Cloud
// SQL's max-connections cap is hit and we see `too many clients` / connection
// pool timeouts.
//
// Confirmed offending routes from #191 (post-#767 — readiness already fixed):
//   GET /api/calls/scores
//   GET /api/calls/rewards
//   GET /api/transcripts
//   GET /api/prompt-blocks
//   GET /api/users
//
// All five require auth. We send a session cookie (passed via env). Without
// the cookie the route returns 401 and the test would pass trivially —
// fail loud in that case.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl } from '../k6.config.js';

const SESSION_COOKIE = __ENV.SESSION_COOKIE || '';

/** Routes from #191. Tagged for per-route latency breakdown. */
const ROUTES = [
  { path: '/api/calls/scores', tag: 'calls_scores' },
  { path: '/api/calls/rewards', tag: 'calls_rewards' },
  { path: '/api/transcripts', tag: 'transcripts' },
  { path: '/api/prompt-blocks', tag: 'prompt_blocks' },
  { path: '/api/users', tag: 'users' },
];

export function prismaSingletonProbe() {
  const base = baseUrl();
  if (!SESSION_COOKIE) {
    // Fail loudly — auth-less probes are useless
    throw new Error('SESSION_COOKIE env var is required for prisma-singleton-probe');
  }

  // Round-robin through the 5 routes by VU iteration
  const route = ROUTES[__ITER % ROUTES.length];
  const headers = {
    Cookie: SESSION_COOKIE,
  };

  const r = http.get(`${base}${route.path}`, {
    headers,
    tags: { scenario: 'prisma_probe', route: route.tag },
  });

  check(r, {
    'not 401 (auth ok)': (resp) => resp.status !== 401,
    'not 5xx': (resp) => resp.status < 500,
    'not connection timeout': (resp) => resp.status !== 0,
  });

  sleep(0.5); // tighter pacing — we want to PUSH the pool
}
