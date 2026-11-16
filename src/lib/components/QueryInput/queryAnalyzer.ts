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
  overwritesUnit: boolean; /** An insertion here would rewrite an operator word or a filter's name, "(" or ")" */
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

// Spans an insertion must not rewrite: an operator word, a filter's name with
// its "(", and a closed filter's ")". A filter's value stays editable
const protectedSpans = (unit: QueryUnit): [number, number][] => {
  if (unit.kind === "operator") return [[unit.start, unit.end]];
  const opener: [number, number] = [unit.start, unit.anchors[0]];
  return unit.anchors.length === 2
    ? [opener, [unit.end - 1, unit.end]]
    : [opener];
};

// Collapses each whitespace run outside strings to one space, and drops runs
// at the ends or just inside a parenthesis, so padding does not carry into the
// valid query
const collapseWhitespace = (input: string): string => {
  const tokens = tokenizeQuery(input);
  return tokens
    .map((token, index) => {
      if (!/^\s+$/.test(token.text)) return token.text;
      const before = tokens[index - 1]?.text;
      const after = tokens[index + 1]?.text;
      const isEdge = index === 0 || index === tokens.length - 1;
      return isEdge || before === "(" || after === ")" ? "" : " ";
    })
    .join("");
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
  // Index of the first top-level ")" with nothing open to close, or -1
  let strayCloser = -1;

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
      if (stack.length === 0 && strayCloser < 0) strayCloser = i;
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
  // The input after the caret that a replacement overwrites, up to the token's
  // end before an operator word is excluded from the token
  let overwriteEnd = cursor;
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
    overwriteEnd = tokenEnd;
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
    overwriteEnd = tokenEnd;

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
  // A stray closer cannot be part of any valid query, so the trim stops at it
  if (strayCloser >= 0 && strayCloser < trimAt) trimAt = strayCloser;

  // Query is the complete input if parseable, otherwise the prefix before the
  // trim, which parses once open filters, strings, dangling words, and stray
  // closers are cut from it
  const fullAst = parseQuery(input);
  const completeQuery =
    fullAst !== null
      ? collapseWhitespace(input)
      : stripDanglingOperators(inputUntilCursor.slice(0, trimAt));
  const ast = parseQuery(completeQuery);

  const prevChar = inputUntilCursor[cursor - 1];
  const shouldHideSuggestions =
    !isInString && cursor > 0 && (prevChar === ")" || prevChar === '"');

  // An insertion over an operator word or a filter's name, "(" or ")" would
  // rewrite that unit, so suggestions are withheld there
  const overwritesUnit = segmentQuery(input).units.some((unit) =>
    protectedSpans(unit).some(
      ([start, end]) => tokenStart < end && start < overwriteEnd,
    ),
  );

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
    overwritesUnit,
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
    const replacement = `${selected.value}()`;
    return {
      value: input.slice(0, tokenStart) + replacement + input.slice(tokenEnd),
      cursor: tokenStart + selected.value.length + 1,
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

export type QueryTokenKind = "filter" | "operator" | "value" | "fuzzy" | "text";

export type QueryToken = { text: string; kind: QueryTokenKind };

// Whole operator phrases only; the lookahead keeps "ANDROID" a plain word
const OPERATOR_PHRASE =
  /^(?:NOT|AND|OR|CONTAINS|STARTS WITH|ENDS WITH|ABOVE|BELOW|AT LEAST|AT MOST)(?=[\s()"]|$)/i;

// Splits the input into highlightable tokens. The texts concatenate back to
// the exact input, so a layer drawn behind the text lines up with it.
export const tokenizeQuery = (input: string): QueryToken[] => {
  const tokens: QueryToken[] = [];
  // One entry per open parenthesis: whether it opens a filter
  const openGroups: boolean[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    const previous = tokens[tokens.length - 1];
    let end = index + 1;
    let kind: QueryTokenKind = "text";

    if (char === "(") {
      openGroups.push(previous?.kind === "filter");
    } else if (char === ")") {
      openGroups.pop();
    } else if (WHITESPACE.test(char)) {
      while (end < input.length && WHITESPACE.test(input[end])) end++;
    } else if (char === '"') {
      // An unterminated string ends before the next ")", which always closes
      // the filter it belongs to
      let close = index + 1;
      while (close < input.length && input[close] !== '"') {
        close += input[close] === "\\" ? 2 : 1;
      }
      if (close < input.length) {
        end = close + 1;
      } else {
        const paren = input.indexOf(")", index + 1);
        end = paren === -1 ? input.length : paren;
      }
      kind = openGroups.includes(true) ? "value" : "fuzzy";
    } else {
      const operator = input.slice(index).match(OPERATOR_PHRASE);
      if (operator) {
        end = index + operator[0].length;
        kind = "operator";
      } else {
        while (end < input.length && !TOKEN_BOUNDARY.test(input[end])) end++;
        if (input[end] === "(") kind = "filter";
        else if (openGroups.includes(true)) kind = "value";
      }
    }

    tokens.push({ text: input.slice(index, end), kind });
    index = end;
  }

  return tokens;
};

export type QuerySegment = {
  text: string;
  role: "text" | "value" | "fuzzy" | "operator" | "filter" | "filter-close";
  /** Index into `units` for chips; null for plain text */
  unit: number | null;
};

export type QueryUnit = {
  kind: "operator" | "filter";
  start: number;
  /** Exclusive; deleting a unit removes everything from start to end */
  end: number;
  /** Caret offsets where a Backspace targets this unit */
  anchors: number[];
};

// Operators are atomic: a Left or Right step into one jumps to its far edge.
// A filter is exited from its inner edges: Right before its ")" and Left after
// its "(". Elsewhere a filter's value is plain text the caret moves through.
// Returns null when the step stays in plain text.
export const stepOverUnit = (
  units: QueryUnit[],
  cursor: number,
  direction: "left" | "right",
): number | null => {
  for (const unit of units) {
    if (unit.kind === "operator") {
      if (direction === "right" && unit.start <= cursor && cursor < unit.end)
        return unit.end;
      if (direction === "left" && unit.start < cursor && cursor <= unit.end)
        return unit.start;
    } else if (direction === "right") {
      // A closed filter's ")" is the last character of its unit
      const closed = unit.anchors.length === 2;
      if (closed && cursor === unit.end - 1) return unit.end;
    } else if (cursor === unit.anchors[0]) {
      return unit.start;
    }
  }
  return null;
};

// Chips are drawn from the tokens: a filter's name and "(" form one opener
// chip, and its ")" closes the same unit. An unclosed opener runs to the end
// of the input. Grouping parentheses stay plain text.
export const segmentQuery = (
  input: string,
): { segments: QuerySegment[]; units: QueryUnit[] } => {
  const tokens = tokenizeQuery(input);
  const starts: number[] = [];
  let offset = 0;
  for (const token of tokens) {
    starts.push(offset);
    offset += token.text.length;
  }

  // Maps each opening parenthesis to the index of its closing one
  const closerOf = new Map<number, number>();
  const openers: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "text") return;
    if (token.text === "(") openers.push(index);
    else if (token.text === ")") {
      const opener = openers.pop();
      if (opener !== undefined) closerOf.set(opener, index);
    }
  });

  const units: QueryUnit[] = [];
  const segments: QuerySegment[] = [];
  // Maps a filter's closing parenthesis to its unit
  const closes = new Map<number, number>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const start = starts[index];
    const end = start + token.text.length;
    const closeUnit = closes.get(index);

    if (closeUnit !== undefined) {
      segments.push({
        text: token.text,
        role: "filter-close",
        unit: closeUnit,
      });
    } else if (token.kind === "operator") {
      units.push({ kind: "operator", start, end, anchors: [end] });
      segments.push({
        text: token.text,
        role: "operator",
        unit: units.length - 1,
      });
    } else if (token.kind === "filter" && tokens[index + 1]?.text === "(") {
      const opener = index + 1;
      const openEnd = starts[opener] + 1;
      const closer = closerOf.get(opener);
      const unitEnd = closer === undefined ? input.length : starts[closer] + 1;
      units.push({
        kind: "filter",
        start,
        end: unitEnd,
        anchors: closer === undefined ? [openEnd] : [openEnd, unitEnd],
      });
      const unit = units.length - 1;
      if (closer !== undefined) closes.set(closer, unit);
      segments.push({
        text: input.slice(start, openEnd),
        role: "filter",
        unit,
      });
      index = opener;
    } else {
      const role =
        token.kind === "value" || token.kind === "fuzzy" ? token.kind : "text";
      segments.push({ text: token.text, role, unit: null });
    }
  }

  return { segments, units };
};

