#!/bin/bash
# Stop hook — remind about deploy command after code changes
# Receives JSON on stdin with session context

cd /Users/paulwander/projects/HF || exit 0

# Check if there are uncommitted changes (code was written)
DIRTY=$(git status --porcelain 2>/dev/null | grep -c '^ M\|^??\|^A ')

if [ "$DIRTY" -gt 0 ]; then
  # Check if schema was changed (needs /vm-cpp)
  SCHEMA_CHANGED=$(git diff --name-only 2>/dev/null | grep -c "prisma/schema")
  if [ "$SCHEMA_CHANGED" -gt 0 ]; then
    echo "📦 Schema changed — needs /vm-cpp (migration)"
  else
    echo "📦 Code changed — ready for /vm-cp"
  fi
fi
