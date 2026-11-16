import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  KeyboardEvent,
  FormEvent,
  ClipboardEvent,
  useMemo,
  useCallback,
  ReactElement,
  DetailedHTMLProps,
  HTMLAttributes,
  Dispatch,
  SetStateAction,
} from "react";

import { Icon, Spinner } from "@canonical/react-components";
import classNames from "classnames";

import "./QueryInput.scss";
import {
  analyzeQuery,
  QuerySegment,
  QueryUnit,
  replaceQueryToken,
  segmentQuery,
  stepOverUnit,
  tokenizeQuery,
} from "@/lib/components/QueryInput/queryAnalyzer";

const SUGGESTION_LIMITS = {
  DEFAULT: 4,
  EXPANDED: 15,
} as const;

const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta"];

export type Suggestion = {
  value: string;
  type: string;
  disabled?: boolean;
};

type QueryInputProps = {
  className?: string;
  disabled?: boolean;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  setContext: Dispatch<SetStateAction<string>>;
  setToken: Dispatch<SetStateAction<string>>;
  suggestions: Suggestion[];
  isLoading?: boolean;
  placeholder?: string;
  onSubmit?: (search: string) => void;
} & DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

type SuggestionState = {
  isVisible: boolean;
  highlightedIndex: number;
  showingMore: boolean;
  cursorPosition: number;
};

// Character offset of a DOM point. Chip text counts, since it is query text.
const offsetOf = (root: HTMLElement, node: Node, offset: number): number => {
  const range = document.createRange();
  range.setStart(root, 0);
  // A selection can outlive a redraw; clamp it to the node it points into
  const size =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length;
  range.setEnd(node, Math.min(offset, size));
  return range.toString().length;
};

const readCursor = (root: HTMLElement): number | null => {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  return offsetOf(root, range.startContainer, range.startOffset);
};

// Moves the caret to a character offset, inside editable text only
const placeCaret = (root: HTMLElement, target: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = target;
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const editable = !node.parentElement?.closest("[data-chip]");
    // A target inside a chip leaves remaining negative; the caret then moves to
    // the next editable text instead of an out-of-range offset
    if (editable && remaining <= node.length) {
      const range = document.createRange();
      range.setStart(node, Math.max(remaining, 0));
      range.collapse(true);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= node.length;
  }
};

// Structure of a query: chips and fuzzy text, but not plain text, so typing
// plain text leaves the shape unchanged.
const shapeOf = (segments: QuerySegment[]): string =>
  segments
    .map((s) =>
      s.unit === null && s.role !== "fuzzy" ? "t" : `${s.role}:${s.text}`,
    )
    .join("\u0001");

// True when the field already shows the value, so a redraw would only drop the
// live selection
const isRendered = (root: HTMLElement, value: string): boolean =>
  root.dataset.shape === shapeOf(segmentQuery(value).segments) &&
  (root.textContent ?? "").replace(/\u00a0/g, " ") === value;

// A single typed "(" outside a string that opens a grouping, not a filter's
// arguments; the grouping then gets its ")" right after the caret
const isTypedGroupOpen = (
  value: string,
  cursor: number,
  previous: string,
): boolean =>
  value.length === previous.length + 1 &&
  value[cursor - 1] === "(" &&
  !analyzeQuery(value, cursor).isInString &&
  !segmentQuery(value).units.some(
    (unit) => unit.kind === "filter" && unit.anchors[0] === cursor,
  );

// Net count of grouping "(" minus ")" outside strings before the caret
const openDepth = (text: string): number =>
  tokenizeQuery(text).reduce((depth, token) => {
    if (token.kind !== "text") return depth;
    if (token.text === "(") return depth + 1;
    return token.text === ")" ? depth - 1 : depth;
  }, 0);

// A single typed ")" just before an existing ")" inside an open group steps
// over it, so the group is not doubled
const isTypedGroupClose = (
  value: string,
  cursor: number,
  previous: string,
): boolean =>
  value.length === previous.length + 1 &&
  value[cursor - 1] === ")" &&
  value[cursor] === ")" &&
  !analyzeQuery(value, cursor).isInString &&
  openDepth(value.slice(0, cursor - 1)) > 0;

