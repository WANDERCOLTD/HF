"use client";

import type { DoneContentItem } from "./types";

interface WizardDoneContentProps {
  items: DoneContentItem[];
}

export function WizardDoneContent({ items }: WizardDoneContentProps) {
  if (items.length === 0) return null;
  return (
    <dl className="ws-done-content">
      {items.map((item, i) => (
        <div key={i} className="ws-done-content-row">
          <dt className="ws-done-content-label">{item.label}</dt>
          <dd className="ws-done-content-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
