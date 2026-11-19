import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { vi } from "vitest";

import {
  compareQuantities,
  demoExamples,
  demoFields,
  demoMachines,
  DemoServiceError,
  evaluateDemoExpression,
  getDemoFilterSuggestions,
  getDemoSuggestions,
  listDemoMachines,
  searchDemoMachines,
  validateDemoExpression,
  type DemoListingRequest,
} from "@/lib/components/QueryInput/queryDemo";
import {
  type ComparisonOperator,
  type QueryExpression,
  validateQuery,
} from "@/lib/components/QueryInput/queryModel";

const literal = (
  value: string,
  operator: ComparisonOperator = "equal",
): QueryExpression => ({
  type: "comparison",
  operator,
  value: { type: "literal", value },
});
const quantity = (
  amount: string,
  unit: string | null = "GiB",
  operator: ComparisonOperator = "equal",
): QueryExpression => ({
  type: "comparison",
  operator,
  value: { type: "quantity", amount, unit },
});
const filter = (
  name: string,
  expression: QueryExpression,
): QueryExpression => ({
  type: "filter",
  name,
  expression,
});
const and = (...operands: QueryExpression[]): QueryExpression => ({
  type: "and",
  operands,
});
const or = (...operands: QueryExpression[]): QueryExpression => ({
  type: "or",
  operands,
});
const not = (operand: QueryExpression): QueryExpression => ({
  type: "not",
  operand,
});
const disk = (expression: QueryExpression) =>
  filter("disk", filter("size", expression));
const record = (id: string) => {
  const found = demoMachines.find((item) => item.id === id);
  if (!found) throw new Error(`Missing fixture ${id}`);
  return found;
};
const matches = (expression: QueryExpression) =>
  demoMachines
    .filter((item) => evaluateDemoExpression(expression, item) === true)
    .map((item) => item.id);
const request: DemoListingRequest = {
  entity: "machines",
  persona: "administrator",
  page: 1,
  pageSize: 100,
  sort: "hostname",
  group: "none",
};
const lookup = {
  entity: "machines",
  persona: "administrator",
  filter: "status",
  limit: 100,
};
const immediate = { delayMs: 0 };

describe("demo exact quantities", () => {
  it.each([
    ["0.1", "GiB", "107374182.4", "B", 0],
    ["8", "GiB", "8589934592", "B", 0],
    ["1", "GB", "1", "GiB", -1],
    ["+1.50", "KiB", "1536", "B", 0],
    ["-0.1", "GiB", "-107374182.4", "B", 0],
    ["-1", "B", "0", "B", -1],
    ["9007199254740993", "B", "9007199254740992", "B", 1],
    ["9007199254740993.0000000000000001", "B", "9007199254740993", "B", 1],
    ["0.0000000000000000000000000001", "TB", "0", "B", 1],
  ] as const)("compares %s%s and %s%s exactly", (a, au, b, bu, order) => {
    expect(compareQuantities(a, au, b, bu)).toBe(order);
  });

  it("uses bytes for unitless values and preserves fractional fixture capacity", () => {
    expect(matches(disk(quantity("8589934592", null)))).toContain("m01");
    expect(matches(disk(quantity("0.1")))).toEqual(["m12"]);
    expect(
      matches(disk(quantity("9007199254740993.0000000000000001", "B"))),
    ).toEqual(["m13"]);
    expect(matches(disk(quantity("9007199254740993", "B")))).not.toContain(
      "m13",
    );
  });

  it.each(["NaN", "1e9", "1.", ".5", " 1", "1_000"])(
    "rejects malformed decimal %s",
    (amount) => {
      expect(() => compareQuantities(amount, "B", "1", "B")).toThrow(
        DemoServiceError,
      );
    },
  );
});

