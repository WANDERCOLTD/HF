"use client";

import { FileText, CheckCircle2, AlertCircle } from "lucide-react";

export interface FileCardData {
  fileName: string;
  /** e.g. "Worksheet", "Textbook chapter", "Past paper" */
  classification?: string;
  /** Number of learning points extracted */
  assertionCount?: number;
  /** Subject label */
  subject?: string;
  /** AI classification confidence 0–1 */
  confidence?: number;
  /** AI reasoning for this classification */
  reasoning?: string;
}

interface FileCardProps {
  file: FileCardData;
}

export function FileCard({ file }: FileCardProps) {
  return (
    <div className="cv4-file-card">
      <div className="cv4-file-card-icon">
        <FileText size={16} />
      </div>
      <div className="cv4-file-card-body">
        <div className="cv4-file-card-name">{file.fileName}</div>
        <div className="cv4-file-card-meta">
          {file.classification && (
            <span className="cv4-file-card-tag">{file.classification}</span>
          )}
          {file.subject && (
            <span className="cv4-file-card-tag cv4-file-card-tag--subject">{file.subject}</span>
          )}
          {file.assertionCount !== undefined && (
            <span className="cv4-file-card-count">
              <CheckCircle2 size={11} />
              {" "}{file.assertionCount} teaching points
            </span>
          )}
          {file.confidence !== undefined && file.confidence < 0.7 && (
            <span className="cv4-file-card-tag cv4-file-card-tag--uncertain">
              <AlertCircle size={11} />
              {" "}uncertain
            </span>
          )}
        </div>
        {file.reasoning && (
          <div className="cv4-file-card-reasoning">{file.reasoning}</div>
        )}
      </div>
    </div>
  );
}
