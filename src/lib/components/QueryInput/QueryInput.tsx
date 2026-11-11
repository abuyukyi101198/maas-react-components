import {
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  useMemo,
  useCallback,
  ReactElement,
  DetailedHTMLProps,
  HTMLAttributes,
  Dispatch,
  SetStateAction,
} from "react";

import { SearchBox, Spinner } from "@canonical/react-components";
import classNames from "classnames";

import "./QueryInput.scss";
import {
  analyzeQuery,
  replaceQueryToken,
} from "@/lib/components/QueryInput/queryAnalyzer";

const SUGGESTION_LIMITS = {
  DEFAULT: 4,
  EXPANDED: 15,
} as const;

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
} & DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

type SuggestionState = {
  isVisible: boolean;
  highlightedIndex: number;
  showingMore: boolean;
  cursorPosition: number;
};

/**
 * QueryInput - A feature-rich search query constructor for React applications
 *
 * A keyboard-centric search query constructor field with externally controlled
 * assistive suggestion and insertion features
 *
 * @param {Object} props - Component props
 * @param {string} [props.className] - Additional CSS class for the table wrapper
 * @param {disabled} [props.disabled] - Field disabling boolean
 * @param {search} [props.search] - Externally controlled search query string
 * @param {setSearch} [props.setSearch] - Search query string setter
 * @param {context} [props.context] - Externally controlled suggestion context
 * @param {setContext} [props.setContext] - Suggestion context setter
 * @param {setToken} [props.setToken] - Partial token string for autocomplete
 * @param {suggestions} [props.suggestions] - Context-aware suggestions
 * @param {isLoading} [props.isLoading] - Loading suggestion state boolean
 * @param {placeholder} [props.placeholder] - Search field placeholder text
 *
 * @returns {ReactElement} - The rendered query input component
 *
 * @example
 * <QueryInput
 *   search={search}
 *   setSearch={setSearch}
 *   context={context}
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
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleSuggestions = useMemo(() => {
    const maxToShow = suggestionState.showingMore
      ? SUGGESTION_LIMITS.EXPANDED
      : SUGGESTION_LIMITS.DEFAULT;
    const capped = suggestions.slice(0, maxToShow);
    const shouldShowMore =
      !suggestionState.showingMore && suggestions.length > maxToShow;

    return shouldShowMore
      ? [...capped, { value: "Show more...", type: "more" }]
      : capped;
  }, [suggestions, suggestionState.showingMore]);

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
      setSearch(newValue);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
        }
      }, 0);

      updateSuggestionState({
        highlightedIndex: 0,
        showingMore: false,
        isVisible: selected.type === "filter",
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
    if (!inputRef.current) return;

    const cursorPosition = inputRef.current.selectionStart || 0;
    const analysis = analyzeQuery(search, cursorPosition);

    setContext(analysis.context);
    setToken(analysis.token);

    updateSuggestionState((prev) => ({
      ...prev,
      isVisible: !analysis.shouldHideSuggestions,
      cursorPosition,
    }));
  }, [search, setContext, setToken, updateSuggestionState]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const { key } = e;

      if (suggestionState.isVisible) {
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
      visibleSuggestions.length,
      updateSuggestionState,
      selectSuggestion,
      updateCursorPosition,
    ],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
    updateSuggestionState({
      isVisible: true,
      highlightedIndex: 0,
    });
  }, [updateSuggestionState]);

  const handleChange = useCallback(
    (value: string) => {
      const cursorPosition = inputRef.current?.selectionStart || value.length;
      const analysis = analyzeQuery(value, cursorPosition);

      setContext(analysis.context);
      setToken(analysis.token);
      setSearch(value);

      updateSuggestionState({
        highlightedIndex: 0,
        isVisible: !analysis.shouldHideSuggestions,
        showingMore: false,
        cursorPosition,
      });
    },
    [setContext, setToken, setSearch, updateSuggestionState],
  );

  const handleClick = useCallback(() => {
    setTimeout(updateCursorPosition, 0);
  }, [updateCursorPosition]);

  const handleClear = useCallback(() => {
    updateSuggestionState({
      isVisible: false,
      highlightedIndex: -1,
    });
  }, [updateSuggestionState]);

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
      <SearchBox
        disabled={disabled}
        placeholder={placeholder}
        value={search}
        externallyControlled
        autoComplete="off"
        id="query-input"
        name="query-input"
        ref={inputRef}
        onFocus={handleFocus}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClear={handleClear}
        onClick={handleClick}
        aria-disabled={disabled}
        aria-expanded={suggestionState.isVisible}
        aria-haspopup="listbox"
        aria-owns="query-suggestions"
      />
      {suggestionState.isVisible && suggestions.length > 0 && (
        <ul
          className="p-query-input__list"
          ref={listRef}
          id="query-suggestions"
          role="listbox"
          aria-label="Search suggestions"
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
                  <span
                    className={classNames({
                      "u-text--muted": item.type === "more",
                    })}
                  >
                    {item.value}
                  </span>
                  {item.type === "filter" && (
                    <span className="u-text--muted">()</span>
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
  );
};
