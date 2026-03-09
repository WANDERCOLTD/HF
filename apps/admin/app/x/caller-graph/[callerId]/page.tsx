"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { entityColors } from "@/src/components/shared/uiColors";
import { useVisualizerSearch } from "@/hooks/useVisualizerSearch";
import { VisualizerSearch } from "@/components/shared/VisualizerSearch";
import { drawIconNode, renderIconToCanvas, spriteTextureCache, NodeIcon } from "@/components/shared/VisualizerIcons";
import { encodeCallerNode, type VisualMode } from "@/lib/graph/visual-encoding";

type CallerNodeType =
  | "caller"
  | "domain"
  | "paramGroup"
  | "personality"
  | "memoryGroup"
  | "memory"
  | "call"
  | "goal"
  | "target"
  | "identity";

interface NodeDetail {
  label: string;
  value: string | number | boolean | null;
}

interface GraphNode {
  id: string;
  label: string;
  type: CallerNodeType;
  slug?: string;
  group?: string;
  details?: NodeDetail[];
  value?: number;
  status?: string;
  confidence?: number;
  decayFactor?: number;
  category?: string;
  progress?: number;
  age?: number;
  scoreCount?: number;
  x?: number;
  y?: number;
  z?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

interface ApiResponse {
  ok: boolean;
  caller: { id: string; name: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: { nodes: number; edges: number; byType: Record<string, number> };
}

// Node colors by type
const nodeColors: Record<CallerNodeType, string> = {
  caller:       entityColors.caller.accent,     // #ec4899 pink
  domain:       entityColors.domain.accent,     // #3b82f6 blue
  paramGroup:   entityColors.parameter.accent,  // #8b5cf6 violet
  personality:  entityColors.parameter.accent,  // #8b5cf6 violet
  memoryGroup:  entityColors.memory.accent,     // #7c3aed violet-600
  memory:       entityColors.memory.accent,     // #7c3aed
  call:         entityColors.call.accent,       // #6366f1 indigo
  goal:         entityColors.goal.accent,       // #06b6d4 cyan
  target:       "#14b8a6",                      // teal
  identity:     entityColors.prompt.accent,     // #f97316 orange
};

// Memory category sub-colors
const memoryCategoryColors: Record<string, string> = {
  FACT:         "#7c3aed",
  PREFERENCE:   "#a78bfa",
  EVENT:        "#6d28d9",
  TOPIC:        "#8b5cf6",
  RELATIONSHIP: "#c4b5fd",
  CONTEXT:      "#ddd6fe",
};

// Node sizes
const nodeSizes: Record<CallerNodeType, number> = {
  caller:       20,
  domain:       14,
  paramGroup:   10,
  personality:  7,
  memoryGroup:  10,
  memory:       5,
  call:         8,
  goal:         9,
  target:       7,
  identity:     7,
};

// Display names for type filter
const displayNames: Record<CallerNodeType, string> = {
  caller:       "Caller",
  domain:       "Institution",
  paramGroup:   "Param Groups",
  personality:  "Personality",
  memoryGroup:  "Memory Groups",
  memory:       "Memories",
  call:         "Calls",
  goal:         "Goals",
  target:       "Targets",
  identity:     "Identities",
};

// Edge colors
const edgeColors: Record<string, string> = {
  belongs_to:    entityColors.domain.accent,
  has_params:    entityColors.parameter.accent,
  has_param:     entityColors.parameter.accent,
  has_memories:  entityColors.memory.accent,
  memory_in:     entityColors.memory.accent,
  made_call:     entityColors.call.accent,
  pursues:       entityColors.goal.accent,
  has_target:    "#14b8a6",
  calibrates:    "#f59e0b",
  identified_by: entityColors.prompt.accent,
};

const ALL_TYPES: CallerNodeType[] = ["caller", "domain", "paramGroup", "personality", "memoryGroup", "memory", "call", "goal", "target", "identity"];

export default function CallerGraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const searchStateRef = useRef<{ isMatch: (id: string) => boolean; isSearching: boolean; mode: "highlight" | "filter" }>({
    isMatch: () => true,
    isSearching: false,
    mode: "highlight",
  });
  const router = useRouter();
  const { callerId } = useParams<{ callerId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<ApiResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<Set<CallerNodeType>>(() => new Set(ALL_TYPES));
  const [is3D, setIs3D] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [visualMode, setVisualMode] = useState<VisualMode>("simple");

  // Search functionality
  const searchableNodes = useMemo(() =>
    (graphData?.nodes ?? []).map(n => ({ id: n.id, label: n.label, slug: n.slug, type: n.type })),
    [graphData?.nodes]
  );

  const handleSearchMatchChange = useCallback((nodeId: string | null) => {
    if (!nodeId || !graphRef.current || !graphData) return;
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (node && node.x !== undefined) {
      if (is3D) {
        graphRef.current.cameraPosition(
          { x: node.x * 1.5, y: node.y! * 1.5, z: (node.z || 0) + 200 },
          { x: node.x, y: node.y, z: node.z || 0 },
          600
        );
      } else {
        graphRef.current.centerAt(node.x, node.y, 600);
        graphRef.current.zoom(2, 600);
      }
      setSelectedNode(node);
    }
  }, [graphData, is3D]);

  const search = useVisualizerSearch(searchableNodes, {
    onMatchChange: handleSearchMatchChange,
    searchFields: ["label", "slug"],
  });

  // Update search state ref
  useEffect(() => {
    searchStateRef.current = {
      isMatch: search.isMatch,
      isSearching: search.isSearching,
      mode: search.mode,
    };
    if (graphRef.current) {
      if (is3D) {
        graphRef.current.nodeOpacity((node: GraphNode) => {
          if (!search.isSearching) return 0.95;
          if (search.mode === "filter" && !search.isMatch(node.id)) return 0;
          if (search.mode === "highlight" && !search.isMatch(node.id)) return 0.15;
          return 0.95;
        });
      }
      graphRef.current.nodeColor(graphRef.current.nodeColor());
    }
  }, [search.isMatch, search.isSearching, search.mode, search.debouncedTerm, is3D]);

  // Theme detection
  useEffect(() => {
    const checkDarkMode = () => {
      const root = document.documentElement;
      if (root.classList.contains("light")) { setIsDarkMode(false); return; }
      if (root.classList.contains("dark")) { setIsDarkMode(true); return; }
      setIsDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches);
    };
    checkDarkMode();
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", checkDarkMode);
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      mediaQuery.removeEventListener("change", checkDarkMode);
      observer.disconnect();
    };
  }, []);

