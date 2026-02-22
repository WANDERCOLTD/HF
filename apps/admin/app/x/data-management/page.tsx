"use client";

import "./data-management.css";
import { useState, useEffect } from "react";
import { AIModelsManager } from "@/components/shared/AIModelsManager";
import { SpecSyncDetailModal } from "@/components/shared/SpecSyncDetailModal";
import { useTerminology } from "@/contexts/TerminologyContext";

type OperationStatus = "idle" | "running" | "success" | "error";

type OperationResult = {
  message?: string;
  details?: any;
  error?: string;
};

type Operation = {
  id: string;
  title: string;
  description: string;
  icon: string;
  warning: string;
  endpoint: string;
  method?: "GET" | "POST";
  requiresMode?: boolean;
};

type PlaybookOption = {
  id: string;
  name: string;
  description: string;
  domain: {
    slug: string;
    name: string;
    description: string;
  };
  status: string;
  specCount: number;
  behaviorTargetCount: number;
  identitySpecs: string[];
  contentSpecs: string[];
  requiredSpecs: string[];
  optionalSpecs: string[];
  systemDomains: string[];
};

const OPERATIONS: Operation[] = [
  {
    id: "sync-parameters",
    title: "Sync Missing Parameters",
    description: "Scans all active specs for parameter references in triggers/actions. Creates Parameter records for any missing parameters that specs reference but don't exist in database.",
    icon: "🔧",
    warning: "This will create Parameter records for any parameters that specs reference but don't exist in the database. Safe to run anytime - only creates missing parameters, never modifies existing ones.",
    endpoint: "/api/admin/sync-parameters",
    method: "POST",
  },
  {
    id: "transcripts",
    title: "Import Transcripts from Raw",
    description: "Scans HF_KB_PATH/sources/transcripts/raw for .json and .txt files. Creates Callers (by phone) and Calls. Updates caller names if better data is found.",
    icon: "📞",
    warning: "Choose whether to REPLACE all existing callers/calls (fresh start) or KEEP existing data (skip duplicates). Run 'Sync All BDD Specs' first for proper domain assignment.",
    endpoint: "/api/x/seed-transcripts",
    method: "POST",
    requiresMode: true,
  },
  {
    id: "cleanup",
    title: "Cleanup Orphaned Callers",
    description: "Deletes callers that have 0 calls. These are typically created during failed imports or testing.",
    icon: "🧹",
    warning: "This will permanently delete all Caller records that have no associated Calls. This is safe and recommended after imports.",
    endpoint: "/api/x/cleanup-callers",
    method: "POST",
  },
];

