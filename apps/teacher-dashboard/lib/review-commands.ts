// The CLI commands the review page shows. Pure (no node: import) so the client review inbox can
// rebuild them as the teacher opens items; lib/library.ts re-exports them for the server side.
//
// INT-STUDIUM-058 § 2.9 says the dashboard writes `opened: true` in the receipt. The dashboard has
// no authentication, so it writes nothing to disk: it puts the ids the teacher opened on screen in
// `--opened`, and the teacher's own run of experience_packet.py writes the receipt (lead's decision).
export type CommandLocale = "fr" | "en";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const placeholder = (locale: CommandLocale) => quote(locale === "fr" ? "VOTRE NOM" : "YOUR NAME");
const openedFlag = (opened: readonly string[] | undefined) => (opened && opened.length > 0 ? ` --opened ${quote(opened.join(","))}` : "");

export function approvalCommand(bundlePath: string, locale: CommandLocale, opened?: readonly string[]): string {
  return `.venv/bin/python tools/experience_packet.py approve --bundle ${quote(bundlePath)} --validated-by ${placeholder(locale)}${openedFlag(opened)}`;
}

/** Send the lesson back: writes a `returned` receipt only, the lesson stays unapproved. */
export function returnCommand(bundlePath: string, locale: CommandLocale, opened?: readonly string[]): string {
  return `.venv/bin/python tools/experience_packet.py receipt --bundle ${quote(bundlePath)} --reviewer ${placeholder(locale)} --decision returned${openedFlag(opened)}`;
}
