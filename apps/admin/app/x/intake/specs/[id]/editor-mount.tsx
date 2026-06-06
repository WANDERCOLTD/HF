"use client";

// #1194 Phase 2b — client-side mount for @tallyseal/admin-editor.
//
// EditorShell uses React hooks (useReducer + useState + useEffect),
// so it must run in a client component. The parent server component
// passes:
//   - source: TS string from IntakeSpec.source (parsed client-side
//     via spec-emitter, keeps the EditableSpec AST off the
//     server→client serialisation wire)
//   - saveSpecAction / deploySpecAction: server actions that hit
//     the SpecStore adapter on the server
//
// Why parse client-side: spec-emitter's parse() returns an
// EditableSpec built from a stripped Babel AST. The structure may
// include readonly arrays / opaque-source-slice frozen objects that
// don't round-trip cleanly through Next.js's RSC serialisation. Parse
// at the use site to keep the contract simple.
//
// The reducer + state are owned by EditorShell itself per the
// component's documented architecture — we don't useReducer here.

import { useMemo } from "react";
import {
  EditorShell,
  type SaveSpecCallback,
  type DeploySpecCallback,
} from "@tallyseal/admin-editor";
import { parse } from "@tallyseal/spec-emitter";

interface EditorMountProps {
  readonly specName: string;
  readonly source: string;
  readonly canEdit: boolean;
  readonly canDeploy: boolean;
  readonly currentRole: string | null;
  readonly saveSpecAction: SaveSpecCallback;
  readonly deploySpecAction: DeploySpecCallback;
}

export function EditorMount({
  specName,
  source,
  canEdit,
  canDeploy,
  currentRole,
  saveSpecAction,
  deploySpecAction,
}: EditorMountProps) {
  // Parse once per mount. If source changes (rare — re-mount on
  // navigation), useMemo re-parses. EditorShell drives all
  // subsequent state via its own reducer.
  const initialSpec = useMemo(() => parse(source), [source]);

  return (
    <EditorShell
      specName={specName}
      initialSpec={initialSpec}
      canEdit={canEdit}
      canDeploy={canDeploy}
      currentRole={currentRole}
      saveSpecSource={saveSpecAction}
      deploySpec={deploySpecAction}
    />
  );
}
