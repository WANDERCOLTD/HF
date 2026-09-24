import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJsonSpec, convertJsonSpecToHybrid } from "@/lib/bdd/ai-parser";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { SpecType, SpecificationScope, AnalysisOutputType, SpecRole } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const SPECS_DIR = path.join(process.cwd(), "docs-archive", "bdd-specs");

/**
 * @api POST /api/lab/upload
 * @visibility internal
 * @scope lab:write
 * @auth session
 * @tags lab
 * @description One-step upload: accepts a JSON spec, creates BDDFeatureSet, activates to create AnalysisSpec.
 *   Saves spec to docs-archive/bdd-specs/ directory and upserts feature set and analysis spec in DB.
 * @body spec object - The JSON spec definition to upload
 * @response 200 { ok: true, featureSet: { id, featureId, name, version }, spec: { id, slug, name, scope, outputType }, message: string }
 * @response 400 { ok: false, error: "No spec provided..." }
 * @response 400 { ok: false, error: "Invalid spec: ..." }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const { spec } = body;

    if (!spec) {
      return NextResponse.json(
        { ok: false, error: "No spec provided. Send { spec: {...} }" },
        { status: 400 }
      );
    }

    // Parse and validate the spec
    const parseResult = parseJsonSpec(JSON.stringify(spec));
    if (!parseResult.success) {
      return NextResponse.json(
        { ok: false, error: `Invalid spec: ${parseResult.errors.join(", ")}` },
        { status: 400 }
      );
    }

    const parsedSpec = parseResult.data;

    // Save to docs-archive/bdd-specs/ directory for version control
    try {
      if (!fs.existsSync(SPECS_DIR)) {
        fs.mkdirSync(SPECS_DIR, { recursive: true });
      }
      const filename = `${parsedSpec.id.toLowerCase()}.spec.json`;
      const filePath = path.join(SPECS_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(spec, null, 2), "utf-8");
    } catch (fileError) {
      console.warn("Could not save spec to docs-archive/bdd-specs/:", fileError);
      // Continue anyway - DB is primary, file is backup
    }

    // Convert to hybrid format
    const hybrid = convertJsonSpecToHybrid(parsedSpec);
    const parameters = hybrid.parameterData?.parameters || [];
    const storyData = hybrid.storyData;

    // Build feature set data
    const featureSetData = {
      featureId: parsedSpec.id,
      name: parsedSpec.title,
      description: parsedSpec.story
        ? `As ${parsedSpec.story.asA}, I want ${parsedSpec.story.iWant} so that ${parsedSpec.story.soThat}`
        : undefined,
      version: parsedSpec.version || "1.0",
      specType: (parsedSpec.specType as SpecType) || SpecType.DOMAIN,
      parameters: parameters as any,
      constraints: (storyData?.constraints || []) as any,
      validations: [] as any,
      definitions: {} as any,
      thresholds: {} as any,
      promptGuidance: {} as any,
      scoringSpec: {
        source: "studio-upload",
        domain: parsedSpec.domain,
        outputType: parsedSpec.outputType,
        specRole: parsedSpec.specRole,
        agentScope: parsedSpec.agentScope,
      } as any,
    };

    // Upsert feature set
    const existing = await prisma.bDDFeatureSet.findFirst({
      where: { featureId: parsedSpec.id },
    });

    let featureSet;
    if (existing) {
      featureSet = await prisma.bDDFeatureSet.update({
        where: { id: existing.id },
        data: {
          ...featureSetData,
          version: incrementVersion(existing.version),
        },
      });
    } else {
      featureSet = await prisma.bDDFeatureSet.create({
        data: featureSetData,
      });
    }

    // Now activate it - create/update AnalysisSpec
    const specSlug = `spec-${parsedSpec.id.toLowerCase()}`;
    const existingSpec = await prisma.analysisSpec.findUnique({
      where: { slug: specSlug },
    });

    // Determine scope and output type
    const scope: SpecificationScope = parsedSpec.specType === "SYSTEM"
      ? SpecificationScope.SYSTEM
      : SpecificationScope.DOMAIN;
    const outputType: AnalysisOutputType = (parsedSpec.outputType as AnalysisOutputType) || AnalysisOutputType.MEASURE;
    const specRole: SpecRole | undefined = parsedSpec.specRole
      ? (parsedSpec.specRole as SpecRole)
      : undefined;

    // Build config from parameters for IDENTITY and CONTENT specs
    let config: Record<string, any> | null = null;
    if (specRole === SpecRole.IDENTITY || specRole === SpecRole.CONTENT) {
      config = {};
      for (const param of parameters) {
        const paramId = (param as any).id || (param as any).parameterId;
        if ((param as any).config) {
          Object.assign(config, (param as any).config);
        }
        if (paramId && (param as any).config) {
          config[paramId] = (param as any).config;
        }
      }
    }

    const specData = {
      name: featureSet.name,
      description: featureSet.description,
      scope,
      outputType,
      specRole,
      specType: featureSet.specType as SpecType,
      // LastParms audit (#2031) finding #3: this fallback to "general" is
      // benign. `AnalysisSpec.domain` is a free-form `String?` (see
      // prisma/schema.prisma) used as a UI grouping label, NOT a constrained
      // taxonomy. Seed corpus already carries ~40 distinct values including
      // "admin", "chat", "pipeline", "wizard", "cieh-level2-food-safety" —
      // none of which match the `Parameter.domainGroup` canonical taxonomy.
      // No `canonical-spec-domain.ts` helper is warranted. Closed won't-fix.
      domain: (featureSet.scoringSpec as any)?.domain || "general",
      priority: featureSet.specType === "SYSTEM" ? 50 : 10,
      isActive: true,
      version: featureSet.version,
      compiledAt: new Date(),
      compiledSetId: featureSet.id,
      isDirty: false,
      ...(config && { config }),
    };

    let analysisSpec;
    if (existingSpec) {
      analysisSpec = await prisma.analysisSpec.update({
        where: { slug: specSlug },
        data: specData,
      });
    } else {
      analysisSpec = await prisma.analysisSpec.create({
        data: {
          slug: specSlug,
          ...specData,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      featureSet: {
        id: featureSet.id,
        featureId: featureSet.featureId,
        name: featureSet.name,
        version: featureSet.version,
      },
      spec: {
        id: analysisSpec.id,
        slug: analysisSpec.slug,
        name: analysisSpec.name,
        scope: analysisSpec.scope,
        outputType: analysisSpec.outputType,
      },
      message: existing ? "Spec updated and re-activated" : "Spec created and activated",
    });
  } catch (error: any) {
    console.error("Error uploading spec:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}

function incrementVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length === 2) {
    const minor = parseInt(parts[1]) + 1;
    return `${parts[0]}.${minor}`;
  }
  return version + ".1";
}
