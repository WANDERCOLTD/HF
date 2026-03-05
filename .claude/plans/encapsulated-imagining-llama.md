# Plan: Share Visual Content — Sim + VAPI Channels

## Problem

Voice callers can't see images. The AI knows about visual aids (`[VISUAL AIDS]` prompt section lists available figures with captions) but can only describe them verbally. The sim already supports inline image sharing via `ContentPicker` + `CallMessage.mediaId`, but this is a manual teacher action — the AI itself has no tool to share content. On VAPI voice calls, there's zero ability to push visual content to the caller's phone.

## What Already Exists

| Layer | Status | Notes |
|-------|--------|-------|
| `MediaAsset` model | Done | Full schema with GCS/local storage, image extraction from PDFs |
| `SubjectMedia` / `AssertionMedia` | Done | Content linked to subjects and assertions |
| `ChannelConfig` model | Schema only | `"sim" \| "whatsapp" \| "sms"` per domain — **zero wiring** |
| `ConversationArtifact.status` | Schema only | `PENDING/SENT/DELIVERED/READ/FAILED` + `channel` + `deliveredAt` — **zero wiring** |
| `visual-aids.ts` transform | Done | Formats images into prompt, tells AI about figures |
| `[VISUAL AIDS]` prompt section | Done | Lists figures, says "use share_content tool in text sim" |
| `/api/media/[id]` route | Done | Session-authenticated serve (GET/PATCH/DELETE) |
| `StorageAdapter.getSignedUrl()` | Done | GCS signed URLs with configurable expiry |
| `ContentPicker` component | Done | Manual teacher-driven media sharing in sim |
| `MessageBubble` + `MediaRenderer` | Done | Inline image/PDF/audio rendering in sim chat |
| `send_text_to_caller` VAPI tool | Done | Text-only SMS via Twilio (stub/twilio/vapi-sms) |
| `request_artifact` VAPI tool | Done | Post-call artifact request (creates CallAction) |
| `VoiceCallSettings` tool toggles | Done | Per-tool enable/disable in SystemSettings |
| `ActivitiesConfig` | Done | textProvider dispatch (stub/twilio/vapi-sms) |

## Architecture

One new tool (`share_content`), one channel router, two delivery paths:

```
AI calls share_content({ media_id, caption?, context? })
                    │
            ┌───────┴───────┐
            │  Detect mode  │
            └───────┬───────┘
                    │
       ┌────────────┼────────────┐
       │ SIM        │ VAPI       │
       ▼            ▼            │
  Create          Channel        │
  CallMessage     Router         │
  with mediaId    ▼              │
  (inline)     ┌──────────┐     │
               │ Channel?  │     │
               └─────┬────┘     │
          ┌──────┬───┴───┬──────┘
          ▼      ▼       ▼
       WhatsApp  MMS   SMS+Link
       (Twilio)  (Twilio) (fallback)
```

### Key Design Decision: Channel Router, Not Hardcoded Dispatch

The existing `send_text_to_caller` hardcodes its dispatch in the tool handler. We won't repeat that. Instead:

1. `lib/channels/router.ts` — reads `ChannelConfig` for the caller's domain, picks the best enabled channel
2. `lib/channels/dispatch.ts` — generic `dispatchMedia(channel, payload)` that delegates to provider implementations
3. Provider modules under `lib/channels/providers/` — each handles one channel type

This means adding WhatsApp later = add a provider file + seed a ChannelConfig row. Zero tool changes.

## Implementation

### Phase 1: share_content Tool + Channel Router (6 files)

#### 1.1 `lib/channels/types.ts` (NEW)

```typescript
export type ChannelType = "sim" | "whatsapp" | "sms";

export interface ResolvedChannel {
  type: ChannelType;
  config: Record<string, unknown>; // Provider-specific
  domainId: string | null;
}

export interface MediaPayload {
  mediaId: string;
  publicUrl: string;       // Signed GCS URL or /api/media/:id URL
  mimeType: string;
  fileName: string;
  caption?: string;        // AI-provided context
  title?: string;          // From MediaAsset
}

export interface DispatchResult {
  sent: boolean;
  channel: ChannelType;
  provider: string;        // "twilio" | "stub"
  externalMessageId?: string;
  error?: string;
}
```

#### 1.2 `lib/channels/router.ts` (NEW)

