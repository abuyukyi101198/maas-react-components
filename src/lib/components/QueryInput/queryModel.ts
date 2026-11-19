import { parse, SyntaxError } from "./maasql.gen";

export type QueryValue =
  | { type: "literal"; value: string }
  | { type: "quantity"; amount: string; unit: string | null };

export type ComparisonOperator =
  | "equal"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "above"
  | "below"
  | "atLeast"
  | "atMost";

export type QueryExpression =
  | { type: "and" | "or"; operands: QueryExpression[] }
  | { type: "not"; operand: QueryExpression }
  | { type: "filter"; name: string; expression: QueryExpression }
  | { type: "comparison"; operator: ComparisonOperator; value: QueryValue };

export type QueryField = {
  name: string;
  type: "string" | "quantity" | "collection";
  fields?: readonly QueryField[];
  units?: readonly string[];
  defaultUnit?: string;
};

export const fieldsAtContext = (
  fields: readonly QueryField[],
  context: string,
): QueryField | undefined => {
  let current: QueryField | undefined;
  for (const name of context.split(".").filter(Boolean)) {
    current = fields.find((field) => field.name === name);
    if (!current) return undefined;
    fields = current.fields ?? [];
  }
  return current;
};

export type QueryValidation =
  | { expression: QueryExpression; error: null }
  | { expression: null; error: string | null };

export const validateQuery = (
  input: string,
  fields?: readonly QueryField[],
): QueryValidation => {
  if (!input.trim()) return { expression: null, error: null };
  let expression: QueryExpression;
  try {
    // The generated grammar constructs exactly the normalized expression types.
    expression = parse(input) as QueryExpression;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { expression: null, error: error.message };
  }

  const visit = (
    node: QueryExpression,
    available: readonly QueryField[] | undefined,
    field?: QueryField,
    depth = 0,
  ): string | null => {
    if (node.type === "and" || node.type === "or") {
      for (const operand of node.operands) {
        const error = visit(operand, available, field, depth);
        if (error) return error;
      }
    } else if (node.type === "not") {
      return visit(node.operand, available, field, depth);
    } else if (node.type === "filter") {
      if (depth >= 2) return "Only one level of nested filters is supported.";
      const selected = available?.find((item) => item.name === node.name);
      if (available && !selected) return `Unsupported filter: ${node.name}.`;
      return visit(
        node.expression,
        selected ? (selected.fields ?? []) : undefined,
        selected,
        depth + 1,
      );
    } else if (node.type === "comparison") {
      if (field) {
        const numeric = node.value.type === "quantity";
        if (numeric !== (field.type === "quantity")) {
          return `${field.name} requires ${field.type === "quantity" ? "a quantity" : "a quoted string"}.`;
        }
        if (
          node.value.type === "quantity" &&
          node.value.unit !== null &&
          !field.units?.includes(node.value.unit)
        ) {
          return `Unsupported unit for ${field.name}: ${node.value.unit}.`;
        }
      }
    }
    return null;
  };
  const error = visit(expression, fields);
  return error ? { expression: null, error } : { expression, error: null };
};
