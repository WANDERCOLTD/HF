'use client';

/**
 * PackUploadStep — shared multi-file content upload component for Course wizards.
 *
 * Two modes:
 * 1. "Select existing Course" — pick a Course (Playbook) already created for this domain
 * 2. "Upload new files" — multi-file drop → AI analyze → review manifest → ingest
 *
 * Shared between Teach wizard and Course Setup wizard.
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, BookOpen, X, Edit3, Check, Plus } from 'lucide-react';
import './demo-teach-wizard.css';

// ── Types ──────────────────────────────────────────────

interface PackFile {
  fileIndex: number;
  fileName: string;
  documentType: string;
  role: 'passage' | 'questions' | 'reference' | 'pedagogy';
  confidence: number;
  reasoning: string;
}

interface PackGroup {
  groupName: string;
  suggestedSubjectName: string;
  files: PackFile[];
}

interface PackManifest {
  groups: PackGroup[];
  pedagogyFiles: PackFile[];
}

interface ExistingCourse {
  id: string;
  name: string;
  status: string;
  subjectCount: number;
  assertionCount: number;
}

interface ExistingSubject {
  id: string;
  name: string;
  sourceCount: number;
  assertionCount: number;
}

export interface PackUploadResult {
  mode: 'existing-course' | 'existing-subject' | 'pack-upload' | 'skip';
  // existing course selection
  courseId?: string;
  courseName?: string;
  // existing subject selection
  subjectId?: string;
  subjectName?: string;
  // pack upload results
  taskId?: string;
  subjects?: Array<{ id: string; name: string }>;
  sourceCount?: number;
  /** Classification info per file from the analyze manifest */
  classifications?: Array<{
    fileName: string;
    documentType: string;
    confidence: number;
    reasoning: string;
  }>;
}

interface PackUploadStepProps {
  domainId: string;
  domainSlug?: string;
  courseName: string;
  existingCourses?: ExistingCourse[];
  /** When provided, shows subject picker instead of course picker */
  existingSubjects?: ExistingSubject[];
  onResult: (result: PackUploadResult) => void;
  onBack?: () => void;
}

// ── Constants ──────────────────────────────────────────

const VALID_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.json'];
const ACCEPT_ATTR = VALID_EXTENSIONS.join(',');

const DOC_TYPE_LABELS: Record<string, string> = {
  COMPREHENSION: 'Reading',
  ASSESSMENT: 'Questions',
  TEXTBOOK: 'Textbook',
  WORKSHEET: 'Worksheet',
  CURRICULUM: 'Curriculum',
  LESSON_PLAN: 'Teaching Guide',
  REFERENCE: 'Reference',
  EXAMPLE: 'Example',
  POLICY_DOCUMENT: 'Policy',
  READING_PASSAGE: 'Reading Passage',
  QUESTION_BANK: 'Question Bank',
};

// Auto-derive role from document type
const TYPE_TO_ROLE: Record<string, PackFile['role']> = {
  READING_PASSAGE: 'passage',
  TEXTBOOK: 'passage',
  COMPREHENSION: 'passage',
  QUESTION_BANK: 'questions',
  ASSESSMENT: 'questions',
  WORKSHEET: 'questions',
  LESSON_PLAN: 'pedagogy',
  POLICY_DOCUMENT: 'pedagogy',
  REFERENCE: 'reference',
  CURRICULUM: 'reference',
  EXAMPLE: 'reference',
};

const ROLE_ICONS: Record<string, string> = {
  passage: '\u{1F4D6}',    // open book
  questions: '\u{2753}',    // question mark
  reference: '\u{1F4DA}',  // books
  pedagogy: '\u{1F4CB}',   // clipboard
};

// ── Component ──────────────────────────────────────────

