/**
 * LiveTranscript — reusable live-call SSE consumer.
 *
 * Covers: opens an EventSource on mount, REPLACE-coalesces same-role
 * partials (#1365), starts a fresh bubble on role change, surfaces
 * call-started / call-ended via callbacks, closes the EventSource on
 * unmount, and renders the empty-state slot before the first event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveTranscript } from '@/components/voice/LiveTranscript';

interface FakeListener {
  (msg: { data: string }): void;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: FakeListener | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, FakeListener>();

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: FakeListener) {
    this.listeners.set(name, fn);
  }

  close() {
    this.closed = true;
  }

  // Test helpers
  emit(eventName: string, payload: Record<string, unknown>) {
    const fn = this.listeners.get(eventName);
    if (fn) fn({ data: JSON.stringify({ type: eventName, ...payload }) });
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
    FakeEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiveTranscript', () => {
  it('opens an EventSource keyed on callId', () => {
    render(<LiveTranscript callId="call-abc" />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(
      '/api/voice/calls/call-abc/stream',
    );
    expect(FakeEventSource.instances[0].withCredentials).toBe(true);
  });

  it('renders empty state before the first transcript event', () => {
    render(
      <LiveTranscript
        callId="call-abc"
        emptyState={<div>Waiting for conversation…</div>}
      />,
    );
    expect(screen.getByText('Waiting for conversation…')).toBeDefined();
  });

  it('REPLACE-coalesces same-role partials into one bubble', () => {
    render(<LiveTranscript callId="call-abc" />);
    const es = FakeEventSource.instances[0];

    act(() => {
      es.emit('transcript-partial', {
        callId: 'call-abc',
        role: 'learner',
        text: 'Hello',
        timestampMs: 1000,
      });
    });
    act(() => {
      es.emit('transcript-partial', {
        callId: 'call-abc',
        role: 'learner',
        text: 'Hello there',
        timestampMs: 1100,
      });
    });
    act(() => {
      es.emit('transcript-partial', {
        callId: 'call-abc',
        role: 'learner',
        text: 'Hello there, can you hear me?',
        timestampMs: 1200,
      });
    });

    // Only the latest text should be present — earlier interims replaced.
    expect(
      screen.getByText('Hello there, can you hear me?'),
    ).toBeDefined();
    expect(screen.queryByText('Hello')).toBeNull();
    expect(screen.queryByText('Hello there')).toBeNull();
  });

  it('starts a fresh bubble when role flips', () => {
    render(<LiveTranscript callId="call-abc" />);
    const es = FakeEventSource.instances[0];

    act(() => {
      es.emit('transcript-partial', {
        callId: 'call-abc',
        role: 'learner',
        text: 'How does inheritance work?',
        timestampMs: 1000,
      });
    });
    act(() => {
      es.emit('transcript-partial', {
        callId: 'call-abc',
        role: 'assistant',
        text: 'Great question — inheritance lets',
        timestampMs: 1500,
      });
    });

    expect(screen.getByText('How does inheritance work?')).toBeDefined();
    expect(screen.getByText('Great question — inheritance lets')).toBeDefined();
  });

  it('fires onCallStarted and onCallEnded callbacks', () => {
    const onCallStarted = vi.fn();
    const onCallEnded = vi.fn();
    render(
      <LiveTranscript
        callId="call-abc"
        onCallStarted={onCallStarted}
        onCallEnded={onCallEnded}
      />,
    );
    const es = FakeEventSource.instances[0];

    act(() => {
      es.emit('call-started', {
        callId: 'call-abc',
        durationLimitMs: 900_000,
        transcriptStreamEnabled: true,
        timestampMs: 1000,
      });
    });
    expect(onCallStarted).toHaveBeenCalledWith({
      durationLimitMs: 900_000,
      transcriptStreamEnabled: true,
    });

    act(() => {
      es.emit('call-ended', {
        callId: 'call-abc',
        reason: 'customer-ended-call',
        totalDurationMs: 240_000,
        timestampMs: 2000,
      });
    });
    expect(onCallEnded).toHaveBeenCalledWith({
      reason: 'customer-ended-call',
      totalDurationMs: 240_000,
    });
  });

  it('surfaces transcriptStreamEnabled=false so the parent can render an "off" pill', () => {
    const onCallStarted = vi.fn();
    render(
      <LiveTranscript callId="call-abc" onCallStarted={onCallStarted} />,
    );
    const es = FakeEventSource.instances[0];

    act(() => {
      es.emit('call-started', {
        callId: 'call-abc',
        durationLimitMs: null,
        transcriptStreamEnabled: false,
        timestampMs: 1000,
      });
    });
    expect(onCallStarted).toHaveBeenCalledWith({
      durationLimitMs: null,
      transcriptStreamEnabled: false,
    });
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = render(<LiveTranscript callId="call-abc" />);
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it('surfaces connection-state transitions', () => {
    const onConnectionStateChange = vi.fn();
    const { unmount } = render(
      <LiveTranscript
        callId="call-abc"
        onConnectionStateChange={onConnectionStateChange}
      />,
    );
    const es = FakeEventSource.instances[0];

    expect(onConnectionStateChange).toHaveBeenCalledWith('connecting');

    act(() => {
      es.onopen?.();
    });
    expect(onConnectionStateChange).toHaveBeenCalledWith('open');

    act(() => {
      es.onerror?.();
    });
    expect(onConnectionStateChange).toHaveBeenCalledWith('error');

    unmount();
    expect(onConnectionStateChange).toHaveBeenCalledWith('closed');
  });
});
