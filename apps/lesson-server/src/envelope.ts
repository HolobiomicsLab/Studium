// apps/lesson-server/src/envelope.ts
export type Ok<T extends object> = { success: true; ok: true } & T;
export type Err = { success: false; ok: false; error: string };

export function ok<T extends object>(data: T): Ok<T> {
  return { success: true, ok: true, ...data };
}
export function err(message: string): Err {
  return { success: false, ok: false, error: message };
}
