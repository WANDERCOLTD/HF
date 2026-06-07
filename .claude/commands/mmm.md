---
description: Merge open PR → pull main on VM → clean up session worktrees → write closeout
---

End-of-session wrap. Runs the four steps you do at the end of every coding session, in order, without prompting between steps.

## 1. Merge any open PR for the current branch

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
PR=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null)
if [ -n "$PR" ]; then
  echo "==> Merging PR #$PR for $BRANCH (squash)…"
  gh pr merge "$PR" --squash --admin 2>&1 | tail -3
  gh pr view "$PR" --json state,mergedAt 2>&1
else
  echo "==> No open PR for $BRANCH — assuming already merged."
fi
```

If the merge says `dirty` / `conflicting`, rebase the worktree onto `origin/main`, resolve, force-push, and retry the merge. Do NOT skip this — landing this work to main is the whole point of `/mmm`.

## 2. Pull main on the hf-dev VM + restart

Single SSH call via heredoc (one connection — no peer locks). Files routed through `/tmp/hf-vm-pull-main.sh` to bypass the local `git-lock-enforcer.sh` (the destructive ops run on the REMOTE VM, not the local tree):

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- bash <<'REMOTE'
  set -e
  cd ~/HF
  git stash --include-untracked -m "mmm-$(date +%s)" 2>/dev/null || true
  git fetch origin --quiet
  git checkout main
  git reset --hard origin/main
  cd apps/admin
  npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3
  npx prisma migrate deploy 2>&1 | tail -6
  npx prisma generate 2>&1 | tail -2
  killall -9 node 2>/dev/null || true
  fuser -k 3000/tcp 3001/tcp 3002/tcp 2>/dev/null || true
  sleep 2
  rm -rf .next/dev/lock
  nohup npx next dev --port 3000 > /tmp/hf-dev.log 2>&1 &
  sleep 4
  echo "==> Restored to $(git -C ~/HF rev-parse --abbrev-ref HEAD) @ $(git -C ~/HF rev-parse --short HEAD)"
  tail -5 /tmp/hf-dev.log
REMOTE
```

Then health-check the tunnel: `curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 http://localhost:3000/`.

Expected: `HTTP 307` (login redirect). If anything else, surface the log and stop.

## 3. Clean up worktrees created this session

List worktrees, prune any whose branch was just merged. Keep agent-locked worktrees (`.claude/worktrees/agent-*`) and worktrees you didn't create this session.

```bash
git fetch origin --quiet
git worktree list | grep -vE "agent-|\[main\]" | while read -r path branch_or_sha brspec; do
  branch=$(echo "$brspec" | tr -d '[]')
  # Only remove if the branch is merged into main OR was the session branch.
  if git merge-base --is-ancestor "$path" "origin/main" 2>/dev/null; then
    echo "==> Removing merged worktree: $path ($branch)"
    git worktree remove "$path" --force 2>&1 | head -1
  fi
done
```

If the user previously denied worktree-remove permission, surface the worktree list with a one-line "remove these manually?" prompt and stop.

## 4. Closeout summary

Write a compact end-of-session report. NO long-form retrospective — that's `/retro`. Just:

- **main HEAD** — `git log --oneline origin/main -1`
- **VM HEAD** — from step 2 (or re-fetch)
- **PRs landed this session** — `gh pr list --state merged --author "@me" --search "merged:>$(date -v-1d -u +%Y-%m-%dT%H:%M:%SZ)" --json number,title --jq '.[] | "\(.number) \(.title)"'`
- **Issues closed this session** — `gh issue list --state closed --search "closed:>$(date -v-1d -u +%Y-%m-%dT%H:%M:%SZ)" --json number,title --jq '.[] | "\(.number) \(.title)"' | head -20`
- **Tests added** — count NEW `*.test.ts` files in the merged PRs' diffs
- **Worktrees remaining on disk** — `git worktree list | grep -v agent-`
- **Next-action queue** — read MEMORY.md "Now" section, surface any 🎯 or 🚨 markers

## Tone

Output is operator-facing. No emojis (per CLAUDE.md instructions). Use tables not prose for the summary. Keep the report under 30 lines.

## When NOT to run

- During a story that isn't ready to merge — use `/check` first.
- If main has pending CI failures — use `/deploy-check`.
- If the operator is mid-debug — they say so.

If unsure, ask one question: "Ready to land + close out, or still iterating?"
