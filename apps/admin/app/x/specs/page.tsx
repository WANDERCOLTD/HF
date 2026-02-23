"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEntityContext } from "@/contexts/EntityContext";
import {
  TreeNode,
  ExplorerTreeNode,
  useTreeKeyboardNavigation,
  collectAllNodeIds,
} from "@/components/shared/ExplorerTree";
import { FancySelect } from "@/components/shared/FancySelect";
import { DraggableTabs } from "@/components/shared/DraggableTabs";
import { Zap, FileJson } from "lucide-react";
import { SpecPill, ParameterPill, DomainPill, StatusBadge } from "@/src/components/shared/EntityPill";
import { SpecRoleBadge, getSpecEditorRoute, requiresSpecialEditor } from "@/components/shared/SpecRoleBadge";
import { UnifiedAssistantPanel } from "@/components/shared/UnifiedAssistantPanel";
import { useAssistant } from "@/hooks/useAssistant";
import { SpecConfigEditor } from "@/components/config-editor";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";
import "./specs.css";

type Spec = {
  id: string;
  slug: string;
  name: string;
  scope: string;
  outputType: string;
  specRole: string;
  description: string | null;
};

type ScoringAnchor = {
  id: string;
  score: number;
  example: string | null;
  rationale: string | null;
  isGold: boolean;
};

type ActionParameter = {
  parameterId: string;
  name: string;
  definition: string | null;
  scaleType: string | null;
  interpretationHigh: string | null;
  interpretationLow: string | null;
  scoringAnchors: ScoringAnchor[];
  behaviorTargets?: Array<{
    id: string;
    parameterId: string;
    scope: string;
    targetValue: number;
    confidence: number;
    source: string;
    playbook?: { id: string; name: string } | null;
  }>;
};

type TriggerAction = {
  id: string;
  description: string | null;
  weight: number | null;
  sortOrder: number;
  parameterId: string | null;
  learnCategory: string | null;
  learnKeyPrefix: string | null;
  learnKeyHint: string | null;
  parameter: ActionParameter | null;
};

type Trigger = {
  id: string;
  name: string | null;
  given: string | null;
  when: string | null;
  then: string | null;
  notes: string | null;
  sortOrder: number;
  actions: TriggerAction[];
};

type SpecDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: string;
  outputType: string;
  specRole: string | null;
  domain: string | null;
  config: Record<string, unknown> | null;
  promptTemplate: string | null;
  isActive: boolean;
  isLocked: boolean;
  lockedReason: string | null;
  isDeletable: boolean;
  priority: number;
  version: string | null;
  compiledAt: string | null;
  compiledSetId: string | null;
  createdAt: string;
  updatedAt: string;
  triggers?: Trigger[];
};

type FeatureSet = {
  id: string;
  featureId: string;
  name: string;
  description: string | null;
  version: string;
  specType: string;
  rawSpec: Record<string, unknown> | null;
  parameters: any[];
  constraints: any[];
  promptGuidance: any[];
  scoringSpec: Record<string, unknown> | null;
  definitions: Record<string, string> | null;
  thresholds: any[];
  parameterCount: number;
  constraintCount: number;
  definitionCount: number;
  isActive: boolean;
  activatedAt: string | null;
  validations: any[];
  createdAt: string;
  updatedAt: string;
};

const SCOPES = ["SYSTEM", "DOMAIN", "CALLER"] as const;
const TYPES = ["MEASURE", "LEARN", "ADAPT", "COMPOSE", "AGGREGATE", "REWARD"] as const;

const outputTypeColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  MEASURE: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)", icon: "📊", desc: "Score caller behavior" },
  LEARN: { bg: "var(--badge-violet-bg)", text: "var(--badge-violet-text)", icon: "💾", desc: "Extract memories/facts" },
  ADAPT: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)", icon: "🎯", desc: "Compute behavior targets" },
  COMPOSE: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)", icon: "✍️", desc: "Build prompt sections" },
  AGGREGATE: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)", icon: "📈", desc: "Combine data into profiles" },
  REWARD: { bg: "var(--badge-amber-bg)", text: "var(--badge-amber-text)", icon: "🏆", desc: "Compute reward signals" },
};

const scopeColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  SYSTEM: { bg: "var(--surface-tertiary)", text: "var(--text-primary)", icon: "⚙️", desc: "Global specs for all callers" },
  DOMAIN: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", icon: "🏢", desc: "Domain-specific specs" },
  CALLER: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)", icon: "👤", desc: "Per-caller learned specs" },
};

const roleColors: Record<string, { bg: string; text: string; label: string; icon: string; desc: string }> = {
  // New taxonomy
  ORCHESTRATE: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", label: "Orchestrate", icon: "🎯", desc: "Flow/sequence control" },
  EXTRACT: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)", label: "Extract", icon: "🔍", desc: "Measurement/learning" },
  SYNTHESISE: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)", label: "Synthesise", icon: "🧮", desc: "Combine/transform data" },
  CONSTRAIN: { bg: "var(--badge-red-bg)", text: "var(--badge-red-text)", label: "Constrain", icon: "📏", desc: "Bounds/guardrails" },
  IDENTITY: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)", label: "Identity", icon: "👤", desc: "Agent personas" },
  CONTENT: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)", label: "Content", icon: "📚", desc: "Curriculum" },
  VOICE: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)", label: "Voice", icon: "🎙️", desc: "Voice guidance" },
  OBSERVE: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)", label: "Observe", icon: "📡", desc: "System health/metrics" },
  // Deprecated (backward compatibility) - grayed out
  MEASURE: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Measure (→Extract)", icon: "📊", desc: "DEPRECATED: Use EXTRACT" },
  ADAPT: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Adapt (→Synthesise)", icon: "🔄", desc: "DEPRECATED: Use SYNTHESISE" },
  REWARD: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Reward (→Synthesise)", icon: "⭐", desc: "DEPRECATED: Use SYNTHESISE" },
  GUARDRAIL: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Guardrail (→Constrain)", icon: "🛡️", desc: "DEPRECATED: Use CONSTRAIN" },
  BOOTSTRAP: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Bootstrap (→Orchestrate)", icon: "🔄", desc: "DEPRECATED: Use ORCHESTRATE" },
};

// =============================================================================
// UTILITY FUNCTIONS - Tree Navigation
// =============================================================================

/**
 * Find a node in the tree by ID
 */
function findNodeById(tree: TreeNode | null, targetId: string): TreeNode | null {
  if (!tree) return null;
  if (tree.id === targetId) return tree;

  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeById(child, targetId);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get the path of parent node IDs from root to the target node
 * Returns an array of IDs that need to be expanded to show the target
 */
function getNodePath(tree: TreeNode | null, targetId: string, path: string[] = []): string[] | null {
  if (!tree) return null;
  if (tree.id === targetId) return path;

  if (tree.children) {
    for (const child of tree.children) {
      const result = getNodePath(child, targetId, [...path, tree.id]);
      if (result) return result;
    }
  }

  return null;
}

// =============================================================================
// Source Authority Panel (for CONTENT specs)
// =============================================================================

const TRUST_LEVEL_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  REGULATORY_STANDARD: { bg: "var(--trust-l5-bg)", text: "var(--trust-l5-text)", label: "L5 Regulatory" },
  ACCREDITED_MATERIAL: { bg: "var(--trust-l4-bg)", text: "var(--trust-l4-text)", label: "L4 Accredited" },
  PUBLISHED_REFERENCE: { bg: "var(--trust-l3-bg)", text: "var(--trust-l3-text)", label: "L3 Published" },
  EXPERT_CURATED: { bg: "var(--trust-l2-bg)", text: "var(--trust-l2-text)", label: "L2 Expert" },
  AI_ASSISTED: { bg: "var(--trust-l1-bg)", text: "var(--trust-l1-text)", label: "L1 AI" },
  UNVERIFIED: { bg: "var(--trust-l0-bg)", text: "var(--trust-l0-text)", label: "L0 Unverified" },
};

type AvailableSource = {
  slug: string;
  name: string;
  trustLevel: string;
  publisherOrg: string | null;
  validUntil: string | null;
  isExpired: boolean;
};

