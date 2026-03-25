"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SourcePageHeader } from "@/components/shared/SourcePageHeader";
import { EditableTitle } from "@/components/shared/EditableTitle";
import { VerticalSlider, SliderGroup } from "@/components/shared/VerticalSlider";
import { DraggableTabs } from "@/components/shared/DraggableTabs";
import { useEntityContext } from "@/contexts/EntityContext";
import { useTerminology } from "@/contexts/TerminologyContext";
import { TreeNode } from "@/components/shared/ExplorerTree";
import { SpecRoleBadge } from "@/components/shared/SpecRoleBadge";
import { ClipboardList, Layers, Target, GitBranch, Settings, Zap, Orbit, Users } from "lucide-react";
import { TypePickerDialog, PickerItem, PickerCategory } from "@/components/shared/TypePickerDialog";
import { ParametersTabContent } from "./playbook-builder/ParametersTab";
import { TriggersTabContent } from "./playbook-builder/TriggersTab";
import { SlugsTabContent } from "./playbook-builder/SlugsTab";
import { ExplorerTabContent } from "./playbook-builder/ExplorerTab";
import { RosterTabContent } from "./playbook-builder/RosterTab";
import { TeachingContentColumn } from "./playbook-builder/TeachingContentColumn";
import type {
  SpecDetail, Spec, PlaybookItem,
  Domain, Agent, Curriculum, Playbook,
  AvailableItems, BehaviorParameter, TargetsData, PlaybookBuilderProps,
} from "./playbook-builder/types";

