'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, UserPlus } from 'lucide-react';
import type { StepRenderProps } from '@/components/wizards/types';

interface CallerResult {
  id: string;
  name: string | null;
  email: string | null;
}

export function MembersStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CallerResult[]>([]);
  const [selected, setSelected] = useState<CallerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore saved selection
  useEffect(() => {
    const savedIds = getData<string[]>('memberCallerIds') ?? [];
    const savedNames = getData<Array<{ id: string; name: string | null; email: string | null }>>('memberCallerDetails') ?? [];
    if (savedNames.length > 0) {
      setSelected(savedNames);
    } else if (savedIds.length > 0) {
      // Minimal restore — just IDs without display info
      setSelected(savedIds.map((id) => ({ id, name: null, email: null })));
    }
  }, [getData]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/callers?q=${encodeURIComponent(query)}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          // Filter already-selected callers from results
          const selectedIds = new Set(selected.map((s) => s.id));
          setResults((data.callers ?? []).filter((c: CallerResult) => !selectedIds.has(c.id)));
        }
      } catch {
        // Silent
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [query, selected]);

  const addMember = (caller: CallerResult) => {
    setSelected((prev) => [...prev, caller]);
    setResults((prev) => prev.filter((r) => r.id !== caller.id));
    setQuery('');
  };

  const removeMember = (id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  };

  const handleNext = () => {
    setData('memberCallerIds', selected.map((s) => s.id));
    setData('memberCallerDetails', selected);
    onNext();
  };

  const displayName = (c: CallerResult) => c.name || c.email || c.id;

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Add founding members</h1>
          <p className="hf-page-subtitle">
            Optional — you can also share a join link after setup
          </p>
        </div>

        {/* Search */}
        <div className="hf-mb-md">
          <label className="hf-label">Search for members by name or email</label>
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name or email…"
              className="hf-input"
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>

        {/* Search results */}
        {(results.length > 0 || searching) && (
          <div
            className="hf-card hf-card-compact hf-mb-md"
            style={{ padding: 0, overflow: 'hidden' }}
          >
            {searching && (
              <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                Searching…
              </div>
            )}
            {results.map((caller) => (
              <button
                key={caller.id}
                type="button"
                onClick={() => addMember(caller)}
                className="hf-list-row"
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <UserPlus size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                <div>
                  {caller.name && <span style={{ fontWeight: 500 }}>{caller.name}</span>}
                  {caller.email && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: caller.name ? 8 : 0 }}>
                      {caller.email}
                    </span>
                  )}
                  {!caller.name && !caller.email && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{caller.id}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected members */}
        {selected.length > 0 && (
          <div className="hf-mb-md">
            <p className="hf-label hf-mb-xs">{selected.length} member{selected.length !== 1 ? 's' : ''} selected</p>
            <div className="hf-flex hf-flex-wrap hf-gap-sm">
              {selected.map((caller) => (
                <div
                  key={caller.id}
                  className="hf-chip hf-chip-selected"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span>{displayName(caller)}</span>
                  <button
                    type="button"
                    onClick={() => removeMember(caller.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'inherit' }}
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {selected.length === 0 && (
          <p className="hf-hint">
            No members added yet — you can share a join link from the hub page after creation.
          </p>
        )}
      </div>

      <div className="hf-step-footer">
        <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
        <button onClick={handleNext} className="hf-btn hf-btn-primary">
          {selected.length > 0 ? `Create hub with ${selected.length} member${selected.length !== 1 ? 's' : ''}` : 'Create hub'}
        </button>
      </div>
    </div>
  );
}