describe("demo normalized AST evaluation", () => {
  it.each(Object.entries(demoExamples))(
    "accepts the complete %s example with shared validation",
    (_name, text) => {
      const result = validateQuery(text, demoFields);
      expect(result.error).toBeNull();
      expect(result.expression).not.toBeNull();
      expect(() => validateDemoExpression(result.expression)).not.toThrow();
    },
  );

  it("combines readiness, grouped alternative locations, and exclusion", () => {
    const expression = and(
      filter("status", literal("Ready")),
      or(filter("pool", literal("default")), filter("zone", literal("zone-1"))),
      not(filter("pool", literal("reserve"))),
    );
    expect(matches(expression)).toEqual([
      "m01",
      "m02",
      "m08",
      "m09",
      "m10",
      "m11",
      "m12",
      "m13",
      "m14",
    ]);
  });

  it("broadens exact architectures without relaxing failure-status requirements", () => {
    const failures = or(
      filter("status", literal("Failed deployment")),
      filter("status", literal("Failed releasing")),
    );
    expect(
      matches(and(filter("architecture", literal("amd64/generic")), failures)),
    ).toEqual(["m05"]);
    expect(
      matches(
        and(filter("architecture", literal("amd64/", "startsWith")), failures),
      ),
    ).toEqual(["m05", "m06"]);
  });

  it("keeps all predicates inside a disk invocation on that single disk", () => {
    expect(matches(disk(and(quantity("8"), quantity("12"))))).toEqual([]);
    const range = disk(
      and(quantity("8", "GiB", "atLeast"), quantity("12", "GiB", "atMost")),
    );
    expect(matches(range)).toContain("m01");
    expect(matches(range)).toContain("m02");
    expect(matches(range)).not.toContain("m09");
    const independent = and(
      disk(quantity("8", "GiB", "atLeast")),
      disk(quantity("12", "GiB", "atMost")),
    );
    expect(matches(independent)).toContain("m09");
  });

  it("shares the fabric member scope and requires the machine's actual VLAN path", () => {
    const name = literal("mgmnt-", "startsWith");
    const vlan = filter("vlan", literal("-maas", "endsWith"));
    const combined = filter("fabric", and(name, vlan));
    const independent = and(filter("fabric", name), filter("fabric", vlan));
    expect(matches(combined)).toContain("m01");
    expect(matches(combined)).not.toContain("m10");
    expect(matches(independent)).toContain("m10");
    expect(matches(combined)).not.toContain("m11");
    expect(matches(independent)).not.toContain("m11");
  });

  it("combines capacity and connectivity without flattening either relationship", () => {
    const expression = and(
      disk(
        and(quantity("8", "GiB", "atLeast"), quantity("12", "GiB", "atMost")),
      ),
      filter(
        "fabric",
        and(
          literal("mgmnt-", "startsWith"),
          filter("vlan", literal("-maas", "endsWith")),
        ),
      ),
    );
    expect(matches(expression)).toContain("m01");
    expect(matches(expression)).not.toContain("m09");
    expect(matches(expression)).not.toContain("m10");
  });

  it("distinguishes outer NOT EXISTS from a negated predicate on an existing member", () => {
    const outer = not(filter("fabric", literal("production")));
    const inner = filter("fabric", not(literal("production")));
    expect(evaluateDemoExpression(outer, record("m08"))).toBe(true);
    expect(evaluateDemoExpression(inner, record("m08"))).toBe(false);
    expect(evaluateDemoExpression(outer, record("m14"))).toBe(false);
    expect(evaluateDemoExpression(inner, record("m14"))).toBe(true);
  });

  it("uses SQL-like unknown for scalars, including under NOT and boolean chains", () => {
    const unknown = filter("owner", literal("alice"));
    const yes = filter("status", literal("Ready"));
    const no = filter("status", literal("Deployed"));
    const item = record("m08");
    for (const expression of [
      unknown,
      not(unknown),
      filter("owner", not(literal("alice"))),
      and(unknown, yes),
      or(unknown, no),
    ]) {
      expect(evaluateDemoExpression(expression, item)).toBeNull();
    }
    expect(evaluateDemoExpression(and(unknown, no), item)).toBe(false);
    expect(evaluateDemoExpression(or(unknown, yes), item)).toBe(true);
    expect(evaluateDemoExpression(not(and(unknown, no)), item)).toBe(true);
  });

  it("does not turn a disk with unknown size into a match under inner negation", () => {
    expect(
      evaluateDemoExpression(disk(not(quantity("8"))), record("m14")),
    ).toBe(false);
    expect(
      evaluateDemoExpression(not(disk(quantity("8"))), record("m14")),
    ).toBe(true);
  });

  it("matches case-sensitively and treats wildcard characters as literal text", () => {
    expect(matches(literal("mgmnt-001"))).toEqual(["m01"]);
    expect(matches(literal("MGMNT-001"))).toEqual([]);
    expect(matches(literal("%_*", "contains"))).toEqual(["m14"]);
    expect(matches(literal("literal%_*"))).toEqual(["m14"]);
    expect(matches(literal("*", "endsWith"))).toEqual(["m14"]);
  });
});

