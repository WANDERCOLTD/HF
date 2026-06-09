#!/usr/bin/env bash
# vendor-tallyseal.sh — refresh vendored Tallyseal packages from a local
# Tallyseal clone.
#
# Usage:
#   ./scripts/vendor-tallyseal.sh                  # default: ~/projects/tallyseal
#   TALLYSEAL_REPO=/path/to/tallyseal ./scripts/vendor-tallyseal.sh
#   ./scripts/vendor-tallyseal.sh crawcus-tck      # pack a single package
#
# Why this exists: @tallyseal/* are private workspace packages. We pack
# them from the Tallyseal repo (which resolves `workspace:*` → semver) and
# drop the resulting tarballs into apps/admin/vendor/tallyseal/, then
# `npm install` against the file: specifier already in package.json.
#
# Discipline:
#   - Use `pnpm pack` (not `npm pack`) — only pnpm resolves `workspace:*`
#     specifiers in the produced tarball metadata.
#   - When bumping a package, update apps/admin/package.json's
#     `"file:vendor/.../<pkg>-<old>.tgz"` entry to the new filename and
#     re-run `npm install` so the lockfile picks up the new shasum.

set -euo pipefail

REPO_ROOT="${TALLYSEAL_REPO:-$HOME/projects/tallyseal}"
HF_VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/tallyseal"

if [ ! -d "$REPO_ROOT/packages" ]; then
  echo "vendor-tallyseal: TALLYSEAL_REPO=$REPO_ROOT does not contain packages/" >&2
  echo "vendor-tallyseal: set TALLYSEAL_REPO env var to point at your Tallyseal clone" >&2
  exit 2
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "vendor-tallyseal: pnpm not on PATH — install pnpm (brew install pnpm) first" >&2
  exit 2
fi

mkdir -p "$HF_VENDOR_DIR"

PACKAGES=("$@")
if [ ${#PACKAGES[@]} -eq 0 ]; then
  # Pack every package whose name appears in apps/admin/package.json as
  # a file:vendor/... specifier.
  mapfile -t PACKAGES < <(
    grep -oE '"@tallyseal/[a-z-]+"' "$HF_VENDOR_DIR/../../package.json" \
      | sed 's/"@tallyseal\///; s/"$//' \
      | sort -u
  )
fi

for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$REPO_ROOT/packages/$pkg"
  if [ ! -d "$pkg_dir" ]; then
    echo "vendor-tallyseal: skipping $pkg — $pkg_dir does not exist" >&2
    continue
  fi
  echo "vendor-tallyseal: packing $pkg ..."
  (cd "$pkg_dir" && pnpm pack >/dev/null)
  # pnpm names tarballs tallyseal-<pkg>-<version>.tgz
  tarball=$(ls "$pkg_dir"/tallyseal-"$pkg"-*.tgz 2>/dev/null | head -1 || true)
  if [ -z "$tarball" ]; then
    echo "vendor-tallyseal: pack produced no tarball for $pkg" >&2
    continue
  fi
  mv "$tarball" "$HF_VENDOR_DIR/"
  echo "vendor-tallyseal: wrote $HF_VENDOR_DIR/$(basename "$tarball")"
done

echo
echo "vendor-tallyseal: done. Next steps:"
echo "  1. Update apps/admin/package.json with the new tarball filenames"
echo "  2. Run 'npm install' to refresh the lockfile"
