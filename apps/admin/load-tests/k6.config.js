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
  if (!u) throw new Error('BASE_URL env var is required (e.g. --env BASE_URL=https://dev.humanfirstfoundation.com)');
  if (u.includes('pilot.') || u.includes('app.') || u.includes('lab.')) {
    throw new Error('Refusing to run against pilot/prod URL: ' + u);
  }
  return u.replace(/\/$/, '');
}

export function vapiSecret() {
  return __ENV.VAPI_SECRET || ''; // empty = dev passthrough on staging when VAPI_WEBHOOK_SECRET unset
}

export function callerId() {
  return __ENV.CALLER_ID || ''; // optional — only used by scenarios that need a real caller
}
