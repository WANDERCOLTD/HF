"use client";

/**
 * ContentDetailPanel — RHS list of items for the selected ContentKind.
 *
 * Filter chips (per-Module, per-Source) narrow the list; cascade chips
 * are surfaced inline so the operator can see provenance per row.
 *
 * Skeleton scope (#2204): read-only browse. Edit actions are out of
 * scope (separate PR per umbrella #2185).
 */

import { useMemo, useState } from "react";

import {
  CONTENT_KINDS,
  type ContentKind,
  type CueCardItem,
  type McqItem,
  type ModuleProvenance,
  type ReflectionPromptItem,
  type ScenarioProbeItem,
  type SourceProvenance,
  type TopicPromptItem,
  type TypedContentGroups,
} from "./types";

interface ContentDetailPanelProps {
  selectedKind: ContentKind;
  groups: TypedContentGroups;
  modules: ModuleProvenance[];
  sources: SourceProvenance[];
}

type ModuleFilter = string | null; // moduleId | null = all
type SourceFilter = string | null; // sourceId | null = all

export function ContentDetailPanel({
  selectedKind,
  groups,
  modules,
  sources,
}: ContentDetailPanelProps) {
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(null);

  const meta = CONTENT_KINDS.find((m) => m.kind === selectedKind);

  // Per-kind filter axis — MCQs filter by source, the rest filter by module.
  const filterAxis: "module" | "source" | "none" = useMemo(() => {
    if (selectedKind === "mcqs") return "source";
    if (selectedKind === "cueCards" || selectedKind === "topicPrompts") {
      return "module";
    }
    return "none";
  }, [selectedKind]);

  // Derived filtered lists per kind.
  const filteredMcqs = useMemo<McqItem[]>(() => {
    if (selectedKind !== "mcqs") return [];
    return groups.mcqs.filter(
      (m) => sourceFilter == null || m.source.sourceId === sourceFilter,
    );
  }, [selectedKind, groups.mcqs, sourceFilter]);

  const filteredCueCards = useMemo<CueCardItem[]>(() => {
    if (selectedKind !== "cueCards") return [];
    return groups.cueCards.filter(
      (c) => moduleFilter == null || c.module.moduleId === moduleFilter,
    );
  }, [selectedKind, groups.cueCards, moduleFilter]);

  const filteredTopicPrompts = useMemo<TopicPromptItem[]>(() => {
    if (selectedKind !== "topicPrompts") return [];
    return groups.topicPrompts.filter(
      (t) => moduleFilter == null || t.module.moduleId === moduleFilter,
    );
  }, [selectedKind, groups.topicPrompts, moduleFilter]);

  const filteredScenarioProbes = useMemo<ScenarioProbeItem[]>(
    () => (selectedKind === "scenarioProbes" ? groups.scenarioProbes : []),
    [selectedKind, groups.scenarioProbes],
  );

  const filteredReflectionPrompts = useMemo<ReflectionPromptItem[]>(
    () =>
      selectedKind === "reflectionPrompts" ? groups.reflectionPrompts : [],
    [selectedKind, groups.reflectionPrompts],
  );

  const isEmpty = (() => {
    switch (selectedKind) {
      case "mcqs":
        return filteredMcqs.length === 0;
      case "cueCards":
        return filteredCueCards.length === 0;
      case "topicPrompts":
        return filteredTopicPrompts.length === 0;
      case "scenarioProbes":
        return filteredScenarioProbes.length === 0;
      case "reflectionPrompts":
        return filteredReflectionPrompts.length === 0;
    }
  })();

  const totalForKind = (() => {
    switch (selectedKind) {
      case "mcqs":
        return groups.mcqs.length;
      case "cueCards":
        return groups.cueCards.length;
      case "topicPrompts":
        return groups.topicPrompts.length;
      case "scenarioProbes":
        return groups.scenarioProbes.length;
      case "reflectionPrompts":
        return groups.reflectionPrompts.length;
    }
  })();

  return (
    <div
      className="hf-content-detail"
      data-testid={`hf-content-detail-${selectedKind}`}
    >
      <header className="hf-content-detail-header">
        <h2 className="hf-section-title">{meta?.label ?? selectedKind}</h2>
        <p className="hf-section-desc">{meta?.description ?? ""}</p>
      </header>

      {filterAxis === "module" && modules.length > 0 ? (
        <div
          className="hf-content-filter-chips"
          role="group"
          aria-label="Filter by module"
          data-testid="hf-content-filter-module"
        >
          <FilterChip
            label="All modules"
            isActive={moduleFilter == null}
            onClick={() => setModuleFilter(null)}
            testId="hf-content-chip-module-all"
          />
          {modules.map((m) => (
            <FilterChip
              key={m.moduleId}
              label={m.moduleLabel}
              isActive={moduleFilter === m.moduleId}
              onClick={() => setModuleFilter(m.moduleId)}
              testId={`hf-content-chip-module-${m.moduleId}`}
            />
          ))}
        </div>
      ) : null}

      {filterAxis === "source" && sources.length > 0 ? (
        <div
          className="hf-content-filter-chips"
          role="group"
          aria-label="Filter by source"
          data-testid="hf-content-filter-source"
        >
          <FilterChip
            label="All sources"
            isActive={sourceFilter == null}
            onClick={() => setSourceFilter(null)}
            testId="hf-content-chip-source-all"
          />
          {sources.map((s) => (
            <FilterChip
              key={s.sourceId}
              label={s.sourceName}
              isActive={sourceFilter === s.sourceId}
              onClick={() => setSourceFilter(s.sourceId)}
              testId={`hf-content-chip-source-${s.sourceId}`}
            />
          ))}
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          kind={selectedKind}
          totalForKind={totalForKind}
          moduleFilter={moduleFilter}
          sourceFilter={sourceFilter}
          modules={modules}
          sources={sources}
        />
      ) : (
        <ul
          className="hf-content-item-list"
          data-testid="hf-content-item-list"
        >
          {selectedKind === "mcqs" &&
            filteredMcqs.map((m) => (
              <McqRow key={m.id} item={m} />
            ))}
          {selectedKind === "cueCards" &&
            filteredCueCards.map((c) => (
              <CueCardRow key={c.id} item={c} />
            ))}
          {selectedKind === "topicPrompts" &&
            filteredTopicPrompts.map((t) => (
              <TopicPromptRow key={t.id} item={t} />
            ))}
          {selectedKind === "scenarioProbes" &&
            filteredScenarioProbes.map((s) => (
              <ScenarioProbeRow key={s.id} item={s} />
            ))}
          {selectedKind === "reflectionPrompts" &&
            filteredReflectionPrompts.map((r) => (
              <ReflectionPromptRow key={r.id} item={r} />
            ))}
        </ul>
      )}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  testId: string;
}

function FilterChip({ label, isActive, onClick, testId }: FilterChipProps) {
  return (
    <button
      type="button"
      className={`hf-content-chip ${isActive ? "hf-content-chip-active" : ""}`}
      onClick={onClick}
      data-testid={testId}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
}

interface EmptyStateProps {
  kind: ContentKind;
  totalForKind: number;
  moduleFilter: ModuleFilter;
  sourceFilter: SourceFilter;
  modules: ModuleProvenance[];
  sources: SourceProvenance[];
}

function EmptyState({
  kind,
  totalForKind,
  moduleFilter,
  sourceFilter,
  modules,
  sources,
}: EmptyStateProps) {
  const meta = CONTENT_KINDS.find((m) => m.kind === kind);
  // Distinguish "no data at all" from "filter hides everything".
  const filterIsActive = moduleFilter != null || sourceFilter != null;
  if (totalForKind === 0) {
    return (
      <div className="hf-empty" data-testid="hf-content-empty-no-data">
        <h3 className="hf-section-title">No {meta?.label ?? "items"} yet</h3>
        <p className="hf-section-desc">
          No {meta?.label.toLowerCase() ?? "items"} have been authored for this
          course. Author them via the course setup wizard, course-reference
          upload, or the source authoring tools.
        </p>
      </div>
    );
  }
  const filterLabel =
    moduleFilter != null
      ? modules.find((m) => m.moduleId === moduleFilter)?.moduleLabel
      : sources.find((s) => s.sourceId === sourceFilter)?.sourceName;
  return (
    <div className="hf-empty" data-testid="hf-content-empty-filtered">
      <h3 className="hf-section-title">Nothing in this filter</h3>
      <p className="hf-section-desc">
        {filterIsActive
          ? `No ${meta?.label.toLowerCase() ?? "items"} match the filter "${filterLabel ?? "selected"}". Clear the filter to see all ${totalForKind} item${totalForKind === 1 ? "" : "s"}.`
          : `No ${meta?.label.toLowerCase() ?? "items"} match.`}
      </p>
    </div>
  );
}

function McqRow({ item }: { item: McqItem }) {
  return (
    <li className="hf-card hf-card-compact hf-content-row" data-testid={`hf-content-mcq-${item.id}`}>
      <div className="hf-content-row-main">
        <p className="hf-content-row-title">{item.questionText}</p>
        <div className="hf-content-row-meta">
          <ProvenanceChip
            label="Source"
            value={item.source.sourceName}
            testId="hf-content-prov-source"
          />
          {item.learningOutcomeRef ? (
            <ProvenanceChip
              label="LO"
              value={item.learningOutcomeRef}
              testId="hf-content-prov-lo"
            />
          ) : null}
          {item.difficulty != null ? (
            <ProvenanceChip
              label="Difficulty"
              value={`L${item.difficulty}`}
              testId="hf-content-prov-difficulty"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function CueCardRow({ item }: { item: CueCardItem }) {
  return (
    <li
      className="hf-card hf-card-compact hf-content-row"
      data-testid={`hf-content-cue-${item.id}`}
    >
      <div className="hf-content-row-main">
        <p className="hf-content-row-title">{item.topic}</p>
        {item.bullets.length > 0 ? (
          <ul className="hf-content-bullets">
            {item.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        <div className="hf-content-row-meta">
          <ProvenanceChip
            label="Module"
            value={item.module.moduleLabel}
            testId="hf-content-prov-module"
          />
        </div>
      </div>
    </li>
  );
}

function TopicPromptRow({ item }: { item: TopicPromptItem }) {
  return (
    <li
      className="hf-card hf-card-compact hf-content-row"
      data-testid={`hf-content-topic-${item.id}`}
    >
      <div className="hf-content-row-main">
        <p className="hf-content-row-title">{item.topic}</p>
        {item.questions.length > 0 ? (
          <ul className="hf-content-bullets">
            {item.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        ) : null}
        <div className="hf-content-row-meta">
          <ProvenanceChip
            label="Module"
            value={item.module.moduleLabel}
            testId="hf-content-prov-module"
          />
        </div>
      </div>
    </li>
  );
}

function ScenarioProbeRow({ item }: { item: ScenarioProbeItem }) {
  return (
    <li
      className="hf-card hf-card-compact hf-content-row"
      data-testid={`hf-content-scenario-${item.id}`}
    >
      <div className="hf-content-row-main">
        <p className="hf-content-row-title">{item.prompt}</p>
        {item.module ? (
          <div className="hf-content-row-meta">
            <ProvenanceChip
              label="Module"
              value={item.module.moduleLabel}
              testId="hf-content-prov-module"
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ReflectionPromptRow({ item }: { item: ReflectionPromptItem }) {
  return (
    <li
      className="hf-card hf-card-compact hf-content-row"
      data-testid={`hf-content-reflection-${item.id}`}
    >
      <div className="hf-content-row-main">
        <p className="hf-content-row-title">{item.prompt}</p>
        {item.module ? (
          <div className="hf-content-row-meta">
            <ProvenanceChip
              label="Module"
              value={item.module.moduleLabel}
              testId="hf-content-prov-module"
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface ProvenanceChipProps {
  label: string;
  value: string;
  testId: string;
}

/**
 * Inline provenance chip — surfaces the cascade source ("from Module",
 * "from Source") on each row. Static styling today; future iterations
 * can route through `<LayerBadge>` once the content kinds enter the
 * cascade family registry.
 */
function ProvenanceChip({ label, value, testId }: ProvenanceChipProps) {
  return (
    <span className="hf-content-prov-chip" data-testid={testId}>
      <span className="hf-content-prov-label">{label}</span>
      <span className="hf-content-prov-value">{value}</span>
    </span>
  );
}
