"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { entityColors } from "@/src/components/shared/uiColors";

// =====================================================
// TYPES
// =====================================================

interface CallerSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  domain?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  _count?: {
    calls: number;
    memories: number;
  };
}

export interface CallerPickerProps {
  value: string | null;
  onChange: (callerId: string, caller?: CallerSummary) => void;
  domainId?: string;
  roleFilter?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  onCreateNew?: () => void;
}

// =====================================================
// COMPONENT
// =====================================================

export function CallerPicker({
  value,
  onChange,
  domainId,
  roleFilter,
  placeholder = "Search callers...",
  disabled = false,
  autoFocus = false,
  style,
  onCreateNew,
}: CallerPickerProps) {
  // State
  const [callers, setCallers] = useState<CallerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch callers on mount
  useEffect(() => {
    setLoading(true);
    fetch(`/api/callers?withCounts=true&limit=500${roleFilter ? `&role=${roleFilter}` : ""}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setCallers(data.callers || []);
        }
      })
      .catch((e) => console.warn("[CallerPicker] Failed to load callers:", e))
      .finally(() => setLoading(false));
  }, []);

  // Filter callers based on search and domain
  const filteredCallers = useMemo(() => {
    let result = callers;

    // Filter by domain if specified
    if (domainId) {
      result = result.filter((c) => c.domain?.id === domainId);
    }

    // Filter by search term
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name?.toLowerCase().includes(s) ||
          c.email?.toLowerCase().includes(s) ||
          c.phone?.toLowerCase().includes(s) ||
          c.externalId?.toLowerCase().includes(s)
      );
    }

    return result;
  }, [callers, search, domainId]);

  // Get selected caller for display
  const selectedCaller = useMemo(() => {
    if (!value) return null;
    return callers.find((c) => c.id === value) || null;
  }, [callers, value]);

  // Get display label for a caller
  const getCallerLabel = (caller: CallerSummary) => {
    return caller.name || caller.email || caller.phone || caller.externalId || caller.id.slice(0, 8);
  };

  // Handle selection
  const handleSelect = useCallback(
    (caller: CallerSummary) => {
      onChange(caller.id, caller);
      setSearch("");
      setIsOpen(false);
      setHighlightIndex(0);
    },
    [onChange]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          setIsOpen(true);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) => Math.min(prev + 1, filteredCallers.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCallers[highlightIndex]) {
            handleSelect(filteredCallers[highlightIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setHighlightIndex(0);
          break;
      }
    },
    [isOpen, filteredCallers, highlightIndex, handleSelect]
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlighted = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightIndex, isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHighlightIndex(0);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filteredCallers.length]);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }}>
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? search : selectedCaller ? getCallerLabel(selectedCaller) : ""}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
          if (selectedCaller) {
            setSearch("");
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          padding: "8px 12px",
          paddingRight: 32,
          fontSize: 14,
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          outline: "none",
          background: disabled ? "var(--surface-secondary)" : "var(--surface-primary)",
          cursor: disabled ? "not-allowed" : "text",
        }}
      />

      {/* Dropdown arrow / clear */}
      <div
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("", undefined);
              setSearch("");
              inputRef.current?.focus();
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "var(--text-muted)",
              fontSize: 14,
              lineHeight: 1,
            }}
            title="Clear selection"
          >
            &times;
          </button>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{isOpen ? "\u25B2" : "\u25BC"}</span>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--surface-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 100,
          }}
        >
          {loading ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Loading callers...
            </div>
          ) : filteredCallers.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {search ? "No callers match your search" : "No callers found"}
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  borderBottom: "1px solid var(--surface-secondary)",
                }}
              >
                {filteredCallers.length} caller{filteredCallers.length !== 1 ? "s" : ""}
              </div>
              {onCreateNew && (
                <div
                  onClick={() => {
                    onCreateNew();
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    background: "transparent",
                    borderBottom: "1px solid var(--surface-secondary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: entityColors.caller.accent,
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = entityColors.caller.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 14 }}>+</span>
                  <span>Create new caller...</span>
                </div>
              )}
              {filteredCallers.map((caller, index) => (
                <div
                  key={caller.id}
                  data-index={index}
                  onClick={() => handleSelect(caller)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    background:
                      highlightIndex === index
                        ? entityColors.caller.bg
                        : caller.id === value
                          ? "var(--surface-secondary)"
                          : "transparent",
                    borderBottom: "1px solid var(--surface-secondary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {/* Selection indicator */}
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: caller.id === value ? entityColors.caller.accent : "transparent",
                      flexShrink: 0,
                    }}
                  />

                  {/* Main content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getCallerLabel(caller)}
                    </div>
                    {caller.email && caller.name && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {caller.email}
                      </div>
                    )}
                  </div>

                  {/* Domain badge */}
                  {caller.domain && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: entityColors.domain.bg,
                        color: entityColors.domain.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {caller.domain.name}
                    </span>
                  )}

                  {/* Call count */}
                  {caller._count?.calls !== undefined && (
                    <span
                      style={{
                        fontSize: 11,
                        color: entityColors.call.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {caller._count.calls} call{caller._count.calls !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
