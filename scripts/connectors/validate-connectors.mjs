#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const connectors = JSON.parse(await readFile(path.join(root, 'connectors', 'built-in-connectors.json'), 'utf8'));
const ids = new Set();
const routings = new Set(['local-sidecar', 'direct-provider', 'project-v-gateway', 'optional-upstream']);
const outputs = new Set(['project-v-event-v1', 'project-v-metric-v1', 'project-v-asset-v1', 'project-v-headline-v1']);
const categories = new Set(['alerts', 'aviation', 'conflict', 'economics', 'energy', 'fire', 'markets', 'maritime', 'news', 'weather', 'compatibility']);
const errors = [];
for (const [index, connector] of connectors.entries()) {
  const prefix = `connector[${index}]`;
  if (connector.schemaVersion !== 1) errors.push(`${prefix}: unsupported schemaVersion`);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(connector.id || '')) errors.push(`${prefix}: invalid id`);
  if (ids.has(connector.id)) errors.push(`${prefix}: duplicate id ${connector.id}`);
  ids.add(connector.id);
  if (!connector.name) errors.push(`${prefix}: name is required`);
  if (!categories.has(connector.category)) errors.push(`${prefix}: invalid category`);
  if (!routings.has(connector.routing)) errors.push(`${prefix}: invalid routing`);
  if (!outputs.has(connector.output)) errors.push(`${prefix}: invalid output`);
  if (connector.endpoint && new URL(connector.endpoint).protocol !== 'https:') errors.push(`${prefix}: endpoint must use HTTPS`);
  if (connector.refreshSeconds && connector.refreshSeconds < 30) errors.push(`${prefix}: refreshSeconds must be at least 30`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`[connectors:validate] ${connectors.length} connector definitions passed.`);
