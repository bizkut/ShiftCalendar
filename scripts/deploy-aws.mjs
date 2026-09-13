#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const region = 'ap-southeast-5';
const profile = process.env.SHIFTCALENDAR_AWS_PROFILE || 'shiftcalendar';
const stack = process.env.SHIFTCALENDAR_STACK || 'shiftcalendar';
const command = process.argv[2] || 'prepare';
const deploymentDir = resolve(root, '.deployment');
mkdirSync(deploymentDir, { recursive: true });
if (!/^[a-z][a-z0-9-]{0,31}$/.test(stack)) throw new Error('Stack name must be lowercase, start with a letter, and contain at most 32 letters/digits/hyphens.');

function run(program, args, options = {}) {
  const result = spawnSync('rtk', ['proxy', program, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, AWS_PAGER: '', SAM_CLI_TELEMETRY: '0', ...options.env },
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || program + ' failed');
  return result.stdout;
}

function aws(args) {
  return JSON.parse(run('aws', [...args, '--profile', profile, '--region', region, '--output', 'json'], { capture: true }) || '{}');
}

function outputs(name) {
  return Object.fromEntries(aws(['cloudformation', 'describe-stacks', '--stack-name', name]).Stacks[0].Outputs.map(x => [x.OutputKey, x.OutputValue]));
}

