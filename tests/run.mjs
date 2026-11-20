#!/usr/bin/env node
// Tests for Nabu. Run: node tests/run.mjs
// Builds throwaway repositories of each release kind in the system temp folder, runs
// init/render/verify/audit/github on them with the gh stub (nothing reaches GitHub), and
// checks the results.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderTemplate, normalizeRules } from '../skills/nabu/scripts/nabu.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NABU = path.join(HERE, '..', 'skills', 'nabu', 'scripts', 'nabu.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nabu-test-'));
const LOG = path.join(TMP, 'gh-calls.jsonl');
const ENV = { ...process.env, NABU_GH_STUB: path.join(HERE, 'gh-stub.mjs'), NABU_GH_LOG: LOG };
const fails = [];

function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${!cond && detail ? `  (${String(detail).slice(0, 400)})` : ''}`);
  if (!cond) fails.push(name);
}

function nabu(repo, ...argv) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [NABU, ...argv, '--repo', repo], { env: ENV, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function repo(name, files) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-qm', 'feat: start');
  git('remote', 'add', 'origin', `https://github.com/nabu-test-sandbox/${name}.git`);
  return dir;
}

function answers(dir, obj) {
  const file = path.join(dir, '..', `${path.basename(dir)}-answers.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

// ---- templates
check('template: variables, flags and inverted flags', renderTemplate('a {{x}}\n{{#on}}\nyes\n{{/on}}\n{{^on}}\nno\n{{/on}}\n', { x: 1, on: true }) === 'a 1\nyes\n');
check('template: GitHub expressions are left alone', renderTemplate('${{ secrets.X }} {{y}}', { y: 2 }) === '${{ secrets.X }} 2');
let threw = false;
try { renderTemplate('{{missing}}', {}); } catch { threw = true; }
check('template: an unknown variable is an error', threw);

// ---- rules
const base = { name: 'X', repo: 'a/b', defaultBranch: 'main', purpose: 'does x.' };
check('rules: the standard overwrites branch limits', normalizeRules({ ...base, branch: { types: ['feature'], maxWords: 9 } }).rules.branch.maxWords === 5);
check('rules: a plugin must version plugin.json', normalizeRules({ ...base, release: { kind: 'claude-plugin', currentVersion: '1.0.0', versionFiles: [{ path: 'x.json' }] } }).problems.length > 0);
check('rules: measured needs methods', normalizeRules({ ...base, measured: { enabled: true } }).problems.length > 0);

// ---- each release kind end to end
const kinds = [
  ['plugin', { '.claude-plugin/plugin.json': '{"name":"p","version":"0.3.0"}\n', 'skills/p/SKILL.md': '---\nname: p\n---\n' },
    { shipped: ['skills/**', '.claude-plugin/**'], measured: { enabled: true, methods: ['evals pass rate'] },
      release: { kind: 'claude-plugin', currentVersion: '0.3.0', versionFiles: [{ path: '.claude-plugin/plugin.json', jsonpath: '$.version' }] } }],
  ['npmlib', { 'package.json': '{"name":"x","version":"1.2.0","type":"module","repository":{"url":"git+https://github.com/nabu-test-sandbox/npmlib.git"}}\n' },
    { shipped: ['src/**', 'package.json'], commands: ['npm test'], release: { kind: 'npm', currentVersion: '1.2.0', versionFiles: [{ path: 'package.json' }], npmPrepare: ['npm test'] } }],
  ['desktop', { 'Cargo.toml': '[package]\nname = "app"\nversion = "0.4.0"\n' },
    { shipped: ['src/**'], release: { kind: 'desktop', releaseType: 'rust', currentVersion: '0.4.0', versionFiles: [{ path: 'Cargo.toml', jsonpath: '$.package.version' }],
      build: [{ name: 'Windows', os: 'windows-latest', run: 'cargo build --release', artifacts: 'target/release/app.exe' }],
      buildSecrets: ['SIGNING_KEY'], finish: ['node scripts/manifest.mjs "$VERSION" > latest.json', 'gh release upload "$TAG" latest.json --clobber'] } }],
  ['pipeline', {
    'Cargo.toml': '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "2.1.0"\n',
    '.github/workflows/assets.yml': callable('assets'),
    '.github/workflows/channels.yml': callable('channels'),
    '.github/pull-request-notes.md': '## Agreement\n\nI agree to CLA.md.\n',
  }, { shipped: ['crates/**'], release: { kind: 'library', currentVersion: '2.1.0',
      versionFiles: [{ path: 'Cargo.toml', jsonpath: '$.workspace.package.version' }],
      sync: ['python3 scripts/sync_version.py .', 'cargo update --workspace'],
      beforePublish: { workflow: '.github/workflows/assets.yml', permissions: { contents: 'write', 'id-token': 'write' } },
      afterPublish: { workflow: '.github/workflows/channels.yml', permissions: { contents: 'read', packages: 'write' } } } }],
  ['site', { 'index.html': '<h1>x</h1>\n' }, { issueFirst: true, release: { kind: 'none' } }],
];

function callable(name) {
  return `name: ${name}\non:\n  workflow_call:\n    inputs:\n      tag: { type: string, required: true }\n      version: { type: string, required: true }\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
}
for (const [name, files, extra] of kinds) {
  const dir = repo(name, files);
  const a = answers(dir, { name, repo: `nabu-test-sandbox/${name}`, defaultBranch: 'main', purpose: `does ${name} things.`, ...extra });
  check(`${name}: init`, nabu(dir, 'init', '--answers', a).code === 0);
  check(`${name}: render`, nabu(dir, 'render').code === 0);
  const v = nabu(dir, 'verify');
  check(`${name}: verify passes`, v.code === 0, v.out);
  check(`${name}: render --check finds no drift`, nabu(dir, 'render', '--check').code === 0);
  const contributing = fs.readFileSync(path.join(dir, 'CONTRIBUTING.md'), 'utf8');
  check(`${name}: CONTRIBUTING asks for one change per PR`, /One change per pull request/.test(contributing));
  check(`${name}: no template tag left in any file`, !/(?<!\$)\{\{\w+\}\}/.test(contributing));
  const releaseYml = path.join(dir, '.github/workflows/release.yml');
  check(`${name}: release workflow only when it releases`, fs.existsSync(releaseYml) === (extra.release.kind !== 'none'));
  if (name === 'site') check('site: CONTRIBUTING says every change starts with an issue', /Every change starts with an issue/.test(contributing));
  if (name === 'site') {
    // Screenshots are optional, even in a repository whose rules still list visual globs.
    const { check: checkPr } = createRequire(import.meta.url)(path.join(dir, '.github/scripts/check-pr.cjs'));
    const fileRules = { ...JSON.parse(fs.readFileSync(path.join(dir, '.github/repo-rules.json'), 'utf8')), visual: ['**/*.html'] };
    const body = '## What\nA new color.\n\n## Why\nCloses #1.\n\n## How\nOne file.\n\n## Risk\nNone: one file.\n\n## Evidence\nOpened the page.\n\n## Checklist\n- [x] done';
    const got = checkPr(fileRules, { branch: 'style/new-color', title: 'style: new color', body, files: ['index.html'] });
    check('site: a visual change without a screenshot passes', got.length === 0, got.join('; '));
  }
  if (name === 'pipeline') {
    const yml = fs.readFileSync(releaseYml, 'utf8');
    const merge = yml.indexOf('gh pr merge');
    check('pipeline: sync commands run on the release PR before it is merged',
      extra.release.sync.every((c) => yml.indexOf(c) > -1 && yml.indexOf(c) < merge) && /--match-head-commit/.test(yml), yml.slice(0, 300));
    const before = yml.slice(yml.indexOf('\n  before-publish:'), yml.indexOf('\n  publish:'));
    check('pipeline: the project workflow runs from the tag before the release is public',
      /uses: \.\/\.github\/workflows\/assets\.yml/.test(before) && /tag: \$\{\{ needs\.release\.outputs\.tag \}\}/.test(before)
        && /secrets: inherit/.test(before) && /id-token: write/.test(before), before);
    const after = yml.slice(yml.indexOf('\n  after-publish:'));
    check('pipeline: the project workflow for public channels runs after publish',
      yml.includes('\n  after-publish:') && /uses: \.\/\.github\/workflows\/channels\.yml/.test(after) && /needs: \[release, publish\]/.test(after) && /packages: write/.test(after), after);
    const template = fs.readFileSync(path.join(dir, '.github/pull_request_template.md'), 'utf8');
    check('pipeline: pull-request-notes.md is appended to the PR template', /## Checklist[\s\S]*## Agreement\n\nI agree to CLA\.md\./.test(template), template.slice(-200));
    fs.writeFileSync(path.join(dir, '.github/workflows/channels.yml'), 'name: channels\non: push\njobs: {}\n');
    check('pipeline: verify fails when a project workflow cannot be called', /workflow_call/.test(nabu(dir, 'verify').out));
  }
  if (name === 'npmlib') check('npmlib: npm job with provenance', /npm publish --provenance/.test(fs.readFileSync(releaseYml, 'utf8')));
  if (extra.release.kind !== 'none') {
    // A release is a draft until everything it carries is attached, then published at once.
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'release-please-config.json'), 'utf8')).packages['.'];
    check(`${name}: release-please creates a draft with its tag`, cfg.draft === true && cfg['force-tag-creation'] === true, JSON.stringify(cfg));
    const yml = fs.readFileSync(releaseYml, 'utf8');
    const publish = yml.slice(yml.indexOf('\n  publish:'));
    check(`${name}: a publish job makes the draft public and latest`, /gh release edit "\$TAG" .*--draft=false --latest/.test(publish), publish.slice(0, 400));
    const needs = (publish.match(/needs: \[(.+)\]/) || [])[1] || '';
    const want = ['release', ...(extra.release.build ? ['build'] : []), ...(extra.release.kind === 'npm' ? ['npm'] : []), ...(extra.release.beforePublish ? ['before-publish'] : [])];
    check(`${name}: publish waits for every job that attaches or publishes`, needs === want.join(', '), needs);
    if (extra.release.finish) {
      check(`${name}: finish commands run before the release goes public`,
        extra.release.finish.every((c) => publish.indexOf(c) > -1 && publish.indexOf(c) < publish.indexOf('--draft=false')));
      check(`${name}: build secrets reach the build`, /SIGNING_KEY: \$\{\{ secrets\.SIGNING_KEY \}\}/.test(yml));
    }
  }
}
check('rules: a project workflow is a file of .github/workflows other than release.yml',
  normalizeRules({ ...base, release: { kind: 'library', currentVersion: '1.0.0', beforePublish: { workflow: '.github/workflows/release.yml' } } }).problems.length > 0);
