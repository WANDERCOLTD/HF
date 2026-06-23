/**
 * CueCardRowEditor — S6 of #2185 inline row editor.
 *
 * 4-cell matrix: type change, topic edit, add bullet, remove bullet —
 * plus a save-dispatch assertion that exercises the PATCH shape against the
 * canonical `/api/courses/:courseId/journey-setting` chokepoint.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CueCardRowEditor } from "@/components/content-tab/CueCardRowEditor";
import type { CueCardItem } from "@/components/content-tab/types";

const moduleId = "mock";

function makeItem(overrides: Partial<CueCardItem> = {}): CueCardItem {
  return {
    id: `${moduleId}:cue:0`,
    index: 0,
    topic: "Describe a memorable holiday",
    bullets: ["Where it was", "Who you were with"],
    type: null,
    module: { moduleId, moduleLabel: "Mock" },
    ...overrides,
  };
}

function makePool(): CueCardItem[] {
  return [
    makeItem(),
    makeItem({
      id: `${moduleId}:cue:1`,
      index: 1,
      topic: "Describe a job you would like to have",
      bullets: ["What it is", "Why it appeals"],
      type: "personal",
    }),
  ];
}

describe("CueCardRowEditor", () => {
  it("renders the row in read-only collapsed mode", () => {
    const item = makeItem();
    render(
      <ul>
        <CueCardRowEditor
          courseId="course-1"
          item={item}
          poolForModule={makePool()}
        />
      </ul>,
    );
    expect(screen.getByText("Describe a memorable holiday")).toBeDefined();
    expect(screen.getByTestId(`hf-content-cue-edit-${item.id}`)).toBeDefined();
    // No editor inputs in collapsed mode.
    expect(
      screen.queryByTestId(`hf-content-cue-type-select-${item.id}`),
    ).toBeNull();
  });

  it("expands to edit mode and lets the operator change CueCardType", () => {
    const item = makeItem();
    render(
      <ul>
        <CueCardRowEditor
          courseId="course-1"
          item={item}
          poolForModule={makePool()}
        />
      </ul>,
    );
    fireEvent.click(screen.getByTestId(`hf-content-cue-edit-${item.id}`));
    const select = screen.getByTestId(
      `hf-content-cue-type-select-${item.id}`,
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "personal" } });
    expect(select.value).toBe("personal");
    fireEvent.change(select, { target: { value: "abstract" } });
    expect(select.value).toBe("abstract");
  });

  it("edits the topic field in expanded mode", () => {
    const item = makeItem();
    render(
      <ul>
        <CueCardRowEditor
          courseId="course-1"
          item={item}
          poolForModule={makePool()}
        />
      </ul>,
    );
    fireEvent.click(screen.getByTestId(`hf-content-cue-edit-${item.id}`));
    const input = screen.getByTestId(
      `hf-content-cue-topic-${item.id}`,
    ) as HTMLInputElement;
    expect(input.value).toBe("Describe a memorable holiday");
    fireEvent.change(input, { target: { value: "Describe an invention" } });
    expect(input.value).toBe("Describe an invention");
  });

  it("adds and removes bullets", () => {
    const item = makeItem();
    render(
      <ul>
        <CueCardRowEditor
          courseId="course-1"
          item={item}
          poolForModule={makePool()}
        />
      </ul>,
    );
    fireEvent.click(screen.getByTestId(`hf-content-cue-edit-${item.id}`));
    // Starts with 2 bullets.
    expect(
      screen.getByTestId(`hf-content-cue-bullet-${item.id}-0`),
    ).toBeDefined();
    expect(
      screen.getByTestId(`hf-content-cue-bullet-${item.id}-1`),
    ).toBeDefined();
    // Add a third.
    fireEvent.click(screen.getByTestId(`hf-content-cue-bullet-add-${item.id}`));
    expect(
      screen.getByTestId(`hf-content-cue-bullet-${item.id}-2`),
    ).toBeDefined();
    // Remove the first.
    fireEvent.click(
      screen.getByTestId(`hf-content-cue-bullet-remove-${item.id}-0`),
    );
    // Now 2 bullets remain.
    expect(
      screen.queryByTestId(`hf-content-cue-bullet-${item.id}-2`),
    ).toBeNull();
  });

  it("save dispatches a single PATCH to the journey-setting chokepoint with the full pool + arraySelector", async () => {
    const item = makeItem();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "",
    });
    const onSaved = vi.fn();

    render(
      <ul>
        <CueCardRowEditor
          courseId="course-1"
          item={item}
          poolForModule={makePool()}
          onSaved={onSaved}
          fetchImpl={fetchImpl as unknown as typeof fetch}
        />
      </ul>,
    );

    fireEvent.click(screen.getByTestId(`hf-content-cue-edit-${item.id}`));

    // Set CueCardType to personal (the admin-UI consumer that wires the
    // bdd-typed-unions-coverage gate).
    fireEvent.change(
      screen.getByTestId(`hf-content-cue-type-select-${item.id}`),
      { target: { value: "personal" } },
    );
    // Edit the topic.
    fireEvent.change(
      screen.getByTestId(`hf-content-cue-topic-${item.id}`),
      { target: { value: "Describe a person" } },
    );
    // Save.
    fireEvent.click(screen.getByTestId(`hf-content-cue-save-${item.id}`));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/courses/course-1/journey-setting");
    expect(init?.method).toBe("PATCH");
    const body = JSON.parse(init!.body as string);
    expect(body.settingId).toBe("moduleCueCardPool");
    expect(body.arraySelector).toBe(moduleId);
    // The PATCH must carry the FULL pool with the edited row at index 0
    // and sibling row preserved at index 1.
    expect(Array.isArray(body.value)).toBe(true);
    expect(body.value).toHaveLength(2);
    expect(body.value[0]).toEqual({
      topic: "Describe a person",
      bullets: ["Where it was", "Who you were with"],
      type: "personal",
    });
    expect(body.value[1]).toEqual({
      topic: "Describe a job you would like to have",
      bullets: ["What it is", "Why it appeals"],
      type: "personal",
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
