import {
  fieldsAtContext,
  type ComparisonOperator,
  type QueryExpression,
  type QueryField,
} from "@/lib/components/QueryInput/queryModel";

export type DemoPersona = "administrator" | "operator";
export type DemoSort = "hostname" | "-hostname" | "status" | "-status";
export type DemoGroup = "none" | "status" | "pool";
export type Truth = boolean | null;

const UNIT_BYTES: Readonly<Record<string, bigint>> = {
  B: 1n,
  KB: 1000n,
  MB: 1000000n,
  GB: 1000000000n,
  TB: 1000000000000n,
  KiB: 1024n,
  MiB: 1048576n,
  GiB: 1073741824n,
  TiB: 1099511627776n,
};

export const demoFields: readonly QueryField[] = [
  { name: "status", type: "string" },
  { name: "owner", type: "string" },
  { name: "architecture", type: "string" },
  { name: "pool", type: "string" },
  { name: "zone", type: "string" },
  { name: "space", type: "collection" },
  {
    name: "fabric",
    type: "collection",
    fields: [{ name: "vlan", type: "collection" }],
  },
  {
    name: "disk",
    type: "collection",
    fields: [
      {
        name: "size",
        type: "quantity",
        units: Object.keys(UNIT_BYTES),
        defaultUnit: "B",
      },
    ],
  },
];

export type DemoMachine = {
  id: string;
  hostname: string;
  status: string;
  owner: string | null;
  architecture: string;
  pool: string;
  zone: string;
  spaces: string[];
  disks: { name: string; size: string | null }[];
  // Only VLANs connected through this machine's interfaces, not the fabric catalogue.
  fabrics: { name: string; vlans: string[] }[];
  visibleToOperator: boolean;
};

const machine = (
  id: string,
  hostname: string,
  overrides: Partial<DemoMachine> = {},
): DemoMachine => ({
  id,
  hostname,
  status: "Ready",
  owner: "alice",
  architecture: "amd64/generic",
  pool: "default",
  zone: "default",
  spaces: ["management"],
  disks: [{ name: "sda", size: "8589934592" }],
  fabrics: [{ name: "mgmnt-east", vlans: ["east-maas"] }],
  visibleToOperator: true,
  ...overrides,
});

export const demoMachines: readonly DemoMachine[] = [
  machine("m01", "mgmnt-001"),
  machine("m02", "mgmnt-002", {
    pool: "edge",
    zone: "zone-1",
    disks: [{ name: "sda", size: "12884901888" }],
    fabrics: [{ name: "mgmnt-west", vlans: ["west-maas"] }],
  }),
  machine("m03", "reserve-001", {
    pool: "reserve",
    zone: "zone-1",
    owner: "secret-admin",
    visibleToOperator: false,
    fabrics: [{ name: "private-fabric", vlans: ["private-vlan"] }],
  }),
  machine("m04", "deployed-001", { status: "Deployed", owner: "bob" }),
  machine("m05", "failure-001", { status: "Failed deployment" }),
  machine("m06", "failure-002", {
    status: "Failed releasing",
    architecture: "amd64/hwe-24.04",
    pool: "reserve",
    visibleToOperator: false,
  }),
  machine("m07", "failure-arm-001", {
    status: "Failed deployment",
    architecture: "arm64/generic",
  }),
  machine("m08", "unconnected-001", {
    owner: null,
    disks: [],
    fabrics: [],
    spaces: [],
  }),
  machine("m09", "split-disks-001", {
    disks: [
      { name: "sda", size: "17179869184" },
      { name: "sdb", size: "4294967296" },
    ],
  }),
  machine("m10", "split-fabrics-001", {
    fabrics: [
      { name: "mgmnt-east", vlans: ["guest"] },
      { name: "production", vlans: ["east-maas"] },
    ],
  }),
  machine("m11", "wrong-vlan-001", {
    fabrics: [{ name: "mgmnt-east", vlans: ["guest"] }],
  }),
  machine("m12", "decimal-001", {
    disks: [{ name: "sda", size: "107374182.4" }],
  }),
  machine("m13", "precision-001", {
    disks: [{ name: "sda", size: "9007199254740993.0000000000000001" }],
  }),
  machine("m14", "literal%_*", {
    owner: null,
    disks: [{ name: "sda", size: null }],
    fabrics: [
      { name: "production", vlans: ["public"] },
      { name: "staging", vlans: ["preview"] },
    ],
  }),
];

