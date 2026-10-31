// tools/docs/lib/schema-table.mjs — turn a JSON Schema (draft-07, as zod-to-json-schema and the MCP
// SDK produce it) into the rows of a Markdown table: one row per field, nested objects flattened
// into dotted paths (`input.kind`, `verdicts[].token`). Pure: no I/O.

/** Follow a local `$ref` ("#/properties/input/...") inside `root`. */
function deref(schema, root) {
  let current = schema;
  const seen = new Set();
  while (current && typeof current.$ref === "string" && current.$ref.startsWith("#")) {
    if (seen.has(current.$ref)) break;
    seen.add(current.$ref);
    const target = current.$ref.slice(1).split("/").filter(Boolean)
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((node, key) => (node == null ? undefined : node[key]), root);
    const { $ref, ...rest } = current;
    current = target ? { ...target, ...rest } : rest;
  }
  return current ?? {};
}

const isObjectSchema = (s) => s && (s.type === "object" || (s.properties && !s.type));
const code = (value) => `\`${String(value)}\``;
const oneOf = (values) => `one of ${values.map((v) => code(JSON.stringify(v).replace(/^"|"$/g, ""))).join(", ")}`;

function range(min, max, unit) {
  if (min !== undefined && max !== undefined) return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
  if (min === 1 && unit === " chars") return "non-empty";
  if (min === 1 && unit === " items") return "at least 1 item";
  if (min !== undefined && unit) return `at least ${min}${unit}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}${unit}`;
  return "";
}

function withBounds(label, bounds) {
  return bounds ? `${label} (${bounds})` : label;
}

/** A short, readable label for the type of `schema`. */
export function typeLabel(input, root = input) {
  const schema = deref(input, root);
  if (schema.const !== undefined) return code(JSON.stringify(schema.const).replace(/^"|"$/g, ""));
  if (Array.isArray(schema.enum)) return oneOf(schema.enum);
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) {
    const resolved = variants.map((v) => deref(v, root));
    const nonNull = resolved.filter((v) => v.type !== "null");
    const nullable = nonNull.length < resolved.length;
    let label;
    if (nonNull.length > 1 && nonNull.every(isObjectSchema)) label = `object, one of ${nonNull.length} shapes`;
    else label = [...new Set(nonNull.map((v) => typeLabel(v, root)))].join(" or ");
    return nullable ? `${label} or null` : label;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => typeLabel({ ...schema, type: t }, root)).join(" or ");
  }
  switch (schema.type) {
    case "string": {
      let label = withBounds("string", range(schema.minLength, schema.maxLength, " chars"));
      if (schema.format) label += `, ${schema.format}`;
      if (schema.pattern) label += `, matches ${code(schema.pattern)}`;
      return label;
    }
    case "integer":
    case "number": {
      const min = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? `> ${schema.exclusiveMinimum}` : undefined);
      const bounds = typeof min === "string" ? min : range(min, schema.maximum, "");
      return withBounds(schema.type, bounds);
    }
    case "boolean":
    case "null":
      return schema.type;
    case "array": {
      const items = schema.items ? deref(schema.items, root) : {};
      const variants = items.anyOf ?? items.oneOf;
      const inner = isObjectSchema(items) && items.properties ? "objects"
        : Array.isArray(variants) && variants.every((v) => isObjectSchema(deref(v, root))) ? `objects of ${variants.length} shapes`
          : typeLabel(items, root);
      const count = range(schema.minItems, schema.maxItems, " items");
      return count ? `array of ${inner}, ${count}` : `array of ${inner}`;
    }
    case "object":
    default: {
      if (schema.properties && Object.keys(schema.properties).length > 0) return "object";
      const extra = schema.additionalProperties;
      if (extra && typeof extra === "object" && Object.keys(extra).length > 0) return `map of ${typeLabel(extra, root)}`;
      if (schema.type === "object") return "object (free form)";
      return "any";
    }
  }
}

/** The constant that tells the variants of an `anyOf` of objects apart, if there is one. */
function discriminator(variants) {
  const candidates = Object.keys(variants[0]?.properties ?? {});
  const constOf = (v, key) => deref(v.properties?.[key] ?? {}, {}).const;
  const keys = candidates.filter((key) => variants.every((v) => v.properties?.[key]?.const !== undefined));
  const key = keys.includes("kind") ? "kind" : keys.includes("type") ? "type" : keys[0];
  return key ? { key, label: (v) => String(constOf(v, key)) } : null;
}

