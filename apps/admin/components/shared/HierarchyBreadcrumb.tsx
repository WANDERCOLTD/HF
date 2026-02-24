"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  href: string;
  icon?: React.ReactNode;
  loading?: boolean;
}

interface HierarchyBreadcrumbProps {
  segments: BreadcrumbSegment[];
  className?: string;
}

export function HierarchyBreadcrumb({ segments, className }: HierarchyBreadcrumbProps) {
  if (segments.length === 0) return null;

  return (
    <nav className={`hf-breadcrumb ${className || ""}`} aria-label="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={seg.href}>
            {i > 0 && <ChevronRight className="hf-breadcrumb-separator" />}
            {isLast ? (
              <span className="hf-breadcrumb-segment hf-breadcrumb-current">
                {seg.icon}
                {seg.loading ? <span className="hf-breadcrumb-skeleton" /> : seg.label}
              </span>
            ) : (
              <Link href={seg.href} className="hf-breadcrumb-segment">
                {seg.icon}
                {seg.loading ? <span className="hf-breadcrumb-skeleton" /> : seg.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
