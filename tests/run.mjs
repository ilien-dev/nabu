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
import { renderTemplate, normalizeRules } from '../scripts/nabu.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NABU = path.join(HERE, '..', 'scripts', 'nabu.mjs');
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
    { shipped: ['src/**'], visual: ['ui/**'], release: { kind: 'desktop', releaseType: 'rust', currentVersion: '0.4.0', versionFiles: [{ path: 'Cargo.toml', jsonpath: '$.package.version' }],
      build: [{ name: 'Windows', os: 'windows-latest', run: 'cargo build --release', artifacts: 'target/release/app.exe' }] } }],
  ['site', { 'index.html': '<h1>x</h1>\n' }, { visual: ['**/*.html'], issueFirst: true, release: { kind: 'none' } }],
];
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
  if (name === 'npmlib') check('npmlib: npm job with provenance', /npm publish --provenance/.test(fs.readFileSync(releaseYml, 'utf8')));
}

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
