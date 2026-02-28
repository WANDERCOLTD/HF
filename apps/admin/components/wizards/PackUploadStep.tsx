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
import type { IngestEvent } from '@/lib/content-trust/ingest-events';
import { DocTypeBadge } from '@/app/x/content-sources/_components/shared/badges';
import { getDocTypeInfo } from '@/lib/doc-type-icons';
import './pack-upload-step.css';

type TimelineStep = {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
};

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
  /** Extraction totals (populated when SSE stream completes) */
  extractionTotals?: {
    assertions: number;
    questions: number;
    vocabulary: number;
    images: number;
  };
}

interface PackUploadStepProps {
  domainId: string;
  domainSlug?: string;
  courseName: string;
  /** Interaction pattern chosen by the teacher (e.g. socratic, directive). Passed to extraction for pattern-specific categories. */
  interactionPattern?: string;
  /** Teaching mode chosen by the teacher (e.g. recall, comprehension). Used to auto-assign teachMethod to extracted assertions. */
  teachingMode?: string;
  /** Subject discipline declared by teacher (e.g. "history", "english"). Passed to extraction for subject-aware prompt. */
  subjectDiscipline?: string;
  existingCourses?: ExistingCourse[];
  /** When provided, shows subject picker instead of course picker */
  existingSubjects?: ExistingSubject[];
  onResult: (result: PackUploadResult) => void;
  onBack?: () => void;
}

// ── Constants ──────────────────────────────────────────

const VALID_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.json'];
const ACCEPT_ATTR = VALID_EXTENSIONS.join(',');


// ── Component ──────────────────────────────────────────

