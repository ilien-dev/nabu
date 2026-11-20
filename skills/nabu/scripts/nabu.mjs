#!/usr/bin/env node
// Nabu: one set of collaboration rules, files and GitHub settings for
// every repository, whatever its language. Node 18+, no dependencies; git and gh on PATH.
//
//   node nabu.mjs detect       --repo <dir>                 facts about the repository (JSON)
//   node nabu.mjs init         --repo <dir> --answers <json> write .github/repo-rules.json
//   node nabu.mjs render       --repo <dir> [--check] [--remove-obsolete]
//   node nabu.mjs scan-secrets --repo <dir>                 history scan before going public
//   node nabu.mjs github       --repo <dir> [--dry-run] [--public]
//   node nabu.mjs audit        --repo <dir>                 files + GitHub against the standard
//   node nabu.mjs verify       --repo <dir>                 the setup works (self-tests)
//
// Every command prints what it did or found and exits 1 when something is wrong.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- the standard (fixed)

export const STANDARD = {
  version: 1,
  types: ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert'],
  maxWords: 5,
  titleMax: 72,
  releaseTypes: ['feat', 'fix', 'perf', 'revert'],
  measuredTypes: ['feat', 'fix', 'perf'],
  rulesetName: 'Default branch',
  ruleCheck: 'PR rules',
  forkApproval: 'first_time_contributors_new_to_github',
};
const SECTION_TITLES = {
  feat: 'Features', fix: 'Bug Fixes', perf: 'Performance', revert: 'Reverts', refactor: 'Refactoring',
  docs: 'Documentation', test: 'Tests', build: 'Build', ci: 'CI', chore: 'Chores', style: 'Style',
};
const RELEASE_KINDS = ['claude-plugin', 'npm', 'desktop', 'mobile', 'library', 'none'];
// Files earlier setups left that the standard replaces.
const OBSOLETE = [
  'cog.toml',
  '.github/workflows/pr-title.yml',
  '.github/workflows/branch-name.yml',
  '.github/rulesets/protect-main.json',
  '.github/scripts/check-pr.js',
];

// ---------------------------------------------------------------- small helpers

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

function tryRun(cmd, argv, opts) {
  try { return { ok: true, out: run(cmd, argv, opts) }; } catch (e) {
    return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message || '') };
  }
}

function git(repo, ...argv) { return run('git', ['-C', repo, ...argv]).trim(); }

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function exists(repo, rel) { return fs.existsSync(path.join(repo, rel)); }

function lf(text) { return text.replace(/\r\n/g, '\n'); }

function fail(msg) { console.error(msg); process.exit(1); }

function list(items, last = 'or') {
  const q = items.map((t) => `\`${t}\``);
  return q.length <= 1 ? q.join('') : `${q.slice(0, -1).join(', ')} ${last} ${q[q.length - 1]}`;
}

// ---------------------------------------------------------------- templates

