// vscode-uri-fixture.ts — for the drivers: what VS Code hands an extension's URI handler for a link. Read from VS
// Code's src/vs/base/common/uri.ts (the same in the 1.139 extension host): URI.parse splits the link and decodes each
// part once (uri.query is decoded), and uri.toString() encodes each part again, the query as a whole, "=" and "&"
// included (encodeURIComponentFast; its table also encodes the ! ' ( ) * that encodeURIComponent leaves).
const LINK = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

/** VS Code's decodeURIComponentGraceful: a malformed escape stays as it is. */
function graceful(run: string): string {
  try { return decodeURIComponent(run); } catch { return run.length > 3 ? run.slice(0, 3) + graceful(run.slice(3)) : run; }
}

/** VS Code's percentDecode: each run of %XX escapes decoded once. */
function decodeOnce(part: string): string {
  return part.replace(/(%[0-9A-Za-z][0-9A-Za-z])+/g, graceful);
}

/** VS Code's encodeURIComponentFast: everything but [A-Za-z0-9-._~] encoded, and "/" kept in a path. */
function encodeAll(part: string, keepSlash: boolean): string {
  const encoded = encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

export interface HandedUri { scheme: string; authority: string; path: string; query: string; fragment: string; toString(): string }

/** The vscode.Uri a URI handler receives for `link`. */
export function vscodeHandsOver(link: string): HandedUri {
  const m = LINK.exec(link)!;
  const scheme = m[2] ?? "";
  const authority = decodeOnce(m[4] ?? "");
  const path = decodeOnce(m[5] ?? "");
  const query = decodeOnce(m[7] ?? "");
  const fragment = decodeOnce(m[9] ?? "");
  return {
    scheme, authority, path, query, fragment,
    toString: () => `${scheme}://${authority}${encodeAll(path, true)}${query ? `?${encodeAll(query, false)}` : ""}` +
      (fragment ? `#${encodeAll(fragment, false)}` : ""),
  };
}