export const demoExamples = {
  deployment:
    'status("Ready") AND (pool("default") OR zone("zone-1")) AND NOT pool("reserve")',
  storage:
    'disk(size(AT LEAST 8GiB AND AT MOST 12GiB)) AND fabric(STARTS WITH "mgmnt-" AND vlan(ENDS WITH "-maas"))',
  independentDisks: "disk(size(AT LEAST 8GiB)) AND disk(size(AT MOST 12GiB))",
  impossibleDisk: "disk(size(8GiB AND 12GiB))",
  independentFabrics:
    'fabric(STARTS WITH "mgmnt-") AND fabric(vlan(ENDS WITH "-maas"))',
  failures:
    'architecture(STARTS WITH "amd64/") AND (status("Failed deployment") OR status("Failed releasing"))',
  exactArchitecture:
    'architecture("amd64/generic") AND status("Failed deployment")',
  decimal: "disk(size(0.1GiB))",
  outerNot: 'NOT fabric("production")',
  innerNot: 'fabric(NOT "production")',
  unknown: 'NOT owner("alice")',
  empty: 'status("No such status")',
} as const;

export class DemoServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "validation" | "execution" | "suggestions",
    public readonly path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "DemoServiceError";
  }
}

const invalid = (path: string, message: string): never => {
  throw new DemoServiceError(message, "validation", path);
};

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(path, "Expected an object.");
  }
  return value as Record<string, unknown>;
};

const keysAt = (
  object: Record<string, unknown>,
  keys: readonly string[],
  path: string,
) => {
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) invalid(`${path}.${key}`, "Unsupported property.");
  }
};

const DECIMAL = /^[+-]?[0-9]+(?:\.[0-9]+)?$/;
const STRING_OPERATORS = ["equal", "contains", "startsWith", "endsWith"];
const NUMBER_OPERATORS = ["equal", "above", "below", "atLeast", "atMost"];

/** The mock boundary validates the JSON AST independently of the editor parser. */
export const validateDemoExpression = (input: unknown): QueryExpression => {
  let count = 0;
  const visit = (
    value: unknown,
    fields: readonly QueryField[],
    field: QueryField | undefined,
    filterDepth: number,
    depth: number,
    path: string,
  ): void => {
    if (++count > 1000 || depth > 64)
      invalid(path, "Expression is too complex.");
    const node = objectAt(value, path);
    switch (node.type) {
      case "and":
      case "or": {
        keysAt(node, ["type", "operands"], path);
        if (!Array.isArray(node.operands) || node.operands.length < 2) {
          invalid(`${path}.operands`, "Expected at least two expressions.");
        }
        for (const [index, operand] of (node.operands as unknown[]).entries()) {
          visit(
            operand,
            fields,
            field,
            filterDepth,
            depth + 1,
            `${path}.operands[${index}]`,
          );
        }
        break;
      }
      case "not":
        keysAt(node, ["type", "operand"], path);
        visit(
          node.operand,
          fields,
          field,
          filterDepth,
          depth + 1,
          `${path}.operand`,
        );
        break;
      case "filter": {
        keysAt(node, ["type", "name", "expression"], path);
        if (filterDepth >= 2)
          invalid(path, "Only one nested filter is supported.");
        const selected = fields.find(
          (candidate) => candidate.name === node.name,
        );
        if (!selected)
          invalid(`${path}.name`, "Unsupported filter in this context.");
        const selectedField = selected as QueryField;
        visit(
          node.expression,
          selectedField.fields ?? [],
          selectedField,
          filterDepth + 1,
          depth + 1,
          `${path}.expression`,
        );
        break;
      }
      case "comparison": {
        keysAt(node, ["type", "operator", "value"], path);
        const comparison = objectAt(node.value, `${path}.value`);
        if (field?.type === "quantity") {
          keysAt(comparison, ["type", "amount", "unit"], `${path}.value`);
          if (
            comparison.type !== "quantity" ||
            typeof comparison.amount !== "string" ||
            comparison.amount.length > 1000 ||
            !DECIMAL.test(comparison.amount)
          ) {
            invalid(`${path}.value`, "Expected an exact decimal quantity.");
          }
          if (
            comparison.unit !== null &&
            (typeof comparison.unit !== "string" ||
              !field.units?.includes(comparison.unit))
          ) {
            invalid(`${path}.value.unit`, "Unsupported unit.");
          }
          if (!NUMBER_OPERATORS.includes(node.operator as string)) {
            invalid(`${path}.operator`, "Unsupported numeric operator.");
          }
        } else {
          keysAt(comparison, ["type", "value"], `${path}.value`);
          if (
            comparison.type !== "literal" ||
            typeof comparison.value !== "string"
          ) {
            invalid(`${path}.value`, "Expected a quoted string.");
          }
          if (!STRING_OPERATORS.includes(node.operator as string)) {
            invalid(`${path}.operator`, "Unsupported string operator.");
          }
        }
        break;
      }
      default:
        invalid(`${path}.type`, "Unsupported expression type.");
    }
  };
  visit(input, demoFields, undefined, 0, 0, "query");
  return input as QueryExpression;
};

