'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, Upload, AlertCircle, CheckCircle, FolderUp } from 'lucide-react';
import { PackUploadStep } from '@/components/wizards/PackUploadStep';
import type { PackUploadResult } from '@/components/wizards/PackUploadStep';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';

export function ContentStep({ setData, getData, onNext, onPrev }: StepProps) {
  const [uploadMode, setUploadMode] = useState<'file' | 'pack' | 'describe'>('pack');
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedSourceId, setUploadedSourceId] = useState<string | null>(null);
  const [packComplete, setPackComplete] = useState(false);
  const [packSummary, setPackSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get domain/course info from flow context
  const domainId = getData<string>('domainId') || '';
  const courseName = getData<string>('courseName') || '';

  // Restore saved file name indicator from context
  const savedFileName = getData<string>('contentFileName');

  // Load saved data
  useEffect(() => {
    const savedMode = getData<'file' | 'pack' | 'describe'>('contentMode');
    if (savedMode) setUploadMode(savedMode);
    const savedDesc = getData<string>('contentDescription');
    if (savedDesc) setDescription(savedDesc);
    const savedSourceId = getData<string>('sourceId');
    if (savedSourceId) setUploadedSourceId(savedSourceId);
    const savedPackComplete = getData<boolean>('packComplete');
    if (savedPackComplete) setPackComplete(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      if (uploadedSourceId) {
        setUploadedSourceId(null);
        setData('sourceId', undefined);
      }
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    if (uploadedSourceId) {
      setUploadedSourceId(null);
      setData('sourceId', undefined);
    }
  };

  const handleNext = async () => {
    setData('contentMode', uploadMode);

    if (uploadMode === 'file' && (file || uploadedSourceId)) {
      if (uploadedSourceId && !file) {
        onNext();
        return;
      }
      if (uploadedSourceId) {
        onNext();
        return;
      }

      if (!file) return;

      setUploading(true);
      setUploadError(null);

      try {
        const slug = `course-upload-${Date.now()}`;
        const name = file.name.replace(/\.[^.]+$/, '');
        const createRes = await fetch('/api/content-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            name,
            description: 'Uploaded via Course Setup Wizard',
            trustLevel: 'UNVERIFIED',
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || 'Failed to create content source');
        const sourceId = createData.source.id;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', 'classify');
        const importRes = await fetch(`/api/content-sources/${sourceId}/import`, {
          method: 'POST',
          body: formData,
        });
        const importData = await importRes.json();
        if (!importRes.ok) throw new Error(importData.error || 'File upload failed');

        setData('sourceId', sourceId);
        setData('contentFileName', file.name);
        setUploadedSourceId(sourceId);
        onNext();
      } catch (err: unknown) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    } else if (uploadMode === 'describe') {
      setData('contentDescription', description);
      onNext();
    } else if (uploadMode === 'pack' && packComplete) {
      onNext();
    }
  };

  // ── Pack upload result handler ──
  const handlePackResult = useCallback((result: PackUploadResult) => {
    if (result.mode === 'skip') {
      setData('contentMode', 'skip');
      onNext();
      return;
    }

    if (result.mode === 'pack-upload') {
      // Pack ingestion complete
      setData('packTaskId', result.taskId);
      setData('packSubjects', result.subjects);
      setData('packSourceCount', result.sourceCount);
      setData('packComplete', true);
      setData('contentMode', 'pack');
      setPackComplete(true);
      const subjectNames = (result.subjects || []).map((s) => s.name).join(', ');
      setPackSummary(`${result.subjects?.length || 0} subject${(result.subjects?.length || 0) !== 1 ? 's' : ''} · ${result.sourceCount || 0} files uploaded (${subjectNames})`);
      onNext();
    }

    if (result.mode === 'existing-course') {
      setData('existingCourseId', result.courseId);
      setData('contentMode', 'existing-course');
      setPackComplete(true);
      onNext();
    }
  }, [setData, onNext]);

  const hasFile = !!file;
  const isValid =
    uploadMode === 'file' ? (hasFile || !!uploadedSourceId) :
    uploadMode === 'describe' ? description.trim().length > 0 :
    uploadMode === 'pack' ? packComplete :
    false;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <div className="mb-8">
          <FieldHint label="Add Content" hint={WIZARD_HINTS["course.content"]} labelClass="hf-page-title hf-mb-sm" />
          <p className="hf-page-subtitle">Upload your course files, or describe your topics</p>
        </div>

        {/* Mode Toggle — 3 options */}
        <div className="hf-chip-card-row">
          <button
            onClick={() => setUploadMode('pack')}
            className={`hf-chip-card${uploadMode === 'pack' ? ' hf-chip-card-selected' : ''}`}
          >
            <FolderUp className="hf-chip-card-icon" />
            <h3 className="hf-chip-card-title">Course Pack</h3>
            <p className="hf-chip-card-desc">Multiple files</p>
          </button>
          <button
            onClick={() => setUploadMode('file')}
            className={`hf-chip-card${uploadMode === 'file' ? ' hf-chip-card-selected' : ''}`}
          >
            <Upload className="hf-chip-card-icon" />
            <h3 className="hf-chip-card-title">Single File</h3>
            <p className="hf-chip-card-desc">PDF, DOCX, TXT, MD</p>
          </button>
          <button
            onClick={() => setUploadMode('describe')}
            className={`hf-chip-card${uploadMode === 'describe' ? ' hf-chip-card-selected' : ''}`}
          >
            <span className="hf-chip-card-emoji">{'\u270D\uFE0F'}</span>
            <h3 className="hf-chip-card-title">Describe</h3>
            <p className="hf-chip-card-desc">Write topics in text</p>
          </button>
        </div>

        {/* Pack Upload */}
        {uploadMode === 'pack' && (
          <div className="mb-8">
            {packComplete && packSummary ? (
              <div className="hf-banner hf-banner-success">
                <CheckCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span>{packSummary}</span>
              </div>
            ) : (
              <PackUploadStep
                domainId={domainId}
                courseName={courseName}
                onResult={handlePackResult}
                onBack={onPrev}
              />
            )}
          </div>
        )}

        {/* Single File Upload */}
        {uploadMode === 'file' && (
          <div className="mb-8">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`p-8 rounded-lg border-2 border-dashed text-center cursor-pointer transition-all ${
                dragOver ? 'border-[var(--accent)] bg-[var(--accent)] bg-opacity-5' : 'border-[var(--border-default)]'
              } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              {uploadedSourceId && !file ? (
                <div>
                  <CheckCircle className="w-5 h-5 text-[var(--status-success-text)] mx-auto mb-2" />
                  <p className="font-semibold text-[var(--text-primary)]">{savedFileName || 'File uploaded'}</p>
                  <p className="text-sm text-[var(--status-success-text)]">Uploaded and ready</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadedSourceId(null);
                      setData('sourceId', undefined);
                    }}
                    className="text-xs text-[var(--accent)] hover:underline mt-2"
                  >
                    Choose different file
                  </button>
                </div>
              ) : file ? (
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{file.name}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-xs text-[var(--accent)] hover:underline mt-2"
                  >
                    Choose different file
                  </button>
                </div>
              ) : savedFileName && !uploadedSourceId ? (
                <div>
                  <AlertCircle className="w-5 h-5 text-[var(--status-warning-text)] mx-auto mb-2" />
                  <p className="font-semibold text-[var(--text-primary)]">{savedFileName}</p>
                  <p className="text-sm text-[var(--status-warning-text)]">File needs to be re-selected after page refresh</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">Click to re-upload, or Skip this step</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-2" />
                  <p className="font-semibold text-[var(--text-primary)]">Drag your file here</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">or click to select</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => e.currentTarget.files?.[0] && handleFileSelect(e.currentTarget.files[0])}
                className="hidden"
              />
            </div>

            {uploadError && (
              <div className="hf-banner hf-banner-error" style={{ marginTop: 12 }}>
                <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{uploadError}</span>
                <button
                  onClick={() => setUploadError(null)}
                  className="hf-btn-ghost"
                  style={{ padding: 0, fontSize: 12, color: "inherit", textDecoration: "underline" }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* Describe Topics */}
        {uploadMode === 'describe' && (
          <div className="mb-8">
            <label className="block text-sm font-semibold text-[var(--text-primary)] mb-2">
              Describe your course topics
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g., 'This course covers photosynthesis, cellular respiration, and ecology. Students should understand how plants convert sunlight to energy...'"
              rows={6}
              className="hf-input"
            />
          </div>
        )}
      </div>

      {/* Footer — only show for non-pack modes (pack has its own buttons) */}
      {uploadMode !== 'pack' && (
        <div className="hf-step-footer">
          <button
            onClick={onPrev}
            className="hf-btn hf-btn-ghost"
            disabled={uploading}
          >
            Back
          </button>
          <div className="hf-flex hf-gap-md hf-items-center">
            <button
              onClick={() => {
                setData('contentMode', 'skip');
                setData('contentFileName', undefined);
                setData('sourceId', undefined);
                onNext();
              }}
              className="hf-btn hf-btn-ghost"
              disabled={uploading}
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              disabled={!isValid || uploading}
              className="hf-btn hf-btn-primary"
            >
              {uploading ? (
                <>Uploading<div className="hf-spinner" style={{ width: 16, height: 16 }} /></>
              ) : (
                <>Next <ArrowRight style={{ width: 16, height: 16 }} /></>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