async function applyStack(name, template, iam = false) {
  let previous;
  try { previous = aws(['cloudformation', 'describe-stacks', '--stack-name', name]).Stacks[0]; }
  catch (error) { if (!String(error).includes('does not exist')) throw error; }
  const type = !previous || previous.StackStatus === 'REVIEW_IN_PROGRESS' ? 'CREATE' : 'UPDATE';
  if (previous && !['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'REVIEW_IN_PROGRESS'].includes(previous.StackStatus)) {
    throw new Error('Resolve stack status before deploying: ' + previous.StackStatus);
  }
  const change = 'shiftcalendar-' + Date.now();
  const created = aws(['cloudformation', 'create-change-set', '--stack-name', name,
    '--change-set-name', change, '--change-set-type', type, '--template-body', 'file://' + resolve(root, template),
    ...(iam ? ['--capabilities', 'CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND'] : []),
    '--tags', 'Key=Application,Value=ShiftCalendar', 'Key=Environment,Value=pilot']);
  let plan;
  for (let attempt = 0; attempt < 120; attempt++) {
    plan = aws(['cloudformation', 'describe-change-set', '--change-set-name', created.Id]);
    if (['CREATE_COMPLETE', 'FAILED'].includes(plan.Status)) break;
    await delay(5000);
  }
  writeFileSync(resolve(deploymentDir, name + '-changes.json'), JSON.stringify(plan, null, 2));
  const events = aws(['cloudformation', 'describe-events', '--change-set-name', created.Id]);
  writeFileSync(resolve(deploymentDir, name + '-validation.json'), JSON.stringify(events, null, 2));
  const problems = events.OperationEvents?.filter(x => x.EventType === 'VALIDATION_ERROR' && x.ValidationStatus === 'FAILED') || [];
  if (problems.length) {
    throw new Error('CloudFormation validation needs review; see .deployment/' + name + '-validation.json');
  }
  if (plan.Status === 'FAILED' && /didn.t contain changes|No updates/i.test(plan.StatusReason)) {
    console.log(name + ': no infrastructure changes');
    return;
  }
  if (plan.Status !== 'CREATE_COMPLETE') throw new Error('Change set failed: ' + (plan.StatusReason || plan.Status));
  const replacements = plan.Changes?.filter(x => x.ResourceChange?.Replacement === 'True' || x.ResourceChange?.Replacement === 'Conditional');
  if (replacements?.length) throw new Error('Resource replacements require review in .deployment/' + name + '-changes.json');
  console.log(name + ': validation passed; applying ' + plan.Changes.length + ' resource changes');
  aws(['cloudformation', 'execute-change-set', '--change-set-name', created.Id]);
  for (let attempt = 0; attempt < 180; attempt++) {
    const current = aws(['cloudformation', 'describe-stacks', '--stack-name', name]).Stacks[0];
    if (['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(current.StackStatus)) return;
    if (!current.StackStatus.endsWith('_IN_PROGRESS')) {
      const failed = aws(['cloudformation', 'describe-events', '--stack-name', name]);
      writeFileSync(resolve(deploymentDir, name + '-failure.json'), JSON.stringify(failed, null, 2));
      throw new Error('Deployment stopped: ' + current.StackStatus);
    }
    if (attempt % 3 === 0) console.log(name + ': ' + current.StackStatus);
    await delay(10000);
  }
  throw new Error('Deployment still running; inspect the CloudFormation stack before retrying.');
}

function prepare() {
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'test:pilot']);
  run('npm', ['--prefix', 'backend', 'run', 'typecheck']);
  run('npm', ['--prefix', 'backend', 'test']);
  run('npm', ['--prefix', 'backend', 'run', 'build']);
  run('cfn-lint', ['infrastructure/bootstrap.yaml', 'infrastructure/template.yaml', '--regions', region]);
  run('cfn-guard', ['validate', '--rules', 'infrastructure/pilot.guard', '--data',
    'infrastructure/template.yaml', 'infrastructure/bootstrap.yaml', '--output-format', 'json']);
}

function buildWeb(config = {}) {
  // Expo's cached transforms can retain a previous preview's public environment.
  run('npm', ['run', 'build:web', '--', '--clear'], { env: { ...process.env, CI: '1', ...config } });
}

async function deploy() {
  prepare();
  // This command creates resources and may incur S3/API charges. See DEPLOYMENT.md.
  aws(['sts', 'get-caller-identity']);
  await applyStack(stack + '-artifacts', 'infrastructure/bootstrap.yaml');
  const artifactBucket = outputs(stack + '-artifacts').ArtifactBucket;
  run('sam', ['package', '--template-file', 'infrastructure/template.yaml', '--s3-bucket', artifactBucket,
    '--s3-prefix', 'lambda', '--output-template-file', '.deployment/packaged.yaml',
    '--region', region, '--profile', profile]);
  await applyStack(stack, '.deployment/packaged.yaml', true);
  const deployed = outputs(stack);
  writeFileSync(resolve(deploymentDir, 'outputs.json'), JSON.stringify(deployed, null, 2));
  const config = {
    EXPO_PUBLIC_API_URL: deployed.ApiUrl,
    EXPO_PUBLIC_COGNITO_DOMAIN: deployed.CognitoDomain,
    EXPO_PUBLIC_USER_POOL_ID: deployed.UserPoolId,
    EXPO_PUBLIC_WEB_CLIENT_ID: deployed.WebClientId,
    EXPO_PUBLIC_NATIVE_CLIENT_ID: deployed.NativeClientId,
    EXPO_PUBLIC_WEB_URL: deployed.WebUrl,
  };
  writeFileSync(resolve(deploymentDir, 'public.env'), Object.entries(config).map(([key, value]) => key + '=' + value).join('\n') + '\n');
  buildWeb(config);
  // Publish immutable assets before HTML; retain prior assets so already-open clients keep working.
  run('aws', ['s3', 'sync', 'dist/', 's3://' + deployed.WebBucketName + '/', '--exclude', 'index.html',
    '--exclude', 'metadata.json', '--cache-control', 'public,max-age=31536000,immutable',
    '--profile', profile, '--region', region]);
  run('aws', ['s3', 'cp', 'dist/index.html', 's3://' + deployed.WebBucketName + '/index.html',
    '--content-type', 'text/html', '--cache-control', 'public,max-age=0,must-revalidate',
    '--profile', profile, '--region', region]);
  const invalidation = aws(['cloudfront', 'create-invalidation', '--distribution-id', deployed.DistributionId,
    '--paths', '/index.html']);
  writeFileSync(resolve(deploymentDir, 'invalidation.json'), JSON.stringify(invalidation, null, 2));
  console.log('Published: ' + deployed.WebUrl + ' (CloudFront invalidation may take a few minutes)');
  console.log('Run the live smoke checks in DEPLOYMENT.md before inviting the pilot teams.');
}

if (command === 'prepare') {
  prepare();
  buildWeb();
  console.log('Local validation complete. No AWS resources created. Review costs in DEPLOYMENT.md before deploy.');
} else if (command === 'deploy') {
  await deploy();
} else {
  throw new Error('Usage: node scripts/deploy-aws.mjs [prepare|deploy]');
}
