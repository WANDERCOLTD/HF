# foh — HumanFirst Front of House

The learner-facing front-of-house experience for HumanFirst. A Next.js 16 app
that mirrors the conventions of `apps/admin` (React 19, Tailwind v4, Vitest,
standalone output, Cloud Run via Kaniko).

Scaffolded from the software factory on 2026-06-08.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
```

## Test

```bash
npm run test         # vitest (jsdom)
npm run test:watch
npm run lint
```

## Build & Deploy

```bash
npm run build        # Next.js standalone output

# Container (Cloud Run, mirrors admin):
docker build -t hf-foh .
gcloud builds submit --config cloudbuild-runner.yaml \
  --project hf-admin-prod --region europe-west2 \
  --substitutions=_TAG=latest,_APP_ENV=DEV .
```

Image: `europe-west2-docker.pkg.dev/hf-admin-prod/hf-docker/hf-foh`.

## Structure

```
app/            # Next.js App Router (layout, page, globals.css)
__tests__/      # unit tests (vitest)
tests/setup.ts  # test setup (jest-dom matchers)
Dockerfile      # multi-stage → runner (standalone server on :8080)
cloudbuild-runner.yaml
next.config.ts  # standalone output + security headers (CSP Report-Only by default)
```

Environment variables: copy `.env.example` → `.env.local`.