export default function DataManagementPage() {
  const { terms, plural, lower } = useTerminology();
  const [stats, setStats] = useState<{
    domains: number;
    playbooks: number;
    specs: number;
    callers: number;
    calls: number;
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [operationStatus, setOperationStatus] = useState<Record<string, OperationStatus>>({
    "sync-specs": "idle",
    "create-domains": "idle",
    "sync-parameters": "idle",
    transcripts: "idle",
    cleanup: "idle",
  });

  const [operationResults, setOperationResults] = useState<Record<string, OperationResult>>({});
  const [showModal, setShowModal] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<"replace" | "keep" | null>(null);
  const [showAIModels, setShowAIModels] = useState(false);
  const [showSpecSyncModal, setShowSpecSyncModal] = useState(false);

  // Playbook selection for create-domains
  const [availablePlaybooks, setAvailablePlaybooks] = useState<PlaybookOption[]>([]);
  const [selectedPlaybooks, setSelectedPlaybooks] = useState<Set<string>>(new Set());
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(false);

  // Sync status for specs
  const [syncStatus, setSyncStatus] = useState<{
    totalFiles: number;
    syncedFiles: number;
    unsyncedFiles: number;
  } | null>(null);
  const [loadingSyncStatus, setLoadingSyncStatus] = useState(false);

  // Load current stats
  useEffect(() => {
    loadStats();
    loadAvailablePlaybooks();
    loadSyncStatus();
  }, []);

  async function loadStats() {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/x/data-management/stats");
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (e) {
      console.error("Failed to load stats:", e);
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadAvailablePlaybooks() {
    setLoadingPlaybooks(true);
    try {
      const res = await fetch("/api/x/create-domains");
      const data = await res.json();
      if (data.ok) {
        setAvailablePlaybooks(data.playbooks);
      }
    } catch (e) {
      console.error("Failed to load available playbooks:", e);
    } finally {
      setLoadingPlaybooks(false);
    }
  }

  async function loadSyncStatus() {
    setLoadingSyncStatus(true);
    try {
      const res = await fetch("/api/admin/spec-sync");
      const data = await res.json();
      if (data.ok) {
        setSyncStatus({
          totalFiles: data.totalFiles,
          syncedFiles: data.syncedFiles,
          unsyncedFiles: data.unsyncedFiles,
        });
      }
    } catch (e) {
      console.error("Failed to load sync status:", e);
    } finally {
      setLoadingSyncStatus(false);
    }
  }

  async function executeSyncSpecs() {
    setShowModal(null);
    setOperationStatus((prev) => ({ ...prev, "sync-specs": "running" }));
    setOperationResults((prev) => ({ ...prev, "sync-specs": {} }));

    try {
      const res = await fetch("/api/admin/spec-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (data.ok) {
        setOperationStatus((prev) => ({ ...prev, "sync-specs": "success" }));
        setOperationResults((prev) => ({
          ...prev,
          "sync-specs": { message: data.message, details: data },
        }));
        loadStats();
        loadSyncStatus(); // Refresh sync status after syncing
      } else {
        setOperationStatus((prev) => ({ ...prev, "sync-specs": "error" }));
        setOperationResults((prev) => ({
          ...prev,
          "sync-specs": { error: data.error || "Sync failed" },
        }));
      }
    } catch (e: any) {
      setOperationStatus((prev) => ({ ...prev, "sync-specs": "error" }));
      setOperationResults((prev) => ({
        ...prev,
        "sync-specs": { error: e.message || "Network error" },
      }));
    }
  }

  async function executeCreateDomains() {
    setShowModal(null);
    setOperationStatus((prev) => ({ ...prev, "create-domains": "running" }));
    setOperationResults((prev) => ({ ...prev, "create-domains": {} }));

    try {
      const res = await fetch("/api/x/create-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playbookIds: Array.from(selectedPlaybooks),
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setOperationStatus((prev) => ({ ...prev, "create-domains": "success" }));
        setOperationResults((prev) => ({
          ...prev,
          "create-domains": { message: data.message, details: data },
        }));
        loadStats();
        setSelectedPlaybooks(new Set()); // Clear selection after success
      } else {
        setOperationStatus((prev) => ({ ...prev, "create-domains": "error" }));
        setOperationResults((prev) => ({
          ...prev,
          "create-domains": { error: data.error || "Create failed" },
        }));
      }
    } catch (e: any) {
      setOperationStatus((prev) => ({ ...prev, "create-domains": "error" }));
      setOperationResults((prev) => ({
        ...prev,
        "create-domains": { error: e.message || "Network error" },
      }));
    }
  }

  async function executeOperation(op: Operation, mode?: "replace" | "keep") {
    setShowModal(null);
    setSelectedMode(null);
    setOperationStatus((prev) => ({ ...prev, [op.id]: "running" }));
    setOperationResults((prev) => ({ ...prev, [op.id]: {} }));

    try {
      const body = mode ? JSON.stringify({ mode }) : undefined;
      const res = await fetch(op.endpoint, {
        method: op.method || "POST",
        headers: { "Content-Type": "application/json" },
        ...(body && { body }),
      });

      const data = await res.json();

      if (data.ok) {
        setOperationStatus((prev) => ({ ...prev, [op.id]: "success" }));
        setOperationResults((prev) => ({
          ...prev,
          [op.id]: { message: data.message, details: data },
        }));
        loadStats();
      } else {
        setOperationStatus((prev) => ({ ...prev, [op.id]: "error" }));
        setOperationResults((prev) => ({
          ...prev,
          [op.id]: { error: data.error || "Operation failed" },
        }));
      }
    } catch (e: any) {
      setOperationStatus((prev) => ({ ...prev, [op.id]: "error" }));
      setOperationResults((prev) => ({
        ...prev,
        [op.id]: { error: e.message || "Network error" },
      }));
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="dm-header">
        <h1 className="hf-page-title dm-title-row">
          <span className="dm-title-icon">🌱</span>
          Data Management
        </h1>
        <p className="dm-subtitle">
          Initialize system from source files (specs, domains, {lower("playbook")}s, transcripts)
        </p>
      </div>

      {/* Current Stats Card */}
      <div className="dm-stats-section">
        <div className="dm-stats-header">
          <h2 className="dm-stats-title">Current Database State</h2>
          <p className="dm-stats-desc">Current counts of key entities in your system</p>
        </div>
        {loadingStats ? (
          <div className="dm-stats-loading">Loading...</div>
        ) : stats ? (
          <div className="dm-stats-grid">
            <StatItem label="Institutions" value={stats.domains} icon="🌐" />
            <StatItem label={plural("playbook")} value={stats.playbooks} icon="📚" />
            <StatItem label="Specs" value={stats.specs} icon="📐" />
            <StatItem label="Callers" value={stats.callers} icon="👥" />
            <StatItem label="Calls" value={stats.calls} icon="📞" />
          </div>
        ) : (
          <div className="dm-stats-error">Failed to load stats</div>
        )}
      </div>

      {/* Manage AI Models Section */}
      <div className="dm-collapsible">
        <div
          className="dm-collapsible-header"
          onClick={() => setShowAIModels(!showAIModels)}
        >
          <div className="dm-collapsible-left">
            <span className="dm-collapsible-icon">🤖</span>
            <div>
              <div className="dm-collapsible-title">Manage AI Models</div>
              <div className="dm-collapsible-desc">
                Add, edit, or disable AI models available for pipeline operations
              </div>
            </div>
          </div>
          <span className="dm-collapsible-chevron">
            {showAIModels ? "▼" : "▶"}
          </span>
        </div>

        {showAIModels && (
          <div className="dm-collapsible-body">
            <AIModelsManager showHeader={false} />
          </div>
        )}
      </div>

      {/* Recommended Order Notice */}
      <div className="dm-info-banner">
        <div className="dm-info-banner-title">
          <span className="dm-info-banner-icon">💡</span>
          Recommended Execution Order
        </div>
        <ol className="dm-info-banner-list">
          <li>
            <strong>Sync All BDD Specs</strong> - Import all spec files from /docs-archive/bdd-specs directory (parameters, analysis specs, anchors)
          </li>
          <li>
            <strong>Create Domains & {plural("playbook")}</strong> - Select and create domains with {lower("playbook")}s and behavior targets (requires specs to exist)
          </li>
          <li>
            <strong>Import Transcripts</strong> - Create callers and calls from raw transcripts (requires domains for assignment)
          </li>
        </ol>
      </div>

      {/* Operation Cards */}
      <div className="dm-ops-stack">
        {/* Sync All BDD Specs */}
        <SyncSpecsCard
          status={operationStatus["sync-specs"]}
          result={operationResults["sync-specs"]}
          syncStatus={syncStatus}
          loadingSyncStatus={loadingSyncStatus}
          onExecute={() => setShowModal("sync-specs")}
          onViewDetails={() => setShowSpecSyncModal(true)}
        />

        {/* Create Domains & Playbooks */}
        <CreateDomainsCard
          status={operationStatus["create-domains"]}
          result={operationResults["create-domains"]}
          availablePlaybooks={availablePlaybooks}
          selectedPlaybooks={selectedPlaybooks}
          onTogglePlaybook={(id) => {
            const newSelection = new Set(selectedPlaybooks);
            if (newSelection.has(id)) {
              newSelection.delete(id);
            } else {
              newSelection.add(id);
            }
            setSelectedPlaybooks(newSelection);
          }}
          onExecute={() => {
            if (selectedPlaybooks.size > 0) {
              setShowModal("create-domains");
            }
          }}
          loadingPlaybooks={loadingPlaybooks}
        />

        {/* Other Operations */}
        {OPERATIONS.map((op) => {
          return (
            <OperationCard
              key={op.id}
              operation={op}
              status={operationStatus[op.id]}
              result={operationResults[op.id]}
              onExecute={(mode) => {
                if (op.requiresMode && mode) {
                  setSelectedMode(mode);
                  setShowModal(op.id);
                } else if (!op.requiresMode) {
                  setShowModal(op.id);
                }
              }}
            />
          );
        })}
      </div>

      {/* Confirmation Modals */}
      {showModal === "sync-specs" && (
        <ConfirmationModal
          title="Sync All BDD Specs"
          icon="📦"
          warning="This will read all .spec.json files from /docs-archive/bdd-specs directory and create/update Parameters, AnalysisSpecs, Anchors, and PromptSlugs in the database. Existing specs will be updated with new definitions."
          onConfirm={executeSyncSpecs}
          onCancel={() => setShowModal(null)}
        />
      )}

      {showModal === "create-domains" && (
        <ConfirmationModal
          title={`Create ${selectedPlaybooks.size} ${terms.playbook}(s)`}
          icon="🎯"
          warning={`This will create ${selectedPlaybooks.size} ${terms.domain.toLowerCase()}(s) and ${lower("playbook")}(s) with all required specs, behavior targets, and dependencies. Existing domains with the same slugs will be deleted first. All created ${lower("playbook")}s will be set to PUBLISHED status.`}
          details={
            <div className="dm-modal-details">
              <strong>Selected {lower("playbook")}s:</strong>
              <ul>
                {Array.from(selectedPlaybooks).map((id) => {
                  const pb = availablePlaybooks.find((p) => p.id === id);
                  return pb ? (
                    <li key={id}>
                      {pb.name} → {pb.domain.name}
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          }
          onConfirm={executeCreateDomains}
          onCancel={() => setShowModal(null)}
        />
      )}

      {showModal && OPERATIONS.find((op) => op.id === showModal) && (
        <ConfirmationModal
          title={OPERATIONS.find((op) => op.id === showModal)!.title}
          icon={OPERATIONS.find((op) => op.id === showModal)!.icon}
          warning={
            selectedMode === "replace"
              ? "⚠️ DESTRUCTIVE: This will DELETE all existing Callers and Calls from the database, then import fresh from /transcripts directory. All analysis artifacts, behavior targets, and caller histories will be permanently removed. This cannot be undone."
              : OPERATIONS.find((op) => op.id === showModal)!.warning
          }
          destructive={selectedMode === "replace"}
          onConfirm={() =>
            executeOperation(
              OPERATIONS.find((op) => op.id === showModal)!,
              selectedMode || undefined
            )
          }
          onCancel={() => {
            setShowModal(null);
            setSelectedMode(null);
          }}
        />
      )}

      {/* Spec Sync Detail Modal */}
      {showSpecSyncModal && (
        <SpecSyncDetailModal
          onClose={() => setShowSpecSyncModal(false)}
          onSyncComplete={() => {
            loadStats();
            loadSyncStatus();
          }}
        />
      )}

    </div>
  );
}

function StatItem({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="dm-stat-card">
      <div className="dm-stat-icon">{icon}</div>
      <div className="dm-stat-value">{value}</div>
      <div className="dm-stat-label">{label}</div>
    </div>
  );
}

function SyncSpecsCard({
  status,
  result,
  syncStatus,
  loadingSyncStatus,
  onExecute,
  onViewDetails,
}: {
  status: OperationStatus;
  result?: OperationResult;
  syncStatus: { totalFiles: number; syncedFiles: number; unsyncedFiles: number } | null;
  loadingSyncStatus: boolean;
  onExecute: () => void;
  onViewDetails: () => void;
}) {
  const isRunning = status === "running";
  const isSuccess = status === "success";
  const isError = status === "error";

  const cardClass = `dm-op-card${isSuccess ? " dm-op-card-success" : isError ? " dm-op-card-error" : ""}`;

  return (
    <div className={cardClass}>
      <div className="dm-op-row">
        <div className="dm-op-icon">📦</div>
        <div className="dm-op-body">
          <div className="dm-op-title-row">
            <div className="dm-op-title">Sync All BDD Specs</div>
            {/* Sync Status Pills */}
            {!loadingSyncStatus && syncStatus && (
              <div className="dm-pills">
                <span className="dm-pill dm-pill-success">
                  {syncStatus.syncedFiles} synced
                </span>
                {syncStatus.unsyncedFiles > 0 && (
                  <span className="dm-pill dm-pill-warning">
                    {syncStatus.unsyncedFiles} unsynced
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="dm-op-desc">
            Reads all .spec.json files from /docs-archive/bdd-specs directory and creates/updates Parameters, AnalysisSpecs,
            Anchors, and PromptSlugs. Run this first to establish the spec foundation.
          </div>

          {isRunning && (
            <div className="dm-status-banner dm-status-banner-running">
              ⏳ Syncing specs...
            </div>
          )}

          {isSuccess && result?.message && (
            <div className="dm-status-banner dm-status-banner-success">
              ✅ {result.message}
            </div>
          )}

          {isError && result?.error && (
            <div className="dm-status-banner dm-status-banner-error">
              ❌ {result.error}
            </div>
          )}

          <div className="dm-btn-row">
            <button
              onClick={onExecute}
              disabled={isRunning}
              className="dm-btn dm-btn-primary"
            >
              {isRunning ? "Syncing..." : "Sync All Specs"}
            </button>

            <button
              onClick={onViewDetails}
              disabled={isRunning}
              className="dm-btn dm-btn-secondary"
            >
              View Details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateDomainsCard({
  status,
  result,
  availablePlaybooks,
  selectedPlaybooks,
  onTogglePlaybook,
  onExecute,
  loadingPlaybooks,
}: {
  status: OperationStatus;
  result?: OperationResult;
  availablePlaybooks: PlaybookOption[];
  selectedPlaybooks: Set<string>;
  onTogglePlaybook: (id: string) => void;
  onExecute: () => void;
  loadingPlaybooks: boolean;
}) {
  const { terms, plural, lower } = useTerminology();
  const isRunning = status === "running";
  const isSuccess = status === "success";
  const isError = status === "error";

  const cardClass = `dm-op-card${isSuccess ? " dm-op-card-success" : isError ? " dm-op-card-error" : ""}`;

  return (
    <div className={cardClass}>
      <div className="dm-op-row">
        <div className="dm-op-icon">🎯</div>
        <div className="dm-op-body">
          <div className="dm-op-title-mb">Create Domains & {plural("playbook")}</div>
          <div className="dm-op-desc">
            Select {lower("playbook")}s to create with their domains, behavior targets, and all required specs. Each {lower("playbook")}
            {" "}will be created as PUBLISHED and ready to use.
          </div>

          {isRunning && (
            <div className="dm-status-banner dm-status-banner-running">
              ⏳ Creating domains and {lower("playbook")}s...
            </div>
          )}

          {isSuccess && result?.message && (
            <div className="dm-status-banner dm-status-banner-success">
              ✅ {result.message}
            </div>
          )}

          {isError && result?.error && (
            <div className="dm-status-banner dm-status-banner-error">
              ❌ {result.error}
            </div>
          )}

          {/* Selection */}
          {loadingPlaybooks ? (
            <div className="dm-pb-loading">Loading available {lower("playbook")}s...</div>
          ) : (
            <div className="dm-pb-section">
              <div className="dm-pb-label">Select {lower("playbook")}s to create:</div>
              <div className="dm-pb-grid">
                {availablePlaybooks.map((pb) => (
                  <PlaybookCheckbox
                    key={pb.id}
                    playbook={pb}
                    isSelected={selectedPlaybooks.has(pb.id)}
                    onToggle={() => onTogglePlaybook(pb.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="dm-btn-row-center">
            <button
              onClick={onExecute}
              disabled={isRunning || selectedPlaybooks.size === 0}
              className="dm-btn dm-btn-primary"
            >
              {isRunning
                ? "Creating..."
                : selectedPlaybooks.size === 0
                ? `Select ${plural("playbook")}`
                : `Create ${selectedPlaybooks.size} ${terms.playbook}(s)`}
            </button>
            {selectedPlaybooks.size > 0 && (
              <span className="dm-pb-selected-count">
                {selectedPlaybooks.size} {lower("playbook")}(s) selected
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaybookCheckbox({
  playbook,
  isSelected,
  onToggle,
}: {
  playbook: PlaybookOption;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`dm-pb-checkbox${isSelected ? " dm-pb-checkbox-selected" : ""}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="dm-pb-input"
      />
      <div className="dm-pb-content">
        <div className="dm-pb-name">{playbook.name}</div>
        <div className="dm-pb-desc">{playbook.description}</div>
        <div className="dm-pb-meta">
          <strong>Domain:</strong> {playbook.domain.name} • <strong>Specs:</strong> ~{playbook.specCount} •{" "}
          <strong>Targets:</strong> {playbook.behaviorTargetCount}
        </div>
      </div>
    </label>
  );
}

function OperationCard({
  operation,
  status,
  result,
  onExecute,
}: {
  operation: Operation;
  status: OperationStatus;
  result?: OperationResult;
  onExecute: (mode?: "replace" | "keep") => void;
}) {
  const isRunning = status === "running";
  const isSuccess = status === "success";
  const isError = status === "error";

  const cardClass = `dm-op-card${isSuccess ? " dm-op-card-success" : isError ? " dm-op-card-error" : ""}`;

  return (
    <div className={cardClass}>
      <div className="dm-op-row">
        <div className="dm-op-icon">{operation.icon}</div>
        <div className="dm-op-body">
          <div className="dm-op-title-mb">{operation.title}</div>
          <div className="dm-op-desc">{operation.description}</div>

          {isRunning && (
            <div className="dm-status-banner dm-status-banner-running">
              ⏳ Running operation...
            </div>
          )}

          {isSuccess && result?.message && (
            <div className="dm-status-banner dm-status-banner-success">
              ✅ {result.message}
            </div>
          )}

          {isError && result?.error && (
            <div className="dm-status-banner dm-status-banner-error">
              ❌ {result.error}
            </div>
          )}

          {operation.requiresMode ? (
            <div className="dm-btn-row">
              <button
                onClick={() => onExecute("replace")}
                disabled={isRunning}
                className="dm-btn dm-btn-destructive"
              >
                🗑️ Replace ALL
              </button>
              <button
                onClick={() => onExecute("keep")}
                disabled={isRunning}
                className="dm-btn dm-btn-success"
              >
                📥 Keep ALL (Skip Duplicates)
              </button>
            </div>
          ) : (
            <button
              onClick={() => onExecute()}
              disabled={isRunning}
              className="dm-btn dm-btn-primary"
            >
              {isRunning ? "Running..." : `Run ${operation.title}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmationModal({
  title,
  icon,
  warning,
  details,
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  icon: string;
  warning: string;
  details?: React.ReactNode;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dm-modal-overlay" onClick={onCancel}>
      <div className="dm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal-icon">{icon}</div>
        <div className="dm-modal-title">{title}</div>
        <div className={`dm-modal-warning ${destructive ? "dm-modal-warning-destructive" : "dm-modal-warning-default"}`}>
          {warning}
          {details}
        </div>

        <div className="dm-modal-actions">
          <button onClick={onCancel} className="dm-modal-btn-cancel">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`dm-modal-btn-confirm ${destructive ? "dm-modal-btn-confirm-destructive" : "dm-modal-btn-confirm-default"}`}
          >
            Yes, Proceed
          </button>
        </div>
      </div>
    </div>
  );
}