// The query after one typed character, from the field's text
const withTypedCharacter = (
  typed: string,
  cursor: number,
  previous: string,
): string => {
  if (isTypedGroupOpen(typed, cursor, previous)) {
    return typed.slice(0, cursor) + ")" + typed.slice(cursor);
  }
  if (isTypedGroupClose(typed, cursor, previous)) {
    return typed.slice(0, cursor - 1) + typed.slice(cursor);
  }
  return typed;
};

// Rebuilds the field from the query string. Chips are non-editable elements;
// an empty text node sits on each side of them so the caret always has a place.
const renderEditor = (
  root: HTMLElement,
  value: string,
  highlight: QueryUnit | null,
) => {
  const { segments, units } = segmentQuery(value);
  const nodes: Node[] = [];
  // Each unit's chips sit in its own wrapper, so a ring encloses exactly that
  // unit. A filter's wrapper nests the units inside it, so an inner ring sits
  // within the outer one
  const wrappers = new Map<number, HTMLElement>();
  // Filters still open, innermost last
  const open: number[] = [];
  const place = (...added: Node[]) => {
    const parent = open.length > 0 ? wrappers.get(open.at(-1)!) : undefined;
    if (parent) parent.append(...added);
    else nodes.push(...added);
  };

  for (const segment of segments) {
    if (segment.unit === null) {
      if (segment.role === "fuzzy") {
        const fuzzy = document.createElement("span");
        fuzzy.className = "p-query-input__token--fuzzy";
        fuzzy.textContent = segment.text;
        place(fuzzy);
      } else {
        place(document.createTextNode(segment.text));
      }
      continue;
    }

    const unit = units[segment.unit];
    const isFilter =
      segment.role === "filter" || segment.role === "filter-close";
    const chip = document.createElement("span");
    chip.className = classNames(
      "p-chip",
      "is-readonly",
      "is-inline",
      "p-query-input__chip",
      `p-query-input__chip--${segment.role}`,
    );
    chip.contentEditable = "false";
    chip.setAttribute("data-chip", "");
    // A filter's parenthesis stays in the query text; the chip edge draws it
    const value = document.createElement("span");
    value.className = "p-chip__value";
    value.textContent = isFilter ? segment.text.slice(0, -1) : segment.text;
    chip.append(value);
    if (isFilter) {
      const paren = document.createElement("span");
      paren.className = "p-query-input__paren";
      paren.textContent = segment.text.slice(-1);
      chip.append(paren);
    }

    if (segment.role === "filter-close") {
      // The closer joins its filter's wrapper, which then closes
      wrappers.get(segment.unit)?.append(document.createTextNode(""), chip);
      open.pop();
      continue;
    }

    const element = document.createElement("span");
    element.className = "p-query-input__unit";
    element.dataset.unit = String(segment.unit);
    element.dataset.start = String(unit.start);
    element.dataset.end = String(unit.end);
    element.append(document.createTextNode(""), chip);
    wrappers.set(segment.unit, element);
    place(element);
    if (segment.role === "filter") open.push(segment.unit);
  }
  nodes.push(document.createTextNode(""));

  root.replaceChildren(...nodes);
  root.dataset.empty = String(value === "");
  root.dataset.shape = shapeOf(segments);
};

