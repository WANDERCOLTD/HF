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
  const [packTimedOut, setPackTimedOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const packTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const domainId = getData<string>('domainId') || '';
  const courseName = getData<string>('courseName') || '';
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

  // Pack mode safety timeout — if PackUploadStep doesn't call back within 5 min, show nav buttons
  useEffect(() => {
    if (uploadMode === 'pack' && !packComplete && !packTimedOut) {
      packTimeoutRef.current = setTimeout(() => setPackTimedOut(true), 5 * 60 * 1000);
    }
    return () => {
      if (packTimeoutRef.current) clearTimeout(packTimeoutRef.current);
    };
  }, [uploadMode, packComplete, packTimedOut]);

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
      if (uploadedSourceId && !file) { onNext(); return; }
      if (uploadedSourceId) { onNext(); return; }
      if (!file) return;

      setUploading(true);
      setUploadError(null);

      // Abort any previous upload
      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 120_000);

      try {
        const slug = `course-upload-${Date.now()}`;
        const name = file.name.replace(/\.[^.]+$/, '');
        const createRes = await fetch('/api/content-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, name, description: 'Uploaded via Course Setup Wizard', trustLevel: 'UNVERIFIED' }),
          signal: controller.signal,
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || 'Failed to create content source');
        const sourceId = createData.source.id;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', 'classify');
        const importRes = await fetch(`/api/content-sources/${sourceId}/import`, {
          method: 'POST', body: formData, signal: controller.signal,
        });
        const importData = await importRes.json();
        if (!importRes.ok) throw new Error(importData.error || 'File upload failed');

        setData('sourceId', sourceId);
        setData('contentFileName', file.name);
        setUploadedSourceId(sourceId);
        onNext();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          setUploadError('Upload timed out. Please try again.');
        } else {
          setUploadError(err instanceof Error ? err.message : 'Upload failed');
        }
      } finally {
        clearTimeout(timeout);
        setUploading(false);
      }
    } else if (uploadMode === 'describe') {
      setData('contentDescription', description);
      onNext();
    } else if (uploadMode === 'pack' && packComplete) {
      onNext();
    }
  };

  const handlePackResult = useCallback((result: PackUploadResult) => {
    if (packTimeoutRef.current) clearTimeout(packTimeoutRef.current);

    if (result.mode === 'skip') {
      setData('contentMode', 'skip');
      onNext();
      return;
    }
    if (result.mode === 'pack-upload') {
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

  const handleSkip = () => {
    setData('contentMode', 'skip');
    setData('contentFileName', undefined);
    setData('sourceId', undefined);
    onNext();
  };

  const hasFile = !!file;
  const isValid =
    uploadMode === 'file' ? (hasFile || !!uploadedSourceId) :
    uploadMode === 'describe' ? description.trim().length > 0 :
    uploadMode === 'pack' ? packComplete :
    false;

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <FieldHint label="Add Content" hint={WIZARD_HINTS["course.content"]} labelClass="hf-page-title hf-mb-sm" />
          <p className="hf-page-subtitle">Upload your course files, or describe your topics</p>
        </div>

        {/* Mode Toggle */}
        <div className="hf-chip-card-row">
          <button onClick={() => setUploadMode('pack')} className={`hf-chip-card${uploadMode === 'pack' ? ' hf-chip-card-selected' : ''}`}>
            <FolderUp className="hf-chip-card-icon" />
            <h3 className="hf-chip-card-title">Course Pack</h3>
            <p className="hf-chip-card-desc">Multiple files</p>
          </button>
          <button onClick={() => setUploadMode('file')} className={`hf-chip-card${uploadMode === 'file' ? ' hf-chip-card-selected' : ''}`}>
            <Upload className="hf-chip-card-icon" />
            <h3 className="hf-chip-card-title">Single File</h3>
            <p className="hf-chip-card-desc">PDF, DOCX, TXT, MD</p>
          </button>
          <button onClick={() => setUploadMode('describe')} className={`hf-chip-card${uploadMode === 'describe' ? ' hf-chip-card-selected' : ''}`}>
            <span className="hf-chip-card-emoji">{'\u270D\uFE0F'}</span>
            <h3 className="hf-chip-card-title">Describe</h3>
            <p className="hf-chip-card-desc">Write topics in text</p>
          </button>
        </div>

        {/* Pack Upload */}
        {uploadMode === 'pack' && (
          <div className="hf-mb-lg">
            {packComplete && packSummary ? (
              <div className="hf-banner hf-banner-success">
                <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span>{packSummary}</span>
              </div>
            ) : (
              <PackUploadStep domainId={domainId} courseName={courseName} onResult={handlePackResult} onBack={onPrev} />
            )}
          </div>
        )}

        {/* Single File Upload */}
        {uploadMode === 'file' && (
          <div className="hf-mb-lg">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`hf-drop-zone${dragOver ? ' hf-drop-zone-active' : ''}${uploading ? ' hf-drop-zone-disabled' : ''}`}
            >
              {uploadedSourceId && !file ? (
                <div>
                  <CheckCircle className="hf-icon-md hf-text-success hf-icon-block" />
                  <p className="hf-text-sm hf-text-bold">{savedFileName || 'File uploaded'}</p>
                  <p className="hf-text-sm hf-text-success">Uploaded and ready</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setUploadedSourceId(null); setData('sourceId', undefined); }}
                    className="hf-link-accent hf-text-xs hf-mt-xs"
                  >
                    Choose different file
                  </button>
                </div>
              ) : file ? (
                <div>
                  <p className="hf-text-sm hf-text-bold">{file.name}</p>
                  <p className="hf-text-sm hf-text-secondary">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="hf-link-accent hf-text-xs hf-mt-xs"
                  >
                    Choose different file
                  </button>
                </div>
              ) : savedFileName && !uploadedSourceId ? (
                <div>
                  <AlertCircle className="hf-icon-md hf-text-warning hf-icon-block" />
                  <p className="hf-text-sm hf-text-bold">{savedFileName}</p>
                  <p className="hf-text-sm hf-text-warning">File needs to be re-selected after page refresh</p>
                  <p className="hf-text-xs hf-text-secondary hf-mt-xs">Click to re-upload, or Skip this step</p>
                </div>
              ) : (
                <div>
                  <Upload className="hf-icon-lg hf-text-tertiary hf-icon-block" />
                  <p className="hf-text-sm hf-text-bold">Drag your file here</p>
                  <p className="hf-text-sm hf-text-secondary hf-mt-xs">or click to select</p>
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
              <div className="hf-banner hf-banner-error hf-mt-sm">
                <AlertCircle className="hf-icon-sm hf-flex-shrink-0" />
                <span className="hf-flex-1">{uploadError}</span>
                <button onClick={() => setUploadError(null)} className="hf-link-subtle hf-text-xs">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* Describe Topics */}
        {uploadMode === 'describe' && (
          <div className="hf-mb-lg">
            <label className="hf-label">Describe your course topics</label>
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

      {/* Footer — always visible so user is never stuck */}
      <div className="hf-step-footer">
        <button onClick={onPrev} className="hf-btn hf-btn-ghost" disabled={uploading}>
          Back
        </button>
        {/* Pack mode: PackUploadStep has its own nav, but show Skip as safety escape */}
        {uploadMode === 'pack' && !packComplete ? (
          <button onClick={handleSkip} className="hf-btn hf-btn-ghost">
            Skip
          </button>
        ) : (
          <div className="hf-flex hf-gap-md hf-items-center">
            <button onClick={handleSkip} className="hf-btn hf-btn-ghost" disabled={uploading}>
              Skip
            </button>
            <button onClick={handleNext} disabled={!isValid || uploading} className="hf-btn hf-btn-primary">
              {uploading ? (
                <>Uploading<div className="hf-spinner hf-icon-sm" /></>
              ) : (
                <>Next <ArrowRight className="hf-icon-sm" /></>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
