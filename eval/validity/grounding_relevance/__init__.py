"""grounding_relevance — does a bundle's attached citations actually match the
scenes they ground, or are they merely PRESENT?

The eval auditor scores the ``grounding_citations`` dimension by PRESENCE of
evidence: a scene with any attached bibliographic ref scores 1.0. That is
gameable — the mock-mode enricher bolts a metabolomics paper onto a "Eukaryotic
Cells" lesson and the bundle still scores 1.0. This additive validity tool
measures TOPICAL RELEVANCE with a lexical (token-overlap / Jaccard) proxy,
distinguishing real (relevant) grounding from presence-only grounding.

Lexical, not semantic. It complements — does not replace — the auditor's
presence check, and it does not call any LLM or embedding model (pure stdlib).
"""