export function PlaybookBuilder({ playbookId, routePrefix = "" }: PlaybookBuilderProps) {
  const router = useRouter();
  const { pushEntity } = useEntityContext();
  const { terms, plural } = useTerminology();

  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [availableItems, setAvailableItems] = useState<AvailableItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [items, setItems] = useState<PlaybookItem[]>([]);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [expandedPalette, setExpandedPalette] = useState<string>("domainSpecs");

  // Tabs state - Explorer (unified tree+toggles view) is default
  // TODO: Consider removing "grid" tab once unified Explorer view is proven sufficient
  const [activeTab, setActiveTab] = useState<"grid" | "targets" | "explorer" | "slugs" | "parameters" | "triggers" | "visualizer" | "roster">("grid");
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  const [targetsData, setTargetsData] = useState<TargetsData | null>(null);
  const [specSearch, setSpecSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDefaultCategory, setPickerDefaultCategory] = useState<string>("agent");
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [showSystemInColumns, setShowSystemInColumns] = useState<Record<string, boolean>>({ agent: true, caller: true, content: true });
  const [systemColumnCollapsed, setSystemColumnCollapsed] = useState(false);

  // Parameters tab state
  type ParameterCategory = {
    category: string;
    icon: string;
    description: string;
    parameters: {
      id: string;
      parameterId: string;
      name: string;
      definition: string | null;
      scaleType: string;
      parameterType: string;
      interpretationHigh: string | null;
      interpretationLow: string | null;
      sourceFeatureSet?: { id: string; featureId: string; name: string; version: string } | null;
      scoringAnchors: {
        id: string;
        score: number;
        example: string;
        rationale: string | null;
        positiveSignals: string[];
        negativeSignals: string[];
        isGold: boolean;
      }[];
      usedBySpecs: { specId: string; specSlug: string; specName: string }[];
    }[];
  };
  const [parametersData, setParametersData] = useState<{ categories: ParameterCategory[]; counts: { parameters: number; anchors: number; categories: number } } | null>(null);
  const [parametersLoading, setParametersLoading] = useState(false);
  const [expandedParamCategories, setExpandedParamCategories] = useState<Set<string>>(new Set());
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());

  // Triggers tab state
  type TriggerCategory = {
    outputType: string;
    icon: string;
    description: string;
    specs: {
      specId: string;
      specSlug: string;
      specName: string;
      specType: string;
      outputType: string;
      triggers: {
        id: string;
        name: string | null;
        given: string;
        when: string;
        then: string;
        actions: {
          id: string;
          description: string;
          weight: number;
          parameterId: string | null;
          parameterName: string | null;
          learnCategory: string | null;
          learnKeyPrefix: string | null;
          learnKeyHint: string | null;
        }[];
      }[];
    }[];
  };
  const [triggersData, setTriggersData] = useState<{ categories: TriggerCategory[]; counts: { specs: number; triggers: number; actions: number; outputTypes: number } } | null>(null);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [expandedTriggerCategories, setExpandedTriggerCategories] = useState<Set<string>>(new Set());
  const [expandedTriggerSpecs, setExpandedTriggerSpecs] = useState<Set<string>>(new Set());
  const [expandedTriggerItems, setExpandedTriggerItems] = useState<Set<string>>(new Set());

  // Slugs tab state
  type SlugNode = {
    id: string;
    type: "category" | "spec" | "variable" | "value" | "produces";
    name: string;
    path?: string;
    value?: string | number | boolean | null;
    specId?: string;
    specSlug?: string;
    children?: SlugNode[];
    meta?: Record<string, any>;
  };
  const [slugsData, setSlugsData] = useState<{ tree: SlugNode[]; counts: Record<string, number> } | null>(null);
  const [slugsLoading, setSlugsLoading] = useState(false);
  const [expandedSlugNodes, setExpandedSlugNodes] = useState<Set<string>>(new Set());

  // Global filter for stats across tabs
  // Filter by specRole/category: ORCHESTRATE, EXTRACT, SYNTHESISE, CONSTRAIN, IDENTITY, CONTENT, VOICE
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [parameterSearch, setParameterSearch] = useState("");

  const toggleFilter = (filter: string) => {
    setActiveFilter(prev => prev === filter ? null : filter);
  };

  const [targetsLoading, setTargetsLoading] = useState(false);
  const [pendingTargetChanges, setPendingTargetChanges] = useState<Map<string, number | null>>(new Map());
  const [savingTargets, setSavingTargets] = useState(false);
  const [showTargetsSaveConfirm, setShowTargetsSaveConfirm] = useState(false);
  const [compilingTargets, setCompilingTargets] = useState(false);

  // Behavior Pills state
  interface BehaviorPillParam {
    parameterId: string;
    atFull: number;
    atZero: number;
  }
  interface BehaviorPill {
    id: string;
    label: string;
    description: string;
    intensity: number;
    source: "intent" | "domain-context";
    parameters: BehaviorPillParam[];
  }
  interface PillState {
    pill: BehaviorPill;
    active: boolean;
    intensity: number;
    lastModified: number;
  }
  const [intentText, setIntentText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [pillStates, setPillStates] = useState<PillState[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAdvancedSliders, setShowAdvancedSliders] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Playbook config settings (memory, learning, AI, thresholds)
  interface PlaybookConfigSettings {
    // Memory Settings
    memoryMinConfidence: number;
    memoryMaxCount: number;
    memoryDecayHalfLife: number;
    // Learning Rate Settings
    learningRate: number;
    learningTolerance: number;
    learningMinConfidence: number;
    learningMaxConfidence: number;
    // AI Settings
    aiTemperature: number;
    // Target Bounds
    targetClampMin: number;
    targetClampMax: number;
    // Threshold Sensitivity
    thresholdHigh: number;
    thresholdLow: number;
  }

  const defaultConfigSettings: PlaybookConfigSettings = {
    memoryMinConfidence: 0.5,
    memoryMaxCount: 20,
    memoryDecayHalfLife: 7,
    learningRate: 0.1,
    learningTolerance: 0.15,
    learningMinConfidence: 0.1,
    learningMaxConfidence: 0.95,
    aiTemperature: 0.3,
    targetClampMin: 0.2,
    targetClampMax: 0.8,
    thresholdHigh: 0.65,
    thresholdLow: 0.35,
  };

  const [configSettings, setConfigSettings] = useState<PlaybookConfigSettings>(defaultConfigSettings);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<Partial<PlaybookConfigSettings>>({});

  const handleConfigChange = (key: keyof PlaybookConfigSettings, value: number) => {
    setPendingConfigChanges(prev => ({ ...prev, [key]: value }));
  };

  const getConfigValue = (key: keyof PlaybookConfigSettings): number => {
    return pendingConfigChanges[key] ?? configSettings[key];
  };

  const isConfigModified = (key: keyof PlaybookConfigSettings): boolean => {
    return key in pendingConfigChanges && pendingConfigChanges[key] !== configSettings[key];
  };

  const resetConfigSetting = (key: keyof PlaybookConfigSettings) => {
    setPendingConfigChanges(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const resetAllConfigSettings = () => {
    setPendingConfigChanges({});
  };

  const pendingConfigCount = Object.keys(pendingConfigChanges).filter(
    key => pendingConfigChanges[key as keyof PlaybookConfigSettings] !== configSettings[key as keyof PlaybookConfigSettings]
  ).length;
  const [creatingNewVersion, setCreatingNewVersion] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  // System specs toggle state
  const [systemSpecToggles, setSystemSpecToggles] = useState<Map<string, boolean>>(new Map());
  const [systemSpecOverrides, setSystemSpecOverrides] = useState<Map<string, Record<string, any> | null>>(new Map());
  const [systemSpecsHaveChanges, setSystemSpecsHaveChanges] = useState(false);
  const [savingSystemSpecs, setSavingSystemSpecs] = useState(false);
  const [needsRepublish, setNeedsRepublish] = useState(false);

  // Config override modal state
  const [configModalSpec, setConfigModalSpec] = useState<Spec | null>(null);

  // Explorer tab state
  const [explorerTree, setExplorerTree] = useState<TreeNode | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);

  // Playbook items expanded state
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [specDetails, setSpecDetails] = useState<Map<string, SpecDetail>>(new Map());
  const [loadingSpecId, setLoadingSpecId] = useState<string | null>(null);
  const [expandedTriggers, setExpandedTriggers] = useState<Set<string>>(new Set());
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const [playbookRes, availableRes] = await Promise.all([
        fetch(`/api/playbooks/${playbookId}`),
        fetch("/api/playbooks/available-items"),
      ]);

      const playbookData = await playbookRes.json();
      const availableData = await availableRes.json();

      // Debug logging for troubleshooting
      console.log("[PlaybookBuilder] Fetched playbook:", playbookData.ok, "items:", playbookData.playbook?.items?.length);
      console.log("[PlaybookBuilder] Fetched available:", availableData.ok, "systemSpecs:", availableData.systemSpecs?.length);

      if (playbookData.ok) {
        setPlaybook(playbookData.playbook);
        setItems(playbookData.playbook.items);

        // Register with entity context for AI Chat
        pushEntity({
          type: "playbook",
          id: playbookData.playbook.id,
          label: playbookData.playbook.name,
          href: `${routePrefix}/playbooks/${playbookData.playbook.id}`,
          data: {
            status: playbookData.playbook.status,
            version: playbookData.playbook.version,
            domainId: playbookData.playbook.domainId,
            description: playbookData.playbook.description,
            itemCount: playbookData.playbook.items?.length || 0,
          },
        });

        // Initialize system spec toggles from playbook.systemSpecs
        // Default: all system specs are enabled unless explicitly disabled
        if (availableData.ok) {
          const toggleMap = new Map<string, boolean>();
          const playbookSystemSpecs = playbookData.playbook.systemSpecs || [];

          // Create a lookup for playbook's spec toggle state
          const playbookToggleLookup = new Map<string, boolean>();
          for (const pss of playbookSystemSpecs) {
            playbookToggleLookup.set(pss.specId, pss.isEnabled);
          }

          // For each available system spec, use playbook state if exists, else default to true
          for (const spec of availableData.systemSpecs || []) {
            const isEnabled = playbookToggleLookup.has(spec.id)
              ? playbookToggleLookup.get(spec.id)!
              : true; // Default to enabled
            toggleMap.set(spec.id, isEnabled);
          }

          setSystemSpecToggles(toggleMap);

          // Initialize config overrides from the same systemSpecs array
          const overrideMap = new Map<string, Record<string, any> | null>();
          for (const pss of playbookSystemSpecs) {
            if (pss.configOverride) {
              overrideMap.set(pss.specId, pss.configOverride);
            }
          }
          setSystemSpecOverrides(overrideMap);
          setSystemSpecsHaveChanges(false);
        }

        // Initialize config settings (memory, learning, AI, thresholds) from playbook.configSettings
        if (playbookData.playbook.configSettings) {
          setConfigSettings({ ...defaultConfigSettings, ...playbookData.playbook.configSettings });
        } else {
          setConfigSettings(defaultConfigSettings);
        }
        setPendingConfigChanges({});
      } else {
        setError(playbookData.error);
      }

      if (availableData.ok) {
        console.log("[PlaybookBuilder] Setting availableItems with", availableData.systemSpecs?.length, "system specs");
        setAvailableItems(availableData);
      } else {
        console.error("[PlaybookBuilder] availableData not ok:", availableData.error);
      }
    } catch (err: any) {
      console.error("[PlaybookBuilder] fetchData error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [playbookId, pushEntity, routePrefix]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch targets when switching to targets tab
  const fetchTargets = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/targets`);
      const data = await res.json();
      if (data.ok) {
        setTargetsData(data);
        setPendingTargetChanges(new Map());
      }
    } catch (err: any) {
      console.error("Error fetching targets:", err);
    } finally {
      setTargetsLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    if (activeTab === "targets" && !targetsData) {
      fetchTargets();
    }
  }, [activeTab, targetsData, fetchTargets]);

  // Fetch explorer tree when switching to explorer tab
  const fetchExplorerTree = useCallback(async () => {
    setExplorerLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/tree`);
      const data = await res.json();
      console.log("[PlaybookBuilder] Tree API response:", data.ok, "tree:", !!data.tree, "stats:", data.stats);
      if (!data.ok) {
        console.error("[PlaybookBuilder] Tree API error:", data.error);
      }
      if (data.ok) {
        setExplorerTree(data.tree);
        // Auto-expand first two levels and select root
        const toExpand = new Set<string>();
        if (data.tree) {
          toExpand.add(data.tree.id);
          data.tree.children?.forEach((child: TreeNode) => {
            toExpand.add(child.id);
          });
          setSelectedNode(data.tree);
        }
        setExpandedNodes(toExpand);
      }
    } catch (err: any) {
      console.error("Error fetching explorer tree:", err);
    } finally {
      setExplorerLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    if (activeTab === "explorer" && !explorerTree) {
      fetchExplorerTree();
    }
  }, [activeTab, explorerTree, fetchExplorerTree]);

  // Fetch slugs data when switching to slugs tab
  const fetchSlugs = useCallback(async () => {
    setSlugsLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/slugs`);
      const data = await res.json();
      if (data.ok) {
        setSlugsData({ tree: data.tree, counts: data.counts });
        // Auto-expand categories
        const toExpand = new Set<string>();
        data.tree.forEach((cat: SlugNode) => {
          toExpand.add(cat.id);
        });
        setExpandedSlugNodes(toExpand);
      }
    } catch (err: any) {
      console.error("Error fetching slugs:", err);
    } finally {
      setSlugsLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    if (activeTab === "slugs" && !slugsData) {
      fetchSlugs();
    }
  }, [activeTab, slugsData, fetchSlugs]);

  // Fetch parameters data when switching to parameters tab
  const fetchParameters = useCallback(async () => {
    setParametersLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/parameters`);
      const data = await res.json();
      if (data.ok) {
        setParametersData({ categories: data.categories, counts: data.counts });
        // Auto-expand all categories
        const toExpand = new Set<string>();
        data.categories.forEach((cat: ParameterCategory) => {
          toExpand.add(cat.category);
        });
        setExpandedParamCategories(toExpand);
      }
    } catch (err: any) {
      console.error("Error fetching parameters:", err);
    } finally {
      setParametersLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    if (activeTab === "parameters" && !parametersData) {
      fetchParameters();
    }
  }, [activeTab, parametersData, fetchParameters]);

  // Fetch triggers data when switching to triggers tab
  const fetchTriggers = useCallback(async () => {
    setTriggersLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/triggers`);
      const data = await res.json();
      if (data.ok) {
        setTriggersData({ categories: data.categories, counts: data.counts });
        // Auto-expand all categories
        const toExpand = new Set<string>();
        data.categories.forEach((cat: TriggerCategory) => {
          toExpand.add(cat.outputType);
        });
        setExpandedTriggerCategories(toExpand);
      }
    } catch (err: any) {
      console.error("Error fetching triggers:", err);
    } finally {
      setTriggersLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    if (activeTab === "triggers" && !triggersData) {
      fetchTriggers();
    }
  }, [activeTab, triggersData, fetchTriggers]);

  const toggleParamCategoryExpand = (category: string) => {
    setExpandedParamCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const toggleParamExpand = (paramId: string) => {
    setExpandedParams((prev) => {
      const next = new Set(prev);
      if (next.has(paramId)) {
        next.delete(paramId);
      } else {
        next.add(paramId);
      }
      return next;
    });
  };

  const toggleTriggerCategoryExpand = (outputType: string) => {
    setExpandedTriggerCategories((prev) => {
      const next = new Set(prev);
      if (next.has(outputType)) {
        next.delete(outputType);
      } else {
        next.add(outputType);
      }
      return next;
    });
  };

  const toggleTriggerSpecExpand = (specId: string) => {
    setExpandedTriggerSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(specId)) {
        next.delete(specId);
      } else {
        next.add(specId);
      }
      return next;
    });
  };

  const toggleTriggerItemExpand = (triggerId: string) => {
    setExpandedTriggerItems((prev) => {
      const next = new Set(prev);
      if (next.has(triggerId)) {
        next.delete(triggerId);
      } else {
        next.add(triggerId);
      }
      return next;
    });
  };

  const toggleSlugNodeExpand = (id: string) => {
    setExpandedSlugNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleNodeExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAllNodes = () => {
    if (!explorerTree) return;
    const allIds = new Set<string>();
    const collectIds = (node: TreeNode) => {
      allIds.add(node.id);
      node.children?.forEach(collectIds);
    };
    collectIds(explorerTree);
    setExpandedNodes(allIds);
  };

  const collapseAllNodes = () => {
    if (!explorerTree) return;
    setExpandedNodes(new Set([explorerTree.id]));
  };

  // Get flattened list of visible nodes for keyboard navigation
  const getVisibleNodes = useCallback((): TreeNode[] => {
    if (!explorerTree) return [];
    const result: TreeNode[] = [];
    const traverse = (node: TreeNode) => {
      result.push(node);
      if (node.children && expandedNodes.has(node.id)) {
        node.children.forEach(traverse);
      }
    };
    traverse(explorerTree);
    return result;
  }, [explorerTree, expandedNodes]);

  // Find parent node for a given node
  const findParentNode = useCallback((targetId: string, root: TreeNode | null): TreeNode | null => {
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
  }, []);

  // Keyboard navigation for tree
  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedNode || !explorerTree) return;

    const visibleNodes = getVisibleNodes();
    const currentIndex = visibleNodes.findIndex(n => n.id === selectedNode.id);
    if (currentIndex === -1) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (currentIndex < visibleNodes.length - 1) {
          setSelectedNode(visibleNodes[currentIndex + 1]);
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (currentIndex > 0) {
          setSelectedNode(visibleNodes[currentIndex - 1]);
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        if (selectedNode.children && selectedNode.children.length > 0) {
          if (!expandedNodes.has(selectedNode.id)) {
            // Expand the node
            toggleNodeExpand(selectedNode.id);
          } else {
            // Move to first child
            setSelectedNode(selectedNode.children[0]);
          }
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        if (selectedNode.children && selectedNode.children.length > 0 && expandedNodes.has(selectedNode.id)) {
          // Collapse the node
          toggleNodeExpand(selectedNode.id);
        } else {
          // Move to parent
          const parent = findParentNode(selectedNode.id, explorerTree);
          if (parent) {
            setSelectedNode(parent);
          }
        }
        break;

      case "Enter":
      case " ":
        e.preventDefault();
        if (selectedNode.children && selectedNode.children.length > 0) {
          toggleNodeExpand(selectedNode.id);
        }
        break;
    }
  }, [selectedNode, explorerTree, expandedNodes, getVisibleNodes, findParentNode, toggleNodeExpand]);

  // Fetch spec details when expanding an item
  const fetchSpecDetail = useCallback(async (specId: string) => {
    if (specDetails.has(specId)) return; // Already loaded
    setLoadingSpecId(specId);
    try {
      const res = await fetch(`/api/analysis-specs/${specId}`);
      const data = await res.json();
      if (data.ok && data.spec) {
        setSpecDetails((prev) => new Map(prev).set(specId, data.spec));
      }
    } catch (err: any) {
      console.error("Error fetching spec detail:", err);
    } finally {
      setLoadingSpecId(null);
    }
  }, [specDetails]);

  const toggleItemExpanded = (itemId: string, specId: string | null) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
        // Fetch spec details if expanding and have a spec
        if (specId) {
          fetchSpecDetail(specId);
        }
      }
      return next;
    });
  };

  const toggleTriggerExpanded = (triggerId: string) => {
    setExpandedTriggers((prev) => {
      const next = new Set(prev);
      if (next.has(triggerId)) {
        next.delete(triggerId);
      } else {
        next.add(triggerId);
      }
      return next;
    });
  };

  const toggleActionExpanded = (actionId: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  };

  const handleTargetChange = (parameterId: string, value: number | null) => {
    const newChanges = new Map(pendingTargetChanges);
    newChanges.set(parameterId, value);
    setPendingTargetChanges(newChanges);
  };

  // Resolve active pills into pendingTargetChanges
  const resolvePillsToTargets = useCallback((currentPills: PillState[]) => {
    const activePills = currentPills
      .filter((p) => p.active)
      .sort((a, b) => a.lastModified - b.lastModified);

    const resolved = new Map<string, number | null>();
    for (const ps of activePills) {
      for (const param of ps.pill.parameters) {
        const value = param.atZero + (param.atFull - param.atZero) * ps.intensity;
        resolved.set(param.parameterId, Math.max(0, Math.min(1, value)));
      }
    }
    setPendingTargetChanges(resolved);
  }, []);

  // Toggle a pill on/off
  const handlePillToggle = (pillId: string) => {
    setPillStates((prev) => {
      const next = prev.map((ps) =>
        ps.pill.id === pillId
          ? { ...ps, active: !ps.active, lastModified: Date.now() }
          : ps
      );
      resolvePillsToTargets(next);
      return next;
    });
  };

  // Adjust a pill's intensity
  const handlePillIntensity = (pillId: string, intensity: number) => {
    setPillStates((prev) => {
      const next = prev.map((ps) =>
        ps.pill.id === pillId
          ? { ...ps, intensity, lastModified: Date.now() }
          : ps
      );
      resolvePillsToTargets(next);
      return next;
    });
  };

  // Submit intent to suggest endpoint
  const handleSuggestPills = async (mode: "initial" | "more" = "initial") => {
    if (!intentText.trim() || !playbookId) return;

    if (mode === "initial") {
      setSuggesting(true);
      setSuggestError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const existingPillIds = pillStates.map((ps) => ps.pill.id);
      const res = await fetch(`/api/playbooks/${playbookId}/targets/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: intentText.trim(),
          mode,
          existingPillIds: mode === "more" ? existingPillIds : [],
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setSuggestError(data.error || "Failed to generate suggestions");
        return;
      }

      const newPills: PillState[] = (data.pills || []).map((pill: BehaviorPill) => ({
        pill,
        active: mode === "initial", // intent pills ON, extras OFF
        intensity: pill.intensity,
        lastModified: Date.now(),
      }));

      if (mode === "initial") {
        setPillStates(newPills);
        resolvePillsToTargets(newPills);
      } else {
        setPillStates((prev) => {
          const combined = [...prev, ...newPills];
          resolvePillsToTargets(combined);
          return combined;
        });
      }
    } catch (err: any) {
      setSuggestError(err.message || "Network error");
    } finally {
      setSuggesting(false);
      setLoadingMore(false);
    }
  };

  const handleSaveTargets = async (confirmed = false) => {
    if (pendingTargetChanges.size === 0) return;

    // If playbook is published and user hasn't confirmed, show confirmation modal
    if (playbook?.status === "PUBLISHED" && !confirmed) {
      setShowTargetsSaveConfirm(true);
      return;
    }

    setSavingTargets(true);
    setShowTargetsSaveConfirm(false);

    try {
      // Auto-unpublish if needed (switches to DRAFT so API accepts the save)
      if (playbook?.status === "PUBLISHED") {
        await autoUnpublish();
      }

      const targets = Array.from(pendingTargetChanges.entries()).map(([parameterId, targetValue]) => ({
        parameterId,
        targetValue,
      }));

      const res = await fetch(`/api/playbooks/${playbookId}/targets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });

      const data = await res.json();
      if (data.ok) {
        // Refresh targets data
        await fetchTargets();
        setPendingTargetChanges(new Map());
      } else {
        alert("Failed to save targets: " + data.error);
      }
    } catch (err: any) {
      alert("Error saving targets: " + err.message);
    } finally {
      setSavingTargets(false);
    }
  };

  // Save config settings (memory, learning, AI, thresholds)
  const [savingConfigSettings, setSavingConfigSettings] = useState(false);

  const handleSaveConfigSettings = async () => {
    if (pendingConfigCount === 0) return;

    setSavingConfigSettings(true);
    try {
      // Auto-unpublish if needed
      if (playbook?.status === "PUBLISHED") {
        await autoUnpublish();
      }

      // Merge pending changes into current settings
      const newSettings = { ...configSettings, ...pendingConfigChanges };

      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configSettings: newSettings }),
      });

      const data = await res.json();
      if (data.ok) {
        setConfigSettings(newSettings);
        setPendingConfigChanges({});
        setPlaybook(data.playbook);
      } else {
        alert("Failed to save config settings: " + data.error);
      }
    } catch (err: any) {
      alert("Error saving config settings: " + err.message);
    } finally {
      setSavingConfigSettings(false);
    }
  };

  const handleCompileTargets = async () => {
    // Save first if there are unsaved changes
    if (hasChanges) {
      await handleSave();
    }

    setCompilingTargets(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/compile-targets`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.ok) {
        // Refresh targets data and switch to targets tab
        setTargetsData(null); // Force refetch
        setActiveTab("targets");
        await fetchTargets();
        alert(`Compiled targets: ${data.compiled} new, ${data.skipped} existing`);
      } else {
        alert("Failed to compile targets: " + data.error);
      }
    } catch (err: any) {
      alert("Error compiling targets: " + err.message);
    } finally {
      setCompilingTargets(false);
    }
  };

  const handleCreateNewVersion = async () => {
    if (!confirm(`Clone this ${terms.playbook.toLowerCase()} as a new draft?`)) {
      return;
    }

    setCreatingNewVersion(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/new-version`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.ok) {
        // Navigate to the new clone
        router.push(`${routePrefix}/playbooks/${data.playbook.id}`);
      } else {
        alert(`Failed to clone ${terms.playbook.toLowerCase()}: ` + data.error);
      }
    } catch (err: any) {
      alert(`Error cloning ${terms.playbook.toLowerCase()}: ` + err.message);
    } finally {
      setCreatingNewVersion(false);
    }
  };


  // Silent auto-unpublish when user edits a published playbook
  const autoUnpublish = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybook(prev => prev ? { ...prev, status: "DRAFT" } : prev);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };
  const handleUnpublish = async () => {
    if (!confirm(`Unpublish this ${terms.playbook.toLowerCase()}? It will be removed from the active stack and reverted to DRAFT status.`)) {
      return;
    }

    setUnpublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      const data = await res.json();

      if (data.ok) {
        // Refresh to show updated status
        fetchData();
      } else {
        alert("Failed to unpublish: " + data.error);
      }
    } catch (err: any) {
      alert("Error unpublishing: " + err.message);
    } finally {
      setUnpublishing(false);
    }
  };

  const getEffectiveValue = (param: BehaviorParameter): number => {
    if (pendingTargetChanges.has(param.parameterId)) {
      const pending = pendingTargetChanges.get(param.parameterId);
      if (pending !== null && pending !== undefined) return pending;
      // If pending is null (reset), fall back to system
      return param.systemValue ?? 0.5;
    }
    return param.effectiveValue;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((item, idx) => ({
            itemType: item.itemType,
            specId: item.specId,
            promptTemplateId: item.promptTemplateId,
            isEnabled: item.isEnabled,
            sortOrder: idx,
          })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybook(data.playbook);
        setItems(data.playbook.items);
        setHasChanges(false);
      } else {
        alert("Failed to save: " + data.error);
      }
    } catch (err: any) {
      alert("Error saving: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handler to toggle a system spec on/off
  const handleToggleSystemSpec = (specId: string) => {
    setSystemSpecToggles((prev) => {
      const newMap = new Map(prev);
      newMap.set(specId, !prev.get(specId));
      return newMap;
    });
    setSystemSpecsHaveChanges(true);
  };

  // Handler to open config override modal
  const handleOpenConfigModal = (spec: Spec) => {
    setConfigModalSpec(spec);
  };

  // Handler to close config override modal
  const handleCloseConfigModal = () => {
    setConfigModalSpec(null);
  };

  // Handler to save config override from modal
  const handleSaveConfigOverride = (specId: string, override: Record<string, any> | null) => {
    setSystemSpecOverrides((prev) => {
      const newMap = new Map(prev);
      if (override === null || Object.keys(override).length === 0) {
        newMap.delete(specId);
      } else {
        newMap.set(specId, override);
      }
      return newMap;
    });
    setSystemSpecsHaveChanges(true);
    handleCloseConfigModal();
  };

  // Helper: check if spec has any config overrides
  const hasConfigOverride = (specId: string): boolean => {
    const override = systemSpecOverrides.get(specId);
    return override !== null && override !== undefined && Object.keys(override).length > 0;
  };

  // Save system spec toggle changes (including config overrides)
  const handleSaveSystemSpecs = async () => {
    setSavingSystemSpecs(true);
    try {
      const systemSpecsPayload = Array.from(systemSpecToggles.entries()).map(
        ([specId, isEnabled]) => ({
          specId,
          isEnabled,
          configOverride: systemSpecOverrides.get(specId) || null,
        })
      );

      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specs: systemSpecsPayload }),
      });
      const data = await res.json();
      if (data.ok) {
        setPlaybook(data.playbook);
        setSystemSpecsHaveChanges(false);
        // If playbook is published, mark as needing republish
        if (playbook?.status === "PUBLISHED") {
          setNeedsRepublish(true);
        }
      } else {
        alert("Failed to save system specs: " + data.error);
      }
    } catch (err: any) {
      alert("Error saving system specs: " + err.message);
    } finally {
      setSavingSystemSpecs(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm(`Publish this ${terms.playbook.toLowerCase()}? This will archive any currently published ${terms.playbook.toLowerCase()} for this ${terms.domain.toLowerCase()}.`)) {
      return;
    }

    // Save first if there are changes
    if (hasChanges) {
      await handleSave();
    }

    setPublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/publish`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.ok) {
        setPlaybook(data.playbook);
        setNeedsRepublish(false);
        alert(`${terms.playbook} published successfully!\n\nStats:\n- ${data.stats.measureSpecCount} MEASURE specs\n- ${data.stats.learnSpecCount} LEARN specs\n- ${data.stats.adaptSpecCount} ADAPT specs\n- ${data.stats.parameterCount} unique parameters`);
      } else {
        const errors = data.validationErrors?.map((e: any) => `- ${e.error}`).join("\n") || data.error;
        alert(`Failed to publish:\n${errors}`);
      }
    } catch (err: any) {
      alert("Error publishing: " + err.message);
    } finally {
      setPublishing(false);
    }
  };

  // Republish after system spec changes
  const handleRepublish = async () => {
    if (!confirm(`Republish this ${terms.playbook.toLowerCase()} with the updated system spec settings?`)) {
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/publish`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.ok) {
        setPlaybook(data.playbook);
        setNeedsRepublish(false);
        alert(`${terms.playbook} republished successfully with updated system specs!`);
      } else {
        const errors = data.validationErrors?.map((e: any) => `- ${e.error}`).join("\n") || data.error;
        alert(`Failed to republish:\n${errors}`);
      }
    } catch (err: any) {
      alert("Error republishing: " + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete this ${terms.playbook.toLowerCase()}? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/playbooks/${playbookId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        router.push(`${routePrefix}/playbooks`);
      } else {
        alert("Failed to delete: " + data.error);
      }
    } catch (err: any) {
      alert("Error deleting: " + err.message);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();

    if (draggedItem?.startsWith("palette-")) {
      // Dropping from palette - format is "palette-{type}-{uuid}"
      // Need to handle UUID which contains dashes
      const parts = draggedItem.split("-");
      const type = parts[1]; // "spec" or "template"
      const id = parts.slice(2).join("-"); // Rejoin the UUID parts
      addItemFromPalette(type, id, targetIndex);
    } else if (draggedItem) {
      // Reordering existing items
      const currentIndex = items.findIndex((item) => item.id === draggedItem);
      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        const newItems = [...items];
        const [removed] = newItems.splice(currentIndex, 1);
        newItems.splice(targetIndex, 0, removed);
        setItems(newItems);
        setHasChanges(true);
      }
    }

    setDraggedItem(null);
    setDragOverIndex(null);
  };

  const addItemFromPalette = async (type: string, id: string, index?: number) => {
    // Auto-unpublish if editing a published playbook
    if (playbook?.status === "PUBLISHED") {
      await autoUnpublish();
    }

    let newItem: PlaybookItem;

    if (type === "spec") {
      // Note: System specs are managed via column 3 toggles, not as playbook items
      // Note: Caller specs are auto-generated by learning system
      const allSpecs = availableItems?.domainSpecs || [];
      const spec = allSpecs.find((s) => s.id === id);
      if (!spec) return;

      // Check if already added
      if (items.some((item) => item.specId === id)) {
        alert(`This spec is already in the ${terms.playbook.toLowerCase()}`);
        return;
      }

      newItem = {
        id: `temp-${Date.now()}`,
        itemType: "SPEC",
        specId: id,
        promptTemplateId: null,
        spec: spec,
        promptTemplate: null,
        isEnabled: true,
        sortOrder: index ?? items.length,
      };
    } else if (type === "template") {
      const template = availableItems?.promptTemplates.find((t) => t.id === id);
      if (!template) return;

      // Check if already added
      if (items.some((item) => item.promptTemplateId === id)) {
        alert(`This template is already in the ${terms.playbook.toLowerCase()}`);
        return;
      }

      newItem = {
        id: `temp-${Date.now()}`,
        itemType: "PROMPT_TEMPLATE",
        specId: null,
        promptTemplateId: id,
        spec: null,
        promptTemplate: template,
        isEnabled: true,
        sortOrder: index ?? items.length,
      };
    } else {
      return;
    }

    const newItems = [...items];
    newItems.splice(index ?? items.length, 0, newItem);
    setItems(newItems);
    setHasChanges(true);
  };

  const removeItem = async (itemId: string) => {
    // Auto-unpublish if editing a published playbook
    if (playbook?.status === "PUBLISHED") {
      await autoUnpublish();
    }
    setItems(items.filter((item) => item.id !== itemId));
    setHasChanges(true);
  };

  const toggleItemEnabled = async (itemId: string) => {
    // Auto-unpublish if editing a published playbook
    if (playbook?.status === "PUBLISHED") {
      await autoUnpublish();
    }
    setItems(
      items.map((item) =>
        item.id === itemId ? { ...item, isEnabled: !item.isEnabled } : item
      )
    );
    setHasChanges(true);
  };

  const outputTypeBadge = (outputType: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      LEARN: { bg: "var(--badge-purple-bg)", color: "var(--badge-purple-text)" },
      MEASURE: { bg: "var(--status-success-bg)", color: "var(--status-success-text)" },
      MEASURE_AGENT: { bg: "var(--status-success-bg)", color: "var(--status-success-text)" },
      ADAPT: { bg: "var(--status-warning-bg)", color: "var(--status-warning-text)" },
      AGGREGATE: { bg: "var(--badge-blue-bg)", color: "var(--badge-blue-text)" },
      COMPOSE: { bg: "var(--badge-pink-bg)", color: "var(--badge-pink-text)" },
      REWARD: { bg: "var(--badge-yellow-bg)", color: "var(--badge-yellow-text)" },
      SUPERVISE: { bg: "var(--status-error-bg)", color: "var(--status-error-text)" },
    };
    const s = styles[outputType] || { bg: "var(--surface-secondary)", color: "var(--text-muted)" };
    return (
      <span className="hf-micro-badge" style={{ background: s.bg, color: s.color }}>
        {outputType}
      </span>
    );
  };

  // Removed old specRoleBadge - now using SpecRoleBadge component from @/components/shared/SpecRoleBadge

  const scopeBadge = (scope: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      CALLER: { bg: "var(--badge-blue-bg)", color: "var(--status-info-text)" }, // Kept for display only (auto-generated)
      DOMAIN: { bg: "var(--badge-pink-bg)", color: "var(--badge-pink-text)" },
      SYSTEM: { bg: "var(--surface-secondary)", color: "var(--text-secondary)" },
    };
    const s = styles[scope] || styles.SYSTEM;
    return (
      <span className="hf-micro-badge-sm hf-text-500" style={{ background: s.bg, color: s.color }}>
        {scope}
      </span>
    );
  };

  const specTypeBadge = (specType?: string) => {
    if (!specType) return null;
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      SYSTEM: { bg: "var(--surface-secondary)", color: "var(--text-secondary)", label: "SYS" },
      DOMAIN: { bg: "var(--badge-pink-bg)", color: "var(--badge-pink-text)", label: "DOM" },
    };
    const s = styles[specType] || styles.DOMAIN;
    return (
      <span className="hf-micro-badge-sm" style={{ background: s.bg, color: s.color }}>
        {s.label}
      </span>
    );
  };

  // Derive pipeline phase from spec's outputType and specRole
  const getPhase = (item: PlaybookItem): "COMPOSE" | "OBSERVE" | "EVALUATE" => {
    if (item.promptTemplate) return "COMPOSE";
    if (!item.spec) return "COMPOSE";

    const { specRole, outputType } = item.spec;

    // COMPOSE specs define prompt sections (WHO/WHAT/CALLER)
    if (specRole === "IDENTITY" || specRole === "CONTENT") return "COMPOSE";
    if (outputType === "COMPOSE") return "COMPOSE";

    // LEARN and MEASURE observe/extract data from calls
    if (outputType === "LEARN" || outputType === "MEASURE" || outputType === "MEASURE_AGENT" || outputType === "AGGREGATE") return "OBSERVE";

    // ADAPT, REWARD, SUPERVISE evaluate and adjust
    if (outputType === "ADAPT" || outputType === "REWARD" || outputType === "SUPERVISE") return "EVALUATE";

    return "OBSERVE"; // Default
  };

  // Filter out SYSTEM scope specs - they're managed via System Specs column
  const domainItems = items.filter(item => item.spec?.scope !== "SYSTEM");

  // Split domain items by column category (AGENT / CALLER / CONTENT)
  // Filters must be mutually exclusive to avoid duplicate keys

  // AGENT: Who the AI is (IDENTITY + VOICE specs)
  const agentItems = domainItems.filter(item =>
    item.spec?.specRole === "IDENTITY" || item.spec?.specRole === "VOICE"
  );

  // CONTENT: What the AI knows/teaches
  const contentItems = domainItems.filter(item => item.spec?.specRole === "CONTENT");

  // CALLER: Understanding the caller (EXTRACT, SYNTHESISE, CONSTRAIN specs + old deprecated roles)
  // Exclude items already in AGENT or CONTENT to ensure no duplicates
  const agentItemIds = new Set(agentItems.map(i => i.id));
  const contentItemIds = new Set(contentItems.map(i => i.id));
  const callerItems = domainItems.filter(item =>
    !agentItemIds.has(item.id) &&
    !contentItemIds.has(item.id) &&
    (item.spec?.specRole === "EXTRACT" ||
     item.spec?.specRole === "SYNTHESISE" ||
     item.spec?.specRole === "CONSTRAIN" ||
     item.spec?.specRole === "MEASURE" ||  // deprecated
     item.spec?.specRole === "ADAPT" ||     // deprecated
     item.spec?.specRole === "REWARD" ||    // deprecated
     item.spec?.specRole === "GUARDRAIL" || // deprecated
     item.spec?.outputType === "LEARN" ||
     item.spec?.outputType === "MEASURE" ||
     item.spec?.outputType === "MEASURE_AGENT" ||
     item.spec?.outputType === "AGGREGATE" ||
     item.spec?.outputType === "REWARD" ||
     item.spec?.outputType === "SUPERVISE" ||
     item.spec?.outputType === "COMPOSE")
  );

  // Helper to filter specs by search term
  const matchesSpecSearch = (spec: { name: string; slug: string; description?: string | null }) => {
    if (!specSearch) return true;
    const term = specSearch.toLowerCase();
    return (
      spec.name.toLowerCase().includes(term) ||
      spec.slug.toLowerCase().includes(term) ||
      (spec.description?.toLowerCase().includes(term) ?? false)
    );
  };

  // Available specs filtered by category for palette
  const availableAgentSpecs = availableItems?.domainSpecs.filter(s =>
    s.specRole === "IDENTITY" || s.specRole === "VOICE"
  ) || [];
  const availableCallerSpecs = availableItems?.domainSpecs.filter(s =>
    s.specRole === "EXTRACT" ||
    s.specRole === "SYNTHESISE" ||
    s.specRole === "CONSTRAIN" ||
    s.specRole === "MEASURE" ||      // deprecated
    s.specRole === "ADAPT" ||        // deprecated
    s.specRole === "REWARD" ||       // deprecated
    s.specRole === "GUARDRAIL" ||    // deprecated
    s.outputType === "LEARN" ||
    s.outputType === "MEASURE" ||
    s.outputType === "MEASURE_AGENT" ||
    s.outputType === "AGGREGATE" ||
    s.outputType === "REWARD" ||
    s.outputType === "SUPERVISE" ||
    s.outputType === "COMPOSE"
  ) || [];
  const availableContentSpecs = availableItems?.domainSpecs.filter(s => s.specRole === "CONTENT") || [];

  // TypePickerDialog categories and items
  const pickerCategories: PickerCategory[] = [
    { key: "agent", label: "Agent / Identity", color: "var(--status-info-text)" },
    { key: "caller", label: "Caller / Understanding", color: "var(--status-warning-text)" },
    { key: "content", label: "Content", color: "var(--status-success-text)" },
  ];
  const pickerItems: PickerItem[] = [
    ...availableAgentSpecs.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ? (s.description.length > 80 ? s.description.slice(0, 80) + "..." : s.description) : undefined,
      category: "agent",
      meta: s.specRole,
      disabled: items.some((i) => i.specId === s.id),
      disabledReason: `Already in ${terms.playbook.toLowerCase()}`,
    })),
    ...availableCallerSpecs.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ? (s.description.length > 80 ? s.description.slice(0, 80) + "..." : s.description) : undefined,
      category: "caller",
      meta: s.specRole,
      disabled: items.some((i) => i.specId === s.id),
      disabledReason: `Already in ${terms.playbook.toLowerCase()}`,
    })),
    ...availableContentSpecs.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ? (s.description.length > 80 ? s.description.slice(0, 80) + "..." : s.description) : undefined,
      category: "content",
      meta: s.specRole,
      disabled: items.some((i) => i.specId === s.id),
      disabledReason: `Already in ${terms.playbook.toLowerCase()}`,
    })),
  ];

  const openPicker = (category: "agent" | "caller" | "content") => {
    setPickerDefaultCategory(category);
    setPickerOpen(true);
  };

  const handlePickerSelect = (item: PickerItem) => {
    addItemFromPalette("spec", item.id);
  };

  // Enabled system specs that belong in each column (read-only references)
  const systemAgentSpecs = (availableItems?.systemSpecs || []).filter(s =>
    (s.specRole === "IDENTITY" || s.specRole === "VOICE") && systemSpecToggles.get(s.id) !== false
  );
  const systemCallerSpecs = (availableItems?.systemSpecs || []).filter(s =>
    (s.specRole === "EXTRACT" || s.specRole === "SYNTHESISE" || s.specRole === "CONSTRAIN" ||
     s.specRole === "MEASURE" || s.specRole === "ADAPT" || s.specRole === "REWARD" || s.specRole === "GUARDRAIL" ||  // deprecated
     s.outputType === "LEARN" || s.outputType === "MEASURE" || s.outputType === "MEASURE_AGENT" || s.outputType === "AGGREGATE" ||
     s.outputType === "REWARD" || s.outputType === "SUPERVISE") && systemSpecToggles.get(s.id) !== false
  );
  const systemContentSpecs = (availableItems?.systemSpecs || []).filter(s =>
    s.specRole === "CONTENT" && systemSpecToggles.get(s.id) !== false
  );

  // Legacy aliases for backward compatibility
  const identityItems = agentItems;
  const availableIdentitySpecs = availableAgentSpecs;

  // Group items by pipeline phase for display
  const groupedByPhase = domainItems.reduce((acc, item) => {
    const phase = getPhase(item);
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(item);
    return acc;
  }, {} as Record<string, PlaybookItem[]>);

  const phaseOrder = ["COMPOSE", "OBSERVE", "EVALUATE"] as const;
  const phaseConfig: Record<string, { label: string; icon: string; description: string; bg: string; border: string }> = {
    COMPOSE: {
      label: "Identity & Content",
      icon: "✍️",
      description: "WHO the agent is, WHAT it knows",
      bg: "var(--badge-purple-bg)",
      border: "var(--badge-purple-text)"
    },
    OBSERVE: {
      label: "Observe",
      icon: "👁️",
      description: "Measure caller, extract memories, score agent",
      bg: "var(--status-success-bg)",
      border: "var(--status-success-border)"
    },
    EVALUATE: {
      label: "Evaluate",
      icon: "⚖️",
      description: "Compute targets, rewards, profiles",
      bg: "var(--status-warning-bg)",
      border: "var(--status-warning-border)"
    },
  };

  // Legacy: keep specType grouping for backward compatibility
  const groupedItems = items.reduce((acc, item) => {
    const specType = item.spec?.specType || "DOMAIN";
    if (!acc[specType]) acc[specType] = [];
    acc[specType].push(item);
    return acc;
  }, {} as Record<string, PlaybookItem[]>);

  const specTypeOrder = ["SYSTEM", "DOMAIN"];
  const specTypeLabels: Record<string, string> = {
    SYSTEM: "System (Always Run)",
    DOMAIN: `${terms.domain} (From ${terms.playbook})`,
  };

  // Helper: Infer field type from value for config override modal
  const inferFieldType = (value: any): "boolean" | "number" | "string" | "object" | "array" => {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object" && value !== null) return "object";
    return "string";
  };

  // ConfigField component - renders appropriate control based on type
  const ConfigField = ({
    fieldKey,
    defaultValue,
    currentValue,
    isOverridden,
    type,
    onChange,
    onReset,
  }: {
    fieldKey: string;
    defaultValue: any;
    currentValue: any;
    isOverridden: boolean;
    type: "boolean" | "number" | "string" | "object" | "array";
    onChange: (value: any) => void;
    onReset: () => void;
  }) => {
    const label = fieldKey
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase());

    return (
      <div className={`hf-config-field ${isOverridden ? "hf-config-field-overridden" : ""}`}>
        <div className="hf-flex-between hf-mb-sm">
          <div className="hf-flex hf-gap-sm">
            <span className="hf-text-sm hf-text-bold hf-text-primary">
              {label}
            </span>
            {isOverridden && (
              <span className="hf-micro-badge hf-badge-warning hf-text-bold">
                OVERRIDDEN
              </span>
            )}
          </div>
          {isOverridden && (
            <button
              onClick={onReset}
              className="hf-btn-reset-tiny"
              title={`Reset to default: ${JSON.stringify(defaultValue)}`}
            >
              Reset
            </button>
          )}
        </div>

        {type === "boolean" && (
          <button
            onClick={() => onChange(!currentValue)}
            className={`hf-toggle ${currentValue ? "hf-toggle-on" : "hf-toggle-off"}`}
            style={{ width: 48, height: 26, borderRadius: 13 }}
          >
            <span className="hf-toggle-knob" style={{ top: 3, left: currentValue ? 25 : 3, width: 20, height: 20 }} />
          </button>
        )}

        {type === "number" && (
          <input
            type="number"
            value={currentValue}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="hf-input hf-text-sm"
          />
        )}

        {type === "string" && (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => onChange(e.target.value)}
            className="hf-input hf-text-sm"
          />
        )}

        {(type === "object" || type === "array") && (
          <textarea
            value={JSON.stringify(currentValue, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onChange(parsed);
              } catch {
                // Ignore invalid JSON while typing
              }
            }}
            rows={4}
            className="hf-textarea hf-mono"
          />
        )}

        <div className="hf-text-xs hf-text-muted hf-mt-sm">
          Default: {JSON.stringify(defaultValue)}
        </div>
      </div>
    );
  };

  // ConfigOverrideModal - modal for editing spec config overrides
  const ConfigOverrideModal = ({
    spec,
    currentOverride,
    onSave,
    onClose,
  }: {
    spec: Spec;
    currentOverride: Record<string, any> | null;
    onSave: (override: Record<string, any> | null) => void;
    onClose: () => void;
  }) => {
    const defaultConfig = (spec.config || {}) as Record<string, any>;
    const [localOverride, setLocalOverride] = useState<Record<string, any>>(
      currentOverride || {}
    );

    // Determine field types from default config
    const fields = Object.entries(defaultConfig).map(([key, defaultValue]) => ({
      key,
      defaultValue,
      overrideValue: localOverride[key],
      isOverridden: key in localOverride,
      type: inferFieldType(defaultValue),
    }));

    const handleFieldChange = (key: string, value: any) => {
      setLocalOverride((prev) => ({ ...prev, [key]: value }));
    };

    const handleResetField = (key: string) => {
      setLocalOverride((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };

    const handleResetAll = () => {
      setLocalOverride({});
    };

    const handleSave = () => {
      const cleanOverride = Object.keys(localOverride).length > 0 ? localOverride : null;
      onSave(cleanOverride);
    };

    const hasChanges = Object.keys(localOverride).length > 0;

    return (
      <div
        className="hf-modal-overlay"
        onClick={onClose}
      >
        <div
          className="hf-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="hf-modal-header">
            <div>
              <h3 className="hf-heading-lg">
                Configure: {spec.name}
              </h3>
              <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                Override default config values for this playbook
              </p>
            </div>
            {hasChanges && (
              <button
                onClick={handleResetAll}
                className="hf-btn hf-btn-secondary hf-btn-xs"
              >
                Reset All
              </button>
            )}
          </div>

          {/* Body - scrollable */}
          <div className="hf-modal-body">
            {fields.length === 0 ? (
              <div className="hf-text-center hf-text-muted hf-p-lg">
                This spec has no configurable options.
              </div>
            ) : (
              <div className="hf-flex-col hf-gap-md">
                {fields.map((field) => (
                  <ConfigField
                    key={field.key}
                    fieldKey={field.key}
                    defaultValue={field.defaultValue}
                    currentValue={field.overrideValue ?? field.defaultValue}
                    isOverridden={field.isOverridden}
                    type={field.type}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    onReset={() => handleResetField(field.key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="hf-modal-footer">
            <button
              onClick={onClose}
              className="hf-btn hf-btn-secondary hf-btn-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="hf-btn hf-btn-primary hf-btn-sm"
            >
              Save Overrides
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="hf-p-lg"><p className="hf-text-muted">Loading playbook...</p></div>;
  }

  if (error || !playbook) {
    return (
      <div className="hf-p-lg">
        <p className="hf-text-error">Error: {error || `${terms.playbook} not found`}</p>
        <Link href={`${routePrefix}/playbooks`} className="hf-link-accent">Back to {plural("playbook")}</Link>
      </div>
    );
  }

  // Always allow editing - auto-unpublish happens on first edit
  const isEditable = true;

  // Check for any unsaved changes across all sections
  const hasUnsavedChanges = pendingTargetChanges.size > 0 || pendingConfigCount > 0 || hasChanges;

  return (
    <div className="hf-p-lg" style={{ position: "relative" }}>
      {/* Subtle amber overlay when there are unsaved changes */}
      {hasUnsavedChanges && (
        <>
          {/* Background tint */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "linear-gradient(180deg, rgba(251, 191, 36, 0.02) 0%, rgba(245, 158, 11, 0.04) 100%)",
              pointerEvents: "none",
              zIndex: 0,
              transition: "opacity 0.3s ease-in-out",
            }}
          />
          {/* Top edge glow */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, transparent 0%, rgba(251, 191, 36, 0.6) 50%, transparent 100%)",
              pointerEvents: "none",
              zIndex: 9999,
              boxShadow: "0 0 20px rgba(251, 191, 36, 0.3), 0 0 40px rgba(245, 158, 11, 0.15)",
            }}
          />
        </>
      )}
      <SourcePageHeader
        title={
          <EditableTitle
            value={playbook.name}
            as="span"
            disabled={playbook.status === "PUBLISHED"}
            onSave={async (newName) => {
              const res = await fetch(`/api/playbooks/${playbookId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName }),
              });
              const data = await res.json();
              if (!data.ok) throw new Error(data.error);
              setPlaybook((prev: any) => prev ? { ...prev, name: newName } : prev);
            }}
          />
        }
        description={`${playbook.domain.name} — v${playbook.version}`}
        dataNodeId="playbooks"
        actions={
          <div className="hf-flex hf-gap-sm">
            <span
              className={`hf-badge ${playbook.status === "PUBLISHED" ? "hf-badge-success" : playbook.status === "DRAFT" ? "hf-badge-warning" : "hf-badge-muted"}`}
            >
              {playbook.status}
            </span>
            {isEditable && (
              <>
                <button
                  onClick={handleDelete}
                  className="hf-btn hf-btn-destructive"
                >
                  Delete
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className={`hf-btn ${hasChanges ? "hf-btn-primary" : ""}`}
                  style={!hasChanges ? { background: "var(--border-default)", color: "var(--text-placeholder)" } : undefined}
                >
                  {saving ? "Saving..." : hasChanges ? "Save Changes" : "Saved"}
                </button>
                <button
                  onClick={handleCompileTargets}
                  disabled={compilingTargets || items.length === 0}
                  className="hf-btn"
                  style={{
                    background: "var(--badge-purple-text)",
                    color: "white",
                    opacity: items.length === 0 ? 0.5 : 1,
                  }}
                >
                  {compilingTargets ? "Compiling..." : "Compile Targets"}
                </button>
                {/* Only show Publish when in DRAFT - for PUBLISHED, user edits first (auto-unpublishes) */}
                {playbook.status === "DRAFT" && (
                  <button
                    onClick={handlePublish}
                    disabled={publishing || items.length === 0}
                    className="hf-btn"
                    style={{
                      background: "var(--status-success-text)",
                      color: "white",
                      opacity: items.length === 0 ? 0.5 : 1,
                    }}
                  >
                    {publishing ? "Publishing..." : "Publish"}
                  </button>
                )}
              </>
            )}
          </div>
        }
      />

      {/* Unpublished changes banner */}
      {playbook.status === "DRAFT" && playbook.publishedAt && (
        <div className="hf-banner hf-banner-warning hf-flex-between hf-mt-md">
          <span className="hf-text-warning hf-text-bold">
            ⚠️ Unpublished changes. Callers are using the last published version.
          </span>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="hf-btn hf-btn-primary"
          >
            {publishing ? "Publishing..." : "Publish Now"}
          </button>
        </div>
      )}

      {/* Tab Navigation - Draggable with localStorage persistence */}
      {/* TODO [AUTH]: Tab order is stored in localStorage. Migrate to user preferences API when auth is added. */}
      <DraggableTabs
        storageKey="playbook-builder-tabs"
        tabs={[
          { id: "grid", label: "Specs", icon: <ClipboardList size={14} />, count: items.length, title: "4-column grid view of all specs" },
          { id: "explorer", label: "Explorer", icon: <Layers size={14} />, title: "Browse specs with tree navigation and inline toggles" },
          { id: "targets", label: "Targets", icon: <Target size={14} />, count: targetsData?.counts.total ?? null, title: `Configure ${terms.playbook.toLowerCase()} targets and thresholds` },
          { id: "slugs", label: "Slugs", icon: <GitBranch size={14} />, count: slugsData?.counts.total ?? null, title: `URL slug mappings for ${terms.playbook.toLowerCase()} routing` },
          { id: "parameters", label: "Parameters", icon: <Settings size={14} />, count: parametersData?.counts.parameters ?? null, title: "Parameter definitions and configuration" },
          { id: "triggers", label: "Triggers", icon: <Zap size={14} />, count: triggersData?.counts.triggers ?? null, title: "Trigger configurations and rules" },
          { id: "visualizer", label: "Visualizer", icon: <Orbit size={14} />, title: `Interactive graph visualization of ${terms.playbook.toLowerCase()} structure` },
          { id: "roster", label: "Roster", icon: <Users size={14} />, count: rosterCount, title: "Enrolled callers (class roster)" },
        ]}
        activeTab={activeTab}
        onTabChange={(tabId) => setActiveTab(tabId as typeof activeTab)}
        containerStyle={{ marginTop: 16 }}
      />

      {/* Tab Content */}
      {activeTab === "grid" && (
      <>
      {/* Spec Search */}
      <div className="hf-mt-md hf-mb-sm">
        <div style={{ position: "relative", maxWidth: 400 }}>
          <span className="hf-text-muted hf-text-md" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>🔍</span>
          <input
            type="text"
            placeholder="Search specs..."
            value={specSearch}
            onChange={(e) => setSpecSearch(e.target.value)}
            className="hf-input hf-text-sm"
            style={{ paddingLeft: 36 }}
          />
          {specSearch && (
            <button
              onClick={() => setSpecSearch("")}
              className="hf-btn-reset-tiny"
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", margin: 0 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: systemColumnCollapsed ? "40px 1fr 1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 16, marginTop: 8, height: "calc(100vh - 270px)" }}>
        {/* Column 1: System Specs (always run) */}
        <div style={{ height: "100%", overflowY: "auto", ...(systemColumnCollapsed ? { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 } : {}) }}>
          {systemColumnCollapsed ? (
            <button
              onClick={() => setSystemColumnCollapsed(false)}
              title="Expand System Specs"
              className="hf-btn hf-btn-secondary hf-text-xs hf-text-bold hf-text-muted"
              style={{
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                padding: "12px 4px",
                letterSpacing: "0.05em",
              }}
            >
              ⚙️ System
            </button>
          ) : (
          <>
          <div className="hf-col-header">
            <div>
              <h3 className="hf-flex hf-gap-sm hf-heading-lg">
                <span>⚙️</span> System Specs
                {needsRepublish && (
                  <span className="hf-micro-badge hf-text-bold" style={{ background: "var(--status-warning-bg)", color: "var(--status-warning-text)" }}>
                    Needs Republish
                  </span>
                )}
              </h3>
              <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                Platform-managed. Always runs.
              </p>
            </div>
            <div className="hf-flex hf-gap-sm">
              {systemSpecsHaveChanges && (
                <button
                  onClick={handleSaveSystemSpecs}
                  disabled={savingSystemSpecs}
                  className="hf-btn"
                  style={{ background: "var(--status-success-text)", color: "white", opacity: savingSystemSpecs ? 0.7 : 1 }}
                >
                  {savingSystemSpecs ? "Saving..." : "Save"}
                </button>
              )}
              {needsRepublish && !systemSpecsHaveChanges && (
                <button
                  onClick={handleRepublish}
                  disabled={publishing}
                  className="hf-btn"
                  style={{ background: "var(--status-warning-text)", color: "white", opacity: publishing ? 0.7 : 1 }}
                >
                  {publishing ? "Republishing..." : "Republish"}
                </button>
              )}
              <button
                onClick={() => setSystemColumnCollapsed(true)}
                title="Collapse System Specs column"
                className="hf-btn-icon hf-btn-xs"
              >
                ‹
              </button>
            </div>
          </div>

          {availableItems?.systemSpecs && availableItems.systemSpecs.length > 0 ? (
            <div className="hf-card-compact" style={{ background: "var(--status-success-bg)", border: "1px solid var(--status-success-border)" }}>
              {/* Group specs by specRole (category) */}
              {(() => {
                const filteredSystemSpecs = availableItems.systemSpecs.filter(matchesSpecSearch);
                const grouped = new Map<string, Spec[]>();
                for (const spec of filteredSystemSpecs) {
                  const group = spec.specRole || "MEASURE";
                  if (!grouped.has(group)) grouped.set(group, []);
                  grouped.get(group)!.push(spec);
                }

                // Category order and labels (new + deprecated roles)
                const specRoleOrder = ["ORCHESTRATE", "IDENTITY", "CONTENT", "VOICE", "EXTRACT", "SYNTHESISE", "CONSTRAIN", "OBSERVE", "MEASURE", "ADAPT", "GUARDRAIL", "REWARD", "BOOTSTRAP"];
                const specRoleLabels: Record<string, string> = {
                  // New taxonomy
                  ORCHESTRATE: "🎯 ORCHESTRATE (Flow Control)",
                  EXTRACT: "🔍 EXTRACT (Measurement)",
                  SYNTHESISE: "🧮 SYNTHESISE (Transform)",
                  CONSTRAIN: "📏 CONSTRAIN (Guardrails)",
                  OBSERVE: "📡 OBSERVE (Metrics & Health)",
                  IDENTITY: "👤 IDENTITY (Who)",
                  CONTENT: "📚 CONTENT (Curriculum)",
                  VOICE: "🎙️ VOICE (Speech)",
                  // Deprecated (backward compatibility)
                  MEASURE: "📊 MEASURE (deprecated → EXTRACT)",
                  ADAPT: "🎯 ADAPT (deprecated → SYNTHESISE)",
                  REWARD: "⭐ REWARD (deprecated → SYNTHESISE)",
                  GUARDRAIL: "🛡️ GUARDRAIL (deprecated → CONSTRAIN)",
                  BOOTSTRAP: "🔄 BOOTSTRAP (deprecated → ORCHESTRATE)",
                };
                const sortedGroups = Array.from(grouped.entries()).sort(
                  (a, b) => specRoleOrder.indexOf(a[0]) - specRoleOrder.indexOf(b[0])
                );

                if (filteredSystemSpecs.length === 0 && specSearch) {
                  return (
                    <div className="hf-empty hf-text-xs hf-text-muted hf-p-md">
                      No matching specs
                    </div>
                  );
                }

                return sortedGroups.map(([specRole, specs]) => (
                  <div key={specRole} className="hf-mb-md">
                    <div className="hf-spec-group-header">
                      {specRoleLabels[specRole] || specRole} ({specs.filter(s => s.isActive !== false && systemSpecToggles.get(s.id)).length}/{specs.filter(s => s.isActive !== false).length})
                    </div>
                    <div className="hf-flex-col" style={{ gap: 6 }}>
                      {specs.map((spec) => {
                        const isEnabled = systemSpecToggles.get(spec.id) ?? true;
                        const isGloballyActive = spec.isActive !== false;
                        const effectiveEnabled = isGloballyActive && isEnabled;
                        const specHasOverride = hasConfigOverride(spec.id);
                        const specHasConfig = spec.config && Object.keys(spec.config).length > 0;
                        return (
                          <div
                            key={spec.id}
                            className="hf-pb-item"
                            style={{
                              padding: "10px 12px",
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
                            <div className="hf-flex-between hf-items-start hf-gap-sm">
                              <div className="hf-flex-1" style={{ minWidth: 0 }}>
                                <div className="hf-flex-wrap hf-gap-xs hf-items-center" style={{ marginBottom: 2 }}>
                                  <SpecRoleBadge role={spec.specRole} size="sm" showIcon={false} />
                                  {!isGloballyActive && (
                                    <span className="hf-micro-badge-sm" style={{ background: "var(--button-destructive-bg)", color: "white", textTransform: "uppercase" }}>
                                      Inactive
                                    </span>
                                  )}
                                  <Link
                                    href={`${routePrefix}/specs/${spec.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="hf-text-bold hf-text-xs hf-truncate"
                                    style={{
                                      color: !isGloballyActive ? "var(--status-error-text)" : effectiveEnabled ? "var(--status-success-text)" : "var(--text-muted)",
                                      textDecoration: "none",
                                    }}
                                  >
                                    {spec.name}
                                  </Link>
                                </div>
                                {!isGloballyActive && (
                                  <div className="hf-text-xs hf-text-error hf-text-italic hf-mb-xs">
                                    Globally deactivated
                                  </div>
                                )}
                                {spec.description && (
                                  <div className="hf-text-xs hf-line-clamp-2" style={{ color: effectiveEnabled ? "var(--text-muted)" : "var(--text-placeholder)", lineHeight: 1.3 }}>
                                    {spec.description}
                                  </div>
                                )}
                              </div>
                              {/* Config gear icon + Toggle switch */}
                              {isGloballyActive && (
                                <div className="hf-flex" style={{ gap: 6 }}>
                                  {/* Gear icon for config - only show if spec has config */}
                                  {specHasConfig && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenConfigModal(spec);
                                      }}
                                      className="hf-btn-icon hf-flex-center"
                                      style={{
                                        width: 28,
                                        height: 28,
                                        border: specHasOverride ? "2px solid var(--status-warning-text)" : "1px solid var(--input-border)",
                                        background: specHasOverride ? "var(--status-warning-bg)" : "var(--surface-primary)",
                                        flexShrink: 0,
                                      }}
                                      title={specHasOverride ? "Config overridden - click to edit" : "Configure spec settings"}
                                    >
                                      <span className="hf-text-md">⚙️</span>
                                    </button>
                                  )}

                                  {/* Toggle switch */}
                                  <button
                                    onClick={() => handleToggleSystemSpec(spec.id)}
                                    className={`hf-toggle ${isEnabled ? "hf-toggle-on" : "hf-toggle-off"}`}
                                  >
                                    <div className="hf-toggle-knob" style={{ left: isEnabled ? 20 : 2 }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div className="hf-empty hf-p-lg hf-text-center">
              <p className="hf-text-muted hf-text-xs">No system specs available</p>
            </div>
          )}
          </>
          )}
        </div>

        {/* Column 2: Agent Specs (WHO the AI is) */}
        {(() => {
          const filteredSystemAgentSpecs = systemAgentSpecs.filter(matchesSpecSearch);
          const filteredAgentItems = agentItems.filter(item => item.spec && matchesSpecSearch(item.spec));
          return (
        <div className="hf-flex-col" style={{ height: "100%", overflowY: "auto" }}>
          <div className="hf-col-header">
            <div>
              <h3 className="hf-flex hf-gap-sm hf-heading-lg">
                <span>🤖</span> Agent Specs
                <span className="hf-micro-badge hf-badge-info">AGENT</span>
              </h3>
              <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                Who the AI is & how it speaks
              </p>
            </div>
            <div className="hf-flex hf-gap-xs">
              {filteredSystemAgentSpecs.length > 0 && (
                <button
                  onClick={() => setShowSystemInColumns(prev => ({ ...prev, agent: !prev.agent }))}
                  className="hf-btn-reset-tiny hf-text-muted hf-nowrap"
                  style={{ background: showSystemInColumns.agent ? "var(--surface-secondary)" : "var(--surface-primary)" }}
                  title={showSystemInColumns.agent ? "Hide system specs" : "Show system specs"}
                >
                  ⚙️ {showSystemInColumns.agent ? "Hide" : "Show"}
                </button>
              )}
              {isEditable && availableAgentSpecs.filter(s => !items.some(i => i.specId === s.id)).length > 0 && (
                <button
                  onClick={() => openPicker("agent")}
                  className="hf-btn-icon hf-flex-center"
                  style={{ width: 28, height: 28, borderColor: "var(--status-info-border)", color: "var(--status-info-text)" }}
                  title="Add spec"
                >
                  +
                </button>
              )}
            </div>
          </div>

          {/* Agent specs are now added via TypePickerDialog */}

          {/* System IDENTITY/VOICE specs shown as read-only references */}
          {showSystemInColumns.agent && filteredSystemAgentSpecs.length > 0 && (
            <div className="hf-flex-col hf-gap-xs" style={{ marginBottom: filteredAgentItems.length > 0 ? 8 : 0 }}>
              {filteredSystemAgentSpecs.map((spec) => (
                <div
                  key={spec.id}
                  className="hf-pb-system-ref"
                >
                  <div className="hf-flex" style={{ gap: 6 }}>
                    <span className="hf-text-xs" title="System spec">⚙️</span>
                    <SpecRoleBadge role={spec.specRole} size="sm" showIcon={false} />
                    <Link href={`${routePrefix}/specs/${spec.id}`} className="hf-text-bold hf-text-sm hf-text-primary hf-flex-1 hf-link-plain">{spec.name}</Link>
                  </div>
                  {spec.description && (
                    <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ lineHeight: 1.3 }}>
                      {spec.description.length > 80 ? spec.description.slice(0, 80) + "..." : spec.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {filteredAgentItems.length === 0 && (!showSystemInColumns.agent || filteredSystemAgentSpecs.length === 0) ? (
            <div className="hf-empty hf-text-center hf-p-lg" style={{ background: "var(--status-info-bg)", border: "2px dashed var(--status-info-border)" }}>
              <p className="hf-text-bold hf-mb-xs" style={{ color: "var(--status-info-text)" }}>{specSearch ? "No matching specs" : "No Agent Specs"}</p>
              <p className="hf-text-xs hf-text-muted">
                {specSearch ? "Try a different search term" : isEditable ? "Click specs above to define agent identity" : "No agent identity configured"}
              </p>
            </div>
          ) : filteredAgentItems.length > 0 ? (
            <div className="hf-flex-col hf-gap-sm">
              {filteredAgentItems.map((item) => {
                const index = items.indexOf(item);
                const isItemExpanded = expandedItems.has(item.id);
                const detail = item.specId ? specDetails.get(item.specId) : null;
                        const isLoading = loadingSpecId === item.specId;

                        return (
                          <div
                            key={item.id}
                            draggable={isEditable && !isItemExpanded}
                            onDragStart={(e) => !isItemExpanded && handleDragStart(e, item.id)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onMouseEnter={() => setHoveredItemId(item.id)}
                            onMouseLeave={() => setHoveredItemId(null)}
                            className="hf-pb-item"
                            style={{
                              background: dragOverIndex === index ? "var(--status-info-bg)" : isItemExpanded ? "var(--surface-secondary)" : "var(--surface-primary)",
                              border: isItemExpanded ? "2px solid var(--button-primary-bg)" : "1px solid var(--status-info-border)",
                              opacity: item.isEnabled ? 1 : 0.5,
                            }}
                          >
                            {/* Hover-reveal delete button */}
                            {isEditable && hoveredItemId === item.id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                                className="hf-delete-hover"
                                title={`Remove from ${terms.playbook.toLowerCase()}`}
                              >
                                ×
                              </button>
                            )}
                  {/* Header - always visible */}
                  <div
                    onClick={() => item.spec && toggleItemExpanded(item.id, item.specId)}
                    className="hf-flex hf-items-start"
                    style={{
                      padding: "10px 12px",
                      cursor: item.spec ? "pointer" : "default",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="hf-flex hf-gap-sm hf-items-start hf-flex-1">
                      {/* Expand/collapse indicator for specs */}
                      {item.spec && (
                        <span className="hf-text-xs hf-text-placeholder" style={{ minWidth: 16, marginTop: 1 }}>
                          {isItemExpanded ? "▼" : "▶"}
                        </span>
                      )}
                      {!item.spec && (
                        <span className="hf-text-xs hf-text-placeholder" style={{ minWidth: 16 }}>
                          {index + 1}.
                        </span>
                      )}
                      <div className="hf-flex-1" style={{ minWidth: 0 }}>
                        <div className="hf-flex-wrap hf-gap-xs hf-items-center" style={{ marginBottom: 2 }}>
                          {item.spec && (
                            <>
                              <SpecRoleBadge role={item.spec.specRole} size="sm" showIcon={false} />
                              {item.spec.scope === "SYSTEM" && (
                                <span className="hf-micro-badge-sm" style={{ background: "var(--surface-secondary)", color: "var(--text-muted)" }}>
                                  ⚙️
                                </span>
                              )}
                              <Link
                                href={`${routePrefix}/specs/${item.specId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hf-text-bold hf-text-xs hf-truncate hf-text-primary"
                                style={{ textDecoration: "none" }}
                              >
                                {item.spec.name}
                              </Link>
                            </>
                          )}
                          {item.promptTemplate && (
                            <>
                              <span className="hf-micro-badge hf-badge-warning">
                                TEMPLATE
                              </span>
                              <Link
                                href={`/prompt-templates?selected=${item.promptTemplate.id}`}
                                className="hf-text-bold hf-text-primary hf-link-plain"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {item.promptTemplate.name}
                                <span className="hf-text-xs hf-text-placeholder" style={{ marginLeft: 4 }}>→</span>
                              </Link>
                            </>
                          )}
                        </div>
                        {item.spec?.description && (
                          <p className="hf-text-xs hf-text-muted" style={{ margin: 0 }}>
                            {item.spec.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Actions - stop propagation to prevent expand/collapse */}
                    <div className="hf-flex hf-gap-sm" onClick={(e) => e.stopPropagation()}>
                      {item.spec && (
                        <Link
                          href={`/analysis-specs?scope=${item.spec.scope}&select=${item.spec.id}`}
                          className="hf-btn hf-btn-secondary hf-btn-xs hf-link-plain"
                        >
                          Edit →
                        </Link>
                      )}
                      {isEditable && (
                        <>
                          <button
                            onClick={() => toggleItemEnabled(item.id)}
                            className="hf-btn hf-btn-secondary hf-btn-xs"
                          >
                            {item.isEnabled ? "Disable" : "Enable"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isItemExpanded && item.spec && (
                    <div style={{ borderTop: "1px solid var(--border-default)", padding: 16, background: "var(--surface-primary)" }}>
                      {isLoading ? (
                        <div className="hf-text-center hf-p-lg hf-text-muted">
                          Loading spec details...
                        </div>
                      ) : detail?.triggers && detail.triggers.length > 0 ? (
                        <div>
                          {/* Triggers header */}
                          <div className="hf-flex-between hf-mb-md">
                            <span className="hf-category-label">
                              Triggers ({detail.triggers.length})
                            </span>
                            <div className="hf-flex hf-gap-xs">
                              <button
                                onClick={() => {
                                  const allTriggerIds = new Set(detail.triggers!.map(t => t.id));
                                  const allActionIds = new Set(detail.triggers!.flatMap(t => t.actions.map(a => a.id)));
                                  setExpandedTriggers(prev => new Set([...prev, ...allTriggerIds]));
                                  setExpandedActions(prev => new Set([...prev, ...allActionIds]));
                                }}
                                className="hf-btn-reset-tiny" style={{ marginTop: 0 }}
                              >
                                Expand All
                              </button>
                              <button
                                onClick={() => {
                                  const triggerIds = detail.triggers!.map(t => t.id);
                                  const actionIds = detail.triggers!.flatMap(t => t.actions.map(a => a.id));
                                  setExpandedTriggers(prev => {
                                    const next = new Set(prev);
                                    triggerIds.forEach(id => next.delete(id));
                                    return next;
                                  });
                                  setExpandedActions(prev => {
                                    const next = new Set(prev);
                                    actionIds.forEach(id => next.delete(id));
                                    return next;
                                  });
                                }}
                                className="hf-btn-reset-tiny" style={{ marginTop: 0 }}
                              >
                                Collapse All
                              </button>
                            </div>
                          </div>

                          {/* Triggers list */}
                          <div className="hf-flex-col hf-gap-md">
                            {detail.triggers.map((trigger, tIdx) => (
                              <div key={trigger.id} className="hf-card-compact" style={{ background: "var(--background)", padding: 0 }}>
                                {/* Trigger header */}
                                <div
                                  onClick={() => toggleTriggerExpanded(trigger.id)}
                                  className="hf-flex-between hf-p-md"
                                  style={{ cursor: "pointer" }}
                                >
                                  <div>
                                    <div className="hf-text-bold hf-text-sm hf-text-secondary">
                                      Trigger {tIdx + 1}: {trigger.name || "Unnamed"}
                                    </div>
                                    <div className="hf-text-xs hf-text-muted" style={{ marginTop: 2 }}>
                                      {trigger.actions.length} action{trigger.actions.length !== 1 ? "s" : ""}
                                    </div>
                                  </div>
                                  <span className="hf-text-xs hf-text-placeholder">
                                    {expandedTriggers.has(trigger.id) ? "▼" : "▶"}
                                  </span>
                                </div>

                                {/* Trigger expanded content */}
                                {expandedTriggers.has(trigger.id) && (
                                  <div style={{ borderTop: "1px solid var(--border-default)", padding: 12 }}>
                                    {/* Given/When/Then */}
                                    <div className="hf-mono hf-mb-md hf-p-sm" style={{ background: "var(--background)", borderRadius: 6 }}>
                                      <div className="hf-mb-xs">
                                        <span className="hf-text-bold" style={{ color: "var(--badge-purple-text)" }}>Given</span>{" "}
                                        <span>{trigger.given}</span>
                                      </div>
                                      <div className="hf-mb-xs">
                                        <span className="hf-text-bold" style={{ color: "var(--status-info-text)" }}>When</span>{" "}
                                        <span>{trigger.when}</span>
                                      </div>
                                      <div>
                                        <span className="hf-text-bold" style={{ color: "var(--status-success-text)" }}>Then</span>{" "}
                                        <span>{trigger.then}</span>
                                      </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="hf-flex-col hf-gap-sm">
                                      {trigger.actions.map((action, aIdx) => (
                                        <div key={action.id} className="hf-card-compact" style={{ background: "var(--surface-primary)", padding: 0 }}>
                                          {/* Action header */}
                                          <div
                                            onClick={() => toggleActionExpanded(action.id)}
                                            className="hf-flex-between hf-p-sm"
                                            style={{ cursor: "pointer" }}
                                          >
                                            <div className="hf-flex hf-gap-sm">
                                              <span className="hf-micro-badge" style={{
                                                background: detail.outputType === "LEARN" ? "var(--status-warning-bg)" : "var(--status-info-bg)",
                                                color: detail.outputType === "LEARN" ? "var(--status-warning-text)" : "var(--button-primary-bg)",
                                              }}>
                                                {detail.outputType === "LEARN" ? "EXT" : "AC"}{aIdx + 1}
                                              </span>
                                              <span className="hf-text-xs hf-text-bold hf-text-secondary">
                                                {action.description}
                                              </span>
                                            </div>
                                            <div className="hf-flex hf-gap-sm">
                                              {action.parameter && (
                                                <span className="hf-micro-badge hf-text-xxs" style={{ background: "var(--badge-purple-bg)", color: "var(--badge-purple-text)" }}>
                                                  {action.parameter.parameterId}
                                                </span>
                                              )}
                                              {action.learnCategory && (
                                                <span className="hf-micro-badge" style={{ background: "var(--status-warning-bg)", color: "var(--status-warning-text)" }}>
                                                  {action.learnCategory}
                                                </span>
                                              )}
                                              <span className="hf-text-xs hf-text-placeholder">
                                                {expandedActions.has(action.id) ? "▼" : "▶"}
                                              </span>
                                            </div>
                                          </div>

                                          {/* Action expanded content */}
                                          {expandedActions.has(action.id) && (
                                            <div className="hf-p-sm" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                                              {/* MEASURE: Show parameter + anchors */}
                                              {detail.outputType === "MEASURE" && action.parameter && (
                                                <>
                                                  <div className="hf-card-compact hf-text-xs hf-mb-sm" style={{ background: "var(--badge-purple-bg)" }}>
                                                    <div className="hf-text-bold" style={{ color: "var(--badge-purple-text)" }}>
                                                      Parameter: {action.parameter.name}
                                                    </div>
                                                    {action.parameter.definition && (
                                                      <div className="hf-text-muted hf-mt-xs">
                                                        {action.parameter.definition}
                                                      </div>
                                                    )}
                                                    <div className="hf-flex hf-gap-lg hf-text-xs hf-mt-sm">
                                                      {action.parameter.interpretationHigh && (
                                                        <div>
                                                          <span className="hf-text-bold" style={{ color: "var(--status-success-text)" }}>High:</span>{" "}
                                                          <span className="hf-text-muted">{action.parameter.interpretationHigh}</span>
                                                        </div>
                                                      )}
                                                      {action.parameter.interpretationLow && (
                                                        <div>
                                                          <span className="hf-text-bold" style={{ color: "var(--status-error-text)" }}>Low:</span>{" "}
                                                          <span className="hf-text-muted">{action.parameter.interpretationLow}</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>

                                                  {/* Scoring Anchors */}
                                                  {action.parameter.scoringAnchors && action.parameter.scoringAnchors.length > 0 && (
                                                    <div>
                                                      <div className="hf-spec-group-header">
                                                        Scoring Anchors ({action.parameter.scoringAnchors.length})
                                                      </div>
                                                      <div className="hf-flex-col hf-gap-xs">
                                                        {action.parameter.scoringAnchors.map((anchor) => (
                                                          <div key={anchor.id} className="hf-p-sm hf-text-xs" style={{ background: "var(--background)", borderRadius: 4 }}>
                                                            <div className="hf-flex hf-gap-xs">
                                                              <span className="hf-micro-badge hf-text-bold" style={{
                                                                background: anchor.score >= 0.7 ? "var(--status-success-bg)" : anchor.score <= 0.3 ? "var(--status-error-bg)" : "var(--status-warning-bg)",
                                                                color: anchor.score >= 0.7 ? "var(--status-success-text)" : anchor.score <= 0.3 ? "var(--status-error-text)" : "var(--status-warning-text)",
                                                              }}>
                                                                {(anchor.score * 100).toFixed(0)}%{anchor.isGold && " ⭐"}
                                                              </span>
                                                              <span className="hf-text-secondary hf-text-italic">"{anchor.example}"</span>
                                                            </div>
                                                            {anchor.rationale && (
                                                              <div className="hf-text-xs hf-text-muted hf-mt-xs">
                                                                {anchor.rationale}
                                                              </div>
                                                            )}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>
                                                  )}
                                                </>
                                              )}

                                              {/* LEARN: Show learn config */}
                                              {detail.outputType === "LEARN" && (
                                                <div className="hf-card-compact hf-text-xs" style={{ background: "var(--status-warning-bg)" }}>
                                                  <div className="hf-text-bold hf-text-warning">
                                                    Learns to: {action.learnCategory || "Not configured"}
                                                  </div>
                                                  {action.learnKeyPrefix && (
                                                    <div className="hf-mt-xs hf-text-warning">
                                                      Key prefix: <code className="hf-micro-badge-sm hf-badge-warning">{action.learnKeyPrefix}</code>
                                                    </div>
                                                  )}
                                                  {action.learnKeyHint && (
                                                    <div className="hf-mt-xs hf-text-warning">
                                                      Hint: {action.learnKeyHint}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="hf-empty hf-text-center hf-p-md hf-text-placeholder hf-text-sm">
                          No triggers configured for this spec.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Drop zone at end */}
              {isEditable && (
                <div
                  onDragOver={(e) => handleDragOver(e, items.length)}
                  onDrop={(e) => handleDrop(e, items.length)}
                  className="hf-empty hf-text-center hf-text-xs hf-text-placeholder hf-p-md"
                  style={{
                    background: dragOverIndex === items.length ? "var(--status-info-bg)" : "transparent",
                    transition: "background 0.15s",
                  }}
                >
                  Drop here to add at end
                </div>
              )}
            </div>
          ) : null}
        </div>
          );
        })()}

        {/* Column 3: Caller Specs (Understanding the caller) */}
        {(() => {
          const filteredSystemCallerSpecs = systemCallerSpecs.filter(matchesSpecSearch);
          const filteredCallerItems = callerItems.filter(item => item.spec && matchesSpecSearch(item.spec));
          return (
        <div className="hf-flex-col" style={{ height: "100%", overflowY: "auto" }}>
          <div className="hf-col-header">
            <div>
              <h3 className="hf-flex hf-gap-sm hf-heading-lg">
                <span>👤</span> Caller Specs
                <span className="hf-micro-badge hf-badge-warning">CALLER</span>
              </h3>
              <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                Understanding & adapting to the caller
              </p>
            </div>
            <div className="hf-flex hf-gap-xs">
              {filteredSystemCallerSpecs.length > 0 && (
                <button
                  onClick={() => setShowSystemInColumns(prev => ({ ...prev, caller: !prev.caller }))}
                  className="hf-btn-reset-tiny hf-text-muted"
                  style={{ background: showSystemInColumns.caller ? "var(--surface-secondary)" : "var(--surface-primary)" }}
                  title={showSystemInColumns.caller ? "Hide system specs" : "Show system specs"}
                >
                  ⚙️ {showSystemInColumns.caller ? "Hide" : "Show"}
                </button>
              )}
              {isEditable && availableCallerSpecs.filter(s => !items.some(i => i.specId === s.id)).length > 0 && (
                <button
                  onClick={() => openPicker("caller")}
                  className="hf-btn-icon hf-flex-center"
                  style={{ width: 28, height: 28, borderColor: "var(--status-warning-border)", color: "var(--status-warning-text)" }}
                title="Add spec"
              >
                +
              </button>
            )}
            </div>
          </div>

          {/* Caller specs are now added via TypePickerDialog */}

          {/* System CALLER specs shown as read-only references */}
          {showSystemInColumns.caller && filteredSystemCallerSpecs.length > 0 && (
            <div className="hf-flex-col hf-gap-xs" style={{ marginBottom: filteredCallerItems.length > 0 ? 8 : 0 }}>
              {filteredSystemCallerSpecs.map((spec) => (
                <div
                  key={spec.id}
                  className="hf-pb-system-ref"
                >
                  <div className="hf-flex" style={{ gap: 6 }}>
                    <span className="hf-text-xs" title="System spec">⚙️</span>
                    {outputTypeBadge(spec.outputType)}
                    <Link href={`${routePrefix}/specs?id=${spec.id}`} className="hf-text-bold hf-text-sm hf-text-primary hf-flex-1 hf-link-plain">{spec.name}</Link>
                  </div>
                  {spec.description && (
                    <p className="hf-text-xs hf-text-muted hf-mt-xs" style={{ lineHeight: 1.3 }}>
                      {spec.description.length > 80 ? spec.description.slice(0, 80) + "..." : spec.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {filteredCallerItems.length === 0 && (!showSystemInColumns.caller || filteredSystemCallerSpecs.length === 0) ? (
            <div className="hf-empty hf-text-center hf-p-lg" style={{ background: "var(--status-warning-bg)", border: "2px dashed var(--status-warning-border)" }}>
              <p className="hf-text-bold hf-mb-xs" style={{ color: "var(--status-warning-text)" }}>{specSearch ? "No matching specs" : "No Caller Specs"}</p>
              <p className="hf-text-xs hf-text-muted">
                {specSearch ? "Try a different search term" : isEditable ? "Click specs above to add caller analysis" : "No caller analysis configured"}
              </p>
            </div>
          ) : filteredCallerItems.length > 0 ? (
            <div className="hf-flex-col hf-gap-sm">
              {filteredCallerItems.map((item) => {
                const isItemExpanded = expandedItems.has(item.id);
                const detail = item.specId ? specDetails.get(item.specId) : null;
                return (
                  <div
                    key={item.id}
                    onMouseEnter={() => setHoveredItemId(item.id)}
                    onMouseLeave={() => setHoveredItemId(null)}
                    className="hf-pb-item"
                    style={{
                      background: "var(--surface-primary)",
                      border: isItemExpanded ? "2px solid var(--status-warning-text)" : "1px solid var(--status-warning-border)",
                    }}
                  >
                    {/* Hover-reveal delete button */}
                    {isEditable && hoveredItemId === item.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                        className="hf-delete-hover"
                        title="Remove from playbook"
                      >
                        ×
                      </button>
                    )}
                    <div
                      className="hf-flex-between"
                      style={{
                        padding: "10px 12px",
                        cursor: item.specId ? "pointer" : "default",
                        background: isItemExpanded ? "var(--status-warning-bg)" : "transparent",
                      }}
                      onClick={() => item.specId && toggleItemExpanded(item.id, item.specId)}
                    >
                      <div className="hf-flex hf-gap-sm hf-flex-1" style={{ minWidth: 0 }}>
                        {item.spec && (
                          <>
                            {outputTypeBadge(item.spec.outputType)}
                            <Link
                              href={`${routePrefix}/specs/${item.specId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hf-text-bold hf-text-xs hf-truncate hf-link-plain"
                            >{item.spec.name}</Link>
                            {item.spec.scope === "SYSTEM" && (
                              <span className="hf-text-xs hf-text-placeholder hf-flex-shrink-0">⚙️</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="hf-flex hf-gap-sm">
                        {item.specId && (
                          <span className="hf-text-xs hf-text-placeholder">
                            {isItemExpanded ? "▼" : "▶"}
                          </span>
                        )}
                      </div>
                    </div>
                    {isItemExpanded && detail && (
                      <div className="hf-text-xs" style={{ padding: "12px 16px", borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
                        {detail.description && (
                          <p className="hf-text-muted" style={{ margin: "0 0 8px 0" }}>{detail.description}</p>
                        )}
                        <div className="hf-flex-wrap hf-gap-sm">
                          <span className="hf-micro-badge hf-badge-muted">
                            {detail.scope}
                          </span>
                          <span className="hf-micro-badge hf-badge-muted">
                            {detail.outputType}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
          );
        })()}

        {/* Column 4: Teaching Content (What the AI knows) */}
        <TeachingContentColumn playbookId={playbookId} routePrefix={routePrefix} />
      </div>
      </>
      )}

      {/* Targets Tab */}
      {activeTab === "targets" && (
        <div className="hf-mt-lg">
          {targetsLoading ? (
            <div className="hf-empty hf-text-center hf-text-muted" style={{ padding: 48 }}>
              Loading behavior targets...
            </div>
          ) : !targetsData || targetsData.parameters.length === 0 ? (
            <div className="hf-empty hf-text-center" style={{ padding: 48 }}>
              <div style={{ fontSize: 48 }} className="hf-mb-md">⚙️</div>
              <p className="hf-text-bold hf-text-secondary hf-mb-sm" style={{ fontSize: 16 }}>
                Configure Behavior Dimensions
              </p>
              <p className="hf-text-muted hf-mb-md hf-text-sm">
                Behavior dimensions control how the agent communicates with callers in this domain.
              </p>
              {isEditable && (
                <button
                  onClick={handleCompileTargets}
                  disabled={compilingTargets}
                  className="hf-btn hf-btn-primary hf-text-md"
                  style={{ padding: "10px 20px", background: "var(--badge-purple-text)" }}
                >
                  {compilingTargets ? "Loading..." : "Load Behavior Dimensions"}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Draft mode notice for published playbooks with pending changes */}
              {playbook?.status === "PUBLISHED" && pendingTargetChanges.size > 0 && (
                <div className="hf-banner hf-banner-warning hf-flex hf-gap-md hf-mb-md">
                  <span >✏️</span>
                  <span className="hf-text-bold hf-text-sm" style={{ color: "var(--status-warning-text)" }}>
                    Editing a published playbook — saving will switch to draft mode
                  </span>
                </div>
              )}

              {/* Targets header with save button */}
              <div className="hf-flex-between hf-mb-lg">
                <div>
                  <h3 className="hf-heading-md hf-text-primary">
                    Behavior Dimensions
                  </h3>
                  <p className="hf-text-sm hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                    Adjust sliders to configure agent behavior for the {playbook.domain.name} domain.
                    <span className="hf-text-placeholder hf-ml-sm">
                      {targetsData.counts.withPlaybookOverride} customized, {targetsData.counts.withSystemDefault} using defaults
                    </span>
                  </p>
                </div>
                {isEditable && pendingTargetChanges.size > 0 && (
                  <div className="hf-flex hf-gap-sm">
                    <button
                      onClick={() => setPendingTargetChanges(new Map())}
                      className="hf-btn hf-btn-secondary hf-btn-sm"
                      title="Discard all unsaved changes"
                    >
                      <span>↺</span>
                      <span>Reset All</span>
                    </button>
                    <button
                      onClick={() => handleSaveTargets()}
                      disabled={savingTargets}
                      className="hf-btn hf-btn-primary"
                      
                    >
                      {savingTargets ? "Saving..." : `Save ${pendingTargetChanges.size} Changes`}
                    </button>
                  </div>
                )}
              </div>

              {/* Published playbook save confirmation modal */}
              {showTargetsSaveConfirm && (
                <div
                  className="hf-modal-overlay hf-modal-overlay-dark"
                  onClick={() => setShowTargetsSaveConfirm(false)}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="hf-modal-lg"
                  >
                    <div className="hf-flex hf-gap-md hf-mb-md">
                      <div className="hf-icon-box-lg hf-flex-center" style={{ background: "var(--status-warning-bg)" }}>
                        ⚠️
                      </div>
                      <div>
                        <h3 className="hf-text-bold" style={{ margin: 0, fontSize: 18 }}>
                          Modify Published {terms.playbook}?
                        </h3>
                        <p className="hf-text-muted hf-text-sm" style={{ margin: "4px 0 0 0" }}>
                          This {terms.playbook.toLowerCase()} is currently active
                        </p>
                      </div>
                    </div>

                    <div className="hf-card-compact hf-mb-lg hf-info-box">
                      <p className="hf-text-md hf-text-secondary" style={{ margin: 0, lineHeight: 1.6 }}>
                        Saving these changes will <strong className="hf-text-primary">switch the playbook to draft mode</strong>.
                        The updated behavior targets will apply to <strong className="hf-text-primary">all future prompt runs</strong> once you republish.
                      </p>
                    </div>

                    <div className="hf-modal-actions">
                      <button
                        onClick={() => setShowTargetsSaveConfirm(false)}
                        className="hf-btn hf-btn-secondary"
                        
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveTargets(true)}
                        disabled={savingTargets}
                        className="hf-btn"
                        style={{ background: "var(--status-warning-text)", color: "white" }}
                      >
                        {savingTargets ? "Saving..." : "Save & Switch to Draft"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Intent Bar ─────────────────────── */}
              {isEditable && (
                <div className="hf-mb-lg" style={{ marginBottom: 20 }}>
                  <div className="hf-flex hf-gap-sm">

                    <input
                      type="text"
                      value={intentText}
                      onChange={(e) => setIntentText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && intentText.trim() && !suggesting) {
                          handleSuggestPills("initial");
                        }
                      }}
                      placeholder="Describe the style... e.g. &quot;warm, patient, exam-focused&quot;"
                      disabled={suggesting}
                      className="hf-input hf-flex-1"
                      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                    />
                    <button
                      onClick={() => handleSuggestPills("initial")}
                      disabled={!intentText.trim() || suggesting}
                      className={`hf-btn hf-nowrap ${!intentText.trim() || suggesting ? "" : "hf-btn-primary"}`}
                      style={{
                        borderRadius: 8,
                        ...(!intentText.trim() || suggesting ? { background: "var(--surface-secondary)", color: "var(--text-muted)" } : {}),
                      }}
                    >
                      {suggesting ? (
                        <>
                          <span className="hf-spinner" style={{ width: 14, height: 14 }} />
                          Thinking...
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 16 }}>✨</span>
                          Apply
                        </>
                      )}
                    </button>
                  </div>
                  {suggestError && (
                    <p className="hf-text-error hf-text-xs hf-mt-sm" style={{ margin: 0 }}>
                      {suggestError}
                    </p>
                  )}
                </div>
              )}

              {/* ── Behavior Pills ─────────────────── */}
              {pillStates.length > 0 && (
                <div className="hf-mb-lg">
                  <div className="hf-flex-wrap hf-gap-md">
                    {pillStates.map((ps) => {
                      const paramCount = ps.pill.parameters.length;
                      return (
                        <div
                          key={ps.pill.id}
                          className="hf-pb-item"
                          style={{
                            background: ps.active ? "var(--surface-primary)" : "var(--surface-secondary)",
                            border: ps.active ? "1px solid var(--accent-primary)" : "1px solid var(--border-default)",
                            borderRadius: 12,
                            padding: "12px 16px",
                            minWidth: 160,
                            maxWidth: 220,
                            opacity: ps.active ? 1 : 0.55,
                          }}
                        >
                          {/* Toggle + Label */}
                          <div className="hf-flex hf-gap-sm hf-mb-sm">
                            <input
                              type="checkbox"
                              checked={ps.active}
                              onChange={() => handlePillToggle(ps.pill.id)}
                              style={{
                                accentColor: "var(--accent-primary)",
                                width: 16,
                                height: 16,
                                cursor: "pointer",
                              }}
                            />
                            <span
                              className="hf-text-bold hf-text-md"
                              style={{
                                color: ps.active ? "var(--text-primary)" : "var(--text-muted)",
                              }}
                              title={ps.pill.description}
                            >
                              {ps.pill.label}
                            </span>
                          </div>

                          {/* Intensity slider */}
                          <div className="hf-flex hf-gap-sm">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(ps.intensity * 100)}
                              onChange={(e) =>
                                handlePillIntensity(
                                  ps.pill.id,
                                  Number(e.target.value) / 100
                                )
                              }
                              disabled={!ps.active || !isEditable}
                              className="hf-flex-1"
                              style={{
                                accentColor: "var(--accent-primary)",
                                cursor: ps.active ? "pointer" : "default",
                              }}
                            />
                            <span
                              className="hf-text-bold hf-mono hf-text-xs hf-text-right"
                              style={{
                                color: ps.active ? "var(--text-secondary)" : "var(--text-muted)",
                                minWidth: 28,
                              }}
                            >
                              {Math.round(ps.intensity * 100)}
                            </span>
                          </div>

                          {/* Param count + source badge */}
                          <div className="hf-flex-between" style={{ marginTop: 6 }}>
                            <span className="hf-text-xs hf-text-muted">
                              {paramCount} param{paramCount !== 1 ? "s" : ""}
                            </span>
                            {ps.pill.source === "domain-context" && (
                              <span className="hf-micro-badge" style={{ background: "var(--badge-blue-bg)", color: "var(--badge-blue-text)" }}>
                                suggested
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* + More button */}
                  <button
                    onClick={() => handleSuggestPills("more")}
                    disabled={loadingMore || suggesting}
                    className="hf-btn hf-flex hf-gap-xs hf-mt-md"
                    style={{
                      background: "transparent",
                      color: "var(--accent-primary)",
                      border: "1px dashed var(--border-default)",
                      cursor: loadingMore ? "not-allowed" : "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--accent-primary)";
                      e.currentTarget.style.background = "color-mix(in srgb, var(--accent-primary) 8%, transparent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-default)";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {loadingMore ? (
                      <>
                        <span className="hf-spinner" style={{ width: 12, height: 12 }} />
                        Loading...
                      </>
                    ) : (
                      <>
                        <span>+</span>
                        More suggestions for {playbook.domain.name}...
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* ── Advanced Sliders Toggle ──────────── */}
              {pillStates.length > 0 && (
                <button
                  onClick={() => setShowAdvancedSliders(!showAdvancedSliders)}
                  className="hf-btn hf-flex hf-gap-xs hf-text-muted hf-text-bold hf-mb-md hf-text-sm"
                  style={{ background: "none", border: "none", padding: "8px 0" }}
                >
                  <span
                    style={{
                      transform: showAdvancedSliders ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                      display: "inline-block",
                    }}
                  >
                    ▸
                  </span>
                  Show individual sliders (advanced)
                </button>
              )}

              {/* Graphic Equalizer - Group by domainGroup */}
              {(pillStates.length === 0 || showAdvancedSliders) && (() => {
                // Group parameters by domainGroup
                const groups: Record<string, typeof targetsData.parameters> = {};
                for (const param of targetsData.parameters) {
                  const group = param.domainGroup || "other";
                  if (!groups[group]) groups[group] = [];
                  groups[group].push(param);
                }

                // Dynamic color generation based on group name (NO HARDCODING!)
                // Uses a color palette that assigns consistent colors based on hash
                const colorPalette = [
                  { primary: "var(--slider-purple, #a78bfa)", glow: "var(--slider-purple-glow, #8b5cf6)" },
                  { primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" },
                  { primary: "var(--slider-yellow, #fbbf24)", glow: "var(--slider-yellow-glow, #f59e0b)" },
                  { primary: "var(--slider-blue, #60a5fa)", glow: "var(--slider-blue-glow, #3b82f6)" },
                  { primary: "var(--slider-pink, #f472b6)", glow: "var(--slider-pink-glow, #ec4899)" },
                  { primary: "var(--slider-orange, #fb923c)", glow: "var(--slider-orange-glow, #f97316)" },
                  { primary: "var(--slider-lime, #a3e635)", glow: "var(--slider-lime-glow, #84cc16)" },
                  { primary: "var(--slider-teal, #2dd4bf)", glow: "var(--slider-teal-glow, #14b8a6)" },
                  { primary: "var(--slider-violet, #c084fc)", glow: "var(--slider-violet-glow, #a855f7)" },
                  { primary: "var(--text-muted)", glow: "var(--text-muted)" },
                ];

                // Simple string hash function for consistent color assignment
                const hashString = (str: string): number => {
                  let hash = 0;
                  for (let i = 0; i < str.length; i++) {
                    hash = ((hash << 5) - hash) + str.charCodeAt(i);
                    hash = hash & hash; // Convert to 32-bit integer
                  }
                  return Math.abs(hash);
                };

                const getColorForGroup = (groupName: string) => {
                  const index = hashString(groupName) % colorPalette.length;
                  return colorPalette[index];
                };

                // Format group name for display (snake_case → Title Case)
                const formatGroupName = (name: string): string => {
                  return name
                    .split(/[_-]/)
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(" ");
                };

                return (
                  <div className="hf-flex-wrap hf-gap-xl">
                    {Object.entries(groups).map(([groupName, params]) => {
                      const colors = getColorForGroup(groupName);
                      return (
                        <SliderGroup key={groupName} title={formatGroupName(groupName)} color={colors}>
                          {params.map((param) => {
                            const hasPendingChange = pendingTargetChanges.has(param.parameterId);
                            const pendingValue = pendingTargetChanges.get(param.parameterId);
                            const hasPlaybookOverride = param.playbookValue !== null || (hasPendingChange && pendingValue !== null);
                            const displayValue = hasPendingChange
                              ? (pendingValue !== null && pendingValue !== undefined ? pendingValue : param.systemValue || 0.5)
                              : (param.playbookValue !== null ? param.playbookValue : param.systemValue || 0.5);

                            // Show system default as target marker when value differs from default
                            const systemDefault = param.systemValue ?? 0.5;
                            const showDefaultMarker = Math.abs(displayValue - systemDefault) > 0.01;

                            // Determine scope for badge
                            const scope = hasPendingChange ? "PENDING" : (param.playbookValue !== null ? "PLAYBOOK" : (param.systemValue !== null ? "SYSTEM" : "DEFAULT"));
                            const scopeColors: Record<string, { bg: string; text: string; label: string }> = {
                              PENDING: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", label: "●" },
                              PLAYBOOK: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)", label: "P" },
                              SYSTEM: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", label: "S" },
                              DEFAULT: { bg: "var(--surface-secondary)", text: "var(--text-muted)", label: "D" },
                            };
                            const scopeStyle = scopeColors[scope];

                            return (
                              <div key={param.parameterId} style={{ position: "relative" }}>
                                <VerticalSlider
                                  value={displayValue}
                                  targetValue={showDefaultMarker ? systemDefault : undefined}
                                  color={colors}
                                  editable={isEditable}
                                  onChange={(value) => handleTargetChange(param.parameterId, value)}
                                  isModified={hasPendingChange || hasPlaybookOverride}
                                  label={param.name.replace("BEH-", "").replace(/-/g, " ")}
                                  tooltip={`${param.definition ?? ""}\n\nSystem default: ${Math.round(systemDefault * 100)}%`}
                                  width={56}
                                  height={140}
                                  showGauge={true}
                                />

                                {/* Value comparison badge - shows current vs default */}
                                <div className="hf-flex hf-gap-xs hf-mt-xs" style={{ justifyContent: "center" }}>

                                  {/* Scope badge */}
                                  <span
                                    className="hf-micro-badge-sm hf-text-bold hf-mono"
                                    style={{ background: scopeStyle.bg, color: scopeStyle.text }}
                                    title={`Source: ${scope}`}
                                  >
                                    {scopeStyle.label}
                                  </span>

                                  {/* Value display - clickable to reset when modified */}
                                  {showDefaultMarker && isEditable ? (
                                    <button
                                      onClick={() => handleTargetChange(param.parameterId, null)}
                                      className="hf-btn-reset-tiny hf-mono hf-flex hf-gap-xs"
                                      style={{
                                        fontSize: 9,
                                        background: "transparent",
                                        border: "1px dashed var(--border-default)",
                                        color: "var(--text-muted)",
                                        transition: "all 0.15s",
                                      }}
                                      title={`Click to reset to ${Math.round(systemDefault * 100)}%`}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = "var(--status-warning-bg)";
                                        e.currentTarget.style.borderColor = "var(--status-warning-text)";
                                        e.currentTarget.style.color = "var(--status-warning-text)";
                                        e.currentTarget.style.borderStyle = "solid";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "transparent";
                                        e.currentTarget.style.borderColor = "var(--border-default)";
                                        e.currentTarget.style.color = "var(--text-muted)";
                                        e.currentTarget.style.borderStyle = "dashed";
                                      }}
                                    >
                                      <span style={{ textDecoration: "line-through", opacity: 0.6 }}>
                                        {Math.round(displayValue * 100)}
                                      </span>
                                      <span>→</span>
                                      <span className="hf-text-bold">
                                        {Math.round(systemDefault * 100)}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="hf-mono hf-text-placeholder" style={{ fontSize: 9 }}>
                                      ={Math.round(systemDefault * 100)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </SliderGroup>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Config Settings Section */}
              <div className="hf-mt-lg" style={{ marginTop: 32 }}>
                {/* Section Header */}
                <div className="hf-flex-between hf-mb-lg">
                  <div>
                    <h3 className="hf-heading-md hf-text-primary">
                      System Configuration
                    </h3>
                    <p className="hf-text-sm hf-text-muted hf-mt-xs" style={{ margin: 0 }}>
                      Fine-tune memory, learning, and AI behavior for this playbook.
                    </p>
                  </div>
                  {pendingConfigCount > 0 && (
                    <div className="hf-flex hf-gap-sm">
                      <button
                        onClick={resetAllConfigSettings}
                        className="hf-btn hf-btn-secondary hf-btn-sm"
                      >
                        <span>↺</span>
                        <span>Reset All</span>
                      </button>
                      <button
                        onClick={handleSaveConfigSettings}
                        disabled={savingConfigSettings}
                        className="hf-btn hf-btn-primary hf-btn-sm"
                      >
                        {savingConfigSettings ? "Saving..." : `Save ${pendingConfigCount} Changes`}
                      </button>
                    </div>
                  )}
                </div>

                <div className="hf-flex-wrap hf-gap-xl">
                  {/* Memory Settings Group */}
                  <SliderGroup title="Memory Settings" color={{ primary: "var(--slider-blue, #60a5fa)", glow: "var(--slider-blue-glow, #3b82f6)" }}>
                    {/* Memory Min Confidence */}
                    <div>
                      <VerticalSlider
                        value={getConfigValue("memoryMinConfidence")}
                        targetValue={isConfigModified("memoryMinConfidence") ? defaultConfigSettings.memoryMinConfidence : undefined}
                        color={{ primary: "var(--slider-blue, #60a5fa)", glow: "var(--slider-blue-glow, #3b82f6)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("memoryMinConfidence", v)}
                        isModified={isConfigModified("memoryMinConfidence")}
                        label="Min Confidence"
                        tooltip="Minimum confidence threshold for memory injection (0-100%)"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("memoryMinConfidence") && (
                        <button
                          onClick={() => resetConfigSetting("memoryMinConfidence")}
                          className="hf-btn-reset-tiny"
                        >
                          ↺ {Math.round(defaultConfigSettings.memoryMinConfidence * 100)}
                        </button>
                      )}
                    </div>

                    {/* Memory Max Count (normalized to 0-1 for slider, display as 0-50) */}
                    <div>
                      <VerticalSlider
                        value={getConfigValue("memoryMaxCount") / 50}
                        targetValue={isConfigModified("memoryMaxCount") ? defaultConfigSettings.memoryMaxCount / 50 : undefined}
                        color={{ primary: "var(--slider-blue, #60a5fa)", glow: "var(--slider-blue-glow, #3b82f6)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("memoryMaxCount", Math.round(v * 50))}
                        isModified={isConfigModified("memoryMaxCount")}
                        label="Max Count"
                        tooltip={`Maximum memories to inject: ${getConfigValue("memoryMaxCount")}`}
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("memoryMaxCount") && (
                        <button
                          onClick={() => resetConfigSetting("memoryMaxCount")}
                          className="hf-btn-reset-tiny"
                        >
                          ↺ {defaultConfigSettings.memoryMaxCount}
                        </button>
                      )}
                    </div>

                    {/* Memory Decay Half-Life (normalized to 0-1 for slider, display as 1-90 days) */}
                    <div>
                      <VerticalSlider
                        value={getConfigValue("memoryDecayHalfLife") / 90}
                        targetValue={isConfigModified("memoryDecayHalfLife") ? defaultConfigSettings.memoryDecayHalfLife / 90 : undefined}
                        color={{ primary: "var(--slider-blue, #60a5fa)", glow: "var(--slider-blue-glow, #3b82f6)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("memoryDecayHalfLife", Math.max(1, Math.round(v * 90)))}
                        isModified={isConfigModified("memoryDecayHalfLife")}
                        label="Decay (days)"
                        tooltip={`Memory half-life: ${getConfigValue("memoryDecayHalfLife")} days`}
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("memoryDecayHalfLife") && (
                        <button
                          onClick={() => resetConfigSetting("memoryDecayHalfLife")}
                          className="hf-btn-reset-tiny"
                        >
                          ↺ {defaultConfigSettings.memoryDecayHalfLife}d
                        </button>
                      )}
                    </div>
                  </SliderGroup>

                  {/* Learning Rate Group */}
                  <SliderGroup title="Learning Rate" color={{ primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" }}>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("learningRate")}
                        targetValue={isConfigModified("learningRate") ? defaultConfigSettings.learningRate : undefined}
                        color={{ primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("learningRate", v)}
                        isModified={isConfigModified("learningRate")}
                        label="Learn Rate"
                        tooltip="How fast to adapt targets per learning event (0-100%)"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("learningRate") && (
                        <button onClick={() => resetConfigSetting("learningRate")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.learningRate * 100)}
                        </button>
                      )}
                    </div>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("learningTolerance")}
                        targetValue={isConfigModified("learningTolerance") ? defaultConfigSettings.learningTolerance : undefined}
                        color={{ primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("learningTolerance", v)}
                        isModified={isConfigModified("learningTolerance")}
                        label="Tolerance"
                        tooltip="How close is 'on target'? (0-50%)"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("learningTolerance") && (
                        <button onClick={() => resetConfigSetting("learningTolerance")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.learningTolerance * 100)}
                        </button>
                      )}
                    </div>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("learningMinConfidence")}
                        targetValue={isConfigModified("learningMinConfidence") ? defaultConfigSettings.learningMinConfidence : undefined}
                        color={{ primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("learningMinConfidence", v)}
                        isModified={isConfigModified("learningMinConfidence")}
                        label="Min Conf"
                        tooltip="Minimum confidence to learn from"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("learningMinConfidence") && (
                        <button onClick={() => resetConfigSetting("learningMinConfidence")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.learningMinConfidence * 100)}
                        </button>
                      )}
                    </div>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("learningMaxConfidence")}
                        targetValue={isConfigModified("learningMaxConfidence") ? defaultConfigSettings.learningMaxConfidence : undefined}
                        color={{ primary: "var(--slider-green, #34d399)", glow: "var(--slider-green-glow, #10b981)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("learningMaxConfidence", v)}
                        isModified={isConfigModified("learningMaxConfidence")}
                        label="Max Conf"
                        tooltip="Maximum confidence ceiling"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("learningMaxConfidence") && (
                        <button onClick={() => resetConfigSetting("learningMaxConfidence")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.learningMaxConfidence * 100)}
                        </button>
                      )}
                    </div>
                  </SliderGroup>

                  {/* AI Settings Group */}
                  <SliderGroup title="AI Settings" color={{ primary: "var(--slider-violet, #c084fc)", glow: "var(--slider-violet-glow, #a855f7)" }}>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("aiTemperature")}
                        targetValue={isConfigModified("aiTemperature") ? defaultConfigSettings.aiTemperature : undefined}
                        color={{ primary: "var(--slider-violet, #c084fc)", glow: "var(--slider-violet-glow, #a855f7)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("aiTemperature", v)}
                        isModified={isConfigModified("aiTemperature")}
                        label="Temperature"
                        tooltip="AI creativity vs consistency (0=deterministic, 100=creative)"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("aiTemperature") && (
                        <button onClick={() => resetConfigSetting("aiTemperature")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.aiTemperature * 100)}
                        </button>
                      )}
                    </div>
                  </SliderGroup>

                  {/* Target Bounds Group */}
                  <SliderGroup title="Target Bounds" color={{ primary: "var(--slider-orange, #fb923c)", glow: "var(--slider-orange-glow, #f97316)" }}>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("targetClampMin")}
                        targetValue={isConfigModified("targetClampMin") ? defaultConfigSettings.targetClampMin : undefined}
                        color={{ primary: "var(--slider-orange, #fb923c)", glow: "var(--slider-orange-glow, #f97316)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("targetClampMin", v)}
                        isModified={isConfigModified("targetClampMin")}
                        label="Min Target"
                        tooltip="Minimum allowed target value"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("targetClampMin") && (
                        <button onClick={() => resetConfigSetting("targetClampMin")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.targetClampMin * 100)}
                        </button>
                      )}
                    </div>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("targetClampMax")}
                        targetValue={isConfigModified("targetClampMax") ? defaultConfigSettings.targetClampMax : undefined}
                        color={{ primary: "var(--slider-orange, #fb923c)", glow: "var(--slider-orange-glow, #f97316)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("targetClampMax", v)}
                        isModified={isConfigModified("targetClampMax")}
                        label="Max Target"
                        tooltip="Maximum allowed target value"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("targetClampMax") && (
                        <button onClick={() => resetConfigSetting("targetClampMax")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.targetClampMax * 100)}
                        </button>
                      )}
                    </div>
                  </SliderGroup>

                  {/* Threshold Sensitivity Group */}
                  <SliderGroup title="Thresholds" color={{ primary: "var(--slider-pink, #f472b6)", glow: "var(--slider-pink-glow, #ec4899)" }}>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("thresholdLow")}
                        targetValue={isConfigModified("thresholdLow") ? defaultConfigSettings.thresholdLow : undefined}
                        color={{ primary: "var(--slider-pink, #f472b6)", glow: "var(--slider-pink-glow, #ec4899)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("thresholdLow", v)}
                        isModified={isConfigModified("thresholdLow")}
                        label="Low Thresh"
                        tooltip="Below this value = 'low'"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("thresholdLow") && (
                        <button onClick={() => resetConfigSetting("thresholdLow")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.thresholdLow * 100)}
                        </button>
                      )}
                    </div>
                    <div>
                      <VerticalSlider
                        value={getConfigValue("thresholdHigh")}
                        targetValue={isConfigModified("thresholdHigh") ? defaultConfigSettings.thresholdHigh : undefined}
                        color={{ primary: "var(--slider-pink, #f472b6)", glow: "var(--slider-pink-glow, #ec4899)" }}
                        editable={isEditable}
                        onChange={(v) => handleConfigChange("thresholdHigh", v)}
                        isModified={isConfigModified("thresholdHigh")}
                        label="High Thresh"
                        tooltip="Above this value = 'high'"
                        width={56}
                        height={120}
                        showGauge={true}
                      />
                      {isConfigModified("thresholdHigh") && (
                        <button onClick={() => resetConfigSetting("thresholdHigh")} className="hf-btn-reset-tiny">
                          ↺ {Math.round(defaultConfigSettings.thresholdHigh * 100)}
                        </button>
                      )}
                    </div>
                  </SliderGroup>
                </div>
              </div>

            </>
          )}
        </div>
      )}

      {/* Explorer Tab */}
      {activeTab === "explorer" && (
        <ExplorerTabContent
          explorerLoading={explorerLoading}
          explorerTree={explorerTree}
          expandedNodes={expandedNodes}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
          expandAllNodes={expandAllNodes}
          collapseAllNodes={collapseAllNodes}
          handleTreeKeyDown={handleTreeKeyDown}
          toggleNodeExpand={toggleNodeExpand}
          systemSpecsHaveChanges={systemSpecsHaveChanges}
          handleSaveSystemSpecs={handleSaveSystemSpecs}
          savingSystemSpecs={savingSystemSpecs}
          availableItems={availableItems}
          systemSpecToggles={systemSpecToggles}
          hasConfigOverride={hasConfigOverride}
          handleOpenConfigModal={handleOpenConfigModal}
          handleToggleSystemSpec={handleToggleSystemSpec}
          routePrefix={routePrefix}
          items={items}
          outputTypeBadge={outputTypeBadge}
        />
      )}

      {/* Slugs Tab */}
      {activeTab === "slugs" && (
        <SlugsTabContent
          slugsLoading={slugsLoading}
          slugsData={slugsData}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          toggleFilter={toggleFilter}
          expandedSlugNodes={expandedSlugNodes}
          toggleSlugNodeExpand={toggleSlugNodeExpand}
          routePrefix={routePrefix}
        />
      )}

      {/* Parameters Tab */}
      {activeTab === "parameters" && (
        <ParametersTabContent
          parametersLoading={parametersLoading}
          parametersData={parametersData}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          toggleFilter={toggleFilter}
          parameterSearch={parameterSearch}
          setParameterSearch={setParameterSearch}
          expandedParamCategories={expandedParamCategories}
          toggleParamCategoryExpand={toggleParamCategoryExpand}
          expandedParams={expandedParams}
          toggleParamExpand={toggleParamExpand}
        />
      )}

      {/* Triggers Tab */}
      {activeTab === "triggers" && (
        <TriggersTabContent
          triggersLoading={triggersLoading}
          triggersData={triggersData}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          toggleFilter={toggleFilter}
          expandedTriggerCategories={expandedTriggerCategories}
          toggleTriggerCategoryExpand={toggleTriggerCategoryExpand}
          expandedTriggerSpecs={expandedTriggerSpecs}
          toggleTriggerSpecExpand={toggleTriggerSpecExpand}
          expandedTriggerItems={expandedTriggerItems}
          toggleTriggerItemExpand={toggleTriggerItemExpand}
        />
      )}

      {/* Visualizer Tab */}
      {activeTab === "visualizer" && (
        <div className="hf-mt-lg">
          <div
            className="hf-card-compact"
            style={{ overflow: "hidden", height: "calc(100vh - 320px)", minHeight: 500, padding: 0 }}
          >
            <iframe
              src={`/x/taxonomy-graph?focus=playbook:${playbookId}&depth=6&embed=1`}
              style={{ width: "100%", height: "100%", border: "none" }}
              title={`${terms.playbook} Visualizer`}
            />
          </div>
          <div className="hf-flex hf-gap-sm hf-mt-md">
            <span className="hf-text-xs hf-text-muted">
              Interactive graph showing specs, parameters, triggers, and their relationships
            </span>
            <Link
              href={`/x/taxonomy-graph?focus=playbook:${playbookId}&depth=6`}
              className="hf-text-xs"
              style={{ color: "var(--button-primary-bg)", textDecoration: "none" }}
            >
              Open fullscreen →
            </Link>
          </div>
        </div>
      )}

      {activeTab === "roster" && (
        <RosterTabContent playbookId={playbookId} onCountChange={setRosterCount} />
      )}

      {/* Config Override Modal */}
      {configModalSpec && (
        <ConfigOverrideModal
          spec={configModalSpec}
          currentOverride={systemSpecOverrides.get(configModalSpec.id) || null}
          onSave={(override) => handleSaveConfigOverride(configModalSpec.id, override)}
          onClose={handleCloseConfigModal}
        />
      )}

      {/* Spec Picker Dialog */}
      <TypePickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        title={`Add Spec to ${terms.playbook}`}
        categories={pickerCategories}
        items={pickerItems}
        searchPlaceholder="Search specs..."
        defaultCategory={pickerDefaultCategory}
      />
    </div>
  );
}

