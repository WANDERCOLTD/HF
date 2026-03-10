"use client";

import { FileText, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { getDocTypeInfo } from "@/lib/doc-type-icons";

export interface FileCardData {
  fileName: string;
  /** Raw documentType key e.g. "QUESTION_BANK", "READING_PASSAGE" */
  classification?: string;
  /** Number of learning points extracted */
  assertionCount?: number;
  /** Subject label */
  subject?: string;
  /** AI classification confidence 0-1 */
  confidence?: number;
  /** AI reasoning for this classification */
  reasoning?: string;
  /** Whether students can see this document (derived from doc type defaults) */
  isStudentVisible?: boolean;
}

interface FileCardProps {
  file: FileCardData;
}

export function FileCard({ file }: FileCardProps) {
  const docInfo = file.classification ? getDocTypeInfo(file.classification) : null;

  return (
    <div className="cv4-file-card">
      <div className="cv4-file-card-icon">
        <FileText size={16} />
      </div>
      <div className="cv4-file-card-body">
        <div className="cv4-file-card-name">{file.fileName}</div>
        {file.reasoning && (
          <div className="cv4-file-card-reasoning">{file.reasoning}</div>
        )}
        {file.assertionCount !== undefined && (
          <div className="cv4-file-card-count">
            <CheckCircle2 size={11} />
            {" "}{file.assertionCount} teaching points
          </div>
        )}
      </div>
      <div className="cv4-file-card-badges">
        {docInfo && (
          <span
            className="cv4-sources-doctype"
            style={{ "--badge-color": docInfo.color, "--badge-bg": docInfo.bg } as React.CSSProperties}
          >
            {docInfo.label}
          </span>
        )}
        {file.isStudentVisible !== undefined && (
          <span
            className={`cv4-file-card-visibility${file.isStudentVisible ? " cv4-file-card-visibility--student" : ""}`}
            title={file.isStudentVisible
              ? "Shared with students during calls"
              : "Teacher-only — AI still learns from it"
            }
          >
            {file.isStudentVisible ? <><Eye size={10} /> Student</> : <><EyeOff size={10} /> Teacher</>}
          </span>
        )}
        {file.subject && (
          <span className="cv4-file-card-tag cv4-file-card-tag--subject">{file.subject}</span>
        )}
        {file.confidence !== undefined && file.confidence < 0.7 && (
          <span className="cv4-file-card-tag cv4-file-card-tag--uncertain">
            <AlertCircle size={11} />
            {" "}uncertain
          </span>
        )}
      </div>
    </div>
  );
}