```typescript
/**
 * Channel Router
 *
 * Resolves the best delivery channel for a given domain + caller.
 * Reads ChannelConfig (per-domain settings) from DB.
 * Falls back to SMS if no config exists.
 */

export async function resolveChannel(
  domainId: string | null,
  callerPhone: string | null
): Promise<ResolvedChannel>

// Logic:
// 1. If no domainId → fall back to SMS
// 2. Query ChannelConfig WHERE domainId, isEnabled=true, ORDER BY priority DESC
// 3. Filter by capability:
//    - "whatsapp" needs callerPhone + Twilio WhatsApp config
//    - "sms" needs callerPhone
//    - "sim" always works (no external delivery needed)
// 4. Return highest-priority enabled channel with config
// 5. If nothing configured → { type: "sms", config: {}, domainId }
```

#### 1.3 `lib/channels/dispatch.ts` (NEW)

```typescript
/**
 * Channel Dispatcher
 *
 * Sends media via the resolved channel.
 * Provider-specific logic is isolated per channel type.
 */

export async function dispatchMedia(
  channel: ResolvedChannel,
  payload: MediaPayload,
  callerPhone: string
): Promise<DispatchResult>

// Dispatch logic:
// switch (channel.type)
//   case "whatsapp":
//     → sendViaWhatsApp(callerPhone, payload, channel.config)
//     Uses Twilio WhatsApp API: from "whatsapp:+1..." format
//     Twilio param: MediaUrl (for images), Body (for caption)
//
//   case "sms":
//     → sendViaMMS(callerPhone, payload, channel.config)
//     MMS: same Twilio API, add MediaUrl param alongside Body
//     Fallback if MMS not supported: SMS with text link to public URL
//
//   case "sim":
//     → Not dispatched here (handled inline by tool handler)
//     Return { sent: true, channel: "sim", provider: "inline" }
```

**Twilio MMS/WhatsApp:** Same REST endpoint (`/Messages.json`), just add `MediaUrl` param:
```
POST /2010-04-01/Accounts/{sid}/Messages.json
Body: To=+44..., From=whatsapp:+1... (or plain +1... for SMS/MMS),
      Body="Here's the diagram we discussed", MediaUrl=https://signed-url...
```

One function, channel differences are just the `From` prefix and format. No separate WhatsApp SDK needed.

#### 1.4 `app/api/media/[id]/public/route.ts` (NEW)

```
GET /api/media/:id/public?token=<hmac>
```

Public (no session auth) media endpoint for external channel delivery. The AI can't send a session-authenticated `/api/media/:id` URL via SMS — the caller has no session.

- HMAC-SHA256 token generated from `mediaId + secret + expiry`
- Token encodes expiry (e.g., 24 hours)
- Validates token, streams file with Content-Type
- No session auth required — token IS the auth
- Used by Twilio's `MediaUrl` param to fetch the image when delivering MMS/WhatsApp

Alternative: Use GCS signed URLs directly (already implemented in `StorageAdapter.getSignedUrl()`). Simpler, no new route needed. But requires GCS in production. For local dev, need the route.

**Decision:** Use `getSignedUrl()` for GCS environments (production), fall back to HMAC-token route for local storage. The `dispatch.ts` module picks the right URL based on `storageType`.

#### 1.5 `share_content` tool in `app/api/vapi/tools/route.ts` (MODIFY)

Add new tool handler + definition alongside existing 8 tools.

```typescript
case "share_content":
  result = await handleShareContent(args, callerId, customerPhone, body);
  break;
```

Handler:
```typescript
async function handleShareContent(
  args: { media_id: string; caption?: string; context?: string },
  callerId: string | null,
  customerPhone: string | null,
  requestBody: any
): Promise<any> {
  // 1. Validate media_id → load MediaAsset
  // 2. Detect mode:
  //    - If call source is "sim" (check requestBody or caller context) → sim path
  //    - If VAPI voice call → external delivery path

  // SIM PATH:
  //   Find active Call for this caller
  //   Create CallMessage with mediaId (same as ContentPicker does)
  //   Return { shared: true, channel: "sim", rendered: "inline" }

  // VAPI PATH:
  //   1. Resolve caller's domain
  //   2. resolveChannel(domainId, customerPhone)
  //   3. Generate public URL for media (signed GCS URL or HMAC route)
  //   4. dispatchMedia(channel, payload, customerPhone)
  //   5. Create ConversationArtifact with status SENT, channel, mediaId
  //   6. Return { shared: true, channel, provider, externalMessageId }
  //   7. If no phone / dispatch fails:
  //      Create ConversationArtifact with status PENDING
  //      Return { shared: false, queued: true,
  //               message: "Content queued — will be available in session recap" }
}
```

