# The answers file

`init` turns this into `.github/repo-rules.json`, adding the fixed parts of the standard
(types, word limit, title limit, releasing types). Fields the standard fixes are overwritten
if you set them.

```json
{
  "name": "Eco",
  "repo": "ilien-dev/eco",
  "defaultBranch": "main",
  "purpose": "finds the words people search for and puts them where search engines read them.",
  "shipped": ["skills/**", "shared/**", ".claude-plugin/**"],
  "visual": ["brand/**"],
  "issueFirst": false,
  "measured": {
    "enabled": true,
    "methods": [
      "What a skill does: the cases in `evals/*.json`, pass rate with the skill from main and with yours.",
      "A fix in a script: the test that fails on main and passes on your branch."
    ]
  },
  "commands": ["python tests/run.py"],
  "ci": { "requiredChecks": ["Tests (Python 3.9, ubuntu-24.04)"] },
  "release": {
    "kind": "claude-plugin",
    "currentVersion": "0.2.0",
    "versionFiles": [
      { "path": ".claude-plugin/plugin.json", "jsonpath": "$.version" },
      { "path": "shared/scripts/eco.py", "type": "generic" }
    ]
  }
}
```

- `purpose`: what the project does, as the end of a sentence that starts with its name
  ("Eco finds..."), ending in a period. It is printed in CONTRIBUTING.md, the issue forms and
  the agent skill as the scope every contribution is judged against.
- `shipped`: globs of what users install or run. Changes there must release a version.
- `visual`: globs whose change needs a screenshot in Evidence. Leave empty if nothing is visual.
- `commands`: what a contributor runs before pushing; each becomes a checklist box.
- `ci.requiredChecks`: the project's own CI job names exactly as GitHub reports them
  (expand matrix names: `Tests (Python 3.9, ubuntu-24.04)`). `PR rules` is always added.
- `release`: see `versioning.md`. `currentVersion` is the version released today; the manifest
  starts there and release-please owns it afterwards.
