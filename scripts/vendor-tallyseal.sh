#!/usr/bin/env bash
# Vendor @tallyseal/* packages from the local tallyseal monorepo into HF.
#
# WHY VENDOR (not pnpm workspace-link, not public npm)?
#   - HF is npm-managed (package-lock.json at root).
#   - Tallyseal is pnpm-managed.
#   - All @tallyseal/* packages are private (B1.3 spending freeze; no public npm).
#   - Vendoring via tarballs is the only path that doesn't switch HF's tooling.
#
# WHAT THIS SCRIPT DOES:
#   1. `pnpm pack` each tallyseal package — rewrites workspace:* to concrete version.
#   2. Drops the .tgz files into apps/admin/vendor/tallyseal/.
#   3. `npm install` all tarballs in ONE command — npm resolves transitive @tallyseal/*
#      deps locally instead of hitting the public registry.
#
# RE-RUN WHENEVER:
#   - Tallyseal bumps any package version.
#   - A new @tallyseal/* package is consumed by HF.
#
# PREREQUISITES:
#   - /Users/paulwander/projects/tallyseal exists and is built.
#   - pnpm available globally (used in tallyseal monorepo).
#   - npm available locally (HF's package manager).
set -euo pipefail

TALLYSEAL_ROOT="${TALLYSEAL_ROOT:-/Users/paulwander/projects/tallyseal}"
HF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${HF_ROOT}/apps/admin/vendor/tallyseal"

# Topological order — deps first. See vendor/README.md for the graph.
# 2026-06-04 (items 14+15 pickup): added regulations-ferpa, generator,
# extractor, server per
# ~/projects/tallyseal/docs/notebook/09-operating/hf-tarball-pickup-20260603-items-14-15.md.
PACKAGES=(
  crawcus-spec
  crawcus-tck
  core
  react
  regulations-gdpr
  regulations-ferpa
  regulations-eu-ai-act
  prisma-adapter
  ai-anthropic
  react-assistant-ui
  generator
  extractor
  server
)

if [[ ! -d "${TALLYSEAL_ROOT}" ]]; then
  echo "ERROR: tallyseal not found at ${TALLYSEAL_ROOT}" >&2
  echo "Set TALLYSEAL_ROOT env var if it lives elsewhere." >&2
  exit 1
fi

echo "==> Cleaning ${VENDOR_DIR}"
rm -f "${VENDOR_DIR}"/*.tgz
mkdir -p "${VENDOR_DIR}"

echo "==> Packing ${#PACKAGES[@]} tallyseal packages"
for pkg in "${PACKAGES[@]}"; do
  pkg_dir="${TALLYSEAL_ROOT}/packages/${pkg}"
  if [[ ! -d "${pkg_dir}" ]]; then
    echo "ERROR: package not found: ${pkg_dir}" >&2
    exit 1
  fi
  (cd "${pkg_dir}" && pnpm pack --pack-destination "${VENDOR_DIR}" >/dev/null)
  echo "    packed ${pkg}"
done

echo "==> Installing all tarballs (apps/admin) in one npm command"
cd "${HF_ROOT}/apps/admin"

# All-in-one-command is load-bearing: npm resolves transitive @tallyseal/* deps
# from the install args instead of trying the registry (where private = 404).
TARBALLS=()
for tgz in "${VENDOR_DIR}"/*.tgz; do
  TARBALLS+=("${tgz}")
done

npm install --no-audit --no-fund --legacy-peer-deps "${TARBALLS[@]}"

echo "==> Verify"
npm ls --depth=0 2>/dev/null | grep "@tallyseal/" || {
  echo "ERROR: @tallyseal/* not visible in npm ls" >&2
  exit 1
}

echo "==> Done. ${#PACKAGES[@]} tallyseal packages vendored + installed."