describe("demo request validation", () => {
  it.each([
    null,
    {},
    { type: "group", expression: literal("x") },
    { type: "and", operands: [literal("x")] },
    { type: "or", operands: null },
    { type: "and", operands: new Array(2) },
    { type: "not" },
    { ...literal("x"), scope: "hostname" },
    filter("STATUS", literal("Ready")),
    filter("missing", literal("x")),
    filter("status", quantity("8")),
    quantity("8"),
    disk(literal("8")),
    disk(quantity("1e3")),
    disk(quantity("8", "gib")),
    disk(quantity("8", "GiB", "contains")),
    filter("status", literal("Ready", "above")),
    filter("fabric", filter("vlan", filter("space", literal("x")))),
    filter("fabric", filter("size", quantity("8"))),
    filter(
      "disk",
      filter("size", {
        type: "comparison",
        operator: "equal",
        value: { type: "quantity", amount: 8, unit: "GiB" },
      } as unknown as QueryExpression),
    ),
  ])(
    "rejects malformed or unsupported AST %# with an expression path",
    (expression) => {
      expect(() => validateDemoExpression(expression)).toThrow(/^query/);
    },
  );

  it("allows grouping at the maximum filter depth", () => {
    const expression = disk(and(quantity("8"), not(quantity("12"))));
    expect(validateDemoExpression(expression)).toBe(expression);
  });

  it.each([
    { entity: "zones" },
    { persona: "anonymous" },
    { page: 0 },
    { page: 1.5 },
    { pageSize: 101 },
    { sort: "owner" },
    { group: "fabric" },
    { query: literal("x") },
  ])("rejects invalid listing controls %j", async (patch) => {
    await expect(
      listDemoMachines({ ...request, ...patch }, immediate),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("rejects missing query rather than running an unfiltered search", async () => {
    await expect(searchDemoMachines(request, immediate)).rejects.toMatchObject({
      path: "query",
      code: "validation",
    });
  });

  it("rejects DSL text rather than parsing or executing a valid prefix", async () => {
    await expect(
      searchDemoMachines(
        { ...request, query: 'status("Ready") AND' },
        immediate,
      ),
    ).rejects.toMatchObject({ path: "query" });
  });
});

describe("demo asynchronous listing and suggestions", () => {
  it("applies permissions outside OR and NOT, before totals, grouping and pagination", async () => {
    const query = or(
      not(filter("pool", literal("default"))),
      filter("status", literal("Ready")),
    );
    const admin = await searchDemoMachines({ ...request, query }, immediate);
    const operator = await searchDemoMachines(
      { ...request, query, persona: "operator", pageSize: 2, group: "pool" },
      immediate,
    );
    const permitted = admin.items.filter((item) => item.visibleToOperator);
    expect(operator.total).toBe(permitted.length);
    expect(operator.items).toHaveLength(2);
    expect(operator.groups.reduce((sum, group) => sum + group.count, 0)).toBe(
      operator.total,
    );
    expect(operator.groups.map((group) => group.name)).not.toContain("reserve");
  });

  it("does not disclose manually entered forbidden values", async () => {
    const result = await searchDemoMachines(
      {
        ...request,
        persona: "operator",
        query: filter("owner", literal("secret-admin")),
      },
      immediate,
    );
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("counts entities once, retains sorting, and repeats the AST on subsequent pages", async () => {
    const query = filter("fabric", not(literal("absent")));
    const all = await searchDemoMachines(
      { ...request, query, sort: "-hostname" },
      immediate,
    );
    const first = await searchDemoMachines(
      { ...request, query, sort: "-hostname", pageSize: 3 },
      immediate,
    );
    const second = await searchDemoMachines(
      { ...request, query, sort: "-hostname", pageSize: 3, page: 2 },
      immediate,
    );
    expect(first.items.concat(second.items)).toEqual(all.items.slice(0, 6));
    expect(first.total).toBe(all.total);
    expect(new Set(all.items.map((item) => item.id)).size).toBe(all.total);
  });

  it("returns an empty success for a valid absent value but throws for execution failure", async () => {
    const input = { ...request, query: filter("status", literal("absent")) };
    expect((await searchDemoMachines(input, immediate)).total).toBe(0);
    await expect(
      searchDemoMachines(input, { ...immediate, fail: true }),
    ).rejects.toMatchObject({ code: "execution" });
    await expect(
      listDemoMachines(request, { ...immediate, fail: true }),
    ).rejects.toMatchObject({ code: "execution" });
  });

  it("scopes nested lookup by entity/filter/parent, not by other query predicates", async () => {
    const response = await getDemoSuggestions(
      { ...lookup, filter: "vlan", parent: "fabric", q: "MAAS", limit: 1 },
      immediate,
    );
    expect(response.suggestions).toEqual(["east-maas"]);
    expect(
      await getDemoSuggestions(
        { ...lookup, filter: "size", parent: "disk", q: ".4" },
        immediate,
      ),
    ).toEqual({ suggestions: ["107374182.4B"] });
    await expect(
      getDemoSuggestions(
        { ...lookup, query: filter("pool", literal("default")) },
        immediate,
      ),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("uses case-insensitive substring values and prefix-only local filters", async () => {
    expect(
      await getDemoSuggestions({ ...lookup, q: "PLOY" }, immediate),
    ).toEqual({ suggestions: ["Deployed", "Failed deployment"] });
    expect(getDemoFilterSuggestions("", "STA")).toEqual([
      { type: "filter", value: "status" },
    ]);
    expect(getDemoFilterSuggestions("", "tat")).toEqual([]);
    expect(getDemoFilterSuggestions("fabric", "VL")).toEqual([
      { type: "filter", value: "vlan" },
    ]);
    expect(getDemoFilterSuggestions("disk", "")).toEqual([
      { type: "filter", value: "size" },
    ]);
    expect(getDemoFilterSuggestions("fabric.vlan", "")).toEqual([]);
    expect(getDemoFilterSuggestions("bogus", "")).toEqual([]);
  });

  it("gates every suggestion context by persona and omits unknown values", async () => {
    expect(
      (await getDemoSuggestions({ ...lookup, filter: "owner" }, immediate))
        .suggestions,
    ).toContain("secret-admin");
    expect(
      (
        await getDemoSuggestions(
          { ...lookup, filter: "owner", persona: "operator" },
          immediate,
        )
      ).suggestions,
    ).toEqual(["alice", "bob"]);
    expect(
      (
        await getDemoSuggestions(
          { ...lookup, filter: "vlan", parent: "fabric", persona: "operator" },
          immediate,
        )
      ).suggestions,
    ).not.toContain("private-vlan");
  });

  it.each([
    { entity: "zones" },
    { filter: "vlan" },
    { filter: "vlan", parent: "disk" },
    { filter: "fabric.vlan" },
    { parent: "" },
    { parent: 1 },
    { persona: "unknown" },
    { q: 1 },
    { limit: 0 },
    { limit: 1.5 },
    { limit: 101 },
  ])("rejects invalid suggestion parameters %j", async (patch) => {
    await expect(
      getDemoSuggestions({ ...lookup, ...patch }, immediate),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("distinguishes no matches from lookup failure", async () => {
    expect(
      await getDemoSuggestions({ ...lookup, q: "absent" }, immediate),
    ).toEqual({ suggestions: [] });
    await expect(
      getDemoSuggestions(lookup, { ...immediate, fail: true }),
    ).rejects.toMatchObject({ code: "suggestions" });
  });

  it("aborts delayed obsolete requests", async () => {
    const controller = new AbortController();
    const pending = getDemoSuggestions(lookup, {
      delayMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a keyed observer immediately drops old-context values and ignores a late response", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let finishOld: ((value: { suggestions: string[] }) => void) | undefined;
    const observer = new QueryObserver(client, {
      queryKey: ["suggestions", "status"],
      queryFn: () =>
        new Promise<{ suggestions: string[] }>((resolve) => {
          finishOld = resolve;
        }),
    });
    const unsubscribe = observer.subscribe(() => {});
    await Promise.resolve();
    observer.setOptions({
      queryKey: ["suggestions", "owner"],
      queryFn: () =>
        getDemoSuggestions(
          { ...lookup, filter: "owner", persona: "operator" },
          immediate,
        ),
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    await observer.refetch();
    finishOld?.({ suggestions: ["Ready"] });
    await Promise.resolve();
    expect(observer.getCurrentResult().data).toEqual({
      suggestions: ["alice", "bob"],
    });
    unsubscribe();
    client.clear();
  });

  it("releases a replaced search observer so its 30-second GC can run", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ["search", "first"],
      queryFn: async () => 1,
      gcTime: 30000,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await observer.refetch();
      observer.setOptions({ queryKey: ["listing"], queryFn: async () => 2 });
      await observer.refetch();
      expect(
        client
          .getQueryCache()
          .find({ queryKey: ["search", "first"] })
          ?.getObserversCount(),
      ).toBe(0);
      await vi.advanceTimersByTimeAsync(30001);
      expect(client.getQueryData(["search", "first"])).toBeUndefined();
      expect(client.getQueryData(["listing"])).toBe(2);
    } finally {
      unsubscribe();
      client.clear();
      vi.useRealTimers();
    }
  });
});
