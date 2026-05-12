type Context = Record<string, number | string | boolean>;

const OPERATORS = [">=", "<=", "!=", "==", ">", "<"] as const;

function parseExpr(expr: string): { op: string; raw: string } | null {
  for (const op of OPERATORS) {
    if (expr.startsWith(op)) return { op, raw: expr.slice(op.length).trim() };
  }
  return null;
}

function compareNumeric(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    case ">":  return actual >  expected;
    case "<":  return actual <  expected;
    case "==": return actual === expected;
    case "!=": return actual !== expected;
  }
  return false;
}

function compareEquality(actual: unknown, op: string, expected: string): boolean {
  if (typeof actual === "boolean") {
    const expectedBool = expected === "true";
    return op === "==" ? actual === expectedBool : actual !== expectedBool;
  }
  if (typeof actual === "string") {
    return op === "==" ? actual === expected : actual !== expected;
  }
  return false;
}

export function matchesCondition(when: Record<string, string>, ctx: Context): boolean {
  for (const [key, expr] of Object.entries(when)) {
    if (!(key in ctx)) return false;
    const parsed = parseExpr(expr);
    if (!parsed) return false;
    const { op, raw } = parsed;
    const value = ctx[key];
    if (typeof value === "number") {
      const expected = Number(raw);
      if (Number.isNaN(expected)) return false;
      if (!compareNumeric(value, op, expected)) return false;
    } else {
      if (op !== "==" && op !== "!=") return false;
      if (!compareEquality(value, op, raw)) return false;
    }
  }
  return true;
}
