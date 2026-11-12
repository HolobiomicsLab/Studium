#!/usr/bin/env python3
"""Build the Studium vocabulary documents served at https://holobiomicslab.cnrs.fr/ns/studium.

    python tools/ns/build_studium_vocab.py            # write ns/studium.{ttl,jsonld,rdf,html}
    python tools/ns/build_studium_vocab.py --check    # exit 1 if a file in ns/ differs from the output

Needs rdflib (the ASB namespace documents are built with it too). The files are generated, never edited by
hand; copy them unchanged into the lab site repository, `public/ns/` (see ns/README.md).

IDENTITY. Two IRIs, two roles, as for ASB:
  * the terms live under https://w3id.org/studium#  (NS), so they do not move with a hosting change;
  * the document that describes them is https://holobiomicslab.cnrs.fr/ns/studium  (DOC), the canonical host
    of the lab (the owner's standard, 12 Nov 2026). Nothing here is, or points at, holobiomicslab.eu.
A term's IRI is NS + the value written in a lesson bundle (`quiz` is https://w3id.org/studium#quiz).

SCOPE OF 0.1. The 13 scene types of a lesson bundle, from the bundle schema. Not in this version, on purpose:
the modulators (their names are for the authoring team to confirm) and the graph edge relations (the code reads
`prerequisite_for` in both directions). A term is added by appending to SCENE_TYPES or a new list; a published
IRI is never renamed or reused for another meaning.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from html import escape
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape
from xml.sax.saxutils import quoteattr

try:
    from rdflib import DCTERMS, OWL, RDF, RDFS, SKOS, XSD, Graph, Literal, Namespace, URIRef
except ImportError:  # the terms and the tests that read files still import; building a graph needs rdflib
    Graph = None

SITE = "https://holobiomicslab.cnrs.fr"
DOC_IRI = f"{SITE}/ns/studium"
NS = "https://w3id.org/studium#"
DOCS_PAGE = "https://github.com/HolobiomicsLab/Studium/blob/main/docs/concepts/scene-types.md"
LICENSE_IRI = "https://www.apache.org/licenses/LICENSE-2.0"
MODIFIED = "2026-11-12"
VERSION = "0.1"

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ns"


@dataclass(frozen=True)
class Term:
    id: str
    en: str  # what the learner does, completing "A scene in which the learner ..."
    fr: str  # completing "Scène dans laquelle l'apprenant ..."


# From docs/concepts/scene-types.md and its French page, in their order; the ids are the values of the
# `SceneType` of packages/lesson-bundle-schema (tools/test_ns_studium.py pins the two together).
SCENE_TYPES: tuple[Term, ...] = (
    Term("intro", "sees the goal and the path of the lesson", "découvre l'objectif et le parcours de la leçon"),
    Term("concept", "reads and works with one idea", "lit et manipule une idée"),
    Term("meta_checkpoint", "declares how confident they are (0 to 4), once or before and after",
         "déclare sa confiance (de 0 à 4), une fois ou avant et après"),
    Term("quiz", "chooses an answer", "choisit une réponse"),
    Term("spot_the_flaw", "finds the errors in a deliberately flawed text",
         "repère les erreurs d'un texte volontairement fautif"),
    Term("ai_critique", "critiques an AI production", "critique une production de l'IA"),
    Term("explain_back", "explains the idea in their own words, as if teaching it",
         "explique l'idée avec ses mots, comme s'il l'enseignait"),
    Term("comparison", "compares two objects or explanations", "compare deux objets ou deux explications"),
    Term("summary_audit", "checks an AI summary for omissions and distortions",
         "vérifie les omissions et déformations d'un résumé produit par l'IA"),
    Term("prompt_practice", "writes or improves a prompt for a task", "rédige ou améliore une consigne pour une tâche"),
    Term("communication_sim", "communicates a message to an audience, in a professional role",
         "transmet un message à un public, dans un rôle professionnel"),
    Term("discussion", "reasons with a tutor over several turns", "raisonne avec un tuteur sur plusieurs tours"),
    Term("reproduction", "has the harness run a protocol, then examines the result",
         "fait exécuter un protocole par le harnais, puis examine le résultat"),
)

SCHEME_EN = "The types a scene of a Studium lesson bundle can have: what the learner is asked to do in each."
SCHEME_FR = "Les types que peut avoir une scène d'une leçon Studium : ce que l'on demande à l'apprenant dans chacun."
NOTE_EN = (
    "This namespace names the things a Studium lesson is made of. Version 0.1 holds the 13 scene types of a "
    "lesson bundle. Each term is the value written in a bundle: the scene type <code>quiz</code> is "
    "<code>https://w3id.org/studium#quiz</code>. Further terms are added to this document; a published term is "
    "never renamed."
)


def _label(term_id: str) -> str:
    return term_id.replace("_", " ")


def graph() -> "Graph":
    if Graph is None:
        raise SystemExit("rdflib is needed to build the vocabulary: pip install rdflib")
    DOC, STUDIUM, VANN = URIRef(DOC_IRI), Namespace(NS), Namespace("http://purl.org/vocab/vann/")
    g = Graph()
    for prefix, ns in [("studium", STUDIUM), ("dct", DCTERMS), ("owl", OWL), ("rdfs", RDFS), ("skos", SKOS),
                       ("vann", VANN), ("xsd", XSD)]:
        g.bind(prefix, ns)

    g.add((DOC, RDF.type, OWL.Ontology))
    g.add((DOC, DCTERMS.title, Literal("Studium vocabulary", lang="en")))
    g.add((DOC, DCTERMS.title, Literal("Vocabulaire de Studium", lang="fr")))
    g.add((DOC, DCTERMS.description, Literal(
        "Terms for the parts of a Studium lesson: version 0.1 names the scene types of a lesson bundle.", lang="en")))
    g.add((DOC, DCTERMS.description, Literal(
        "Termes pour les éléments d'une leçon Studium : la version 0.1 nomme les types de scène d'une leçon.",
        lang="fr")))
    g.add((DOC, DCTERMS.publisher, URIRef(f"{SITE}/")))
    g.add((DOC, DCTERMS.license, URIRef(LICENSE_IRI)))
    g.add((DOC, DCTERMS.modified, Literal(MODIFIED, datatype=XSD.date)))
    g.add((DOC, OWL.versionInfo, Literal(VERSION)))
    g.add((DOC, VANN.preferredNamespacePrefix, Literal("studium")))
    g.add((DOC, VANN.preferredNamespaceUri, Literal(NS)))

    scheme = STUDIUM.SceneTypeScheme
    g.add((scheme, RDF.type, SKOS.ConceptScheme))
    g.add((scheme, RDFS.isDefinedBy, DOC))
    g.add((scheme, SKOS.prefLabel, Literal("scene types", lang="en")))
    g.add((scheme, SKOS.prefLabel, Literal("types de scène", lang="fr")))
    g.add((scheme, SKOS.definition, Literal(SCHEME_EN, lang="en")))
    g.add((scheme, SKOS.definition, Literal(SCHEME_FR, lang="fr")))
    g.add((scheme, RDFS.seeAlso, URIRef(DOCS_PAGE)))

    for t in SCENE_TYPES:
        iri = STUDIUM[t.id]
        g.add((iri, RDF.type, SKOS.Concept))
        g.add((iri, SKOS.inScheme, scheme))
        g.add((iri, SKOS.notation, Literal(t.id)))
        g.add((iri, SKOS.prefLabel, Literal(_label(t.id), lang="en")))
        g.add((iri, SKOS.definition, Literal(f"A scene in which the learner {t.en}.", lang="en")))
        g.add((iri, SKOS.definition, Literal(f"Scène dans laquelle l'apprenant {t.fr}.", lang="fr")))
        g.add((iri, RDFS.isDefinedBy, DOC))
    return g


_CSS = (
    "body{max-width:850px;margin:auto;padding:3rem 1.2rem;font:16px/1.55 system-ui,sans-serif;color:#17202a}\n"
    ".note,article{border:1px solid #d5dbdb;border-radius:.5rem;padding:1rem;margin:1rem 0}"
    ".note{background:#fff7ed}code{overflow-wrap:anywhere}"
)


def html() -> str:
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>Studium vocabulary</title><style>\n{_CSS}\n</style></head><body>"
        "<p>Holobiomics Lab · namespace</p><h1>Studium vocabulary</h1>\n"
        f"<p><code>{NS}</code>, prefix <code>studium</code>, version {VERSION}</p>\n"
        f'<div class="note">{NOTE_EN}</div>\n'
        '<p><a href="studium.ttl">Turtle</a> · <a href="studium.jsonld">JSON-LD</a> · '
        '<a href="studium.rdf">RDF/XML</a></p>\n'
        f'<article id="SceneTypeScheme"><h2>scene types</h2><p><code>{NS}SceneTypeScheme</code></p>'
        f"<p>{escape(SCHEME_EN)}</p><p lang=\"fr\">{escape(SCHEME_FR)}</p>"
        f'<p>Described on <a href="{DOCS_PAGE}">the scene types page</a> of the documentation.</p></article>'
    ]
    for t in SCENE_TYPES:
        parts.append(
            f'<article id="{t.id}"><h2>{escape(_label(t.id))}</h2><p><code>{NS}{t.id}</code></p>'
            f"<p>A scene in which the learner {escape(t.en)}.</p>"
            f'<p lang="fr">Scène dans laquelle l\'apprenant {escape(t.fr)}.</p></article>'
        )
    parts.append("</body></html>")
    return "".join(parts)


# rdflib's JSON-LD and RDF/XML writers walk sets, so their output changes with the interpreter's hash seed.
# The two writers below walk the graph in sorted order instead: the same bytes on every run (rdflib's parsers
# read them back to the same graph; tools/test_ns_studium.py checks it).

def _sorted_objects(g: Graph, s, p) -> list:
    return sorted(g.objects(s, p), key=lambda o: (type(o).__name__, str(o), getattr(o, "language", None) or "",
                                                  str(getattr(o, "datatype", None) or "")))


def _jsonld_value(o) -> dict:
    if isinstance(o, URIRef):
        return {"@id": str(o)}
    if o.language:
        return {"@language": o.language, "@value": str(o)}
    if o.datatype:
        return {"@type": str(o.datatype), "@value": str(o)}
    return {"@value": str(o)}


def jsonld(g: Graph) -> str:
    nodes = []
    for s in sorted(set(g.subjects())):
        node: dict = {"@id": str(s)}
        types = [str(o) for o in _sorted_objects(g, s, RDF.type)]
        if types:
            node["@type"] = types
        for p in sorted(set(g.predicates(s)) - {RDF.type}):
            node[str(p)] = [_jsonld_value(o) for o in _sorted_objects(g, s, p)]
        nodes.append(node)
    return json.dumps(nodes, indent=2, ensure_ascii=False) + "\n"


def rdfxml(g: Graph) -> str:
    prefixes = sorted((str(ns), prefix) for prefix, ns in g.namespaces() if prefix)
    used = {RDF.type}
    used.update(p for p in g.predicates())

    def qname(iri) -> str:
        for ns, prefix in sorted(prefixes, key=lambda x: -len(x[0])):
            if str(iri).startswith(ns):
                return f"{prefix}:{str(iri)[len(ns):]}"
        raise ValueError(f"no prefix for {iri}")

    declared = {"rdf": str(RDF)}
    for p in used:
        q = qname(p)
        prefix = q.split(":")[0]
        declared[prefix] = next(ns for ns, pre in prefixes if pre == prefix)
    xmlns = " ".join(f"xmlns:{pre}={quoteattr(ns)}" for pre, ns in sorted(declared.items()))
    out = ['<?xml version="1.0" encoding="utf-8"?>', f"<rdf:RDF {xmlns}>"]
    for s in sorted(set(g.subjects())):
        out.append(f"  <rdf:Description rdf:about={quoteattr(str(s))}>")
        for p in sorted(set(g.predicates(s))):
            tag = qname(p)
            for o in _sorted_objects(g, s, p):
                if isinstance(o, URIRef):
                    out.append(f"    <{tag} rdf:resource={quoteattr(str(o))}/>")
                    continue
                attrs = ""
                if o.language:
                    attrs = f" xml:lang={quoteattr(o.language)}"
                elif o.datatype:
                    attrs = f" rdf:datatype={quoteattr(str(o.datatype))}"
                out.append(f"    <{tag}{attrs}>{xml_escape(str(o))}</{tag}>")
        out.append("  </rdf:Description>")
    out.append("</rdf:RDF>")
    return "\n".join(out) + "\n"


def build() -> dict[str, str]:
    g = graph()
    return {
        "studium.ttl": g.serialize(format="turtle"),
        "studium.jsonld": jsonld(g),
        "studium.rdf": rdfxml(g),
        "studium.html": html(),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="compare with ns/ instead of writing")
    args = ap.parse_args(argv)
    built = build()
    if args.check:
        stale = [n for n, text in built.items() if not (OUT / n).exists() or (OUT / n).read_text() != text]
        for n in stale:
            print(f"stale: ns/{n}", file=sys.stderr)
        return 1 if stale else 0
    OUT.mkdir(exist_ok=True)
    for name, text in built.items():
        (OUT / name).write_text(text)
        print(f"wrote ns/{name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
