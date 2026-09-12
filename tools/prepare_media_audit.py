#!/usr/bin/env python3
"""Prepare real decodable media fixtures for the Chrome audit; no AI calls."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from experience_templates import prepare_activity
from media_workflow import prepare_request


ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, value: object) -> None:
    """Write inspectable fixture inputs."""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare_audit(output: Path) -> Path:
    """Create a new fixture tree with a museum photograph, tone and colour clip."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required only for generating the synthetic browser audit fixtures")
    output.mkdir(parents=True, exist_ok=False)
    inputs = output / "inputs"
    inputs.mkdir()
    archaeology = ROOT / "examples" / "archaeology"
    shutil.copyfile(archaeology / "museum-photo.jpg", inputs / "museum-photo.jpg")
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    "-c:a", "pcm_s16le", str(inputs / "tone.wav")], check=True)
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=0x216b67:s=320x180:d=2",
                    "-i", str(inputs / "tone.wav"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(inputs / "clip.mp4")], check=True)
    (inputs / "captions.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:02.000\n[Steady test tone; plain teal frame]\n", encoding="utf-8")
    base = output / "base"
    prepare_activity("evidence-claim", archaeology / "context.json", base,
                     archaeology / "config.json", supports_path=archaeology / "supports.json")
    brief = json.loads((ROOT / "examples/media/teacher-brief.json").read_text())
    brief.update(prompt="Prepare an explanatory diagram distinguishing visible object features from catalogue attribution. Do not reconstruct an ancient setting or invent measurements.",
                 source_refs=[{"id": "met_544227", "locator": "https://www.metmuseum.org/art/collection/search/544227", "role": "primary_evidence"}],
                 text_fallback="Describe visible features; attribute dating to the catalogue and seek additional evidence for original use.")
    write_json(inputs / "brief.json", brief)
    request = prepare_request(base, inputs / "brief.json", base / "media-request.json")
    supports = json.loads((archaeology / "supports.json").read_text())
    rights = {"creator": "Studium test fixture generator", "license": "CC0", "evidence_url": "urn:studium:synthetic-media-audit", "scope": "public"}
    for kind, filename in (("audio", "tone.wav"), ("video", "clip.mp4")):
        meta = {"alt": "Synthetic playback test; two-second tone and optional plain teal frame.",
                "origin": "source", "transcript": "A steady test tone. The video shows a plain teal frame. No speech or scientific result.",
                "rights": rights, "placement": "before_prediction"}
        if kind == "video":
            meta.update(captions_path="captions.vtt", captions_language="en")
        supports["render_assets"].append({"kind": kind, "path": filename,
            "title": "Synthetic decoder test · " + kind,
            "provenance": "Locally generated with ffmpeg; no model, learner or educational outcome involved.", "meta": meta})
    supports["render_assets"].append(request)
    write_json(inputs / "supports.json", supports)
    activity = output / "activity"
    prepare_activity("evidence-claim", archaeology / "context.json", activity,
                     archaeology / "config.json", supports_path=inputs / "supports.json")
    return activity


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    print(prepare_audit(parser.parse_args().out.resolve()))
