import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { deletePlaybookData } from "@/lib/gdpr/delete-playbook-data";

/**
 * Extract systemSpecs toggle state and configSettings from playbook.config.
 * Stored in config.systemSpecToggles as { [specId]: { isEnabled, configOverride } }
 * Stored in config.configSettings as { memoryMinConfidence, learningRate, etc. }
 */
function withSystemSpecs(playbook: any, resolvedSpecs?: Array<{ id: string; slug: string; name: string; description: string | null; specRole: string | null; outputType: string }>) {
  const config = (playbook.config as Record<string, any>) || {};
  const toggles = config.systemSpecToggles || {};
  const systemSpecs = Object.entries(toggles).map(([specId, data]: [string, any]) => {
    const resolved = resolvedSpecs?.find(s => s.id === specId);
    return {
      specId,
      isEnabled: data.isEnabled ?? true,
      configOverride: data.configOverride || null,
      ...(resolved && { spec: resolved }),
    };
  });
  const configSettings = config.configSettings || null;
  return { ...playbook, systemSpecs, configSettings };
}

/**
 * @api GET /api/playbooks/:playbookId
 * @visibility public
 * @scope playbooks:read
 * @auth session
 * @tags playbooks
 * @description Get playbook details with all items, domain, system specs, and parent version
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, playbook: Playbook }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        domain: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        // agent: removed - FK relation deprecated, agentId is now just a string reference
        // curriculum: removed - FK relation no longer exists on Playbook model
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            spec: {
              select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                scope: true,
                outputType: true,
                specType: true,
                specRole: true,
                config: true,
                domain: true,
                priority: true,
                isActive: true,
                extendsAgent: true,
                _count: {
                  select: { triggers: true },
                },
              },
            },
            promptTemplate: {
              select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                isActive: true,
              },
            },
          },
        },
        // systemSpecs are derived from config.systemSpecToggles via withSystemSpecs()
        parentVersion: {
          select: {
            id: true,
            name: true,
            version: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    // Resolve system spec details for holographic course view
    const pbConfig = (playbook.config as Record<string, any>) || {};
    const sysToggles = pbConfig.systemSpecToggles || {};
    const systemSpecIds = Object.keys(sysToggles);
    const resolvedSystemSpecs = systemSpecIds.length > 0
      ? await prisma.analysisSpec.findMany({
          where: { id: { in: systemSpecIds } },
          select: { id: true, slug: true, name: true, description: true, specRole: true, outputType: true },
        })
      : [];

    return NextResponse.json({
      ok: true,
      playbook: withSystemSpecs(playbook, resolvedSystemSpecs),
    });
  } catch (error: any) {
    console.error("Error fetching playbook:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch playbook" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/playbooks/:playbookId
 * @visibility public
 * @scope playbooks:write
 * @auth session
 * @tags playbooks
 * @description Update playbook metadata, items, system spec toggles, status, or config settings
 * @pathParam playbookId string - Playbook UUID
 * @body name string - Updated playbook name
 * @body description string - Updated description
 * @body items Array - Replacement items array (for DRAFT playbooks)
 * @body specs Array - System spec toggles array
 * @body toggleSpec object - Single spec toggle { specId, enabled }
 * @body agentId string - Agent ID reference
 * @body sortOrder number - Domain-level sort order
 * @body domainId string - Reassign to another domain
 * @body status string - Status transition (DRAFT, ARCHIVED)
 * @body configSettings object - Config settings (memory, learning, AI, thresholds)
 * @response 200 { ok: true, playbook: Playbook }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;
    const body = await request.json();
    const { name, description, items, specs, agentId, toggleSpec, sortOrder, domainId, status, configSettings } = body;

    const existing = await prisma.playbook.findUnique({
      where: { id: playbookId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    // sortOrder and domainId can always be updated (even for published playbooks)
    // These are domain-level organization, not playbook content
    if (sortOrder !== undefined || domainId !== undefined) {
      const updated = await prisma.playbook.update({
        where: { id: playbookId },
        data: {
          ...(sortOrder !== undefined && { sortOrder }),
          ...(domainId !== undefined && { domainId }),
        },
        include: {
          domain: { select: { id: true, slug: true, name: true } },
          _count: { select: { items: true } },
        },
      });
      return NextResponse.json({ ok: true, playbook: updated });
    }

    // Handle status changes (unpublish: PUBLISHED → DRAFT)
    if (status !== undefined) {
      // Validate status transition
      if (status === "DRAFT" && existing.status === "PUBLISHED") {
        // Unpublish - allowed
        const updated = await prisma.playbook.update({
          where: { id: playbookId },
          data: { status: "DRAFT" },
          include: {
            domain: { select: { id: true, slug: true, name: true } },
            _count: { select: { items: true } },
          },
        });
        return NextResponse.json({ ok: true, playbook: updated, message: "Playbook unpublished" });
      } else if (status === "ARCHIVED") {
        // Archive - allowed from any status
        const updated = await prisma.playbook.update({
          where: { id: playbookId },
          data: { status: "ARCHIVED" },
          include: {
            domain: { select: { id: true, slug: true, name: true } },
            _count: { select: { items: true } },
          },
        });
        return NextResponse.json({ ok: true, playbook: updated, message: "Playbook archived" });
      } else {
        return NextResponse.json(
          { ok: false, error: `Invalid status transition: ${existing.status} → ${status}` },
          { status: 400 }
        );
      }
    }

    // For published playbooks, only allow system spec toggle updates
    const isToggleOnlyUpdate = (specs !== undefined || toggleSpec !== undefined) &&
      name === undefined && description === undefined &&
      items === undefined && agentId === undefined;

    if (existing.status === "PUBLISHED" && !isToggleOnlyUpdate) {
      return NextResponse.json(
        { ok: false, error: "Cannot modify a published playbook. Create a new version instead." },
        { status: 400 }
      );
    }

    // Handle convenience toggleSpec format from Studio: { specId, enabled }
    // This auto-detects if spec is SYSTEM or DOMAIN and updates accordingly
    if (toggleSpec) {
      const { specId, enabled } = toggleSpec;

      // Find the spec to determine its scope
      const spec = await prisma.analysisSpec.findUnique({
        where: { id: specId },
        select: { id: true, scope: true },
      });

      if (!spec) {
        return NextResponse.json(
          { ok: false, error: "Spec not found" },
          { status: 404 }
        );
      }

      if (spec.scope === "SYSTEM") {
        // Save single system spec toggle to config.systemSpecToggles
        const currentConfig = (existing.config as Record<string, any>) || {};
        const toggles = currentConfig.systemSpecToggles || {};
        toggles[specId] = {
          isEnabled: enabled,
          configOverride: toggles[specId]?.configOverride || null,
        };
        await prisma.playbook.update({
          where: { id: playbookId },
          data: {
            config: { ...currentConfig, systemSpecToggles: toggles },
          },
        });
      } else {
        // Toggle domain spec via PlaybookItem
        const existingItem = await prisma.playbookItem.findFirst({
          where: { playbookId, specId },
        });

        if (existingItem) {
          // Update existing item
          await prisma.playbookItem.update({
            where: { id: existingItem.id },
            data: { isEnabled: enabled },
          });
        } else if (enabled) {
          // Create new item (only if enabling)
          const maxOrder = await prisma.playbookItem.aggregate({
            where: { playbookId },
            _max: { sortOrder: true },
          });
          await prisma.playbookItem.create({
            data: {
              playbookId,
              specId,
              itemType: "SPEC",
              isEnabled: true,
              sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            },
          });
        }
      }

      // Return updated playbook
      const updated = await prisma.playbook.findUnique({
        where: { id: playbookId },
        include: {
          domain: { select: { id: true, slug: true, name: true } },
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              spec: {
                select: {
                  id: true, slug: true, name: true, description: true,
                  scope: true, outputType: true, specType: true, specRole: true,
                },
              },
            },
          },
          // systemSpecs are derived from config.systemSpecToggles via withSystemSpecs()
        },
      });

      return NextResponse.json({ ok: true, playbook: withSystemSpecs(updated) });
    }

    // Update metadata (including optional agentId) - only for non-published
    let playbook = existing;
    if (existing.status !== "PUBLISHED") {
      playbook = await prisma.playbook.update({
        where: { id: playbookId },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(agentId !== undefined && { agentId: agentId || null }),
        },
      });
    }

    // Update items if provided (only for non-published)
    if (items !== undefined && existing.status !== "PUBLISHED") {
      // Delete existing items
      await prisma.playbookItem.deleteMany({
        where: { playbookId },
      });

      // Create new items
      if (items.length > 0) {
        await prisma.playbookItem.createMany({
          data: items.map((item: any, index: number) => ({
            playbookId,
            itemType: item.itemType,
            specId: item.specId || null,
            promptTemplateId: item.promptTemplateId || null,
            isEnabled: item.isEnabled !== false,
            sortOrder: index,
          })),
        });
      }
    }

    // Save system spec toggles to playbook.config.systemSpecToggles
    if (specs !== undefined) {
      const systemSpecToggles: Record<string, { isEnabled: boolean; configOverride: any }> = {};
      for (const s of specs as Array<{ specId: string; isEnabled: boolean; configOverride: any }>) {
        systemSpecToggles[s.specId] = {
          isEnabled: s.isEnabled,
          configOverride: s.configOverride || null,
        };
      }
      const currentConfig = (existing.config as Record<string, any>) || {};
      await prisma.playbook.update({
        where: { id: playbookId },
        data: {
          config: { ...currentConfig, systemSpecToggles },
        },
      });
    }

    // Save config settings (memory, learning, AI, thresholds) to playbook.config.configSettings
    if (configSettings !== undefined) {
      // Re-fetch to get latest config (in case specs were also updated)
      const current = await prisma.playbook.findUnique({
        where: { id: playbookId },
        select: { config: true },
      });
      const currentConfig = (current?.config as Record<string, any>) || {};
      await prisma.playbook.update({
        where: { id: playbookId },
        data: {
          config: { ...currentConfig, configSettings },
        },
      });
    }

    // Fetch updated playbook
    const updated = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        domain: {
          select: { id: true, slug: true, name: true },
        },
        // agent: removed - FK relation deprecated
        // curriculum: removed - FK relation no longer exists on Playbook model
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            spec: {
              select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                scope: true,
                outputType: true,
                specType: true,
                specRole: true,
                _count: {
                  select: { triggers: true },
                },
              },
            },
            promptTemplate: {
              select: {
                id: true,
                slug: true,
                name: true,
              },
            },
          },
        },
        // systemSpecs are derived from config.systemSpecToggles via withSystemSpecs()
      },
    });

    return NextResponse.json({
      ok: true,
      playbook: withSystemSpecs(updated),
    });
  } catch (error: any) {
    console.error("Error updating playbook:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update playbook" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/playbooks/:playbookId
 * @visibility public
 * @scope playbooks:write
 * @auth session
 * @tags playbooks
 * @description Delete a draft playbook and its items. Published playbooks cannot be deleted.
 * @pathParam playbookId string - Playbook UUID
 * @response 200 { ok: true, message: "Playbook deleted" }
 * @response 400 { ok: false, error: "Cannot delete a published playbook. Archive it instead." }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    const existing = await prisma.playbook.findUnique({
      where: { id: playbookId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    if (existing.status === "PUBLISHED") {
      return NextResponse.json(
        { ok: false, error: "Cannot delete a published playbook. Archive it instead." },
        { status: 400 }
      );
    }

    // Delete playbook and all FK relationships (fixes prior orphan bugs)
    const counts = await deletePlaybookData(playbookId);

    return NextResponse.json({
      ok: true,
      message: "Playbook deleted",
      counts,
    });
  } catch (error: any) {
    console.error("Error deleting playbook:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete playbook" },
      { status: 500 }
    );
  }
}
