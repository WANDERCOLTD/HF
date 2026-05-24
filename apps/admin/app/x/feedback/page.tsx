"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import type { Ticket, TicketStatus, TicketCategory, TicketComment } from "@/types/tickets";
import { formatRelativeTime, getUserInitials, getCategoryIcon } from "@/utils/formatters";
import { ROLE_LEVEL } from "@/lib/roles";
import type { UserRole } from "@prisma/client";
import { FeedbackSubmitModal } from "@/components/feedback/FeedbackSubmitModal";
import { useChatContext } from "@/contexts/ChatContext";
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

  // Detail panel — URL-synced (#733) so refresh + back-button work and Cmd+K
  // can pick up the active ticket without an extra click.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTicketId = searchParams?.get("ticket") ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(urlTicketId);

  // Modal
  const [showSubmit, setShowSubmit] = useState(false);
  // Toast after a successful submit — surfaces the ticket number for ~4s
  const [submitToast, setSubmitToast] = useState<number | null>(null);

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
    // Compute the next value OUTSIDE the state updater. Calling router.push
    // inside a setState updater triggers React's "Cannot update a component
    // while rendering a different component" warning because the updater
    // function runs during render. Reading `expandedId` from closure is
    // fine here — the click handler runs after render, so the closure is
    // already up to date for this event.
    const next = expandedId === id ? null : id;
    setExpandedId(next);

    // Push the ticket id into the URL so Cmd+K, refresh, and back-button
    // all see the same state. Replace when collapsing so the back-button
    // doesn't get a no-op entry.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next) {
      params.set("ticket", next);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    } else {
      params.delete("ticket");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [expandedId, router, pathname, searchParams]);

  // Keep `expandedId` in sync with the URL when it changes from elsewhere
  // (e.g. user hits back, or someone deep-links into a ticket).
  useEffect(() => {
    setExpandedId(urlTicketId);
  }, [urlTicketId]);

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
                  onClick={() => { setActiveTab("mine"); setExpandedId(null); router.replace(pathname, { scroll: false }); }}
                >
                  Mine
                </button>
                <button
                  className={`pfb-tab${activeTab === "all" ? " active" : ""}`}
                  onClick={() => { setActiveTab("all"); setExpandedId(null); router.replace(pathname, { scroll: false }); }}
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
            Spotted a bug? Have an idea? Click &quot;+ New&quot; to let us know — we read every submission.
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
                  canDelete={roleLevel >= 3 || isOwn(ticket)}
                  roleLevel={roleLevel}
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
          onSuccess={(ticketNumber) => {
            setShowSubmit(false);
            setSubmitToast(ticketNumber);
            refetch();
          }}
        />
      )}

      {/* Submission confirmation toast — visible for 4s */}
      {submitToast !== null && (
        <SubmitToast
          ticketNumber={submitToast}
          onDismiss={() => setSubmitToast(null)}
        />
      )}
    </div>
  );
}

// ── Submit confirmation toast ──

function SubmitToast({
  ticketNumber,
  onDismiss,
}: {
  ticketNumber: number;
  onDismiss: () => void;
}): React.ReactElement {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="pfb-submit-toast hf-banner hf-banner-success" role="status">
      Ticket #{ticketNumber} sent. Paul will see this.
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
  canDelete,
  roleLevel,
  onClose,
  onUpdate,
}: {
  ticketId: string;
  isOwn: boolean;
  canDelete: boolean;
  roleLevel: number;
  onClose: () => void;
  onUpdate: () => void;
}): React.ReactElement {
  const isAdmin = roleLevel >= 3;
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

  // #727 v1 + #733 — when a ticket detail is open, the Assistant should already
  // know about it the moment the user opens chat (Cmd+K). Set the discussion
  // ticket as soon as the ticket data loads and clear it on unmount.
  const chat = useChatContext();
  useEffect(() => {
    if (ticket) {
      chat.setDiscussionTicket(ticket.id, ticket.ticketNumber ?? null);
    }
    return () => {
      // Only clear if this panel set the discussion — guard against racing
      // a second panel that hasn't unmounted yet.
      if (chat.discussionTicketId === ticketId) {
        chat.setDiscussionTicket(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, ticket?.id, ticket?.ticketNumber]);

  const handleDiscussWithAI = (): void => {
    if (!ticket) return;
    chat.setDiscussionTicket(ticket.id, ticket.ticketNumber ?? null);
    chat.openPanel();
  };

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
      onUpdate();
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (next: TicketStatus): Promise<void> => {
    if (submitting || !ticket || ticket.status === next) return;
    setSubmitting(true);
    try {
      // TODO(audit): TICKET_STATUS_CHANGED — no AuditEvent enum for tickets yet;
      // follow-up issue tracks adding it + migration + write call.
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      refetch();
      onUpdate();
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

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) {
        console.error("[Feedback] Delete failed:", data.error);
        return;
      }
      onClose();
      onUpdate();
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  if (loading || !ticket) {
    return <div className="pfb-detail pfb-loading">Loading details...</div>;
  }

  return (
    <div className="pfb-detail">
      {/* #733 — sticky actions bar: stays visible at the top of the detail
          panel regardless of how long the description / comment thread grows.
          Discuss with AI + status (admin) live on the left, Edit / Delete /
          Close on the right. */}
      <div className="pfb-detail-actions-sticky">
        <div className="pfb-detail-actions-sticky-left">
          <button
            className="hf-btn hf-btn-primary"
            onClick={handleDiscussWithAI}
            title="Open the AI Assistant with this ticket loaded as context"
          >
            ✦ Discuss with AI
          </button>
          {isAdmin && (
            <select
              className="hf-input pfb-detail-status-select"
              value={ticket.status}
              onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
              disabled={submitting}
              aria-label="Change ticket status"
            >
              {(Object.keys(STATUS_DISPLAY) as TicketStatus[]).map((key) => (
                <option key={key} value={key}>
                  {STATUS_DISPLAY[key].label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="pfb-detail-actions-sticky-right">
          {canEdit && !editing && (
            <button className="hf-btn hf-btn-secondary" onClick={startEdit}>
              Edit
            </button>
          )}
          {canDelete && (
            <button className="hf-btn hf-btn-destructive" onClick={handleDelete} disabled={submitting}>
              {confirmDelete ? "Confirm delete?" : "Delete"}
            </button>
          )}
          <button className="hf-btn hf-btn-secondary" onClick={onClose} title="Close detail">
            ✕
          </button>
        </div>
      </div>

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

      {/* Add comment — own ticket OR admin reply to any ticket */}
      {(isOwn || isAdmin) && (
        <div className="pfb-detail-section">
          <div className="pfb-add-comment">
            <input
              className="hf-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={isOwn ? "Add a comment..." : "Reply to this ticket..."}
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
