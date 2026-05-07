"""ABSCapsuleReader — lit une capsule AgenticScienceBuilder sans dépendance sur ABS.

Lecture JSON/Markdown uniquement. Aucun import de agentic_science_builder.
"""
from __future__ import annotations
import json
import os
import re
from typing import Optional
from pydantic import BaseModel


class ABSTaskCardRef(BaseModel):
    task_id: str
    title: str
    task_description: str
    inputs: list[str]
    expected_outputs: list[str]
    tools: list[str]
    methodology_summary: list[str]
    execution_profile: dict
    crossref_doi: Optional[str] = None
    linked_skills: list[str] = []


class ABSSkillRef(BaseModel):
    slug: str
    name: str
    description: str = ""
    edam_operation: Optional[str] = None
    edam_topics: list[str] = []
    source_paper_doi: Optional[str] = None
    esco_skill_uri: Optional[str] = None


class ABSCapsuleData(BaseModel):
    task_cards: list[ABSTaskCardRef]
    skills: list[ABSSkillRef]
    doi: Optional[str] = None
    ro_crate_entity_uri: Optional[str] = None
    computational_env: Optional[dict] = None


class ABSCapsuleReader:
    def read(
        self,
        capsule_path: str,
        task_card_ids: list[str] | None = None,
    ) -> ABSCapsuleData:
        task_cards = self._read_task_cards(capsule_path, task_card_ids)
        skills = self._read_skills(capsule_path)
        doi, ro_crate_uri = self._read_ro_crate(capsule_path)
        return ABSCapsuleData(
            task_cards=task_cards,
            skills=skills,
            doi=doi,
            ro_crate_entity_uri=ro_crate_uri,
        )

    def _read_task_cards(self, capsule_path: str, task_card_ids: list[str] | None) -> list[ABSTaskCardRef]:
        cards = []
        # Chercher task_card.json à la racine ou dans task_card*.json
        candidates = []
        for fname in os.listdir(capsule_path):
            if fname.startswith("task_card") and fname.endswith(".json"):
                candidates.append(os.path.join(capsule_path, fname))
        for fpath in candidates:
            with open(fpath, encoding="utf-8") as f:
                data = json.load(f)
            tid = data.get("task_id", "")
            if task_card_ids is not None and tid not in task_card_ids:
                continue
            cards.append(ABSTaskCardRef(
                task_id=tid,
                title=data.get("title", ""),
                task_description=data.get("task_description", ""),
                inputs=data.get("inputs", []),
                expected_outputs=data.get("expected_outputs", []),
                tools=data.get("tools", []),
                methodology_summary=data.get("methodology_summary", []),
                execution_profile=data.get("execution_profile", {}),
                crossref_doi=data.get("crossref_doi"),
                linked_skills=data.get("skills", []),
            ))
        return cards

    def _read_skills(self, capsule_path: str) -> list[ABSSkillRef]:
        skills_dir = os.path.join(capsule_path, "skills")
        if not os.path.isdir(skills_dir):
            return []
        skills = []
        for fname in os.listdir(skills_dir):
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(skills_dir, fname)
            with open(fpath, encoding="utf-8") as f:
                content = f.read()
            fm = self._parse_frontmatter(content)
            slug = fm.get("slug") or fname.replace(".md", "")
            # description = première ligne non-vide après le frontmatter
            body = re.sub(r"^---.*?---\s*", "", content, flags=re.DOTALL).strip()
            first_line = next((l.strip() for l in body.splitlines() if l.strip() and not l.startswith("#")), "")
            edam_topics = fm.get("edam_topics", [])
            if isinstance(edam_topics, str):
                edam_topics = [edam_topics]
            skills.append(ABSSkillRef(
                slug=slug,
                name=fm.get("name", slug),
                description=first_line,
                edam_operation=fm.get("edam_operation"),
                edam_topics=edam_topics,
                source_paper_doi=fm.get("source_paper_doi"),
                esco_skill_uri=fm.get("esco_skill_uri"),
            ))
        return skills

    def _read_ro_crate(self, capsule_path: str) -> tuple[Optional[str], Optional[str]]:
        crate_path = os.path.join(capsule_path, "ro-crate-metadata.json")
        if not os.path.exists(crate_path):
            return None, None
        with open(crate_path, encoding="utf-8") as f:
            crate = json.load(f)
        doi = None
        ro_crate_uri = None
        for node in crate.get("@graph", []):
            if node.get("@id") == "./":
                ro_crate_uri = f"urn:abs:rocrate:{os.path.basename(os.path.abspath(capsule_path))}"
            if "ScholarlyArticle" in str(node.get("@type", "")):
                identifier = node.get("identifier", "")
                if isinstance(identifier, str) and identifier.startswith("doi:"):
                    doi = identifier.replace("doi:", "")
                elif node.get("@id", "").startswith("https://doi.org/"):
                    doi = node["@id"].replace("https://doi.org/", "")
        return doi, ro_crate_uri

    @staticmethod
    def _parse_frontmatter(content: str) -> dict:
        """Parse le frontmatter YAML minimal (clé: valeur, listes simples)."""
        match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
        if not match:
            return {}
        result: dict = {}
        lines = match.group(1).splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            kv = re.match(r"^(\w[\w_-]*):\s*(.*)", line)
            if kv:
                key, val = kv.group(1), kv.group(2).strip()
                if not val:
                    # liste suivante
                    items = []
                    i += 1
                    while i < len(lines) and lines[i].startswith("  - "):
                        items.append(lines[i].strip()[2:])
                        i += 1
                    result[key] = items
                    continue
                result[key] = val
            i += 1
        return result