function note(schema, root) {
  const s = deref(schema, root);
  const parts = [];
  if (s.description) parts.push(s.description);
  if (s.default !== undefined && !(Array.isArray(s.default) && s.default.length === 0)) {
    parts.push(`Default ${code(JSON.stringify(s.default))}.`);
  }
  return parts.join(" ");
}

/**
 * Flatten `schema` (an object schema) into rows {path, type, required, description}.
 * - `maxDepth`: how many levels of nested objects to expand (0 = top-level fields only).
 * - `skip`: top-level field names to leave out (fields documented elsewhere).
 */
export function schemaRows(schema, { maxDepth = 3, skip = [], root = schema } = {}) {
  const rows = [];
  const visit = (node, prefix, depth, requiredLabel) => {
    const s = deref(node, root);
    const variants = (s.anyOf ?? s.oneOf)?.map((v) => deref(v, root)).filter(isObjectSchema);
    if (variants && variants.length > 1) {
      visitVariants(variants, prefix, depth);
      return;
    }
    const properties = s.properties ?? {};
    const required = new Set(s.required ?? []);
    for (const [name, child] of Object.entries(properties)) {
      if (depth === 0 && skip.includes(name)) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      emit(child, path, depth, requiredLabel(required.has(name)));
    }
  };
  const visitVariants = (variants, prefix, depth) => {
    const disc = discriminator(variants);
    const labelOf = (v, i) => (disc ? disc.label(v) : `shape ${i + 1}`);
    const merged = new Map();
    variants.forEach((variant, index) => {
      const required = new Set(variant.required ?? []);
      for (const [name, child] of Object.entries(variant.properties ?? {})) {
        const entry = merged.get(name) ?? { schemas: [], in: [], requiredIn: [] };
        entry.schemas.push(child);
        entry.in.push(labelOf(variant, index));
        if (required.has(name)) entry.requiredIn.push(labelOf(variant, index));
        merged.set(name, entry);
      }
    });
    const all = variants.length;
    for (const [name, entry] of merged) {
      const path = prefix ? `${prefix}.${name}` : name;
      const types = [...new Set(entry.schemas.map((c) => typeLabel(c, root)))];
      const isDisc = disc && name === disc.key;
      const type = isDisc ? oneOf(entry.in) : types.join(" or ");
      let required;
      if (entry.requiredIn.length === all) required = "yes";
      else if (entry.requiredIn.length === 0) required = "no";
      else required = `in ${entry.requiredIn.map(code).join(", ")}`;
      const where = !isDisc && entry.in.length < all && disc && entry.requiredIn.length !== entry.in.length ? `Only in ${disc.key} ${entry.in.map(code).join(", ")}.` : "";
      const description = [note(entry.schemas[0], root), where].filter(Boolean).join(" ");
      rows.push({ path, type, required, description });
      const first = deref(entry.schemas[0], root);
      if (entry.schemas.length === 1 && isObjectSchema(first) && first.properties && depth < maxDepth) {
        visit(first, path, depth + 1, (r) => (r ? "yes" : "no"));
      }
    }
  };
  const emit = (child, path, depth, required) => {
    const c = deref(child, root);
    rows.push({ path, type: typeLabel(c, root), required, description: note(c, root) });
    if (depth >= maxDepth) return;
    const variants = (c.anyOf ?? c.oneOf)?.map((v) => deref(v, root)).filter(isObjectSchema);
    if (variants && variants.length > 1) { visitVariants(variants, path, depth + 1); return; }
    if (isObjectSchema(c) && c.properties) { visit(c, path, depth + 1, (r) => (r ? "yes" : "no")); return; }
    if (c.type === "array" && c.items) {
      const items = deref(c.items, root);
      if (isObjectSchema(items) && items.properties) visit(items, `${path}[]`, depth + 1, (r) => (r ? "yes" : "no"));
    }
  };
  visit(schema, "", 0, (r) => (r ? "yes" : "no"));
  return rows;
}

const cell = (text) => String(text ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
/** Prose from the code, made safe for Markdown: a `<name>` placeholder would otherwise vanish as HTML. */
export const prose = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Markdown table of `rows`; the Description column is left out when every row's is empty. */
export function rowsTable(rows) {
  if (rows.length === 0) return "";
  const withDescription = rows.some((r) => r.description);
  const header = withDescription ? "| Field | Type | Required | Description |\n|---|---|---|---|" : "| Field | Type | Required |\n|---|---|---|";
  const lines = rows.map((r) => {
    const base = `| ${code(r.path)} | ${cell(r.type)} | ${cell(r.required)} |`;
    return withDescription ? `${base} ${cell(prose(r.description))} |` : base;
  });
  return [header, ...lines].join("\n");
}

export { cell as tableCell };
