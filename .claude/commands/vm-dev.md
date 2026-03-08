---
description: Start hf-dev VM dev server with SSH tunnel on localhost:3000
---

Start the Next.js dev server on the hf-dev GCP VM with an SSH tunnel forwarding port 3000 to localhost.

**Uses a single SSH connection** — kill, start, wait for ready, then keep alive as the tunnel. No second IAP handshake.

## Step 1: Kill stale local tunnels

Kill any existing local SSH tunnels holding port 3000:

```bash
lsof -ti:3000 | xargs kill 2>/dev/null || true
sleep 1
```

## Step 2: Kill + start + tunnel (single SSH call)

**IMPORTANT:** Do NOT use `pkill` over SSH — any pattern can match the SSH session's own command string and kill the connection (exit 255). Use `killall` + `fuser` instead.

Run this in the background — it stays alive as the tunnel:

```bash
gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- -L 3000:localhost:3000 bash -c '
  echo "==> Killing existing processes..."
  killall -9 node 2>/dev/null || true
  fuser -k 3000/tcp 2>/dev/null || true
  fuser -k 3001/tcp 2>/dev/null || true
  sleep 1
  rm -rf ~/HF/apps/admin/.next/dev/lock

  echo "==> Starting dev server..."
  nohup bash -c "cd ~/HF/apps/admin && ./node_modules/.bin/next dev --port 3000" > /tmp/hf-dev.log 2>&1 &

  echo "==> Waiting for server..."
  for i in $(seq 1 45); do
    if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
      echo "==> Server ready! (${i}s)"
      break
    fi
    sleep 1
  done

  echo "==> Tunnel active on localhost:3000 — Ctrl+C to disconnect"
  tail -f /tmp/hf-dev.log
'
```

This single connection does three things:
1. `-L 3000:localhost:3000` — port forwarding (tunnel)
2. `bash -c '...'` — kill old processes, start dev server, wait for health check
3. `tail -f /tmp/hf-dev.log` — keeps the SSH session alive (and shows server logs)

Using `./node_modules/.bin/next` instead of `npx next` skips npx resolution overhead.

If the SSH command fails with exit code 255, wait 3 seconds and retry once.

Tell the user:
- Server running at `http://localhost:3000`
- Live logs streaming in the background task
- Dev server persists across SSH disconnects — use `/vm-tunnel` to reconnect
- To stop everything: `/vm-kill`

## IAP troubleshooting

IAP tunneling can be flaky with rapid consecutive SSH connections. If a command fails with exit code 255:
1. Wait 3-5 seconds and retry once
2. If still failing, try a simple test: `gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "echo hello"`
3. Check the IAP firewall rule exists: `gcloud compute firewall-rules list --filter="name~iap"`
4. If no rule, create one: `gcloud compute firewall-rules create allow-iap-ssh --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --network=default`

If the server fails with EADDRINUSE or lock errors, run `/vm-kill` first then retry `/vm-dev`.
