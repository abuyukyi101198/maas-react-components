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
  isTokenInChain: boolean; /** The token starts after an enclosed token, so operators are the expected continuation */
  operators: string[]; /** Operators the grammar accepts at the cursor, matching the partially typed operator */
  acceptsTerm: boolean; /** A value or filter term may be inserted at the token without an operator */
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
// Chain operators join two complete terms; prefix operators start a term.
// Multi-word phrases are single-space separated.
const CHAIN_OPERATORS = ["AND", "OR"];
const PREFIX_OPERATORS = [
  "NOT",
  "CONTAINS",
  "STARTS WITH",
  "ENDS WITH",
  "ABOVE",
  "BELOW",
  "AT LEAST",
  "AT MOST",
];
// A NOT directly before the operator position; negating twice is a no-op
const TRAILING_NOT = /(?:^|[\s(])NOT\s+$/i;
// Stand-ins for string, quantity, and filter operands when probing the grammar
const OPERANDS = ['"x"', "1", 'x("x")'];

const needsSeparator = (text: string): boolean => /[^\s(]$/.test(text);

// Start of `operator` partially typed at the end of `text`, or -1. Looks back
// over earlier words so multi-word phrases such as "STARTS WITH" match.
const findOperatorStart = (text: string, operator: string): number => {
  let candidate = text.length;
  while (candidate > 0 && !TOKEN_BOUNDARY.test(text[candidate - 1])) {
    candidate--;
  }

  let start = -1;
  for (let words = operator.split(" ").length; words > 0; words--) {
    const typed = text.slice(candidate).replace(/\s+/g, " ").toUpperCase();
    if (operator.startsWith(typed)) start = candidate;

    let previous = candidate;
    while (previous > 0 && WHITESPACE.test(text[previous - 1])) previous--;
    if (previous === candidate) break;
    while (previous > 0 && !TOKEN_BOUNDARY.test(text[previous - 1])) {
      previous--;
    }
    candidate = previous;
  }
  return start;
};

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
  // isInChain as it was before the word currently being typed started
  let isInChainBeforeWord = false;
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
      isInChainBeforeWord = isInChain;
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
  // The cursor is on a whole NOT/OR/AND word, which the token excludes
  let isInOperatorWord = false;
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
    isInOperatorWord = OPERATOR.test(input.slice(tokenStart, tokenEnd));
    if (isInOperatorWord) {
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

  // A word being typed has already reset isInChain, so use the chain state
  // from where that word starts (the token may exclude a whole operator word)
  const isTokenInChain =
    !isInString && (wordStart >= 0 ? isInChainBeforeWord : isInChain);

  // Operators are probed against the grammar with stand-in operands, so the
  // grammar decides which operators fit; chain operators are only offered
  // when chaining, and prefix operators only when starting a term
  let operators: string[] = [];
  let acceptsTerm = true;
  if (!isInString) {
    const closers = ")".repeat(stack.length);
    const fits = (head: string, insertion: string) =>
      OPERANDS.some(
        (operand) =>
          parseQuery(
            head +
              (needsSeparator(head) ? " " : "") +
              insertion +
              operand +
              closers,
          ) !== null,
      );
    const candidates = isTokenInChain ? CHAIN_OPERATORS : PREFIX_OPERATORS;
    // A fully typed operator phrase, in any case, is not a partial term
    let isOperatorTyped = isInOperatorWord;
    operators = candidates.filter((operator) => {
      const start = findOperatorStart(inputUntilCursor, operator);
      if (start < 0) return false;
      const typed = inputUntilCursor.slice(start).replace(/\s+/g, " ");
      if (typed.toUpperCase() === operator) isOperatorTyped = true;
      // Already typed exactly as suggested; a different case still offers it
      if (typed === operator) return false;
      const head = inputUntilCursor.slice(0, start);
      if (operator === "NOT" && TRAILING_NOT.test(head)) return false;
      return fits(head, `${operator} `);
    });
    // Terms only fit where the grammar accepts one without an operator; if no
    // operator fits either, the prefix itself is broken, so do not withhold
    // terms. Judged at tokenStart so the typed text does not affect it. A term
    // inserted at a fully typed operator would be glued onto it.
    const headAtToken = inputUntilCursor.slice(0, tokenStart);
    acceptsTerm =
      !isOperatorTyped &&
      (fits(headAtToken, "") ||
        (operators.length === 0 &&
          !candidates.some((operator) => fits(headAtToken, `${operator} `))));
  }

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
    isTokenInChain,
    operators,
    acceptsTerm,
  } as QueryAnalysis;
};

export const replaceQueryToken = (
  input: string,
  analysis: QueryAnalysis,
  selected: Suggestion,
): { value: string; cursor: number } => {
  const { context, token, tokenStart, tokenEnd } = analysis;

  if (selected.type === "operator") {
    // Outside strings the token is the raw text between tokenStart and cursor
    const cursor = tokenStart + token.length;
    const start = findOperatorStart(input.slice(0, cursor), selected.value);
    const before = input.slice(0, start >= 0 ? start : cursor);
    let end = cursor;
    while (end < input.length && !TOKEN_BOUNDARY.test(input[end])) end++;
    const replacement = `${needsSeparator(before) ? " " : ""}${selected.value} `;
    return {
      value: before + replacement + input.slice(end).trimStart(),
      cursor: before.length + replacement.length,
    };
  }

  if (selected.type === "filter") {
    const replacement = `${selected.value}(`;
    return {
      value: input.slice(0, tokenStart) + replacement + input.slice(tokenEnd),
      cursor: tokenStart + replacement.length,
    };
  }

  // Outside a filter, the suggestion type names the filter to wrap the value
  // in; inside one, the value is inserted directly and the filter is closed
  const value = JSON.stringify(selected.value);
  const opening = context === "" ? `${selected.type}(` : "";
  const closing = context === "" || input[tokenEnd] !== ")" ? ")" : "";

  return {
    value:
      input.slice(0, tokenStart) +
      opening +
      value +
      closing +
      input.slice(tokenEnd),
    cursor: tokenStart + opening.length + value.length,
  };
};