const decimal = (amount: string, unit: string) => {
  const [whole, fraction = ""] = amount.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`) * UNIT_BYTES[unit],
    denominator: 10n ** BigInt(fraction.length),
  };
};

export const compareQuantities = (
  left: string,
  leftUnit: string,
  right: string,
  rightUnit: string,
): -1 | 0 | 1 => {
  if (
    !DECIMAL.test(left) ||
    !DECIMAL.test(right) ||
    !Object.hasOwn(UNIT_BYTES, leftUnit) ||
    !Object.hasOwn(UNIT_BYTES, rightUnit)
  ) {
    return invalid("quantity", "Unsupported decimal or unit.");
  }
  const a = decimal(left, leftUnit);
  const b = decimal(right, rightUnit);
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

type Scope = {
  value: string | null;
  fields: Record<string, Scope | Scope[]>;
};
const scalar = (value: string | null): Scope => ({ value, fields: {} });
const machineScope = (item: DemoMachine): Scope => ({
  value: item.hostname,
  fields: {
    status: scalar(item.status),
    owner: scalar(item.owner),
    architecture: scalar(item.architecture),
    pool: scalar(item.pool),
    zone: scalar(item.zone),
    space: item.spaces.map(scalar),
    disk: item.disks.map((disk) => ({
      value: disk.name,
      fields: { size: scalar(disk.size) },
    })),
    fabric: item.fabrics.map((fabric) => ({
      value: fabric.name,
      fields: { vlan: fabric.vlans.map(scalar) },
    })),
  },
});

const compareNumber = (
  operator: ComparisonOperator,
  order: number,
): boolean => {
  switch (operator) {
    case "equal":
      return order === 0;
    case "above":
      return order > 0;
    case "below":
      return order < 0;
    case "atLeast":
      return order >= 0;
    case "atMost":
      return order <= 0;
    default:
      return invalid("query.operator", "Unsupported numeric operator.");
  }
};

export const evaluateDemoExpression = (
  expression: QueryExpression,
  item: DemoMachine,
): Truth => {
  const visit = (
    node: QueryExpression,
    scope: Scope,
    field?: QueryField,
  ): Truth => {
    switch (node.type) {
      case "and": {
        const values = node.operands.map((operand) =>
          visit(operand, scope, field),
        );
        return values.includes(false)
          ? false
          : values.includes(null)
            ? null
            : true;
      }
      case "or": {
        const values = node.operands.map((operand) =>
          visit(operand, scope, field),
        );
        return values.includes(true)
          ? true
          : values.includes(null)
            ? null
            : false;
      }
      case "not": {
        const value = visit(node.operand, scope, field);
        return value === null ? null : !value;
      }
      case "filter": {
        const selected = (field?.fields ?? demoFields).find(
          (candidate) => candidate.name === node.name,
        );
        const child = scope.fields[node.name];
        if (!selected || !child)
          return invalid("query.name", "Unsupported field.");
        // EXISTS turns unknown member predicates into nonmatches, unlike a scalar.
        return Array.isArray(child)
          ? child.some(
              (member) => visit(node.expression, member, selected) === true,
            )
          : visit(node.expression, child, selected);
      }
      case "comparison":
        if (scope.value === null) return null;
        if (node.value.type === "quantity") {
          return compareNumber(
            node.operator,
            compareQuantities(
              scope.value,
              field?.defaultUnit ?? "B",
              node.value.amount,
              node.value.unit ?? field?.defaultUnit ?? "B",
            ),
          );
        }
        switch (node.operator) {
          case "equal":
            return scope.value === node.value.value;
          case "contains":
            return scope.value.includes(node.value.value);
          case "startsWith":
            return scope.value.startsWith(node.value.value);
          case "endsWith":
            return scope.value.endsWith(node.value.value);
          default:
            return invalid("query.operator", "Unsupported string operator.");
        }
    }
  };
  return visit(expression, machineScope(item));
};

export type DemoListingRequest = {
  entity: "machines";
  persona: DemoPersona;
  page: number;
  pageSize: number;
  sort: DemoSort;
  group: DemoGroup;
};
export type DemoSearchRequest = DemoListingRequest & { query: QueryExpression };
export type DemoListing = {
  items: DemoMachine[];
  total: number;
  page: number;
  pageSize: number;
  groups: { name: string; count: number }[];
};
export type DemoSuggestionRequest = {
  entity: "machines";
  persona: DemoPersona;
  filter: string;
  parent?: string;
  q?: string;
  limit: number;
};
export type DemoServiceOptions = {
  delayMs?: number;
  fail?: boolean;
  signal?: AbortSignal;
};

const validateIdentity = (request: Record<string, unknown>) => {
  if (request.entity !== "machines") invalid("entity", "Unsupported entity.");
  if (request.persona !== "administrator" && request.persona !== "operator") {
    invalid("persona", "Unsupported permission persona.");
  }
};
const visibleMachines = (persona: DemoPersona) =>
  demoMachines.filter(
    (item) => persona === "administrator" || item.visibleToOperator,
  );

const wait = async ({ delayMs = 250, signal }: DemoServiceOptions) => {
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10000) {
    invalid("delayMs", "Expected a delay between 0 and 10000 milliseconds.");
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request aborted.", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Request aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
};

const listingRequest = (
  input: unknown,
  search: boolean,
): DemoListingRequest => {
  const request = objectAt(input, "request");
  keysAt(
    request,
    [
      "entity",
      "persona",
      "page",
      "pageSize",
      "sort",
      "group",
      ...(search ? ["query"] : []),
    ],
    "request",
  );
  validateIdentity(request);
  if (!Number.isSafeInteger(request.page) || (request.page as number) < 1) {
    invalid("page", "Expected a positive integer.");
  }
  if (
    !Number.isSafeInteger(request.pageSize) ||
    (request.pageSize as number) < 1 ||
    (request.pageSize as number) > 100
  ) {
    invalid("pageSize", "Expected an integer between 1 and 100.");
  }
  if (
    !["hostname", "-hostname", "status", "-status"].includes(
      request.sort as string,
    )
  ) {
    invalid("sort", "Unsupported sorting.");
  }
  if (!["none", "status", "pool"].includes(request.group as string)) {
    invalid("group", "Unsupported grouping.");
  }
  return request as DemoListingRequest;
};

const stringOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const list = (
  request: DemoListingRequest,
  query?: QueryExpression,
): DemoListing => {
  const items = visibleMachines(request.persona).filter(
    (item) => !query || evaluateDemoExpression(query, item) === true,
  );
  const counts = new Map<string, number>();
  const group = request.group;
  if (group !== "none") {
    for (const item of items) {
      counts.set(item[group], (counts.get(item[group]) ?? 0) + 1);
    }
  }
  const descending = request.sort.startsWith("-");
  const sort = request.sort.replace(/^-/, "") as "hostname" | "status";
  items.sort(
    (a, b) =>
      (group === "none" ? 0 : stringOrder(a[group], b[group])) ||
      stringOrder(a[sort], b[sort]) * (descending ? -1 : 1) ||
      stringOrder(a.id, b.id),
  );
  return {
    items: items.slice(
      (request.page - 1) * request.pageSize,
      request.page * request.pageSize,
    ),
    total: items.length,
    page: request.page,
    pageSize: request.pageSize,
    groups: [...counts]
      .sort(([a], [b]) => stringOrder(a, b))
      .map(([name, count]) => ({ name, count })),
  };
};

export const listDemoMachines = async (
  input: unknown,
  options: DemoServiceOptions = {},
): Promise<DemoListing> => {
  const request = listingRequest(input, false);
  await wait(options);
  if (options.fail)
    throw new DemoServiceError(
      "Machine listing failed. Retry the request.",
      "execution",
    );
  return list(request);
};

export const searchDemoMachines = async (
  input: unknown,
  options: DemoServiceOptions = {},
): Promise<DemoListing> => {
  const request = listingRequest(input, true);
  const query = validateDemoExpression(
    (input as Record<string, unknown>).query,
  );
  await wait(options);
  if (options.fail)
    throw new DemoServiceError(
      "Query execution failed. Retry the request.",
      "execution",
    );
  return list(request, query);
};

export const getDemoSuggestions = async (
  input: unknown,
  options: DemoServiceOptions = {},
): Promise<{ suggestions: string[] }> => {
  const request = objectAt(input, "request");
  keysAt(
    request,
    ["entity", "persona", "filter", "parent", "q", "limit"],
    "request",
  );
  validateIdentity(request);
  if (typeof request.filter !== "string")
    invalid("filter", "Expected a filter name.");
  if (request.parent !== undefined && typeof request.parent !== "string") {
    invalid("parent", "Expected a parent filter name.");
  }
  if (request.q !== undefined && typeof request.q !== "string")
    invalid("q", "Expected a string.");
  if (
    !Number.isSafeInteger(request.limit) ||
    (request.limit as number) < 1 ||
    (request.limit as number) > 100
  ) {
    invalid("limit", "Expected an integer between 1 and 100.");
  }
  const {
    filter,
    parent,
    q = "",
    limit,
    persona,
  } = request as DemoSuggestionRequest;
  const context = parent === undefined ? filter : `${parent}.${filter}`;
  if (
    !/^[a-z][a-z0-9_]*$/.test(filter) ||
    (parent !== undefined && !/^[a-z][a-z0-9_]*$/.test(parent))
  )
    invalid(
      "filter",
      "Expected a single filter name and optional single parent.",
    );
  const field = fieldsAtContext(demoFields, context);
  if (!field) invalid("filter", "Unsupported filter context.");
  await wait(options);
  if (options.fail)
    throw new DemoServiceError(
      "Value lookup failed. Local filters and operators are still available.",
      "suggestions",
    );
  const values = visibleMachines(persona).flatMap((item) => {
    let scopes = [machineScope(item)];
    for (const name of context.split(".")) {
      scopes = scopes.flatMap((scope) => {
        const value = scope.fields[name];
        return value ? (Array.isArray(value) ? value : [value]) : [];
      });
    }
    return scopes.flatMap((scope) =>
      scope.value === null
        ? []
        : [scope.value + (field?.type === "quantity" ? "B" : "")],
    );
  });
  return {
    suggestions: [...new Set(values)]
      .filter((value) => value.toLowerCase().includes(q.toLowerCase()))
      .sort(stringOrder)
      .slice(0, limit),
  };
};

export const getDemoFilterSuggestions = (context: string, token: string) => {
  const fields =
    context === ""
      ? demoFields
      : (fieldsAtContext(demoFields, context)?.fields ?? []);
  return fields
    .filter((field) => field.name.toLowerCase().startsWith(token.toLowerCase()))
    .map((field) => ({ value: field.name, type: "filter" }));
};
