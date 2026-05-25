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

  // Refuse pilot + prod
  if (u.includes('pilot.') || u.includes('app.') || u.includes('lab.')) {
    throw new Error('Refusing to run against pilot/prod URL: ' + u);
  }

  // #762 Phase 1B — refuse Cloudflare-fronted URLs. 100k requests/day free-tier
  // cap on the Worker (`still-cake-1d83`) is trivially exhausted by a single
  // Profile 02 (240k reqs). Use the direct Cloud Run URL instead — the harness
  // is testing OUR app, not Cloudflare. Override with USE_CLOUDFLARE=true if
  // intentionally measuring CF behaviour.
  if (u.includes('humanfirstfoundation.com') && __ENV.USE_CLOUDFLARE !== 'true') {
    throw new Error(
      'Refusing to run against Cloudflare-fronted URL: ' + u + '\n' +
      'Use the direct Cloud Run URL (e.g. https://hf-admin-dev-nqep3i44ra-nw.a.run.app) — ' +
      'the Workers free-tier 100k req/day cap is trivially exhausted by a 100-VU profile.\n' +
      'To override (e.g. for measuring CF behaviour), pass --env USE_CLOUDFLARE=true.',
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
