type Catalogue = {
  labels: Record<string, Record<string, string>>;
  topics: Record<string, { source: string; en: Record<string, string>; fr: Record<string, string> }>;
};
/** Escaped, authored help only; never pass scene or learner objects. */
export function renderHelp(topicId: string, catalogue: Catalogue, audience?: 'student' | 'teacher'): string;
