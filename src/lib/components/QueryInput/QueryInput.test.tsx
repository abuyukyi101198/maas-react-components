import { useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";

import { QueryInput, type Suggestion } from "@/lib/components/QueryInput";

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

    expect(screen.getByPlaceholderText("Search items...")).toBeInTheDocument();
  });

  it("handles disabled state", () => {
    render(<QueryInput {...defaultProps} disabled />);

    const input = screen.getByRole("searchbox");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-disabled", "true");
  });

  it("updates search value on input change", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "test query");

    expect(input).toHaveValue("test query");
  });

  it("displays current search value", () => {
    render(<QueryInput {...defaultProps} search="current search" />);

    const input = screen.getByRole("searchbox");
    expect(input).toHaveValue("current search");
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

  it("inserts a filter as name(", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.click(input);

    await user.click(screen.getByText("Show more..."));
    await user.click(screen.getByText("created"));

    expect(input).toHaveValue("created(");
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

    expect(input).toHaveValue('status("deployed") AND zone(');
    expect(screen.getByTestId("context")).toHaveTextContent("zone");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("inserts a quoted value, closes the filter and hides suggestions on click", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, "status(");
    await user.click(screen.getByText("active"));

    expect(input).toHaveValue('status("active")');
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("replaces a partial string value", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("ac');
    await user.click(screen.getByText("active"));

    expect(input).toHaveValue('status("active")');
  });

  it("wraps a value selected outside a filter in its type filter", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.click(screen.getByText("active"));

    expect(input).toHaveValue('status("active")');
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

    expect(input).toHaveValue('status("a") AND zone("default")');
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

    expect(input).toHaveValue('zone("default")');
  });

  it("escapes quotes in inserted values", async () => {
    const user = userEvent.setup();
    render(
      <QueryInputTestWrapper suggestions={[{ value: 'a"b', type: "tag" }]} />,
    );

    const input = screen.getByRole("searchbox");
    await user.type(input, "tag(");
    await user.click(screen.getByRole("option", { name: /a"b/ }));

    expect(input).toHaveValue('tag("a\\"b")');
  });

  it("replaces the whole string around the cursor and keeps later terms", async () => {
    const user = userEvent.setup();
    const initialSearch = 'status("de") AND zone("x")';
    render(<QueryInputTestWrapper initialSearch={initialSearch} />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    const cursor = 'status("de'.length;
    await user.keyboard("{ArrowLeft}".repeat(initialSearch.length - cursor));

    expect(screen.getByTestId("context")).toHaveTextContent("status");
    expect(screen.getByTestId("token")).toHaveTextContent("de");

    await user.click(screen.getByText("active"));

    expect(input).toHaveValue('status("active") AND zone("x")');
  });

  it("does not duplicate an existing closing parenthesis", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper initialSearch='status("ac")' />);

    const input = screen.getByRole("searchbox");
    await user.click(input);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    await user.click(screen.getByText("active"));

    expect(input).toHaveValue('status("active")');
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
    await user.keyboard("{End} ");

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

    expect(input).toHaveValue('status("a") AND zone(');
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
      "status()filter",
      "created()filter",
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

    expect(input).toHaveValue("memory(AT LEAST ");
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

    expect(input).toHaveValue("NOT ");
  });

  it("normalizes a fully typed chain operator with different case", async () => {
    const user = userEvent.setup();
    render(<QueryInputTestWrapper />);

    const input = screen.getByRole("searchbox");
    await user.type(input, 'status("a") or');
    await user.click(screen.getByRole("option", { name: /^OR/ }));

    expect(input).toHaveValue('status("a") OR ');
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

    expect(input).toHaveValue('status("a") OR ');
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

  it("handles clear button functionality", async () => {
    const user = userEvent.setup();
    render(<QueryInput {...defaultProps} search="existing text" />);

    // SearchBox component should have a clear button
    const clearButton = screen.getByRole("button", { name: /clear/i });
    await user.click(clearButton);

    // Should hide suggestions when cleared
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
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
});
