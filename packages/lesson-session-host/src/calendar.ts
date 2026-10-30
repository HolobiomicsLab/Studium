// packages/lesson-session-host/src/calendar.ts
//
// One time zone for every date Studium names (RFR-13, R-en-05). A review falls at an instant (epoch
// ms); the learner reads it as a day. The day returned in JSON (due_date, next_review_date,
// next_due_date: yyyy-mm-dd) and the day printed in display_markdown (« samedi 31 octobre 2026 ») are
// both taken in the server's time zone — the machine's own unless the host is given another
// (SessionHostOptions.timeZone) — and get_server_info names it. They used to disagree near midnight:
// the JSON took the UTC day, the text the local one.

/** The machine's time zone (the TZ environment variable sets it), as an IANA name. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** `timeZone` when the runtime knows it (an IANA name such as "Europe/Paris", or "UTC"), else a
 * RangeError naming it. */
export function checkTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError(`time zone not recognised: ${JSON.stringify(timeZone)} (an IANA name such as "Europe/Paris" or "UTC")`);
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of `epochMs` in `timeZone`, as yyyy-mm-dd. */
export function calendarDate(epochMs: number, timeZone: string): string {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(epochMs).map((p) => [p.type, p.value]));
  return `${(parts["year"] ?? "").padStart(4, "0")}-${parts["month"] ?? ""}-${parts["day"] ?? ""}`;
}
