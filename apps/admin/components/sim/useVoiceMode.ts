'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type VoiceState = 'off' | 'idle' | 'recording' | 'transcribing' | 'ai-speaking';

export interface VoiceMode {
  state: VoiceState;
  waveformLevel: number;   // 0–1 driven by AnalyserNode while recording
  toggle: () => void;      // header mic tap — on↔off
  startRecording: () => void;
  stopRecording: () => void;
  interrupt: () => void;
  speakText: (text: string) => Promise<void>;
  onTranscribed?: (transcript: string) => void; // set by consumer
}

function getSupportedMimeType(): string {
  // Prefer mp4 for iOS Safari, fall back to webm (Chrome/Firefox)
  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function useVoiceMode(onTranscribed: (transcript: string) => void): VoiceMode {
  const [state, setState] = useState<VoiceState>('off');
  const [waveformLevel, setWaveformLevel] = useState(0);

  // Audio infrastructure
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsBlobUrlRef = useRef<string | null>(null);
  const maxSecondsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unlock AudioContext on first user gesture (iOS requirement)
  function ensureAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }

  // Animate waveform level from AnalyserNode
  function startWaveformLoop() {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setWaveformLevel(Math.min(1, rms * 4)); // scale up for visibility
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopWaveformLoop() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setWaveformLevel(0);
  }

  // Clean up media stream
  function releaseStream() {
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
  }

  // Revoke current TTS blob URL and stop audio
  function cleanupTTS() {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
    }
    if (ttsBlobUrlRef.current) {
      URL.revokeObjectURL(ttsBlobUrlRef.current);
      ttsBlobUrlRef.current = null;
    }
  }

  const toggle = useCallback(() => {
    if (state === 'off') {
      ensureAudioContext();

      // Prime HTMLAudioElement on this user gesture so Safari allows
      // programmatic play() later (after async TTS fetch).
      if (!ttsAudioRef.current) {
        ttsAudioRef.current = new Audio();
      }
      const a = ttsAudioRef.current;
      a.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqSAAAAAAAAAAAAAAAAAAAA';
      a.volume = 0;
      a.play().then(() => { a.pause(); a.volume = 1; }).catch(() => {});

      setState('idle');
    } else {
      // Exit voice mode — clean up everything
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (maxSecondsTimerRef.current) {
        clearTimeout(maxSecondsTimerRef.current);
        maxSecondsTimerRef.current = null;
      }
      stopWaveformLoop();
      releaseStream();
      cleanupTTS();
      setState('off');
    }
  }, [state]);

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Wire up AnalyserNode for waveform
      ensureAudioContext();
      const ctx = audioCtxRef.current!;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up recorder
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopWaveformLoop();
        releaseStream();
        processRecording(mimeType);
      };
      recorderRef.current = recorder;
      recorder.start();

      startWaveformLoop();
      setState('recording');

      // Auto-stop after max seconds (loaded from defaults; component can override)
      const maxMs = 60 * 1000;
      maxSecondsTimerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
        }
      }, maxMs);
    } catch (err: any) {
      console.error('[voice] getUserMedia failed:', err?.message || err);
      setState('idle');
    }
  }, [state]);

  const stopRecording = useCallback(() => {
    if (state !== 'recording') return;
    if (maxSecondsTimerRef.current) {
      clearTimeout(maxSecondsTimerRef.current);
      maxSecondsTimerRef.current = null;
    }
    recorderRef.current?.stop();
    setState('transcribing');
  }, [state]);

  async function processRecording(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/mp4' });
    chunksRef.current = [];

    try {
      const fd = new FormData();
      // OpenAI requires a filename with correct extension
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      fd.append('audio', blob, `recording.${ext}`);

      const res = await fetch('/api/sim/audio/transcribe', { method: 'POST', body: fd });
      const data = await res.json();

      if (data.ok && data.transcript?.trim()) {
        setState('idle');
        onTranscribed(data.transcript.trim());
      } else {
        console.warn('[voice] transcription empty or failed:', data.error);
        setState('idle');
      }
    } catch (err: any) {
      console.error('[voice] transcribe fetch failed:', err?.message || err);
      setState('idle');
    }
  }

  const interrupt = useCallback(() => {
    cleanupTTS();
    setState('idle');
  }, []);

  const speakText = useCallback(async (text: string) => {
    if (state === 'off') return;

    // Ensure audio element exists
    if (!ttsAudioRef.current) {
      ttsAudioRef.current = new Audio();
    }
    const audio = ttsAudioRef.current;

    try {
      setState('ai-speaking');

      const res = await fetch('/api/sim/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Clean up previous blob URL
      if (ttsBlobUrlRef.current) URL.revokeObjectURL(ttsBlobUrlRef.current);
      ttsBlobUrlRef.current = url;

      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        ttsBlobUrlRef.current = null;
        setState('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        ttsBlobUrlRef.current = null;
        setState('idle');
      };

      await audio.play();
    } catch (err: any) {
      console.error('[voice] TTS failed:', err?.message || err);
      setState('idle');
    }
  }, [state]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopWaveformLoop();
      releaseStream();
      cleanupTTS();
      if (maxSecondsTimerRef.current) clearTimeout(maxSecondsTimerRef.current);
    };
  }, []);

  return { state, waveformLevel, toggle, startRecording, stopRecording, interrupt, speakText };
}
