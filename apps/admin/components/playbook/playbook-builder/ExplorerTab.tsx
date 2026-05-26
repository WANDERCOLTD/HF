"use client";

import React from "react";
import { useTerminology } from "@/contexts/TerminologyContext";
import Link from "next/link";
import { TreeNode, nodeIcons, nodeColors } from "@/components/shared/ExplorerTree";
import { SpecRoleBadge } from "@/components/shared/SpecRoleBadge";
import { Spec, PlaybookItem, AvailableItems } from "./types";
import "./explorer-tab.css";

// ============================================================
// Props
// ============================================================

export type ExplorerTabProps = {
  explorerLoading: boolean;
  explorerTree: TreeNode | null;
  expandedNodes: Set<string>;
  selectedNode: TreeNode | null;
  setSelectedNode: (node: TreeNode) => void;
  expandAllNodes: () => void;
  collapseAllNodes: () => void;
  handleTreeKeyDown: (e: React.KeyboardEvent) => void;
  toggleNodeExpand: (id: string) => void;
  systemSpecsHaveChanges: boolean;
  handleSaveSystemSpecs: () => void;
  savingSystemSpecs: boolean;
  availableItems: AvailableItems | null;
  systemSpecToggles: Map<string, boolean>;
  hasConfigOverride: (specId: string) => boolean;
  handleOpenConfigModal: (spec: Spec) => void;
  handleToggleSystemSpec: (specId: string) => void;
  routePrefix: string;
  items: PlaybookItem[];
  outputTypeBadge: (outputType: string) => React.ReactNode;
};

// ============================================================
// ExplorerTabContent
// ============================================================

