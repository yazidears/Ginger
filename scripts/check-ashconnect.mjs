#!/usr/bin/env node
/** Read-only readiness report. No messages, model generation, or stored-state changes. */
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve, join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (args.some((arg, i) => !['--root', '--model-check'].includes(arg) && !(rootFlag >= 0 && i === rootFlag + 1)) || (rootFlag >= 0 && (!args[rootFlag + 1] || args[rootFlag + 1].startsWith('--')))) {
  console.error('Usage: node scripts/check-ashconnect.mjs [--root /absolute/runtime] [--model-check]');
  process.exit(2);
}
const root = resolve(rootFlag >= 0 ? args[rootFlag + 1] : process.cwd());
const env = {...process.env};
for (const file of ['.env.local', 'integrations/imessage/.env']) {
  try {
    for (const [key, value] of Object.entries(parseEnv(await readFile(join(root, file), 'utf8')))) env[key] ??= value;
  } catch (error) {
    if (error.code !== 'ENOENT') {console.error(`Cannot read ${file}; configuration was not reset.`); process.exit(2);}
  }
}
const present = key => !!env[key]?.trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const report = {
  checkedAt: new Date().toISOString(), root,
  transport: env.ASHCONNECT_TRANSPORT || 'imessage',
  enabled: env.ASHCONNECT_ENABLED === 'true' || env.IMESSAGE_ENABLED === 'true',
  operatorBridgeConfigured: (env.ASHCONNECT_OPERATOR_TOKEN || '').length >= 32,
  model: {provider: env.IMESSAGE_MODEL_PROVIDER || 'nebius'},
  worker: {reachable: false},
  bridge: {reachable: false},
  monitoring: {snapshotPresent: false, dataFresh: false},
  delivery: 'Not tested. A running worker or valid key does not establish phone delivery.',
};
report.model.name = env.IMESSAGE_MODEL || (report.model.provider === 'nebius' ? env.NEBIUS_MODEL : '') || null;
report.model.keyConfigured = present(report.model.provider === 'openai' ? 'OPENAI_API_KEY' : 'NEBIUS_API_KEY');
const credentials = report.transport === 'vonage' ? ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_WHATSAPP_SENDER', 'VONAGE_WEBHOOK_TOKEN']
  : report.transport === 'telegram' ? ['TELEGRAM_BOT_TOKEN']
  : ['IMESSAGE_PROJECT_ID', 'IMESSAGE_PROJECT_SECRET', 'IMESSAGE_WEBHOOK_SECRET'];
report.missingTransportSettings = credentials.filter(key => !present(key));
const snapshotDir = env.GINGER_SNAPSHOT_DIR || join(homedir(), '.cache/ginger-backend', hash(root).slice(0,16));
try {
  const data = JSON.parse(await readFile(join(snapshotDir, hash('workspace-v1') + '.json'), 'utf8'));
  const scan = data.value?.monitor?.lastScan;
  const age = Date.now() - Date.parse(scan);
  report.monitoring = {snapshotPresent: true, lastScan: scan || null, dataFresh: Number.isFinite(age) && age >= 0 && age <= 1_200_000};
} catch { /* Missing or invalid evidence remains unavailable. */ }
const port = Number(env.IMESSAGE_PORT || '4112');
if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {redirect:'error',signal:AbortSignal.timeout(3000)});
    const health = await response.json();
    report.worker = {reachable: response.ok, httpStatus: response.status, service: typeof health.service === 'string' ? health.service : null, dataFresh: health.dataFresh === true};
  } catch { /* Only connection state is reported, never upstream error text. */ }
  if (report.worker.reachable && report.operatorBridgeConfigured) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/internal/ash-connect`, {
        headers: {'x-ashconnect-token': env.ASHCONNECT_OPERATOR_TOKEN}, redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      report.bridge = {reachable: response.ok, httpStatus: response.status};
      if (response.ok) {
        const data = await response.json();
        report.bridge.channel = ['telegram','whatsapp','imessage'].includes(data.channel) ? data.channel : null;
        report.bridge.contactConfigured = typeof data.contact === 'string' && data.contact.length > 0;
      }
    } catch { /* Never echo bridge history, resident identifiers or response bodies. */ }
  }
}
if (args.includes('--model-check')) {
  if (!['openai','nebius'].includes(report.model.provider) || !report.model.keyConfigured) report.model.access = 'not configured';
  else {
    const base = report.model.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.tokenfactory.nebius.com/v1';
    try {
      const response = await fetch(`${base}/models`, {headers:{Authorization:`Bearer ${env[report.model.provider === 'openai' ? 'OPENAI_API_KEY' : 'NEBIUS_API_KEY']}`},redirect:'error',signal:AbortSignal.timeout(12000)});
      report.model.httpStatus = response.status;
      report.model.access = response.ok ? 'model list accessible; generation not tested' : 'model list rejected';
      if (response.ok) {
        const data = await response.json();
        report.model.configuredModelListed = Array.isArray(data.data) && data.data.some(model => model.id === report.model.name);
      }
    } catch {report.model.access = 'request failed';}
  }
}
console.log(JSON.stringify(report, null, 2));
