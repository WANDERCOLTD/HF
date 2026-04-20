"use client";

import { useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useEntityContext } from "@/contexts";
import {
  Camera,
  Link,
  X,
  Send,
  Loader2,
  Bug,
  Lightbulb,
  HelpCircle,
  LifeBuoy,
} from "lucide-react";
import "./feedback-submit.css";

type Category = "BUG" | "FEATURE" | "QUESTION" | "SUPPORT";

interface FeedbackSubmitModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (ticketNumber: number) => void;
  /** Optional pre-selected category */
  defaultCategory?: Category;
}

const CATEGORIES: {
  key: Category;
  icon: typeof Bug;
  label: string;
  hint: string;
}[] = [
  {
    key: "BUG",
    icon: Bug,
    label: "Something's broken",
    hint: "It crashed, errored, or didn't do what I expected",
  },
  {
    key: "FEATURE",
    icon: Lightbulb,
    label: "I have an idea",
    hint: "A new feature, improvement, or change",
  },
  {
    key: "QUESTION",
    icon: HelpCircle,
    label: "I have a question",
    hint: "Not sure how something works",
  },
  {
    key: "SUPPORT",
    icon: LifeBuoy,
    label: "I need help",
    hint: "I'm stuck and need someone to look at this",
  },
];

export function FeedbackSubmitModal({
  open,
  onClose,
  onSuccess,
  defaultCategory,
}: FeedbackSubmitModalProps): React.ReactElement | null {
  const pathname = usePathname();
  const entityContext = useEntityContext();

  const [category, setCategory] = useState<Category | null>(
    defaultCategory ?? null,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCategory(defaultCategory ?? null);
      setTitle("");
      setDescription("");
      setScreenshot(null);
      setShowLinkInput(false);
      setLinkUrl("");
      setLinkLabel("");
      setError(null);
    }
  }, [open, defaultCategory]);

  // Dismiss with Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Build page context string
  const breadcrumbs = entityContext.breadcrumbs || [];
  const pageContextStr =
    breadcrumbs.length > 0
      ? breadcrumbs.map((b) => b.label || b.type || "?").join(" → ")
      : pathname || "";

  // Screenshot capture — hide modal, snap, restore
  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    // Brief delay so the modal can fade / the overlay isn't captured
    await new Promise((r) => setTimeout(r, 350));
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        scale: 1,
        logging: false,
        useCORS: true,
        ignoreElements: (el: Element) =>
          el.classList.contains("fb-modal-overlay"),
      });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setScreenshot(dataUrl);
    } catch {
      // Screenshot not critical — skip silently
    } finally {
      setCapturing(false);
    }
  }, []);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!category) {
      setError("Please choose a category.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }

    // Append link to description if provided
    let fullDescription = description.trim();
    if (linkUrl.trim()) {
      const label = linkLabel.trim() || linkUrl.trim();
      fullDescription += `\n\n[${label}](${linkUrl.trim()})`;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: fullDescription,
          category,
          pageContext: pageContextStr,
          screenshot: screenshot ?? undefined,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      onSuccess(data.ticket?.ticketNumber ?? 0);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [
    category,
    title,
    description,
    linkUrl,
    linkLabel,
    pageContextStr,
    screenshot,
    onSuccess,
  ]);

  if (!open) return null;

  return (
    <div className="fb-modal-overlay" onClick={onClose}>
      <div className="fb-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="fb-modal-title">Send Feedback</h2>
        <p className="fb-modal-subtitle">
          We read every submission. Pick a category to get started.
        </p>

        {/* Category picker — 2x2 grid */}
        <div className="fb-category-grid">
          {CATEGORIES.map(({ key, icon: Icon, label, hint }) => (
            <button
              key={key}
              type="button"
              className="fb-category-card"
              data-selected={category === key}
              onClick={() => setCategory(key)}
            >
              <div className="fb-category-card-icon">
                <Icon size={18} />
                <span className="fb-category-card-label">{label}</span>
              </div>
              <span className="fb-category-card-hint">{hint}</span>
            </button>
          ))}
        </div>

        {/* Title */}
        <div className="fb-field">
          <label className="fb-label" htmlFor="fb-title">
            Title
          </label>
          <input
            id="fb-title"
            className="hf-input"
            type="text"
            placeholder="Brief summary"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="fb-field">
          <label className="fb-label" htmlFor="fb-description">
            Description
          </label>
          <textarea
            id="fb-description"
            className="fb-textarea"
            placeholder="What happened? What did you expect?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Page context */}
        {pageContextStr && (
          <div className="fb-page-context">You&apos;re on: {pageContextStr}</div>
        )}

        {/* Screenshot + Add link row */}
        <div className="fb-screenshot-row">
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={handleScreenshot}
            disabled={capturing}
          >
            {capturing ? (
              <Loader2 size={16} className="hf-spinner" />
            ) : (
              <Camera size={16} />
            )}
            {screenshot ? "Retake" : "Screenshot"}
          </button>

          {!showLinkInput && (
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => setShowLinkInput(true)}
            >
              <Link size={16} />
              Add a link
            </button>
          )}

          {screenshot && (
            <div className="fb-screenshot-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshot} alt="Screenshot preview" />
              <button
                type="button"
                className="fb-screenshot-remove"
                onClick={() => setScreenshot(null)}
                aria-label="Remove screenshot"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Link input */}
        {showLinkInput && (
          <div className="fb-link-row">
            <input
              className="hf-input"
              type="url"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <input
              className="hf-input"
              type="text"
              placeholder="Label (optional)"
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              style={{ maxWidth: 160 }}
            />
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => {
                setShowLinkInput(false);
                setLinkUrl("");
                setLinkLabel("");
              }}
              aria-label="Remove link"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Error */}
        {error && <div className="fb-error">{error}</div>}

        {/* Actions */}
        <div className="fb-actions">
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 size={16} className="hf-spinner" />
            ) : (
              <Send size={16} />
            )}
            {submitting ? "Sending..." : "Send Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
