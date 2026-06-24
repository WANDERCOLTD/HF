/**
 * useEmbeddedMode (#2277) — IELTS market-test embedded-chrome detection.
 *
 * MT prospects visit `/x/sim/<callerId>?embedded=1` and see a clean
 * simulator: no left sidebar, no Cmd+K palette, no top-nav. The flag
 * is **sticky** via a session cookie (`hf-embedded=1`) so once the
 * operator-controlled URL carries the param, every subsequent nav in
 * the same browser session stays embedded.
 *
 * Lifecycle:
 *   - `?embedded=1` → write cookie, return `true`
 *   - `?embedded=0` → clear cookie, return `false`
 *   - no param, cookie present → return `true`
 *   - no param, no cookie → return `false`
 *
 * Backward compat: the root layout already supports `?embed=1` (singular)
 * as an iframe-friendly flag — that path is left untouched. This hook is
 * the *new* MT-facing surface; ANY truthy result from either flag should
 * suppress admin chrome.
 *
 * SSR / pre-hydration: returns `false` during the first render (server
 * has no access to client cookies, and `useSearchParams()` returns null
 * in some Next 16 contexts). The effect fires post-mount and the parent
 * re-renders. The flicker is one frame of admin chrome on first paint —
 * acceptable for an MT demo that operators preload before handing off
 * to the prospect.
 */

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const COOKIE_NAME = "hf-embedded";
const COOKIE_VALUE = "1";
// 30-day TTL — matches the NextAuth session cookie window used elsewhere
// in the app. MT demos are operator-supervised single-session affairs;
// the cookie is per-browser-profile not per-tab so the operator can reset
// by clearing site data.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function readCookie(): boolean {
  if (typeof document === "undefined") return false;
  const cookies = document.cookie.split(";");
  for (const c of cookies) {
    const [k, v] = c.trim().split("=");
    if (k === COOKIE_NAME && v === COOKIE_VALUE) return true;
  }
  return false;
}

function writeCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${COOKIE_VALUE}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function clearCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Returns `true` when the current page should render in MT-embedded
 * mode (no admin chrome, no Cmd+K, no top-nav, no left sidebar).
 *
 * Reads from query param (`?embedded=1` or `?embedded=0`) first;
 * falls back to the sticky `hf-embedded=1` cookie. Mutates the cookie
 * as a side-effect when the query param is present.
 */
export function useEmbeddedMode(): boolean {
  const searchParams = useSearchParams();
  const [isEmbedded, setIsEmbedded] = useState<boolean>(false);

  useEffect(() => {
    const param = searchParams?.get("embedded");
    if (param === "1") {
      writeCookie();
      setIsEmbedded(true);
      return;
    }
    if (param === "0") {
      clearCookie();
      setIsEmbedded(false);
      return;
    }
    // No explicit param — fall back to cookie.
    setIsEmbedded(readCookie());
  }, [searchParams]);

  return isEmbedded;
}
