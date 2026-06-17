# Audio-slice strategy for per-segment prosody analysis

**Date:** 2026-06-17
**Story:** [#1762 Story D](https://github.com/WANDERCOLTD/HF/issues/1762)
**Decision:** Byte-range proxy (delegate slicing to the external prosody service via HTTP `Range` headers)
**Status:** Accepted

## Context

Epic #1762 introduces per-segment prosody analysis for IELTS Mock calls. Story D
needs an extraction helper that, given a VAPI recording URL plus a
`[startSec, endSec)` window from Story C's phase boundaries, produces an audio
slice ready to ship to an external prosody analysis service in Story E.

Two implementation paths were on the table:

1. **Server-side slice with FFmpeg.** Spawn `ffmpeg -ss <start> -t <duration>`,
   buffer the output, ship the bytes.
2. **Byte-range proxy.** Have callers point the analysis service at a Range-
   bounded URL, or fetch the slice ourselves via `Range: bytes=<start>-<end>`.

## Environment probe (verify-before-fix)

| Surface | Result |
|---|---|
| Local Mac | `which ffmpeg` → not installed (`Exit code 1`) |
| Production Docker image (`apps/admin/Dockerfile`) | `grep -i ffmpeg` → no install line. The image is the standard `node:lts-alpine` runner; adding ffmpeg ~ 80 MB to the image. |
| `apps/admin/package.json` deps | `fluent-ffmpeg` / `ffmpeg-static` / `wavefile` / `node-wav` → none present |
| VAPI recording URL (sample 52 s wav, ~4.6 MB) | `curl -sI` → `accept-ranges: bytes` |
| VAPI Range request (`Range: bytes=0-65535`) | `HTTP/2 206 Partial Content` + `content-range: bytes 0-65535/4640684` |

VAPI's storage (Cloudflare-fronted) returns proper 206 responses with
`content-range`. Range requests are first-class.

## Decision

**Implement byte-range proxy.** `extractAudioSlice` returns an `AudioSlice`
descriptor that carries `(url, startByte, endByte, contentType, strategy:
"byte-range-proxy")` and ALSO performs the Range fetch itself so the buffer
is available to callers that need to hand bytes to a service that doesn't
itself support Range fetches.

For WAV (PCM) audio — which is what VAPI's `-mono.wav` recordings are — byte
position maps linearly to time position via:

```
bytes_per_second = sample_rate * channels * (bits_per_sample / 8)
byte_offset      = WAV_HEADER_SIZE + (time_sec * bytes_per_second)
```

WAV header parsing is unavoidable (sample rate + channels + bits-per-sample
are needed to compute the byte offset). The helper reads the first ~64 bytes
of the file via a small Range request, parses the RIFF/fmt chunk inline
(no external dep), computes the time→byte mapping, then performs the second
Range request for the actual slice.

## Consequences

### Positive

- **Zero new infra surface.** No FFmpeg binary in the Docker image. Avoids
  the `apps/admin/Dockerfile` change which would also trip the CI ⇔ Docs
  Parity gate (`.claude/rules/ci-docs-parity.md`) and require a
  `docs/CLOUD-DEPLOYMENT.md` update in the same PR. Keeps this PR focused.
- **Zero new npm dependency.** Native `fetch` + manual RIFF parse fit
  inside the Node 22 standard library.
- **Memory bounded.** Each slice request reads at most `MAX_SLICE_SECONDS *
  bytes_per_sec ≈ 180 * 32000 = 5.7 MB` for a typical 16 kHz mono 16-bit PCM
  WAV. No spawn, no temp files, no disk I/O.
- **Delegatable.** External services that DO understand `Range` headers
  can be pointed straight at the source URL with the byte-range computed
  on our side — no need to re-host the slice.

### Negative

- **WAV-PCM only.** This strategy works because PCM is uncompressed and
  linearly indexed. MP3 / AAC / Opus would need codec-aware framing (you
  can't slice at an arbitrary millisecond — you'd land mid-frame and
  produce silence or noise). VAPI currently serves WAV. If a future
  provider serves MP3, we need to either (a) require WAV format from the
  provider, (b) ship FFmpeg, or (c) add a JS-native codec parser.
- **WAV header parse is hand-rolled.** A malformed RIFF chunk (e.g. a
  `LIST INFO` block before `fmt `) could mislead the parser. The helper
  validates the RIFF/WAVE signature + `fmt ` chunk shape, and rejects on
  unexpected encodings (non-PCM compression codes other than 1).
- **No transcoding.** If the prosody service needs MP3 or 8 kHz mono and
  VAPI serves 16 kHz, the byte-range path cannot transcode. Story E will
  need to either pass the WAV through, or stage a transcoder there.

### Operations follow-up (out of scope for this PR)

- **FFmpeg-in-Docker decision.** If a downstream story needs transcoding or
  cross-codec slicing, file a separate story to add FFmpeg to
  `apps/admin/Dockerfile`. That story MUST update `docs/CLOUD-DEPLOYMENT.md`
  in the same PR per `.claude/rules/ci-docs-parity.md`.

## Alternatives considered

### A. FFmpeg server-side

Pros: codec-agnostic, transcoding, format conversion, sample-rate downsampling.
Cons: ~80 MB Docker bloat, spawn overhead per slice, temp-file I/O on a
read-only Cloud Run filesystem (would need `/tmp`), CI/Docs Parity churn,
new ops surface (binary version pinning, signal handling, zombie processes).
Not justified by current requirements — VAPI serves WAV, prosody services
accept WAV.

### B. ffmpeg-static / fluent-ffmpeg npm

Pros: keeps the binary inside `node_modules`, no Dockerfile change.
Cons: still ~80 MB on disk, still a spawn-and-pipe model, npm-published
binary is x86_64-only by default (M-series macs trip on it).

### C. wavefile / node-wav

Pros: pure-JS WAV decode, would let us slice in memory.
Cons: requires fetching the WHOLE file then slicing (no streaming primitive).
A 30-minute IELTS Speaking call at 16 kHz mono 16-bit is ~115 MB — wasteful
when we only need 120 s of it.

### D. Signed slice URL via a CDN edge function

Pros: zero server-side compute.
Cons: VAPI doesn't expose one. Cloudflare Workers in front of VAPI would
re-introduce the byte-range math anyway, just at a different layer.

## Validation

- **Real Range fetch:** the helper's integration test fetches a real 30-second
  slice from the sample VAPI URL and asserts the response is 206 Partial
  Content with a `content-range` header matching the requested byte range.
- **Buffer length:** the returned buffer length equals `(endByte - startByte
  + 1)` (the inclusive HTTP range semantics).
- **Allow-listed host:** non-`storage.vapi.ai` URLs are rejected before any
  network call.

## Related

- `apps/admin/lib/voice/audio-slice.ts` — implementation
- `apps/admin/lib/voice/transcript-detailed.ts` — Story B sibling (window
  semantics: half-open `[fromSec, toSec)`, mid-point inclusion)
- `.claude/rules/ci-docs-parity.md` — why this PR avoids touching the
  Dockerfile
- `.claude/rules/verify-before-fix.md` — environment probe before strategy
  choice
