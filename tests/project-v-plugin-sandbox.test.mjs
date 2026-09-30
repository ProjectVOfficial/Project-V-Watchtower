import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelSource = await readFile(new URL('../src/components/PluginPanel.ts', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');

test('plugin iframe keeps the restricted sandbox and CSP boundary', () => {
  assert.match(panelSource, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(panelSource, /default-src 'none'/);
  assert.match(panelSource, /form-action 'none'/);
  assert.match(panelSource, /connect-src \$\{network\}/);
  assert.doesNotMatch(panelSource, /allow-same-origin/);
  assert.doesNotMatch(panelSource, /allow-top-navigation/);
  assert.doesNotMatch(panelSource, /allow-forms/);
});

test('plugin system is mounted through the Watchtower panel layout', () => {
  assert.match(layoutSource, /id="pluginManagerBtn"/);
  assert.match(layoutSource, /setupPluginSystem\(\)/);
  assert.match(layoutSource, /mountEnabledPluginPanels\(panelsGrid\)/);
  assert.match(layoutSource, /registerPluginPanel/);
});
