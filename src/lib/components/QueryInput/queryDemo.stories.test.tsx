import { composeStories } from "@storybook/react-vite";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";

import * as stories from "@/lib/components/QueryInput/QueryInput.stories";
import { demoExamples } from "@/lib/components/QueryInput/queryDemo";

const { Default } = composeStories(stories);

const expectTotal = async (count: number) => {
  expect(
    await screen.findByText(`${count} matching machines`),
  ).toBeInTheDocument();
};
const editor = () =>
  screen.getByRole("combobox", { name: "Search machines..." });
const pasteDraft = (text: string) => {
  const root = editor();
  root.focus();
  document.getSelection()?.selectAllChildren(root);
  fireEvent.paste(root, { clipboardData: { getData: () => text } });
};
const moveCaret = (offset: number) => {
  const root = editor();
  fireEvent.focus(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length && !node.parentElement?.closest("[data-chip]")) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      fireEvent.keyUp(root, { key: "ArrowLeft" });
      return;
    }
    remaining -= length;
  }
  throw new Error(`Could not place demo caret at ${offset}.`);
};

describe("QueryInput frontend-only story harness", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exposes one Default story with only a compact query summary and results", async () => {
    expect(Object.keys(composeStories(stories))).toEqual(["Default"]);
    render(<Default delayMs={0} />);
    expect(screen.getByLabelText("Query details")).toHaveTextContent(
      "Empty query · Normal listing",
    );
    expect(
      screen.queryByRole("region", { name: "Fixture reference" }),
    ).not.toBeInTheDocument();
    expect(editor().textContent).toBe("");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expectTotal(14);
    expect(
      screen.getByRole("treegrid", { name: "Normal machine listing" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("treegrid")).toHaveLength(1);
    expect(
      screen.queryByText("Submitted normalized AST"),
    ).not.toBeInTheDocument();
  });

  it("keeps the normal listing until Submit and does not apply draft edits", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={0} />);
    await expectTotal(14);
    pasteDraft(demoExamples.deployment);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(9);
    expect(
      screen.getByRole("treegrid", { name: "Applied query results" }),
    ).toBeInTheDocument();

    pasteDraft(demoExamples.unknown);
    await expectTotal(9);
    expect(screen.getByText(/Unapplied changes/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(2);
  });

  it("Clear restores page one, preserves selected rows, and undo only restores draft", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={0} />);
    pasteDraft(demoExamples.deployment);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(9);
    await user.click(
      screen.getByRole("checkbox", { name: "select decimal-001" }),
    );
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", { name: "page number" }),
      ).toHaveValue(2),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await expectTotal(14);
    expect(screen.getByRole("spinbutton", { name: "page number" })).toHaveValue(
      1,
    );
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    expect(editor()).toHaveTextContent("");

    fireEvent.keyDown(editor(), {
      key: "z",
      ctrlKey: true,
    });
    expect(editor().textContent).toBe(demoExamples.deployment);
    await expectTotal(14);
    expect(screen.getByLabelText("Query details")).toHaveTextContent(
      "Valid query · Normal listing",
    );
  });

  it("does not execute a valid prefix of an incomplete reused query", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={0} />);
    pasteDraft(demoExamples.deployment);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(9);
    pasteDraft('status("Ready") AND');
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.keyDown(editor(), {
      key: "Enter",
      ctrlKey: true,
    });
    await expectTotal(9);
    expect(screen.getByText(/Invalid or incomplete/)).toBeInTheDocument();
  });

  it("reuses the applied AST for persona changes, sorting and grouping", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Default delayMs={0} />);
    await expectTotal(14);
    pasteDraft(demoExamples.failures);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(2);
    rerender(<Default delayMs={0} persona="operator" />);
    await expectTotal(1);
    await user.selectOptions(screen.getByLabelText("Group machines"), "status");
    await user.click(screen.getByRole("button", { name: /Hostname/ }));
    await expectTotal(1);
    expect(
      screen.getByText("Groups (full result): Failed deployment: 1"),
    ).toBeInTheDocument();
    const results = screen.getByRole("region", { name: "Machine results" });
    expect(within(results).getByText("failure-001")).toBeInTheDocument();
    expect(within(results).queryByText("failure-002")).not.toBeInTheDocument();
  });

  it("distinguishes empty matches from execution failure and supports retry/recovery", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Default delayMs={0} />);
    await expectTotal(14);
    pasteDraft(demoExamples.empty);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(0);
    expect(screen.getByText(/No matching machines\./)).toBeInTheDocument();

    rerender(<Default delayMs={0} failExecution />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Query execution failed",
      ),
    );
    expect(
      screen.queryByText(/No matching machines\./),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry results" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Query execution failed",
      ),
    );
    rerender(<Default delayMs={0} />);
    await expectTotal(0);
  });

  it("passes the disabled state through to the editor", async () => {
    render(<Default delayMs={0} disabled />);
    expect(editor()).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expectTotal(14);
  });

  it("keeps local nested filters during lookup loading, failure and retry", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={50} failSuggestions />);
    pasteDraft("fabric()");
    moveCaret(7);
    expect(
      await screen.findByRole("option", { name: /vlan filter/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading values...")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Value lookup failed",
      ),
    );
    expect(
      screen.getByRole("option", { name: /vlan filter/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      screen.getByRole("option", { name: /vlan filter/ }),
    ).toBeInTheDocument();
  });

  it("inserts numeric lookup values as exact quantities, not quoted strings", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={0} />);
    pasteDraft(demoExamples.decimal);
    moveCaret(10);
    await user.click(
      await screen.findByRole("option", { name: /107374182\.4B size/ }),
    );
    expect(editor().textContent).toBe("disk(size(107374182.4B))");
    expect(screen.getByRole("button", { name: "Submit" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(1);
    expect(
      screen.getByRole("gridcell", { name: "decimal-001" }),
    ).toBeInTheDocument();
  });

  it("uses table pagination, page sizes, and header sorting on the active search", async () => {
    const user = userEvent.setup();
    render(<Default delayMs={0} />);
    pasteDraft(demoExamples.deployment);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await expectTotal(9);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", { name: "page number" }),
      ).toHaveValue(2),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Items per page" }),
      "10",
    );
    await expectTotal(9);
    expect(screen.getByRole("spinbutton", { name: "page number" })).toHaveValue(
      1,
    );
    await user.click(screen.getByRole("button", { name: /Hostname/ }));
    await expectTotal(9);
    const table = screen.getByRole("treegrid", {
      name: "Applied query results",
    });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toHaveTextContent("wrong-vlan-001");
    expect(rows[8]).toHaveTextContent("decimal-001");
    expect(screen.getByRole("button", { name: "Next page" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
