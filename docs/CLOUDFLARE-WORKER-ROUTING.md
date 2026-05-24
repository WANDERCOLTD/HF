# Cloudflare Worker Routing (`still-cake-1d83`)

**This is the canonical routing layer for HF subdomains.** Not the cloudflared tunnel.

## Discovery (2026-05-24, #726 Phase 1)

The cloudflared tunnel on the hf-dev VM (tunnel id `00d2c2cc-...`) is dead weight. All public traffic for `*.humanfirstfoundation.com` is routed by a **Cloudflare Worker** named `still-cake-1d83`.

Diagnostic that proved this:

```bash
# Stop cloudflared on hf-dev entirely
sudo systemctl stop cloudflared

# Probe — subdomains STILL return 200
curl -s https://dev.humanfirstfoundation.com/api/health
# {"ok":true,"ts":"..."}
```

The Worker intercepts via Worker Routes (zone-scoped), bypassing the tunnel.

## Worker source

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;

    const origins = {
      "dev.humanfirstfoundation.com": "hf-admin-dev-nqep3i44ra-nw.a.run.app",
      // (test + lab removed 2026-05-24, #726 Phase 1)
      // staging/pilot/app added in Phases 4/5/6
    };

    const origin = origins[host];
    if (!origin) return new Response("Unknown host", { status: 404 });

    url.hostname = origin;
    const newRequest = new Request(url, request);
    newRequest.headers.set("Host", origin);

    return fetch(newRequest);
  }
};
```

Account ID: `56e8f914f45a391739fa1e3b6c0d40e8`
Zone ID: `a75655f1818c73eaaecc232b1076dbf3`

## Adding a new subdomain (e.g. `pilot.` in Phase 5)

1. **Add the mapping to the Worker source.** Edit `still-cake-1d83/worker.js` via:
   - Cloudflare dashboard → Workers & Pages → `still-cake-1d83` → Edit Code
   - OR via API:
     ```bash
     curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCT/workers/scripts/still-cake-1d83" \
       -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $KEY" \
       -H "Content-Type: application/javascript" \
       --data-binary @new-worker.js
     ```
2. **Add a Worker Route** for the new hostname:
   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/workers/routes" \
     -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $KEY" \
     -H "Content-Type: application/json" \
     --data '{"pattern":"pilot.humanfirstfoundation.com/*","script":"still-cake-1d83"}'
   ```
3. **Add a Cloudflare DNS CNAME** for the new subdomain pointing at the tunnel UUID (the tunnel is still the conventional DNS target even though the Worker is what does the routing):
   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
     -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $KEY" \
     -H "Content-Type: application/json" \
     --data '{"type":"CNAME","name":"pilot","content":"00d2c2cc-0994-45a4-9755-5a7d50d874ad.cfargotunnel.com","proxied":true}'
   ```
4. **Verify**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://pilot.humanfirstfoundation.com/api/health
   ```

## Removing a subdomain

Reverse of the above:

1. Delete the Worker Route via `DELETE /zones/$ZONE/workers/routes/$ROUTE_ID`
2. (Optional) Remove the mapping from the Worker source
3. (Optional) Delete the DNS CNAME

(Worker Routes alone are enough — without one, the Worker is never invoked and the Worker source mapping becomes inert.)

## Why a Worker instead of the tunnel?

Tribal knowledge. The cloudflared tunnel was the original design, but the Worker pattern was adopted at some point — likely because:

- Workers can rewrite the Host header (needed because Cloud Run validates the Host against its hostname)
- Workers run at the Cloudflare edge, lower latency than tunnel-through-cloudflared-on-VM
- Tunnel requires keeping the VM healthy; Worker doesn't

The tunnel is left running for now but could be decommissioned (`sudo systemctl disable cloudflared` on hf-dev) without affecting routing. Decision deferred to a separate ticket.

## Credentials

API access for routing operations uses the same Cloudflare API key referenced in `.claude/commands/deploy.md` (cache purge). Same `X-Auth-Email` + `X-Auth-Key` headers, same zone ID.