export function ExplorerTabContent({
  explorerLoading,
  explorerTree,
  expandedNodes,
  selectedNode,
  setSelectedNode,
  expandAllNodes,
  collapseAllNodes,
  handleTreeKeyDown,
  toggleNodeExpand,
  systemSpecsHaveChanges,
  handleSaveSystemSpecs,
  savingSystemSpecs,
  availableItems,
  systemSpecToggles,
  hasConfigOverride,
  handleOpenConfigModal,
  handleToggleSystemSpec,
  routePrefix,
  items,
  outputTypeBadge,
}: ExplorerTabProps) {
  const { terms } = useTerminology();
  return (
        <div className="exp-root">
          {explorerLoading ? (
            <div className="exp-loading">
              Loading playbook tree...
            </div>
          ) : !explorerTree ? (
            <div className="exp-loading">
              Failed to load playbook structure
            </div>
          ) : (
            <div className="exp-grid">
              {/* Left Panel: File Explorer Tree */}
              <div className="exp-tree-panel">
                {/* Tree Header */}
                <div className="exp-tree-header">
                  <span className="exp-tree-header-title">{terms.playbook} Structure</span>
                  <div className="exp-tree-header-actions">
                    <button
                      onClick={expandAllNodes}
                      className="exp-tree-btn-expand"
                      title="Expand all nodes in the tree"
                    >
                      + Expand All
                    </button>
                    <button
                      onClick={collapseAllNodes}
                      className="exp-tree-btn-collapse"
                      title="Collapse all nodes in the tree"
                    >
                      − Collapse All
                    </button>
                  </div>
                </div>
                {/* Tree Content */}
                <div
                  tabIndex={0}
                  onKeyDown={handleTreeKeyDown}
                  className="exp-tree-content"
                  onFocus={(e) => {
                    // Auto-select root if nothing selected
                    if (!selectedNode && explorerTree) {
                      setSelectedNode(explorerTree);
                    }
                  }}
                >
                  <ExplorerTreeNode
                    node={explorerTree}
                    depth={0}
                    expandedNodes={expandedNodes}
                    selectedNode={selectedNode}
                    onToggle={toggleNodeExpand}
                    onSelect={setSelectedNode}
                  />
                </div>
              </div>

              {/* Right Panel: Detail View or Group Specs Panel */}
              <div className="exp-detail-panel">
                {selectedNode ? (
                  // Check if this is a group node - show spec cards with toggles
                  (selectedNode.type === "group" || selectedNode.type === "output-group") && selectedNode.children && selectedNode.children.length > 0 ? (
                    <div className="exp-group-wrapper">
                      {/* Group Header */}
                      <div className="exp-group-header">
                        <div>
                          <h3 className="exp-group-title">
                            {selectedNode.name}
                          </h3>
                          <p className="exp-group-subtitle">
                            {selectedNode.meta?.count || selectedNode.children.length} specs
                            {selectedNode.meta?.enabledCount !== undefined &&
                              ` • ${selectedNode.meta.enabledCount} enabled`}
                          </p>
                        </div>
                        {systemSpecsHaveChanges && (
                          <button
                            onClick={handleSaveSystemSpecs}
                            disabled={savingSystemSpecs}
                            className="exp-save-btn"
                          >
                            {savingSystemSpecs ? "Saving..." : "Save Changes"}
                          </button>
                        )}
                      </div>

                      {/* Spec Cards with Toggles */}
                      <div className="exp-group-body">
                        {(() => {
                          // Collect all spec nodes from children (handle nested output-groups)
                          const collectSpecs = (nodes: TreeNode[]): TreeNode[] => {
                            const specs: TreeNode[] = [];
                            for (const node of nodes) {
                              if (node.type === "spec") {
                                specs.push(node);
                              } else if (node.children) {
                                specs.push(...collectSpecs(node.children));
                              }
                            }
                            return specs;
                          };

                          const specNodes = collectSpecs(selectedNode.children || []);

                          // If this has output-groups, group by those
                          const hasSubGroups = selectedNode.children?.some(c => c.type === "output-group");

                          if (hasSubGroups) {
                            // Render grouped by output-group
                            return selectedNode.children?.map((subGroup) => {
                              if (subGroup.type !== "output-group") return null;
                              const subSpecs = collectSpecs(subGroup.children || []);
                              if (subSpecs.length === 0) return null;

                              return (
                                <div key={subGroup.id} className="exp-subgroup">
                                  <div className="exp-subgroup-label">
                                    {subGroup.name}
                                  </div>
                                  <div className="exp-spec-list">
                                    {subSpecs.filter((sn) => systemSpecToggles.get(sn.id) ?? true).map((specNode) => {
                                      const spec = (availableItems?.systemSpecs || []).find(s => s.id === specNode.id);
                                      const isEnabled = systemSpecToggles.get(specNode.id) ?? true;
                                      const isGloballyActive = specNode.meta?.isActive !== false;
                                      const effectiveEnabled = isGloballyActive && isEnabled;
                                      const specHasOverride = hasConfigOverride(specNode.id);
                                      const specHasConfig = spec?.config && Object.keys(spec.config).length > 0;

                                      return (
                                        <div
                                          key={specNode.id}
                                          className="exp-spec-card"
                                          style={{
                                            background: !isGloballyActive
                                              ? "var(--status-error-bg)"
                                              : specHasOverride
                                                ? "var(--status-warning-bg)"
                                                : effectiveEnabled
                                                  ? "var(--surface-primary)"
                                                  : "var(--background)",
                                            border: !isGloballyActive
                                              ? "1px solid var(--status-error-border)"
                                              : specHasOverride
                                                ? "1px solid var(--status-warning-border)"
                                                : effectiveEnabled
                                                  ? "1px solid var(--status-success-border)"
                                                  : "1px solid var(--border-default)",
                                            opacity: effectiveEnabled ? 1 : 0.6,
                                          }}
                                        >
                                          <div className="exp-spec-row">
                                            <div className="exp-spec-info">
                                              <div className="exp-spec-badges">
                                                <SpecRoleBadge role={specNode.meta?.specRole || spec?.specRole} size="sm" showIcon={false} />
                                                {outputTypeBadge(specNode.meta?.outputType || spec?.outputType || "")}
                                                {!isGloballyActive && (
                                                  <span className="exp-inactive-badge">
                                                    Inactive
                                                  </span>
                                                )}
                                              </div>
                                              <Link
                                                href={`${routePrefix}/specs/${specNode.id}`}
                                                className="exp-spec-link"
                                                style={{
                                                  color: effectiveEnabled ? "var(--text-primary)" : "var(--text-muted)",
                                                }}
                                              >
                                                {specNode.name.replace(/^🚫\s*/, "")}
                                              </Link>
                                              {specNode.description && (
                                                <div
                                                  className="exp-spec-desc-clamp"
                                                  style={{
                                                    color: effectiveEnabled ? "var(--text-muted)" : "var(--text-placeholder)",
                                                  }}
                                                >
                                                  {specNode.description}
                                                </div>
                                              )}
                                            </div>
                                            {/* Toggle controls */}
                                            {isGloballyActive && (
                                              <div className="exp-toggle-controls">
                                                {specHasConfig && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (spec) handleOpenConfigModal(spec);
                                                    }}
                                                    className="exp-config-btn"
                                                    style={{
                                                      border: specHasOverride ? "2px solid var(--status-warning-text)" : "1px solid var(--input-border)",
                                                      background: specHasOverride ? "var(--status-warning-bg)" : "var(--surface-primary)",
                                                    }}
                                                    title={specHasOverride ? "Config overridden - click to edit" : "Configure spec settings"}
                                                  >
                                                    <span className="exp-config-icon">⚙️</span>
                                                  </button>
                                                )}
                                                <button
                                                  onClick={() => handleToggleSystemSpec(specNode.id)}
                                                  className="exp-toggle-track"
                                                  style={{
                                                    background: isEnabled ? "var(--status-success-text)" : "var(--button-disabled-bg)",
                                                  }}
                                                >
                                                  <div
                                                    className="exp-toggle-knob"
                                                    style={{ left: isEnabled ? 20 : 2 }}
                                                  />
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            });
                          } else {
                            // Render flat list of specs
                            return (
                              <div className="exp-spec-list">
                                {specNodes.filter((sn) => !sn.meta?.isSystemSpec || (systemSpecToggles.get(sn.id) ?? true)).map((specNode) => {
                                  const spec = (availableItems?.systemSpecs || []).find(s => s.id === specNode.id) ||
                                               items.find(i => i.spec?.id === specNode.id)?.spec;
                                  const isSystemSpec = specNode.meta?.isSystemSpec;
                                  const isEnabled = isSystemSpec
                                    ? (systemSpecToggles.get(specNode.id) ?? true)
                                    : true;
                                  const isGloballyActive = specNode.meta?.isActive !== false;
                                  const effectiveEnabled = isGloballyActive && isEnabled;
                                  const specHasOverride = isSystemSpec && hasConfigOverride(specNode.id);
                                  const specHasConfig = spec?.config && Object.keys(spec.config).length > 0;

                                  return (
                                    <div
                                      key={specNode.id}
                                      className="exp-spec-card"
                                      style={{
                                        background: effectiveEnabled ? "var(--surface-primary)" : "var(--background)",
                                        border: effectiveEnabled
                                          ? "1px solid var(--status-success-border)"
                                          : "1px solid var(--border-default)",
                                        opacity: effectiveEnabled ? 1 : 0.6,
                                      }}
                                    >
                                      <div className="exp-spec-row">
                                        <div className="exp-spec-info">
                                          <div className="exp-spec-badges">
                                            <SpecRoleBadge role={specNode.meta?.specRole || spec?.specRole} size="sm" showIcon={false} />
                                            {outputTypeBadge(specNode.meta?.outputType || spec?.outputType || "")}
                                          </div>
                                          <Link
                                            href={`${routePrefix}/specs/${specNode.id}`}
                                            className="exp-spec-link"
                                            style={{
                                              color: effectiveEnabled ? "var(--text-primary)" : "var(--text-muted)",
                                            }}
                                          >
                                            {specNode.name.replace(/^🚫\s*/, "")}
                                          </Link>
                                          {specNode.description && (
                                            <div
                                              className="exp-spec-desc"
                                              style={{
                                                color: effectiveEnabled ? "var(--text-muted)" : "var(--text-placeholder)",
                                              }}
                                            >
                                              {specNode.description}
                                            </div>
                                          )}
                                        </div>
                                        {/* Toggle for system specs only */}
                                        {isSystemSpec && isGloballyActive && (
                                          <div className="exp-toggle-controls">
                                            {specHasConfig && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (spec) handleOpenConfigModal(spec as Spec);
                                                }}
                                                className="exp-config-btn"
                                                style={{
                                                  border: specHasOverride ? "2px solid var(--status-warning-text)" : "1px solid var(--input-border)",
                                                  background: specHasOverride ? "var(--status-warning-bg)" : "var(--surface-primary)",
                                                }}
                                                title={specHasOverride ? "Config overridden" : "Configure"}
                                              >
                                                <span className="exp-config-icon">⚙️</span>
                                              </button>
                                            )}
                                            <button
                                              onClick={() => handleToggleSystemSpec(specNode.id)}
                                              className="exp-toggle-track"
                                              style={{
                                                background: isEnabled ? "var(--status-success-text)" : "var(--button-disabled-bg)",
                                              }}
                                            >
                                              <div
                                                className="exp-toggle-knob"
                                                style={{ left: isEnabled ? 20 : 2 }}
                                              />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                        })()}
                      </div>
                    </div>
                  ) : (
                    // Regular detail view for non-group nodes
                    <NodeDetailPanel node={selectedNode} />
                  )
                ) : (
                  <div className="exp-empty-state">
                    <span className="exp-empty-icon">🌳</span>
                    <p className="exp-empty-text">Select an item from the tree to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
  );
}

// ============================================================
// ExplorerTreeNode (private helper)
// ============================================================

function ExplorerTreeNode({
  node,
  depth,
  expandedNodes,
  selectedNode,
  onToggle,
  onSelect,
  isLast = false,
  parentLines = [],
}: {
  node: TreeNode;
  depth: number;
  expandedNodes: Set<string>;
  selectedNode: TreeNode | null;
  onToggle: (id: string) => void;
  onSelect: (node: TreeNode) => void;
  isLast?: boolean;
  parentLines?: boolean[];
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNode?.id === node.id;
  const icon = nodeIcons[node.type] || "📄";
  const colors = nodeColors[node.type] || nodeColors.config;

  // Windows Explorer style [+]/[-] toggle box — inlined below
  // (was a nested component; hoisted into the JSX to satisfy
  // react-hooks/static-components and avoid prop drilling).

  return (
    <div className="exp-node-wrapper">
      {/* Tree connector lines */}
      {depth > 0 && (
        <>
          {/* Vertical lines from parent levels */}
          {parentLines.map((showLine, i) => (
            showLine && (
              <div
                key={i}
                className="exp-connector-line"
                style={{
                  left: i * 20 + 8,
                  top: 0,
                  bottom: 0,
                }}
              />
            )
          ))}
          {/* Horizontal connector to this node */}
          <div
            className="exp-connector-horizontal"
            style={{
              left: (depth - 1) * 20 + 8,
              top: 14,
              width: 12,
            }}
          />
          {/* Vertical line segment for this level (if not last) */}
          {!isLast && (
            <div
              className="exp-connector-line"
              style={{
                left: (depth - 1) * 20 + 8,
                top: 0,
                bottom: 0,
              }}
            />
          )}
          {/* Vertical line to horizontal for this node */}
          <div
            className="exp-connector-line"
            style={{
              left: (depth - 1) * 20 + 8,
              top: 0,
              height: 15,
            }}
          />
        </>
      )}

      <div
        data-node-id={node.id}
        onClick={() => {
          onSelect(node);
        }}
        className="exp-node-row"
        style={{
          marginLeft: depth * 20,
          background: isSelected ? colors.selectedBg : "transparent",
          border: isSelected ? `1px solid ${colors.border}` : "1px solid transparent",
        }}
        ref={(el) => {
          // Scroll into view when selected
          if (isSelected && el) {
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "var(--hover-bg)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Windows-style [+]/[-] Toggle Box */}
        {!hasChildren ? (
          <span className="exp-toggle-box-spacer" />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="exp-toggle-box"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "−" : "+"}
          </span>
        )}

        {/* Node Icon */}
        <span className="exp-node-icon">{icon}</span>

        {/* Node Name */}
        <span
          className="exp-node-name"
          style={{
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? colors.text : "var(--text-secondary)",
          }}
        >
          {node.name}
        </span>

        {/* Child Count Badge */}
        {hasChildren && (
          <span className="exp-child-count">
            {node.children!.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child, index) => (
            <ExplorerTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNodes={expandedNodes}
              selectedNode={selectedNode}
              onToggle={onToggle}
              onSelect={onSelect}
              isLast={index === node.children!.length - 1}
              parentLines={[...parentLines, !isLast]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NodeDetailPanel (private helper)
// ============================================================

// Node Detail Panel Component
function NodeDetailPanel({ node }: { node: TreeNode }) {
  const icon = nodeIcons[node.type] || "📄";
  const colors = nodeColors[node.type] || nodeColors.config;

  return (
    <div className="exp-detail-wrapper">
      {/* Header */}
      <div className="exp-detail-header" style={{ background: colors.bg }}>
        <div className="exp-detail-header-row">
          <span className="exp-detail-header-icon">{icon}</span>
          <div>
            <span className="exp-detail-type-label" style={{ color: colors.text }}>
              {node.type}
            </span>
            <h2 className="exp-detail-title">
              {node.name}
            </h2>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="exp-detail-body">
        {/* Description */}
        {node.description && (
          <div className="exp-detail-section">
            <h3 className="exp-detail-section-heading">
              Description
            </h3>
            <p className="exp-detail-description">
              {node.description}
            </p>
          </div>
        )}

        {/* Metadata */}
        {node.meta && Object.keys(node.meta).length > 0 && (
          <div className="exp-detail-section">
            <h3 className="exp-detail-section-heading-lg">
              Properties
            </h3>
            <div className="exp-props-grid">
              {Object.entries(node.meta)
                .filter(([k, v]) => v !== null && v !== undefined && k !== "fullTemplate" && k !== "fullDescription" && k !== "fullText")
                .map(([key, value]) => (
                  <div key={key} className="exp-prop-card">
                    <div className="exp-prop-label">
                      {key}
                    </div>
                    <div className="exp-prop-value">
                      {typeof value === "boolean"
                        ? (value ? "✓ Yes" : "✗ No")
                        : typeof value === "number"
                        ? value.toLocaleString()
                        : Array.isArray(value)
                        ? value.join(", ")
                        : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)
                      }
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Full Template Content (for template-content nodes) */}
        {node.type === "template-content" && node.meta?.fullTemplate && (
          <div className="exp-detail-section">
            <h3 className="exp-detail-section-heading-lg">
              Full Template ({node.meta.length} chars)
            </h3>
            <pre className="exp-template-block">
              {node.meta.fullTemplate}
            </pre>
          </div>
        )}

        {/* Full Description (for info nodes) */}
        {node.type === "info" && node.meta?.fullDescription && (
          <div className="exp-detail-section">
            <h3 className="exp-detail-section-heading-lg">
              Full Description
            </h3>
            <p className="exp-info-block">
              {node.meta.fullDescription}
            </p>
          </div>
        )}

        {/* Instruction Content (for instruction nodes) */}
        {node.type === "instruction" && node.meta?.fullText && (
          <div className="exp-detail-section">
            <h3 className="exp-detail-section-heading-lg">
              Instruction
            </h3>
            <p className="exp-instruction-block">
              {node.meta.fullText}
            </p>
          </div>
        )}

        {/* Children Summary */}
        {node.children && node.children.length > 0 && (
          <div>
            <h3 className="exp-detail-section-heading-lg">
              Contains ({node.children.length} items)
            </h3>
            <div className="exp-spec-list">
              {node.children.slice(0, 10).map((child) => {
                const childIcon = nodeIcons[child.type] || "📄";
                const childColors = nodeColors[child.type] || nodeColors.config;
                return (
                  <div
                    key={child.id}
                    className="exp-child-card"
                    style={{
                      background: childColors.bg,
                      border: `1px solid ${childColors.border}`,
                    }}
                  >
                    <span>{childIcon}</span>
                    <div className="exp-child-info">
                      <div className="exp-child-name" style={{ color: childColors.text }}>
                        {child.name}
                      </div>
                      {child.description && (
                        <div className="exp-child-desc">
                          {child.description}
                        </div>
                      )}
                    </div>
                    <span className="exp-child-type-badge">
                      {child.type}
                    </span>
                  </div>
                );
              })}
              {node.children.length > 10 && (
                <div className="exp-overflow-indicator">
                  ...and {node.children.length - 10} more items
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
