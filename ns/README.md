# Studium vocabulary (`ns/`)

The documents that describe the terms of Studium, to be served at https://holobiomicslab.cnrs.fr/ns/studium, and the rule that makes `https://w3id.org/studium` reach them. Nothing here is published by this repository: the files are copied into the lab site and a pull request is opened on w3id.org, both by the owner's word.

| File | What it is |
|---|---|
| `studium.ttl`, `studium.jsonld`, `studium.rdf`, `studium.html` | the vocabulary in Turtle, JSON-LD, RDF/XML and as a page |
| `w3id/ids/studium/` | the `.htaccess` and `README.md` of the w3id.org identifier `studium` |

## Identity

- **Terms** are under `https://w3id.org/studium#`. A term is that namespace plus the value written in a lesson bundle: the scene type `quiz` is `https://w3id.org/studium#quiz`.
- **The document** is `https://holobiomicslab.cnrs.fr/ns/studium`, on the canonical host of the lab. It answers 303 to the representation the client asks for, as the ASB namespaces do.
- A published term is never renamed or given another meaning. New terms are added to the document.

## Version 0.1

The 13 scene types of a lesson bundle, grouped in the concept scheme `SceneTypeScheme`, each with an English and a French definition taken from [Scene types](../docs/concepts/scene-types.md). The test `tools/test_ns_studium.py` keeps the terms equal to the scene types of the bundle schema.

Left out on purpose, to be added once settled: the modulators (their names are for the authoring team to confirm) and the graph edge relations (the code reads `prerequisite_for` in both directions).

## Rebuild

```bash
python tools/ns/build_studium_vocab.py          # writes ns/studium.*
python tools/ns/build_studium_vocab.py --check  # exit 1 if a file is stale
```

The generator needs `rdflib`; the files are generated, never edited by hand, and the output does not depend on the interpreter's hash seed.

## Publish (the owner's)

1. Copy `studium.ttl`, `studium.jsonld`, `studium.rdf` and `studium.html` unchanged into `public/ns/` of the lab site repository, with the `.htaccess` that names `studium` among the documents it redirects. Deploy to OVH on the scoped authorisation for that one publication, then check `https://holobiomicslab.cnrs.fr/ns/studium` with each `Accept` type.
2. When the page answers, open the pull request on [perma-id/w3id.org](https://github.com/perma-id/w3id.org) with `w3id/ids/studium/` as `ids/studium/`. w3id.org asks for a target that is already live.