Tool definition added to `VAPI_TOOL_DEFINITIONS`:
```typescript
{
  type: "function",
  function: {
    name: "share_content",
    description: "Share a visual aid (image, diagram, PDF) with the caller. In text sim, this shows the content inline. In voice calls, this sends the content to the caller's phone via their preferred channel (WhatsApp, MMS, or SMS link). Use when discussing a figure, diagram, or document that the caller should see.",
    parameters: {
      type: "object",
      properties: {
        media_id: {
          type: "string",
          description: "The media ID from the available visual aids list"
        },
        caption: {
          type: "string",
          description: "Brief description of what the content shows and why you're sharing it"
        }
      },
      required: ["media_id"]
    }
  }
}
```

#### 1.6 `lib/system-settings.ts` (MODIFY)

Add tool toggle:
```typescript
// In VoiceCallSettings interface:
toolShareContent: boolean;

// In VOICE_CALL_DEFAULTS:
toolShareContent: true,

// In VOICE_CALL_KEYS:
"voice.toolShareContent": "toolShareContent",
```

Add to `TOOL_SETTING_KEYS` in tools/route.ts:
```typescript
share_content: "toolShareContent",
```

### Phase 2: Seed ChannelConfig + Admin UI (2 files)

#### 2.1 Seed default ChannelConfig

In `db:seed` or a standalone script, create default channel configs:
- Global default (domainId=null): `sms` enabled, priority 0, config `{}` (uses env vars)
- Per-domain: admins configure via UI

#### 2.2 Channel Settings on Institution Detail Page

On the existing institution/domain settings page, add a "Delivery Channels" section:

```
┌─────────────────────────────────────────────────┐
│ Delivery Channels                               │
├─────────────────────────────────────────────────┤
│                                                 │
│ ┌─ SMS ──────────────────────────────────────┐  │
│ │ ● Enabled          Priority: [1]           │  │
│ │ Provider: Twilio (from env)                │  │
│ │ [Test Channel]                              │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ ┌─ WhatsApp ─────────────────────────────────┐  │
│ │ ○ Disabled          Priority: [2]          │  │
│ │ Twilio WhatsApp From: [whatsapp:+1...]     │  │
│ │ [Test Channel]                              │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ ┌─ Sim ──────────────────────────────────────┐  │
│ │ ● Enabled (always)  Priority: [0]          │  │
│ │ Inline rendering — no config needed        │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
```

API routes:
- `GET /api/domains/[id]/channels` — list ChannelConfig for domain
- `PUT /api/domains/[id]/channels` — upsert channel configs

### Phase 3: Delivery Tracking + UI (deferred, post-market-test)

- Wire `ConversationArtifact.status` lifecycle (PENDING → SENT → DELIVERED → READ)
- Twilio status callbacks (`StatusCallback` URL on outbound messages)
- WhatsApp read receipts
- Caller detail page: "Shared Content" tab showing delivery status
- Post-call session recap page (`/share/[token]`) for callers without WhatsApp/MMS

## Data Flow (VAPI Voice Call)

```
1. Call starts → assistant-request → voice prompt includes [VISUAL AIDS]:
   "- Figure 1.2: The water cycle (Chapter 3)"

2. AI decides to share → calls share_content({ media_id: "abc", caption: "The water cycle" })

3. Tool handler:
   a. Load MediaAsset abc → { storageKey, mimeType, fileName, title }
   b. Resolve caller's domain → domainId "xyz"
   c. resolveChannel("xyz", "+44...") → { type: "whatsapp", config: { from: "whatsapp:+1..." } }
   d. getSignedUrl(storageKey, 86400) → "https://storage.googleapis.com/...?X-Goog-Signature=..."
   e. dispatchMedia(channel, { mediaId, publicUrl, mimeType, caption }, "+44...")
      → POST Twilio Messages.json: To=whatsapp:+44..., From=whatsapp:+1...,
        Body="The water cycle", MediaUrl=https://storage...
   f. Create ConversationArtifact: type=MEDIA, mediaId=abc, channel="whatsapp",
      status=SENT, externalMessageId=SM123...
   g. Return to AI: { shared: true, channel: "whatsapp", message: "Image sent to caller's WhatsApp" }

4. AI continues: "I've just sent you the water cycle diagram. You should see it on your phone.
   Now, looking at the diagram, can you tell me what happens during evaporation?"
```

## Data Flow (Sim)

