"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Trash2, X as XIcon } from "lucide-react";
import { useChatContext } from "@/contexts/ChatContext";
import { useEntityContext } from "@/contexts/EntityContext";
import { useGlobalAssistant } from "@/contexts/AssistantContext";
import type { LayoutMode } from "@/contexts/AssistantContext";
import { useResponsive } from "@/hooks/useResponsive";
import "./unified-assistant-panel.css";

// ============================================================================
// TYPES
// ============================================================================

export type AssistantTab = "chat" | "jobs" | "data" | "spec";
export type AssistantLayout = "popout" | "embedded" | "sidebar";

export interface UnifiedAssistantPanelProps {
  visible?: boolean;
  onClose?: () => void;
  context?: {
    type: "spec" | "parameter" | "domain" | "caller" | "demo";
    data: any;
  };
  location?: {
    page: string;
    section?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
  };
  defaultTab?: AssistantTab;
  layout?: AssistantLayout;
  enabledTabs?: AssistantTab[]; // Allow restricting which tabs are shown
  endpoint?: string; // Custom API endpoint (defaults to /api/ai/assistant)
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  suggestions?: any;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "abandoned";
  taskType: string;
  currentStep: number;
  totalSteps: number;
  progress: number; // 0-1
  blockers?: string[];
  createdAt: Date;
  completedAt?: Date;
}

// ============================================================================
// TAB CONFIGURATION
// ============================================================================

const TAB_CONFIG = {
  chat: {
    label: "Chat",
    icon: "💬",
    description: "Conversational AI assistant",
  },
  jobs: {
    label: "Jobs",
    icon: "✓",
    description: "Active jobs and guidance",
  },
  data: {
    label: "Data",
    icon: "📊",
    description: "Data exploration and queries",
  },
  spec: {
    label: "Spec",
    icon: "📋",
    description: "Spec-specific assistance",
  },
} as const;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * @deprecated Use ChatPanel (via GlobalAssistant) instead.
 * This component calls /api/ai/assistant which has no tool calling, no streaming,
 * and no entity context. ChatPanel uses /api/chat DATA mode with all three.
 *
 * Still mounted in: /x/specs, /x/domains, /x/dictionary, /x/playground, /x/demos.
 * Remove those page-level instances in a follow-up story, then delete this file.
 * See: https://github.com/paw2paw/HF/issues/200
 */