/** {{var}}, {{#flag}}...{{/flag}}, {{^flag}}...{{/flag}}. ${{ ... }} (GitHub) is left alone. */
export function renderTemplate(tpl, ctx) {
  let out = lf(tpl);
  const block = /^[ \t]*\{\{([#^])(\w+)\}\}[ \t]*\n([\s\S]*?)^[ \t]*\{\{\/\2\}\}[ \t]*\n/m;
  const inline = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  for (const re of [block, inline]) {
    let m;
    while ((m = out.match(re))) {
      if (!(m[2] in ctx)) throw new Error(`template flag {{${m[1]}${m[2]}}} has no value`);
      const on = Boolean(ctx[m[2]]);
      out = out.slice(0, m.index) + ((m[1] === '#' ? on : !on) ? m[3] : '') + out.slice(m.index + m[0].length);
    }
  }
  return out.replace(/(?<!\$)\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in ctx)) throw new Error(`template variable {{${k}}} has no value`);
    return String(ctx[k]);
  });
}

function asset(rel) { return fs.readFileSync(path.join(ASSETS, rel), 'utf8'); }

// ---------------------------------------------------------------- rules

const RULES_PATH = '.github/repo-rules.json';

/** Fills the fixed parts of the standard and checks the project parts. */
export function normalizeRules(input) {
  const problems = [];
  const r = structuredClone(input);
  for (const k of ['name', 'repo', 'defaultBranch', 'purpose']) {
    if (typeof r[k] !== 'string' || !r[k].trim()) problems.push(`"${k}" is required`);
  }
  if (r.repo && !/^[\w.-]+\/[\w.-]+$/.test(r.repo)) problems.push('"repo" must be owner/name');
  if (r.purpose && !/[.!]$/.test(r.purpose.trim())) problems.push('"purpose" must be one sentence ending in a period');
  r.standard = STANDARD.version;
  r.branch = { types: [...STANDARD.types], maxWords: STANDARD.maxWords };
  r.title = { max: STANDARD.titleMax };
  r.releaseTypes = [...STANDARD.releaseTypes];
  r.shipped = r.shipped || [];
  delete r.visual; // screenshots are optional: no path requires one
  r.issueFirst = Boolean(r.issueFirst);
  r.commands = r.commands || [];
  r.ci = { requiredChecks: (r.ci && r.ci.requiredChecks) || [] };
  const m = r.measured || {};
  r.measured = { enabled: Boolean(m.enabled), types: [...STANDARD.measuredTypes], methods: m.methods || [] };
  if (r.measured.enabled && r.measured.methods.length === 0) problems.push('"measured.methods" must say how to measure when "measured.enabled" is true');
  const rel = r.release || { kind: 'none' };
  if (!RELEASE_KINDS.includes(rel.kind)) problems.push(`"release.kind" must be one of ${RELEASE_KINDS.join(', ')}`);
  rel.versionFiles = rel.versionFiles || [];
  rel.build = rel.build || [];
  rel.buildSecrets = rel.buildSecrets || [];
  rel.npmPrepare = rel.npmPrepare || [];
  rel.finish = rel.finish || [];
  if (rel.finish.some((c) => typeof c !== 'string' || !c.trim())) problems.push('every "release.finish" entry must be a shell command');
  if (rel.kind !== 'none') {
    if (!/^\d+\.\d+\.\d+/.test(rel.currentVersion || '')) problems.push('"release.currentVersion" must be the version released now, e.g. 0.2.0');
    if (rel.kind !== 'library' && rel.versionFiles.length === 0) problems.push('"release.versionFiles" must list the files that carry the version');
  }
  if ((rel.kind === 'desktop' || rel.kind === 'mobile') && rel.build.length === 0) problems.push(`a ${rel.kind} release needs "release.build" targets`);
  for (const b of rel.build) {
    for (const k of ['name', 'os', 'run', 'artifacts']) if (!b[k]) problems.push(`every "release.build" target needs "${k}"`);
  }
  if (rel.kind === 'claude-plugin' && !rel.versionFiles.some((f) => f.path.endsWith('plugin.json'))) {
    problems.push('a claude-plugin release must update .claude-plugin/plugin.json: installed plugins only update when its version changes');
  }
  r.release = rel;
  return { rules: r, problems };
}

function loadRules(repo) {
  const file = path.join(repo, RULES_PATH);
  if (!fs.existsSync(file)) fail(`${RULES_PATH} is missing: run "init" first.`);
  const { rules, problems } = normalizeRules(readJson(file));
  if (problems.length) fail(`${RULES_PATH} is not valid:\n- ${problems.join('\n- ')}`);
  return rules;
}

// ---------------------------------------------------------------- detect

const MANIFESTS = [
  ['.claude-plugin/plugin.json', 'claude-plugin', '$.version'],
  ['package.json', 'npm', '$.version'],
  ['Cargo.toml', 'rust', '$.package.version'],
  ['pyproject.toml', 'python', '$.project.version'],
  ['src-tauri/tauri.conf.json', 'tauri', '$.version'],
  ['app.json', 'expo', '$.expo.version'],
  ['pubspec.yaml', 'flutter', '$.version'],
  ['android/app/build.gradle', 'android', null],
  ['go.mod', 'go', null],
];

function detect(repo) {
  const facts = { repo: null, defaultBranch: null, visibility: null, manifests: [], versions: {}, ci: [], submodules: [], files: {}, tooling: [] };
  const remote = tryRun('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  if (remote.ok) {
    const m = remote.out.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/);
    if (m) facts.repo = m[1];
  }
  if (facts.repo) {
    const r = gh(['api', `repos/${facts.repo}`, '--jq', '{d: .default_branch, v: .visibility}']);
    if (r.ok) { const j = JSON.parse(r.out); facts.defaultBranch = j.d; facts.visibility = j.v; }
  }
  if (!facts.defaultBranch) {
    const h = tryRun('git', ['-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    facts.defaultBranch = h.ok ? h.out.trim().replace(/^origin\//, '') : tryRun('git', ['-C', repo, 'branch', '--show-current']).out.trim();
  }
  for (const [file, kind, jsonpath] of MANIFESTS) {
    if (!exists(repo, file)) continue;
    facts.manifests.push({ file, kind, jsonpath });
    const text = fs.readFileSync(path.join(repo, file), 'utf8');
    const v = file.endsWith('.json') ? (() => { try { const j = JSON.parse(text); return j.version || (j.expo && j.expo.version); } catch { return null; } })()
      : (text.match(/^version\s*[=:]\s*["']?([\w.+-]+)/m) || [])[1];
    if (v) facts.versions[file] = v;
  }
  const wf = path.join(repo, '.github', 'workflows');
  if (fs.existsSync(wf)) {
    for (const f of fs.readdirSync(wf).filter((x) => /\.ya?ml$/.test(x))) {
      const text = fs.readFileSync(path.join(wf, f), 'utf8');
      const jobs = [...text.matchAll(/^ {4}name:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
      facts.ci.push({ file: f, jobNames: jobs, matrix: /matrix:/.test(text) });
    }
  }
  if (exists(repo, '.gitmodules')) {
    const text = fs.readFileSync(path.join(repo, '.gitmodules'), 'utf8');
    for (const m of text.matchAll(/path\s*=\s*(.+)\n\s*url\s*=\s*(.+)/g)) facts.submodules.push({ path: m[1].trim(), url: m[2].trim() });
  }
  for (const f of ['LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'CLAUDE.md', 'AGENTS.md', RULES_PATH, 'release-please-config.json', '.release-please-manifest.json', 'CHANGELOG.md']) facts.files[f] = exists(repo, f);
  for (const f of [...OBSOLETE, 'release-please-config.json']) if (exists(repo, f)) facts.tooling.push(f);
  if (facts.repo) {
    const rel = gh(['release', 'list', '-R', facts.repo, '--limit', '1', '--json', 'tagName', '--jq', '.[0].tagName']);
    facts.latestRelease = rel.ok ? rel.out.trim() || null : null;
    const tags = tryRun('git', ['-C', repo, 'tag', '--list', 'v*', '--sort=-v:refname']);
    facts.latestTag = tags.ok ? tags.out.split('\n')[0] || null : null;
  }
  return facts;
}

// ---------------------------------------------------------------- render

function context(rules, repo) {
  const notesFile = path.join(repo, '.github', 'contributing-notes.md');
  const notes = fs.existsSync(notesFile) ? `\n## Project notes\n\n${lf(fs.readFileSync(notesFile, 'utf8')).trim()}\n` : '';
  const rel = rules.release;
  const commands = rules.commands;
  return {
    name: rules.name,
    repo: rules.repo,
    defaultBranch: rules.defaultBranch,
    purpose: rules.purpose.trim(),
    titleMax: rules.title.max,
    maxWords: rules.branch.maxWords,
    typesList: list(rules.branch.types),
    measured: rules.measured.enabled,
    measuredTypes: list(rules.measured.types),
    measuredMethods: rules.measured.methods.map((m) => `- ${m}`).join('\n'),
    issueFirst: rules.issueFirst,
    hasShipped: rules.shipped.length > 0,
    shippedList: list(rules.shipped, 'and'),
    releaseTypesList: list(rules.releaseTypes),
    commandsList: commands.length ? `\`\`\`\n${commands.join('\n')}\n\`\`\`\n\nEvery command must pass${rules.ci.requiredChecks.length ? '; CI runs them again on the pull request' : ''}.` : 'There is nothing to run locally; the PR rules check runs on the pull request.',
    releases: rel.kind !== 'none',
    checklistCommands: commands.map((c) => `- [ ] \`${c}\` passes\n`).join(''),
    notes,
    releaseSummary: 'feat: raises the minor number, fix:, perf: and revert: the patch one, and a ! after the type the major one; docs, test, ci, chore, refactor, build and style release nothing.',
    build: rel.build.length > 0,
    buildMatrix: rel.build.map((b) => [
      `          - name: ${JSON.stringify(b.name)}`,
      `            os: ${JSON.stringify(b.os)}`,
      `            run: ${JSON.stringify(b.run)}`,
      `            artifacts: ${JSON.stringify(b.artifacts)}`,
    ].join('\n')).join('\n'),
    buildSecrets: rel.buildSecrets.length ? ['        env:', ...rel.buildSecrets.map((s) => `          ${s}: \${{ secrets.${s} }}`)].join('\n') : '',
    npm: rel.kind === 'npm',
    npmPrepare: rel.npmPrepare.map((c) => `      - run: ${c}`).join('\n'),
    publishNeeds: ['release', ...(rel.build.length ? ['build'] : []), ...(rel.kind === 'npm' ? ['npm'] : [])].join(', '),
    finish: rel.finish.length > 0,
    finishSteps: ['      - name: Finish', '        shell: bash', '        run: |', ...rel.finish.map((c) => `          ${c}`)].join('\n'),
  };
}

function releasePleaseConfig(rules, bootstrapSha) {
  const rel = rules.release;
  const pkg = {
    'release-type': rel.releaseType || 'simple',
    'package-name': rules.repo.split('/')[1],
    'include-component-in-tag': false,
    'include-v-in-tag': true,
    'bump-minor-pre-major': true,
    // The Release stays a draft until release.yml has attached everything and publishes it;
    // the tag is created at once so the next run finds this release.
    draft: true,
    'force-tag-creation': true,
    'changelog-path': 'CHANGELOG.md',
    'changelog-sections': STANDARD.types.map((t) => ({ type: t, section: SECTION_TITLES[t], hidden: !rules.releaseTypes.includes(t) })),
    'extra-files': rel.versionFiles.map((f) => {
      const e = { type: f.type || (f.path.endsWith('.json') ? 'json' : f.path.endsWith('.toml') ? 'toml' : f.path.match(/\.ya?ml$/) ? 'yaml' : 'generic'), path: f.path };
      if (f.jsonpath && e.type !== 'generic') e.jsonpath = f.jsonpath;
      return e;
    }),
  };
  const cfg = { $schema: 'https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json' };
  if (bootstrapSha) cfg['bootstrap-sha'] = bootstrapSha;
  cfg.packages = { '.': pkg };
  return cfg;
}

export function ruleset(rules) {
  return {
    name: STANDARD.rulesetName,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_review_thread_resolution: false,
          allowed_merge_methods: ['squash'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: false,
          required_status_checks: [STANDARD.ruleCheck, ...rules.ci.requiredChecks].map((context) => ({ context, integration_id: 15368 })),
        },
      },
    ],
  };
}

/** Every file the standard owns, with its expected content. */
function expectedFiles(rules, repo) {
  const ctx = context(rules, repo);
  const files = new Map();
  const put = (rel, text) => files.set(rel, lf(text));
  put('.github/scripts/check-pr.cjs', asset('github/scripts/check-pr.cjs'));
  put('.github/workflows/pr-rules.yml', asset('github/workflows/pr-rules.yml'));
  put('.github/pull_request_template.md', renderTemplate(asset('github/pull_request_template.md'), ctx));
  for (const f of ['bug_report.yml', 'feature_request.yml', 'config.yml']) put(`.github/ISSUE_TEMPLATE/${f}`, renderTemplate(asset(`github/ISSUE_TEMPLATE/${f}`), ctx));
  put('.github/rulesets/default-branch.json', `${JSON.stringify(ruleset(rules), null, 2)}\n`);
  put('CONTRIBUTING.md', renderTemplate(asset('CONTRIBUTING.md'), ctx));
  put('SECURITY.md', renderTemplate(asset('SECURITY.md'), ctx));
  const skill = renderTemplate(asset('skill/SKILL.md'), ctx);
  put('.claude/skills/uncontributing/SKILL.md', skill);
  put('.agents/skills/uncontributing/SKILL.md', skill);
  if (rules.release.kind !== 'none') {
    put('.github/workflows/release.yml', renderTemplate(asset('github/workflows/release.yml'), ctx));
    put('.github/workflows/token-check.yml', asset('github/workflows/token-check.yml'));
    const current = path.join(repo, 'release-please-config.json');
    const keepSha = fs.existsSync(current) ? readJson(current)['bootstrap-sha'] : rules.release.bootstrapSha;
    put('release-please-config.json', `${JSON.stringify(releasePleaseConfig(rules, keepSha), null, 2)}\n`);
  }
  return files;
}

function render(repo, { check = false, removeObsolete = false } = {}) {
  const rules = loadRules(repo);
  const files = expectedFiles(rules, repo);
  const drift = [];
  for (const [rel, text] of files) {
    const abs = path.join(repo, rel);
    const now = fs.existsSync(abs) ? lf(fs.readFileSync(abs, 'utf8')) : null;
    if (now === text) continue;
    drift.push(`${now === null ? 'missing ' : 'differs '} ${rel}`);
    if (!check) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); }
  }
  // The manifest belongs to the release bot after the first write: never overwritten.
  if (rules.release.kind !== 'none' && !exists(repo, '.release-please-manifest.json')) {
    drift.push('missing  .release-please-manifest.json');
    if (!check) fs.writeFileSync(path.join(repo, '.release-please-manifest.json'), `${JSON.stringify({ '.': rules.release.currentVersion }, null, 2)}\n`);
  }
  for (const rel of OBSOLETE) {
    if (!exists(repo, rel)) continue;
    drift.push(`obsolete ${rel}`);
    if (!check && removeObsolete) fs.rmSync(path.join(repo, rel));
  }
  if (rules.release.kind === 'none' && exists(repo, '.github/workflows/release.yml')) drift.push('note     .github/workflows/release.yml exists but release.kind is "none"');
  return drift;
}

// ---------------------------------------------------------------- secrets

const SECRET_PATTERNS = [
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ['OpenAI or Anthropic key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['password in a URL', /[a-z]+:\/\/[^\s:/@]+:[^\s:/@]{6,}@/i],
];
const SECRET_FILES = /(^|\/)(\.env(\.[\w-]+)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|credentials\.json|\.npmrc|service-account.*\.json)$/;

function scanSecrets(repo) {
  const findings = [];
  const names = git(repo, 'log', '--all', '--name-only', '--format=').split('\n').filter(Boolean);
  for (const f of new Set(names)) if (SECRET_FILES.test(f) && !/\.example$|\.sample$/.test(f)) findings.push({ kind: 'secret-looking file', where: f });
  const patch = run('git', ['-C', repo, 'log', '--all', '-p', '--no-color', '--format=commit %H'], { maxBuffer: 1 << 30 });
  let commit = '';
  let file = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) findings.push({ kind, where: `${file} @ ${commit}` });
  }
  const head = git(repo, 'rev-parse', 'HEAD');
  const result = { head, scannedAt: new Date().toISOString(), findings };
  fs.writeFileSync(path.join(repo, '.git', 'nabu-scan.json'), JSON.stringify(result, null, 2));
  return result;
}

// ---------------------------------------------------------------- GitHub

const REPO_SETTINGS = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_update_branch: true,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
  has_issues: true,
};

// NABU_GH_STUB: a Node script that stands in for gh (tests and evals never touch GitHub).
function gh(argv, input) {
  const opts = input ? { input: JSON.stringify(input) } : {};
  const full = input ? [...argv, '--input', '-'] : argv;
  if (process.env.NABU_GH_STUB) return tryRun(process.execPath, [process.env.NABU_GH_STUB, ...full], opts);
  return tryRun('gh', full, opts);
}

function ghJson(argv) {
  const r = gh(argv);
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}

function liveRuleset(repoName) {
  const all = ghJson(['api', `repos/${repoName}/rulesets`]) || [];
  const mine = [];
  for (const s of Array.isArray(all) ? all : []) {
    const full = ghJson(['api', `repos/${repoName}/rulesets/${s.id}`]);
    if (full && full.target === 'branch' && JSON.stringify(full.conditions || {}).match(/~DEFAULT_BRANCH|refs\/heads\/(main|master)/)) mine.push(full);
  }
  return mine;
}

function normalizeRuleset(s) {
  const pick = (r) => {
    const p = { ...(r.parameters || {}) };
    if (p.required_status_checks) p.required_status_checks = p.required_status_checks.map((c) => c.context).sort();
    delete p.required_reviewers;
    delete p.require_extra_approval_for_unattributed_changes;
    return { type: r.type, p };
  };
  return JSON.stringify({
    enforcement: s.enforcement,
    bypass: (s.bypass_actors || []).map((b) => `${b.actor_type}:${b.actor_id}:${b.bypass_mode}`).sort(),
    rules: (s.rules || []).map(pick).sort((a, b) => a.type.localeCompare(b.type)),
  });
}

function githubState(rules) {
  const name = rules.repo;
  const repo = ghJson(['api', `repos/${name}`]);
  if (!repo) return { error: `cannot read ${name} with gh` };
  const sec = repo.security_and_analysis || {};
  return {
    repo,
    visibility: repo.visibility,
    settings: Object.fromEntries(Object.keys(REPO_SETTINGS).map((k) => [k, repo[k]])),
    secretScanning: sec.secret_scanning && sec.secret_scanning.status,
    pushProtection: sec.secret_scanning_push_protection && sec.secret_scanning_push_protection.status,
    vulnReporting: (ghJson(['api', `repos/${name}/private-vulnerability-reporting`]) || {}).enabled,
    forkApproval: (ghJson(['api', `repos/${name}/actions/permissions/fork-pr-contributor-approval`]) || {}).approval_policy,
    rulesets: liveRuleset(name),
    releaseToken: rules.release.kind === 'none' ? true : (gh(['secret', 'list', '-R', name, '--json', 'name', '--jq', '.[].name']).out || '').split('\n').includes('RELEASE_TOKEN'),
    labels: (ghJson(['api', `repos/${name}/labels?per_page=100`]) || []).map((l) => l.name),
  };
}

/** Required checks that GitHub has actually seen, so the ruleset never waits for a name that never reports. */
function seenChecks(rules) {
  const seen = new Set();
  const head = ghJson(['api', `repos/${rules.repo}/commits/${rules.defaultBranch}/check-runs?per_page=100`]);
  for (const c of (head && head.check_runs) || []) seen.add(c.name);
  const prs = ghJson(['api', `repos/${rules.repo}/pulls?state=all&per_page=5`]) || [];
  for (const pr of prs) {
    const runs = ghJson(['api', `repos/${rules.repo}/commits/${pr.head.sha}/check-runs?per_page=100`]);
    for (const c of (runs && runs.check_runs) || []) seen.add(c.name);
  }
  // The standard pr-rules.yml must already be on the default branch: pull_request_target runs
  // the base branch's copy, so an older one would never report "PR rules" and block every PR.
  const live = gh(['api', `repos/${rules.repo}/contents/.github/workflows/pr-rules.yml?ref=${rules.defaultBranch}`, '-H', 'Accept: application/vnd.github.raw']);
  const onDefault = live.ok && lf(live.out) === lf(asset('github/workflows/pr-rules.yml'));
  return { seen, onDefault };
}

function applyGithub(repoDir, { dryRun = false, makePublic = false } = {}) {
  const rules = loadRules(repoDir);
  const state = githubState(rules);
  if (state.error) fail(state.error);
  const name = rules.repo;
  const done = [];
  const todo = [];
  const call = (label, argv, input) => {
    if (dryRun) { console.log(`[dry-run] ${label}: gh ${argv.join(' ')}${input ? ` <<< ${JSON.stringify(input)}` : ''}`); return true; }
    const r = gh(argv, input);
    if (r.ok) done.push(label); else todo.push(`${label} failed: ${(r.err || r.out).trim().split('\n')[0]}`);
    return r.ok;
  };

  let visibility = state.visibility;
  if (visibility !== 'public') {
    if (!makePublic) {
      todo.push('the repository is private: rulesets, secret scanning and push protection need it public (run again with --public)');
    } else {
      const scanFile = path.join(repoDir, '.git', 'nabu-scan.json');
      const scan = fs.existsSync(scanFile) ? readJson(scanFile) : null;
      const head = git(repoDir, 'rev-parse', 'HEAD');
      if (!scan || scan.head !== head) fail('Run "scan-secrets" on the current HEAD before making the repository public.');
      if (scan.findings.length) fail(`"scan-secrets" found ${scan.findings.length} possible secret(s); clean the history or confirm each one is not a secret first.`);
      if (call('make the repository public', ['repo', 'edit', name, '--visibility', 'public', '--accept-visibility-change-consequences'])) visibility = 'public';
    }
  }

  const settings = Object.fromEntries(Object.entries(REPO_SETTINGS).filter(([k, v]) => state.settings[k] !== v));
  if (Object.keys(settings).length) call(`repository settings (${Object.keys(settings).join(', ')})`, ['api', '--method', 'PATCH', `repos/${name}`], settings);
  if (visibility === 'public' && (state.secretScanning !== 'enabled' || state.pushProtection !== 'enabled')) {
    call('secret scanning and push protection', ['api', '--method', 'PATCH', `repos/${name}`], {
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    });
  }
  if (state.vulnReporting !== true) call('private vulnerability reporting', ['api', '--method', 'PUT', `repos/${name}/private-vulnerability-reporting`]);
  if (state.forkApproval !== STANDARD.forkApproval) {
    call('fork PR workflows run without approval except for brand-new GitHub accounts', ['api', '--method', 'PUT', `repos/${name}/actions/permissions/fork-pr-contributor-approval`], { approval_policy: STANDARD.forkApproval });
  }
  if (rules.issueFirst && !state.labels.includes('accepted')) call('label "accepted"', ['label', 'create', 'accepted', '-R', name, '--color', '0e8a16', '--description', 'The maintainer accepted this issue; a pull request can follow']);

  if (visibility === 'public') {
    const { seen, onDefault } = seenChecks(rules);
    const missing = rules.ci.requiredChecks.filter((c) => !seen.has(c));
    if (!onDefault) todo.push(`ruleset not applied: .github/workflows/pr-rules.yml is not on ${rules.defaultBranch} yet. Merge the setup PR (admin merge), then run "github" again`);
    else if (missing.length) todo.push(`ruleset not applied: GitHub has never reported the check(s) ${missing.map((m) => `"${m}"`).join(', ')}; fix ci.requiredChecks to the exact names of a real run`);
    else {
      const want = ruleset(rules);
      const live = state.rulesets;
      if (live.length === 0) call('ruleset of the default branch', ['api', '--method', 'POST', `repos/${name}/rulesets`], want);
      else {
        if (normalizeRuleset(live[0]) !== normalizeRuleset(want) || live[0].name !== want.name) call(`ruleset "${live[0].name}" updated to the standard`, ['api', '--method', 'PUT', `repos/${name}/rulesets/${live[0].id}`], want);
        for (const extra of live.slice(1)) call(`extra ruleset "${extra.name}" on the default branch removed`, ['api', '--method', 'DELETE', `repos/${name}/rulesets/${extra.id}`]);
      }
    }
  }
  if (!state.releaseToken) todo.push('RELEASE_TOKEN secret is missing: the user creates a fine-grained token (this repository; Contents and Pull requests: read and write) and saves it with `gh secret set RELEASE_TOKEN -R ' + name + '`');
  return { done, todo };
}

// ---------------------------------------------------------------- audit

function audit(repoDir) {
  const report = [];
  const rules = loadRules(repoDir);
  for (const d of render(repoDir, { check: true })) report.push(`file     ${d}`);
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    if (!exists(repoDir, f)) { report.push(`agents   ${f} is missing (it must point to CONTRIBUTING.md and the uncontributing skill)`); continue; }
    const t = fs.readFileSync(path.join(repoDir, f), 'utf8');
    if (!/uncontributing/.test(t)) report.push(`agents   ${f} does not point to the uncontributing skill`);
    if (/feature\//.test(t)) report.push(`agents   ${f} still names feature/ branches`);
  }
  if (exists(repoDir, 'CLAUDE.md') && exists(repoDir, 'AGENTS.md') && lf(fs.readFileSync(path.join(repoDir, 'CLAUDE.md'), 'utf8')) !== lf(fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8'))) report.push('agents   CLAUDE.md and AGENTS.md differ');
  if (!exists(repoDir, 'LICENSE')) report.push('file     LICENSE is missing (ask the user which license; never pick one for them)');
  const state = githubState(rules);
  if (state.error) report.push(`github   ${state.error}`);
  else {
    if (state.visibility !== 'public') report.push('github   repository is not public');
    for (const [k, v] of Object.entries(REPO_SETTINGS)) if (state.settings[k] !== v) report.push(`github   setting ${k} is ${JSON.stringify(state.settings[k])}, expected ${JSON.stringify(v)}`);
    if (state.visibility === 'public' && state.secretScanning !== 'enabled') report.push('github   secret scanning is off');
    if (state.visibility === 'public' && state.pushProtection !== 'enabled') report.push('github   push protection is off');
    if (state.vulnReporting !== true) report.push('github   private vulnerability reporting is off');
    if (state.forkApproval !== STANDARD.forkApproval) report.push(`github   fork PR approval is ${state.forkApproval}, expected ${STANDARD.forkApproval}`);
    const want = normalizeRuleset(ruleset(rules));
    if (state.rulesets.length === 0) report.push('github   no ruleset protects the default branch');
    else {
      if (normalizeRuleset(state.rulesets[0]) !== want) report.push(`github   ruleset "${state.rulesets[0].name}" differs from the standard`);
      if (state.rulesets.length > 1) report.push(`github   ${state.rulesets.length} rulesets protect the default branch; the standard has one`);
    }
    if (!state.releaseToken) report.push('github   RELEASE_TOKEN secret is missing');
  }
  return report;
}

// ---------------------------------------------------------------- verify

function verify(repoDir) {
  const problems = [];
  const rules = loadRules(repoDir);
  const checker = path.join(repoDir, '.github/scripts/check-pr.cjs');
  if (!fs.existsSync(checker)) return ['.github/scripts/check-pr.cjs is missing: run "render"'];
  const { check, exempt } = require(checker);
  const fileRules = readJson(path.join(repoDir, RULES_PATH));
  const sample = (over = {}) => {
    const s = { What: 'Adds one thing.', Why: 'Closes #1.', How: 'Changes one file.', Risk: 'None: one file.', Evidence: '![shot](https://github.com/user-attachments/assets/x) tests pass.', Checklist: '- [x] done' };
    if (rules.measured.enabled) s.Measurement = 'Pass rate 14/18 -> 17/18.';
    Object.assign(s, over);
    return Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `## ${k}\n${v}`).join('\n\n');
  };
  // A path that matches a glob: ** becomes a/, * becomes x, a trailing / gets a file.
  const sampleFor = (glob) => glob.replace(/\*\*\//g, 'a/').replace(/\*\*/g, 'a/x.txt').replace(/\*/g, 'x').replace(/\?/g, 'x').replace(/\/$/, '/x.txt');
  const shippedFile = rules.shipped.length ? sampleFor(rules.shipped[0]) : null;
  const cases = [
    ['a valid PR passes', { branch: 'feat/export-cover-image', title: 'feat: export the cover image', body: sample(), files: ['README.md'] }, true],
    ['five words pass', { branch: 'fix/one-two-three-four-five', title: 'fix: a', body: sample(), files: [] }, true],
    ['six words fail', { branch: 'fix/one-two-three-four-five-six', title: 'fix: a', body: sample(), files: [] }, false],
    ['feature/ fails', { branch: 'feature/export-cover', title: 'feat: a', body: sample(), files: [] }, false],
    ['uppercase fails', { branch: 'feat/Export', title: 'feat: a', body: sample(), files: [] }, false],
    ['branch and title types must match', { branch: 'fix/export-cover', title: 'feat: a', body: sample(), files: [] }, false],
    ['a non-conventional title fails', { branch: 'feat/export-cover', title: 'Export the cover', body: sample(), files: [] }, false],
    ['a missing section fails', { branch: 'feat/export-cover', title: 'feat: a', body: sample({ Risk: null }), files: [] }, false],
    ['an unticked box fails', { branch: 'feat/export-cover', title: 'feat: a', body: sample({ Checklist: '- [ ] done' }), files: [] }, false],
  ];
  if (shippedFile) {
    cases.push(['docs on shipped files fails', { branch: 'docs/reword-skill', title: 'docs: reword', body: sample(), files: [shippedFile] }, false]);
    cases.push(['fix on shipped files passes', { branch: 'fix/reword-skill', title: 'fix: reword', body: sample(), files: [shippedFile] }, true]);
    if (rules.measured.enabled) cases.push(['feat on shipped files without numbers fails', { branch: 'feat/new-check', title: 'feat: new check', body: sample({ Measurement: 'Not applicable: small.' }), files: [shippedFile] }, false]);
  }
  if (rules.issueFirst) cases.push(['no linked issue fails', { branch: 'fix/typo-home', title: 'fix: typo', body: sample({ Why: 'A typo.' }), files: [] }, false]);
  for (const [label, input, shouldPass] of cases) {
    const got = check(fileRules, input);
    if ((got.length === 0) !== shouldPass) problems.push(`check-pr: "${label}" ${shouldPass ? 'was rejected' : 'was accepted'}${got.length ? `: ${got[0]}` : ''}`);
  }
  if (!exempt(fileRules, { branch: 'release-please--branches--main', author: 'x' })) problems.push('check-pr: the release pull request is not exempt');
  const template = fs.readFileSync(path.join(repoDir, '.github/pull_request_template.md'), 'utf8');
  if (check(fileRules, { branch: 'feat/a', title: 'feat: a', body: template, files: [] }).length === 0) problems.push('check-pr: the empty template passes');

  // Workflow job names against the ruleset, so no required check waits for a name nobody reports.
  const rs = readJson(path.join(repoDir, '.github/rulesets/default-branch.json'));
  const required = rs.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
  const wfDir = path.join(repoDir, '.github/workflows');
  const names = new Set();
  for (const f of fs.readdirSync(wfDir)) {
    const text = fs.readFileSync(path.join(wfDir, f), 'utf8');
    for (const m of text.matchAll(/^ {4}name:\s*(.+)$/gm)) names.add(m[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  for (const c of required) {
    if (names.has(c)) continue;
    const viaMatrix = [...names].some((n) => n.includes('${{') && new RegExp(`^${n.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace(/\$\{\{[^}]*\}\}/g, '.+')}$`).test(c));
    if (!viaMatrix) problems.push(`ruleset requires "${c}" but no workflow job has that name`);
  }

  if (rules.release.kind !== 'none') {
    const manifestFile = path.join(repoDir, '.release-please-manifest.json');
    const version = fs.existsSync(manifestFile) ? readJson(manifestFile)['.'] : null;
    if (!version) problems.push('.release-please-manifest.json has no version');
    for (const f of rules.release.versionFiles) {
      const abs = path.join(repoDir, f.path);
      if (!fs.existsSync(abs)) { problems.push(`version file ${f.path} does not exist`); continue; }
      const text = fs.readFileSync(abs, 'utf8');
      if (f.type === 'generic') { if (!/x-release-please-(version|start-version)/.test(text)) problems.push(`${f.path} has no x-release-please-version annotation`); continue; }
      if (version && !text.includes(version)) problems.push(`${f.path} does not carry the manifest version ${version}`);
    }
  }
  // npm provenance refuses a package whose repository.url is not the repository that publishes it.
  if (rules.release.kind === 'npm') {
    const pkg = exists(repoDir, 'package.json') ? readJson(path.join(repoDir, 'package.json')) : {};
    const url = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository || {}).url || '';
    if (!url.toLowerCase().includes(rules.repo.toLowerCase())) problems.push(`package.json "repository" must point to https://github.com/${rules.repo} for npm provenance (it is "${url}")`);
  }
  for (const f of ['.claude/skills/uncontributing/SKILL.md', '.agents/skills/uncontributing/SKILL.md']) {
    if (!exists(repoDir, f)) problems.push(`${f} is missing`);
  }
  if (exists(repoDir, '.claude/skills/uncontributing/SKILL.md') && /disable-model-invocation:\s*true/.test(fs.readFileSync(path.join(repoDir, '.claude/skills/uncontributing/SKILL.md'), 'utf8'))) {
    problems.push('the uncontributing skill must stay model-invocable');
  }
  return problems;
}

// ---------------------------------------------------------------- main

function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const repo = path.resolve(a.repo || '.');
  if (!fs.existsSync(path.join(repo, '.git'))) fail(`${repo} is not a git repository.`);
  switch (cmd) {
    case 'detect':
      console.log(JSON.stringify(detect(repo), null, 2));
      break;
    case 'init': {
      if (!a.answers) fail('init needs --answers <file.json>');
      const { rules, problems } = normalizeRules(readJson(a.answers));
      if (problems.length) fail(`The answers are not complete:\n- ${problems.join('\n- ')}`);
      if (rules.release.kind !== 'none' && !exists(repo, 'release-please-config.json') && !rules.release.bootstrapSha) {
        rules.release.bootstrapSha = git(repo, 'rev-parse', 'HEAD');
      }
      fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
      fs.writeFileSync(path.join(repo, RULES_PATH), `${JSON.stringify(rules, null, 2)}\n`);
      console.log(`Wrote ${RULES_PATH}.`);
      break;
    }
    case 'render': {
      const drift = render(repo, { check: Boolean(a.check), removeObsolete: Boolean(a['remove-obsolete']) });
      if (!drift.length) console.log('Every managed file follows the standard.');
      else console.log(`${a.check ? 'Differs from the standard' : 'Written'}:\n${drift.map((d) => `  ${d}`).join('\n')}`);
      if (a.check && drift.some((d) => !d.startsWith('note'))) process.exit(1);
      break;
    }
    case 'scan-secrets': {
      const r = scanSecrets(repo);
      if (!r.findings.length) console.log(`No secrets found in the history (HEAD ${r.head.slice(0, 12)}).`);
      else {
        console.log(`${r.findings.length} possible secret(s) in the history:`);
        for (const f of r.findings.slice(0, 50)) console.log(`  ${f.kind}: ${f.where}`);
        process.exit(1);
      }
      break;
    }
    case 'github': {
      const { done, todo } = applyGithub(repo, { dryRun: Boolean(a['dry-run']), makePublic: Boolean(a.public) });
      for (const d of done) console.log(`done     ${d}`);
      for (const t of todo) console.log(`pending  ${t}`);
      if (!done.length && !todo.length && !a['dry-run']) console.log('GitHub already follows the standard.');
      if (todo.length) process.exit(1);
      break;
    }
    case 'audit': {
      const report = audit(repo);
      if (!report.length) console.log('The repository follows the standard.');
      else { console.log(`${report.length} difference(s) from the standard:`); for (const r of report) console.log(`  ${r}`); process.exit(1); }
      break;
    }
    case 'verify': {
      const problems = verify(repo);
      if (!problems.length) console.log('The setup works: every self-test passed.');
      else { for (const p of problems) console.log(`FAIL  ${p}`); process.exit(1); }
      break;
    }
    default:
      fail('Commands: detect, init, render, scan-secrets, github, audit, verify. See the header of this file.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
