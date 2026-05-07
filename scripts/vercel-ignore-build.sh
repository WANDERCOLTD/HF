#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — always skip.
#
# HF deploys to Google Cloud Run via Cloud Build (see docs/CLOUD-DEPLOYMENT.md).
# Vercel is not part of the deployment path. This script exists so Vercel
# doesn't fail with "exit code 127: scripts/vercel-ignore-build.sh: No such
# file or directory" when its Build & Development Settings reference it.
#
# Vercel "Ignored Build Step" semantics:
#   exit 0  → SKIP the build (this is what we want)
#   exit 1  → run the build
#
# If you ever need to actually build a Vercel-hosted surface from this repo
# (e.g. a marketing site under apps/web), gate exit 1 on `git diff` against
# the previous deploy SHA touching the relevant path.
#
echo "[vercel-ignore-build] HF deploys via Cloud Run — skipping Vercel build."
exit 0
