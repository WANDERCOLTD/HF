"use client";

import React, { useCallback, useMemo, useEffect } from "react";
import { useVisualizerSearch, UseVisualizerSearchResult, SearchableNode } from "@/hooks/useVisualizerSearch";

// ============================================================
// TYPES
// ============================================================

export interface TreeNode {
  id: string;
  type: string;
  name: string;
  description?: string;
  meta?: Record<string, any>;
  children?: TreeNode[];
}

// ============================================================
// CONSTANTS - Icons and Colors
// ============================================================

export const nodeIcons: Record<string, string> = {
  // Hierarchy
  root: "🌳",
  playbook: "📚",
  group: "📁",
  "output-group": "📂",
  domain: "🏷️", // Category/tag (not globe - globe is used for Domains page in sidebar)
  scope: "🔍", // Generic fallback
  "scope-system": "⚙️", // System-wide scope
  "scope-domain": "🏢", // Per-domain scope (building = organization unit)
  "scope-caller": "👤", // Per-caller scope
  // Specs
  spec: "📋",
  trigger: "⚡",
  action: "▶️",
  parameter: "📐",
  // Anchors/Targets
  "anchor-group": "⚓",
  anchor: "⚓", // Anchor = reference point
  "target-group": "🎯",
  target: "🎯",
  // Config
  config: "⚙️",
  scoring: "📊",
  thresholds: "📏",
  slug: "🏷️",
  "param-ref": "🔗",
  // Templates
  template: "📝",
  "template-content": "📜",
  block: "🧱",
  // Info
  info: "ℹ️",
  "learn-config": "🧠",
  "config-item": "•",
  instruction: "💬", // Instruction = guidance/speech (distinct from spec)
};