function SourceAuthorityPanel({
  configText,
  onConfigChange,
  disabled,
}: {
  configText: string;
  onConfigChange: (newConfig: string) => void;
  disabled: boolean;
}) {
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Parse current sourceAuthority from config
  const parsed = useMemo(() => {
    try {
      const cfg = JSON.parse(configText);
      return cfg?.sourceAuthority || null;
    } catch {
      return null;
    }
  }, [configText]);

  const primarySource = parsed?.primarySource || null;
  const secondarySources: any[] = parsed?.secondarySources || [];

  // Fetch available sources
  useEffect(() => {
    setLoadingSources(true);
    fetch("/api/content-sources/available")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setAvailableSources(d.sources || []);
      })
      .catch((e) => console.warn("[Specs] Failed to load content sources:", e))
      .finally(() => setLoadingSources(false));
  }, []);

  // Update config JSON when sourceAuthority changes
  const updateSourceAuthority = useCallback(
    (newSA: any) => {
      try {
        const cfg = JSON.parse(configText);
        cfg.sourceAuthority = { ...newSA, contract: "CONTENT_TRUST_V1" };
        onConfigChange(JSON.stringify(cfg, null, 2));
      } catch {
        // Config isn't valid JSON - can't update
      }
    },
    [configText, onConfigChange],
  );

  const setPrimarySource = useCallback(
    (slug: string) => {
      const source = availableSources.find((s) => s.slug === slug);
      if (!source) return;
      updateSourceAuthority({
        ...parsed,
        primarySource: {
          slug: source.slug,
          name: source.name,
          trustLevel: source.trustLevel,
          publisherOrg: source.publisherOrg,
        },
      });
    },
    [availableSources, parsed, updateSourceAuthority],
  );

  const addSecondarySource = useCallback(
    (slug: string) => {
      const source = availableSources.find((s) => s.slug === slug);
      if (!source) return;
      // Don't add duplicates
      if (secondarySources.some((s: any) => s.slug === slug)) return;
      updateSourceAuthority({
        ...parsed,
        secondarySources: [
          ...secondarySources,
          {
            slug: source.slug,
            name: source.name,
            trustLevel: source.trustLevel,
            publisherOrg: source.publisherOrg,
          },
        ],
      });
    },
    [availableSources, parsed, secondarySources, updateSourceAuthority],
  );

  const removeSecondarySource = useCallback(
    (slug: string) => {
      updateSourceAuthority({
        ...parsed,
        secondarySources: secondarySources.filter((s: any) => s.slug !== slug),
      });
    },
    [parsed, secondarySources, updateSourceAuthority],
  );

  const removePrimarySource = useCallback(() => {
    const { primarySource: _removed, ...rest } = parsed || {};
    updateSourceAuthority(rest);
  }, [parsed, updateSourceAuthority]);

  const TrustBadge = ({ level }: { level: string }) => {
    const info = TRUST_LEVEL_COLORS[level] || TRUST_LEVEL_COLORS.UNVERIFIED;
    return (
      <span
        className="hf-trust-badge"
        style={{ background: info.bg, color: info.text }}
      >
        {info.label}
      </span>
    );
  };

  // Sources not yet assigned
  const unassignedSources = availableSources.filter(
    (s) =>
      s.slug !== primarySource?.slug &&
      !secondarySources.some((sec: any) => sec.slug === s.slug),
  );

  return (
    <div className="hf-source-panel">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="hf-source-panel-header"
      >
        <span>Source Authority {primarySource ? `(${primarySource.slug})` : "(not configured)"}</span>
        <span className="hf-text-xs">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="hf-source-panel-body">
          {/* Primary Source */}
          <div className="hf-mb-md">
            <label className="hf-trigger-label">
              Primary Source
            </label>
            {primarySource ? (
              <div className="hf-source-row">
                <TrustBadge level={primarySource.trustLevel} />
                <span className="hf-source-name">{primarySource.name || primarySource.slug}</span>
                {primarySource.publisherOrg && (
                  <span className="hf-text-xs hf-text-muted">({primarySource.publisherOrg})</span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={removePrimarySource}
                    className="hf-btn-remove-link"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <select
                disabled={disabled || loadingSources}
                onChange={(e) => { if (e.target.value) setPrimarySource(e.target.value); }}
                value=""
                className="hf-source-select"
              >
                <option value="">
                  {loadingSources ? "Loading sources..." : "Select primary source..."}
                </option>
                {availableSources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    [{TRUST_LEVEL_COLORS[s.trustLevel]?.label || s.trustLevel}] {s.name}
                    {s.isExpired ? " (EXPIRED)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Secondary Sources */}
          <div className="hf-mb-sm">
            <label className="hf-trigger-label">
              Secondary Sources ({secondarySources.length})
            </label>
            {secondarySources.map((src: any) => (
              <div
                key={src.slug}
                className="hf-source-row hf-source-row-secondary"
              >
                <TrustBadge level={src.trustLevel} />
                <span className="hf-source-name-secondary">{src.name || src.slug}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeSecondarySource(src.slug)}
                    className="hf-btn-remove-link"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {!disabled && unassignedSources.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) addSecondarySource(e.target.value); }}
                value=""
                className="hf-source-select hf-source-select-secondary"
              >
                <option value="">Add secondary source...</option>
                {unassignedSources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    [{TRUST_LEVEL_COLORS[s.trustLevel]?.label || s.trustLevel}] {s.name}
                    {s.isExpired ? " (EXPIRED)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Link to source registry */}
          <div className="hf-text-xs hf-text-muted">
            <a href="/x/content-sources" target="_blank" rel="noopener" className="hf-link-accent">
              Manage sources in registry →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpecsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const highlightTriggerId = searchParams.get("trigger");
  const highlightActionId = searchParams.get("action");

  // List state
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Detail state
  const [spec, setSpec] = useState<SpecDetail | null>(null);
  const [featureSet, setFeatureSet] = useState<FeatureSet | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recompiling, setRecompiling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Editable fields
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [specRole, setSpecRole] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Collapsible sections
  const [showRawSpec, setShowRawSpec] = useState(false);
  const [showParameters, setShowParameters] = useState(true);
  const [showPromptGuidance, setShowPromptGuidance] = useState(false);
  const [activeTab, setActiveTab] = useState<"derived" | "source">("derived");

  // Triggers tree state
  const [showTriggers, setShowTriggers] = useState(true);
  const [expandedTriggers, setExpandedTriggers] = useState<Set<string>>(new Set());
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const highlightedRef = useRef<HTMLElement | null>(null);
  const setHighlightedRef = useCallback((el: HTMLElement | null) => { highlightedRef.current = el; }, []);

  // Trigger editing state (modal for adding new)
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // Inline grid editing state
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [cellSaving, setCellSaving] = useState<string | null>(null);

  // Explorer tree state
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [explorerTree, setExplorerTree] = useState<TreeNode | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedTreeNode, setSelectedTreeNode] = useState<TreeNode | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Unimported specs count (for sync badge)
  const [unimportedCount, setUnimportedCount] = useState<number>(0);

  // Content source freshness
  const [freshness, setFreshness] = useState<{ expired: number; expiring: number } | null>(null);

  // AI Assistant panel (unified)
  const assistant = useAssistant({
    defaultTab: "spec",
    layout: "popout",
    enabledTabs: ["chat", "spec"], // Only show relevant tabs for spec page
  });

  const { pushEntity } = useEntityContext();

  // Toggle functions for triggers tree
  const toggleTrigger = useCallback((triggerId: string) => {
    setExpandedTriggers((prev) => {
      const next = new Set(prev);
      if (next.has(triggerId)) next.delete(triggerId);
      else next.add(triggerId);
      return next;
    });
  }, []);

  const toggleAction = useCallback((actionId: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }, []);

  // Trigger CRUD handlers
  const handleAddTrigger = useCallback(() => {
    setEditingTrigger(null);
    setTriggerError(null);
    setTriggerModalOpen(true);
  }, []);

  const handleEditTrigger = useCallback((trigger: Trigger) => {
    setEditingTrigger(trigger);
    setTriggerError(null);
    setTriggerModalOpen(true);
  }, []);

  const handleDeleteTrigger = useCallback(async (triggerId: string) => {
    if (!spec) return;
    if (!window.confirm("Delete this trigger and all its actions?")) return;

    try {
      const res = await fetch(`/api/analysis-specs/${spec.id}/triggers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerId }),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh spec to get updated triggers
        const refreshRes = await fetch(`/api/analysis-specs/${spec.id}`);
        const refreshData = await refreshRes.json();
        if (refreshData.ok) setSpec(refreshData.spec);
      } else {
        alert(data.error || "Failed to delete trigger");
      }
    } catch (e: any) {
      alert(e.message || "Failed to delete trigger");
    }
  }, [spec]);

  const handleSaveTrigger = useCallback(async (formData: {
    given: string;
    when: string;
    then: string;
    name: string;
    notes: string;
    actions: Array<{
      description: string;
      weight: number;
      parameterId?: string;
      learnCategory?: string;
      learnKeyPrefix?: string;
      learnKeyHint?: string;
    }>;
  }) => {
    if (!spec) return;
    setTriggerSaving(true);
    setTriggerError(null);

    try {
      const isEdit = !!editingTrigger;
      const res = await fetch(`/api/analysis-specs/${spec.id}/triggers`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { triggerId: editingTrigger.id, ...formData } : formData),
      });

      const data = await res.json();
      if (!data.ok) {
        setTriggerError(data.error || "Failed to save trigger");
        return;
      }

      setTriggerModalOpen(false);
      // Refresh spec to get updated triggers
      const refreshRes = await fetch(`/api/analysis-specs/${spec.id}`);
      const refreshData = await refreshRes.json();
      if (refreshData.ok) setSpec(refreshData.spec);
    } catch (e: any) {
      setTriggerError(e.message || "Failed to save trigger");
    } finally {
      setTriggerSaving(false);
    }
  }, [spec, editingTrigger]);

  // Inline cell save — patches a single trigger field
  const handleInlineSave = useCallback(async (triggerId: string, field: string, value: string) => {
    if (!spec) return;
    const cellKey = `trigger-${triggerId}-${field}`;
    setCellSaving(cellKey);
    try {
      const res = await fetch(`/api/analysis-specs/${spec.id}/triggers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerId, [field]: value }),
      });
      const data = await res.json();
      if (data.ok) {
        // Update locally
        setSpec((prev) => {
          if (!prev?.triggers) return prev;
          return {
            ...prev,
            triggers: prev.triggers.map((t) =>
              t.id === triggerId ? { ...t, [field === "then" ? "then" : field]: value } : t
            ),
          };
        });
        setEditingCell(null);
      } else {
        alert(data.error || "Failed to save");
      }
    } catch (e: any) {
      alert(e.message || "Failed to save");
    } finally {
      setCellSaving(null);
    }
  }, [spec]);

  // Save full actions array for a trigger (used for action add/edit/remove)
  const handleSaveActions = useCallback(async (triggerId: string, actions: TriggerAction[]) => {
    if (!spec) return;
    setCellSaving(`trigger-${triggerId}-actions`);
    try {
      const res = await fetch(`/api/analysis-specs/${spec.id}/triggers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerId,
          actions: actions.map((a) => ({
            description: a.description || "",
            weight: a.weight ?? 1.0,
            parameterId: a.parameterId || null,
            learnCategory: a.learnCategory || null,
            learnKeyPrefix: a.learnKeyPrefix || null,
            learnKeyHint: a.learnKeyHint || null,
          })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh spec to get updated data with IDs
        const refreshRes = await fetch(`/api/analysis-specs/${spec.id}`);
        const refreshData = await refreshRes.json();
        if (refreshData.ok) setSpec(refreshData.spec);
        setEditingCell(null);
      } else {
        alert(data.error || "Failed to save actions");
      }
    } catch (e: any) {
      alert(e.message || "Failed to save actions");
    } finally {
      setCellSaving(null);
    }
  }, [spec]);

  // Add a new empty action to a trigger
  const handleAddAction = useCallback(async (trigger: Trigger) => {
    const newActions: TriggerAction[] = [
      ...trigger.actions,
      {
        id: `new-${Date.now()}`,
        description: "",
        weight: 1.0,
        sortOrder: trigger.actions.length,
        parameterId: null,
        learnCategory: null,
        learnKeyPrefix: null,
        learnKeyHint: null,
        parameter: null,
      },
    ];
    await handleSaveActions(trigger.id, newActions);
  }, [handleSaveActions]);

  // Remove an action from a trigger
  const handleRemoveAction = useCallback(async (trigger: Trigger, actionId: string) => {
    const newActions = trigger.actions.filter((a) => a.id !== actionId);
    await handleSaveActions(trigger.id, newActions);
  }, [handleSaveActions]);

  // Inline action field save — updates one field, patches full actions array
  const handleInlineActionSave = useCallback(async (trigger: Trigger, actionId: string, field: string, value: string | number) => {
    const updatedActions = trigger.actions.map((a) =>
      a.id === actionId ? { ...a, [field]: value } : a
    );
    await handleSaveActions(trigger.id, updatedActions);
  }, [handleSaveActions]);

  // Explorer tree functions
  const fetchExplorerTree = useCallback(async () => {
    if (explorerTree) return; // Already loaded
    setExplorerLoading(true);
    try {
      const res = await fetch("/api/specs/tree");
      const data = await res.json();
      if (data.ok && data.tree) {
        setExplorerTree(data.tree);
        // Auto-expand root and first level
        const toExpand = new Set<string>();
        toExpand.add(data.tree.id);
        data.tree.children?.forEach((child: TreeNode) => {
          toExpand.add(child.id);
        });
        setExpandedNodes(toExpand);
        setSelectedTreeNode(data.tree);
      }
    } catch (err) {
      console.error("Error fetching specs tree:", err);
    } finally {
      setExplorerLoading(false);
    }
  }, [explorerTree]);

  const toggleNodeExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAllNodes = useCallback(() => {
    if (!explorerTree) return;
    setExpandedNodes(collectAllNodeIds(explorerTree));
  }, [explorerTree]);

  const collapseAllNodes = useCallback(() => {
    if (!explorerTree) return;
    setExpandedNodes(new Set([explorerTree.id]));
  }, [explorerTree]);

  // Handle tree node selection - navigate to spec
  const handleTreeNodeSelect = useCallback(
    (node: TreeNode) => {
      setSelectedTreeNode(node);
      // Navigate to spec detail if it's a spec node
      if (node.type === "spec" && node.meta?.specId) {
        router.push(`/x/specs?id=${node.meta.specId}`, { scroll: false });
      }
    },
    [router]
  );

  // Handle tree node double-click - same as single click for specs
  const handleTreeDoubleClick = useCallback(
    (node: TreeNode) => {
      if (node.type === "spec" && node.meta?.specId) {
        router.push(`/x/specs?id=${node.meta.specId}`, { scroll: false });
      }
    },
    [router]
  );

  // Keyboard navigation for tree
  const { handleKeyDown: handleTreeKeyDown } = useTreeKeyboardNavigation({
    root: explorerTree,
    expandedNodes,
    selectedNode: selectedTreeNode,
    onToggleExpand: toggleNodeExpand,
    onSelectNode: handleTreeNodeSelect,
  });

  // Fetch tree when switching to tree view
  useEffect(() => {
    if (viewMode === "tree" && !explorerTree) {
      fetchExplorerTree();
    }
  }, [viewMode, explorerTree, fetchExplorerTree]);

  // Helper for score colors
  const getScoreColor = (score: number): string => {
    if (score >= 4) return "bg-green-100 text-green-700";
    if (score >= 3) return "bg-yellow-100 text-yellow-700";
    if (score >= 2) return "bg-orange-100 text-orange-700";
    return "bg-red-100 text-red-700";
  };

  // Fetch list
  useEffect(() => {
    fetch(`/api/analysis-specs`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSpecs(data.specs || []);
        else setError(data.error);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Fetch unimported specs count for sync badge
  useEffect(() => {
    fetch("/api/admin/spec-sync")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.unseeded) {
          setUnimportedCount(data.unseeded.length);
        }
      })
      .catch(() => {
        // Silently fail - badge just won't show
      });
  }, []);

  // Fetch content source freshness for banner
  useEffect(() => {
    fetch("/api/content-sources")
      .then((r) => r.json())
      .then((data) => {
        if (data.sources) {
          const now = Date.now();
          let expired = 0;
          let expiring = 0;
          for (const s of data.sources) {
            if (!s.validUntil) continue;
            const days = Math.floor((new Date(s.validUntil).getTime() - now) / 86400000);
            if (days < 0) expired++;
            else if (days <= 60) expiring++;
          }
          if (expired > 0 || expiring > 0) {
            setFreshness({ expired, expiring });
          }
        }
      })
      .catch((e) => console.warn("[Specs] Failed to load freshness data:", e));
  }, []);

  // Fetch detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setSpec(null);
      setFeatureSet(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    setHasChanges(false);
    setSaveMessage(null);

    fetch(`/api/analysis-specs/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setSpec(data.spec);
          setFeatureSet(data.featureSet);
          setConfigText(JSON.stringify(data.spec.config || {}, null, 2));
          setPromptTemplate(data.spec.promptTemplate || "");
          setSpecRole(data.spec.specRole || "");
          setActiveTab("derived");
          pushEntity({
            type: "spec",
            id: data.spec.id,
            label: data.spec.name,
            href: `/x/specs?id=${data.spec.id}`,
            data: {
              slug: data.spec.slug,
              scope: data.spec.scope,
              outputType: data.spec.outputType,
              specRole: data.spec.specRole,
              description: data.spec.description,
              domain: data.spec.domain,
            },
          });
        } else {
          setDetailError(data.error);
        }
        setDetailLoading(false);
      })
      .catch((e) => {
        setDetailError(e.message);
        setDetailLoading(false);
      });
  }, [selectedId, pushEntity]);

  // Sync tree selection with URL selectedId
  useEffect(() => {
    if (viewMode !== "tree" || !explorerTree || !selectedId) return;

    // Find the node in the tree that matches the selected spec ID
    const targetNode = findNodeById(explorerTree, selectedId);
    if (!targetNode) return;

    // Get the path of parent IDs that need to be expanded
    const pathToNode = getNodePath(explorerTree, selectedId);
    if (pathToNode) {
      // Expand all parent nodes
      setExpandedNodes((prev) => {
        const newExpanded = new Set(prev);
        pathToNode.forEach((id) => newExpanded.add(id));
        return newExpanded;
      });
    }

    // Select the target node in the tree
    setSelectedTreeNode(targetNode);
  }, [selectedId, explorerTree, viewMode]);

  // Auto-expand and scroll to highlighted trigger/action when coming from graph
  useEffect(() => {
    if (!spec?.triggers) return;

    // If we have a trigger or action to highlight, expand and scroll
    if (highlightTriggerId || highlightActionId) {
      setShowTriggers(true);

      // Find the trigger containing the highlighted action (if action is specified)
      if (highlightActionId) {
        for (const trigger of spec.triggers) {
          const action = trigger.actions.find((a) => a.id === highlightActionId);
          if (action) {
            // Expand both the trigger and the action
            setExpandedTriggers((prev) => new Set(prev).add(trigger.id));
            setExpandedActions((prev) => new Set(prev).add(highlightActionId));
            break;
          }
        }
      } else if (highlightTriggerId) {
        // Just expand the trigger
        setExpandedTriggers((prev) => new Set(prev).add(highlightTriggerId));
      }

      // Scroll to highlighted element after a brief delay for DOM to update
      setTimeout(() => {
        highlightedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }, [spec, highlightTriggerId, highlightActionId]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const ROLES = Object.keys(roleColors);

  const filteredSpecs = specs.filter((s) => {
    if (selectedScopes.size > 0 && !selectedScopes.has(s.scope)) return false;
    if (selectedTypes.size > 0 && !selectedTypes.has(s.outputType)) return false;
    if (selectedRoles.size > 0 && !selectedRoles.has(s.specRole)) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
    }
    return true;
  });

  const selectSpec = (id: string) => {
    // Check if this spec requires a special editor (ORCHESTRATE, SYNTHESISE, CONSTRAIN)
    const selectedSpec = specs.find(s => s.id === id);
    if (selectedSpec && requiresSpecialEditor(selectedSpec.specRole)) {
      // Redirect to special editor
      const editorRoute = getSpecEditorRoute(selectedSpec.id, selectedSpec.specRole);
      router.push(editorRoute);
      return;
    }

    // Normal spec detail view
    router.push(`/x/specs?id=${id}`, { scroll: false });
  };

  // Detail handlers
  const handleConfigChange = useCallback((value: string) => {
    setConfigText(value);
    setHasChanges(true);
    try {
      JSON.parse(value);
      setConfigError(null);
    } catch (e: any) {
      setConfigError(e.message);
    }
  }, []);

  const handlePromptTemplateChange = useCallback((value: string) => {
    setPromptTemplate(value);
    setHasChanges(true);
  }, []);

  const handleSpecRoleChange = useCallback((value: string) => {
    setSpecRole(value);
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    if (!spec || configError) {
      setSaveMessage({ type: "error", text: "Fix JSON errors before saving" });
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const parsedConfig = JSON.parse(configText);
      const res = await fetch(`/api/analysis-specs/${spec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: parsedConfig,
          promptTemplate: promptTemplate || null,
          specRole: specRole || null,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setSpec(data.spec);
        setHasChanges(false);
        // Show source warnings if any
        if (data.sourceWarnings?.length) {
          const warnText = data.sourceWarnings.map((w: any) => w.message).join("; ");
          setSaveMessage({ type: "success", text: `Saved. Source warnings: ${warnText}` });
        } else {
          setSaveMessage({ type: "success", text: "Saved successfully" });
        }
        setTimeout(() => setSaveMessage(null), 5000);
      } else {
        // Show source validation errors specifically
        if (data.sourceErrors?.length) {
          const errText = data.sourceErrors.map((e: any) => e.message).join("; ");
          setSaveMessage({ type: "error", text: errText });
        } else {
          setSaveMessage({ type: "error", text: data.error || "Failed to save" });
        }
      }
    } catch (e: any) {
      setSaveMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleRecompile = async () => {
    if (!spec) return;
    setRecompiling(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/analysis-specs/${spec.id}/recompile`, {
        method: "POST",
      });

      const data = await res.json();
      if (data.ok) {
        setSpec(data.spec);
        setConfigText(JSON.stringify(data.spec.config || {}, null, 2));
        setPromptTemplate(data.spec.promptTemplate || "");
        setHasChanges(false);
        setSaveMessage({ type: "success", text: "Recompiled successfully from source spec" });
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveMessage({ type: "error", text: data.error || "Failed to recompile" });
      }
    } catch (e: any) {
      setSaveMessage({ type: "error", text: e.message });
    } finally {
      setRecompiling(false);
    }
  };

  const handleExportToSource = async () => {
    if (!spec) return;

    if (hasChanges) {
      const saveFirst = window.confirm(
        "You have unsaved changes. Save them first before exporting?\n\nClick OK to save & export, or Cancel to abort."
      );
      if (!saveFirst) return;
      await handleSave();
    }

    const confirmed = window.confirm(
      "This will:\n1. Write config parameters back to the .spec.json file on disk\n2. Re-seed the full pipeline (BDDFeatureSet → Parameters → Anchors → Triggers → Prompt Template)\n\nThe source file will be overwritten. Reversible via git only. Continue?"
    );
    if (!confirmed) return;

    setExporting(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/analysis-specs/${spec.id}/export-to-source`, {
        method: "POST",
      });

      const data = await res.json();
      if (data.ok) {
        const r = data.seedResult;
        const details = r
          ? ` (${r.parametersCreated + r.parametersUpdated} params, ${r.anchorsCreated} anchors, ${r.triggersCreated} triggers)`
          : "";
        setSaveMessage({ type: "success", text: `Exported to ${data.filePath} & re-seeded${details}` });
        // Reload spec data
        const refreshRes = await fetch(`/api/analysis-specs/${spec.id}`);
        const refreshData = await refreshRes.json();
        if (refreshData.ok) {
          setSpec(refreshData.spec);
          setFeatureSet(refreshData.featureSet);
          setConfigText(JSON.stringify(refreshData.spec.config || {}, null, 2));
          setPromptTemplate(refreshData.spec.promptTemplate || "");
          setHasChanges(false);
        }
        setTimeout(() => setSaveMessage(null), 5000);
      } else {
        setSaveMessage({ type: "error", text: data.error || "Failed to export" });
      }
    } catch (e: any) {
      setSaveMessage({ type: "error", text: e.message });
    } finally {
      setExporting(false);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(configText);
      setConfigText(JSON.stringify(parsed, null, 2));
      setConfigError(null);
    } catch (e: any) {
      setConfigError(e.message);
    }
  };

  const FilterPill = ({
    label,
    isActive,
    colors,
    onClick,
    icon,
    tooltip,
  }: {
    label: string;
    isActive: boolean;
    colors: { bg: string; text: string };
    onClick: () => void;
    icon?: string;
    tooltip?: string;
  }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className="hf-filter-pill"
      style={isActive ? {
        border: `1px solid color-mix(in srgb, ${colors.text} 25%, transparent)`,
        background: colors.bg,
        color: colors.text,
      } : undefined}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );

  const ClearBtn = ({ onClick, show }: { onClick: () => void; show: boolean }) => (
    show ? (
      <button
        onClick={onClick}
        className="hf-btn-unstyled hf-btn-clear"
        title="Clear filter"
      >
        ×
      </button>
    ) : null
  );

  const isMeasureSpec = spec?.outputType === "MEASURE";
  const isIdentityOrContent = spec?.specRole === "IDENTITY" || spec?.specRole === "CONTENT";
  const hasRichConfig = spec?.config && Object.keys(spec.config).length > 2;
  const hasPromptTemplate = spec?.promptTemplate && spec.promptTemplate.length > 100;

  return (
    <div className="hf-page-full">
      <AdvancedBanner />
      {/* Header */}
      <div
        className="hf-card-compact hf-header-card"
      >
        <div className="hf-flex-between hf-mb-sm">
          <h1 className="hf-section-title">Analysis Specs</h1>
          <div className="hf-flex hf-gap-sm">
            <Link
              href="/x/specs/new"
              className="hf-btn hf-btn-primary hf-btn-sm"
            >
              + New Spec
            </Link>
            {unimportedCount > 0 && (
              <Link
                href="/x/admin/spec-sync"
                className="hf-badge-warning hf-flex hf-gap-xs hf-sync-badge"
                title={`${unimportedCount} spec${unimportedCount === 1 ? "" : "s"} found in spec files but not imported to database`}
              >
                <span className="hf-sync-count">
                  {unimportedCount}
                </span>
                Sync
              </Link>
            )}
            <Link
              href="/x/spec-schema"
              className="hf-btn hf-btn-secondary hf-btn-sm"
            >
              Schema
            </Link>
            {selectedId && (
              <button
                onClick={() => {
                  if (spec) {
                    assistant.openWithSpec(spec);
                  }
                }}
                className="hf-btn hf-btn-ai"
                title="Ask AI about this spec"
              >
                🤖 Ask AI
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="hf-flex-wrap sp-filters">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hf-search-input"
          />

          <div className="hf-divider-v sp-divider-center" />

          {/* Scope */}
          <div className="hf-flex hf-gap-xs">
            <span className="hf-text-xs hf-text-muted hf-text-bold" title="Filter by specification scope">Scope</span>
            <ClearBtn onClick={() => setSelectedScopes(new Set())} show={selectedScopes.size > 0} />
            <div className="hf-flex hf-gap-xs">
              {SCOPES.map((scope) => {
                const config = scopeColors[scope];
                return (
                  <FilterPill
                    key={scope}
                    label={scope}
                    icon={config.icon}
                    tooltip={config.desc}
                    isActive={selectedScopes.has(scope)}
                    colors={config}
                    onClick={() => toggleScope(scope)}
                  />
                );
              })}
            </div>
          </div>

          <div className="hf-divider-v" />

          {/* Type */}
          <div className="hf-flex hf-gap-xs">
            <span className="hf-text-xs hf-text-muted hf-text-bold" title="Filter by output type">Type</span>
            <ClearBtn onClick={() => setSelectedTypes(new Set())} show={selectedTypes.size > 0} />
            <div className="hf-flex hf-gap-xs">
              {TYPES.map((type) => {
                const config = outputTypeColors[type];
                return (
                  <FilterPill
                    key={type}
                    label={type}
                    icon={config.icon}
                    tooltip={config.desc}
                    isActive={selectedTypes.has(type)}
                    colors={config}
                    onClick={() => toggleType(type)}
                  />
                );
              })}
            </div>
          </div>

          <div className="hf-divider-v" />

          {/* Role */}
          <div className="hf-flex hf-gap-xs">
            <span className="hf-text-xs hf-text-muted hf-text-bold" title="Filter by spec role">Role</span>
            <ClearBtn onClick={() => setSelectedRoles(new Set())} show={selectedRoles.size > 0} />
            <div className="hf-flex hf-flex-wrap hf-gap-xs">
              {ROLES.map((role) => {
                const config = roleColors[role as keyof typeof roleColors];
                const count = specs.filter(s => s.specRole === role).length;
                if (count === 0) return null;
                return (
                  <FilterPill
                    key={role}
                    label={String(count)}
                    icon={config.icon}
                    tooltip={`${config.label}: ${config.desc}`}
                    isActive={selectedRoles.has(role)}
                    colors={{ bg: config.bg, text: config.text }}
                    onClick={() => toggleRole(role)}
                  />
                );
              })}
            </div>
          </div>

          {/* Results count */}
          <span className="hf-text-xs hf-placeholder sp-results-count">
            {filteredSpecs.length} of {specs.length}
          </span>
        </div>
      </div>

      {error && (
        <div className="hf-banner hf-banner-error hf-mb-lg">
          {error}
        </div>
      )}

      {freshness && (
        <div
          className={`hf-banner hf-banner-compact ${freshness.expired > 0 ? "hf-banner-error" : "hf-banner-warning"}`}
        >
          <span className="hf-text-bold">
            {freshness.expired > 0
              ? `${freshness.expired} expired source${freshness.expired > 1 ? "s" : ""}`
              : `${freshness.expiring} source${freshness.expiring > 1 ? "s" : ""} expiring soon`}
          </span>
          {freshness.expired > 0 && freshness.expiring > 0 && (
            <span className="hf-text-warning">
              + {freshness.expiring} expiring soon
            </span>
          )}
          <Link
            href="/x/content-sources"
            className="hf-freshness-link"
          >
            Manage sources
          </Link>
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="hf-master-detail">
        {/* List/Tree Panel */}
        <div className="hf-sidebar-panel">
          {/* View Toggle Header */}
          <div
            className="hf-flex-between hf-view-toggle-header"
          >
            <div className="hf-flex hf-gap-xs">
              <button
                onClick={() => setViewMode("list")}
                className={`hf-toggle-btn hf-toggle-btn-sm hf-view-toggle${viewMode === "list" ? " hf-view-toggle-active" : ""}`}
              >
                ☰ List
              </button>
              <button
                onClick={() => setViewMode("tree")}
                className={`hf-toggle-btn hf-toggle-btn-sm hf-view-toggle${viewMode === "tree" ? " hf-view-toggle-active" : ""}`}
              >
                🌳 Tree
              </button>
            </div>
            {viewMode === "tree" && explorerTree && (
              <div className="hf-flex hf-gap-xs">
                <button
                  onClick={expandAllNodes}
                  className="hf-btn-icon hf-btn-micro"
                  title="Expand All"
                >
                  [+]
                </button>
                <button
                  onClick={collapseAllNodes}
                  className="hf-btn-icon hf-btn-micro"
                  title="Collapse All"
                >
                  [-]
                </button>
              </div>
            )}
            {viewMode === "list" && (
              <span className="hf-text-xs hf-placeholder">
                {filteredSpecs.length} specs
              </span>
            )}
          </div>

          {/* Content Area */}
          <div
            className={`sp-content-area${viewMode === "tree" ? " sp-content-area-tree" : ""}`}
          >
            {viewMode === "list" ? (
              // List View
              <>
                {loading ? (
                  <div className="hf-empty hf-text-muted">Loading...</div>
                ) : filteredSpecs.length === 0 ? (
                  <div className="hf-empty-state sp-empty-state-inset">
                    <div className="hf-empty-state-icon">🎯</div>
                    <div className="hf-empty-state-title">
                      {search || selectedScopes.size > 0 || selectedTypes.size > 0 ? "No specs match filters" : "No specs yet"}
                    </div>
                  </div>
                ) : (
                  <div className="hf-flex-col hf-gap-sm hf-p-sm">
                    {filteredSpecs.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => selectSpec(s.id)}
                        className={`hf-spec-card${selectedId === s.id ? " hf-spec-card-selected" : ""}`}
                      >
                        <div className="hf-flex hf-flex-wrap hf-gap-xs hf-mb-sm">
                          <span
                            className="hf-micro-badge"
                            style={{ background: scopeColors[s.scope]?.bg, color: scopeColors[s.scope]?.text }}
                          >
                            {s.scope}
                          </span>
                          <span
                            className="hf-micro-badge"
                            style={{ background: outputTypeColors[s.outputType]?.bg || "var(--border-default)", color: outputTypeColors[s.outputType]?.text || "var(--text-primary)" }}
                          >
                            {s.outputType}
                          </span>
                          {s.specRole && <SpecRoleBadge role={s.specRole} size="sm" />}
                        </div>
                        <div className="hf-text-sm hf-text-bold sp-spec-name">{s.name}</div>
                        <div className="hf-text-xs hf-text-muted hf-mono">{s.slug}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              // Tree View
              <>
                {explorerLoading ? (
                  <div className="hf-empty hf-text-muted">Loading tree...</div>
                ) : !explorerTree ? (
                  <div className="hf-empty hf-text-muted">Failed to load tree</div>
                ) : (
                  <div
                    ref={treeContainerRef}
                    tabIndex={0}
                    onKeyDown={handleTreeKeyDown}
                    onFocus={() => {
                      if (!selectedTreeNode && explorerTree) {
                        setSelectedTreeNode(explorerTree);
                      }
                    }}
                    className="sp-tree-focus"
                  >
                    <ExplorerTreeNode
                      node={explorerTree}
                      depth={0}
                      expandedNodes={expandedNodes}
                      selectedNode={selectedTreeNode}
                      onToggle={toggleNodeExpand}
                      onSelect={handleTreeNodeSelect}
                      onDoubleClick={handleTreeDoubleClick}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="hf-card-compact hf-detail-panel">
          {!selectedId ? (
            <div className="hf-flex-center hf-placeholder sp-detail-empty">
              <div className="hf-text-center">
                <div className="hf-empty-icon-lg">📋</div>
                <div className="hf-text-md">Select a spec to view details</div>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="hf-empty hf-text-muted">Loading spec...</div>
          ) : detailError || !spec ? (
            <div className="hf-banner hf-banner-error">
              {detailError || "Spec not found"}
            </div>
          ) : (
            <>
              {/* Detail Header */}
              <div className="hf-mb-lg">
                <h2 className="hf-detail-title">{spec.name}</h2>
                <div className="hf-mono hf-text-muted hf-mt-sm">{spec.slug}</div>
              </div>

              {/* Badges */}
              <div className="hf-flex hf-flex-wrap hf-gap-sm hf-mb-lg">
                <span
                  className="hf-badge"
                  style={{ background: scopeColors[spec.scope]?.bg, color: scopeColors[spec.scope]?.text }}
                >
                  {spec.scope}
                </span>
                <span
                  className="hf-badge"
                  style={{ background: outputTypeColors[spec.outputType]?.bg, color: outputTypeColors[spec.outputType]?.text }}
                >
                  {spec.outputType}
                </span>
                {spec.specRole && roleColors[spec.specRole] && (
                  <span
                    className="hf-badge"
                    style={{ background: roleColors[spec.specRole].bg, color: roleColors[spec.specRole].text }}
                  >
                    {roleColors[spec.specRole].icon} {roleColors[spec.specRole].label}
                  </span>
                )}
                {spec.domain && (
                  <DomainPill label={spec.domain} size="compact" />
                )}
                {featureSet && (
                  <span className="hf-badge hf-badge-success">Has Source Spec</span>
                )}
                {spec.isLocked && (
                  <span className="hf-badge hf-badge-error">Locked</span>
                )}
                {spec.isDeletable === false && (
                  <span className="hf-badge hf-badge-warning hf-text-bold">🔒 Cannot Delete</span>
                )}
                {!spec.isActive && (
                  <span className="hf-badge hf-badge-muted">Inactive</span>
                )}
                {/* View in Graph Button */}
                <Link
                  href={`/x/taxonomy-graph?focus=spec/${spec.slug}`}
                  className="hf-badge hf-badge-muted hf-badge-link"
                  title="View this spec in the taxonomy graph visualizer"
                >
                  🌌 Graph
                </Link>
              </div>

              {spec.description && (
                <div className="hf-spec-desc">{spec.description}</div>
              )}

              {/* Data Flow Overview */}
              {featureSet && (
                <div className="hf-data-flow">
                  <div className="hf-data-flow-heading">Data Flow</div>
                  <div className="hf-flex hf-flex-wrap hf-gap-sm hf-text-xs">
                    <span className="hf-badge hf-mono sp-badge-source">
                      {featureSet.featureId}.spec.json
                    </span>
                    <span className="sp-arrow-blue">→</span>
                    <span className="hf-badge sp-badge-feature-set">
                      BDDFeatureSet
                    </span>
                    <span className="sp-arrow-purple">→</span>
                    <span className="hf-badge sp-badge-analysis-spec">
                      AnalysisSpec
                    </span>
                    <span className="hf-placeholder sp-data-flow-count">
                      ({featureSet.parameterCount} params, {featureSet.constraintCount} constraints)
                    </span>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <DraggableTabs
                storageKey={`spec-detail-tabs-${spec.id}`}
                tabs={[
                  { id: "derived", label: "Derived Output", icon: <Zap size={14} /> },
                  ...(featureSet ? [{ id: "source", label: "Source Spec", icon: <FileJson size={14} /> }] : []),
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as "derived" | "source")}
                containerStyle={{ marginBottom: 20 }}
              />

              {activeTab === "derived" && (
                <>
                  {/* Spec Role Selector */}
                  <div className="hf-mb-lg">
                    <label className="hf-label">Spec Role</label>
                    <FancySelect
                      value={specRole}
                      onChange={handleSpecRoleChange}
                      disabled={spec.isLocked}
                      searchable={false}
                      style={{ maxWidth: 300 }}
                      options={[
                        { value: "", label: "None" },
                        // New taxonomy
                        { value: "ORCHESTRATE", label: "🎯 ORCHESTRATE", subtitle: "Flow/sequence control" },
                        { value: "EXTRACT", label: "🔍 EXTRACT", subtitle: "Measurement/learning" },
                        { value: "SYNTHESISE", label: "🧮 SYNTHESISE", subtitle: "Combine/transform data" },
                        { value: "CONSTRAIN", label: "📏 CONSTRAIN", subtitle: "Bounds/guardrails" },
                        { value: "IDENTITY", label: "👤 IDENTITY", subtitle: "Agent personas" },
                        { value: "CONTENT", label: "📚 CONTENT", subtitle: "Curriculum" },
                        { value: "VOICE", label: "🎙️ VOICE", subtitle: "Voice guidance" },
                        // Deprecated (backward compatibility)
                        { value: "MEASURE", label: "📊 MEASURE (deprecated)", subtitle: "Use EXTRACT instead" },
                        { value: "ADAPT", label: "🔄 ADAPT (deprecated)", subtitle: "Use SYNTHESISE instead" },
                        { value: "REWARD", label: "⭐ REWARD (deprecated)", subtitle: "Use SYNTHESISE instead" },
                        { value: "GUARDRAIL", label: "🛡️ GUARDRAIL (deprecated)", subtitle: "Use CONSTRAIN instead" },
                        { value: "BOOTSTRAP", label: "🔄 BOOTSTRAP (deprecated)", subtitle: "Use ORCHESTRATE instead" },
                      ]}
                    />
                  </div>

                  {/* Prompt Template */}
                  {(isMeasureSpec || hasPromptTemplate) && (
                    <div className="hf-mb-lg">
                      <div className="hf-flex-between sp-label-row">
                        <label className="hf-label sp-label-inline">
                          Compiled Prompt Template
                          {isMeasureSpec && (
                            <span className="hf-badge hf-badge-success hf-text-xs sp-badge-inline">
                              Primary output for MEASURE specs
                            </span>
                          )}
                        </label>
                        <span className="hf-text-xs hf-placeholder">
                          {promptTemplate.length.toLocaleString()} chars
                        </span>
                      </div>
                      <textarea
                        value={promptTemplate}
                        onChange={(e) => handlePromptTemplateChange(e.target.value)}
                        disabled={spec.isLocked}
                        rows={isMeasureSpec ? 16 : 8}
                        className={`hf-prompt-textarea${spec.isLocked ? " sp-textarea-locked" : ""}`}
                        placeholder="Compiled prompt template..."
                      />
                    </div>
                  )}

                  {/* Config Editor */}
                  {(!isMeasureSpec || hasRichConfig) && (
                    <div className="hf-mb-lg">
                      <div className="hf-flex-between sp-label-row">
                        <label className="hf-label sp-label-inline">
                          Config
                          {isIdentityOrContent && (
                            <span className="hf-badge hf-badge-info hf-text-xs sp-badge-inline">
                              Primary output for {spec.specRole} specs
                            </span>
                          )}
                        </label>
                      </div>
                      <SpecConfigEditor
                        configText={configText}
                        onConfigChange={handleConfigChange}
                        disabled={spec.isLocked}
                        specRole={spec.specRole ?? undefined}
                        outputType={spec.outputType ?? undefined}
                      />
                    </div>
                  )}

                  {/* Source Authority Panel (CONTENT specs only) */}
                  {isIdentityOrContent && spec.specRole === "CONTENT" && (
                    <SourceAuthorityPanel
                      configText={configText}
                      onConfigChange={(newConfig: string) => { handleConfigChange(newConfig); }}
                      disabled={spec.isLocked}
                    />
                  )}

                  {/* Save / Recompile Buttons */}
                  <div className="hf-flex hf-flex-wrap hf-gap-md">
                    <button
                      onClick={handleSave}
                      disabled={saving || spec.isLocked || !hasChanges}
                      className="hf-btn hf-btn-action sp-btn-save"
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    {featureSet && (
                      <button
                        onClick={handleRecompile}
                        disabled={recompiling || spec.isLocked}
                        className="hf-btn hf-btn-action sp-btn-recompile"
                      >
                        {recompiling ? "Recompiling..." : "Recompile from Source"}
                      </button>
                    )}
                    {spec.compiledSetId && (
                      <button
                        onClick={handleExportToSource}
                        disabled={exporting || spec.isLocked}
                        className="hf-btn hf-btn-action sp-btn-export"
                        title="Writes config parameters back to the .spec.json file on disk, then re-seeds the full pipeline"
                      >
                        {exporting ? "Writing & Re-seeding..." : "Write to Source & Re-seed"}
                      </button>
                    )}
                    {saveMessage && (
                      <span className={`hf-text-xs ${saveMessage.type === "success" ? "hf-text-success" : "hf-text-error"}`}>
                        {saveMessage.text}
                      </span>
                    )}
                    {hasChanges && !saveMessage && (
                      <span className="hf-text-warning hf-text-xs">Unsaved changes</span>
                    )}
                  </div>

                  {/* Triggers Grid */}
                  <div className="hf-section-sep hf-mt-lg">
                    <div className="hf-flex hf-gap-sm hf-mb-md">
                      <button
                        onClick={() => setShowTriggers(!showTriggers)}
                        className="hf-collapse-toggle"
                      >
                        <span>{showTriggers ? "▼" : "▶"}</span>
                        Triggers ({spec.triggers?.length || 0})
                      </button>
                      {showTriggers && !spec.isLocked && (
                        <button
                          onClick={handleAddTrigger}
                          className="hf-btn hf-btn-secondary hf-btn-add-trigger"
                        >
                          + Add Trigger
                        </button>
                      )}
                    </div>

                    {showTriggers && (
                      <>
                        {(!spec.triggers || spec.triggers.length === 0) ? (
                          <div className="hf-empty-dashed hf-text-sm hf-text-muted hf-p-md">
                            No triggers defined yet.{!spec.isLocked && " Click \"+ Add Trigger\" to create one."}
                          </div>
                        ) : (
                          <table className="hf-table">
                            <thead>
                              <tr>
                                <th className="hf-th sp-th-number">#</th>
                                <th className="hf-th sp-th-name">Name</th>
                                <th className="hf-th sp-th-given">Given</th>
                                <th className="hf-th sp-th-when">When</th>
                                <th className="hf-th sp-th-then">Then</th>
                                <th className="hf-th hf-text-center sp-th-actions"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {spec.triggers.map((trigger, tIdx) => {
                                const isHighlighted = trigger.id === highlightTriggerId;
                                return (
                                  <React.Fragment key={trigger.id}>
                                    {/* Trigger row */}
                                    <tr
                                      ref={isHighlighted && !highlightActionId ? setHighlightedRef : undefined}
                                      className={`sp-trigger-row${isHighlighted ? " sp-trigger-row-highlight" : ""}`}
                                    >
                                      <td className="hf-td hf-text-bold hf-text-muted hf-text-xs">{tIdx + 1}</td>
                                      <td className="hf-td">
                                        <InlineCell
                                          cellKey={`trigger-${trigger.id}-name`}
                                          value={trigger.name || ""}
                                          editingCell={editingCell}
                                          editingValue={editingValue}
                                          saving={cellSaving}
                                          disabled={spec.isLocked}
                                          placeholder="Unnamed"
                                          onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                          onChangeEdit={setEditingValue}
                                          onSave={() => { handleInlineSave(trigger.id, "name", editingValue); }}
                                          onCancel={() => setEditingCell(null)}
                                        />
                                      </td>
                                      <td className="hf-td">
                                        <InlineCell
                                          cellKey={`trigger-${trigger.id}-given`}
                                          value={trigger.given || ""}
                                          editingCell={editingCell}
                                          editingValue={editingValue}
                                          saving={cellSaving}
                                          disabled={spec.isLocked}
                                          placeholder="Given..."
                                          onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                          onChangeEdit={setEditingValue}
                                          onSave={() => { handleInlineSave(trigger.id, "given", editingValue); }}
                                          onCancel={() => setEditingCell(null)}
                                        />
                                      </td>
                                      <td className="hf-td">
                                        <InlineCell
                                          cellKey={`trigger-${trigger.id}-when`}
                                          value={trigger.when || ""}
                                          editingCell={editingCell}
                                          editingValue={editingValue}
                                          saving={cellSaving}
                                          disabled={spec.isLocked}
                                          placeholder="When..."
                                          onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                          onChangeEdit={setEditingValue}
                                          onSave={() => { handleInlineSave(trigger.id, "when", editingValue); }}
                                          onCancel={() => setEditingCell(null)}
                                        />
                                      </td>
                                      <td className="hf-td">
                                        <InlineCell
                                          cellKey={`trigger-${trigger.id}-then`}
                                          value={trigger.then || ""}
                                          editingCell={editingCell}
                                          editingValue={editingValue}
                                          saving={cellSaving}
                                          disabled={spec.isLocked}
                                          placeholder="Then..."
                                          onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                          onChangeEdit={setEditingValue}
                                          onSave={() => { handleInlineSave(trigger.id, "then", editingValue); }}
                                          onCancel={() => setEditingCell(null)}
                                        />
                                      </td>
                                      <td className="hf-td hf-text-center">
                                        {!spec.isLocked && (
                                          <button
                                            onClick={() => handleDeleteTrigger(trigger.id)}
                                            title="Delete trigger"
                                            className="hf-btn-remove"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </td>
                                    </tr>

                                    {/* Action sub-rows */}
                                    {trigger.actions.map((action, aIdx) => {
                                      const isActionHighlighted = action.id === highlightActionId;
                                      const badgeLabel = spec.outputType === "LEARN" ? "EXT" : "AC";

                                      return (
                                        <tr
                                          key={action.id}
                                          ref={isActionHighlighted ? setHighlightedRef : undefined}
                                          className={`sp-action-row${isActionHighlighted ? " sp-trigger-row-highlight" : ""}`}
                                        >
                                          <td className="hf-td-sub hf-text-xs"></td>
                                          <td className="hf-td-sub">
                                            <span
                                              className="hf-micro-badge"
                                              style={{
                                                background: spec.outputType === "LEARN" ? "var(--status-warning-bg)" : "var(--status-info-bg)",
                                                color: spec.outputType === "LEARN" ? "var(--status-warning-text)" : "var(--button-primary-bg)",
                                              }}
                                            >
                                              {badgeLabel}{aIdx + 1}
                                            </span>
                                          </td>
                                          {/* Description spans given column */}
                                          <td className="hf-td-sub">
                                            <InlineCell
                                              cellKey={`action-${action.id}-description`}
                                              value={action.description || ""}
                                              editingCell={editingCell}
                                              editingValue={editingValue}
                                              saving={cellSaving}
                                              disabled={spec.isLocked}
                                              placeholder="Description..."
                                              onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                              onChangeEdit={setEditingValue}
                                              onSave={() => { handleInlineActionSave(trigger, action.id, "description", editingValue); }}
                                              onCancel={() => setEditingCell(null)}
                                            />
                                          </td>
                                          {/* Type-specific columns */}
                                          {spec.outputType === "MEASURE" ? (
                                            <>
                                              <td className="hf-td-sub">
                                                <InlineCell
                                                  cellKey={`action-${action.id}-parameterId`}
                                                  value={action.parameterId || ""}
                                                  editingCell={editingCell}
                                                  editingValue={editingValue}
                                                  saving={cellSaving}
                                                  disabled={spec.isLocked}
                                                  placeholder="parameter_id"
                                                  mono
                                                  onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                                  onChangeEdit={setEditingValue}
                                                  onSave={() => { handleInlineActionSave(trigger, action.id, "parameterId", editingValue); }}
                                                  onCancel={() => setEditingCell(null)}
                                                />
                                              </td>
                                              <td className="hf-td-sub">
                                                <InlineCell
                                                  cellKey={`action-${action.id}-weight`}
                                                  value={String(action.weight ?? 1.0)}
                                                  editingCell={editingCell}
                                                  editingValue={editingValue}
                                                  saving={cellSaving}
                                                  disabled={spec.isLocked}
                                                  placeholder="1.0"
                                                  type="number"
                                                  mono
                                                  onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                                  onChangeEdit={setEditingValue}
                                                  onSave={() => { handleInlineActionSave(trigger, action.id, "weight", parseFloat(editingValue) || 1.0); }}
                                                  onCancel={() => setEditingCell(null)}
                                                />
                                              </td>
                                            </>
                                          ) : spec.outputType === "LEARN" ? (
                                            <>
                                              <td className="hf-td-sub">
                                                <InlineCell
                                                  cellKey={`action-${action.id}-learnCategory`}
                                                  value={action.learnCategory || ""}
                                                  editingCell={editingCell}
                                                  editingValue={editingValue}
                                                  saving={cellSaving}
                                                  disabled={spec.isLocked}
                                                  placeholder="Category"
                                                  type="select"
                                                  options={[
                                                    { value: "FACT", label: "FACT" },
                                                    { value: "PREFERENCE", label: "PREFERENCE" },
                                                    { value: "EVENT", label: "EVENT" },
                                                    { value: "TOPIC", label: "TOPIC" },
                                                    { value: "RELATIONSHIP", label: "RELATIONSHIP" },
                                                    { value: "CONTEXT", label: "CONTEXT" },
                                                  ]}
                                                  onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                                  onChangeEdit={setEditingValue}
                                                  onSave={() => { handleInlineActionSave(trigger, action.id, "learnCategory", editingValue); }}
                                                  onCancel={() => setEditingCell(null)}
                                                />
                                              </td>
                                              <td className="hf-td-sub">
                                                <InlineCell
                                                  cellKey={`action-${action.id}-learnKeyPrefix`}
                                                  value={action.learnKeyPrefix || ""}
                                                  editingCell={editingCell}
                                                  editingValue={editingValue}
                                                  saving={cellSaving}
                                                  disabled={spec.isLocked}
                                                  placeholder="key_prefix"
                                                  mono
                                                  onStartEdit={(key, val) => { setEditingCell(key); setEditingValue(val); }}
                                                  onChangeEdit={setEditingValue}
                                                  onSave={() => { handleInlineActionSave(trigger, action.id, "learnKeyPrefix", editingValue); }}
                                                  onCancel={() => setEditingCell(null)}
                                                />
                                              </td>
                                            </>
                                          ) : (
                                            <>
                                              <td className="hf-td-sub"></td>
                                              <td className="hf-td-sub"></td>
                                            </>
                                          )}
                                          <td className="hf-td-sub hf-text-center">
                                            {!spec.isLocked && (
                                              <button
                                                onClick={() => handleRemoveAction(trigger, action.id)}
                                                title="Remove action"
                                                className="hf-btn-remove-sm"
                                              >
                                                ✕
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}

                                    {/* + Action row */}
                                    {!spec.isLocked && (
                                      <tr className="hf-add-action-row">
                                        <td colSpan={6} className="hf-add-action-cell">
                                          <button
                                            onClick={() => handleAddAction(trigger)}
                                            disabled={cellSaving === `trigger-${trigger.id}-actions`}
                                            className="hf-btn-unstyled hf-text-xs hf-text-muted hf-add-action-btn"
                                          >
                                            {cellSaving === `trigger-${trigger.id}-actions` ? "Saving..." : "+ Action"}
                                          </button>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}

              {activeTab === "source" && featureSet && (
                <>
                  {/* Parameters */}
                  <div className="hf-mb-lg">
                    <button
                      onClick={() => setShowParameters(!showParameters)}
                      className="hf-collapse-toggle hf-collapse-toggle-light hf-mb-md"
                    >
                      <span>{showParameters ? "▼" : "▶"}</span>
                      Parameters ({featureSet.parameterCount})
                    </button>
                    {showParameters && featureSet.parameters && featureSet.parameters.length > 0 && (
                      <div className="hf-flex-col hf-gap-md">
                        {featureSet.parameters.map((param: any, idx: number) => (
                          <div key={param.id || idx} className="hf-card-compact hf-card-compact-flush">
                            <div className="hf-flex-between hf-mb-sm sp-param-header">
                              <div>
                                <div className="hf-text-medium">{param.name}</div>
                                <div className="hf-text-xs hf-text-muted hf-mono">{param.id}</div>
                              </div>
                              {param.targetRange && (
                                <span className="hf-badge hf-badge-success hf-text-xs">
                                  Target: {param.targetRange.min}-{param.targetRange.max}
                                </span>
                              )}
                            </div>
                            {param.definition && (
                              <p className="hf-text-sm hf-text-secondary hf-mb-sm sp-param-definition">{param.definition}</p>
                            )}
                            {param.interpretationScale && (
                              <div className="hf-mt-sm">
                                <div className="hf-text-xs hf-text-muted sp-sub-label">Interpretation Scale:</div>
                                <div className="hf-flex hf-gap-sm hf-text-xs">
                                  <span className="hf-badge hf-badge-error">Low: {param.interpretationScale.low}</span>
                                  <span className="hf-badge hf-badge-warning">Mid: {param.interpretationScale.mid}</span>
                                  <span className="hf-badge hf-badge-success">High: {param.interpretationScale.high}</span>
                                </div>
                              </div>
                            )}
                            {param.scoringAnchors && param.scoringAnchors.length > 0 && (
                              <div className="hf-mt-sm">
                                <div className="hf-text-xs hf-text-muted sp-sub-label">Scoring Anchors:</div>
                                <div className="hf-anchor-grid">
                                  {param.scoringAnchors.map((anchor: any, ai: number) => (
                                    <div key={ai} className="hf-anchor-cell">
                                      <div className="hf-text-bold">{anchor.score}</div>
                                      <div className="hf-text-muted hf-truncate" title={anchor.label}>
                                        {anchor.label}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {showParameters && (!featureSet.parameters || featureSet.parameters.length === 0) && (
                      <p className="hf-text-sm hf-placeholder">No parameters defined in source spec</p>
                    )}
                  </div>

                  {/* Prompt Guidance */}
                  <div className="hf-mb-lg">
                    <button
                      onClick={() => setShowPromptGuidance(!showPromptGuidance)}
                      className="hf-collapse-toggle hf-collapse-toggle-light hf-mb-md"
                    >
                      <span>{showPromptGuidance ? "▼" : "▶"}</span>
                      Prompt Guidance ({featureSet.promptGuidance?.length || 0})
                    </button>
                    {showPromptGuidance && featureSet.promptGuidance && featureSet.promptGuidance.length > 0 && (
                      <div className="hf-flex-col hf-gap-md">
                        {featureSet.promptGuidance.map((guidance: any, idx: number) => (
                          <div key={idx} className="hf-card-compact hf-card-compact-flush">
                            <div className="hf-text-medium hf-mb-sm">{guidance.parameterId}</div>
                            <div className="hf-grid-2 hf-text-xs sp-guidance-grid">
                              <div>
                                <div className="hf-text-xs hf-text-success sp-sub-label">When High:</div>
                                <p className="hf-text-secondary sp-flush-p">{guidance.whenHigh}</p>
                              </div>
                              <div>
                                <div className="hf-text-xs hf-text-error sp-sub-label">When Low:</div>
                                <p className="hf-text-secondary sp-flush-p">{guidance.whenLow}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Raw Spec JSON */}
                  <div className="hf-mb-lg">
                    <button
                      onClick={() => setShowRawSpec(!showRawSpec)}
                      className="hf-collapse-toggle hf-collapse-toggle-light hf-mb-md"
                    >
                      <span>{showRawSpec ? "▼" : "▶"}</span>
                      Raw Spec JSON (Source)
                    </button>
                    {showRawSpec && featureSet.rawSpec && (
                      <pre className="hf-code-block-sm">
                        {JSON.stringify(featureSet.rawSpec, null, 2)}
                      </pre>
                    )}
                    {showRawSpec && !featureSet.rawSpec && (
                      <p className="hf-text-sm hf-placeholder">No rawSpec stored</p>
                    )}
                  </div>

                  {/* Feature Set Metadata */}
                  <div className="hf-section-sep">
                    <h3 className="hf-text-sm hf-text-secondary hf-section-heading">BDDFeatureSet Metadata</h3>
                    <div className="hf-meta-grid">
                      <div>
                        <div className="hf-meta-label">Feature ID</div>
                        <div className="hf-meta-value hf-mono">{featureSet.featureId}</div>
                      </div>
                      <div>
                        <div className="hf-meta-label">Version</div>
                        <div className="hf-meta-value">{featureSet.version}</div>
                      </div>
                      <div>
                        <div className="hf-meta-label">Spec Type</div>
                        <div className="hf-meta-value">{featureSet.specType}</div>
                      </div>
                      <div>
                        <div className="hf-meta-label">Updated At</div>
                        <div className="hf-meta-value">{new Date(featureSet.updatedAt).toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="hf-meta-label">Activated At</div>
                        <div className="hf-meta-value">{featureSet.activatedAt ? new Date(featureSet.activatedAt).toLocaleString() : "—"}</div>
                      </div>
                      <div>
                        <div className="hf-meta-label">Status</div>
                        <span className={featureSet.isActive ? "hf-badge hf-badge-success" : "hf-badge hf-badge-muted"}>
                          {featureSet.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* AnalysisSpec Metadata */}
              <div className="hf-section-sep-spaced">
                <h3 className="hf-text-sm hf-text-secondary hf-section-heading">AnalysisSpec Metadata</h3>
                <div className="hf-meta-grid">
                  <div>
                    <div className="hf-meta-label">ID</div>
                    <div className="hf-meta-value hf-mono hf-text-xs">{spec.id}</div>
                  </div>
                  <div>
                    <div className="hf-meta-label">Priority</div>
                    <div className="hf-meta-value">{spec.priority}</div>
                  </div>
                  <div>
                    <div className="hf-meta-label">Version</div>
                    <div className="hf-meta-value">{spec.version || "—"}</div>
                  </div>
                  <div>
                    <div className="hf-meta-label">Compiled At</div>
                    <div className="hf-meta-value">{spec.compiledAt ? new Date(spec.compiledAt).toLocaleString() : "Never"}</div>
                  </div>
                  <div>
                    <div className="hf-meta-label">Created</div>
                    <div className="hf-meta-value">{new Date(spec.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div>
                    <div className="hf-meta-label">Linked FeatureSet</div>
                    <div className="hf-meta-value hf-mono hf-text-xs">
                      {spec.compiledSetId ? spec.compiledSetId.slice(0, 8) + "..." : "None"}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Unified AI Assistant Panel */}
      <UnifiedAssistantPanel
        visible={assistant.isOpen}
        onClose={assistant.close}
        context={assistant.context}
        location={{ page: "/x/specs", entityType: "spec", entityId: selectedId || undefined }}
        endpoint="/api/specs/assistant-view"
        {...assistant.options}
      />

      {triggerModalOpen && spec && (
        <TriggerFormModal
          trigger={editingTrigger}
          outputType={spec.outputType}
          saving={triggerSaving}
          error={triggerError}
          onSave={handleSaveTrigger}
          onClose={() => setTriggerModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Trigger Form Modal ────────────────────────────────────────────
function TriggerFormModal({
  trigger,
  outputType,
  saving,
  error,
  onSave,
  onClose,
}: {
  trigger: Trigger | null;
  outputType: string;
  saving: boolean;
  error: string | null;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(trigger?.name || "");
  const [given, setGiven] = useState(trigger?.given || "");
  const [when, setWhen] = useState(trigger?.when || "");
  const [thenVal, setThenVal] = useState(trigger?.then || "");
  const [notes, setNotes] = useState(trigger?.notes || "");
  const [actions, setActions] = useState<Array<{
    description: string;
    weight: number;
    parameterId: string;
    learnCategory: string;
    learnKeyPrefix: string;
    learnKeyHint: string;
  }>>(
    trigger?.actions?.map((a) => ({
      description: a.description || "",
      weight: a.weight ?? 1.0,
      parameterId: a.parameterId || "",
      learnCategory: a.learnCategory || "",
      learnKeyPrefix: a.learnKeyPrefix || "",
      learnKeyHint: a.learnKeyHint || "",
    })) || []
  );

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleSubmit = () => {
    onSave({
      given,
      when,
      then: thenVal,
      name: name || null,
      notes: notes || null,
      actions: actions.length > 0 ? actions.map((a) => ({
        description: a.description,
        weight: a.weight,
        ...(outputType === "MEASURE" && a.parameterId ? { parameterId: a.parameterId } : {}),
        ...(outputType === "LEARN" && a.learnCategory ? { learnCategory: a.learnCategory } : {}),
        ...(outputType === "LEARN" && a.learnKeyPrefix ? { learnKeyPrefix: a.learnKeyPrefix } : {}),
        ...(outputType === "LEARN" && a.learnKeyHint ? { learnKeyHint: a.learnKeyHint } : {}),
      })) : undefined,
    });
  };

  const addAction = () => {
    setActions([...actions, { description: "", weight: 1.0, parameterId: "", learnCategory: "", learnKeyPrefix: "", learnKeyHint: "" }]);
  };

  const updateAction = (idx: number, field: string, value: any) => {
    setActions(actions.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  const removeAction = (idx: number) => {
    setActions(actions.filter((_, i) => i !== idx));
  };

  const isEdit = !!trigger;
  const canSubmit = given.trim() && when.trim() && thenVal.trim() && !saving;

  // Using CSS classes: hf-trigger-input and hf-trigger-label

  return (
    <div
      className="hf-modal-overlay"
      onClick={onClose}
    >
      <div
        className="hf-modal-trigger"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hf-modal-title">
          {isEdit ? "Edit Trigger" : "Add Trigger"}
        </h3>
        <p className="hf-text-sm hf-text-muted hf-modal-subtitle">
          Define a Given/When/Then scenario that describes when this spec activates.
        </p>

        {error && (
          <div className="hf-banner hf-banner-error hf-text-xs">
            {error}
          </div>
        )}

        {/* Name */}
        <div className="hf-form-group">
          <label className="hf-trigger-label">Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Short name for this trigger"
            className="hf-trigger-input"
          />
        </div>

        {/* Given */}
        <div className="hf-form-group">
          <label className="hf-trigger-label">
            <span className="sp-label-given">Given</span> *
          </label>
          <textarea
            value={given}
            onChange={(e) => setGiven(e.target.value)}
            placeholder="A caller sharing personal information during conversation"
            rows={2}
            className="hf-trigger-input"
          />
        </div>

        {/* When */}
        <div className="hf-form-group">
          <label className="hf-trigger-label">
            <span className="sp-label-when">When</span> *
          </label>
          <textarea
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            placeholder="The system identifies factual statements about the caller"
            rows={2}
            className="hf-trigger-input"
          />
        </div>

        {/* Then */}
        <div className="hf-form-group">
          <label className="hf-trigger-label">
            <span className="sp-label-then">Then</span> *
          </label>
          <textarea
            value={thenVal}
            onChange={(e) => setThenVal(e.target.value)}
            placeholder="Personal facts are extracted with confidence scores"
            rows={2}
            className="hf-trigger-input"
          />
        </div>

        {/* Notes */}
        <div className="hf-mb-md">
          <label className="hf-trigger-label">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Implementation notes..."
            rows={2}
            className="hf-trigger-input"
          />
        </div>

        {/* Actions */}
        <div className="hf-mb-md">
          <div className="hf-flex-between hf-mb-sm">
            <label className="hf-trigger-label sp-actions-label">
              Actions ({actions.length})
            </label>
            <button
              onClick={addAction}
              className="hf-btn-icon sp-btn-add-action"
            >
              + Action
            </button>
          </div>

          {actions.length === 0 && (
            <div className="hf-text-sm hf-text-muted hf-text-center sp-empty-actions">
              No actions yet. Actions define what the trigger measures or extracts.
            </div>
          )}

          {actions.map((action, idx) => (
            <div key={idx} className="hf-action-card">
              <div className="hf-flex-between sp-action-header">
                <span className="hf-text-xs hf-text-bold hf-text-muted">
                  Action {idx + 1}
                </span>
                <button
                  onClick={() => removeAction(idx)}
                  className="hf-btn-unstyled hf-text-xs hf-text-error sp-btn-remove-action"
                >
                  Remove
                </button>
              </div>

              <div className="sp-action-input-wrap">
                <input
                  value={action.description}
                  onChange={(e) => updateAction(idx, "description", e.target.value)}
                  placeholder="What does this action look for?"
                  className="hf-trigger-input"
                />
              </div>

              {outputType === "MEASURE" && (
                <div className="hf-flex hf-gap-sm">
                  <div className="sp-field-flex">
                    <label className="hf-trigger-label hf-trigger-label-xs">Parameter ID</label>
                    <input
                      value={action.parameterId}
                      onChange={(e) => updateAction(idx, "parameterId", e.target.value)}
                      placeholder="e.g. warmth_actual"
                      className="hf-trigger-input"
                    />
                  </div>
                  <div className="sp-field-weight">
                    <label className="hf-trigger-label hf-trigger-label-xs">Weight</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value={action.weight}
                      onChange={(e) => updateAction(idx, "weight", parseFloat(e.target.value) || 1.0)}
                      className="hf-trigger-input hf-mono"
                    />
                  </div>
                </div>
              )}

              {outputType === "LEARN" && (
                <div className="hf-flex-col sp-learn-fields">
                  <div className="hf-flex hf-gap-sm">
                    <div className="sp-field-flex">
                      <label className="hf-trigger-label hf-trigger-label-xs">Category</label>
                      <select
                        value={action.learnCategory}
                        onChange={(e) => updateAction(idx, "learnCategory", e.target.value)}
                        className="hf-trigger-input sp-select-pointer"
                      >
                        <option value="">Select...</option>
                        <option value="FACT">FACT</option>
                        <option value="PREFERENCE">PREFERENCE</option>
                        <option value="EVENT">EVENT</option>
                        <option value="TOPIC">TOPIC</option>
                        <option value="RELATIONSHIP">RELATIONSHIP</option>
                        <option value="CONTEXT">CONTEXT</option>
                      </select>
                    </div>
                    <div className="sp-field-flex">
                      <label className="hf-trigger-label hf-trigger-label-xs">Key Prefix</label>
                      <input
                        value={action.learnKeyPrefix}
                        onChange={(e) => updateAction(idx, "learnKeyPrefix", e.target.value)}
                        placeholder="e.g. location"
                        className="hf-trigger-input"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="hf-trigger-label hf-trigger-label-xs">Key Hint</label>
                    <input
                      value={action.learnKeyHint}
                      onChange={(e) => updateAction(idx, "learnKeyHint", e.target.value)}
                      placeholder="Hint for key generation"
                      className="hf-trigger-input"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="hf-flex sp-modal-footer">
          <button
            onClick={onClose}
            disabled={saving}
            className="hf-btn hf-btn-secondary sp-btn-modal-cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`hf-btn sp-btn-modal-submit${canSubmit ? " sp-btn-modal-submit-active" : " sp-btn-modal-submit-disabled"}`}
          >
            {saving ? "Saving..." : isEdit ? "Update Trigger" : "Add Trigger"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Editable Cell ──────────────────────────────────────────
function InlineCell({
  cellKey,
  value,
  editingCell,
  editingValue,
  saving,
  disabled,
  placeholder,
  color,
  mono,
  onStartEdit,
  onChangeEdit,
  onSave,
  onCancel,
  type = "text",
  options,
}: {
  cellKey: string;
  value: string;
  editingCell: string | null;
  editingValue: string;
  saving: string | null;
  disabled?: boolean;
  placeholder?: string;
  color?: string;
  mono?: boolean;
  onStartEdit: (key: string, value: string) => void;
  onChangeEdit: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  type?: "text" | "select" | "number";
  options?: { value: string; label: string }[];
}) {
  const isEditing = editingCell === cellKey;
  const isSaving = saving === cellKey;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  if (isEditing && !disabled) {
    if (type === "select" && options) {
      return (
        <select
          ref={inputRef as any}
          value={editingValue}
          onChange={(e) => onChangeEdit(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="hf-inline-edit"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }

    if (type === "number") {
      return (
        <input
          ref={inputRef as any}
          type="number"
          step="0.1"
          min="0"
          max="10"
          value={editingValue}
          onChange={(e) => onChangeEdit(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
          className="hf-inline-edit hf-mono"
        />
      );
    }

    return (
      <textarea
        ref={inputRef as any}
        value={editingValue}
        onChange={(e) => onChangeEdit(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(); }
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.max(1, Math.ceil((editingValue || "").length / 40))}
        className={`hf-inline-edit hf-inline-edit-textarea${mono ? " hf-mono" : " sp-font-inherit"}`}
      />
    );
  }

  // Display mode
  return (
    <div
      onClick={() => !disabled && onStartEdit(cellKey, value || "")}
      title={disabled ? undefined : "Click to edit"}
      className={`hf-inline-cell${disabled ? " hf-inline-cell-disabled" : ""}${isSaving ? " hf-inline-cell-saving" : ""}${mono ? " hf-mono" : ""}`}
      style={color ? { color: isSaving ? "var(--text-muted)" : color } : undefined}
    >
      {value || <span className="sp-inline-placeholder">{placeholder || "—"}</span>}
    </div>
  );
}