check('rules: sync commands must be strings', normalizeRules({ ...base, release: { kind: 'library', currentVersion: '1.0.0', sync: [1] } }).problems.length > 0);
check('rules: finish commands must be strings', normalizeRules({ ...base, release: { kind: 'library', currentVersion: '1.0.0', finish: [{ run: 'x' }] } }).problems.length > 0);

// ---- verify catches what it promises to catch
const noRepo = repo('npm-no-repository', { 'package.json': '{"name":"x","version":"1.0.0"}\n' });
nabu(noRepo, 'init', '--answers', answers(noRepo, { ...base, repo: 'nabu-test-sandbox/npm-no-repository', release: { kind: 'npm', currentVersion: '1.0.0', versionFiles: [{ path: 'package.json' }] } }));
nabu(noRepo, 'render');
check('verify: npm without a repository field fails', /repository/.test(nabu(noRepo, 'verify').out));

const generic = repo('generic', { 'app.py': "VERSION = '2.0.0'\n" });
nabu(generic, 'init', '--answers', answers(generic, { ...base, repo: 'nabu-test-sandbox/generic', release: { kind: 'library', currentVersion: '2.0.0', versionFiles: [{ path: 'app.py', type: 'generic' }] } }));
nabu(generic, 'render');
check('verify: a generic version file without its annotation fails', /x-release-please-version/.test(nabu(generic, 'verify').out));