  // Fetch graph data
  useEffect(() => {
    if (!callerId) return;
    const fetchGraph = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/caller-graph/${callerId}`);
        const data: ApiResponse = await res.json();
        if (!data.ok) throw new Error("Failed to load caller graph");
        setGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load graph");
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [callerId]);

  // Navigate to entity detail
  const navigateToEntity = useCallback((node: GraphNode) => {
    const [type, id] = node.id.split(":");
    switch (type) {
      case "caller":
        router.push(`/x/callers/${id}`);
        break;
      case "domain":
        router.push(`/x/domains?id=${id}`);
        break;
      case "call":
        router.push(`/x/callers/${callerId}?tab=journey`);
        break;
      case "goal":
        router.push(`/x/callers/${callerId}?tab=what`);
        break;
      case "param":
        router.push(`/x/dictionary?search=${encodeURIComponent(node.slug || node.label)}`);
        break;
      default:
        // For memory, target, identity, group nodes — stay on graph
        break;
    }
  }, [router, callerId]);

  // Center on node
  const centerOnNode = useCallback((node: any) => {
    if (!graphRef.current || node.x === undefined) return;
    if (is3D) {
      graphRef.current.cameraPosition(
        { x: node.x * 1.5, y: node.y * 1.5, z: (node.z || 0) + 200 },
        { x: node.x, y: node.y, z: node.z || 0 },
        600
      );
    } else {
      graphRef.current.centerAt(node.x, node.y, 600);
      graphRef.current.zoom(2, 600);
    }
  }, [is3D]);

  // Get node color (with value-based encoding for personality/memory nodes)
  const getNodeColor = useCallback((node: GraphNode): string => {
    // Memory nodes: use category sub-color from group label
    if (node.type === "memory" || node.type === "memoryGroup") {
      // Extract category from the group label or details
      const catDetail = node.details?.find(d => d.label === "Category");
      if (catDetail?.value && typeof catDetail.value === "string") {
        return memoryCategoryColors[catDetail.value] || nodeColors.memory;
      }
    }
    return nodeColors[node.type] || "#888888";
  }, []);

  // Initialize graph
  useEffect(() => {
    if (!containerRef.current || !graphData) return;

    if (graphRef.current) {
      graphRef.current._destructor?.();
      graphRef.current = null;
    }

    const importPromise = is3D
      ? import("3d-force-graph")
      : import("force-graph");

    importPromise.then((module) => {
      const ForceGraph = module.default as any;

      const links = graphData.edges.map(e => ({
        source: e.from,
        target: e.to,
        type: e.type,
      }));

      const bgColor = isDarkMode ? "#171717" : "#f5f5f5";
      const tooltipBg = isDarkMode ? "#1f2937" : "#ffffff";
      const tooltipBorder = isDarkMode ? "#374151" : "#e5e7eb";
      const tooltipText = isDarkMode ? "#e5e7eb" : "#374151";
      const tooltipLabel = isDarkMode ? "#9ca3af" : "#6b7280";
      const tooltipTitle = isDarkMode ? "white" : "#111827";

      const graph = ForceGraph()(containerRef.current!)
        .graphData({ nodes: [...graphData.nodes], links })
        .backgroundColor(bgColor)
        .nodeVal((node: GraphNode) => nodeSizes[node.type] || 8)
        .nodeLabel((node: GraphNode) => {
          const color = getNodeColor(node);
          const detailsHtml = node.details && node.details.length > 0
            ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${tooltipBorder}">
                ${node.details.map(d => `
                  <div style="display:flex;gap:8px;font-size:11px;margin-bottom:3px">
                    <span style="color:${tooltipLabel};min-width:80px">${d.label}:</span>
                    <span style="color:${tooltipText};max-width:200px;overflow:hidden;text-overflow:ellipsis">${d.value}</span>
                  </div>
                `).join("")}
              </div>`
            : "";
          return `
            <div style="background:${tooltipBg};padding:10px 14px;border-radius:8px;border:1px solid ${color};max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,${isDarkMode ? '0.3' : '0.1'})">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <div style="width:8px;height:8px;border-radius:2px;background:${color}"></div>
                <span style="color:${color};font-size:10px;text-transform:uppercase;font-weight:600">${displayNames[node.type] || node.type}</span>
                ${node.status ? `<span style="color:#9ca3af;font-size:9px;background:${isDarkMode ? '#374151' : '#f3f4f6'};padding:1px 4px;border-radius:3px;margin-left:4px">${node.status}</span>` : ""}
              </div>
              <div style="color:${tooltipTitle};font-weight:600;font-size:13px">${node.label}</div>
              ${detailsHtml}
            </div>
          `;
        })
        .linkColor((link: any) => edgeColors[link.type] || "#666666")
        .linkWidth((link: any) => link.type === "calibrates" ? 2.5 : 1.5)
        .nodeVisibility((node: GraphNode) => visibleTypes.has(node.type))
        .linkVisibility((link: any) => {
          const source = typeof link.source === "object" ? link.source : graphData.nodes.find(n => n.id === link.source);
          const target = typeof link.target === "object" ? link.target : graphData.nodes.find(n => n.id === link.target);
          if (!source || !target) return true;
          return visibleTypes.has(source.type) && visibleTypes.has(target.type);
        })
        .onNodeClick((node: GraphNode) => {
          setSelectedNode(node);
          setTimeout(() => centerOnNode(node), 50);
        })
        .onNodeRightClick((node: GraphNode) => {
          navigateToEntity(node);
        })
        .enableNodeDrag(false);

