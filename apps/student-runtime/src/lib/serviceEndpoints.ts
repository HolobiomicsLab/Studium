/**
 * Les URL des services que le runtime appelle — un seul point de configuration.
 *
 * Il en restait une en dur : `AICritiqueScene` écrivait
 * `endpoint ?? "http://localhost:8002/scenes/critique-eval"` dans le corps de `submit`. La
 * propriété `critiqueEvalEndpoint` de `SceneRouter` existait bien mais **personne ne la
 * passait** — `LessonPlayer` rend `SceneRouter` sans elle — donc le littéral était toujours
 * l'URL utilisée, et il n'existait aucun endroit où la changer sans recompiler.
 *
 * Même idiome que `getTelemetryEndpoint` : un override `window.__*` posé par les specs E2E,
 * puis un fallback fourni par l'appelant, puis la valeur par défaut de développement. Pas de
 * `import.meta.env` : le runtime n'en lit nulle part, et en introduire ici ferait deux
 * mécanismes de configuration au lieu d'un.
 */

/** Le shim d'évaluation de critique, en développement local (`services/critique-shim`, :8002). */
export const DEFAULT_CRITIQUE_EVAL_ENDPOINT = "http://localhost:8002/scenes/critique-eval";

function windowOverride(key: string): string | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const v = w[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * L'URL d'évaluation de critique effective : override de test, puis configuration de
 * l'application, puis défaut de développement.
 */
export function getCritiqueEvalEndpoint(fallback?: string | null): string {
  return windowOverride("__critique_eval_endpoint") ?? fallback ?? DEFAULT_CRITIQUE_EVAL_ENDPOINT;
}

/** Vrai si l'URL utilisée est le défaut, c'est-à-dire si rien n'a été configuré. */
export function isDefaultCritiqueEvalEndpoint(url: string): boolean {
  return url === DEFAULT_CRITIQUE_EVAL_ENDPOINT;
}

export type EndpointFailure = "unreachable" | "http_error" | "bad_response";

/**
 * Le diagnostic d'accessibilité que l'intent demandait.
 *
 * « Failed to fetch » était tout ce que l'apprenant voyait quand le service n'était pas
 * démarré : le message ne nommait ni l'URL tentée, ni le fait qu'elle n'avait jamais été
 * configurée, ni le service à lancer. Distinguer les trois cas est la moitié utile —
 * *injoignable* et *a répondu 500* ne se réparent pas de la même façon.
 *
 * Et ce n'est pas un détail d'ergonomie : sans ce service, toute réponse libre est notée par
 * le repli mot-clé (INT-STUDIUM-035). Un service silencieusement absent est une notation
 * silencieusement dégradée, donc l'absence doit être dite.
 */
export function classifyEndpointFailure(error: unknown): EndpointFailure {
  const msg = error instanceof Error ? error.message : String(error);
  if (/^status \d+/.test(msg)) return "http_error";
  if (/JSON|parse|unexpected token/i.test(msg)) return "bad_response";
  return "unreachable";
}

export function describeEndpointFailure(
  url: string,
  error: unknown,
  serviceHint = "le service d'évaluation de critique",
): string {
  const kind = classifyEndpointFailure(error);
  const detail = error instanceof Error ? error.message : String(error);
  if (kind === "http_error") {
    return `${serviceHint} a répondu une erreur (${detail}) à ${url}.`;
  }
  if (kind === "bad_response") {
    return `${serviceHint} a répondu quelque chose d'illisible (${detail}) à ${url}.`;
  }
  const unconfigured = isDefaultCritiqueEvalEndpoint(url)
    ? " Aucune URL n'est configurée : c'est l'adresse de développement par défaut."
    : "";
  return `${serviceHint} est injoignable à ${url}.${unconfigured} Démarrez-le, ou configurez une autre URL.`;
}
