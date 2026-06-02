# tests/fixtures/

Reference artefacts produced during Sprint C end-to-end verification.

## `sprint-c-enrollment-bundle.audit.json`

The first audit bundle produced by HF Sprint C — captured from a complete happy-path enrolment intake on hf-dev. Satisfies GitHub issue #993 AC #10 ("composeAuditBundle() output saved as fixture").

| Field | Value |
|---|---|
| `bundleVersion` | `0.1.0` |
| `events.length` | 9 (2 DisclosureDelivered + 6 CapturedTurn + 1 ProjectionCommit) |
| `intent.state` | `committed` |
| `intent.snapshot` | `{ firstName, lastName, email }` — fake test data (Sarah / Wright / sarah@example.com), no real PII |
| `chainProof.length` | 9 (one entry per event) |

### How it was produced

```sh
INTENT_ID=$(curl -s -X POST http://localhost:3000/api/intake/bootstrap \
  -H 'content-type: application/json' \
  -d '{"chatSessionId":"fixture-2026-06-02","specKey":"EnrollmentIntake"}' \
  | jq -r .intentId)
for msg in "Sarah" "Wright" "sarah@example.com"; do
  curl -s -X POST http://localhost:3000/api/intake/chat \
    -H 'content-type: application/json' \
    -d "{\"intentId\":\"$INTENT_ID\",\"chatSessionId\":\"fixture-2026-06-02\",\"message\":\"$msg\"}" > /dev/null
done
curl -s "http://localhost:3000/api/intake/audit-bundle?intentId=$INTENT_ID" \
  | python3 -m json.tool > tests/fixtures/sprint-c-enrollment-bundle.audit.json
```

### What it's NOT

- **Not a snapshot test target.** `intentId`, event `id`s, `timestamp`, `contentHash`, `prevHash`, and `chainProof` entries change every run (UUIDv7 + per-event SHA-256). The fixture is reference material, not a regression baseline.
- **Not real PII.** The captured values are fake test data. Real-traffic bundles carry real PII and must be redacted before being committed.

### Phase 1.5 successor

When PrismaEventStore wiring lands (deferred per the spike's honest-scope statement at `lib/intake/session-store.ts`), produce a fresh fixture with `event-store: prisma` instead of `event-store: in-memory` and supersede this one. The bundle SHAPE should be unchanged.
