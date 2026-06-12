"""Thin CLI so a human teacher can review + approve a generated course and emit
the audit report, without a GUI.

Run from `services/planner` so the `provenance` package resolves (the same import
convention conftest.py sets up for tests):

    # 1. produce the teacher-facing audit report to review BEFORE deciding
    .venv/bin/python -m provenance.approval_cli report --course-dir .lwg/<id>

    # 2. approve (verified) with your identity + an explicit ISO timestamp
    .venv/bin/python -m provenance.approval_cli approve \
        --course-dir .lwg/<id> \
        --approver https://orcid.org/0000-0002-1825-0097 \
        --decision approve \
        --approved-at 2026-06-11T09:30:00+00:00

    # reject / hold record the decision but leave every claim draft:
    ... approve --decision hold --approver <iri> --approved-at <ts> --note "needs sources"

    # partial approval — only the listed claim ids flip:
    ... approve ... --selected-claim-ids urn:studium:edge:prereq0 urn:studium:edge:prereq1

The entry point is intentionally pure plumbing: parse -> call -> json/paths to
stdout. No env reads, no clock (the timestamp is supplied), no network.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

from provenance.approval import approve_course, build_course_audit_report


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="approval_cli",
        description="HITL course approval + audit report (rule-003 strict human-in-the-loop).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ap = sub.add_parser("approve", help="Record a teacher decision (approve flips draft->verified).")
    ap.add_argument("--course-dir", required=True, help="Path to the .lwg/<id> course dir.")
    ap.add_argument("--approver", default="",
                    help="IRI/identifier of the human vouching (required for approve).")
    ap.add_argument("--decision", choices=["approve", "reject", "hold"], default="approve")
    ap.add_argument("--approved-at", default="",
                    help="Explicit ISO-8601 timestamp (required for approve; deterministic).")
    ap.add_argument("--selected-claim-ids", nargs="*", default=None,
                    help="Optional subset of Claim ids to approve (partial approval).")
    ap.add_argument("--note", default=None, help="Optional free-text note for the audit trail.")

    rp = sub.add_parser("report", help="Emit course_audit_report.json + .md (read-only).")
    rp.add_argument("--course-dir", required=True, help="Path to the .lwg/<id> course dir.")
    rp.add_argument("--out-dir", default=None, help="Where to write the report (default: course dir).")

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.command == "approve":
        record = approve_course(
            args.course_dir,
            approver=args.approver,
            decision=args.decision,
            approved_at=args.approved_at,
            selected_claim_ids=args.selected_claim_ids,
            note=args.note,
        )
        print(json.dumps(record, ensure_ascii=False, indent=2))
        return 0

    if args.command == "report":
        json_path, md_path = build_course_audit_report(args.course_dir, out_dir=args.out_dir)
        print(json.dumps({"json": json_path, "md": md_path}, ensure_ascii=False, indent=2))
        return 0

    return 1  # pragma: no cover - argparse `required=True` prevents this


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