// Writes nested filters with dot syntax: fabric(vlan("default")) becomes
// fabric.vlan("default"). A filter whose content is exactly one nested filter
// joins that filter's name, and the chain continues through deeper nesting
export const toDottedQuery = (input: string): string => {
  const filters = new Map<number, QueryUnit>();
  for (const unit of segmentQuery(input).units) {
    if (unit.kind === "filter") filters.set(unit.start, unit);
  }

  // A filter's content lies between its "(" and its ")" when closed
  const contentOf = (unit: QueryUnit): [number, number] => [
    unit.anchors[0],
    unit.anchors.length === 2 ? unit.end - 1 : unit.end,
  ];

  // The one filter that makes up a filter's whole content, ignoring whitespace
  const soleChildOf = (unit: QueryUnit): QueryUnit | undefined => {
    let [start, end] = contentOf(unit);
    while (start < end && WHITESPACE.test(input[start])) start++;
    while (end > start && WHITESPACE.test(input[end - 1])) end--;
    const child = filters.get(start);
    return child !== undefined && child.end === end ? child : undefined;
  };

  const render = (from: number, to: number): string => {
    let output = "";
    let position = from;
    while (position < to) {
      const unit = filters.get(position);
      if (unit === undefined || unit.end > to) {
        output += input[position];
        position += 1;
        continue;
      }
      const names = [input.slice(unit.start, unit.anchors[0] - 1)];
      let inner = unit;
      let child = soleChildOf(inner);
      while (child !== undefined) {
        names.push(input.slice(child.start, child.anchors[0] - 1));
        inner = child;
        child = soleChildOf(inner);
      }
      const [start, end] = contentOf(inner);
      const closer = inner.anchors.length === 2 ? ")" : "";
      output += `${names.join(".")}(${render(start, end)}${closer}`;
      position = unit.end;
    }
    return output;
  };

  return render(0, input.length);
};
