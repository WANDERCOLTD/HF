"use client";

import { RefObject } from "react";
import "./general-import-wizard.css";

interface GeneralImportWizardProps {
  step: 1 | 2 | 3 | 4;
  setStep: (step: 1 | 2 | 3 | 4) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  rawText: string;
  setRawText: (text: string) => void;
  parsing: boolean;
  setParsing: (parsing: boolean) => void;
  detectedType: string | null;
  setDetectedType: (type: string | null) => void;
  selectedType: string;
  setSelectedType: (type: string) => void;
  extracting: boolean;
  setExtracting: (extracting: boolean) => void;
  extractedSpec: any;
  setExtractedSpec: (spec: any) => void;
  error: string | null;
  setError: (error: string | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  autoActivate: boolean;
  setAutoActivate: (autoActivate: boolean) => void;
  onImportComplete: (result: any) => void;
}

const SPEC_TYPES = [
  {
    value: "CURRICULUM",
    label: "Curriculum",
    description: "Module-based learning content with learning outcomes",
    icon: "📚",
    bestFor: "Course materials, training guides, certifications",
  },
  {
    value: "MEASURE",
    label: "Measure",
    description: "Behavioral parameters and measurement specs",
    icon: "📊",
    bestFor: "Personality traits, engagement metrics, scoring",
  },
  {
    value: "IDENTITY",
    label: "Identity",
    description: "Agent persona and character definition",
    icon: "🎭",
    bestFor: "Character sheets, role definitions, voice",
  },
  {
    value: "CONTENT",
    label: "Content",
    description: "Book or source knowledge for teaching",
    icon: "📖",
    bestFor: "Reference materials, textbooks, articles",
  },
  {
    value: "ADAPT",
    label: "Adapt",
    description: "Behavior adaptation rules and triggers",
    icon: "🔄",
    bestFor: "Teaching style adjustments, personalization",
  },
  {
    value: "GUARDRAIL",
    label: "Guardrail",
    description: "Safety constraints and boundaries",
    icon: "🛡️",
    bestFor: "Compliance rules, content filters, limits",
  },
];

const StepIndicator = ({ current, total }: { current: number; total: number }) => (
  <div className="giw-step-bar">
    {Array.from({ length: total }, (_, i) => i + 1).map((num) => (
      <div key={num} className="giw-step-item">
        <div
          className={`giw-step-dot ${
            num === current
              ? "giw-step-dot-active"
              : num < current
              ? "giw-step-dot-done"
              : "giw-step-dot-pending"
          }`}
        >
          {num < current ? "✓" : num}
        </div>
        {num < total && (
          <div
            className={`giw-step-connector ${
              num < current ? "giw-step-connector-done" : "giw-step-connector-pending"
            }`}
          />
        )}
      </div>
    ))}
    <div className="giw-step-label">
      {current === 1 && "Upload Document"}
      {current === 2 && "Confirm Spec Type"}
      {current === 3 && "Review & Edit"}
      {current === 4 && "Export"}
    </div>
  </div>
);

export function GeneralImportWizard({
  step,
  setStep,
  file,
  setFile,
  rawText,
  setRawText,
  parsing,
  setParsing,
  detectedType,
  setDetectedType,
  selectedType,
  setSelectedType,
  extracting,
  setExtracting,
  extractedSpec,
  setExtractedSpec,
  error,
  setError,
  fileInputRef,
  autoActivate,
  setAutoActivate,
  onImportComplete,
}: GeneralImportWizardProps) {
  // Handle file upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setParsing(true);

    try {
      // Read file content
      const text = await selectedFile.text();
      setRawText(text);

      // Call parse-document API
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/specs/parse-document", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.ok) {
        setDetectedType(data.suggestedType);
        setSelectedType(data.suggestedType || "CURRICULUM");
        setStep(2);
      } else {
        setError(data.error || "Failed to parse document");
      }
    } catch (err) {
      setError("Error reading file: " + (err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    // Create a synthetic event to reuse handleFileChange logic
    const input = fileInputRef.current;
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(droppedFile);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // Extract structure
  const handleExtract = async () => {
    setExtracting(true);
    setError(null);

    try {
      const res = await fetch("/api/specs/extract-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          specType: selectedType,
          fileName: file?.name,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        setExtractedSpec(data.spec);
        setStep(3);
      } else {
        setError(data.error || "Failed to extract structure");
      }
    } catch (err) {
      setError("Error extracting structure: " + (err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  // Download spec
  const handleDownload = () => {
    if (!extractedSpec) return;

    const blob = new Blob([JSON.stringify(extractedSpec, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${extractedSpec.id || "spec"}.spec.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy to clipboard
  const handleCopy = async () => {
    if (!extractedSpec) return;
    await navigator.clipboard.writeText(JSON.stringify(extractedSpec, null, 2));
  };

  // Import directly
  const handleImportNow = async () => {
    if (!extractedSpec) return;

    setExtracting(true);
    setError(null);

    try {
      const res = await fetch("/api/specs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specs: [extractedSpec],
          autoActivate,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        onImportComplete(data);
      } else {
        setError(data.error || "Failed to import spec");
      }
    } catch (err) {
      setError("Error importing: " + (err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  // Reset wizard
  const handleReset = () => {
    setStep(1);
    setFile(null);
    setRawText("");
    setDetectedType(null);
    setSelectedType("CURRICULUM");
    setExtractedSpec(null);
    setError(null);
  };

  return (
    <div>
      <StepIndicator current={step} total={4} />

      {/* Step 1: Upload */}
      {step === 1 && (
        <div>
          <div
            className="giw-dropzone"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.docx"
              onChange={handleFileChange}
              className="giw-hidden-input"
            />
            {parsing ? (
              <div>
                <div className="giw-drop-icon giw-drop-icon-pulse">🔍</div>
                <div className="giw-drop-title-accent">
                  Analyzing document...
                </div>
                <div className="giw-drop-hint-sm">
                  Detecting structure and spec type
                </div>
              </div>
            ) : (
              <div>
                <div className="giw-drop-icon">✨</div>
                <div className="giw-drop-title">
                  Drop your document here
                </div>
                <div className="giw-drop-subtitle">
                  Supports <strong>.md</strong>, <strong>.txt</strong>, and <strong>.docx</strong> files
                </div>
                <div className="giw-drop-hint">
                  AI will analyze the content and convert it to a spec.json format
                </div>
              </div>
            )}
          </div>

          {/* Info cards */}
          <div className="giw-info-grid">
            <div className="giw-info-card">
              <div className="giw-info-card-icon">📚</div>
              <div className="giw-info-card-title">Curriculum</div>
              <div className="giw-info-card-desc">
                Course outlines, learning modules, training guides
              </div>
            </div>
            <div className="giw-info-card">
              <div className="giw-info-card-icon">📊</div>
              <div className="giw-info-card-title">Measures</div>
              <div className="giw-info-card-desc">
                Behavioral traits, scoring rubrics, assessment criteria
              </div>
            </div>
            <div className="giw-info-card">
              <div className="giw-info-card-icon">🎭</div>
              <div className="giw-info-card-title">Identity</div>
              <div className="giw-info-card-desc">
                Character definitions, persona descriptions, voice guides
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Confirm Type */}
      {step === 2 && (
        <div>
          <div className="giw-doc-info">
            <div className="giw-doc-name">
              Document: <strong>{file?.name}</strong>
            </div>
            {detectedType && (
              <div className="giw-detected-badge">
                <span className="giw-detected-badge-icon">✓</span>
                <span className="giw-detected-badge-text">
                  Suggested: <strong>{detectedType}</strong>
                </span>
              </div>
            )}
          </div>

          <div className="giw-type-section">
            <div className="giw-type-heading">
              Select Spec Type
            </div>
            <div className="giw-type-grid">
              {SPEC_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setSelectedType(type.value)}
                  className={`giw-type-btn ${selectedType === type.value ? "giw-type-btn-selected" : ""}`}
                >
                  <div className="giw-type-btn-inner">
                    <span className="giw-type-icon">{type.icon}</span>
                    <div>
                      <div className="giw-type-label">
                        {type.label}
                        {type.value === detectedType && (
                          <span className="hf-chip-badge">
                            Suggested
                          </span>
                        )}
                      </div>
                      <div className="giw-type-desc">
                        {type.description}
                      </div>
                      <div className="giw-type-best-for">
                        Best for: {type.bestFor}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="giw-actions">
            <button
              onClick={() => setStep(1)}
              className="giw-btn-back"
            >
              Back
            </button>
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="giw-btn-extract"
            >
              {extracting ? (
                <>
                  <span className="giw-spin">⏳</span>
                  Extracting...
                </>
              ) : (
                <>
                  <span>✨</span>
                  Extract Structure
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && extractedSpec && (
        <div>
          <div className="giw-review-header">
            <div className="giw-review-title">
              {extractedSpec.title || extractedSpec.id}
            </div>
            <div className="giw-review-meta">
              ID: {extractedSpec.id} | Type: {extractedSpec.specType} | Role: {extractedSpec.specRole || "—"}
            </div>
          </div>

          {/* JSON Preview */}
          <div className="giw-json-container">
            <pre className="giw-json-pre">
              {JSON.stringify(extractedSpec, null, 2)}
            </pre>
          </div>

          <div className="giw-actions-between">
            <div className="giw-actions-group">
              <button
                onClick={() => setStep(2)}
                className="giw-btn-back-sm"
              >
                Back
              </button>
              <button
                onClick={handleExtract}
                disabled={extracting}
                className="giw-btn-regen"
              >
                Regenerate
              </button>
            </div>
            <button
              onClick={() => setStep(4)}
              className="giw-btn-continue"
            >
              Continue to Export
              <span className="giw-btn-continue-arrow">→</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Export */}
      {step === 4 && extractedSpec && (
        <div>
          <div className="giw-success-banner">
            <div className="giw-success-icon">🎉</div>
            <div className="giw-success-title">
              Spec Ready!
            </div>
            <div className="giw-success-desc">
              <strong>{extractedSpec.title}</strong> has been converted to .spec.json format
            </div>
          </div>

          {/* Export options */}
          <div className="giw-export-grid">
            <button
              onClick={handleDownload}
              className="giw-export-btn"
            >
              <div className="giw-export-btn-icon">💾</div>
              <div className="giw-export-btn-title">
                Download JSON
              </div>
              <div className="giw-export-btn-desc">
                Save .spec.json file to disk
              </div>
            </button>

            <button
              onClick={handleCopy}
              className="giw-export-btn"
            >
              <div className="giw-export-btn-icon">📋</div>
              <div className="giw-export-btn-title">
                Copy to Clipboard
              </div>
              <div className="giw-export-btn-desc">
                Copy JSON for manual paste
              </div>
            </button>

            <button
              onClick={handleImportNow}
              disabled={extracting}
              className="giw-import-btn"
            >
              <div className="giw-import-btn-inner">
                <div className="giw-import-btn-icon">🚀</div>
                <div>
                  <div className="giw-import-btn-title">
                    {extracting ? "Importing..." : "Import Now"}
                  </div>
                  <div className="giw-import-btn-desc">
                    Import directly to database and activate
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* Auto-activate option */}
          <div className="giw-auto-activate">
            <label className="giw-auto-activate-label">
              <input
                type="checkbox"
                checked={autoActivate}
                onChange={(e) => setAutoActivate(e.target.checked)}
                className="giw-auto-activate-checkbox"
              />
              <div>
                <span className="giw-auto-activate-text">
                  Auto-activate on import
                </span>
                <div className="giw-auto-activate-hint">
                  Create Parameters, ScoringAnchors, and AnalysisSpec records
                </div>
              </div>
            </label>
          </div>

          <div className="giw-bottom-actions">
            <button
              onClick={() => setStep(3)}
              className="giw-btn-back-sm"
            >
              Back to Review
            </button>
            <button
              onClick={handleReset}
              className="giw-btn-back-sm"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="giw-error">
          <span className="giw-error-icon">⚠️</span>
          <span className="giw-error-text">{error}</span>
          <button
            onClick={() => setError(null)}
            className="giw-error-dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