export const nodeColors: Record<string, { bg: string; border: string; text: string; selectedBg: string }> = {
  root: { bg: "var(--tree-node-root-bg)", border: "var(--tree-node-root-border)", text: "var(--tree-node-root-text)", selectedBg: "var(--surface-secondary)" },
  playbook: { bg: "var(--tree-node-playbook-bg)", border: "var(--tree-node-playbook-border)", text: "var(--tree-node-playbook-text)", selectedBg: "var(--tree-node-playbook-bg)" },
  group: { bg: "var(--tree-node-group-bg)", border: "var(--tree-node-group-border)", text: "var(--tree-node-group-text)", selectedBg: "var(--surface-secondary)" },
  "output-group": { bg: "var(--tree-node-group-bg)", border: "var(--tree-node-group-border)", text: "var(--tree-node-group-text)", selectedBg: "var(--surface-secondary)" },
  domain: { bg: "var(--tree-node-domain-bg)", border: "var(--tree-node-domain-border)", text: "var(--tree-node-domain-text)", selectedBg: "var(--tree-node-domain-bg)" },
  scope: { bg: "var(--tree-node-scope-bg)", border: "var(--tree-node-scope-border)", text: "var(--tree-node-scope-text)", selectedBg: "var(--tree-node-scope-bg)" },
  "scope-system": { bg: "var(--tree-node-scope-bg)", border: "var(--tree-node-scope-border)", text: "var(--tree-node-scope-text)", selectedBg: "var(--tree-node-scope-bg)" },
  "scope-domain": { bg: "var(--tree-node-scope-bg)", border: "var(--tree-node-scope-border)", text: "var(--tree-node-scope-text)", selectedBg: "var(--tree-node-scope-bg)" },
  "scope-caller": { bg: "var(--tree-node-scope-bg)", border: "var(--tree-node-scope-border)", text: "var(--tree-node-scope-text)", selectedBg: "var(--tree-node-scope-bg)" },
  spec: { bg: "var(--tree-node-spec-bg)", border: "var(--tree-node-spec-border)", text: "var(--tree-node-spec-text)", selectedBg: "var(--tree-node-spec-bg)" },
  trigger: { bg: "var(--tree-node-trigger-bg)", border: "var(--tree-node-trigger-border)", text: "var(--tree-node-trigger-text)", selectedBg: "var(--tree-node-trigger-bg)" },
  action: { bg: "var(--tree-node-action-bg)", border: "var(--tree-node-action-border)", text: "var(--tree-node-action-text)", selectedBg: "var(--tree-node-action-bg)" },
  parameter: { bg: "var(--tree-node-parameter-bg)", border: "var(--tree-node-parameter-border)", text: "var(--tree-node-parameter-text)", selectedBg: "var(--tree-node-parameter-bg)" },
  "anchor-group": { bg: "var(--tree-node-anchor-bg)", border: "var(--tree-node-anchor-border)", text: "var(--tree-node-anchor-text)", selectedBg: "var(--tree-node-anchor-bg)" },
  anchor: { bg: "var(--tree-node-anchor-bg)", border: "var(--tree-node-anchor-border)", text: "var(--tree-node-anchor-text)", selectedBg: "var(--tree-node-anchor-bg)" },
  "target-group": { bg: "var(--tree-node-target-bg)", border: "var(--tree-node-target-border)", text: "var(--tree-node-target-text)", selectedBg: "var(--tree-node-target-bg)" },
  target: { bg: "var(--tree-node-target-bg)", border: "var(--tree-node-target-border)", text: "var(--tree-node-target-text)", selectedBg: "var(--tree-node-target-bg)" },
  config: { bg: "var(--tree-node-config-bg)", border: "var(--tree-node-config-border)", text: "var(--tree-node-config-text)", selectedBg: "var(--surface-secondary)" },
  template: { bg: "var(--tree-node-template-bg)", border: "var(--tree-node-template-border)", text: "var(--tree-node-template-text)", selectedBg: "var(--tree-node-template-bg)" },
  "template-content": { bg: "var(--tree-node-template-bg)", border: "var(--tree-node-template-border)", text: "var(--tree-node-template-text)", selectedBg: "var(--tree-node-template-bg)" },
  block: { bg: "var(--tree-node-template-bg)", border: "var(--tree-node-template-border)", text: "var(--tree-node-template-text)", selectedBg: "var(--tree-node-template-bg)" },
  info: { bg: "var(--tree-node-info-bg)", border: "var(--tree-node-info-border)", text: "var(--tree-node-info-text)", selectedBg: "var(--tree-node-info-bg)" },
  "learn-config": { bg: "var(--tree-node-learn-bg)", border: "var(--tree-node-learn-border)", text: "var(--tree-node-learn-text)", selectedBg: "var(--tree-node-learn-bg)" },
  "config-item": { bg: "var(--tree-node-config-bg)", border: "var(--tree-node-config-border)", text: "var(--text-secondary)", selectedBg: "var(--surface-secondary)" },
  instruction: { bg: "var(--tree-node-instruction-bg)", border: "var(--tree-node-instruction-border)", text: "var(--tree-node-instruction-text)", selectedBg: "var(--tree-node-instruction-bg)" },
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/** Collect all node IDs in a tree (for expand all) */
export function collectAllNodeIds(node: TreeNode): Set<string> {
  const ids = new Set<string>();
  const traverse = (n: TreeNode) => {
    ids.add(n.id);
    n.children?.forEach(traverse);
  };
  traverse(node);
  return ids;
}

/** Get flattened list of visible nodes (expanded branches only) */
export function getVisibleNodes(root: TreeNode | null, expandedNodes: Set<string>): TreeNode[] {
  if (!root) return [];
  const result: TreeNode[] = [];
  const traverse = (node: TreeNode) => {
    result.push(node);
    if (node.children && expandedNodes.has(node.id)) {
      node.children.forEach(traverse);
    }
  };
  traverse(root);
  return result;
}

/** Find parent node for a given node ID */
export function findParentNode(targetId: string, root: TreeNode | null): TreeNode | null {
  if (!root) return null;
  const search = (node: TreeNode): TreeNode | null => {
    if (node.children) {
      for (const child of node.children) {
        if (child.id === targetId) return node;
        const found = search(child);
        if (found) return found;
      }
    }
    return null;
  };
  return search(root);
}

/** Find all ancestor IDs for nodes matching a search term */
export function findMatchAncestors(root: TreeNode, matchIds: Set<string>): Set<string> {
  const ancestors = new Set<string>();

  const findPath = (node: TreeNode, path: string[]): void => {
    if (matchIds.has(node.id)) {
      // Add all ancestors to the set
      path.forEach((id) => ancestors.add(id));
    }
    if (node.children) {
      for (const child of node.children) {
        findPath(child, [...path, node.id]);
      }
    }
  };

  findPath(root, []);
  return ancestors;
}

/** Search state for tree visualization */
export interface TreeSearchState {
  matchIds: Set<string>;
  ancestorIds: Set<string>;
  isSearching: boolean;
  mode: "highlight" | "filter";
  currentMatchId: string | null;
}

// ============================================================
// HOOK: useTreeKeyboardNavigation
// ============================================================

export function useTreeKeyboardNavigation({
  root,
  expandedNodes,
  selectedNode,
  onToggleExpand,
  onSelectNode,
}: {
  root: TreeNode | null;
  expandedNodes: Set<string>;
  selectedNode: TreeNode | null;
  onToggleExpand: (id: string) => void;
  onSelectNode: (node: TreeNode) => void;
}) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedNode || !root) return;

      const visibleNodes = getVisibleNodes(root, expandedNodes);
      const currentIndex = visibleNodes.findIndex((n) => n.id === selectedNode.id);
      if (currentIndex === -1) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex < visibleNodes.length - 1) {
            onSelectNode(visibleNodes[currentIndex + 1]);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (currentIndex > 0) {
            onSelectNode(visibleNodes[currentIndex - 1]);
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (selectedNode.children && selectedNode.children.length > 0) {
            if (!expandedNodes.has(selectedNode.id)) {
              onToggleExpand(selectedNode.id);
            } else {
              onSelectNode(selectedNode.children[0]);
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (selectedNode.children && selectedNode.children.length > 0 && expandedNodes.has(selectedNode.id)) {
            onToggleExpand(selectedNode.id);
          } else {
            const parent = findParentNode(selectedNode.id, root);
            if (parent) {
              onSelectNode(parent);
            }
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          if (selectedNode.children && selectedNode.children.length > 0) {
            onToggleExpand(selectedNode.id);
          }
          break;
      }
    },
    [selectedNode, root, expandedNodes, onToggleExpand, onSelectNode]
  );

  return { handleKeyDown };
}

// ============================================================
// HOOK: useTreeSearch
// ============================================================

/** Flatten tree nodes for search */
function flattenTreeNodes(root: TreeNode | null): SearchableNode[] {
  if (!root) return [];
  const nodes: SearchableNode[] = [];
  const traverse = (node: TreeNode) => {
    nodes.push({ id: node.id, label: node.name, type: node.type });
    node.children?.forEach(traverse);
  };
  traverse(root);
  return nodes;
}

export interface UseTreeSearchOptions {
  /** Callback when current match changes */
  onMatchChange?: (nodeId: string | null) => void;
  /** Callback to expand a node (for auto-expanding to matches) */
  onExpandToNode?: (nodeId: string) => void;
}

export interface UseTreeSearchResult {
  /** The underlying visualizer search result */
  search: UseVisualizerSearchResult;
  /** Tree-specific search state for passing to ExplorerTreeNode */
  treeSearchState: TreeSearchState;
}

export function useTreeSearch(
  root: TreeNode | null,
  options: UseTreeSearchOptions = {}
): UseTreeSearchResult {
  const { onMatchChange, onExpandToNode } = options;

  // Flatten tree for search
  const searchableNodes = useMemo(() => flattenTreeNodes(root), [root]);

  // Use base visualizer search
  const search = useVisualizerSearch(searchableNodes, {
    onMatchChange,
    searchFields: ["label"],
  });

  // Compute ancestor paths for matches
  const ancestorIds = useMemo(() => {
    if (!root || !search.isSearching) return new Set<string>();
    return findMatchAncestors(root, search.matchSet);
  }, [root, search.matchSet, search.isSearching]);

  // Auto-expand ancestors when search changes
  useEffect(() => {
    if (!search.isSearching || !onExpandToNode) return;
    ancestorIds.forEach((id) => onExpandToNode(id));
  }, [ancestorIds, search.isSearching, onExpandToNode]);

  // Build tree search state
  const treeSearchState: TreeSearchState = useMemo(
    () => ({
      matchIds: search.matchSet,
      ancestorIds,
      isSearching: search.isSearching,
      mode: search.mode,
      currentMatchId: search.currentMatchId,
    }),
    [search.matchSet, ancestorIds, search.isSearching, search.mode, search.currentMatchId]
  );

  return { search, treeSearchState };
}

// ============================================================
// COMPONENT: ExplorerTreeNode
// ============================================================

export interface ExplorerTreeNodeProps {
  node: TreeNode;
  depth: number;
  expandedNodes: Set<string>;
  selectedNode: TreeNode | null;
  onToggle: (id: string) => void;
  onSelect: (node: TreeNode) => void;
  onDoubleClick?: (node: TreeNode) => void;
  isLast?: boolean;
  parentLines?: boolean[];
  /** Search state for highlighting/filtering */
  searchState?: TreeSearchState;
}

export function ExplorerTreeNode({
  node,
  depth,
  expandedNodes,
  selectedNode,
  onToggle,
  onSelect,
  onDoubleClick,
  isLast = false,
  parentLines = [],
  searchState,
}: ExplorerTreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNode?.id === node.id;
  const icon = nodeIcons[node.type] || "📄";
  const colors = nodeColors[node.type] || nodeColors.config;

  // Search state
  const isMatch = searchState?.matchIds.has(node.id) ?? false;
  const isAncestor = searchState?.ancestorIds.has(node.id) ?? false;
  const isCurrentMatch = searchState?.currentMatchId === node.id;
  const isSearching = searchState?.isSearching ?? false;
  const searchMode = searchState?.mode ?? "highlight";

  // In filter mode, hide nodes that aren't matches or ancestors of matches
  if (isSearching && searchMode === "filter" && !isMatch && !isAncestor) {
    return null;
  }

  // Calculate opacity for highlight mode
  const nodeOpacity = isSearching && searchMode === "highlight" && !isMatch && !isAncestor ? 0.35 : 1;

  // Windows Explorer [+]/[-] toggle — inlined below (hoisted from nested
  // component to satisfy react-hooks/static-components).

  return (
    <div style={{ position: "relative" }}>
      {/* Tree connector lines */}
      {depth > 0 && (
        <>
          {/* Vertical lines from parent levels */}
          {parentLines.map(
            (showLine, i) =>
              showLine && (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: i * 20 + 8,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "var(--button-disabled-bg)",
                  }}
                />
              )
          )}
          {/* Horizontal connector to this node */}
          <div
            style={{
              position: "absolute",
              left: (depth - 1) * 20 + 8,
              top: 14,
              width: 12,
              height: 1,
              background: "var(--button-disabled-bg)",
            }}
          />
          {/* Vertical line segment for this level (if not last) */}
          {!isLast && (
            <div
              style={{
                position: "absolute",
                left: (depth - 1) * 20 + 8,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--button-disabled-bg)",
              }}
            />
          )}
          {/* Vertical line to horizontal for this node */}
          <div
            style={{
              position: "absolute",
              left: (depth - 1) * 20 + 8,
              top: 0,
              height: 15,
              width: 1,
              background: "var(--button-disabled-bg)",
            }}
          />
        </>
      )}

      <div
        data-node-id={node.id}
        onClick={() => onSelect(node)}
        onDoubleClick={() => onDoubleClick?.(node)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          marginLeft: depth * 20,
          borderRadius: 4,
          cursor: "pointer",
          background: isCurrentMatch
            ? "var(--search-highlight, rgba(251, 191, 36, 0.25))"
            : isMatch
              ? "var(--search-match, rgba(251, 191, 36, 0.12))"
              : isSelected
                ? colors.selectedBg
                : "transparent",
          border: isCurrentMatch
            ? "1px solid var(--search-highlight-border, #fbbf24)"
            : isMatch
              ? "1px solid var(--search-match-border, rgba(251, 191, 36, 0.4))"
              : isSelected
                ? `1px solid ${colors.border}`
                : "1px solid transparent",
          transition: "background 0.1s, opacity 0.15s",
          position: "relative",
          opacity: nodeOpacity,
        }}
        ref={(el) => {
          // Scroll into view when current match or selected
          if ((isCurrentMatch || isSelected) && el) {
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
          <span style={{ width: 16, height: 16, display: "inline-block" }} />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            style={{
              width: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--text-placeholder)",
              borderRadius: 2,
              background: "var(--surface-primary)",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
              lineHeight: 1,
              fontFamily: "monospace",
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "−" : "+"}
          </span>
        )}

        {/* Node Icon */}
        <span style={{ flexShrink: 0, fontSize: 14 }}>{icon}</span>

        {/* Node Name */}
        <span
          style={{
            fontSize: 12,
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? colors.text : "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </span>

        {/* Child Count Badge */}
        {hasChildren && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              background: "var(--border-default)",
              padding: "1px 5px",
              borderRadius: 8,
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
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
              onDoubleClick={onDoubleClick}
              isLast={index === node.children!.length - 1}
              parentLines={[...parentLines, !isLast]}
              searchState={searchState}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMPONENT: NodeDetailPanel
// ============================================================

export function NodeDetailPanel({ node }: { node: TreeNode }) {
  const icon = nodeIcons[node.type] || "📄";
  const colors = nodeColors[node.type] || nodeColors.config;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-default)",
          background: colors.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 32 }}>{icon}</span>
          <div>
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                color: colors.text,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              {node.type}
            </span>
            <h2
              style={{
                margin: "4px 0 0 0",
                fontSize: 18,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {node.name}
            </h2>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {/* Description */}
        {node.description && (
          <div style={{ marginBottom: 24 }}>
            <h3
              style={{
                margin: "0 0 8px 0",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Description
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {node.description}
            </p>
          </div>
        )}

        {/* Metadata */}
        {node.meta && Object.keys(node.meta).length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3
              style={{
                margin: "0 0 12px 0",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Properties
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {Object.entries(node.meta)
                .filter(
                  ([k, v]) =>
                    v !== null && v !== undefined && k !== "fullTemplate" && k !== "fullDescription" && k !== "fullText"
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      padding: "10px 12px",
                      background: "var(--background)",
                      borderRadius: 6,
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      {key}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        wordBreak: "break-word",
                      }}
                    >
                      {typeof value === "boolean"
                        ? value
                          ? "✓ Yes"
                          : "✗ No"
                        : typeof value === "number"
                          ? value.toLocaleString()
                          : Array.isArray(value)
                            ? value.join(", ")
                            : typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Full Template Content (for template-content nodes) */}
        {node.type === "template-content" && node.meta?.fullTemplate && (
          <div style={{ marginBottom: 24 }}>
            <h3
              style={{
                margin: "0 0 12px 0",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Full Template ({node.meta.length} chars)
            </h3>
            <pre
              style={{
                margin: 0,
                padding: 16,
                background: "var(--code-bg)",
                color: "var(--code-text)",
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.6,
                overflow: "auto",
                maxHeight: 400,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {node.meta.fullTemplate}
            </pre>
          </div>
        )}

        {/* Children Summary */}
        {node.children && node.children.length > 0 && (
          <div>
            <h3
              style={{
                margin: "0 0 12px 0",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Contains ({node.children.length} items)
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {node.children.slice(0, 10).map((child) => {
                const childIcon = nodeIcons[child.type] || "📄";
                const childColors = nodeColors[child.type] || nodeColors.config;
                return (
                  <div
                    key={child.id}
                    style={{
                      padding: "10px 12px",
                      background: childColors.bg,
                      borderRadius: 6,
                      border: `1px solid ${childColors.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span>{childIcon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: childColors.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {child.name}
                      </div>
                      {child.description && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {child.description}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        background: "var(--surface-primary)",
                        borderRadius: 4,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      {child.type}
                    </span>
                  </div>
                );
              })}
              {node.children.length > 10 && (
                <div
                  style={{
                    padding: 12,
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    background: "var(--background)",
                    borderRadius: 6,
                  }}
                >
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
