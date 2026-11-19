## Notes for this repository

- Tests and evals never reach real GitHub: `gh` goes through `tests/gh-stub.mjs` (`NABU_GH_STUB`, `NABU_GH_LOG`), and fixtures use remotes of an owner that does not exist.
- `skills/nabu/scripts/nabu.mjs` runs on Node 18+ with no dependencies.
- `skills/nabu/assets/` is the standard itself: every repository gets a change there on its next `render`. Fix a gap there, never by patching a managed file in one repository.
- `skills/nabu/assets/github/scripts/check-pr.cjs` stays CommonJS so it runs in repositories with `"type": "module"`.
- In templates `{{name}}` is a Nabu variable and `${{ ... }}` is GitHub's; variable names never contain spaces.