export function PackUploadStep({
  domainId,
  courseName,
  existingCourses = [],
  existingSubjects = [],
  onResult,
  onBack,
}: PackUploadStepProps) {
  // Mode: 'select' (pick existing course/subject) or 'upload' (multi-file pack)
  const hasExistingItems = existingCourses.length > 0 || existingSubjects.length > 0;
  const [mode, setMode] = useState<'select' | 'upload'>(hasExistingItems ? 'select' : 'upload');

  // File state
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Ingestion state
  const [ingesting, setIngesting] = useState(false);
  const [ingestProgress, setIngestProgress] = useState<string>('');
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Course / subject selection
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);

  // Editing manifest
  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  // Drag-between-groups
  const [dragSource, setDragSource] = useState<{ fileIndex: number; fromGroupIdx: number } | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);

  // ── File handling ──────────────────────────────────

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const valid = Array.from(newFiles).filter((f) => {
      const name = f.name.toLowerCase();
      return VALID_EXTENSIONS.some((ext) => name.endsWith(ext));
    });
    if (valid.length === 0) return;

    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const unique = valid.filter((f) => !existingNames.has(f.name));
      return [...prev, ...unique];
    });
    // Reset analysis when files change
    setManifest(null);
    setAnalyzeError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setManifest(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  // ── Analyze ────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (files.length === 0) return;

    setAnalyzing(true);
    setAnalyzeError(null);

    try {
      const formData = new FormData();
      formData.append('courseName', courseName);
      formData.append('domainId', domainId);
      for (const file of files) {
        formData.append('files', file);
      }

      const res = await fetch('/api/course-pack/analyze', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setManifest(data.manifest);
    } catch (err: unknown) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [files, courseName, domainId, onResult]);

  // ── Ingest ─────────────────────────────────────────

  const handleIngest = useCallback(async () => {
    if (!manifest) return;

    setIngesting(true);
    setIngestError(null);
    setIngestProgress('Uploading files...');

    try {
      const formData = new FormData();
      formData.append('manifest', JSON.stringify(manifest));
      formData.append('domainId', domainId);
      formData.append('courseName', courseName);
      for (const file of files) {
        formData.append('files', file);
      }

      const res = await fetch('/api/course-pack/ingest', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Ingest failed');
      }

      // Extract classification info from manifest for the wizard UI
      const classifications = manifest.groups.flatMap(g =>
        g.files.map(f => ({
          fileName: f.fileName,
          documentType: f.documentType,
          confidence: f.confidence,
          reasoning: f.reasoning,
        }))
      );

      setIngesting(false);

      // Fire-and-forget: advance immediately after 202, background extraction runs on server
      onResult({
        mode: 'pack-upload',
        taskId: data.taskId,
        subjects: data.subjects,
        sourceCount: data.sourceCount,
        classifications,
      });
    } catch (err: unknown) {
      setIngestError(err instanceof Error ? err.message : 'Ingest failed');
      setIngesting(false);
    }
  }, [manifest, domainId, courseName, files, onResult]);

  // ── Select existing course ─────────────────────────

  const handleSelectCourse = useCallback(() => {
    if (!selectedCourseId) return;
    const course = existingCourses.find((c) => c.id === selectedCourseId);
    onResult({
      mode: 'existing-course',
      courseId: selectedCourseId,
      courseName: course?.name,
    });
  }, [selectedCourseId, existingCourses, onResult]);

  const handleSelectSubject = useCallback(() => {
    if (!selectedSubjectId) return;
    const subject = existingSubjects.find((s) => s.id === selectedSubjectId);
    onResult({
      mode: 'existing-subject',
      subjectId: selectedSubjectId,
      subjectName: subject?.name,
    });
  }, [selectedSubjectId, existingSubjects, onResult]);

  // ── Manifest editing ───────────────────────────────

  const startEditGroup = useCallback((idx: number) => {
    setEditingGroupIdx(idx);
    setEditingName(manifest?.groups[idx]?.suggestedSubjectName || '');
  }, [manifest]);

  const saveEditGroup = useCallback(() => {
    if (editingGroupIdx === null || !manifest) return;
    const updated = { ...manifest };
    updated.groups = [...updated.groups];
    updated.groups[editingGroupIdx] = {
      ...updated.groups[editingGroupIdx],
      suggestedSubjectName: editingName,
      groupName: editingName,
    };
    setManifest(updated);
    setEditingGroupIdx(null);
  }, [editingGroupIdx, editingName, manifest]);

  // ── Change file document type ─────────────────
  const handleChangeFileType = useCallback((
    fileIndex: number,
    newType: string,
    source: 'group' | 'pedagogy',
    groupIdx?: number,
  ) => {
    if (!manifest) return;
    const updated = { ...manifest };
    const newRole = TYPE_TO_ROLE[newType] || 'passage';

    if (source === 'group' && groupIdx !== undefined) {
      updated.groups = updated.groups.map((g, gi) =>
        gi !== groupIdx ? g : {
          ...g,
          files: g.files.map((f) =>
            f.fileIndex !== fileIndex ? f : { ...f, documentType: newType, role: newRole },
          ),
        },
      );
    } else {
      updated.pedagogyFiles = updated.pedagogyFiles.map((f) =>
        f.fileIndex !== fileIndex ? f : { ...f, documentType: newType, role: newRole },
      );
    }
    setManifest(updated);
  }, [manifest]);

  // ── Drag file between groups ────────────────────

  const handleFileDragStart = useCallback((e: React.DragEvent, fileIndex: number, fromGroupIdx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragSource({ fileIndex, fromGroupIdx });
  }, []);

  const handleGroupDragOver = useCallback((e: React.DragEvent, groupIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupIdx(groupIdx);
  }, []);

  const handleGroupDragLeave = useCallback(() => {
    setDragOverGroupIdx(null);
  }, []);

  const handleGroupDrop = useCallback((e: React.DragEvent, toGroupIdx: number) => {
    e.preventDefault();
    setDragOverGroupIdx(null);

    if (!dragSource || !manifest) return;
    const { fileIndex, fromGroupIdx } = dragSource;
    if (fromGroupIdx === toGroupIdx) {
      setDragSource(null);
      return;
    }

    const updated = { ...manifest };
    updated.groups = updated.groups.map((g) => ({ ...g, files: [...g.files] }));

    // Find and remove file from source group
    const sourceFiles = updated.groups[fromGroupIdx].files;
    const fileIdx = sourceFiles.findIndex((f) => f.fileIndex === fileIndex);
    if (fileIdx === -1) { setDragSource(null); return; }
    const [movedFile] = sourceFiles.splice(fileIdx, 1);

    // Add to target group
    updated.groups[toGroupIdx].files.push(movedFile);

    // Remove empty source group
    if (updated.groups[fromGroupIdx].files.length === 0) {
      updated.groups.splice(fromGroupIdx, 1);
    }

    setManifest(updated);
    setDragSource(null);
  }, [dragSource, manifest]);

  const handleFileDragEnd = useCallback(() => {
    setDragSource(null);
    setDragOverGroupIdx(null);
  }, []);

  // ── Render ─────────────────────────────────────────

  return (
    <div className="pack-upload-step">
      {/* Mode toggle (only when existing items available) */}
      {hasExistingItems && (
        <div className="pack-mode-toggle">
          <button
            className={`pack-mode-btn ${mode === 'select' ? 'pack-mode-btn--active' : ''}`}
            onClick={() => setMode('select')}
            disabled={analyzing || ingesting}
          >
            <BookOpen size={16} />
            {existingSubjects.length > 0 ? 'Use Existing Subject' : 'Use Existing Course'}
          </button>
          <button
            className={`pack-mode-btn ${mode === 'upload' ? 'pack-mode-btn--active' : ''}`}
            onClick={() => setMode('upload')}
            disabled={analyzing || ingesting}
          >
            <Upload size={16} />
            Upload New Files
          </button>
        </div>
      )}

      {/* ── MODE A: Select existing subject or course ── */}
      {mode === 'select' && existingSubjects.length > 0 && (
        <div className="pack-select-courses">
          <p className="pack-section-desc">
            Pick a subject with existing content to teach from.
          </p>
          <div className="pack-course-list">
            {existingSubjects.map((subject) => (
              <button
                key={subject.id}
                className={`dtw-source-card ${selectedSubjectId === subject.id ? 'dtw-source-card--selected' : ''}`}
                onClick={() => setSelectedSubjectId(selectedSubjectId === subject.id ? null : subject.id)}
              >
                <div className="dtw-source-card-name">
                  <BookOpen size={16} />
                  {subject.name}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="dtw-source-card-pill">
                    {subject.sourceCount} source{subject.sourceCount !== 1 ? 's' : ''}
                  </span>
                  <span className="dtw-source-card-pill">
                    {subject.assertionCount} teaching point{subject.assertionCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="dtw-upload-actions">
            {onBack && (
              <button className="dtw-btn-skip" onClick={onBack}>Back</button>
            )}
            <button className="dtw-btn-skip" onClick={() => onResult({ mode: 'skip' })}>
              Skip for now
            </button>
            <button
              className="dtw-btn-upload"
              disabled={!selectedSubjectId}
              onClick={handleSelectSubject}
            >
              Use This Subject
            </button>
          </div>
        </div>
      )}
      {mode === 'select' && existingSubjects.length === 0 && existingCourses.length > 0 && (
        <div className="pack-select-courses">
          <p className="pack-section-desc">
            Pick a course to teach from. All its subjects and content come with it.
          </p>
          <div className="pack-course-list">
            {existingCourses.map((course) => (
              <button
                key={course.id}
                className={`dtw-source-card ${selectedCourseId === course.id ? 'dtw-source-card--selected' : ''}`}
                onClick={() => setSelectedCourseId(selectedCourseId === course.id ? null : course.id)}
              >
                <div className="dtw-source-card-name">
                  <BookOpen size={16} />
                  {course.name}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="dtw-source-card-pill">
                    {course.subjectCount} subject{course.subjectCount !== 1 ? 's' : ''}
                  </span>
                  <span className="dtw-source-card-pill">
                    {course.assertionCount} teaching point{course.assertionCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="dtw-upload-actions">
            {onBack && (
              <button className="dtw-btn-skip" onClick={onBack}>Back</button>
            )}
            <button className="dtw-btn-skip" onClick={() => onResult({ mode: 'skip' })}>
              Skip for now
            </button>
            <button
              className="dtw-btn-upload"
              disabled={!selectedCourseId}
              onClick={handleSelectCourse}
            >
              Use This Course
            </button>
          </div>
        </div>
      )}

      {/* ── MODE B: Upload new files ── */}
      {mode === 'upload' && !manifest && !ingesting && (
        <div className="pack-upload-section">
          {/* Drop zone */}
          <div
            className={`dtw-dropzone ${dragOver ? 'dtw-dropzone--active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dtw-dropzone-icon">
              <Upload size={32} />
            </div>
            <div className="dtw-dropzone-filename">
              Drop your files here
            </div>
            <div className="dtw-dropzone-hint">
              Readings, questions, course docs — PDF, DOCX, TXT, MD, JSON
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="dtw-file-input-hidden"
            accept={ACCEPT_ATTR}
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                addFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          {/* File list */}
          {files.length > 0 && (
            <div className="pack-file-list">
              {files.map((file, idx) => (
                <div key={file.name} className="pack-file-item">
                  <FileText size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                  <span className="pack-file-name">{file.name}</span>
                  <span className="pack-file-size">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    className="pack-file-remove"
                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {analyzeError && (
            <div className="dtw-upload-error">{analyzeError}</div>
          )}

          <div className="dtw-upload-actions">
            {onBack && (
              <button className="dtw-btn-skip" onClick={onBack} disabled={analyzing}>Back</button>
            )}
            <button className="dtw-btn-skip" onClick={() => onResult({ mode: 'skip' })} disabled={analyzing}>
              Skip for now
            </button>
            <button
              className="dtw-btn-upload"
              disabled={files.length === 0 || analyzing}
              onClick={handleAnalyze}
            >
              {analyzing ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dtw-pulse-dot" /> Analyzing {files.length} files...
                </span>
              ) : (
                `Analyze ${files.length} File${files.length !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Manifest review ── */}
      {manifest && !ingesting && (
        <div className="pack-manifest-review">
          <p className="pack-section-desc">
            We found {manifest.groups.length} subject{manifest.groups.length !== 1 ? 's' : ''}
            {manifest.pedagogyFiles.length > 0 && ` and ${manifest.pedagogyFiles.length} teaching guide${manifest.pedagogyFiles.length !== 1 ? 's' : ''}`}.
            Review and edit before uploading.
          </p>

          {manifest.groups.map((group, gIdx) => (
            <div
              key={gIdx}
              className={`pack-group-card${dragOverGroupIdx === gIdx ? ' pack-group-card--drag-over' : ''}`}
              onDragOver={(e) => handleGroupDragOver(e, gIdx)}
              onDragLeave={handleGroupDragLeave}
              onDrop={(e) => handleGroupDrop(e, gIdx)}
            >
              <div className="pack-group-header">
                <BookOpen size={16} />
                {editingGroupIdx === gIdx ? (
                  <div className="pack-group-edit">
                    <input
                      className="pack-group-edit-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEditGroup(); }}
                      autoFocus
                    />
                    <button className="pack-group-edit-btn" onClick={saveEditGroup}>
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="pack-group-name">{group.suggestedSubjectName}</span>
                    <button
                      className="pack-group-edit-trigger"
                      onClick={() => startEditGroup(gIdx)}
                      title="Rename subject"
                    >
                      <Edit3 size={12} />
                    </button>
                  </>
                )}
              </div>
              <div className="pack-group-files">
                {group.files.map((f) => (
                  <div
                    key={f.fileIndex}
                    className={`pack-manifest-file${dragSource?.fileIndex === f.fileIndex ? ' pack-manifest-file--dragging' : ''}`}
                    draggable
                    onDragStart={(e) => handleFileDragStart(e, f.fileIndex, gIdx)}
                    onDragEnd={handleFileDragEnd}
                  >
                    <span className="pack-file-role-icon">{ROLE_ICONS[f.role] || '\u{1F4C4}'}</span>
                    <span className="pack-file-name">{f.fileName}</span>
                    <select
                      className="pack-file-type-select"
                      value={f.documentType}
                      onChange={(e) => { e.stopPropagation(); handleChangeFileType(f.fileIndex, e.target.value, 'group', gIdx); }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {manifest.pedagogyFiles.length > 0 && (
            <div className="pack-group-card pack-group-card--pedagogy">
              <div className="pack-group-header">
                <span>{'\u{1F4CB}'}</span>
                <span className="pack-group-name">Teaching Guides</span>
              </div>
              <div className="pack-group-files">
                {manifest.pedagogyFiles.map((f) => (
                  <div key={f.fileIndex} className="pack-manifest-file">
                    <span className="pack-file-role-icon">{ROLE_ICONS.pedagogy}</span>
                    <span className="pack-file-name">{f.fileName}</span>
                    <select
                      className="pack-file-type-select"
                      value={f.documentType}
                      onChange={(e) => handleChangeFileType(f.fileIndex, e.target.value, 'pedagogy')}
                    >
                      {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ingestError && (
            <div className="dtw-upload-error">{ingestError}</div>
          )}

          <div className="dtw-upload-actions">
            <button className="dtw-btn-skip" onClick={() => { setManifest(null); }}>
              Re-analyze
            </button>
            <button
              className="pack-btn-add-more"
              onClick={() => {
                setManifest(null);
                setTimeout(() => fileInputRef.current?.click(), 100);
              }}
            >
              <Plus size={14} />
              Add More Files
            </button>
            <button className="dtw-btn-upload" onClick={handleIngest}>
              Upload &amp; Extract All
            </button>
          </div>
        </div>
      )}

      {/* ── Ingesting progress ── */}
      {ingesting && (
        <div className="pack-ingest-progress">
          <div className="dtw-extract-status">
            <div className="dtw-pulse-dot" />
            <div className="dtw-extract-label">{ingestProgress || 'Processing...'}</div>
          </div>
          <div className="dtw-progress-track">
            <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
            Creating subjects, uploading files, and extracting teaching points...
          </p>
        </div>
      )}
    </div>
  );
}
