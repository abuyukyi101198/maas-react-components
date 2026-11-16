import { analyzeQuery, stepOverUnit, tokenizeQuery } from "./queryAnalyzer";

const kinds = (input: string) =>
  tokenizeQuery(input)
    .filter((token) => token.kind !== "text")
    .map((token) => [token.text, token.kind]);

describe("tokenizeQuery", () => {
  it("classifies filters, operators, values and fuzzy text", () => {
    expect(kinds('status("a") AND "free text"')).toEqual([
      ["status", "filter"],
      ['"a"', "value"],
      ["AND", "operator"],
      ['"free text"', "fuzzy"],
    ]);
  });

  it("recognises operator phrases in any case", () => {
    expect(kinds("memory(at least 1)")).toEqual([
      ["memory", "filter"],
      ["at least", "operator"],
      ["1", "value"],
    ]);
  });

  it("does not treat words that merely start with an operator as operators", () => {
    expect(kinds("ANDROID")).toEqual([]);
  });

  it("keeps an unfinished quoted string as a single token", () => {
    expect(kinds('status("de')).toEqual([
      ["status", "filter"],
      ['"de', "value"],
    ]);
  });

  it("reproduces the input exactly from its tokens", () => {
    const input = '  status("a\\"b")  OR  NOT zone(  "x" ) ';
    expect(
      tokenizeQuery(input)
        .map((token) => token.text)
        .join(""),
    ).toBe(input);
  });
});

describe("stepOverUnit", () => {
  const operator = {
    kind: "operator" as const,
    start: 2,
    end: 5,
    anchors: [5],
  };
  const filter = {
    kind: "filter" as const,
    start: 0,
    end: 11,
    anchors: [7, 11],
  };

  it("jumps the caret across an operator", () => {
    expect(stepOverUnit([operator], 3, "right")).toBe(5);
    expect(stepOverUnit([operator], 5, "left")).toBe(2);
  });

  it("returns null when the step stays in plain text", () => {
    expect(stepOverUnit([operator], 1, "right")).toBeNull();
    expect(stepOverUnit([operator], 5, "right")).toBeNull();
  });

  it("exits a filter from its inner edges only", () => {
    expect(stepOverUnit([filter], 10, "right")).toBe(11);
    expect(stepOverUnit([filter], 7, "left")).toBe(0);
  });

  it("leaves the caret free inside a filter's value", () => {
    expect(stepOverUnit([filter], 3, "right")).toBeNull();
    expect(stepOverUnit([filter], 9, "left")).toBeNull();
  });
});

describe("analyzeQuery overwritesUnit", () => {
  const query = 'status("ab") AND x';

  it("withholds suggestions where an insertion would rewrite a unit", () => {
    expect(analyzeQuery(query, 0).overwritesUnit).toBe(true);
    expect(analyzeQuery(query, 13).overwritesUnit).toBe(true);
  });

  it("keeps suggestions inside a filter's value and at an operator's end", () => {
    expect(analyzeQuery(query, 10).overwritesUnit).toBe(false);
    expect(analyzeQuery('status("ab") AND', 16).overwritesUnit).toBe(false);
  });
});

describe("analyzeQuery completeQuery", () => {
  it.each([
    ['"x" )', '"x"'],
    ['status("a") )', 'status("a")'],
    ['("a") )', '("a")'],
  ])("cuts a stray closer from %j", (input, expected) => {
    const analysis = analyzeQuery(input);

    expect(analysis.completeQuery).toBe(expected);
    expect(analysis.ast).not.toBeNull();
  });
});