// Rings the units the selection touches, and the unit a Backspace highlighted.
// The ring is on each unit's wrapper, so a filter's opener, value, and closer
// share one outline
const markSelectedUnits = (root: HTMLElement, highlight: QueryUnit | null) => {
  const selection = document.getSelection();
  const range =
    selection && !selection.isCollapsed && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : null;
  const start =
    range && root.contains(range.startContainer)
      ? offsetOf(root, range.startContainer, range.startOffset)
      : 0;
  const end =
    range && root.contains(range.endContainer)
      ? offsetOf(root, range.endContainer, range.endOffset)
      : (root.textContent ?? "").length;
  root.querySelectorAll<HTMLElement>(".p-query-input__unit").forEach((unit) => {
    const unitStart = Number(unit.dataset.start);
    const unitEnd = Number(unit.dataset.end);
    const highlighted =
      highlight !== null &&
      unitStart === highlight.start &&
      unitEnd === highlight.end;
    const selected =
      range !== null &&
      range.intersectsNode(root) &&
      unitStart < end &&
      start < unitEnd;
    unit.classList.toggle("is-selected", highlighted || selected);
  });
};

// Redraws the field and keeps the caret at its offset when the field has focus
const redraw = (
  root: HTMLElement,
  value: string,
  highlight: QueryUnit | null,
  cursor?: number,
) => {
  const focused = document.activeElement === root;
  const target = cursor ?? (focused ? readCursor(root) : null);
  renderEditor(root, value, highlight);
  if (focused && target !== null) placeCaret(root, target);
  markSelectedUnits(root, highlight);
};

/**
 * QueryInput - A feature-rich search query constructor for React applications
 *
 * A keyboard-centric search query constructor field with externally controlled
 * assistive suggestion and insertion features. Filters and operators are
 * drawn as chips; grouping parentheses stay plain text. Backspace on a chip
 * highlights it, and a second Backspace removes it with its contents.
 *
 * @param {Object} props - Component props
 * @param {string} [props.className] - Additional CSS class for the table wrapper
 * @param {disabled} [props.disabled] - Field disabling boolean
 * @param {search} [props.search] - Externally controlled search query string
 * @param {setSearch} [props.setSearch] - Search query string setter
 * @param {setContext} [props.setContext] - Setter for the dot-separated open filter path at the cursor
 * @param {setToken} [props.setToken] - Partial token string for autocomplete
 * @param {suggestions} [props.suggestions] - Context-aware suggestions
 * @param {isLoading} [props.isLoading] - Loading suggestion state boolean
 * @param {placeholder} [props.placeholder] - Search field placeholder text
 * @param {onSubmit} [props.onSubmit] - Called with the query on Ctrl+Enter or Submit
 *
 * @returns {ReactElement} - The rendered query input component
 *
 * @example
 * <QueryInput
 *   search={search}
 *   setSearch={setSearch}
 *   setContext={setContext}
 *   setToken={setToken}
 *   suggestions={suggestions}
 * />
 */
