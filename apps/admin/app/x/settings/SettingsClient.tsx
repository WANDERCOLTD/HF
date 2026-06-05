"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Info, ShieldAlert } from "lucide-react";
import { useViewMode } from "@/contexts";
import {
  type SettingsPanel,
  type SettingsCategory,
  type PanelProps,
  buildPanelRegistry,
  registerCustomPanel,
} from "@/lib/settings-panels";
import { useSettingsSearch } from "@/hooks/useSettingsSearch";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";

// Layout
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { SettingsSearch } from "@/components/settings/SettingsSearch";

// Panels
import { SettingsGroupPanel } from "@/components/settings/SettingsGroupPanel";
import { AppearancePanel } from "@/components/settings/AppearancePanel";
import { ChannelsPanel } from "@/components/settings/ChannelsPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { FallbacksPanel } from "@/components/settings/FallbacksPanel";
import { PanelLayoutPanel } from "@/components/settings/PanelLayoutPanel";
import { InstitutionTypesPanel } from "@/components/settings/InstitutionTypesPanel";
import { ConstantsReferencePanel } from "@/components/settings/ConstantsReferencePanel";
import { VoiceProvidersPanel } from "@/components/settings/VoiceProvidersPanel";
import { VoiceToolsPanel } from "@/components/settings/VoiceToolsPanel";

// ── Build the unified panel registry ────────────────

function ChannelsPanelAdapter(_props: PanelProps) {
  return <ChannelsPanel />;
}

function VoiceProvidersPanelAdapter(_props: PanelProps) {
  return <VoiceProvidersPanel />;
}

function VoiceToolsPanelAdapter(_props: PanelProps) {
  return <VoiceToolsPanel />;
}

// Ordered: foundational setup → operational → security → personal → advanced
const CUSTOM_PANELS: SettingsPanel[] = [
  registerCustomPanel(
    "institution_types", "Institution Types", "Building2",
    "Manage institution types and terminology presets",
    "system", InstitutionTypesPanel,
    ["institution", "types", "terminology", "school", "corporate", "community"],
  ),
  registerCustomPanel(
    "channels", "Delivery Channels", "Phone",
    "Configure delivery channels for sharing content",
    "communications", ChannelsPanelAdapter,
    ["channels", "sim", "whatsapp", "sms", "delivery"],
  ),
  registerCustomPanel(
    "voice_providers", "Voice Providers", "PhoneCall",
    "CRUD voice-call providers (VAPI etc.) — credentials, defaults, archive",
    "communications", VoiceProvidersPanelAdapter,
    ["voice", "provider", "vapi", "credentials", "api key", "webhook", "archive", "call"],
  ),
  registerCustomPanel(
    "voice_tools", "Voice Tools", "Wrench",
    "Enable or disable individual tools (lookup_teaching_point, check_mastery, …) available to voice callers",
    "communications", VoiceToolsPanelAdapter,
    ["voice", "tools", "enable", "disable", "lookup", "mastery", "TOOLS-001"],
  ),
  registerCustomPanel(
    "security", "Access Matrix", "Lock",
    "Per-role CRUD permissions for all system entities",
    "security", SecurityPanel,
    ["access matrix", "CRUD", "permissions", "roles", "SUPERADMIN", "ADMIN", "OPERATOR", "entity access", "scope"],
  ),
  registerCustomPanel(
    "appearance", "Appearance", "Sun",
    "Theme mode and color palettes",
    "general", AppearancePanel,
    ["theme", "dark mode", "light mode", "system", "palette", "color"],
    false,
  ),
  registerCustomPanel(
    "fallbacks", "Fallback Defaults", "Shield",
    "Default values when primary data sources are unavailable",
    "developer", FallbacksPanel,
    ["fallback", "defaults", "json", "identity template", "onboarding personas", "flow phases", "transcript limits", "AI model defaults"],
  ),
  registerCustomPanel(
    "panel_layout", "Panel Layout", "LayoutGrid",
    "Assign settings panels to sidebar categories",
    "developer", PanelLayoutPanel,
    ["panel layout", "category", "sidebar", "organize", "reassign"],
  ),
  registerCustomPanel(
    "constants_reference", "System Constants", "Braces",
    "Read-only reference of operational constants across the codebase",
    "developer", ConstantsReferencePanel,
    ["constants", "timeout", "limit", "threshold", "batch", "poll", "cache", "interval"],
  ),
];

// ── Main component ──────────────────────────────────

