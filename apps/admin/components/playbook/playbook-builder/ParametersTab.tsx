"use client";

import { useIsOperatorOrAbove } from "@/hooks/useIsOperatorOrAbove";

import "./parameters-tab.css";

export type ParameterCategory = {
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

export type ParametersData = {
  categories: ParameterCategory[];
  counts: { parameters: number; anchors: number; categories: number };
};

export interface ParametersTabContentProps {
  parametersLoading: boolean;
  parametersData: ParametersData | null;
  activeFilter: string | null;
  setActiveFilter: (filter: string | null) => void;
  toggleFilter: (filter: string) => void;
  parameterSearch: string;
  setParameterSearch: (search: string) => void;
  expandedParamCategories: Set<string>;
  toggleParamCategoryExpand: (category: string) => void;
  expandedParams: Set<string>;
  toggleParamExpand: (paramId: string) => void;
}

function anchorScoreClass(score: number): string {
  if (score >= 0.7) return "pt-anchor-score pt-anchor-score--high";
  if (score <= 0.3) return "pt-anchor-score pt-anchor-score--low";
  return "pt-anchor-score pt-anchor-score--mid";
}

export function ParametersTabContent({
  parametersLoading,
  parametersData,
  activeFilter,
  setActiveFilter,
  toggleFilter,
  parameterSearch,
  setParameterSearch,
  expandedParamCategories,
  toggleParamCategoryExpand,
  expandedParams,
  toggleParamExpand,
}: ParametersTabContentProps) {
  // #1664 Decision 5 — interpretation chips are OPERATOR-only.
  // PlaybookBuilder is OPERATOR-gated at the route level today; the
  // hook is belt-and-suspenders defence-in-depth so the chips don't
  // leak if this component is ever reused inside a STUDENT-visible
  // surface.
  const operatorOrBetter = useIsOperatorOrAbove();
  return (
        <div className="pt-root">
          {parametersLoading ? (
            <div className="pt-loading">
              Loading parameters...
            </div>
          ) : !parametersData ? (
            <div className="pt-loading">
              Failed to load parameters data
            </div>
          ) : (
            <div className="pt-content">
              {/* Summary - Clickable Filters */}
              <div className="pt-filter-bar">
                <button
                  onClick={() => setActiveFilter(null)}
                  className={`pt-filter-chip${activeFilter === null ? " pt-filter-chip--active" : ""}`}
                >
                  <div className="pt-filter-chip-label">All</div>
                  <div className={`pt-filter-chip-count${activeFilter === null ? " pt-filter-chip-count--active" : ""}`}>{parametersData.counts.parameters}</div>
                </button>
                {parametersData.categories.map(cat => (
                  <button
                    key={cat.category}
                    onClick={() => toggleFilter(cat.category)}
                    className={`pt-filter-chip${activeFilter === cat.category ? " pt-filter-chip--active" : ""}`}
                  >
                    <div className="pt-filter-chip-label">{cat.icon} {cat.category}</div>
                    <div className={`pt-filter-chip-count${activeFilter === cat.category ? " pt-filter-chip-count--active" : ""}`}>{cat.parameters.length}</div>
                  </button>
                ))}
                <div className="pt-search-wrap">
                  <input
                    type="text"
                    placeholder="Search parameters..."
                    value={parameterSearch}
                    onChange={(e) => setParameterSearch(e.target.value)}
                    className="pt-search-input"
                  />
                  <span className="pt-search-icon">🔍</span>
                  {parameterSearch && (
                    <button
                      onClick={() => setParameterSearch("")}
                      className="pt-search-clear"
                    >✕</button>
                  )}
                </div>
              </div>

              {/* Categories */}
              <div className="pt-categories">
                {parametersData.categories
                  .filter(category => !activeFilter || activeFilter === category.category)
                  .map((category) => {
                    const searchLower = parameterSearch.toLowerCase();
                    const filteredParams = parameterSearch
                      ? category.parameters.filter(p =>
                          p.parameterId.toLowerCase().includes(searchLower) ||
                          p.name.toLowerCase().includes(searchLower) ||
                          (p.definition && p.definition.toLowerCase().includes(searchLower))
                        )
                      : category.parameters;
                    if (parameterSearch && filteredParams.length === 0) return null;
                    return (
                  <div key={category.category}>
                    {/* Category Header */}
                    <div
                      onClick={() => toggleParamCategoryExpand(category.category)}
                      className="pt-cat-header"
                    >
                      <span className="pt-cat-icon">{category.icon}</span>
                      <span className="pt-cat-name">{category.category}</span>
                      <span className="pt-cat-count">({filteredParams.length}{parameterSearch && filteredParams.length !== category.parameters.length ? ` / ${category.parameters.length}` : ""})</span>
                      <span className="pt-cat-chevron">
                        {expandedParamCategories.has(category.category) ? "▼" : "▶"}
                      </span>
                    </div>
                    {/* Category Content */}
                    {expandedParamCategories.has(category.category) && (
                      <div className="pt-cat-body">
                        {filteredParams.map((param) => (
                          <div key={param.parameterId}>
                            {/* Parameter Header */}
                            <div
                              onClick={() => toggleParamExpand(param.parameterId)}
                              className="pt-param-header"
                            >
                              <span className="pt-param-id">
                                {param.parameterId}
                              </span>
                              <span className="pt-param-name">{param.name}</span>
                              {param.sourceFeatureSet && (
                                <span className="pt-param-feature-tag">
                                  {param.sourceFeatureSet.name}
                                </span>
                              )}
                              {param.scoringAnchors.length > 0 && (
                                <span className="pt-param-anchor-count">
                                  {param.scoringAnchors.length} anchors
                                </span>
                              )}
                              <span className="pt-param-chevron">
                                {expandedParams.has(param.parameterId) ? "▼" : "▶"}
                              </span>
                            </div>
                            {/* Parameter Details */}
                            {expandedParams.has(param.parameterId) && (
                              <div className="pt-param-detail">
                                {param.definition && (
                                  <div className="pt-param-definition">
                                    {param.definition}
                                  </div>
                                )}
                                <div className="pt-param-meta">
                                  <div>
                                    <span className="pt-param-meta-label">Scale:</span>{" "}
                                    <span className="pt-param-meta-value">{param.scaleType}</span>
                                  </div>
                                  <div>
                                    <span className="pt-param-meta-label">Type:</span>{" "}
                                    <span className="pt-param-meta-value">{param.parameterType}</span>
                                  </div>
                                </div>
                                {operatorOrBetter && (param.interpretationHigh || param.interpretationLow) && (
                                  <div className="pt-interpretation">
                                    {param.interpretationHigh && (
                                      <div className="pt-interpretation-row">
                                        <span className="pt-interpretation-high">↑ High:</span>{" "}
                                        <span className="pt-interpretation-text">{param.interpretationHigh}</span>
                                      </div>
                                    )}
                                    {param.interpretationLow && (
                                      <div>
                                        <span className="pt-interpretation-low">↓ Low:</span>{" "}
                                        <span className="pt-interpretation-text">{param.interpretationLow}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Scoring Anchors */}
                                {param.scoringAnchors.length > 0 && (
                                  <div>
                                    <div className="pt-anchors-title">
                                      Scoring Anchors
                                    </div>
                                    <div className="pt-anchors-list">
                                      {param.scoringAnchors.map((anchor) => (
                                        <div
                                          key={anchor.id}
                                          className={`pt-anchor-card${anchor.isGold ? " pt-anchor-card--gold" : ""}`}
                                        >
                                          <div className="pt-anchor-head">
                                            <span className={anchorScoreClass(anchor.score)}>
                                              {anchor.score.toFixed(1)}
                                            </span>
                                            {anchor.isGold && (
                                              <span className="pt-anchor-gold-tag">
                                                Gold
                                              </span>
                                            )}
                                          </div>
                                          <div className="pt-anchor-example">
                                            &ldquo;{anchor.example}&rdquo;
                                          </div>
                                          {anchor.rationale && (
                                            <div className="pt-anchor-rationale">
                                              {anchor.rationale}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {/* Used by Specs */}
                                {param.usedBySpecs.length > 0 && (
                                  <div className="pt-used-by">
                                    <div className="pt-used-by-label">Used by:</div>
                                    <div className="pt-used-by-list">
                                      {param.usedBySpecs.map((spec) => (
                                        <span
                                          key={spec.specId}
                                          className="pt-used-by-tag"
                                        >
                                          {spec.specSlug}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
                })}
                {parametersData.categories.length === 0 && (
                  <div className="pt-no-params">
                    No parameters found in this playbook
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
  );
}
