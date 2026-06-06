import { redirect } from "next/navigation";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { MessagingProvidersClient } from "./MessagingProvidersClient";

/**
 * @page /x/settings/messaging-providers
 * Messaging providers admin (#1141). ADMIN-only. Lists every row, lets
 * admins add / edit / soft-disable. Sibling to /x/settings/voice-providers.
 */
export default async function MessagingProvidersPage() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/settings/messaging-providers");
  }
  return <MessagingProvidersClient />;
}