export default function SettingsClient() {
  const { isAdvanced } = useViewMode();

  // ── Settings data ─────────────────────────────────
  // (hoisted above panel registry so overrides are available)

  const [values, setValues] = useState<Record<string, number | boolean | string>>({});
  const [fallbackValues, setFallbackValues] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [authError, setAuthError] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch("/api/system-settings")
      .then((r) => {
        if (r.status === 403 || r.status === 401) {
          setAuthError(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data?.ok) return;
        const map: Record<string, number | boolean | string> = {};
        const fbMap: Record<string, unknown> = {};
        for (const s of data.settings) {
          if (typeof s.key === "string" && s.key.startsWith("fallback:")) {
            fbMap[s.key] = s.value;
          } else {
            map[s.key] = s.value;
          }
        }
        setValues(map);
        setFallbackValues(fbMap);
      })
      .catch((e) => console.warn("[Settings] Failed to load settings:", e))
      .finally(() => setLoaded(true));
  }, []);

  const saveSetting = useCallback((key: string, value: number | boolean | string) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/system-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }).catch(console.error);
    }, 500);
  }, []);

  const updateSetting = useCallback(
    (key: string, value: number | boolean | string) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      saveSetting(key, value);
    },
    [saveSetting],
  );

  const updateFallback = useCallback((key: string, value: unknown) => {
    setFallbackValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Build panel registry (reactive to category overrides) ──

  const categoryOverridesRaw = values["settings.panel_categories"];
  const allPanels = useMemo(() => {
    let overrides: Record<string, SettingsCategory> | undefined;
    if (categoryOverridesRaw && typeof categoryOverridesRaw === "string") {
      try { overrides = JSON.parse(categoryOverridesRaw); } catch { /* ignore */ }
    }
    return buildPanelRegistry(CUSTOM_PANELS, overrides);
  }, [categoryOverridesRaw]);

  // Filter panels by view mode
  const visiblePanels = useMemo(
    () => isAdvanced ? allPanels : allPanels.filter((p) => !p.advancedOnly),
    [isAdvanced, allPanels],
  );

  // Active panel state with URL hash persistence
  const [activeId, setActiveId] = useState("appearance");

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && allPanels.some((p) => p.id === hash)) setActiveId(hash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset if active panel hidden by view mode change
  useEffect(() => {
    if (!visiblePanels.some((p) => p.id === activeId)) {
      setActiveId("appearance");
      window.history.replaceState(null, "", "#appearance");
    }
  }, [isAdvanced]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useCallback((id: string) => {
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
  }, []);

  // ── Search ────────────────────────────────────────

  const search = useSettingsSearch(visiblePanels);

  // Navigate to first matching panel when searching and current doesn't match
  useEffect(() => {
    if (search.isSearching && search.matchingPanelIds.size > 0 && !search.matchingPanelIds.has(activeId)) {
      const firstMatch = visiblePanels.find((p) => search.matchingPanelIds.has(p.id));
      if (firstMatch) navigate(firstMatch.id);
    }
  }, [search.matchingPanelIds, search.isSearching]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render active panel ───────────────────────────

  const activePanel = visiblePanels.find((p) => p.id === activeId) ?? visiblePanels[0];

  const panelProps: PanelProps = {
    values,
    fallbackValues,
    loaded,
    updateSetting,
    updateFallback,
  };

  function renderActivePanel() {
    if (!activePanel) return null;

    if (activePanel.content.kind === "auto") {
      return (
        <SettingsGroupPanel
          panel={activePanel}
          values={values}
          loaded={loaded}
          updateSetting={updateSetting}
          highlightedKeys={search.isSearching ? search.matchingSettingKeys : undefined}
        />
      );
    }

    const Component = activePanel.content.component;
    return <Component {...panelProps} />;
  }

  // ── Layout ────────────────────────────────────────

  const sidebarContent = (
    <>
      <SettingsSearch
        value={search.searchTerm}
        onChange={search.setSearchTerm}
        onClear={search.clearSearch}
        resultCount={search.matchingPanelIds.size}
        isSearching={search.isSearching}
        inputRef={search.inputRef}
      />
      <SettingsSidebar
        panels={visiblePanels}
        activeId={activePanel?.id ?? "appearance"}
        onSelect={navigate}
        matchingPanelIds={search.matchingPanelIds}
        isSearching={search.isSearching}
      />
    </>
  );

  return (
    <div>
      <AdvancedBanner />
      <SettingsLayout
        panels={visiblePanels}
        activeId={activePanel?.id ?? "appearance"}
        onNavigate={navigate}
        sidebar={sidebarContent}
      >
        {/* Header */}
        <div style={{ marginBottom: 24, paddingTop: 12 }}>
          <h1 className="hf-page-title" style={{ marginBottom: 6 }}>
            Settings
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Appearance and system configuration
          </p>
        </div>

        {/* Auth warning */}
        {authError && (
          <div
            style={{
              marginBottom: 16,
              padding: 16,
              background: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--status-warning) 30%, transparent)",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <ShieldAlert size={18} style={{ color: "var(--status-warning)", flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Server settings require Admin access. Appearance preferences are still available.
            </div>
          </div>
        )}

        {/* Active panel */}
        {renderActivePanel()}

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: "var(--surface-secondary)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Info size={18} strokeWidth={1.5} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>
              Settings saved automatically
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {activePanel?.id === "appearance"
                ? "Theme preferences are stored locally in your browser"
                : "Pipeline and system settings are saved to the server (30s cache)"}
            </div>
          </div>
        </div>
      </SettingsLayout>
    </div>
  );
}
