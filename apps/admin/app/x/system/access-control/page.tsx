'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Lock, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ErrorBanner } from '@/components/shared/ErrorBanner';

interface InstitutionTypeSummary {
  id: string;
  slug: string;
  name: string;
  terminology: Record<string, string>;
  institutionCount: number;
}

interface PageState {
  rbac: Record<string, Record<string, string>>;
  technicalTerms: Record<string, string>;
  institutionTypes: InstitutionTypeSummary[];
}

const ROLE_LEVEL: Record<string, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  EDUCATOR: 3,
  SUPER_TESTER: 2,
  TESTER: 1,
  STUDENT: 1,
  DEMO: 0,
};

const TERM_KEY_LABELS: Record<string, string> = {
  domain: 'Domain',
  playbook: 'Playbook',
  spec: 'Spec',
  caller: 'Caller',
  cohort: 'Cohort',
  instructor: 'Instructor',
  session: 'Session',
};

/**
 * Access Control Matrix Editor
 * Displays editable RBAC matrix and read-only terminology summary.
 */
export default function AccessControlPage() {
  const { data: session } = useSession();
  const [currentTab, setCurrentTab] = useState<'rbac' | 'terminology'>('rbac');
  const [state, setState] = useState<PageState>({
    rbac: {},
    technicalTerms: {},
    institutionTypes: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const userRole = session?.user?.role || 'VIEWER';
  const userLevel = ROLE_LEVEL[userRole] || 0;

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [rbacRes, termRes] = await Promise.all([
          fetch('/api/admin/access-control/entity-access'),
          fetch('/api/admin/terminology'),
        ]);

        if (rbacRes.ok) {
          const rbacData = await rbacRes.json();
          if (rbacData.contract?.matrix) {
            setState((prev) => ({
              ...prev,
              rbac: rbacData.contract.matrix,
            }));
          }
        }

        if (termRes.ok) {
          const termData = await termRes.json();
          setState((prev) => ({
            ...prev,
            technicalTerms: termData.technicalTerms || {},
            institutionTypes: termData.types || [],
          }));
        }
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSaveRBAC = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/access-control/entity-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: state.rbac }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      setSuccess('RBAC matrix saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [state.rbac]);

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="hf-page-container hf-page-scroll">
      <div>
        <h1 className="hf-page-title">Access Control & Terminology</h1>
        <p className="hf-page-subtitle" style={{ marginTop: 8 }}>
          Configure entity access permissions. Terminology is managed per institution type.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2" style={{ borderBottom: "1px solid var(--border-default)" }}>
        <button
          onClick={() => setCurrentTab('rbac')}
          className="px-4 py-2 font-medium transition-colors"
          style={{
            borderBottom: currentTab === 'rbac' ? "2px solid var(--accent-primary)" : "2px solid transparent",
            color: currentTab === 'rbac' ? "var(--accent-primary)" : "var(--text-muted)",
          }}
        >
          Access Control Matrix
        </button>
        <button
          onClick={() => setCurrentTab('terminology')}
          className="px-4 py-2 font-medium transition-colors"
          style={{
            borderBottom: currentTab === 'terminology' ? "2px solid var(--accent-primary)" : "2px solid transparent",
            color: currentTab === 'terminology' ? "var(--accent-primary)" : "var(--text-muted)",
          }}
        >
          Terminology
        </button>
      </div>

      {/* Messages */}
      <ErrorBanner error={error} />
      {success && (
        <div className="hf-banner hf-banner-success">
          {success}
        </div>
      )}

      {/* RBAC Tab */}
      {currentTab === 'rbac' && state.rbac && Object.keys(state.rbac).length > 0 && (
        <>
          <RBACMatrixTab
            matrix={state.rbac}
            userRole={userRole}
            userLevel={userLevel}
            onChange={(entity, role, value) => {
              setState((prev) => ({
                ...prev,
                rbac: {
                  ...prev.rbac,
                  [entity]: {
                    ...prev.rbac[entity],
                    [role]: value,
                  },
                },
              }));
            }}
            isSaving={isSaving}
          />
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={handleSaveRBAC}
              disabled={isSaving}
              className="hf-btn hf-btn-primary"
            >
              {isSaving ? 'Saving...' : 'Save RBAC Matrix'}
            </button>
          </div>
        </>
      )}

      {/* Terminology Tab */}
      {currentTab === 'terminology' && (
        <TerminologyTab
          technicalTerms={state.technicalTerms}
          institutionTypes={state.institutionTypes}
        />
      )}
    </div>
  );
}

/**
 * RBAC Matrix Editor Tab
 */
function RBACMatrixTab({
  matrix,
  userRole,
  userLevel,
  onChange,
  isSaving,
}: {
  matrix: Record<string, Record<string, string>>;
  userRole: string;
  userLevel: number;
  onChange: (entity: string, role: string, value: string) => void;
  isSaving: boolean;
}) {
  const entities = Object.keys(matrix).sort();
  const roles = ['SUPERADMIN', 'ADMIN', 'OPERATOR', 'EDUCATOR', 'SUPER_TESTER', 'TESTER', 'STUDENT', 'DEMO'];

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border-default)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: "var(--surface-secondary)", borderBottom: "1px solid var(--border-default)" }}>
            <th className="px-3 py-2 text-left text-sm font-semibold w-32" style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-primary)" }}>
              Entity
            </th>
            {roles.map((role) => {
              const targetLevel = ROLE_LEVEL[role] || 0;
              const canEdit = targetLevel < userLevel;
              return (
                <th
                  key={role}
                  className="px-3 py-2 text-left text-sm font-semibold min-w-[120px]"
                  style={{
                    borderRight: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                    ...(!canEdit ? { background: "var(--surface-tertiary)", opacity: 0.7 } : {}),
                  }}
                >
                  <div className="flex items-center gap-1">
                    {role}
                    {!canEdit && <Lock className="w-3 h-3" />}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {entities.map((entity) => (
            <tr key={entity} className="transition-colors" style={{ borderBottom: "1px solid var(--border-default)" }}>
              <td className="px-3 py-2 font-medium text-sm" style={{ borderRight: "1px solid var(--border-default)", background: "var(--surface-secondary)", color: "var(--text-primary)" }}>
                {entity}
              </td>
              {roles.map((role) => {
                const value = matrix[entity]?.[role] || '';
                const targetLevel = ROLE_LEVEL[role] || 0;
                const canEdit = targetLevel < userLevel;

                return (
                  <td
                    key={`${entity}-${role}`}
                    className="px-2 py-1"
                    style={{
                      borderRight: "1px solid var(--border-default)",
                      ...(!canEdit ? { background: "var(--surface-secondary)" } : {}),
                    }}
                  >
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => canEdit && onChange(entity, role, e.target.value)}
                      disabled={isSaving || !canEdit}
                      placeholder="SCOPE:OPS"
                      className="hf-input w-full text-xs font-mono"
                      style={{
                        padding: "4px 8px",
                        ...(!canEdit ? { cursor: "not-allowed", opacity: 0.6 } : {}),
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 px-3 py-2" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Format: SCOPE:OPS (e.g., &quot;ALL:CRUD&quot;, &quot;DOMAIN:CR&quot;, &quot;OWN:R&quot;, &quot;NONE&quot;).
      </p>
    </div>
  );
}

/**
 * Terminology Summary Tab — read-only view of institution type terminology.
 * Editing happens at /x/settings#institution_types.
 */
function TerminologyTab({
  technicalTerms,
  institutionTypes,
}: {
  technicalTerms: Record<string, string>;
  institutionTypes: InstitutionTypeSummary[];
}) {
  const termKeys = Object.keys(TERM_KEY_LABELS);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Terminology labels per institution type. Admin roles always see technical terms.
        </p>
        <Link
          href="/x/settings#institution_types"
          className="hf-btn hf-btn-secondary inline-flex items-center gap-1"
        >
          Manage Institution Types <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border-default)" }}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "var(--surface-secondary)", borderBottom: "1px solid var(--border-default)" }}>
              <th className="px-3 py-2 text-left text-sm font-semibold w-40" style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-primary)" }}>
                Term
              </th>
              <th className="px-3 py-2 text-left text-sm font-semibold min-w-[120px]" style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" }}>
                Technical (Admin)
              </th>
              {institutionTypes.map((type) => (
                <th
                  key={type.id}
                  className="px-3 py-2 text-left text-sm font-semibold min-w-[120px]"
                  style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                >
                  <div>{type.name}</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
                    {type.institutionCount} institution{type.institutionCount !== 1 ? 's' : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {termKeys.map((key) => (
              <tr key={key} className="transition-colors" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <td className="px-3 py-2 font-medium text-sm" style={{ borderRight: "1px solid var(--border-default)", background: "var(--surface-secondary)", color: "var(--text-primary)" }}>
                  {TERM_KEY_LABELS[key]}
                </td>
                <td className="px-3 py-2 text-sm font-mono" style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-muted)", background: "color-mix(in srgb, var(--accent-primary) 4%, transparent)" }}>
                  {technicalTerms[key] || '—'}
                </td>
                {institutionTypes.map((type) => (
                  <td
                    key={`${key}-${type.id}`}
                    className="px-3 py-2 text-sm"
                    style={{ borderRight: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {type.terminology[key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {institutionTypes.length === 0 && (
        <div className="text-center py-8" style={{ fontSize: 14, color: "var(--text-muted)" }}>
          No institution types configured.{' '}
          <Link href="/x/settings#institution_types" style={{ color: "var(--accent-primary)" }} className="hover:underline">
            Create one
          </Link>
        </div>
      )}
    </div>
  );
}