      // Mode-specific settings
      if (is3D) {
        import("three").then((THREE) => {
          graph
            .nodeThreeObject((node: GraphNode) => {
              const color = getNodeColor(node);
              const encoded = encodeCallerNode(node, visualMode, nodeSizes[node.type] || 8, color);
              const cacheKey = `${node.type}:${encoded.color}:${encoded.ring?.color || ""}`;

              let texture = spriteTextureCache.get(cacheKey);
              if (!texture) {
                const canvas = renderIconToCanvas(node.type as CallerNodeType, encoded.color, 64, encoded.ring);
                texture = new THREE.CanvasTexture(canvas);
                spriteTextureCache.set(cacheKey, texture);
              }

              const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: encoded.opacity,
              });
              const sprite = new THREE.Sprite(material);
              sprite.scale.set(encoded.radius * 1.5, encoded.radius * 1.5, 1);
              return sprite;
            })
            .nodeOpacity(0.95)
            .linkOpacity(0.7)
            .enableNavigationControls(true)
            .showNavInfo(false);

          // Tighter initial zoom for caller graph
          graph.cameraPosition({ x: 0, y: 0, z: 400 });
        });
      } else {
        graph
          .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D) => {
            const { isMatch, isSearching, mode } = searchStateRef.current;
            const isNodeMatch = isMatch(node.id);

            if (isSearching && mode === "filter" && !isNodeMatch) return;

            const baseOpacity = isSearching && !isNodeMatch ? 0.15 : 1;

            const color = getNodeColor(node);
            const encoded = encodeCallerNode(node, visualMode, nodeSizes[node.type] || 8, color);

            // In simple mode, preserve existing personality/goal encoding
            let opacity = baseOpacity;
            if (baseOpacity === 1) {
              opacity = encoded.opacity;
            }

            ctx.globalAlpha = opacity;

            drawIconNode(ctx, node.type, node.x!, node.y!, encoded.radius, encoded.color, encoded.ring);

            // Draw label for caller hub node in 2D
            if (node.type === "caller") {
              ctx.globalAlpha = baseOpacity;
              ctx.fillStyle = isDarkMode ? "#ffffff" : "#111827";
              ctx.font = "bold 5px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(node.label, node.x!, node.y! + encoded.radius + 3);
            }

            ctx.globalAlpha = 1;
          })
          .nodePointerAreaPaint((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
            const size = nodeSizes[node.type] || 8;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
            ctx.fill();
          })
          .linkDirectionalArrowLength(3)
          .linkDirectionalArrowRelPos(1);
      }

      // Hub-and-spoke force tuning — slower decay lets simulation settle into clearer clusters
      graph.d3AlphaDecay(0.012);
      graph.d3Force("charge")?.strength((node: any) => {
        if (node.type === "caller") return -400;
        if (["paramGroup", "memoryGroup", "domain"].includes(node.type)) return -150;
        return -20;
      });
      graph.d3Force("link")?.distance((link: any) => {
        if (link.type === "belongs_to") return 150;
        if (link.type === "has_params" || link.type === "has_memories") return 100;
        if (link.type === "has_param" || link.type === "memory_in") return 35;
        if (link.type === "made_call") return 100;
        if (link.type === "pursues") return 110;
        if (link.type === "has_target") return 90;
        if (link.type === "identified_by") return 80;
        if (link.type === "calibrates") return 140;
        return 60;
      });
      graph.d3Force("link")?.strength((link: any) => {
        if (link.type === "has_param" || link.type === "memory_in") return 0.9;
        if (link.type === "calibrates") return 0.15;
        return 0.5;
      });

      graphRef.current = graph;
    });

    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
    };
  }, [graphData, is3D, isDarkMode, navigateToEntity, centerOnNode, getNodeColor, visualMode]);

  // Update visibility
  useEffect(() => {
    if (!graphRef.current || !graphData) return;
    const { isMatch, isSearching, mode } = searchStateRef.current;

    graphRef.current
      .nodeVisibility((node: GraphNode) => {
        if (!visibleTypes.has(node.type)) return false;
        if (isSearching && mode === "filter" && !isMatch(node.id)) return false;
        return true;
      })
      .linkVisibility((link: any) => {
        const source = typeof link.source === "object" ? link.source : graphData.nodes.find(n => n.id === link.source);
        const target = typeof link.target === "object" ? link.target : graphData.nodes.find(n => n.id === link.target);
        if (!source || !target) return true;
        if (!visibleTypes.has(source.type) || !visibleTypes.has(target.type)) return false;
        if (isSearching && mode === "filter") {
          if (!isMatch(source.id) || !isMatch(target.id)) return false;
        }
        return true;
      })
      .linkOpacity((link: any) => {
        if (!isSearching) return 0.7;
        const source = typeof link.source === "object" ? link.source : graphData.nodes.find(n => n.id === link.source);
        const target = typeof link.target === "object" ? link.target : graphData.nodes.find(n => n.id === link.target);
        if (!source || !target) return 0.7;
        if (mode === "highlight" && (!isMatch(source.id) || !isMatch(target.id))) return 0.1;
        return 0.7;
      });
  }, [visibleTypes, graphData, search.debouncedTerm, search.mode]);

  // Resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (graphRef.current && containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        graphRef.current.width(width).height(height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") setSelectedNode(null);
      if (e.key === "0" && graphRef.current) {
        if (is3D) {
          graphRef.current.cameraPosition({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 0 }, 500);
        } else {
          graphRef.current.centerAt(0, 0, 500);
          graphRef.current.zoom(1, 500);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [is3D]);

  const toggleType = (type: CallerNodeType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  // Connected nodes for panel
  const connectedNodes = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    const connected = new Set<string>();
    graphData.edges.forEach(e => {
      if (e.from === selectedNode.id) connected.add(e.to);
      if (e.to === selectedNode.id) connected.add(e.from);
    });
    return graphData.nodes.filter(n => connected.has(n.id)).slice(0, 15);
  }, [selectedNode, graphData]);

  // Filter types to only those present in graph
  const presentTypes = useMemo(() => {
    if (!graphData) return ALL_TYPES;
    const types = new Set(graphData.nodes.map(n => n.type));
    return ALL_TYPES.filter(t => types.has(t));
  }, [graphData]);

  return (
    <div className="flex flex-col bg-neutral-100 dark:bg-neutral-900" style={{ minHeight: "calc(100vh - 120px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Caller Graph{graphData?.caller?.name ? `: ${graphData.caller.name}` : ""}
          </h1>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${is3D ? "text-indigo-400 bg-indigo-900/30" : "text-emerald-400 bg-emerald-900/30"}`}>
            {is3D ? "3D" : "2D"}
          </span>
          {graphData && (
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              {graphData.counts.nodes} nodes, {graphData.counts.edges} edges
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {graphData?.caller && (
            <button
              onClick={() => router.push(`/x/callers/${graphData.caller.id}`)}
              className="rounded-md bg-pink-600 hover:bg-pink-500 px-3 py-1.5 text-sm text-white font-medium"
            >
              View Caller
            </button>
          )}
          <button
            onClick={() => router.back()}
            className="rounded-md bg-neutral-200 dark:bg-neutral-700 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600"
          >
            Back
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-neutral-900/80 z-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-pink-500 border-t-transparent" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-md bg-red-100 dark:bg-red-900/20 p-4 text-red-600 dark:text-red-400">{error}</div>
          </div>
        )}

        {/* Graph container */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Type filter panel - top right */}
        <div className="absolute top-4 right-4 rounded-lg border-2 border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 backdrop-blur-sm p-4 shadow-xl w-56">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Filter by Type</span>
              <button
                onClick={() => setVisibleTypes(new Set(ALL_TYPES))}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold"
              >
                all
              </button>
            </div>
            <div className="flex rounded-md overflow-hidden border-2 border-neutral-300 dark:border-neutral-600">
              <button
                onClick={() => setIs3D(false)}
                className={`px-3 py-1.5 text-xs font-bold transition-all ${
                  !is3D ? "bg-emerald-600 text-white shadow-inner" : "bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                }`}
              >
                2D
              </button>
              <button
                onClick={() => setIs3D(true)}
                className={`px-3 py-1.5 text-xs font-bold transition-all ${
                  is3D ? "bg-indigo-600 text-white shadow-inner" : "bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                }`}
              >
                3D
              </button>
            </div>
            <button
              onClick={() => setVisualMode(v => v === "simple" ? "rich" : "simple")}
              className={`px-3 py-1.5 text-xs font-bold rounded-md border-2 transition-all ${
                visualMode === "rich"
                  ? "bg-amber-600 text-white border-amber-500 shadow-inner"
                  : "bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-200 dark:hover:bg-neutral-600"
              }`}
            >
              Detailed
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {presentTypes.map(type => {
              const isVisible = visibleTypes.has(type);
              const color = nodeColors[type];
              const name = displayNames[type];
              const count = graphData?.counts.byType[type] || 0;
              const bgColor = isVisible ? `color-mix(in srgb, ${color} 19%, transparent)` : "var(--surface-secondary)";
              const borderColor = isVisible ? color : "var(--border-strong)";
              const textColor = isVisible
                ? "var(--text-primary)"
                : "var(--text-muted)";
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-left transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: bgColor,
                    border: `2px solid ${borderColor}`,
                    opacity: isVisible ? 1 : 0.6,
                  }}
                >
                  <NodeIcon type={type} color={isVisible ? color : "#a3a3a3"} size={14} />
                  <span className="text-xs font-semibold" style={{ color: textColor }}>
                    {name}
                  </span>
                  {count > 0 && (
                    <span className="ml-auto text-[10px] font-bold" style={{ color: isVisible ? color : (isDarkMode ? "#737373" : "#a3a3a3") }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t-2 border-neutral-200 dark:border-neutral-700 mt-3 pt-3">
            <VisualizerSearch search={search} placeholder="Search nodes..." />
          </div>
          <div className="border-t-2 border-neutral-200 dark:border-neutral-700 mt-3 pt-3 text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
            <div className="font-medium">Shortcuts:</div>
            <div className="flex justify-between"><span className="font-semibold">Click</span> <span>Select + Center</span></div>
            <div className="flex justify-between"><span className="font-semibold">Right-click</span> <span>Open detail</span></div>
            <div className="flex justify-between"><span className="font-semibold">Scroll</span> <span>Zoom</span></div>
            <div className="flex justify-between"><span className="font-semibold">0</span> <span>Reset view</span></div>
          </div>
        </div>

        {/* Selected node panel - bottom left */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 rounded-lg border-2 border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 backdrop-blur-sm shadow-xl w-72 max-h-[50vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b-2 border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
              <div className="flex items-center gap-2 mb-2">
                <NodeIcon type={selectedNode.type} color={getNodeColor(selectedNode)} size={14} />
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: getNodeColor(selectedNode) }}>
                  {displayNames[selectedNode.type] || selectedNode.type}
                </span>
                {selectedNode.status && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                    {selectedNode.status}
                  </span>
                )}
                <button
                  onClick={() => setSelectedNode(null)}
                  className="ml-auto text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 text-xl leading-none font-bold"
                >x</button>
              </div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{selectedNode.label}</h3>
              {selectedNode.value !== undefined && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round(selectedNode.value * 100)}%`,
                        backgroundColor: getNodeColor(selectedNode),
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                    {Math.round(selectedNode.value * 100)}%
                  </span>
                </div>
              )}
              {/* Details */}
              {selectedNode.details && selectedNode.details.length > 0 && (
                <div className="mt-3 pt-3 border-t-2 border-neutral-200 dark:border-neutral-700 max-h-32 overflow-y-auto">
                  {selectedNode.details.slice(0, 8).map((detail, i) => (
                    <div key={i} className="flex gap-2 text-[11px] mb-1.5">
                      <span className="text-neutral-600 dark:text-neutral-400 min-w-[70px] shrink-0 font-semibold">{detail.label}:</span>
                      <span className="text-neutral-900 dark:text-neutral-100 truncate font-medium" title={String(detail.value)}>
                        {typeof detail.value === "boolean" ? (detail.value ? "Yes" : "No") : detail.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Navigate button (only for navigable types) */}
              {["caller", "domain", "call", "goal", "param"].includes(selectedNode.id.split(":")[0]) && (
                <button
                  onClick={() => navigateToEntity(selectedNode)}
                  className="mt-2 w-full text-xs font-semibold text-center py-2 rounded-md bg-pink-600 hover:bg-pink-500 text-white shadow-sm transition-all hover:shadow-md"
                >
                  Open Detail
                </button>
              )}
            </div>
            {connectedNodes.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-2 text-[11px] font-bold uppercase text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800/80 sticky top-0 border-b border-neutral-200 dark:border-neutral-700">
                  Connected ({connectedNodes.length})
                </div>
                {connectedNodes.map(node => (
                  <button
                    key={node.id}
                    onClick={() => {
                      setSelectedNode(node);
                      const graphNode = graphRef.current?.graphData()?.nodes?.find((n: any) => n.id === node.id);
                      if (graphNode) centerOnNode(graphNode);
                    }}
                    className="w-full px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700/60 flex items-center gap-2 transition-colors border-b border-neutral-100 dark:border-neutral-800 last:border-0"
                  >
                    <NodeIcon type={node.type} color={getNodeColor(node)} size={10} />
                    <span className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate flex-1">{node.label}</span>
                    <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase">{displayNames[node.type] || node.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Camera controls - bottom right */}
        <div className="absolute bottom-4 right-4 flex gap-1 rounded-lg border-2 border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 backdrop-blur-sm p-1.5 shadow-lg">
          <button
            onClick={() => {
              if (is3D) {
                graphRef.current?.cameraPosition({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 0 }, 500);
              } else {
                graphRef.current?.centerAt(0, 0, 500);
                graphRef.current?.zoom(1, 500);
              }
            }}
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
            title="Reset view (0)"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
