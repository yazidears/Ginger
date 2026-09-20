#!/usr/bin/env node
// Print only non-secret service settings. Run after the separate npm ci.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const {config} = require(path.join(root, 'integrations/imessage/node_modules/dotenv'));
config({path: path.join(root, '.env.local'), quiet: true});
config({path: path.join(root, 'integrations/imessage/.env'), quiet: true});
const enabled = process.env.ASHCONNECT_ENABLED === 'true' || process.env.IMESSAGE_ENABLED === 'true';
const port = Number(process.env.IMESSAGE_PORT || 4112);
const proxyPort = Number(process.env.GINGER_WEBHOOK_PROXY_PORT || 4113);
if ([port, proxyPort].some(value => !Number.isInteger(value) || value < 1024 || value > 65535) || port === proxyPort) throw new Error('Invalid messaging ports');
console.log(`${enabled ? '1' : '0'} ${port} ${proxyPort} ${enabled && process.env.GINGER_WEBHOOK_PROXY_ENABLED === 'true' ? '1' : '0'}`);
