/**
 * Physical Materials Transform
 *
 * Surfaces physical materials (textbooks, workbooks, worksheets) that the
 * student has with them. The AI uses this to:
 * - Direct the student to specific pages during sessions
 * - Confirm the student is on the correct page before teaching from it
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

registerTransform("formatPhysicalMaterials", (_rawData: any, context: AssembledContext) => {
  const playbookConfig = context.loadedData?.playbooks?.[0]?.config as PlaybookConfig | undefined;
  const physicalMaterials = playbookConfig?.physicalMaterials;

  if (!physicalMaterials || physicalMaterials.trim() === "") return null;

  return {
    description: physicalMaterials.trim(),
  };
});
