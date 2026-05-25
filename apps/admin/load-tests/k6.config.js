// Shared k6 thresholds + env plumbing. Imported by every profile.
// Closes #762 Phase 1.

/** Pass criteria — per #762 ACs. */
export const THRESHOLDS = {
  // Probes
  'http_req_duration{scenario:health}': ['p(95)<200'],
  'http_req_duration{scenario:readiness}': ['p(95)<500'],

  // Webhook (HMAC-signed)
  'http_req_duration{scenario:vapi_webhook}': ['p(95)<500'],

  // Pipeline (Phase 1B — not exercised here)
  'http_req_duration{scenario:pipeline}': ['p(95)<2000'],

  // Aggregate error budget
  'http_req_failed': ['rate<0.01'],
};

/** Env-var helpers — k6 exposes `__ENV` for cli/--env arguments. */
export function baseUrl() {
  const u = __ENV.BASE_URL;
  if (!u) throw new Error('BASE_URL env var is required (e.g. --env BASE_URL=https://hf-admin-dev-nqep3i44ra-nw.a.run.app)');

  // Refuse pilot + prod (no load against real-user infra).
  if (u.includes('pilot.') || u.includes('app.') || u.includes('lab.')) {
    throw new Error('Refusing to run against pilot/prod URL: ' + u);
  }

  // #762 Phase 1B — refuse Cloudflare-fronted URLs by default.
  // Profile 02's 240k requests trivially exhausted the Workers free-tier
  // 100k/day cap on 2026-05-25, leaving dev.humanfirstfoundation.com
  // unreachable via Cloudflare until UTC midnight. Force the direct Cloud
  // Run URL (hf-admin-*-nqep3i44ra-nw.a.run.app) — that's the app surface
  // we want to test anyway. Override with USE_CLOUDFLARE=true if
  // intentionally measuring CF behaviour.
  if (u.includes('humanfirstfoundation.com') && __ENV.USE_CLOUDFLARE !== 'true') {
    throw new Error(
      'Refusing to run against Cloudflare-fronted URL: ' + u + '\n' +
      'Use the direct Cloud Run URL (e.g. https://hf-admin-dev-nqep3i44ra-nw.a.run.app).\n' +
      'To override (only when intentionally measuring CF), pass --env USE_CLOUDFLARE=true.',
    );
  }

  return u.replace(/\/$/, '');
}

export function vapiSecret() {
  return __ENV.VAPI_SECRET || ''; // empty = dev passthrough on staging when VAPI_WEBHOOK_SECRET unset
}

export function callerId() {
  return __ENV.CALLER_ID || ''; // optional — only used by scenarios that need a real caller
}
