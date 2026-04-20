"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useApi } from "@/hooks/useApi";
import type { Ticket, TicketStatus, TicketCategory, TicketComment } from "@/types/tickets";
import { formatRelativeTime, getUserInitials, getCategoryIcon } from "@/utils/formatters";
import { ROLE_LEVEL } from "@/lib/roles";
import type { UserRole } from "@prisma/client";
import { FeedbackSubmitModal } from "@/components/feedback/FeedbackSubmitModal";
import "./feedback.css";

// ── Educator-friendly status mapping ──

type StatusDisplay = { label: string; className: string };

const STATUS_DISPLAY: Record<TicketStatus, StatusDisplay> = {
  OPEN: { label: "New", className: "pfb-status-new" },
  WAITING: { label: "Accepted", className: "pfb-status-accepted" },
  IN_PROGRESS: { label: "In Progress", className: "pfb-status-in-progress" },
  RESOLVED: { label: "Done", className: "pfb-status-done" },
  CLOSED: { label: "Declined", className: "pfb-status-declined" },
};

const CATEGORY_LABELS: Record<TicketCategory | "ALL", string> = {
  ALL: "All types",
  BUG: "Something's broken",
  FEATURE: "I have an idea",
  QUESTION: "Question",
  SUPPORT: "Need help",
  OTHER: "Other",
};

const STATUS_FILTER_LABELS: Record<TicketStatus | "ALL", string> = {
  ALL: "All statuses",
  OPEN: "New",
  WAITING: "Accepted",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Done",
  CLOSED: "Declined",
};

type SortKey = "newest" | "oldest" | "updated";

// ── Main Page ──

