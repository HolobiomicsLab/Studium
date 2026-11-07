// The CLI commands the review page shows. Pure (no node: import) so the client review inbox can
// rebuild them as the teacher opens items; lib/library.ts re-exports them for the server side.
//
// INT-STUDIUM-058 § 2.9 says the dashboard writes `opened: true` in the receipt. The dashboard has
// no authentication, so it writes nothing to disk: it puts the ids the teacher opened on screen in
// `--opened`, and the teacher's own run of experience_packet.py writes the receipt (lead's decision).
export type CommandLocale = "fr" | "en";
export type ReviewVerdict = "ok" | "to_fix";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
/** The name the commands carry: the one the teacher typed, or a placeholder to replace. */
export const placeholderName = (locale: CommandLocale) => (locale === "fr" ? "VOTRE NOM" : "YOUR NAME");
const nameArg = (locale: CommandLocale, name?: string) => quote(name?.trim() || placeholderName(locale));
// The CLI prints its summary (and its refusals) in English unless asked: the French page asks for French.
const langFlag = (locale: CommandLocale) => (locale === "fr" ? " --lang fr" : "");
const openedFlag = (opened: readonly string[] | undefined) => (opened && opened.length > 0 ? ` --opened ${quote(opened.join(","))}` : "");
const verdictFlag = (verdicts: Readonly<Record<string, ReviewVerdict>> | undefined, sceneOrder: readonly string[] | undefined) => {
  if (!verdicts || Object.keys(verdicts).length === 0) return "";
  const ids = sceneOrder ?? Object.keys(verdicts);
  const seen = new Set<string>();
  const values = ids.filter((id) => verdicts[id] !== undefined && !seen.has(id) && seen.add(id)).map((id) => `${id}=${verdicts[id]}`);
  return values.length > 0 ? ` --verdict ${quote(values.join(","))}` : "";
};

export function approvalCommand(
  bundlePath: string, locale: CommandLocale, opened?: readonly string[], name?: string,
  verdicts?: Readonly<Record<string, ReviewVerdict>>, sceneOrder?: readonly string[],
): string {
  return `.venv/bin/python tools/experience_packet.py approve --bundle ${quote(bundlePath)} --validated-by ${nameArg(locale, name)}${verdictFlag(verdicts, sceneOrder)}${openedFlag(opened)}${langFlag(locale)}`;
}

/** Send the lesson back: writes a `returned` receipt only, the lesson stays unapproved. */
export function returnCommand(
  bundlePath: string, locale: CommandLocale, opened?: readonly string[], name?: string,
  verdicts?: Readonly<Record<string, ReviewVerdict>>, sceneOrder?: readonly string[],
): string {
  return `.venv/bin/python tools/experience_packet.py receipt --bundle ${quote(bundlePath)} --reviewer ${nameArg(locale, name)} --decision returned${verdictFlag(verdicts, sceneOrder)}${openedFlag(opened)}${langFlag(locale)}`;
}