// ---- obsolete files of older setups
const old = repo('old', { 'cog.toml': 'x', '.github/workflows/pr-title.yml': 'name: x\n', '.github/scripts/check-pr.js': '//' });
nabu(old, 'init', '--answers', answers(old, { ...base, repo: 'nabu-test-sandbox/old', release: { kind: 'none' } }));
check('render --check reports obsolete files', /obsolete cog\.toml/.test(nabu(old, 'render', '--check').out));
nabu(old, 'render', '--remove-obsolete');
check('render --remove-obsolete deletes them', !fs.existsSync(path.join(old, 'cog.toml')) && !fs.existsSync(path.join(old, '.github/scripts/check-pr.js')));

// ---- GitHub, through the stub
const plugin = path.join(TMP, 'plugin');
fs.rmSync(LOG, { force: true });
const dry = nabu(plugin, 'github', '--dry-run');
const logged = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
check('github --dry-run writes nothing', !/"--method","(PATCH|PUT|POST|DELETE)"/.test(logged), logged);
check('github --dry-run lists the settings it would change', /\[dry-run\] repository settings/.test(dry.out));
check('github refuses --public without a secret scan', /scan-secrets/.test(nabu(plugin, 'github', '--public').out));
check('scan-secrets passes on a clean history', nabu(plugin, 'scan-secrets').code === 0);
const leaky = repo('leaky', { '.env': 'TOKEN=ghp_' + 'a'.repeat(36) + '\n' });
check('scan-secrets finds a token and a .env file', nabu(leaky, 'scan-secrets').code === 1);
check('github defers the ruleset until pr-rules.yml is on main', /ruleset not applied/.test(nabu(plugin, 'github', '--public').out));
check('audit lists differences from the standard', nabu(plugin, 'audit').code === 1);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
process.exit(fails.length ? 1 : 0);
