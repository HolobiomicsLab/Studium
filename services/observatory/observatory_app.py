"""The Studium Observatory: one read-only localhost surface over the course,
session and evaluation artifacts on disk (INT-STUDIUM-008, slice 1).

Every route is a GET and every request re-scans the configured roots, so the page
is never staler than the disk and the service holds no state of its own beyond the
validator's mtime-keyed cache. The validator subprocess is the only process this
service spawns, and only from `/courses/{id}/validation`.

Start it from the repository root:

    python services/observatory/observatory_app.py --course-root services/planner/.lwg

or, from this directory, `uvicorn observatory_app:app --port 8004`.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import asdict

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

from observatory_config import (
    DEFAULT_HOST,
    ENV_COURSE_ROOT,
    ENV_COURSES,
    ENV_EVAL_ROOT,
    ENV_HOST,
    ENV_PORT,
    ENV_VALIDATOR_TIMEOUT,
    ENV_VALIDITY_ROOT,
    ObservatoryConfig,
)
from observatory_discovery import CourseRef, Inventory, RunRef, discover
from observatory_evaluation import run_detail, summarize_run, summarize_suite
from observatory_paths import TEMPLATES_DIR
from observatory_provenance import course_detail, myst_page, summarize_course
from observatory_validation import ValidationCache

TITLE = "studium-observatory"
VERSION = "0.1.0"


def create_app(cfg: ObservatoryConfig) -> FastAPI:
    """The application over one configuration. Nothing is read at construction time."""
    app = FastAPI(title=TITLE, version=VERSION)
    app.state.cfg = cfg
    app.state.validation = ValidationCache(cfg.validator_timeout)
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    def inventory() -> Inventory:
        return discover(app.state.cfg)

    def course(course_id: str) -> CourseRef | None:
        return inventory().courses.get(course_id)

    def run(run_id: str) -> RunRef | None:
        return inventory().runs.get(run_id)

    def index_view() -> dict:
        inv = inventory()
        cache: ValidationCache = app.state.validation
        courses = []
        for ref in inv.courses.values():
            summary = asdict(summarize_course(ref))
            summary["validation"] = cache.get(ref.path, run=False).status
            courses.append(summary)
        return {
            "courses": courses,
            "runs": [asdict(summarize_run(ref)) for ref in inv.runs.values()],
            "suites": [summarize_suite(ref) for ref in inv.suites.values()],
            "problems": list(app.state.cfg.problems()) + list(inv.problems),
            # Read as configured, not as typed: the analytics store is the one path two
            # processes can disagree about in silence (INT-STUDIUM-019).
            "notes": list(app.state.cfg.notes()),
        }

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(request, "index.html", index_view())

    @app.get("/api/index")
    def api_index() -> dict:
        return index_view()

    @app.get("/courses/{course_id}", response_class=HTMLResponse)
    def course_page(request: Request, course_id: str) -> HTMLResponse:
        ref = course(course_id)
        if ref is None:
            return _unknown("course")
        return templates.TemplateResponse(
            request, "course.html",
            {"course": course_detail(ref),
             "validation": asdict(app.state.validation.get(ref.path, run=False))})

    @app.get("/api/courses/{course_id}")
    def api_course(course_id: str) -> dict:
        ref = course(course_id)
        return course_detail(ref) if ref is not None else _unknown("course")

    @app.get("/courses/{course_id}/provenance.myst.md", response_class=PlainTextResponse)
    def course_myst(course_id: str) -> PlainTextResponse:
        ref = course(course_id)
        if ref is None:
            return _unknown("course")
        return PlainTextResponse(myst_page(ref), media_type="text/markdown; charset=utf-8")

    @app.get("/courses/{course_id}/validation", response_class=HTMLResponse)
    def course_validation(request: Request, course_id: str) -> HTMLResponse:
        ref = course(course_id)
        if ref is None:
            return _unknown("course")
        view = app.state.validation.get(ref.path, run=True)
        return templates.TemplateResponse(
            request, "validation.html", {"course_id": course_id, "validation": asdict(view)})

    @app.get("/api/courses/{course_id}/validation")
    def api_course_validation(course_id: str) -> dict:
        ref = course(course_id)
        if ref is None:
            return _unknown("course")
        return asdict(app.state.validation.get(ref.path, run=True))

    @app.get("/eval/runs/{run_id}", response_class=HTMLResponse)
    def run_page(request: Request, run_id: str) -> HTMLResponse:
        ref = run(run_id)
        if ref is None:
            return _unknown("run")
        return templates.TemplateResponse(request, "run.html", {"run": run_detail(ref)})

    @app.get("/api/eval/runs/{run_id}")
    def api_run(run_id: str) -> dict:
        ref = run(run_id)
        return run_detail(ref) if ref is not None else _unknown("run")

    @app.get("/eval/validity", response_class=HTMLResponse)
    def validity_page(request: Request) -> HTMLResponse:
        suites = [summarize_suite(ref) for ref in inventory().suites.values()]
        return templates.TemplateResponse(request, "validity.html", {"suites": suites})

    @app.get("/api/eval/validity")
    def api_validity() -> dict:
        return {"suites": [summarize_suite(ref) for ref in inventory().suites.values()]}

    return app


def _unknown(what: str) -> JSONResponse:
    return JSONResponse({"error": f"unknown {what}"}, status_code=404)


#: For `uvicorn observatory_app:app`. The configuration is read once, the roots on
#: every request.
app = create_app(ObservatoryConfig.from_env())


def main(argv: list[str] | None = None) -> int:
    """Start the service. Flags override the environment; a missing course root and no
    explicit `--course` is the only start-up error (spec N3)."""
    import uvicorn

    parser = argparse.ArgumentParser(
        prog="observatory", description="Read-only view over Studium's provenance and evaluation artifacts.")
    parser.add_argument("--course-root", help="directory whose child directories are courses")
    parser.add_argument("--course", action="append", default=[], help="one course directory (repeatable)")
    parser.add_argument("--eval-root", help="directory of evaluation run directories")
    parser.add_argument("--validity-root", help="directory of validity suites")
    parser.add_argument("--host", help=f"bind address (default {DEFAULT_HOST})")
    parser.add_argument("--port", type=int)
    parser.add_argument("--validator-timeout", type=float, help="seconds before astra validate is killed")
    args = parser.parse_args(argv)

    env = dict(os.environ)
    for value, name in ((args.course_root, ENV_COURSE_ROOT), (args.eval_root, ENV_EVAL_ROOT),
                        (args.validity_root, ENV_VALIDITY_ROOT), (args.host, ENV_HOST)):
        if value:
            env[name] = value
    if args.course:
        env[ENV_COURSES] = os.pathsep.join(args.course)
    if args.port is not None:
        env[ENV_PORT] = str(args.port)
    if args.validator_timeout is not None:
        env[ENV_VALIDATOR_TIMEOUT] = str(args.validator_timeout)

    cfg = ObservatoryConfig.from_env(env)
    problems = cfg.problems()
    for problem in problems:
        print(f"observatory: {problem}", file=sys.stderr)
    if any(p.startswith("course root missing") for p in problems):
        print("observatory: no course root and no --course; nothing to show", file=sys.stderr)
        return 2
    if cfg.host != DEFAULT_HOST:
        print(f"observatory: WARNING binding {cfg.host}, not {DEFAULT_HOST}; "
              "this service has no authentication layer", file=sys.stderr)

    print(f"observatory: http://{cfg.host}:{cfg.port} (read-only)", file=sys.stderr)
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