export function UnifiedAssistantPanel({
  visible = false,
  onClose,
  context,
  location,
  defaultTab = "chat",
  layout = "popout",
  enabledTabs = ["chat", "jobs", "data", "spec"],
  endpoint = "/api/ai/assistant",
}: UnifiedAssistantPanelProps) {
  const [isVisible, setIsVisible] = useState(visible);
  const [activeTab, setActiveTab] = useState<AssistantTab>(defaultTab);
  const [messages, setMessages] = useState<Record<AssistantTab, ChatMessage[]>>({
    chat: [],
    jobs: [],
    data: [],
    spec: [],
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState("");
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);

  // Initialize panel size from localStorage or defaults
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('unifiedAssistant.width');
      return saved ? parseInt(saved, 10) : (layout === 'popout' ? 480 : 360);
    }
    return layout === 'popout' ? 480 : 360;
  });
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('unifiedAssistant.height');
      return saved ? parseInt(saved, 10) : 600;
    }
    return 600;
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chatContext = useChatContext();
  const entityContext = useEntityContext();

  // Try to access global assistant context (optional - only available when used in GlobalAssistant)
  let globalAssistant;
  try {
    globalAssistant = useGlobalAssistant();
  } catch {
    // Not in GlobalAssistant context, that's okay
    globalAssistant = null;
  }

  // Responsive detection for mobile adaptations
  const { isMobile } = useResponsive();

  // Save panel size to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('unifiedAssistant.width', panelWidth.toString());
      localStorage.setItem('unifiedAssistant.height', panelHeight.toString());
    }
  }, [panelWidth, panelHeight]);

  useEffect(() => {
    setIsVisible(visible);
  }, [visible]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTab]);

  // Close layout menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };

    if (layoutMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [layoutMenuOpen]);

  // Welcome message when panel opens
  useEffect(() => {
    if (isVisible && messages.chat.length === 0) {
      const contextName = context?.data?.name || context?.data?.title || context?.data?.slug;
      setMessages((prev) => ({
        ...prev,
        chat: [
          {
            role: "assistant",
            content: `Hi! I'm your HumanFirst AI assistant. ${
              context ? `I can help you with this ${context.type}${contextName ? ` (${contextName})` : ""}.` : "How can I help you today?"
            }`,
            timestamp: new Date(),
          },
        ],
      }));
    }
  }, [isVisible, context]);

  // Load tasks from flash sidebar if available
  useEffect(() => {
    if (isVisible && activeTab === "jobs") {
      loadTasks();
    }
  }, [isVisible, activeTab]);

  const loadTasks = async () => {
    try {
      // Fetch active tasks from API
      const response = await fetch('/api/tasks?status=in_progress');
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }

      const data = await response.json();

      if (data.ok && data.tasks) {
        // Transform UserTask to UI format
        const tasksData = data.tasks.map((task: any) => ({
          id: task.id,
          title: task.stepTitle || `Step ${task.currentStep}`,
          description: task.stepDescription || '',
          status: task.status === 'completed' ? 'completed' :
                  task.status === 'in_progress' ? 'in_progress' : 'pending',
          taskType: task.taskType,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          progress: task.currentStep / task.totalSteps,
          blockers: task.blockers,
          createdAt: new Date(task.startedAt),
          completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
        }));

        setTasks(tasksData);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
      // Show empty state on error
      setTasks([]);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => ({
      ...prev,
      [activeTab]: [...prev[activeTab], userMessage],
    }));
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input.trim(),
          context,
          location,
          mode: activeTab, // Pass current tab as mode
          history: messages[activeTab].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();

      if (data.ok) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
          suggestions: data.suggestions || data.fieldUpdates,
        };
        setMessages((prev) => ({
          ...prev,
          [activeTab]: [...prev[activeTab], assistantMessage],
        }));
      } else {
        throw new Error(data.error || "Failed to get AI response");
      }
    } catch (error) {
      console.error("AI assistant error:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Sorry, I encountered an error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        timestamp: new Date(),
      };
      setMessages((prev) => ({
        ...prev,
        [activeTab]: [...prev[activeTab], errorMessage],
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (confirm(`Clear all ${TAB_CONFIG[activeTab].label} messages?`)) {
      setMessages((prev) => ({
        ...prev,
        [activeTab]: [],
      }));
    }
  };

  const handleCopy = () => {
    const content = messages[activeTab]
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(content);
    // TODO: Show toast notification
    console.log("Copied to clipboard!");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      setHistoryIndex(-1);
      setDraftInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const userMessages = messages[activeTab].filter((m) => m.role === "user");

      if (userMessages.length === 0) return;

      // Save current draft if navigating for the first time
      if (historyIndex === -1 && input.trim()) {
        setDraftInput(input);
      }

      const newIndex = Math.min(historyIndex + 1, userMessages.length - 1);
      setHistoryIndex(newIndex);
      setInput(userMessages[userMessages.length - 1 - newIndex].content);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();

      if (historyIndex <= 0) {
        // Return to draft or empty
        setInput(draftInput);
        setHistoryIndex(-1);
        setDraftInput("");
      } else {
        const userMessages = messages[activeTab].filter((m) => m.role === "user");
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(userMessages[userMessages.length - 1 - newIndex].content);
      }
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || isSearching) return;

    setIsSearching(true);
    setSearchMode(true);

    try {
      const params = new URLSearchParams({
        q: searchQuery.trim(),
        callPoint: `assistant.${activeTab}`,
        limit: "50",
      });

      const response = await fetch(`/api/ai/assistant/search?${params}`);
      const data = await response.json();

      if (data.ok) {
        setSearchResults(data.results || []);
      } else {
        console.error("Search failed:", data.error);
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const exitSearchMode = () => {
    setSearchMode(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return text;

    // Extract context around match (±100 chars)
    const start = Math.max(0, index - 100);
    const end = Math.min(text.length, index + query.length + 100);
    const excerpt = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");

    return excerpt;
  };

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent, direction: 'width' | 'height' | 'both') => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = panelWidth;
    const startHeight = panelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (direction === 'width' || direction === 'both') {
        const deltaX = startX - e.clientX; // Negative because we're dragging from right
        const newWidth = Math.max(320, Math.min(800, startWidth + deltaX));
        setPanelWidth(newWidth);
      }
      if (direction === 'height' || direction === 'both') {
        const deltaY = e.clientY - startY;
        const newHeight = Math.max(400, Math.min(window.innerHeight - 100, startHeight + deltaY));
        setPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (!isVisible) return null;

  // Dynamic width/height — must stay as inline style (JS-driven values)
  const panelDynamicStyle: React.CSSProperties =
    layout === "popout"
      ? { width: isMobile ? "100vw" : panelWidth }
      : layout === "sidebar"
      ? { width: panelWidth, height: panelHeight }
      : {};

  return (
    <>
      {/* Backdrop (only for popout) */}
      {layout === "popout" && (
        <div className="uap-backdrop" onClick={handleClose} />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`uap-panel uap-panel--${layout}${layout === "popout" && isMobile ? " uap-panel--popout-mobile" : ""}`}
        style={panelDynamicStyle}
      >
        {/* Resize handle (left edge for popout, left+bottom for sidebar) */}
        {layout !== "embedded" && (
          <>
            {/* Left edge resize handle (width) */}
            <div
              className="uap-resize-left"
              onMouseDown={(e) => handleResizeStart(e, 'width')}
            >
              <div className="uap-resize-grip-v" />
            </div>
            {/* Bottom edge resize handle (height, sidebar only) */}
            {layout === "sidebar" && (
              <div
                className="uap-resize-bottom"
                onMouseDown={(e) => handleResizeStart(e, 'height')}
              >
                <div className="uap-resize-grip-h" />
              </div>
            )}
            {/* Corner resize handle (both, sidebar only) */}
            {layout === "sidebar" && (
              <div
                className="uap-resize-corner"
                onMouseDown={(e) => handleResizeStart(e, 'both')}
              >
                <div className="uap-resize-corner-icon">⋰</div>
              </div>
            )}
          </>
        )}

        {/* Header */}
        <div className="uap-header">
          <div className="uap-header-row">
            <div className="uap-header-left">
              <div className="uap-header-icon">🤖</div>
              <div>
                <h3 className="uap-header-title">AI Assistant</h3>
                {context && (
                  <p className="uap-header-context">
                    {context.type}: {context.data?.name || context.data?.title || context.data?.slug || context.data?.domain || "..."}
                  </p>
                )}
              </div>
            </div>
            <div className="uap-header-actions">
              {/* Layout mode dropdown (only when in GlobalAssistant context and not mobile) */}
              {globalAssistant && !isMobile && (
                <div ref={layoutMenuRef} className="uap-layout-menu-wrapper">
                  <button
                    onClick={() => setLayoutMenuOpen(!layoutMenuOpen)}
                    title="Change layout"
                    className={`uap-layout-menu-btn ${layoutMenuOpen ? "uap-layout-menu-btn--active" : "uap-layout-menu-btn--inactive"}`}
                  >
                    ⚙️
                  </button>

                  {/* Dropdown menu */}
                  {layoutMenuOpen && (
                    <div className="uap-layout-dropdown">
                      {[
                        { mode: "popout" as LayoutMode, icon: "📌", label: "Popout", desc: "Full overlay" },
                        { mode: "floating" as LayoutMode, icon: "🪟", label: "Floating", desc: "Draggable" },
                        { mode: "docked" as LayoutMode, icon: "📐", label: "Docked", desc: "Corner" },
                        { mode: "minimized" as LayoutMode, icon: "⬇️", label: "Minimize", desc: "Bubble" },
                      ].map(({ mode, icon, label, desc }) => (
                        <button
                          key={mode}
                          onClick={() => {
                            globalAssistant.setLayoutMode(mode);
                            setLayoutMenuOpen(false);
                          }}
                          className={`uap-layout-option ${globalAssistant.layoutMode === mode ? "uap-layout-option--active" : ""}`}
                        >
                          <span className="uap-layout-option-icon">{icon}</span>
                          <div className="uap-layout-option-text">
                            <div className="uap-layout-option-label">{label}</div>
                            <div className="uap-layout-option-desc">{desc}</div>
                          </div>
                          {globalAssistant.layoutMode === mode && (
                            <span className="uap-layout-option-check">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Compact action buttons */}
              <button
                onClick={handleCopy}
                disabled={messages[activeTab].length === 0}
                title="Copy chat"
                className="uap-icon-btn"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={handleClear}
                disabled={messages[activeTab].length === 0}
                title="Clear chat"
                className="uap-icon-btn"
              >
                <Trash2 size={12} />
              </button>
              {layout === "popout" && (
                <button
                  onClick={handleClose}
                  title="Close"
                  className="uap-icon-btn uap-icon-btn--close"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="uap-tabs">
            {enabledTabs.map((tab) => {
              const config = TAB_CONFIG[tab];
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`uap-tab ${isActive ? "uap-tab--active" : ""}`}
                >
                  <span className="uap-tab-icon">{config.icon}</span>
                  {config.label}
                </button>
              );
            })}
          </div>

          {/* Search Bar */}
          {activeTab !== "jobs" && (
            <div className="uap-search-wrap">
              <div className="uap-search-bar">
                <span className="uap-search-icon">🔍</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleSearchKeyPress}
                  placeholder="Search history..."
                  disabled={isSearching}
                  className="uap-search-input"
                />
                {searchMode ? (
                  <button onClick={exitSearchMode} className="uap-search-btn-cancel">
                    ✕
                  </button>
                ) : (
                  <button
                    onClick={handleSearch}
                    disabled={!searchQuery.trim() || isSearching}
                    className="uap-search-btn-go"
                  >
                    {isSearching ? "..." : "Go"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="uap-content">
          {/* Chat/Data/Spec Tabs - Message View */}
          {(activeTab === "chat" || activeTab === "data" || activeTab === "spec") && (
            <div className="uap-messages">
              {/* Search Mode - Display Results */}
              {searchMode ? (
                <>
                  <div className="uap-search-results-header">
                    Found {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
                  </div>
                  {searchResults.length === 0 ? (
                    <div className="uap-search-empty">
                      No previous conversations found matching &ldquo;{searchQuery}&rdquo;
                    </div>
                  ) : (
                    searchResults.map((result) => (
                      <div key={result.id} className="uap-search-result">
                        {/* User message */}
                        {result.userMatchIndex >= 0 && (
                          <div className="uap-search-result-section">
                            <div className="uap-search-result-label">You asked:</div>
                            <div className="uap-search-result-text">
                              {highlightText(result.userMessage, searchQuery)}
                            </div>
                          </div>
                        )}

                        {/* AI response */}
                        {result.aiMatchIndex >= 0 && (
                          <div>
                            <div className="uap-search-result-label">Assistant replied:</div>
                            <div className="uap-search-result-text">
                              {highlightText(result.aiResponse, searchQuery)}
                            </div>
                          </div>
                        )}

                        {/* Metadata */}
                        <div className="uap-search-result-meta">
                          <span>{new Date(result.timestamp).toLocaleString()}</span>
                          <span className="uap-search-result-badge">
                            {result.callPoint.replace("assistant.", "")}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                /* Regular Chat Mode - Display Current Messages */
                <>
                  {messages[activeTab].map((message, i) => (
                    <div
                      key={i}
                      className={`uap-message ${message.role === "user" ? "uap-message--user" : "uap-message--assistant"}`}
                    >
                      <div className={`uap-bubble ${message.role === "user" ? "uap-bubble--user" : "uap-bubble--assistant"}`}>
                        {message.content}
                      </div>

                      {message.suggestions && (
                        <div className="uap-suggestions">
                          <div className="uap-suggestions-label">
                            💡 SUGGESTED CHANGES
                          </div>
                          <pre className="uap-suggestions-code">
                            {JSON.stringify(message.suggestions, null, 2)}
                          </pre>
                        </div>
                      )}

                      <div className="uap-timestamp">
                        {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="uap-loading">
                      <div className="uap-loading-spinner" />
                      Thinking...
                    </div>
                  )}
                </>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Jobs Tab - Job List View */}
          {activeTab === "jobs" && (
            <div className="uap-jobs">
              <div className="uap-jobs-header">
                <h4 className="uap-jobs-title">Active Jobs</h4>
                <p className="uap-jobs-desc">Track your progress and follow AI guidance</p>
              </div>

              {tasks.length === 0 ? (
                <div className="uap-jobs-empty">
                  No active tasks. Start a conversation to get guidance!
                </div>
              ) : (
                <div className="uap-task-list">
                  {tasks.map((task) => (
                    <div key={task.id} className="uap-task">
                      {/* Progress bar */}
                      <div className="uap-task-progress">
                        <div className="uap-task-progress-labels">
                          <span>Step {task.currentStep} of {task.totalSteps}</span>
                          <span>{Math.round(task.progress * 100)}%</span>
                        </div>
                        <div className="uap-task-progress-track">
                          {/* Dynamic width depends on task.progress — must stay inline */}
                          <div className="uap-task-progress-fill" style={{ width: `${task.progress * 100}%` }} />
                        </div>
                      </div>

                      {/* Task info */}
                      <div className="uap-task-info">
                        <div className={`uap-task-checkbox uap-task-checkbox--${task.status}`}>
                          {task.status === "completed" && "✓"}
                          {task.status === "abandoned" && "✕"}
                        </div>
                        <div className="uap-task-body">
                          <div className="uap-task-title">{task.title}</div>
                          {task.description && (
                            <div className="uap-task-description">{task.description}</div>
                          )}
                          <div className="uap-task-type">{task.taskType.replace(/_/g, " ")}</div>
                        </div>
                      </div>

                      {/* Blockers */}
                      {task.blockers && task.blockers.length > 0 && (
                        <div className="uap-task-blockers">
                          <div className="uap-task-blockers-title">
                            ⚠️ {task.blockers.length} Blocker{task.blockers.length > 1 ? 's' : ''}
                          </div>
                          {task.blockers.map((blocker, i) => (
                            <div key={i} className="uap-task-blocker-item">• {blocker}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer - Input */}
        <div className="uap-footer">
          {/* Input (only for chat tabs, not jobs) */}
          {activeTab !== "jobs" && (
            <>
              <div className="uap-input-row">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me anything..."
                  disabled={loading}
                  rows={1}
                  className="uap-textarea"
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "22px";
                    target.style.height = target.scrollHeight + "px";
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="uap-send-btn"
                >
                  ↵
                </button>
              </div>
              <div className="uap-input-hint">
                Enter=send • Shift+Enter=newline • ↑↓=history
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
