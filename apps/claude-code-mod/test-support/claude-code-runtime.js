export function atom(ref, initial, options = {}) {
  return { ref, initial, shape: options.shape };
}

export async function read($, source) {
  const held = await $.state.get(source.ref);
  if (!source.shape) return held.value ?? source.initial;
  return held.value?.shape === source.shape ? held.value.value : source.initial;
}

export async function update($, source, change) {
  const held = await $.state.get(source.ref);
  const current = source.shape
    ? (held.value?.shape === source.shape ? held.value.value : source.initial)
    : (held.value ?? source.initial);
  const next = change(current);
  const value = source.shape ? { shape: source.shape, value: next } : next;
  await $.state.set(source.ref, value, { ifVersion: held.version });
  return next;
}

export const Fragment = Symbol.for("portable-claude-code-fragment");

export function h(type, props, ...children) {
  const flat = children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined);
  if (type === Fragment) return flat;
  if (typeof type === "function") return type({ ...(props ?? {}), children: flat });
  return { type, key: props?.key, props: props ?? {}, children: flat };
}
