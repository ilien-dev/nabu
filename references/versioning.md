# Versioning by release kind

The flow is the same for every kind: release-please with `release-type: simple` reads the
squash-merged titles, writes the version into each `versionFiles` entry, updates CHANGELOG.md,
and `release.yml` merges its release PR and publishes the tag and GitHub Release. Only two
things change per kind: which files carry the version, and what runs after the release
(`build` targets or the npm job). Prefer what the runner already has (bash, node, python,
rustup, the platform SDKs on macOS and Windows images) over extra actions.

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
  `releases/latest/download/<name>`.

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
