# Versioning by release kind

The flow is the same for every kind: release-please with `release-type: simple` reads the
squash-merged titles, writes the version into each `versionFiles` entry, updates CHANGELOG.md,
and `release.yml` merges its release PR and creates the tag and the GitHub Release **as a
draft**. The `build` targets and the npm job run from the tag; the `finish` commands run
once after all of them; only then does the `publish` job make the Release public and latest.
A failed job leaves the draft, so nobody downloads or updates to an incomplete release; "Re-run
failed jobs" on that same run finishes it (a new run would release nothing). Only
three things change per kind: which files carry the version, the jobs that run from the tag
(`build` or npm), and `finish`. Prefer what the runner already has (bash, node, python,
rustup, the platform SDKs on macOS and Windows images) over extra actions.

`finish`: shell commands run from the tag after every `build` target has attached its files,
with `TAG`, `VERSION` and `GH_TOKEN` set. Use it for what needs every platform at once: an
updater manifest built from all the signatures, checksums of every file.

`sync`: shell commands run on the release pull request's branch before it is merged, for a
version repeated in more places than `versionFiles` can reach (dependency pins, lockfiles, a
manifest that embeds it in an identifier). Their changes are committed to that branch, so the
tag carries them. Use the project's own sync script; keep `versionFiles` to the one source file.

`beforePublish` / `afterPublish`: `{ "workflow": ".github/workflows/<file>.yml", "permissions":
{...} }`, a project workflow with `on: workflow_call` and the string inputs `tag` and `version`,
for a pipeline the kinds above cannot express (several registries, container images, package
managers). `beforePublish` runs while the Release is a draft and `publish` waits for it: build and
attach there. `afterPublish` runs once the Release is public: whatever downloads its files
(Homebrew, Scoop, npm postinstall, a registry entry). Both get `secrets: inherit` and only the
`permissions` listed. Check out `inputs.tag`, never the default ref: the workflow runs in the
push that started the release, before the version commit. A publish from a called workflow
counts as `release.yml` for npm and crates.io trusted publishing.

`versionFiles` entry types: `.json` → `jsonpath` (default `$.version`); `.toml` → `jsonpath`
such as `$.package.version`; `.yaml`/`.yml` → `jsonpath`; anything else → `"type": "generic"`
with a `x-release-please-version` comment on the version line (`VERSION = '1.2.0'  #
x-release-please-version`).

## claude-plugin

- `versionFiles`: `.claude-plugin/plugin.json` (`$.version`) and any file that repeats the
  version. Do not put a version in the marketplace entry: plugin.json wins and the two drift.
- Installed copies update only when plugin.json's version changes, which is why `shipped`
  must list everything the plugin installs (skills, scripts, hooks, `.claude-plugin/`).
- No build. The GitHub Release is the changelog users read.

## npm

- `versionFiles`: `package.json` (`$.version`), and `package-lock.json` twice (`$.version`
  and `$.packages[""].version`) when there is a lockfile.
- `npmPrepare`: what runs before `npm publish`, e.g. `["npm ci", "npm run build", "npm test"]`.
- The user configures the trusted publisher once on npmjs.com (package settings → Trusted
  publishing → GitHub Actions, this repository, workflow `release.yml`). No npm token is stored.
  For a package that does not exist yet, the first version is published by hand.

## desktop

- `versionFiles`: the app's manifest(s): `package.json`, `src-tauri/tauri.conf.json`
  (`$.version`), `Cargo.toml` (`$.package.version`, or `$.workspace.package.version`). Rust:
  set `"releaseType": "rust"` so Cargo.lock follows; it is the one non-generic case.
- `build`: one target per platform, each a shell command run from the tag, and the files to
  attach. Example:
  ```json
  [
    { "name": "Windows x64", "os": "windows-latest", "run": "cargo build --release --locked && cp target/release/app.exe app-$VERSION-windows-x64.exe", "artifacts": "app-*-windows-x64.exe" },
    { "name": "macOS arm64", "os": "macos-15", "run": "npm ci && npm run tauri build", "artifacts": "src-tauri/target/release/bundle/dmg/*.dmg" }
  ]
  ```
- `buildSecrets`: names of signing secrets the build reads (e.g. `TAURI_SIGNING_PRIVATE_KEY`);
  the user saves them. Give the files fixed names when an updater downloads
  `releases/latest/download/<name>`. A `run` that needs several steps calls a script of the
  project (`bash scripts/release-build.sh <target>`).
- An updater manifest (Tauri `latest.json`) goes in `finish`: download the `.sig` files from
  the draft, build the manifest, upload it. The Release turns latest only after that, so
  `releases/latest/download/latest.json` never points to a release without it.

## mobile

Not yet exercised on a real repository; review the first release by hand.

- `versionFiles`: `app.json` (`$.expo.version`), `pubspec.yaml` (`$.version`), or the
  `versionName` line of `android/app/build.gradle` and `CFBundleShortVersionString` of
  `Info.plist` with generic annotations.
- The store build number comes from the version at build time: the `build` job exports
  `VERSION_CODE = major*1000000 + minor*1000 + patch`. Pass it to the build
  (`versionCode`, `CFBundleVersion`, `--build-number`); do not keep a second counter in git.
- `build` targets produce the `.aab`/`.ipa`; submitting to the stores stays manual or a later
  addition, since it needs store credentials only the user has.

## library

Version, changelog, tag and GitHub Release, nothing published elsewhere. `versionFiles` can be
empty.
