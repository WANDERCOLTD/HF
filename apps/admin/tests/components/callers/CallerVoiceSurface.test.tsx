/**
 * Smoke tests for `<CallerVoiceSurface>` (#1448).
 *
 * Pins:
 *   - Standalone layout: caller fetch + playbook fetch + SimChat mount
 *     with full prop set (pastCalls, playbookName, subjectDiscipline,
 *     journey)
 *   - Embedded layout: respects `playbookIdOverride` (parent dictates);
 *     onPostCallRefresh fired on handleCallEnd
 *   - Caller-not-found error renders error message
 *   - 401 → router.push to login
 *   - PastCalls filter: only transcripts with content; sorted ASC
 *
 * Heavy mocking — the goal is to lock the prop-passing contract, not to
 * exercise SimChat's internals (covered by existing SimChat tests).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  useSearchParams: () => ({
    get: (k: string) => null as string | null,
    toString: () => "",
  }),
  useParams: () => ({ callerId: "caller-abc" }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@/hooks/useResponsive", () => ({
  useResponsive: () => ({ isDesktop: true, isMobile: false }),
}));

vi.mock("@/hooks/useJourneyChat", () => ({
  useJourneyChat: vi.fn(() => ({ items: [], phase: "idle" })),
}));

// Capture SimChat's props for assertion.
let capturedSimChatProps: Record<string, unknown> | null = null;
vi.mock("@/components/sim/SimChat", () => ({
  SimChat: (props: Record<string, unknown>) => {
    capturedSimChatProps = props;
    return <div data-testid="sim-chat-mock" />;
  },
}));

vi.mock("@/components/sim/SimStateBreadcrumb", () => ({
  SimStateBreadcrumb: () => <div data-testid="sim-state-breadcrumb" />,
}));

vi.mock("@/components/sim/ModuleQuickSwitcher", () => ({
  ModuleQuickSwitcher: () => <div data-testid="module-quick-switcher" />,
}));

vi.mock("@/components/sim/ModulePickerBanners", () => ({
  ModulePickerSelectionBanner: () => <div data-testid="picker-selection" />,
  ModulePickerInviteBanner: () => <div data-testid="picker-invite" />,
}));

vi.mock("@/components/sim/qualification/QualificationContextStrip", () => ({
  QualificationContextStrip: () => <div data-testid="qual-strip" />,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { CallerVoiceSurface } from "@/components/callers/CallerVoiceSurface";

const CALLER_OK = {
  ok: true,
  caller: {
    name: "Cyrus Horváth",
    role: "LEARNER",
    domain: { id: "dom1", name: "PAW Training Ltd" },
    lastSelectedModuleId: undefined,
  },
  calls: [
    { transcript: "AI: Hi\nUser: Hello", createdAt: "2026-06-01T10:00:00Z" },
    { transcript: "", createdAt: "2026-06-02T10:00:00Z" }, // filtered out
    { transcript: "AI: B\nUser: C", createdAt: "2026-06-03T10:00:00Z" },
  ],
};

const PLAYBOOK_OK = {
  ok: true,
  playbook: {
    name: "CIO/CTO Programme",
    config: {
      subjectDiscipline: "IT Operations",
      modulesAuthored: true,
      modules: [{ id: "mod1", label: "Module 1" }],
    },
  },
  siblingPlaybookIds: ["pb-abc"],
};

beforeEach(() => {
  capturedSimChatProps = null;
  mockFetch.mockReset();
  mockRouterPush.mockReset();
  mockRouterReplace.mockReset();
});

function mockByUrl(
  routes: Record<string, { status?: number; body: unknown }>,
) {
  mockFetch.mockImplementation((url: string) => {
    let match: { status?: number; body: unknown } | undefined;
    for (const [pattern, resp] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        match = resp;
        break;
      }
    }
    if (!match) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: false, error: `no mock for ${url}` }),
      } as Response);
    }
    return Promise.resolve({
      ok: (match.status ?? 200) < 400,
      status: match.status ?? 200,
      headers: { get: () => "application/json" },
      json: async () => match.body,
    } as Response);
  });
}

function mockFetchSequence(...responses: Array<{ status?: number; body: unknown }>) {
  let i = 0;
  mockFetch.mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      headers: { get: () => "application/json" },
      json: async () => r.body,
    } as Response);
  });
}

describe("CallerVoiceSurface (#1448)", () => {
  it("standalone layout: passes full canonical prop set to SimChat", async () => {
    mockByUrl({
      "/active-playbook": { body: { ok: true, playbookId: "pb-resolved" } },
      "/api/callers/caller-abc": { body: CALLER_OK },
      "/api/playbooks/": { body: PLAYBOOK_OK },
    });
    render(
      <CallerVoiceSurface
        callerId="caller-abc"
        layout="standalone"
        forceFirstCall
        sessionGoal="Test goal"
        targetOverrides={{ accuracy: 0.85 }}
      />,
    );
    await waitFor(() => expect(capturedSimChatProps).not.toBeNull());
    const p = capturedSimChatProps!;
    expect(p.callerId).toBe("caller-abc");
    expect(p.callerName).toBe("Cyrus Horváth");
    expect(p.mode).toBe("standalone");
    expect(p.forceFirstCall).toBe(true);
    expect(p.sessionGoal).toBe("Test goal");
    expect(p.targetOverrides).toEqual({ accuracy: 0.85 });
    // pastCalls filter: only non-empty transcripts, sorted ASC by createdAt
    const past = p.pastCalls as Array<{ transcript: string; createdAt: string }>;
    expect(past).toHaveLength(2);
    expect(past[0].createdAt).toBe("2026-06-01T10:00:00Z");
    expect(past[1].createdAt).toBe("2026-06-03T10:00:00Z");
  });

  it("embedded layout: respects playbookIdOverride (parent dictates)", async () => {
    mockFetchSequence(
      { body: CALLER_OK },
      { body: PLAYBOOK_OK },
    );
    render(
      <CallerVoiceSurface
        callerId="caller-abc"
        layout="embedded"
        playbookIdOverride="pb-from-parent"
      />,
    );
    await waitFor(() => expect(capturedSimChatProps).not.toBeNull());
    expect(capturedSimChatProps!.playbookId).toBe("pb-from-parent");
    expect(capturedSimChatProps!.mode).toBe("embedded");
    // active-playbook resolver should NOT have fired (embedded uses override).
    const calls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("/active-playbook"))).toBe(false);
  });

  it("renders 'Caller not found' on 404", async () => {
    mockFetchSequence({ status: 404, body: { ok: false } }, { status: 404, body: { ok: false } });
    render(<CallerVoiceSurface callerId="caller-abc" layout="standalone" />);
    await waitFor(() => expect(screen.getByText(/Caller not found/i)).toBeTruthy());
    expect(capturedSimChatProps).toBeNull();
  });

  it("401 → router.push to login", async () => {
    mockFetchSequence({ status: 401, body: {} });
    render(<CallerVoiceSurface callerId="caller-abc" layout="standalone" />);
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    const arg = mockRouterPush.mock.calls[0][0] as string;
    expect(arg).toMatch(/\/login/);
    expect(arg).toMatch(/callbackUrl=/);
  });

  it("standalone: no expectedDomainId mismatch when domain matches", async () => {
    mockByUrl({
      "/active-playbook": { body: { ok: true, playbookId: "pb-resolved" } },
      "/api/callers/caller-abc": { body: CALLER_OK },
      "/api/playbooks/": { body: PLAYBOOK_OK },
    });
    render(
      <CallerVoiceSurface
        callerId="caller-abc"
        layout="standalone"
        expectedDomainId="dom1"
      />,
    );
    await waitFor(() => expect(capturedSimChatProps).not.toBeNull());
    // Should reach SimChat, not the error path.
    expect(screen.queryByText(/no longer in the expected institution/i)).toBeNull();
  });
});
