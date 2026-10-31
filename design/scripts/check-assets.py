#!/usr/bin/env python3
"""Validate the new SVG/PNG deliverables without network or third-party packages."""
from pathlib import Path
import json
import re
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "docs" / "assets"
TOKENS = json.loads((ROOT / "design" / "tokens.json").read_text())
ALLOWED_COLORS = {color.lower() for theme in TOKENS["color"].values() for color in theme.values()}


def check_svg(path: Path) -> None:
    text = path.read_text()
    assert not re.search(r"<!DOCTYPE|<!ENTITY|@import", text, re.I), f"External declaration: {path}"
    svg = ET.fromstring(text)
    assert svg.tag.rsplit("}", 1)[-1] == "svg", f"Not an SVG: {path}"
    tags = [element.tag.rsplit("}", 1)[-1].lower() for element in svg.iter()]
    assert not set(tags) & {"script", "foreignobject", "image"}, f"Prohibited SVG element: {path}"
    assert "title" in tags and "desc" in tags, f"Missing accessible name: {path}"
    assert svg.get("viewBox"), f"Missing viewBox: {path}"
    for element in svg.iter():
        for key, value in element.attrib.items():
            name = key.rsplit("}", 1)[-1].lower()
            assert not name.startswith("on"), f"Event handler: {path}"
            if name == "href":
                assert value.startswith("#"), f"External href: {path}"
    for reference in re.findall(r"url\(\s*['\"]?([^)'\"\s]+)", text, re.I):
        assert reference.startswith("#"), f"External CSS reference: {path}"
    for color in re.findall(r"#[0-9a-fA-F]{6}\b", text):
        assert color.lower() in ALLOWED_COLORS, f"Colour outside tokens.json: {color} in {path}"
    if path.parent.name == "diagrams" or "wordmark" in path.name or path.name.startswith("hero-"):
        assert "text" in tags, f"Labels must be real SVG text: {path}"
    if path.name == "studium-mark-mono.svg":
        assert svg.get("viewBox") == "0 0 24 24", "Activity-bar mark must use 24×24 geometry."
        for element in svg.iter():
            if element.tag.rsplit("}", 1)[-1] == "path":
                assert element.get("fill") == "currentColor", "Mono paths must inherit currentColor."


files = sorted([
    *(ASSETS / "brand").glob("*.svg"),
    *(ASSETS / "diagrams").glob("*.svg"),
    ASSETS / "hero-light.svg",
    ASSETS / "hero-dark.svg",
])
assert files, "No SVG assets found."
for file in files:
    check_svg(file)
print(f"PASS {len(files)} SVGs parse as XML; accessible names, token colours and safe local vector content.")

for name in ["architecture", "learning-loop", "self-learner-journey", "teacher-journey"]:
    for theme in ["light", "dark"]:
        assert (ASSETS / "diagrams" / f"{name}-{theme}.svg").is_file()
for theme in ["light", "dark"]:
    assert (ASSETS / f"hero-{theme}.svg").is_file()
print("PASS all four diagram theme pairs and both heroes exist.")

icon = (ASSETS / "brand" / "studium-icon.png").read_bytes()
assert icon[:8] == b"\x89PNG\r\n\x1a\n", "Icon must be a PNG."
dimensions = struct.unpack(">II", icon[16:24])
assert dimensions == (256, 256), f"Unexpected icon size: {dimensions}"
print("PASS VSIX icon PNG header: 256×256.")
