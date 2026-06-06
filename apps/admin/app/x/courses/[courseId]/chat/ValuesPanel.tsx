import type { CourseSnapshot } from "./page";

/**
 * #1225 — RHS read-only render of the course's editable surface.
 *
 * Server component: receives the snapshot built by page.tsx, renders it
 * as a typed list. After a successful chat apply, the page's
 * router.refresh() re-runs page.tsx, which rebuilds the snapshot from
 * the DB and re-renders this panel with new values.
 *
 * Intentionally minimal in v1 — no diff highlight (Phase 2 / #1223).
 */
interface ValuesPanelProps {
  readonly snapshot: CourseSnapshot;
}

export function ValuesPanel({ snapshot }: ValuesPanelProps) {
  const configEntries = Object.entries(snapshot.config);

  return (
    <div className="course-chat-values">
      <section className="course-chat-values-section">
        <h3 className="course-chat-values-section-title">Identity</h3>
        <dl className="course-chat-values-dl">
          <dt>Name</dt>
          <dd>{snapshot.name}</dd>
          <dt>Description</dt>
          <dd>{snapshot.description ?? <em>—</em>}</dd>
          <dt>Learners enrolled</dt>
          <dd>{snapshot.learnerCount}</dd>
        </dl>
      </section>

      <section className="course-chat-values-section">
        <h3 className="course-chat-values-section-title">Curricula</h3>
        <dl className="course-chat-values-dl">
          <dt>Primary</dt>
          <dd>
            {snapshot.curricula.primary ? (
              snapshot.curricula.primary.name
            ) : (
              <em>— (no primary set)</em>
            )}
          </dd>
          <dt>Linked variants</dt>
          <dd>
            {snapshot.curricula.linked.length === 0 ? (
              <em>none</em>
            ) : (
              <ul className="course-chat-values-list">
                {snapshot.curricula.linked.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </section>

      <section className="course-chat-values-section">
        <h3 className="course-chat-values-section-title">
          Config ({configEntries.length})
        </h3>
        {configEntries.length === 0 ? (
          <p className="course-chat-values-empty">No config keys set.</p>
        ) : (
          <dl className="course-chat-values-dl">
            {configEntries.map(([key, value]) => (
              <FragmentEntry key={key} k={key} v={value} />
            ))}
          </dl>
        )}
      </section>

      <section className="course-chat-values-section">
        <h3 className="course-chat-values-section-title">
          Behaviour targets ({snapshot.behaviorTargets.length})
        </h3>
        {snapshot.behaviorTargets.length === 0 ? (
          <p className="course-chat-values-empty">No behaviour targets set.</p>
        ) : (
          <table className="course-chat-values-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Scope</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.behaviorTargets.map((bt) => (
                <tr key={`${bt.parameterId}:${bt.scope}`}>
                  <td>
                    <code>{bt.parameterId}</code>
                  </td>
                  <td>{bt.scope}</td>
                  <td>{bt.targetValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FragmentEntry({ k, v }: { k: string; v: unknown }) {
  let rendered: React.ReactNode;
  if (v === null || v === undefined) {
    rendered = <em>—</em>;
  } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    rendered = String(v);
  } else {
    rendered = (
      <pre className="course-chat-values-json">{JSON.stringify(v, null, 2)}</pre>
    );
  }
  return (
    <>
      <dt>
        <code>{k}</code>
      </dt>
      <dd>{rendered}</dd>
    </>
  );
}
