"""Studium backend eval harness.

A backend-only, manifest-driven harness that takes a real OER course material,
authors a schema-valid LessonBundle (real pipeline if LLM keys exist, else a
documented offline author step), drives a LessonSession playthrough with
pluggable student personas, and runs an auditing studio that scores the run +
the generated course and emits refinement feedback mapped back to the
REVIEW-FINDINGS.md backlog.

See eval/README.md for the run model and the student/auditor contracts.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
