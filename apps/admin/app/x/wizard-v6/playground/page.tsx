// #1078 — V6 wizard Phase 1 spike: playground route.
//
// Server component. SUPERADMIN-gated via the sidebar manifest entry at
// /x/wizard-v6 (`requiredRole: 'SUPERADMIN'`) — middleware enforces.
// Behind `NEXT_PUBLIC_WIZARD_VERSION=v6-playground` flag: route renders
// a "flag off" notice unless the flag is set.
//
// Layout: two-pane split. LHS hosts the @tallyseal/react-assistant-ui
// chat surface (Thread + Composer placeholder in P1). RHS hosts the
// HF-built sibling panel that reads the projected snapshot via
// /api/wizard-v6/snapshot and shows each spec field flipping
// empty → filled as events land. The panel is the load-bearing
// demonstration of the end-to-end wire.

import { redirect } from "next/navigation";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CreateRecipe } from "@/lib/wizard-v6/specs/create-recipe.crawcus";
import { PlaygroundPanel } from "./panel";
import "./playground.css";

export const dynamic = "force-dynamic";

export default async function WizardV6PlaygroundPage() {
  const auth = await requireAuth("SUPERADMIN");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/wizard-v6/playground");
  }

  // Flag gate. Read on the server because env var is build-time on the
  // server bundle; runtime mismatch surfaces here, not in the client.
  const flag = process.env.NEXT_PUBLIC_WIZARD_VERSION;
  const flagOn = flag === "v6-playground";

  if (!flagOn) {
    return (
      <main className="hf-page-shell">
        <h1 className="hf-page-title">V6 Wizard Playground</h1>
        <div className="hf-banner hf-banner-warning">
          <strong>Flag off.</strong> Set{" "}
          <code>NEXT_PUBLIC_WIZARD_VERSION=v6-playground</code> to enable the
          playground. Current value:{" "}
          <code>{flag ?? "(unset)"}</code>.
        </div>
        <p className="hf-section-desc">
          See ADR <code>docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md</code>{" "}
          and issue <code>#1078</code> for context.
        </p>
      </main>
    );
  }

  // P1 plumbing — pick or create a scratch Playbook to host the
  // `Playbook.config.__v6` snapshot. The playground is single-user
  // (SUPERADMIN), so one scratch playbook per superadmin is sufficient.
  // P2 graduates this to a real course-scoped playbook.
  const scratchName = `[wizard-v6 scratch] ${auth.session.user.email ?? auth.session.user.id}`;
  let playbook = await prisma.playbook.findFirst({
    where: { name: scratchName },
    select: { id: true, name: true, domainId: true },
  });
  if (!playbook) {
    // Find any domain to attach the scratch playbook — the playground
    // doesn't care which one, but the FK is non-null on Playbook.
    const anyDomain = await prisma.domain.findFirst({ select: { id: true } });
    if (!anyDomain) {
      return (
        <main className="hf-page-shell">
          <h1 className="hf-page-title">V6 Wizard Playground</h1>
          <div className="hf-banner hf-banner-error">
            <strong>No Domain found.</strong> The scratch Playbook needs a
            domain FK. Seed a domain first via{" "}
            <code>npm run db:seed</code> or the Admin → Domains flow.
          </div>
        </main>
      );
    }
    playbook = await prisma.playbook.create({
      data: {
        name: scratchName,
        domainId: anyDomain.id,
        description: "V6 wizard Phase 1 spike scratch playbook (#1078).",
      },
      select: { id: true, name: true, domainId: true },
    });
  }

  return (
    <main className="hf-page-shell wizard-v6-playground">
      <header className="wizard-v6-header">
        <h1 className="hf-page-title">V6 Wizard Playground</h1>
        <p className="hf-page-subtitle">
          Phase 1 spike — <code>CreateRecipe</code> on CrawcusSpec. Three
          fields with a prereq DAG. Structural guards: ESLint +
          projector assertion + DB trigger.
        </p>
      </header>

      <div className="wizard-v6-split">
        <section
          className="wizard-v6-chat"
          aria-label="Chat surface (@tallyseal/react-assistant-ui)"
        >
          <div className="hf-card">
            <h2 className="hf-section-title">Chat</h2>
            <p className="hf-section-desc">
              @tallyseal/react-assistant-ui Thread + Composer mounts here in
              Phase 2. The Phase 1 spike exercises the wire via the inline
              field controls in the panel on the right — same{" "}
              <code>recordFieldAnswered</code> call path the chat surface
              will hit in P2.
            </p>
          </div>
        </section>

        <PlaygroundPanel
          playbookId={playbook.id}
          spec={{
            key: String(CreateRecipe.key),
            version: CreateRecipe.version,
            fields: Object.keys(CreateRecipe.fields).map((k) => ({
              key: k,
              type:
                (CreateRecipe.fields as Record<string, { type?: string }>)[k]
                  ?.type ?? "string",
            })),
          }}
        />
      </div>
    </main>
  );
}