export default function FeedbackPage(): React.ReactElement {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "";
  const userRole = (session?.user as { role?: UserRole } | undefined)?.role;
  const roleLevel = userRole ? ROLE_LEVEL[userRole] : 0;

  // Tab: "mine" always visible, "all" for level >= 2
  const [activeTab, setActiveTab] = useState<"mine" | "all">("mine");
  const canSeeAll = roleLevel >= 2;

  // Filters
  const [filterCategory, setFilterCategory] = useState<TicketCategory | "ALL">("ALL");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  // Detail panel
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal
  const [showSubmit, setShowSubmit] = useState(false);

  // Build query — skip fetch on "mine" tab until session provides userId
  const queryParams = new URLSearchParams();
  if (activeTab === "mine" && userId) queryParams.set("creatorId", userId);
  if (filterCategory !== "ALL") queryParams.set("category", filterCategory);
  if (filterStatus !== "ALL") queryParams.set("status", filterStatus);

  const { data, loading, refetch } = useApi<{ tickets: Ticket[]; total: number }>(
    `/api/tickets${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
    {
      skip: activeTab === "mine" && !userId,
      transform: (d) => d as unknown as { tickets: Ticket[]; total: number },
    },
  );

  const rawTickets = data?.tickets ?? [];

  // Client-side search filter
  const searched = useMemo(() => {
    if (!search) return rawTickets;
    const q = search.toLowerCase();
    return rawTickets.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.ticketNumber.toString().includes(q),
    );
  }, [rawTickets, search]);

  // Client-side sort
  const sorted = useMemo(() => {
    const copy = [...searched];
    switch (sortKey) {
      case "newest":
        return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case "oldest":
        return copy.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "updated":
        return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }, [searched, sortKey]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const isOwn = useCallback((ticket: Ticket): boolean => ticket.creatorId === userId, [userId]);

  return (
    <div className="pfb-page">
      {/* Header */}
      <div className="pfb-header">
        <div className="pfb-header-row">
          <div className="pfb-header-left">
            <h1 className="hf-page-title">Feedback</h1>
            {canSeeAll && (
              <div className="pfb-tabs">
                <button
                  className={`pfb-tab${activeTab === "mine" ? " active" : ""}`}
                  onClick={() => { setActiveTab("mine"); setExpandedId(null); }}
                >
                  Mine
                </button>
                <button
                  className={`pfb-tab${activeTab === "all" ? " active" : ""}`}
                  onClick={() => { setActiveTab("all"); setExpandedId(null); }}
                >
                  All
                </button>
              </div>
            )}
          </div>
          <button
            className="hf-btn hf-btn-primary"
            onClick={() => setShowSubmit(true)}
          >
            + New
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="pfb-filters">
        <select
          className="pfb-filter-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as TicketCategory | "ALL")}
        >
          {(Object.keys(CATEGORY_LABELS) as Array<TicketCategory | "ALL">).map((key) => (
            <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>
          ))}
        </select>

        <select
          className="pfb-filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as TicketStatus | "ALL")}
        >
          {(Object.keys(STATUS_FILTER_LABELS) as Array<TicketStatus | "ALL">).map((key) => (
            <option key={key} value={key}>{STATUS_FILTER_LABELS[key]}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="hf-input pfb-search"
        />

        <select
          className="pfb-filter-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="pfb-loading">Loading feedback...</div>
      ) : sorted.length === 0 ? (
        <div className="pfb-empty">
          <div className="pfb-empty-icon">💬</div>
          <p className="pfb-empty-title">No feedback yet</p>
          <p className="pfb-empty-text">
            Use the button above to share your thoughts.
          </p>
        </div>
      ) : (
        <div className="pfb-list">
          {sorted.map((ticket) => (
            <React.Fragment key={ticket.id}>
              <FeedbackRow
                ticket={ticket}
                isOwn={isOwn(ticket)}
                showCreator={activeTab === "all"}
                expanded={expandedId === ticket.id}
                onClick={() => toggleExpand(ticket.id)}
              />
              {expandedId === ticket.id && (
                <FeedbackDetail
                  ticketId={ticket.id}
                  isOwn={isOwn(ticket)}
                  onClose={() => setExpandedId(null)}
                  onUpdate={refetch}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Submit Modal */}
      {showSubmit && (
        <FeedbackSubmitModal
          open={showSubmit}
          onClose={() => setShowSubmit(false)}
          onSuccess={() => {
            setShowSubmit(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ── Row Component ──

function FeedbackRow({
  ticket,
  isOwn,
  showCreator,
  expanded,
  onClick,
}: {
  ticket: Ticket;
  isOwn: boolean;
  showCreator: boolean;
  expanded: boolean;
  onClick: () => void;
}): React.ReactElement {
  const display = STATUS_DISPLAY[ticket.status];
  const latestComment = ticket.comments?.[ticket.comments.length - 1];
  const creatorLabel = isOwn ? "You" : (ticket.creator.name ?? ticket.creator.email);

  // Build subtitle: creator + latest comment snippet
  let subtitle = "";
  if (showCreator || latestComment) {
    const parts: string[] = [];
    if (showCreator) parts.push(creatorLabel);
    if (latestComment) {
      const snippet = latestComment.content.length > 80
        ? latestComment.content.slice(0, 80) + "..."
        : latestComment.content;
      parts.push(`"${snippet}"`);
    }
    subtitle = parts.join(" \u00b7 ");
  }

  return (
    <div
      className={`pfb-row${expanded ? " expanded" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <span className="pfb-row-icon">{getCategoryIcon(ticket.category)}</span>

      <div className="pfb-row-main">
        <div className="pfb-row-title-line">
          <span className="pfb-row-number">#{ticket.ticketNumber}</span>
          <span className="pfb-row-title">{ticket.title}</span>
        </div>
        {subtitle && (
          <span className="pfb-row-sub">
            {showCreator && <span className="pfb-row-sub-name">{creatorLabel}</span>}
            {showCreator && latestComment && " \u00b7 "}
            {latestComment && (
              <>
                &ldquo;
                {latestComment.content.length > 80
                  ? latestComment.content.slice(0, 80) + "..."
                  : latestComment.content}
                &rdquo;
              </>
            )}
          </span>
        )}
      </div>

      <span className={`pfb-status-badge ${display.className}`}>
        {display.label}
      </span>

      <span className="pfb-row-time">{formatRelativeTime(ticket.createdAt)}</span>
    </div>
  );
}

// ── Detail Panel ──

function FeedbackDetail({
  ticketId,
  isOwn,
  onClose,
  onUpdate,
}: {
  ticketId: string;
  isOwn: boolean;
  onClose: () => void;
  onUpdate: () => void;
}): React.ReactElement {
  const { data, loading, refetch } = useApi<{ ticket: Ticket }>(
    `/api/tickets/${ticketId}`,
    { transform: (d) => d as unknown as { ticket: Ticket } },
  );

  const ticket = data?.ticket;
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const canEdit = isOwn && ticket?.status === "OPEN";

  const handleAddComment = async (): Promise<void> => {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setCommentText("");
      refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (!editTitle.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() }),
      });
      setEditing(false);
      refetch();
      onUpdate();
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (): void => {
    if (!ticket) return;
    setEditTitle(ticket.title);
    setEditDesc(ticket.description);
    setEditing(true);
  };

  if (loading || !ticket) {
    return <div className="pfb-detail pfb-loading">Loading details...</div>;
  }

  return (
    <div className="pfb-detail">
      {/* Description */}
      <div className="pfb-detail-section">
        <div className="pfb-detail-label">Description</div>
        {editing ? (
          <>
            <div className="pfb-edit-field">
              <input
                className="hf-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
            </div>
            <div className="pfb-edit-field">
              <textarea
                className="pfb-edit-textarea"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description"
              />
            </div>
            <div className="pfb-detail-actions">
              <button className="hf-btn hf-btn-primary" onClick={handleSaveEdit} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </button>
              <button className="hf-btn hf-btn-secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="pfb-detail-body">{ticket.description}</div>
        )}
      </div>

      {/* Page Context */}
      {ticket.pageContext && (
        <div className="pfb-detail-section">
          <div className="pfb-detail-label">Page</div>
          <div className="pfb-detail-context">{ticket.pageContext}</div>
        </div>
      )}

      {/* Screenshot */}
      {ticket.screenshotUrl && (
        <div className="pfb-detail-section">
          <div className="pfb-detail-label">Screenshot</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ticket.screenshotUrl} alt="Feedback screenshot" className="pfb-screenshot" />
        </div>
      )}

      {/* Comments */}
      {ticket.comments && ticket.comments.length > 0 && (
        <div className="pfb-detail-section">
          <div className="pfb-detail-label">Comments</div>
          <div className="pfb-comments">
            {ticket.comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </div>
        </div>
      )}

      {/* Add comment (own ticket only) */}
      {isOwn && (
        <div className="pfb-detail-section">
          <div className="pfb-add-comment">
            <input
              className="hf-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              onKeyDown={(e) => { if (e.key === "Enter") handleAddComment(); }}
            />
            <button
              className="hf-btn hf-btn-primary"
              onClick={handleAddComment}
              disabled={!commentText.trim() || submitting}
            >
              {submitting ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Actions bar */}
      <div className="pfb-detail-actions">
        {canEdit && !editing && (
          <button className="hf-btn hf-btn-secondary" onClick={startEdit}>
            Edit
          </button>
        )}
        <button className="hf-btn hf-btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// ── Comment Row ──

function CommentRow({ comment }: { comment: TicketComment }): React.ReactElement {
  return (
    <div className="pfb-comment">
      <div className="pfb-comment-avatar">
        {getUserInitials(comment.author)}
      </div>
      <div className="pfb-comment-body">
        <div className="pfb-comment-header">
          <span className="pfb-comment-name">
            {comment.author.name ?? comment.author.email}
          </span>
          <span className="pfb-comment-time">{formatRelativeTime(comment.createdAt)}</span>
        </div>
        <div className="pfb-comment-text">{comment.content}</div>
      </div>
    </div>
  );
}
