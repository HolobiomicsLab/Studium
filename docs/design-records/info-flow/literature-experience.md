# Literature experience information flow

1. The caller captures a Perspicacité response. `normalize_passage_envelope` in
   the Python client package handles current flat and legacy nested passages.
   The existing client still projects at most 500 characters into the legacy
   BibliographicRef contract; the new packet keeps the full captured passage.
2. `experience_packet.prepare_packet` writes the original response, origin,
   canonical source records and hashes to `evidence.json`. Its separate prompt
   template `tools/prompts/experience_author.md` tells the harness to read this
   file plus the generated `response.schema.json`; no source text is silently
   summarized in the prompt. Optional ASB card environment values are removed.
3. The external harness returns a `LessonPlan` and exact source links/viewer
   briefs. No backend model client runs. `check_response` reconstructs the source
   ledger, validates linkage and leaves the plan draft/unapproved. The approved
   bundle flow is separate.
4. `experience_review` maps those checked source links into the existing ASTRA
   emitter and MyST renderer. Its findings assert only source linkage.
5. For a running lesson, `operatorContext` starts from `publicScene`, applies a
   display allowlist, projects resolved assets without arbitrary metadata and
   uses the existing run manifest. Its input example is parsed by the existing
   response schema. The same projector feeds MCP and embedded task.md JSON.
6. The external example viewer consumes context, measured fixture output,
   synthetic spectra and a checked draft/viewer/source linkage. Source metadata
   and review hashes travel into its manifest; JSON is escaped and displayed
   text uses DOM textContent. Browser calculations are labelled exploration.
   Downloaded reflections contain only the learner's text and optional chosen
   confidence, are ungraded, and are never automatically submitted to Studium.

No answer key, private feedback, automatic author approval, model-provider setting
or scientific execution permission is carried by the new operator context.
