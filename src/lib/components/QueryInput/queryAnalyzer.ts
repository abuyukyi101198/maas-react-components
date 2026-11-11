import { Suggestion } from "@/lib";
import {
  parse,
  SyntaxError as PeggySyntaxError,
} from "@/lib/components/QueryInput/maasql.gen";

export type QueryAnalysis = {
  context: string; /** Dot-separated open filter names, outermost first; "" if none */
  token: string; /** Prefix at the cursor; complete JSON string escapes are decoded, unfinished/invalid escapes stay literal */
  tokenStart: number; /** Index where replacement starts in the input */
  tokenEnd: number; /** Index where replacement ends in the input */
  completeQuery: string; /** Full input if valid; otherwise a trimmed prefix before the cursor */
  ast:
    | unknown
    | null; /** Peggy AST of `completeQuery`; null if it does not parse */
  isInString: boolean; /** The cursor is within an open-quoted string or not */
  isInChain: boolean; /** The cursor is after an enclosed token, allowing for operator chaining */
  shouldHideSuggestions: boolean; /** The cursor is on a non-suggestible token e.g. ')' */
};

type Frame = {
  kind: "filter" | "group";
  start: number;
  name: string;
};

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const WHITESPACE = /\s/;
const TOKEN_BOUNDARY = /[\s()"]/;
const OPERATOR = /^(?:NOT|OR|AND)$/i;
const DANGLING_OPERATOR = /(^|[\s(])(?:NOT|OR|AND)$/i;

const decodeStringPrefix = (input: string): string =>
  input.replace(/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (escape) =>
    JSON.parse(`"${escape}"`),
  );

const stripDanglingOperators = (input: string): string => {
  let candidate = input;
  let previous: string;
  do {
    previous = candidate;
    candidate = candidate.trimEnd();
    const match = candidate.match(DANGLING_OPERATOR);
    if (match) {
      candidate = candidate.slice(0, match.index! + match[1].length);
    }
  } while (candidate !== previous);
  return candidate.trimEnd();
};

const parseQuery = (query: string): unknown | null => {
  try {
    return parse(query);
  } catch (error) {
    if (error instanceof PeggySyntaxError) return null;
    throw error;
  }
};

export const analyzeQuery = (
  input: string,
  cursorPosition: number = input.length,
): QueryAnalysis => {
  const cursor: number = Math.max(0, Math.min(cursorPosition, input.length));
  const inputUntilCursor: string = input.slice(0, cursor);

  const stack: Frame[] = [];
  let [isInString, isInChain, isEscaped]: boolean[] = [false, false, false];
  let [stringStart, wordStart, lastTopWordStart]: number[] = [-1, -1, -1];

  for (let i = 0; i < inputUntilCursor.length; i++) {
    const currentChar = inputUntilCursor[i];

    // If currentChar is within ""
    if (isInString) {
      // This character was escaped, so a TOKEN_BOUNDARY is not parsed
      if (isEscaped) {
        isEscaped = false;
      }
      // Next character will be escaped
      else if (currentChar === "\\") {
        isEscaped = true;
      }
      // Ending quote for the current string/quote block
      else if (currentChar === '"') {
        isInString = false;
        isInChain = true;
      }
      continue;
    }

    // If starting quote block
    if (currentChar === '"') {
      isInString = true;
      isInChain = false;
      stringStart = i;
      // No longer tracking a word
      wordStart = -1;
      if (stack.length === 0) lastTopWordStart = -1;
    }
    // If starting parentheses block
    else if (currentChar === "(") {
      isInChain = false;
      // If word prefixes parentheses, it is filter syntax, otherwise group
      const word = wordStart >= 0 ? inputUntilCursor.slice(wordStart, i) : "";
      if (IDENTIFIER.test(word)) {
        stack.push({ kind: "filter", start: wordStart, name: word });
      } else {
        stack.push({ kind: "group", start: i, name: "" });
      }
      // No longer tracking a word (lastTopWordStart could still be the
      // prefixing word, so it is not reset in case the filter is not enclosed)
      wordStart = -1;
    }
    // If ending parentheses block
    else if (currentChar === ")") {
      // Can chain another item since the previous one is complete
      isInChain = true;
      // No longer tracking context
      stack.pop();
      // No longer tracking word
      wordStart = -1;
      if (stack.length === 0) lastTopWordStart = -1;
    }
    // If whitespace
    else if (WHITESPACE.test(currentChar)) {
      // No longer tracking word
      wordStart = -1;
      if (stack.length === 0) lastTopWordStart = -1;
    }
    // If word is not started, and the character is not a TOKEN_BOUNDARY
    // (those cases are depleted in previous if-else blocks)
    else if (wordStart < 0) {
      isInChain = false;
      // Start tracking new word, update as the last encountered word
      wordStart = i;
      if (stack.length === 0) lastTopWordStart = i;
    }
  }

  const context = stack
    .filter((frame) => frame.kind === "filter")
    .map((frame) => frame.name)
    .join(".");

  let tokenStart = cursor;
  let tokenEnd = cursor;
  // If current token is in string
  if (isInString) {
    tokenStart = stringStart;
    let escaped = isEscaped;
    // Walk until closing quote or the end of input
    while (tokenEnd < input.length) {
      const char = input[tokenEnd++];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        break;
      }
    }
  }
  // If not a string block
  else {
    // Backtrack token start until boundary
    while (
      tokenStart > 0 &&
      !TOKEN_BOUNDARY.test(inputUntilCursor[tokenStart - 1])
    ) {
      tokenStart--;
    }
    while (tokenEnd < input.length && !TOKEN_BOUNDARY.test(input[tokenEnd])) {
      tokenEnd++;
    }

    // Exclude whole operators without consuming any part of them.
    if (OPERATOR.test(input.slice(tokenStart, tokenEnd))) {
      tokenStart = cursor;
      tokenEnd = cursor;
    }
  }

  const token = isInString
    ? decodeStringPrefix(inputUntilCursor.slice(stringStart + 1))
    : inputUntilCursor.slice(tokenStart);

  // Trim unparseable tail of the input
  let trimAt: number;
  // If open filters, trim until the outermost open filter
  if (stack.length > 0) {
    trimAt = stack[0].start;
  }
  // If quote-block, trim until the string start (in-filter strings are
  // covered by the previous condition)
  else if (isInString) {
    trimAt = stringStart;
  }
  // If word that is not a quote block (operator or incomplete filter),
  // trim until word start
  else if (lastTopWordStart >= 0) {
    trimAt = lastTopWordStart;
  }
  // If no open context, trim until cursor
  else {
    trimAt = inputUntilCursor.length;
  }

  // Query is the complete input if parseable,
  // otherwise until the trim (which is guaranteed parseability)
  const fullAst = parseQuery(input);
  const completeQuery =
    fullAst !== null
      ? input
      : stripDanglingOperators(inputUntilCursor.slice(0, trimAt));
  const ast = fullAst !== null ? fullAst : parseQuery(completeQuery);

  const prevChar = inputUntilCursor[cursor - 1];
  const shouldHideSuggestions =
    !isInString && cursor > 0 && (prevChar === ")" || prevChar === '"');

  return {
    context,
    token,
    tokenStart,
    tokenEnd,
    completeQuery,
    ast,
    isInString,
    isInChain,
    shouldHideSuggestions,
  } as QueryAnalysis;
};

export const replaceQueryToken = (
  input: string,
  analysis: QueryAnalysis,
  selected: Suggestion,
): { value: string; cursor: number } => {
  const { context, tokenStart, tokenEnd } = analysis;
  const replacement =
    selected.type === "filter"
      ? `${selected.value}(`
      : JSON.stringify(selected.value);
  const isValue = replacement.startsWith('"');
  const closing =
    isValue && context !== "" && input[tokenEnd] !== ")" ? ")" : "";

  return {
    value:
      input.slice(0, tokenStart) +
      replacement +
      closing +
      input.slice(tokenEnd),
    cursor: tokenStart + replacement.length,
  };
};
