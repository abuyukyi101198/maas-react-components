import {
  analyzeQuery,
  segmentQuery,
  stepOverUnit,
  toDottedQuery,
  tokenizeQuery,
  replaceQueryToken,
} from "./queryAnalyzer";

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

  it("leaves incorrectly capitalized operators editable", () => {
    expect(kinds("memory(at least 1)")).toEqual([
      ["memory", "filter"],
      ["at", "value"],
      ["least", "value"],
      ["1", "value"],
    ]);
  });

  describe("specification regressions", () => {
    it.each(["8", "8GiB", "8 GiB", "AT LEAST 8GiB"])(
      "chains completed quantity %s",
      (value) => {
        expect(analyzeQuery(`disk(size(${value} `).operators).toEqual([
          "AND",
          "OR",
        ]);
        expect(analyzeQuery(`disk(size(${value} A`).operators).toEqual(["AND"]);
      },
    );

    it.each([
      ['status("Rea" OR "New")', 'status("Ready" OR "New")'],
      ['status("Rea" )', 'status("Ready" )'],
      ['status("Rea") AND zone("x")', 'status("Ready") AND zone("x")'],
    ])("preserves surroundings of %s", (query, expected) => {
      const result = replaceQueryToken(query, analyzeQuery(query, 11), {
        value: "Ready",
        type: "status",
      });
      expect(result.value).toBe(expected);
      expect(result.cursor).toBe('status("Ready"'.length);
    });

    it("inserts numeric suggestions as quantities", () => {
      const query = "disk(size())";
      expect(
        replaceQueryToken(query, analyzeQuery(query, 10), {
          value: "8GiB",
          type: "size",
          kind: "quantity",
        }).value,
      ).toBe("disk(size(8GiB))");
    });
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

describe("toDottedQuery", () => {
  it.each([
    ['fabric(vlan("default"))', 'fabric.vlan("default")'],
    ['a(b(c("x")))', 'a.b.c("x")'],
    ['fabric(vlan("default") AND x)', 'fabric(vlan("default") AND x)'],
    ['status("a") AND zone(default)', 'status("a") AND zone(default)'],
  ])("writes nested filters with dots: %j", (input, expected) => {
    expect(toDottedQuery(input)).toBe(expected);
  });
});

describe("segmentQuery closing parenthesis", () => {
  it("keeps a filter's closer a chip when its value is unterminated", () => {
    const input = 'status("Dep)';

    expect(segmentQuery(input).units).toEqual([
      {
        kind: "filter",
        start: 0,
        end: input.length,
        anchors: [7, input.length],
      },
    ]);
  });
});

describe("analyzeQuery whitespace", () => {
  it("collapses padding in the valid query but keeps spaces in strings", () => {
    const analysis = analyzeQuery('  status("Ready")    AND zone("a")  ');

    expect(analysis.completeQuery).toBe('status("Ready") AND zone("a")');
    expect(analysis.ast).not.toBeNull();
    expect(analyzeQuery('status("a  b")').completeQuery).toBe('status("a  b")');
    expect(
      analyzeQuery('fabric( "a" )   AND ( zone("b") )').completeQuery,
    ).toBe('fabric("a") AND (zone("b"))');
  });
});

describe("analyzeQuery mixed filter content", () => {
  it.each([
    'fabric("fabric-0" OR vlan("mgmt"))',
    'fabric("a" OR b("c"))',
    'fabric(vlan("mgmt") AND "b")',
  ])("parses values mixed with sub-filters: %j", (input) => {
    const analysis = analyzeQuery(input);

    expect(analysis.completeQuery).toBe(input);
    expect(analysis.ast).not.toBeNull();
  });

  it("offers operators after a filter whose content mixes terms", () => {
    const analysis = analyzeQuery('fabric("fabric-0" OR vlan("mgmt"))');

    expect(analysis.operators).toEqual(["AND", "OR"]);
    expect(analysis.acceptsTerm).toBe(false);
  });
});
