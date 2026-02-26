import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { scaffoldDomain } from "@/lib/domain/scaffold";

/**
 * @api POST /api/institutions/launch
 * @visibility internal
 * @scope institutions:write
 * @auth OPERATOR
 * @tags institutions, wizard
 * @description SSE streaming endpoint for the institution setup wizard LaunchStep.
 *   Creates institution → domain → scaffold → links user in sequence, emitting
 *   progress events so the client can show a live timeline instead of a spinner.
 *
 * @body institutionName string (required)
 * @body slug string (required)
 * @body logoUrl string (optional)
 * @body primaryColor string (optional)
 * @body secondaryColor string (optional)
 * @body welcomeMessage string (optional)
 * @body typeId string (optional)
 * @body typeSlug string (optional)
 * @body terminologyOverrides object (optional)
 *
 * @response 200 text/event-stream — SSE progress events
 *   Phase events: creating-institution, creating-domain, scaffolding, linking-user
 *   Complete event: { phase: "complete", detail: { institutionId, domainId, institutionName } }
 *   Error event:   { phase: "error", message: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;
  const userId = auth.session.user.id;

  const body = await request.json().catch(() => ({}));
  const {
    institutionName,
    slug,
    logoUrl,
    primaryColor,
    secondaryColor,
    welcomeMessage,
    typeId,
    typeSlug,
    terminologyOverrides,
  } = body;

  if (!institutionName?.trim() || !slug?.trim()) {
    return Response.json({ ok: false, error: "Institution name and slug are required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (phase: string, message: string, detail?: Record<string, unknown>) => {
        const event = JSON.stringify({ phase, message, ...(detail ? { detail } : {}) });
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      };

      try {
        send("init", "");

        // ── Step 1: Resolve institution type + terminology ──
        let resolvedTypeId = typeId || null;
        if (!resolvedTypeId && typeSlug) {
          const instType = await prisma.institutionType.findUnique({
            where: { slug: typeSlug },
            select: { id: true },
          });
          resolvedTypeId = instType?.id || null;
        }

        let resolvedTerminology: Record<string, string> | null = null;
        if (terminologyOverrides && typeof terminologyOverrides === "object") {
          if (resolvedTypeId) {
            const instType = await prisma.institutionType.findUnique({
              where: { id: resolvedTypeId },
              select: { terminology: true },
            });
            const base = (instType?.terminology as Record<string, string> | null) ?? {};
            resolvedTerminology = { ...base, ...terminologyOverrides };
          } else {
            resolvedTerminology = terminologyOverrides as Record<string, string>;
          }
        }

        // ── Step 2: Create institution ──
        send("creating-institution", "Creating institution…");

        const institution = await prisma.institution.create({
          data: {
            name: institutionName.trim(),
            slug: slug.trim().toLowerCase(),
            logoUrl: logoUrl?.trim() || null,
            primaryColor: primaryColor?.trim() || null,
            secondaryColor: secondaryColor?.trim() || null,
            welcomeMessage: welcomeMessage?.trim() || null,
            typeId: resolvedTypeId,
            ...(resolvedTerminology ? { terminology: resolvedTerminology } : {}),
          },
        });

        send("creating-institution", "Institution created ✓");

        // ── Step 3: Create domain ──
        send("creating-domain", "Setting up domain…");

        const domain = await prisma.domain.create({
          data: {
            name: institutionName.trim(),
            slug: slug.trim().toLowerCase(),
            institutionId: institution.id,
          },
        });

        send("creating-domain", "Domain ready ✓");

        // ── Step 4: Scaffold domain ──
        send("scaffolding", "Scaffolding workspace…");

        await scaffoldDomain(domain.id);

        send("scaffolding", "Workspace ready ✓");

        // ── Step 5: Link user to institution ──
        send("linking-user", "Linking your account…");

        await prisma.user.update({
          where: { id: userId },
          data: { activeInstitutionId: institution.id },
        });

        send("linking-user", "Account linked ✓");

        // ── Complete ──
        send("complete", "Done", {
          institutionId: institution.id,
          domainId: domain.id,
          institutionName: institution.name,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Institution creation failed";
        send("error", msg);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