```
1. Sim session starts → system prompt includes [VISUAL AIDS] section

2. AI decides to share → calls share_content({ media_id: "abc", caption: "The water cycle" })

3. Tool handler:
   a. Load MediaAsset abc
   b. Detect sim context (call source or request metadata)
   c. Find active Call for this caller
   d. Create CallMessage: callId, role="assistant", content="The water cycle",
      mediaId="abc"
   e. Return to AI: { shared: true, channel: "sim", rendered: "inline" }

4. SimChat polls messages → gets new message with media →
   MessageBubble renders MediaRenderer → image appears inline

5. AI continues naturally — the content is visible in the chat
```

## Files Changed

| File | Action | What |
|------|--------|------|
| `lib/channels/types.ts` | NEW | Channel types, payloads, results |
| `lib/channels/router.ts` | NEW | `resolveChannel()` — reads ChannelConfig |
| `lib/channels/dispatch.ts` | NEW | `dispatchMedia()` — Twilio MMS/WhatsApp/stub |
| `app/api/media/[id]/public/route.ts` | NEW | Token-auth media serving for external channels |
| `app/api/vapi/tools/route.ts` | MODIFY | Add `share_content` handler + definition |
| `lib/system-settings.ts` | MODIFY | Add `toolShareContent` toggle |

Phase 2 (follow-on):
| `app/api/domains/[id]/channels/route.ts` | NEW | ChannelConfig CRUD |
| Domain settings UI component | MODIFY | Channel configuration panel |

## Sim Detection Strategy

The VAPI tools route handles both sim and VAPI calls. To distinguish:

1. **VAPI calls** arrive via webhook with `body.message.call` containing VAPI call metadata and `body.message.call.customer.number`
2. **Sim calls** use the same tools endpoint but arrive from the sim chat client which passes `callId` in the request body and the caller is identified differently

Check: if `body.message?.call?.provider === "vapi"` → VAPI path. Otherwise → sim path. Or: if `customerPhone` exists and call has `externalId` (VAPI call ID) → VAPI. Sim calls don't have externalIds.

## Prompt Update

The `[VISUAL AIDS]` section in `renderVoicePrompt()` currently says:
```
"In voice calls: describe visuals verbally. Never say 'look at' or 'see the diagram'."
"In text sim: you can share these using the share_content tool."
```

Update to:
```
"You can share any of these with the caller using the share_content tool."
"In voice calls, the content will be sent to the caller's phone. Tell them to check their messages."
"In text sessions, the content appears inline in the chat."
"Always describe the visual verbally too — don't assume the caller has looked at it."
```

File: `lib/prompt/composition/renderpromptsummary.ts` (the `[VISUAL AIDS]` section).

## Plan Guards

1. **Dead-ends:** PASS — MediaPayload → DispatchResult → ConversationArtifact.status. All values surface in tool response to AI + artifact tracking.
2. **Forever spinners:** PASS — Tool is synchronous (VAPI tools must respond in seconds). No polling UI involved. Twilio call has 5s timeout.
3. **API dead ends:** PASS — `share_content` tool called by AI, `/api/media/[id]/public` called by Twilio to fetch image, `/api/domains/[id]/channels` called by admin UI.
4. **Routes good:** PASS — `/api/media/[id]/public` is token-auth (HMAC, no session). VAPI tools is webhook-secret. Domain channels is `requireAuth("OPERATOR")`.
5. **Escape routes:** N/A — no modals or wizards in Phase 1. Phase 2 channel UI is a settings section (always editable).
6. **Gold UI:** Phase 2 channel settings will use `hf-card`, `hf-input`, `hf-btn` classes.
7. **Missing await:** Will verify — all Prisma calls, storage calls, Twilio fetch await.
8. **Hardcoded slugs:** PASS — no spec slugs involved.
9. **TDZ shadows:** Will verify — no `config` variable shadowing.
10. **Pipeline integrity:** PASS — `share_content` creates a `ConversationArtifact` which the pipeline can pick up in EXTRACT. Does not bypass any stage.
11. **Seed / Migration:** No migration needed — `ChannelConfig`, `MediaAsset`, `ConversationArtifact.mediaId` all exist. Just need seed data for default channel configs.
12. **API docs:** Will regenerate after adding new tool + public media route.
13. **Orphan cleanup:** PASS — no code removed, only additions.

## Deploy

Phase 1: `/vm-cp` (no migration, no schema change — just new lib files + route modification).
Phase 2 (channel admin UI + seed): `/vm-cp` + `npm run db:seed` on VM for default ChannelConfig rows.
