#!/usr/bin/env node
// Stands in for gh in tests and evals: logs every call to NABU_GH_LOG and answers reads with a
// private repository that follows nothing yet. Writes are logged and answered with {}.
import fs from 'node:fs';
const argv = process.argv.slice(2);
let input = '';
if (argv.includes('--input')) { try { input = fs.readFileSync(0, 'utf8'); } catch {} }
if (process.env.NABU_GH_LOG) fs.appendFileSync(process.env.NABU_GH_LOG, JSON.stringify({ argv, input: input || undefined }) + '\n');
const method = (argv[argv.indexOf('--method') + 1] || 'GET').toUpperCase();
const out = (v) => { process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0); };
const visibility = process.env.NABU_GH_VISIBILITY || 'private';
if (argv[0] === 'api' && method !== 'GET' && argv.includes('--method')) out({});
if (argv[0] === 'api') {
  const ep = argv.find((a, i) => i > 0 && !a.startsWith('-') && argv[i - 1] !== '--jq' && argv[i - 1] !== '-H') || '';
  const jq = argv[argv.indexOf('--jq') + 1];
  if (/^repos\/[^/]+\/[^/]+$/.test(ep)) {
    const repo = { default_branch: 'main', visibility, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false, allow_auto_merge: false, allow_update_branch: false, squash_merge_commit_title: 'COMMIT_OR_PR_TITLE', squash_merge_commit_message: 'COMMIT_MESSAGES', has_issues: true, security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'disabled' } } };
    if (argv.includes('--jq') && jq.startsWith('{d:')) out({ d: 'main', v: visibility });
    out(repo);
  }
  if (/rulesets$/.test(ep)) out([]);
  if (/private-vulnerability-reporting$/.test(ep)) out({ enabled: false });
  if (/fork-pr-contributor-approval$/.test(ep)) out({ approval_policy: 'first_time_contributors' });
  if (/labels/.test(ep)) out([]);
  if (/check-runs/.test(ep)) out({ total_count: 0, check_runs: [] });
  if (/pulls/.test(ep)) out([]);
  process.stderr.write('gh: Not Found (HTTP 404)\n'); process.exit(1);
}
if (argv[0] === 'secret' && argv[1] === 'list') out('');
if (argv[0] === 'release' && argv[1] === 'list') out('');
if (argv[0] === 'auth') out('Logged in to github.com as sandbox-user');
out('');
