import { validateQuery, type QueryField } from "./queryModel";

const fields: QueryField[] = [
  { name: "status", type: "string" },
  {
    name: "fabric",
    type: "collection",
    fields: [{ name: "vlan", type: "collection" }],
  },
  {
    name: "disk",
    type: "collection",
    fields: [
      { name: "size", type: "quantity", units: ["B", "GiB"], defaultUnit: "B" },
    ],
  },
];

describe("normalized query grammar", () => {
  it("normalizes exact names, grouping, precedence and negation", () => {
    expect(validateQuery('("a" OR "b") AND NOT "c"').expression).toEqual({
      type: "and",
      operands: [
        {
          type: "or",
          operands: ["a", "b"].map((value) => ({
            type: "comparison",
            operator: "equal",
            value: { type: "literal", value },
          })),
        },
        {
          type: "not",
          operand: {
            type: "comparison",
            operator: "equal",
            value: { type: "literal", value: "c" },
          },
        },
      ],
    });
  });

  it("supports name comparisons and decoded JSON escapes", () => {
    expect(
      validateQuery('STARTS WITH "mgmnt-" AND CONTAINS "\\u0030\\"\\\\%_*"')
        .expression,
    ).toEqual({
      type: "and",
      operands: [
        {
          type: "comparison",
          operator: "startsWith",
          value: { type: "literal", value: "mgmnt-" },
        },
        {
          type: "comparison",
          operator: "contains",
          value: { type: "literal", value: '0"\\%_*' },
        },
      ],
    });
  });

  it("preserves quantity precision and default-unit null", () => {
    expect(
      validateQuery("disk(size(+9007199254740993.125))", fields).expression,
    ).toEqual({
      type: "filter",
      name: "disk",
      expression: {
        type: "filter",
        name: "size",
        expression: {
          type: "comparison",
          operator: "equal",
          value: {
            type: "quantity",
            amount: "+9007199254740993.125",
            unit: null,
          },
        },
      },
    });
  });

  it.each([
    'STATUS("Ready")',
    'status("Ready") and status("New")',
    "status(NULL)",
    'fabric(vlan(name("x")))',
    "8GiB",
    'status("Ready") AND',
    "status(ABOVE 8GiB)",
    'missing("x")',
    "disk(size(8MHz))",
    'disk(size("8GiB"))',
    'status(vlan("x"))',
  ])("rejects unsupported query %s", (query) => {
    expect(validateQuery(query, fields).expression).toBeNull();
    expect(validateQuery(query, fields).error).toBeTruthy();
  });

  it("does not count grouping toward filter depth", () => {
    expect(validateQuery('fabric(((vlan(("x")))))', fields).error).toBeNull();
  });

  it("treats empty drafts as non-submittable without an error", () => {
    expect(validateQuery("  ", fields)).toEqual({
      expression: null,
      error: null,
    });
  });
});
