import { useState } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";

import { QueryInput, type Suggestion } from "@/lib/components/QueryInput";

// jsdom does not move a contenteditable caret on arrow keys or End, so place it
// at a character offset the way a click would
const placeCaret = (root: HTMLElement, offset: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    if (node.parentElement?.closest("[data-chip]")) {
      remaining -= node.length;
      continue;
    }
    if (remaining <= node.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= node.length;
  }
};

describe("QueryInput", () => {
  // Mock functions for props
  const mockSetSearch = vi.fn();
  const mockSetContext = vi.fn();
  const mockSetToken = vi.fn();

  // Sample suggestions data
  const mockSuggestions: Suggestion[] = [
    { value: "active", type: "status" },
    { value: "inactive", type: "status" },
    { value: "pending", type: "status" },
    { value: "status", type: "filter" },
    { value: "created", type: "filter" },
  ];

  const defaultProps = {
    search: "",
    setSearch: mockSetSearch,
    setContext: mockSetContext,
    setToken: mockSetToken,
    suggestions: mockSuggestions,
  };

  // Stateful wrapper for tests that require actual external state management
  const QueryInputTestWrapper = ({
    initialSearch = "",
    suggestions = mockSuggestions,
  }: {
    initialSearch?: string;
    suggestions?: Suggestion[];
  }) => {
    const [search, setSearch] = useState(initialSearch);
    const [context, setContext] = useState("");
    const [token, setToken] = useState("");

    return (
      <>
        <QueryInput
          search={search}
          setSearch={setSearch}
          setContext={setContext}
          setToken={setToken}
          suggestions={suggestions}
        />
        <span data-testid="context">{context}</span>
        <span data-testid="token">{token}</span>
      </>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with default props", () => {
    render(<QueryInput {...defaultProps} />);

    expect(screen.getByTestId("p-query-input")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows placeholder text", () => {
    render(<QueryInput {...defaultProps} placeholder="Search items..." />);

    expect(
      screen.getByRole("searchbox", { name: "Search items..." }),
    ).toBeInTheDocument();
  });

  it("handles disabled state", () => {
    render(<QueryInput {...defaultProps} disabled />);

    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("contenteditable", "false");
    expect(input).toHaveAttribute("aria-disabled", "true");
  });

  it("updates search value on input change", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "test query");

    expect(input.textContent).toBe("test query");
  });

  it("displays current search value", () => {
    render(<QueryInput {...defaultProps} search="current search" />);

    const input = screen.getByRole("searchbox");
    expect(input.textContent).toBe("current search");
  });

  it("shows suggestions when focused and suggestions exist", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
  });

  it("shows only component-owned operators when no suggestions are available", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} suggestions={[]} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["NOToperator"]);
  });

  it("shows loading spinner when isLoading=true", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} isLoading />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("limits suggestions to 4 by default", async () => {
    const user = userEvent.setup();
    const manySuggestions: Suggestion[] = Array.from(
      { length: 10 },
      (_, i) => ({
        value: `item${i}`,
        type: "test",
      }),
    );

    render(<QueryInput {...defaultProps} suggestions={manySuggestions} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5); // 4 items + "Show more..."
    expect(screen.getByText("Show more...")).toBeInTheDocument();
  });

  it("shows 'Show more...' when more than 4 suggestions", async () => {
    const user = userEvent.setup();
    const manySuggestions: Suggestion[] = Array.from({ length: 6 }, (_, i) => ({
      value: `item${i}`,
      type: "test",
    }));

    render(<QueryInput {...defaultProps} suggestions={manySuggestions} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByText("Show more...")).toBeInTheDocument();
  });

  it("expands to show more suggestions when 'Show more' clicked", async () => {
    const user = userEvent.setup();
    const manySuggestions: Suggestion[] = Array.from(
      { length: 10 },
      (_, i) => ({
        value: `item${i}`,
        type: "test",
      }),
    );

    render(<QueryInput {...defaultProps} suggestions={manySuggestions} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const showMoreButton = screen.getByText("Show more...");
    await user.click(showMoreButton);

    const options = screen.getAllByRole("option");
    // All 10 items plus the NOT operator, no more "Show more..."
    expect(options).toHaveLength(11);
    expect(screen.queryByText("Show more...")).not.toBeInTheDocument();
  });

  it("selects suggestion on click", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const suggestion = screen.getByText("active");
    await user.click(suggestion);

    expect(mockSetSearch).toHaveBeenCalled();
  });

  it("selects suggestion on Enter key when highlighted", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(mockSetSearch).toHaveBeenCalled();
  });

  it("updates highlightedIndex on mouse hover", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const suggestion = screen.getAllByRole("option")[1];
    await user.hover(suggestion);

    expect(suggestion).toHaveAttribute("aria-selected", "true");
  });

  it("closes suggestions on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <QueryInput {...defaultProps} />
        <button>Outside button</button>
      </div>,
    );

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    const outsideButton = screen.getByRole("button", {
      name: "Outside button",
    });
    await user.click(outsideButton);

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("closes suggestions on Escape key", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByRole("searchbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDown moves highlight down and wraps to top", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    // First item should be highlighted by default on focus
    const firstOption = screen.queryAllByRole("option")[0];
    expect(firstOption).toHaveAttribute("aria-selected", "true");

    // Move down
    await user.keyboard("{ArrowDown}");
    const secondOption = screen.queryAllByRole("option")[1];
    expect(firstOption).toHaveAttribute("aria-selected", "false");
    expect(secondOption).toHaveAttribute("aria-selected", "true");

    // Continue to last item
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    const lastOption =
      screen.queryAllByRole("option")[mockSuggestions.length - 1];
    expect(lastOption).toHaveAttribute("aria-selected", "true");

    // Wrap to first
    await user.keyboard("{ArrowDown}");
    expect(firstOption).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowUp moves highlight up and wraps to bottom", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    // Move up from first item should wrap to last
    await user.keyboard("{ArrowUp}");
    const lastOption =
      screen.queryAllByRole("option")[mockSuggestions.length - 1];
    expect(lastOption).toHaveAttribute("aria-selected", "true");

    // Move up to previous
    await user.keyboard("{ArrowUp}");
    const secondLastOption =
      screen.queryAllByRole("option")[mockSuggestions.length - 2];
    expect(lastOption).toHaveAttribute("aria-selected", "false");
    expect(secondLastOption).toHaveAttribute("aria-selected", "true");
  });

  it("Enter selects highlighted suggestion", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.keyboard("{ArrowDown}"); // Move to second item
    await user.keyboard("{Enter}");

    expect(mockSetSearch).toHaveBeenCalled();
  });

  it("Focus shows suggestions with first item highlighted", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const firstOption = screen.queryAllByRole("option")[0];
    expect(firstOption).toHaveAttribute("aria-selected", "true");
  });

  it("sets context to the open filter name", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "status(");

    expect(screen.getByTestId("context")).toHaveTextContent("status");
  });

  it("calls setToken with correct token", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "test");

    expect(screen.getByTestId("token")).toHaveTextContent("test");
  });

  it("extracts context and token inside a filter string", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("john');

    expect(screen.getByTestId("context")).toHaveTextContent("status");
    expect(screen.getByTestId("token")).toHaveTextContent("john");
  });

  it("joins nested open filters into a dotted context", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'machine(zone("de');

    expect(screen.getByTestId("context")).toHaveTextContent("machine.zone");
    expect(screen.getByTestId("token")).toHaveTextContent("de");
  });

  it("tracks the open filter after a complete term", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") AND zone("de');

    expect(screen.getByTestId("context")).toHaveTextContent("zone");
    expect(screen.getByTestId("token")).toHaveTextContent("de");
  });

  it("clears context after the filter is closed", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") ');

    expect(screen.getByTestId("context")).toBeEmptyDOMElement();
  });

  it("inserts a filter as name() with the caret inside", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    await user.click(screen.getByText("Show more..."));
    await user.click(screen.getByText("created"));

    expect(input.textContent).toBe("created()");
    expect(screen.getByTestId("context")).toHaveTextContent("created");
  });

  it("inserts a filter after a chain operator and keeps suggestions open", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper
        suggestions={[{ value: "zone", type: "filter" }]}
      />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("deployed") AND ');
    await user.click(screen.getByRole("option", { name: /zone/ }));

    expect(input.textContent).toBe('status("deployed") AND zone()');
    expect(screen.getByTestId("context")).toHaveTextContent("zone");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("inserts a quoted value, closes the filter and hides suggestions on click", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "status(");
    await user.click(screen.getByText("active"));

    expect(input.textContent).toBe('status("active")');
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("replaces a partial string value", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("ac');
    await user.click(screen.getByText("active"));

    expect(input.textContent).toBe('status("active")');
  });

  it("wraps a value selected outside a filter in its type filter", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.click(screen.getByText("active"));

    expect(input.textContent).toBe('status("active")');
    // Cursor stays inside the new filter, as with in-filter insertion
    expect(screen.getByTestId("context")).toHaveTextContent("status");
  });

  it("wraps a value after a chain operator and replaces the partial word", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper
        suggestions={[{ value: "default", type: "zone" }]}
      />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") AND def');
    await user.click(screen.getByRole("option", { name: /^default/ }));

    expect(input.textContent).toBe('status("a") AND zone("default")');
  });

  it("wraps a value with an open fuzzy string in its type filter", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper
        suggestions={[{ value: "default", type: "zone" }]}
      />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, '"de');
    await user.click(screen.getByRole("option", { name: /^default/ }));

    expect(input.textContent).toBe('zone("default")');
  });

  it("escapes quotes in inserted values", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper suggestions={[{ value: 'a"b', type: "tag" }]} />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, "tag(");
    await user.click(screen.getByRole("option", { name: /a"b/ }));

    expect(input.textContent).toBe('tag("a\\"b")');
  });

  it("replaces the whole string around the cursor and keeps later terms", async () => {
    const user = userEvent.setup();
    const initialSearch = 'status("de") AND zone("x")';
    render(<QueryInputTestWrapper initialSearch={initialSearch} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    const cursor = 'status("de'.length;
    placeCaret(input, cursor);
    fireEvent.keyUp(input, { key: "ArrowLeft" });

    expect(screen.getByTestId("context")).toHaveTextContent("status");
    expect(screen.getByTestId("token")).toHaveTextContent("de");

    await user.click(screen.getByText("active"));

    expect(input.textContent).toBe('status("active") AND zone("x")');
  });

  it("does not duplicate an existing closing parenthesis", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper initialSearch='status("ac")' />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    placeCaret(input, 'status("ac'.length);
    fireEvent.keyUp(input, { key: "ArrowLeft" });
    await user.click(screen.getByText("active"));

    expect(input.textContent).toBe('status("active")');
  });

  it("hides suggestions after closing parenthesis", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("active")');

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("hides suggestions after closing a filter in an OR expression", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") OR zone("x")');

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not treat an operator as a partial token", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") OR');

    expect(screen.getByTestId("token")).toBeEmptyDOMElement();
  });

  it("does not suggest binary operators before a term is complete", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    expect(screen.queryByRole("option", { name: /^OR/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /^AND/ })).toBeNull();

    await user.type(input, 'status("a") OR ');
    expect(screen.queryByRole("option", { name: /^OR/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /^AND/ })).toBeNull();
  });

  it("suggests only chain operators after a complete term", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper initialSearch='status("a")' />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    placeCaret(input, input.textContent?.length ?? 0);
    await user.keyboard(" ");

    // Terms cannot follow without an explicit operator, and NOT only starts
    // a term, so the chain operators are the only suggestions
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["ANDoperator", "ORoperator"]);
  });

  it("does not suggest NOT directly after NOT", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "NOT ");
    expect(screen.queryByRole("option", { name: /^NOT/ })).toBeNull();
    expect(screen.getByRole("option", { name: /^active/ })).toBeInTheDocument();

    await user.type(input, "N");
    expect(screen.queryByRole("option", { name: /^NOT/ })).toBeNull();
  });

  it("suggests comparison operators but not NOT after NOT inside a filter", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "status(NOT ");
    await user.click(screen.getByText("Show more..."));

    expect(screen.queryByRole("option", { name: /^NOT/ })).toBeNull();
    expect(
      screen.getByRole("option", { name: /^CONTAINS/ }),
    ).toBeInTheDocument();
  });

  it("inserts an explicit AND between terms that still parses", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper
        suggestions={[{ value: "zone", type: "filter" }]}
      />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") A');
    await user.click(screen.getByRole("option", { name: /^AND/ }));
    await user.click(screen.getByRole("option", { name: /^zone/ }));

    expect(input.textContent).toBe('status("a") AND zone()');
    expect(screen.getByTestId("context")).toHaveTextContent("zone");
  });

  it("suggests NOT after a binary operator", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") OR ');
    await user.click(screen.getByText("Show more..."));

    expect(screen.getByRole("option", { name: /^NOT/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^OR/ })).toBeNull();
  });

  it("suggests unary and comparison operators after data at the start of a filter value", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "status(");
    await user.click(screen.getByText("Show more..."));

    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels.slice(0, 5)).toEqual([
      "activestatus",
      "inactivestatus",
      "pendingstatus",
      "statusfilter",
      "createdfilter",
    ]);
    expect(labels.slice(5)).toEqual([
      "NOToperator",
      "CONTAINSoperator",
      "STARTS WITHoperator",
      "ENDS WITHoperator",
      "ABOVEoperator",
      "BELOWoperator",
      "AT LEASToperator",
      "AT MOSToperator",
    ]);
  });

  it("suggests only operators after a complete value inside a filter", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a" ');

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "ANDoperator",
      "ORoperator",
    ]);
  });

  it("filters operators by the partial token", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") o');

    expect(screen.getByRole("option", { name: /^OR/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^AND/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /^NOT/ })).toBeNull();
  });

  it("completes a multi-word operator across the space", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "memory(AT L");

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["AT LEASToperator"]);
    await user.click(screen.getByRole("option", { name: /^AT LEAST/ }));

    expect(input.textContent).toBe("memory(AT LEAST ");
    expect(screen.getByTestId("context")).toHaveTextContent("memory");
  });

  it("still suggests a fully typed operator with different case", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "not");

    // Only the operator is offered; a term would be glued onto the word
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["NOToperator"]);
    await user.click(screen.getByRole("option", { name: /^NOT/ }));

    expect(input.textContent).toBe("NOT ");
  });

  it("normalizes a fully typed chain operator with different case", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") or');
    await user.click(screen.getByRole("option", { name: /^OR/ }));

    expect(input.textContent).toBe('status("a") OR ');
  });

  it("hides an operator once it is typed exactly", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") OR');
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "NOT");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("completes a partial operator and keeps suggestions open", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") O');
    await user.click(screen.getByRole("option", { name: /^OR/ }));

    expect(input.textContent).toBe('status("a") OR ');
    expect(screen.getByTestId("token")).toBeEmptyDOMElement();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("updates context/token on cursor movement", async () => {
    const user = userEvent.setup();
    render(
      <QueryInput
        {...defaultProps}
        search='status("active") AND created("test")'
      />,
    );

    const input = screen.getByRole("searchbox");
    await user.click(input);

    // Move cursor to different position
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowLeft}");

    // Should update context and token based on new cursor position
    expect(mockSetContext).toHaveBeenCalled();
    expect(mockSetToken).toHaveBeenCalled();
  });

  it("shows spinner during loading", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} isLoading />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("handles disabled suggestions", async () => {
    const user = userEvent.setup();
    const disabledSuggestions: Suggestion[] = [
      { value: "disabled", type: "status", disabled: true },
    ];

    render(<QueryInput {...defaultProps} suggestions={disabledSuggestions} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const suggestion = screen.getByText("disabled");
    await user.click(suggestion);

    // Should still work even with disabled flag (component doesn't prevent selection)
    expect(mockSetSearch).toHaveBeenCalled();
  });

  it("sets correct aria-expanded state", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-haspopup='listbox'", () => {
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("sets aria-owns pointing to suggestions", () => {
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("aria-owns", "query-suggestions");
  });

  it("sets proper role attributes", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("aria-label", "Search suggestions");

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
  });

  it("handles rapid typing without breaking", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");

    // Type rapidly
    await user.type(input, 'status("active") AND created("test")');

    expect(mockSetSearch).toHaveBeenCalled();
    expect(mockSetContext).toHaveBeenCalled();
    expect(mockSetToken).toHaveBeenCalled();
  });

  it("submits the query on Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <QueryInput
        {...defaultProps}
        search="existing text"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSubmit).toHaveBeenCalledWith("existing text");
  });

  it("clears the query on Escape once suggestions are closed", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} search="existing text" />);

    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Escape}");
    expect(mockSetSearch).not.toHaveBeenCalledWith("");

    await user.keyboard("{Escape}");
    expect(mockSetSearch).toHaveBeenCalledWith("");
  });

  it("maintains cursor position correctly", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "test query");

    // Move cursor to middle
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowLeft}");

    // Should update context/token based on cursor position
    expect(mockSetContext).toHaveBeenCalled();
    expect(mockSetToken).toHaveBeenCalled();
  });

  it("mirrors the typed text in the field", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") or "free');

    expect(input.textContent).toBe('status("a") or "free');
  });

  it("renders filter and operator chips, with fuzzy text unchanged", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") AND "free');

    expect(
      Array.from(input.querySelectorAll("[data-chip]")).map((chip) => [
        chip.textContent,
        chip.className,
      ]),
    ).toEqual([
      [
        "status(",
        "p-chip is-readonly is-inline p-query-input__chip p-query-input__chip--filter",
      ],
      [
        ")",
        "p-chip is-readonly is-inline p-query-input__chip p-query-input__chip--filter-close",
      ],
      [
        "AND",
        "p-chip is-readonly is-inline p-query-input__chip p-query-input__chip--operator",
      ],
    ]);
    expect(
      input.querySelector(".p-query-input__token--fuzzy")?.textContent,
    ).toBe('"free');
  });

  it("highlights a filter on Backspace, then removes the whole filter", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper initialSearch='status("a") AND x' />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    placeCaret(input, 'status("'.length - 1);
    await user.keyboard("{Backspace}");

    expect(
      input.querySelectorAll(".p-query-input__unit.is-selected"),
    ).toHaveLength(1);
    expect(input.textContent).toBe('status("a") AND x');

    await user.keyboard("{Backspace}");

    expect(input.textContent).toBe(" AND x");
  });

  it("moves the caret out of a chip instead of throwing", () => {
    render(<QueryInput {...defaultProps} search={'x status("a")'} />);
    const input = screen.getByRole("searchbox");
    const chipText = input.querySelector(
      ".p-query-input__chip--filter .p-chip__value",
    )!.firstChild!;

    input.focus();
    document.getSelection()!.collapse(chipText, 3);
    fireEvent.input(input);

    const caretNode = document.getSelection()!.anchorNode!;
    expect(caretNode.parentElement?.closest("[data-chip]")).toBeNull();
  });

  it("closes a typed grouping parenthesis right after the caret", () => {
    const Controlled = () => {
      const [search, setSearch] = useState("x ");
      return (
        <QueryInput {...defaultProps} search={search} setSearch={setSearch} />
      );
    };
    render(<Controlled />);
    const input = screen.getByRole("searchbox");
    input.focus();

    // The browser types the "(" into the caret's text node, then fires input
    const text = input.lastChild as Text;
    text.data = "(";
    document.getSelection()!.collapse(text, 1);
    fireEvent.input(input);

    expect(input.textContent).toBe("x ()");
  });

  it("does not close a filter's parenthesis", () => {
    const Controlled = () => {
      const [search, setSearch] = useState("x ");
      return (
        <QueryInput {...defaultProps} search={search} setSearch={setSearch} />
      );
    };
    render(<Controlled />);
    const input = screen.getByRole("searchbox");
    input.focus();

    const text = input.lastChild as Text;
    text.data = "status(";
    document.getSelection()!.collapse(text, 7);
    fireEvent.input(input);

    expect(input.textContent).toBe("x status(");
  });

  it("steps over the closer of a grouping instead of doubling it", () => {
    const Controlled = () => {
      const [search, setSearch] = useState("x ()");
      return (
        <QueryInput {...defaultProps} search={search} setSearch={setSearch} />
      );
    };
    render(<Controlled />);
    const input = screen.getByRole("searchbox");
    input.focus();

    // The browser types ")" after the "(" and before the existing ")"
    const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    let open = walker.nextNode() as Text | null;
    while (open && !open.data.includes("(")) {
      open = walker.nextNode() as Text | null;
    }
    open!.data = "()";
    document.getSelection()!.collapse(open!, 2);
    fireEvent.input(input);

    expect(input.textContent).toBe("x ()");
  });

  it("rings every unit the selection touches, and clears when collapsed", () => {
    render(<QueryInput {...defaultProps} search={'status("a") AND x'} />);
    const input = screen.getByRole("searchbox");

    document.getSelection()!.selectAllChildren(input);
    document.dispatchEvent(new Event("selectionchange"));
    expect(
      input.querySelectorAll(".p-query-input__unit.is-selected"),
    ).toHaveLength(2);

    document.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(
      input.querySelectorAll(".p-query-input__unit.is-selected"),
    ).toHaveLength(0);
  });

  it("nests an inner filter's ring inside the filter that contains it", () => {
    render(<QueryInput {...defaultProps} search={'machine(zone("de"))'} />);
    const input = screen.getByRole("searchbox");
    const units = input.querySelectorAll(".p-query-input__unit");

    expect(units).toHaveLength(2);
    expect(units[1].parentElement!.closest(".p-query-input__unit")).toBe(
      units[0],
    );
  });
});
