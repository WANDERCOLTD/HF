"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Edit2, Power, AlertCircle, Check, Star } from "lucide-react";

interface MessagingProvider {
  id: string;
  slug: string;
  displayName: string;
  adapterKey: string;
  secretRef: string;
  fromAddress: string;
  institutionId: string | null;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const ADAPTER_KEYS = ["email-resend", "noop-sms"] as const;
type AdapterKey = (typeof ADAPTER_KEYS)[number];

export function MessagingProvidersClient() {
  const [rows, setRows] = useState<MessagingProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MessagingProvider | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/messaging-providers");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setRows(data.providers as MessagingProvider[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="hf-page" style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <h1 className="hf-page-title" style={{ margin: 0 }}>
            Messaging Providers
          </h1>
          <p className="hf-section-desc" style={{ margin: "4px 0 0" }}>
            Channels HF uses to deliver auth PINs + transactional messages.
            Secret values stay in Secret Manager — only the secret NAME
            (e.g. <code>RESEND_API_KEY</code>) is stored here.
          </p>
        </div>
        <button
          type="button"
          className="hf-btn hf-btn-primary"
          onClick={() => setCreating(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            fontSize: 14,
          }}
        >
          <Plus size={14} /> Add provider
        </button>
      </header>

      {error && (
        <div
          className="hf-banner hf-banner-error"
          style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}
        >
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {isLoading && <div className="hf-section-desc">Loading…</div>}

      {!isLoading && rows.length === 0 && !creating && (
        <div className="hf-section-desc">
          No providers configured. The seed should have created a default
          email row — if missing, run the migration again or click Add provider.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <table
          className="hf-table"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-default, #e4e4e7)" }}>
              <Th>Slug</Th>
              <Th>Display name</Th>
              <Th>Adapter</Th>
              <Th>Secret ref</Th>
              <Th>From</Th>
              <Th>Scope</Th>
              <Th>Default</Th>
              <Th>Enabled</Th>
              <Th>&nbsp;</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                style={{ borderBottom: "1px solid var(--border-subtle, #f4f4f5)" }}
              >
                <Td>
                  <code>{row.slug}</code>
                </Td>
                <Td>{row.displayName}</Td>
                <Td>
                  <code>{row.adapterKey}</code>
                </Td>
                <Td>
                  <code>{row.secretRef}</code>
                </Td>
                <Td title={row.fromAddress}>{row.fromAddress}</Td>
                <Td>
                  {row.institutionId === null ? (
                    <span style={{ color: "var(--text-muted)" }}>SYSTEM</span>
                  ) : (
                    <code>{row.institutionId.slice(0, 8)}…</code>
                  )}
                </Td>
                <Td>{row.isDefault ? <Star size={14} fill="currentColor" /> : ""}</Td>
                <Td>{row.enabled ? <Check size={14} /> : <Power size={14} opacity={0.3} />}</Td>
                <Td>
                  <button
                    type="button"
                    className="hf-btn hf-btn-secondary"
                    onClick={() => setEditing(row)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                    }}
                  >
                    <Edit2 size={12} /> Edit
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(creating || editing) && (
        <ProviderForm
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 8px",
        fontWeight: 600,
        fontSize: 12,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <td style={{ padding: "10px 8px", verticalAlign: "middle" }} title={title}>
      {children}
    </td>
  );
}

interface ProviderFormProps {
  existing: MessagingProvider | null;
  onClose: () => void;
  onSaved: () => void;
}

function ProviderForm({ existing, onClose, onSaved }: ProviderFormProps) {
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [adapterKey, setAdapterKey] = useState<AdapterKey>(
    (existing?.adapterKey as AdapterKey) ?? "email-resend",
  );
  const [secretRef, setSecretRef] = useState(existing?.secretRef ?? "");
  const [fromAddress, setFromAddress] = useState(existing?.fromAddress ?? "");
  const [institutionId, setInstitutionId] = useState(existing?.institutionId ?? "");
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        ...(existing ? {} : { slug }),
        displayName,
        adapterKey,
        secretRef,
        fromAddress,
        institutionId: institutionId.trim() === "" ? null : institutionId.trim(),
        isDefault,
        enabled,
      };
      const res = await fetch(
        existing
          ? `/api/messaging-providers/${existing.id}`
          : "/api/messaging-providers",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSoftDelete() {
    if (!existing) return;
    if (!confirm(`Disable provider "${existing.slug}"?`)) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/messaging-providers/${existing.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Disable failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface, #fff)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
          {existing ? `Edit "${existing.slug}"` : "Add messaging provider"}
        </h2>

        {!existing && (
          <Field
            label="Slug"
            hint="Lowercase letters, digits, hyphens. Cannot be changed after create."
          >
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              placeholder="abacus-email"
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="Abacus Academy — Resend"
            style={inputStyle}
          />
        </Field>

        <Field label="Adapter">
          <select
            value={adapterKey}
            onChange={(e) => setAdapterKey(e.target.value as AdapterKey)}
            style={inputStyle}
          >
            {ADAPTER_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Secret ref"
          hint="Name of the Secret Manager secret. The value is dereferenced at send-time from process.env."
        >
          <input
            type="text"
            value={secretRef}
            onChange={(e) => setSecretRef(e.target.value)}
            required
            placeholder="RESEND_API_KEY"
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>

        <Field label="From address">
          <input
            type="text"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            required
            placeholder='HF Dev <noreply@thewanders.com>'
            style={inputStyle}
          />
        </Field>

        <Field
          label="Institution ID (optional)"
          hint="Leave blank for SYSTEM-default. Fill in to override messaging for a specific institution."
        >
          <input
            type="text"
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            placeholder=""
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>

        <Field label="Flags">
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <span>Default for this scope (only one per adapter + scope wins)</span>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </Field>

        {formError && (
          <div
            className="hf-banner hf-banner-error"
            style={{ margin: "12px 0", display: "flex", alignItems: "center", gap: 6 }}
          >
            <AlertCircle size={14} /> {formError}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border-default)",
          }}
        >
          <div>
            {existing && (
              <button
                type="button"
                className="hf-btn hf-btn-secondary"
                onClick={handleSoftDelete}
                disabled={saving}
                style={{ color: "var(--text-danger)" }}
              >
                Disable
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="hf-btn hf-btn-secondary"
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="hf-btn hf-btn-primary" disabled={saving}>
              {saving ? "Saving…" : existing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--border-default, #d4d4d8)",
  borderRadius: 6,
  boxSizing: "border-box",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "4px 0 0",
            lineHeight: 1.4,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
