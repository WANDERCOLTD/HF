import React from "react";
import { Send, BookOpen, CheckSquare, ArrowRight, Bell } from "lucide-react";

// Memory category colors - matches MEMORY_CATEGORY_META in lib/constants.ts
export const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  FACT: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
  PREFERENCE: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)" },
  EVENT: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)" },
  TOPIC: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)" },
  RELATIONSHIP: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)" },
  CONTEXT: { bg: "var(--surface-secondary)", text: "var(--text-secondary)" },
};

// Action type icons
export const ACTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  SEND_MEDIA: React.createElement(Send, { size: 14 }),
  HOMEWORK: React.createElement(BookOpen, { size: 14 }),
  TASK: React.createElement(CheckSquare, { size: 14 }),
  FOLLOWUP: React.createElement(ArrowRight, { size: 14 }),
  REMINDER: React.createElement(Bell, { size: 14 }),
};

// Assignee badge colors
export const ASSIGNEE_COLORS: Record<string, { bg: string; text: string }> = {
  CALLER: { bg: "color-mix(in srgb, var(--status-success-text) 15%, transparent)", text: "var(--status-success-text)" },
  OPERATOR: { bg: "color-mix(in srgb, var(--status-warning-text) 15%, transparent)", text: "var(--status-warning-text)" },
  AGENT: { bg: "color-mix(in srgb, var(--badge-indigo-text) 15%, transparent)", text: "var(--badge-indigo-text)" },
};