export function PackUploadStep({
  domainId,
  courseName,
  interactionPattern,
  teachingMode,
  subjectDiscipline,
  existingCourses = [],
  existingSubjects = [],
  onResult,
  onBack,
}: PackUploadStepProps) {
  const hasExistingItems = existingCourses.length > 0 || existingSubjects.length > 0;

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
  const [ingestError, setIngestError] = useState<string | null>(null);
  const ingestAbortRef = useRef<AbortController | null>(null);

  // SSE extraction progress
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [extractionTotals, setExtractionTotals] = useState({ assertions: 0, questions: 0, vocabulary: 0, images: 0 });
  const [currentFile, setCurrentFile] = useState<{ name: string; chunks: number; completedSet: Set<number> } | null>(null);

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

  // ── SSE event handler ────────────────────────────────

  const handleIngestEvent = useCallback((event: IngestEvent) => {
    const { phase, message, data } = event;

    if (phase === 'complete') {
      const classifications = manifest?.groups.flatMap(g =>
        g.files.map(f => ({
          fileName: f.fileName,
          documentType: f.documentType,
          confidence: f.confidence,
          reasoning: f.reasoning,
        }))
      ) || [];

      setIngesting(false);
      setCurrentFile(null);
      onResult({
        mode: 'pack-upload',
        subjects: data?.subjects,
        sourceCount: data?.sourceCount,
        classifications,
        extractionTotals: {
          assertions: data?.totalAssertions || 0,
          questions: data?.totalQuestions || 0,
          vocabulary: data?.totalVocabulary || 0,
          images: data?.totalImages || 0,
        },
      });
      return;
    }

    if (phase === 'error') {
      setIngestError(data?.error || message);
      setIngesting(false);
      return;
    }

    if (phase === 'init') return;

    // Track per-file extraction progress (handles out-of-order chunk arrival)
    if (phase === 'chunk-complete' && data) {
      setCurrentFile(prev => {
        const completed = new Set(prev?.completedSet || []);
        completed.add(data.chunkIndex || 0);
        return {
          name: data.fileName || '',
          chunks: data.totalChunks || 0,
          completedSet: completed,
        };
      });
      // Accumulate per-chunk deltas (not running totals — avoids double-counting)
      setExtractionTotals(prev => ({
        ...prev,
        assertions: prev.assertions + (data.chunkAssertions || 0),
        questions: prev.questions + (data.chunkQuestions || 0),
        vocabulary: prev.vocabulary + (data.chunkVocabulary || 0),
      }));
      return; // Don't add chunk events to timeline
    }

    // Accumulate image counts from images-complete events
    if (phase === 'images-complete' && data?.images) {
      setExtractionTotals(prev => ({
        ...prev,
        images: prev.images + (data.images || 0),
      }));
    }

    if (phase === 'file-complete' || phase === 'file-error') {
      setCurrentFile(null);
      // Totals already accumulated per-chunk — no addition here to avoid double-counting
    }

    // Update timeline
    setTimeline((prev) => {
      const id = phase === 'file-complete' || phase === 'file-error'
        ? `file-${data?.fileName}` : `${phase}-${data?.subjectName || data?.fileName || ''}`;
      const existing = prev.find((s) => s.id === id);
      const isDone = phase === 'subject-created' || phase === 'source-created' || phase === 'file-complete' || phase === 'images-complete' || phase === 'post-processing';
      const isError = phase === 'file-error';
      const status = isError ? 'error' : isDone ? 'done' : 'active';

      if (existing) {
        return prev.map((s) =>
          s.id === id ? { ...s, label: message, status } : s,
        );
      }

      // Mark previous active step as done
      const updated = prev.map((s) =>
        s.status === 'active' ? { ...s, status: 'done' as const } : s,
      );
      return [...updated, { id, label: message, status }];
    });
  }, [manifest, onResult]);

  // ── Ingest (SSE) ──────────────────────────────────────

  const handleIngest = useCallback(async () => {
    if (!manifest) return;

    setIngesting(true);
    setIngestError(null);
    setTimeline([]);
    setExtractionTotals({ assertions: 0, questions: 0, vocabulary: 0, images: 0 });
    setCurrentFile(null);

    ingestAbortRef.current?.abort();
    const controller = new AbortController();
    ingestAbortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('manifest', JSON.stringify(manifest));
      formData.append('domainId', domainId);
      formData.append('courseName', courseName);
      if (interactionPattern) {
        formData.append('interactionPattern', interactionPattern);
      }
      if (teachingMode) {
        formData.append('teachingMode', teachingMode);
      }
      if (subjectDiscipline) {
        formData.append('subjectDiscipline', subjectDiscipline);
      }
      for (const file of files) {
        formData.append('files', file);
      }

      const res = await fetch('/api/course-pack/ingest', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      // Non-SSE error responses (auth, validation) come as JSON
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Server error: ${res.status}`);
      }

      // SSE reader loop (same pattern as LaunchStep)
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            handleIngestEvent(JSON.parse(dataLine.slice(6)));
          } catch { /* ignore malformed events */ }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const dataLine = buffer.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          try {
            handleIngestEvent(JSON.parse(dataLine.slice(6)));
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        setIngesting(false);
        return;
      }
      const msg = (err as Error).message || 'Ingest failed';
      const isNetworkError = msg === 'Load failed' || msg === 'Failed to fetch'
        || msg === 'NetworkError when attempting to fetch resource.';
      setIngestError(isNetworkError ? 'Connection lost — check your network and try again.' : msg);
      setIngesting(false);
    }
  }, [manifest, domainId, courseName, interactionPattern, teachingMode, files, handleIngestEvent]);

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
    const newRole = getDocTypeInfo(newType).role;

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
      {/* ── Existing subject/course picker (hidden during manifest review / ingest) ── */}
      {hasExistingItems && !manifest && !ingesting && (
        <>
          {existingSubjects.length > 0 && (
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
              <button
                className="dtw-btn-upload"
                disabled={!selectedSubjectId}
                onClick={handleSelectSubject}
              >
                Use This Subject
              </button>
            </div>
          )}
          {existingSubjects.length === 0 && existingCourses.length > 0 && (
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
              <button
                className="dtw-btn-upload"
                disabled={!selectedCourseId}
                onClick={handleSelectCourse}
              >
                Use This Course
              </button>
            </div>
          )}
          <div className="pack-or-divider">or upload new</div>
        </>
      )}

      {/* ── Drop zone + file upload (always visible, hidden during manifest review / ingest) ── */}
      {!manifest && !ingesting && (
        <div className="pack-upload-section">
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
                    <div className="pack-file-name-row">
                      <span className="pack-file-name">{f.fileName}</span>
                      <span className="pack-file-drag">⠿</span>
                    </div>
                    <DocTypeBadge
                      type={f.documentType}
                      confidence={f.confidence}
                      onChange={(newType) => handleChangeFileType(f.fileIndex, newType, 'group', gIdx)}
                    />
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
                    <div className="pack-file-name-row">
                      <span className="pack-file-name">{f.fileName}</span>
                    </div>
                    <DocTypeBadge
                      type={f.documentType}
                      confidence={f.confidence}
                      onChange={(newType) => handleChangeFileType(f.fileIndex, newType, 'pedagogy')}
                    />
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

      {/* ── Ingesting progress (SSE timeline) ── */}
      {ingesting && (
        <div className="pack-ingest-progress">
          <div className="dtw-extract-status">
            <div className="dtw-pulse-dot" />
            <div className="dtw-extract-label">Extracting Content</div>
          </div>

          {/* Timeline */}
          {timeline.length > 0 && (
            <div className="hf-card hf-card-compact" style={{ marginTop: 12 }}>
              {timeline.map((step) => (
                <div key={step.id} className="hf-flex hf-items-center hf-gap-sm" style={{ marginBottom: 4 }}>
                  {step.status === 'done' && <span style={{ color: 'var(--status-success-text)', fontSize: 14, width: 16, textAlign: 'center' }}>&#x2713;</span>}
                  {step.status === 'active' && <span className="hf-spinner hf-icon-xs" />}
                  {step.status === 'pending' && <span style={{ width: 16, textAlign: 'center', color: 'var(--text-muted)' }}>&#x25CB;</span>}
                  {step.status === 'error' && <span style={{ color: 'var(--status-error-text)', fontSize: 14, width: 16, textAlign: 'center' }}>&#x2717;</span>}
                  <span className={`hf-text-sm${step.status === 'done' ? ' hf-text-muted' : ''}`}>
                    {step.label}
                  </span>
                </div>
              ))}

              {/* Per-file chunk progress bar (handles out-of-order completion) */}
              {currentFile && currentFile.chunks > 0 && (
                <div style={{ marginTop: 6, marginBottom: 2, paddingLeft: 24 }}>
                  <div className="dtw-progress-track" style={{ height: 4 }}>
                    <div
                      className="dtw-progress-fill"
                      style={{ width: `${(currentFile.completedSet.size / currentFile.chunks) * 100}%` }}
                    />
                  </div>
                  <span className="hf-text-xs hf-text-muted">
                    chunk {currentFile.completedSet.size}/{currentFile.chunks}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Running totals */}
          {(extractionTotals.assertions > 0 || extractionTotals.questions > 0 || extractionTotals.vocabulary > 0 || extractionTotals.images > 0) && (
            <div className="hf-card hf-card-compact" style={{ marginTop: 8 }}>
              <div className="hf-flex hf-gap-md hf-text-sm hf-flex-wrap">
                {extractionTotals.assertions > 0 && (
                  <span><strong>{extractionTotals.assertions}</strong> teaching points</span>
                )}
                {extractionTotals.questions > 0 && (
                  <span><strong>{extractionTotals.questions}</strong> questions</span>
                )}
                {extractionTotals.vocabulary > 0 && (
                  <span><strong>{extractionTotals.vocabulary}</strong> vocabulary</span>
                )}
                {extractionTotals.images > 0 && (
                  <span><strong>{extractionTotals.images}</strong> images</span>
                )}
              </div>
            </div>
          )}

          {timeline.length === 0 && (
            <>
              <div className="dtw-progress-track" style={{ marginTop: 12 }}>
                <div className="dtw-progress-fill dtw-progress-fill--indeterminate" />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                Preparing files...
              </p>
            </>
          )}

          {/* Cancel button */}
          <div style={{ marginTop: 16 }}>
            <button
              className="dtw-btn-skip"
              onClick={() => { ingestAbortRef.current?.abort(); setIngesting(false); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