export const QueryInput = ({
  className,
  disabled = false,
  search,
  setSearch,
  setContext,
  setToken,
  suggestions,
  isLoading = false,
  placeholder,
  onSubmit,
  ...props
}: QueryInputProps): ReactElement => {
  const [suggestionState, setSuggestionState] = useState<SuggestionState>({
    isVisible: false,
    highlightedIndex: -1,
    showingMore: false,
    cursorPosition: 0,
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // Chip highlighted by a first Backspace; a second Backspace removes it
  const highlightRef = useRef<QueryUnit | null>(null);
  // Caret offset to restore after the next redraw
  const pendingCursorRef = useRef<number | null>(null);

  // Operators come from the grammar, not the data layer. They lead after a
  // complete term and trail the data at the start of a term; data terms the
  // grammar cannot accept without an operator are dropped.
  const { operators, acceptsTerm, isTokenInChain, overwritesUnit } = useMemo(
    () => analyzeQuery(search, suggestionState.cursorPosition),
    [search, suggestionState.cursorPosition],
  );
  const isSuggesting = suggestionState.isVisible && !overwritesUnit;
  const units = useMemo(() => segmentQuery(search).units, [search]);
  const allSuggestions = useMemo(() => {
    const operatorSuggestions = operators.map((value) => ({
      value,
      type: "operator",
    }));
    const termSuggestions = acceptsTerm ? suggestions : [];
    return isTokenInChain
      ? [...operatorSuggestions, ...termSuggestions]
      : [...termSuggestions, ...operatorSuggestions];
  }, [operators, acceptsTerm, isTokenInChain, suggestions]);

  const visibleSuggestions = useMemo(() => {
    const maxToShow = suggestionState.showingMore
      ? SUGGESTION_LIMITS.EXPANDED
      : SUGGESTION_LIMITS.DEFAULT;
    const capped = allSuggestions.slice(0, maxToShow);
    const shouldShowMore =
      !suggestionState.showingMore && allSuggestions.length > maxToShow;

    return shouldShowMore
      ? [...capped, { value: "Show more...", type: "more" }]
      : capped;
  }, [allSuggestions, suggestionState.showingMore]);

  const updateSuggestionState = useCallback(
    (
      updates:
        | Partial<SuggestionState>
        | ((prev: SuggestionState) => Partial<SuggestionState>),
    ) => {
      if (typeof updates === "function") {
        setSuggestionState((prev) => ({ ...prev, ...updates(prev) }));
      } else {
        setSuggestionState((prev) => ({ ...prev, ...updates }));
      }
    },
    [],
  );

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        updateSuggestionState({
          isVisible: false,
          highlightedIndex: -1,
        });
      }
    },
    [updateSuggestionState],
  );

  // Draws the field from the query string after every change to it
  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const cursor = pendingCursorRef.current ?? undefined;
    pendingCursorRef.current = null;
    // Typed text is already on screen; redrawing would drop the live selection
    if (isRendered(root, search)) return;
    redraw(root, search, highlightRef.current, cursor);
  }, [search]);

  // Rings the units that a selection of any kind touches
  useEffect(() => {
    const onSelectionChange = () => {
      if (editorRef.current) {
        markSelectedUnits(editorRef.current, highlightRef.current);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Sets a new query string, or redraws in place when it is unchanged
  const commitQuery = useCallback(
    (value: string, cursorPosition: number) => {
      if (value === search) {
        if (editorRef.current) {
          redraw(editorRef.current, value, null, cursorPosition);
        }
      } else {
        pendingCursorRef.current = cursorPosition;
        setSearch(value);
      }
      const analysis = analyzeQuery(value, cursorPosition);
      setContext(analysis.context);
      setToken(analysis.token);
      updateSuggestionState({
        highlightedIndex: 0,
        isVisible: !analysis.shouldHideSuggestions,
        showingMore: false,
        cursorPosition,
      });
    },
    [search, setSearch, setContext, setToken, updateSuggestionState],
  );

  const selectSuggestion = useCallback(
    (index: number) => {
      const selected = visibleSuggestions[index];
      if (!selected) return;

      if (selected.type === "more") {
        updateSuggestionState({ showingMore: true });
        return;
      }

      const analysis = analyzeQuery(search, suggestionState.cursorPosition);
      const { value: newValue, cursor: newCursorPosition } = replaceQueryToken(
        search,
        analysis,
        selected,
      );

      const { context: newContext, token: newToken } = analyzeQuery(
        newValue,
        newCursorPosition,
      );

      setContext(newContext);
      setToken(newToken);
      highlightRef.current = null;
      editorRef.current?.focus();
      if (newValue === search) {
        if (editorRef.current) {
          redraw(editorRef.current, newValue, null, newCursorPosition);
        }
      } else {
        pendingCursorRef.current = newCursorPosition;
        setSearch(newValue);
      }

      updateSuggestionState({
        highlightedIndex: 0,
        showingMore: false,
        isVisible: selected.type === "filter" || selected.type === "operator",
        cursorPosition: newCursorPosition,
      });
    },
    [
      visibleSuggestions,
      search,
      suggestionState.cursorPosition,
      setContext,
      setToken,
      setSearch,
      updateSuggestionState,
    ],
  );

  const updateCursorPosition = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const cursorPosition = readCursor(root);
    if (cursorPosition === null) return;

    const analysis = analyzeQuery(search, cursorPosition);

    setContext(analysis.context);
    setToken(analysis.token);

    updateSuggestionState((prev) => ({
      ...prev,
      isVisible: !analysis.shouldHideSuggestions,
      cursorPosition,
    }));
  }, [search, setContext, setToken, updateSuggestionState]);

  const handleClear = useCallback(() => {
    setSearch("");
    setContext("");
    setToken("");
    editorRef.current?.focus();
    updateSuggestionState({
      isVisible: false,
      highlightedIndex: 0,
      showingMore: false,
      cursorPosition: 0,
    });
  }, [setSearch, setContext, setToken, updateSuggestionState]);

  const handleSubmit = useCallback(() => {
    onSubmit?.(search);
    updateSuggestionState({ isVisible: false, highlightedIndex: -1 });
  }, [onSubmit, search, updateSuggestionState]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const { key } = e;
      if (search !== "" && key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      if (isSuggesting) {
        const suggestionCount = visibleSuggestions.length;

        switch (key) {
          case "Tab":
          case "ArrowDown":
            e.preventDefault();
            updateSuggestionState({
              highlightedIndex:
                (suggestionState.highlightedIndex + 1) % suggestionCount,
            });
            return;

          case "ArrowUp":
            e.preventDefault();
            updateSuggestionState({
              highlightedIndex:
                suggestionState.highlightedIndex <= 0
                  ? suggestionCount - 1
                  : suggestionState.highlightedIndex - 1,
            });
            return;

          case "Enter":
            e.preventDefault();
            if (suggestionState.highlightedIndex >= 0) {
              selectSuggestion(suggestionState.highlightedIndex);
            } else {
              updateSuggestionState({ isVisible: false });
            }
            return;

          case "Escape":
            e.preventDefault();
            updateSuggestionState({
              isVisible: false,
              highlightedIndex: -1,
            });
            return;
        }
      }

      if (key === "Escape") {
        e.preventDefault();
        handleClear();
        return;
      }

      // The field is a single line; Enter must not insert a line break
      if (key === "Enter") {
        e.preventDefault();
        return;
      }

      const root = editorRef.current;
      const selection = document.getSelection();
      if (root && key === "Backspace" && selection?.isCollapsed) {
        const cursor = readCursor(root);
        // A chip is removed when the caret sits at one of its anchors
        const unit = units
          .filter((candidate) => candidate.anchors.includes(cursor ?? -1))
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

        if (unit) {
          e.preventDefault();
          const highlight = highlightRef.current;
          if (
            highlight &&
            highlight.start === unit.start &&
            highlight.end === unit.end
          ) {
            highlightRef.current = null;
            commitQuery(
              search.slice(0, unit.start) + search.slice(unit.end),
              unit.start,
            );
          } else {
            highlightRef.current = unit;
            redraw(root, search, unit, cursor ?? undefined);
          }
          return;
        }
      } else if (root && highlightRef.current && !MODIFIER_KEYS.includes(key)) {
        highlightRef.current = null;
        redraw(root, search, null);
      }

      if (
        root &&
        selection?.isCollapsed &&
        !e.shiftKey &&
        (key === "ArrowLeft" || key === "ArrowRight")
      ) {
        const cursor = readCursor(root);
        const target =
          cursor === null
            ? null
            : stepOverUnit(
                units,
                cursor,
                key === "ArrowLeft" ? "left" : "right",
              );
        if (target !== null) {
          e.preventDefault();
          placeCaret(root, target);
          setTimeout(updateCursorPosition, 0);
          return;
        }
      }

      if (
        key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "Home" ||
        key === "End"
      ) {
        setTimeout(updateCursorPosition, 0);
      }
    },
    [
      suggestionState,
      isSuggesting,
      visibleSuggestions.length,
      units,
      search,
      updateSuggestionState,
      selectSuggestion,
      commitQuery,
      updateCursorPosition,
      handleSubmit,
      handleClear,
    ],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const { key } = e;
      if (
        key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "Home" ||
        key === "End"
      ) {
        updateCursorPosition();
      }
    },
    [updateCursorPosition],
  );

  const handleFocus = useCallback(() => {
    // Focus runs before click, so it must use the same caret rule as a click;
    // otherwise the list opens on mousedown and closes on click
    updateCursorPosition();
    updateSuggestionState({ highlightedIndex: 0 });
  }, [updateCursorPosition, updateSuggestionState]);

  const handleInput = useCallback(
    (e: FormEvent<HTMLDivElement>) => {
      const root = e.currentTarget;
      // Browsers may type a non-breaking space for a trailing space
      const typed = (root.textContent ?? "").replace(/\u00a0/g, " ");
      highlightRef.current = null;
      const cursor = readCursor(root) ?? typed.length;
      const value = withTypedCharacter(typed, cursor, search);
      commitQuery(value, cursor);
    },
    [commitQuery, search],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = e.currentTarget;
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const start = offsetOf(root, range.startContainer, range.startOffset);
      const end = offsetOf(root, range.endContainer, range.endOffset);
      const text = e.clipboardData
        .getData("text/plain")
        .replace(/[\r\n]+/g, " ");

      highlightRef.current = null;
      commitQuery(
        search.slice(0, start) + text + search.slice(end),
        start + text.length,
      );
    },
    [search, commitQuery],
  );

  const handleClick = useCallback(() => {
    const root = editorRef.current;
    if (root && highlightRef.current) {
      highlightRef.current = null;
      redraw(root, search, null);
    }
    setTimeout(updateCursorPosition, 0);
  }, [search, updateCursorPosition]);

  const handleMouseEnter = useCallback(
    (index: number) => {
      updateSuggestionState({ highlightedIndex: index });
    },
    [updateSuggestionState],
  );

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  return (
    <div
      className={classNames("p-query-input", className)}
      data-testid="p-query-input"
      ref={panelRef}
      {...props}
    >
      <div className="p-query-input__bar">
        <div
          className="p-query-input__field"
          ref={editorRef}
          role="searchbox"
          id="query-input"
          contentEditable={!disabled}
          spellCheck={false}
          data-placeholder={placeholder}
          aria-label={placeholder ?? "Search"}
          aria-disabled={disabled}
          aria-multiline={false}
          aria-expanded={isSuggesting}
          aria-haspopup="listbox"
          aria-owns="query-suggestions"
          onFocus={handleFocus}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={handleClick}
          onPaste={handlePaste}
        />
        <div className="p-query-input__actions">
          <Icon name="search" />
        </div>
        {isSuggesting && allSuggestions.length > 0 && (
          <ul
            className="p-query-input__list"
            ref={listRef}
            id="query-suggestions"
            role="listbox"
            aria-label="Search suggestions"
            // Keep focus on the field so the post-selection refocus does not
            // fire a focus event that reopens the list.
            onMouseDown={(e) => e.preventDefault()}
          >
            {isLoading ? (
              <div className="p-query-input__loading">
                <Spinner text="Loading..." />
              </div>
            ) : (
              visibleSuggestions.map((item, index) => (
                <li
                  key={`${item.value}-${index}`}
                  className={classNames("p-query-input__item", {
                    highlight: index === suggestionState.highlightedIndex,
                  })}
                  onClick={() => selectSuggestion(index)}
                  onKeyDown={() => selectSuggestion(index)}
                  onMouseEnter={() => handleMouseEnter(index)}
                  role="option"
                  aria-selected={index === suggestionState.highlightedIndex}
                  tabIndex={-1}
                >
                  <span className="p-query-input__item-label">
                    {item.type === "filter" || item.type === "operator" ? (
                      <span
                        className={classNames(
                          "p-chip is-readonly is-inline p-query-input__chip p-query-input__chip--pill",
                          `p-query-input__chip--${item.type}`,
                        )}
                      >
                        <span className="p-chip__value">{item.value}</span>
                      </span>
                    ) : (
                      <span
                        className={classNames({
                          "u-text--muted": item.type === "more",
                        })}
                      >
                        {item.value}
                      </span>
                    )}
                  </span>
                  {item.type !== "more" && (
                    <span className="u-text--muted u-align-text--right">
                      {item.type}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
};
