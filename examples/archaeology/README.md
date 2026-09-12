# A museum photograph as evidence

This teacher-review draft exercises the generic `evidence-claim` template with a
real photograph from The Metropolitan Museum of Art. It separates visible
features, museum catalogue statements and interpretations needing other evidence.
It is not a validated archaeology curriculum or a learner study.

```sh
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/experience_templates.py prepare \
  --template evidence-claim --context examples/archaeology/context.json \
  --config examples/archaeology/config.json \
  --supports examples/archaeology/supports.json \
  --out .studium-session/archaeology-observation
```

Open the resulting `index.html`. The photograph is available before prediction;
candidate claims and feedback follow the learner's own prediction. Viewing a
photograph is not proof of understanding and is not added to the learner trace.

`museum-photo.jpg` is the unmodified museum web-size image of
[Hippopotamus ("William"), object 544227](https://www.metmuseum.org/art/collection/search/544227).
Credit: The Metropolitan Museum of Art; Gift of Edward S. Harkness, 1917.
The museum API marked the object `isPublicDomain: true` on 12 September 2026.
The eligible image is offered under the museum's
[CC0 Open Access policy](https://www.metmuseum.org/hubs/open-access).
`source-record.json` retains the source/API/image URLs, retrieval time and image
SHA-256. This image's CC0 status is separate from the repository's software license.

For a generated reconstruction, keep this photograph as the original evidence,
label inferred features and place explanatory material after prediction. Follow
the [media workflow](../../docs/guides/sourced-and-generated-media.md).
