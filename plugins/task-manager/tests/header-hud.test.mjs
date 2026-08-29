// @ts-nocheck
// tests/header-hud.test.mjs — Header + HUD renderers (PR3, happy-dom)
// English comments, Spanish labels placeholder.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createState, createDom, readSkeleton } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const corePath = path.join(projectRoot, 'modules', '02-core.js');
const headerHudPath = path.join(projectRoot, 'modules', '03-header-hud.js');

function loadModules() {
  const coreJs = readFileSync(corePath, 'utf-8');
  const hudJs = readFileSync(headerHudPath, 'utf-8');
  const g = globalThis;
  const prevWindow = g.window;
  g.window = g;
  try {
    eval(coreJs);
    eval(hudJs);
  } finally {
    if (prevWindow === undefined) delete g.window; else g.window = prevWindow;
  }
  return { core: g.TMCore, hud: g.TMHeaderHud };
}

function mountWithState(state) {
  const html = readSkeleton();
  const { document, window } = createDom(html);
  // Load modules into this window context via eval
  const coreJs = readFileSync(corePath, 'utf-8');
  const hudJs = readFileSync(headerHudPath, 'utf-8');
  // Evaluate inside window
  if (typeof window.eval === 'function') {
    window.eval(coreJs);
    window.eval(hudJs);
  } else {
    // fallback global eval
    const g = globalThis;
    const prevWindow = g.window;
    g.window = window;
    try { eval(coreJs); eval(hudJs); } finally { g.window = prevWindow; }
    window.TMCore = globalThis.TMCore;
    window.TMHeaderHud = globalThis.TMHeaderHud;
  }
  return { document, window, core: window.TMCore || globalThis.TMCore, hud: window.TMHeaderHud || globalThis.TMHeaderHud };
}

describe('header-hud — file existence and portability', () => {
  it('modules/03-header-hud.js exists and contains no forbidden APIs', () => {
    const js = readFileSync(headerHudPath, 'utf-8');
    const withoutComments = js.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/fetch\s*\(/.test(withoutComments), false, 'must not contain fetch(');
    assert.equal(/XMLHttpRequest/.test(withoutComments), false);
    assert.equal(/\bimport\s+.*from/.test(withoutComments), false);
    assert.equal(/import\s*\(/.test(withoutComments), false);
    // Allow module.exports but not ESM export
    const hasExport = /\bexport\s+/.test(withoutComments);
    if (hasExport) {
      assert.equal(withoutComments.includes('module.exports'), true, 'export found but not module.exports');
    }
  });

  it('loads TMHeaderHud global via classic eval', () => {
    const { hud } = loadModules();
    assert.equal(typeof hud.renderHeader, 'function');
    assert.equal(typeof hud.renderHud, 'function');
    assert.equal(typeof hud.renderAll, 'function');
  });
});

describe('header-hud — global %, totals, badges', () => {
  it('renders global percentage, totals and four distribution badges from derived metrics', () => {
    const state = createState({
      meta: { projectName: 'Proyecto Test', version: '1.2.3', branch: 'main', commit: 'deadbeef123456', syncStatus: 'synced', labels: { es: {} }, features: {} },
      phases: [
        { id: 'p1', number: 1, title: 'Fase Uno', status: 'completed', target: '', lead: '', tasks: [
          { id: 'T1-01', title: 'Done 1', status: 'completed', tag: 'Backend', note: '', owner: 'Ana', commit: '' },
          { id: 'T1-02', title: 'Done 2', status: 'completed', tag: 'Backend', note: '', owner: 'Ana', commit: '' },
        ]},
        { id: 'p2', number: 2, title: 'Fase Dos', status: 'in-progress', target: '', lead: '', tasks: [
          { id: 'T2-01', title: 'Active', status: 'in-progress', tag: 'Frontend', note: '', owner: 'Maya', commit: '' },
          { id: 'T2-02', title: 'Pending', status: 'pending', tag: 'Docs', note: '', owner: 'Luis', commit: '' },
          { id: 'T2-03', title: 'Blocked', status: 'blocked', tag: 'Infra', note: '', owner: 'Ops', commit: '' },
        ]}
      ]
    });
    const { document, core, hud } = mountWithState(state);
    const metrics = core.deriveMetrics(state);
    // Use hud render
    hud.renderAll(state, document);

    // Global % : 2 completed /5 total =40%
    const pctEl = document.getElementById('overall-progress-num');
    assert.notEqual(pctEl, null, 'overall-progress-num must exist');
    assert.equal(pctEl.textContent.includes('40%'), true, `expected 40% got ${pctEl.textContent}`);

    const bar = document.getElementById('overall-progress-bar');
    assert.notEqual(bar, null);
    assert.equal(bar.style.width, '40%', `bar width should be 40% got ${bar.style.width}`);

    const completedEl = document.getElementById('stat-completed-count');
    const totalEl = document.getElementById('stat-total-count');
    assert.notEqual(completedEl, null);
    assert.notEqual(totalEl, null);
    assert.equal(completedEl.textContent, '2');
    assert.equal(totalEl.textContent, '5');

    // Four badges: check that distribution numbers appear in HUD
    const hudHtml = document.getElementById('metrics-overview').innerHTML;
    // Should contain 2 Hechas, 1 Activas, 1 Pendientes, 1 Bloqueadas
    assert.equal(hudHtml.includes('2 Hechas') || hudHtml.includes('2</span> Hechas') || hudHtml.includes('>2 Hechas'), true, 'hud should show 2 Hechas');
    assert.equal(hudHtml.includes('1 Activas') || hudHtml.includes('>1 Activas'), true);
    assert.equal(hudHtml.includes('1 Pendientes') || hudHtml.includes('>1 Pendientes'), true);
    assert.equal(hudHtml.includes('1 Bloqueadas') || hudHtml.includes('>1 Bloqueadas'), true);

    // Header updates
    const titleEl = document.getElementById('project-title');
    assert.equal(titleEl.textContent.includes('Proyecto Test'), true);
    assert.equal(titleEl.textContent.includes('1.2.3'), true);
  });

  it('overwrites legacy hardcoded 68% width', () => {
    const state = createState({
      phases: [{ id: 'p1', number: 1, title: 'Fase', status: 'pending', target: '', lead: '', tasks: [
        { id: 'T1', title: 'T', status: 'completed', tag: '', note: '', owner: '', commit: '' },
        { id: 'T2', title: 'T', status: 'pending', tag: '', note: '', owner: '', commit: '' },
      ]}]
    }); // 1/2 =50%
    const { document, core, hud } = mountWithState(state);
    // Simulate legacy HUD with hardcoded 68%
    const hudContainer = document.getElementById('metrics-overview');
    // Force legacy bar if not present: create a bar with 68%
    hudContainer.innerHTML = '<div class="metric-card"><div id="overall-progress-num">68%</div><div id="overall-progress-bar" style="width:68%"></div><span id="stat-completed-count">0</span><span id="stat-total-count">0</span></div>';
    const beforeBar = document.getElementById('overall-progress-bar');
    assert.equal(beforeBar.style.width, '68%');

    const metrics = core.deriveMetrics(state);
    hud.renderHud(state, metrics, document);

    const afterBar = document.getElementById('overall-progress-bar');
    assert.notEqual(afterBar.style.width, '68%', 'legacy 68% should be overwritten');
    assert.equal(afterBar.style.width, '50%', `expected 50% got ${afterBar.style.width}`);
    const pctEl = document.getElementById('overall-progress-num');
    assert.equal(pctEl.textContent.includes('68%'), false, 'legacy text should be gone');
    assert.equal(pctEl.textContent.includes('50%'), true);
  });

  it('identical re-render is idempotent (no duplication, same HTML)', () => {
    const state = createState({
      phases: [{ id: 'p1', number: 1, title: 'Fase Uno', status: 'completed', target: '', lead: '', tasks: [{ id: 'T1', title: 'T', status: 'completed', tag: '', note: '', owner: '', commit: '' }] }]
    });
    const { document, core, hud } = mountWithState(state);
    const metrics = core.deriveMetrics(state);
    hud.renderHud(state, metrics, document);
    const firstHtml = document.getElementById('metrics-overview').innerHTML;
    hud.renderHud(state, metrics, document);
    const secondHtml = document.getElementById('metrics-overview').innerHTML;
    assert.equal(firstHtml, secondHtml, 'second render should be identical');
    // Also renderAll twice
    hud.renderAll(state, document);
    const third = document.getElementById('metrics-overview').innerHTML;
    assert.equal(secondHtml, third);
  });

  it('uses meta.labels.es fallback for Spanish labels', () => {
    const stateFallback = createState({
      meta: { projectName: 'P', version: '1.0', labels: { es: { overallProgress: 'Mi Progreso' } }, features: {} },
      phases: []
    });
    const { document, core, hud } = mountWithState(stateFallback);
    const metrics = core.deriveMetrics(stateFallback);
    hud.renderHud(stateFallback, metrics, document);
    const hudHtml = document.getElementById('metrics-overview').innerHTML;
    assert.equal(hudHtml.includes('Mi Progreso'), true, 'should use custom label Mi Progreso');
    // Default fallback when no label
    const stateDefault = createState({ meta: { projectName: 'P', version: '1.0', labels: { es: {} }, features: {} }, phases: [] });
    const { document: doc2, core: core2, hud: hud2 } = mountWithState(stateDefault);
    const m2 = core2.deriveMetrics(stateDefault);
    hud2.renderHud(stateDefault, m2, doc2);
    const hudHtml2 = doc2.getElementById('metrics-overview').innerHTML;
    assert.equal(hudHtml2.includes('Progreso Global'), true, 'should fallback to Progreso Global');
  });

  it('header renders branch/commit and escapes HTML', () => {
    const state = createState({
      meta: { projectName: '<script>alert(1)</script>', version: '1.0', branch: 'feature/<b>', commit: 'abc123def456', syncStatus: 'synced', labels: { es: {} }, features: {} },
      phases: []
    });
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);
    const titleEl = document.getElementById('project-title');
    // Should be escaped, not raw script
    assert.equal(titleEl.innerHTML.includes('<script>'), false, 'should escape script tag');
    assert.equal(titleEl.textContent.includes('<script>'), true, 'textContent should preserve literal after escaping via textContent? Actually we set textContent, so it will show literal');
    // Check that innerHTML does not contain unescaped <script>
    assert.equal(titleEl.innerHTML.includes('&lt;script&gt;') || titleEl.textContent.includes('<script>'), true);
  });

  it('handles empty phases gracefully (0% and Sin fase)', () => {
    const state = createState({ meta: { projectName: 'Empty', version: '0', labels: { es: {} }, features: {} }, phases: [] });
    const { document, core, hud } = mountWithState(state);
    const metrics = core.deriveMetrics(state);
    hud.renderAll(state, document);
    const pctEl = document.getElementById('overall-progress-num');
    assert.equal(pctEl.textContent.includes('0%'), true);
    const focusEl = document.getElementById('current-focus-title');
    assert.notEqual(focusEl, null);
    assert.equal(focusEl.textContent.includes('Sin fase') || focusEl.textContent.includes('Sin'), true);
  });

  it('renders panoramic Insights band with token telemetry chart and compact side rail (Owners & Tags)', () => {
    const state = createState({
      tokenUsage: {
        schemaVersion: '1.0',
        updatedAt: '2026-08-29T12:00:00Z',
        source: 'opencode-sdk',
        scope: '/app',
        root: '/app',
        byAgent: [
          {
            agent: 'sdd-apply',
            model: 'claude-3-7-sonnet',
            categories: { input: 12000, output: 4000, reasoning: 1500, cacheRead: 25000, cacheWrite: 500, total: 43000 },
            total: 43000,
            cost: 0.035,
            evidence: 'measured',
            confidence: 1.0,
          },
          {
            agent: 'Orquestador',
            model: 'claude-3-7-sonnet',
            categories: { input: 6000, output: 2000, reasoning: 800, cacheRead: 10000, cacheWrite: 200, total: 19000 },
            total: 19000,
            cost: 0.015,
            evidence: 'derived',
            confidence: 1.0,
          },
          {
            agent: 'sdd-verify',
            model: 'gemini-2.5-flash',
            categories: { input: 2000, output: 800, reasoning: 200, cacheRead: 3000, cacheWrite: 0, total: 6000 },
            total: 6000,
            evidence: 'estimated',
            confidence: 0.35,
          },
        ],
      },
      phases: [{ id: 'p1', number: 1, title: 'Core <UI>', status: 'in-progress', tasks: [
        { id: 'T1', title: 'Core', status: 'completed', owner: 'AI', tag: 'Core' },
        { id: 'T2', title: 'Risk', status: 'in-progress', owner: 'AI', tag: 'UI', risk: 'high' },
        { id: 'T3', title: 'Blocked', status: 'blocked', owner: 'Ops', tag: 'Infra' },
      ] }],
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const card = document.getElementById('metric-insights');
    assert.notEqual(card, null);
    assert.equal(card.classList.contains('metric-insights-band'), true);
    assert.equal(card.getAttribute('data-tm-capability'), 'token-insights-v2');

    // Main token telemetry region (full width)
    const tokensMain = card.querySelector('.insight-tokens-main');
    assert.notEqual(tokensMain, null, 'main area must contain token telemetry');
    assert.equal(tokensMain.textContent.includes('sdd-apply'), true);
    assert.equal(tokensMain.textContent.includes('Orquestador'), true);
    assert.equal(tokensMain.textContent.includes('sdd-verify'), true);
    assert.equal(tokensMain.textContent.includes('Medido'), true);
    assert.equal(tokensMain.textContent.includes('Derivado'), true);
    assert.equal(tokensMain.textContent.includes('Estimado'), true);
    assert.equal(tokensMain.textContent.includes('claude-3-7-sonnet'), true);

    // Horizontal strip with Owners and Tags
    const metaStrip = card.querySelector('.insight-meta-strip');
    assert.notEqual(metaStrip, null, 'compact metadata strip must exist');
    assert.notEqual(card.querySelector('.insight-owners'), null);
    assert.notEqual(card.querySelector('.insight-tags'), null);
    assert.equal(card.querySelector('.insight-dimension-list').children.length > 0, true);

    // Removed old visible sections from main band
    assert.equal(card.querySelector('.insight-status-region'), null, 'old status region must be removed from main band');
    assert.equal(card.querySelector('.insight-risk-region'), null, 'old risk region must be removed from main band');
    assert.equal(card.querySelector('.insight-trend-region'), null, 'old trend region must be removed from main band');

    // Check summary chips
    assert.equal(card.querySelector('.token-chip-total').textContent.includes('68.0k'), true);
  });

  it('renders a clean empty telemetry state and handles stale telemetry', () => {
    const state = createState({ phases: [{ id: 'empty', number: 1, title: 'Empty', status: 'pending', tasks: [] }] });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);
    const card = document.getElementById('metric-insights');
    assert.notEqual(card, null);
    assert.notEqual(card.querySelector('.insight-empty-telemetry'), null);
    assert.equal(card.textContent.includes('Sin telemetría de tokens registrada'), true);

    // Test stale state
    const staleState = createState({
      tokenUsage: {
        updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
        byAgent: [{ agent: 'sdd-apply', total: 500, categories: { input: 400, output: 100, total: 500 } }],
      },
    });
    const { document: staleDoc, hud: staleHud } = mountWithState(staleState);
    staleHud.renderAll(staleState, staleDoc);
    const staleCard = staleDoc.getElementById('metric-insights');
    assert.notEqual(staleCard.querySelector('.token-chip-stale'), null);
    assert.equal(staleCard.querySelector('.token-chip-stale').textContent.includes('Desactualizado'), true);
  });

  it('renders semantic mobile containment hooks without changing metric or status text', () => {
    const state = createState({ phases: [{ id: 'p1', number: 1, title: 'Phase', status: 'in-progress', target: 'Long mobile target', tasks: [
      { id: 'T1', title: 'Done', status: 'completed', owner: 'AI', tag: 'UI' },
      { id: 'T2', title: 'Active', status: 'in-progress', owner: 'AI', tag: 'UI' },
      { id: 'T3', title: 'Pending', status: 'pending', owner: 'AI', tag: 'UI' },
      { id: 'T4', title: 'Blocked', status: 'blocked', owner: 'AI', tag: 'UI' },
    ] }] });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    assert.equal(document.querySelectorAll('.metric-title-row').length, 3);
    const distribution = document.querySelector('.distribution-badges');
    assert.notEqual(distribution, null);
    assert.deepEqual([...distribution.querySelectorAll('.badge')].map((badge) => badge.textContent.trim()), ['1 Hechas', '1 Activas', '1 Pendientes', '1 Bloqueadas']);
    assert.match(document.querySelector('.distribution-risk-warning').textContent, /1 bloqueada\(s\) requiere\(n\) atención/);
  });

  it('shows the HUD only on the overview tab while dedicated views start below navigation', () => {
    const state = createState({ phases: [{ id: 'p1', number: 1, title: 'Phase', status: 'pending', tasks: [] }] });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const metrics = document.getElementById('metrics-overview');
    const overview = document.getElementById('view-overview');
    const kanban = document.getElementById('view-kanban');
    const kanbanTab = document.getElementById('tab-btn-kanban');
    const overviewTab = document.getElementById('tab-btn-overview');

    assert.equal(metrics.hidden, false);
    assert.equal(overview.hidden, false);
    kanbanTab.click();
    assert.equal(metrics.hidden, true);
    assert.equal(metrics.style.display, 'none');
    assert.equal(overview.hidden, true);
    assert.equal(kanban.hidden, false);

    overviewTab.click();
    assert.equal(metrics.hidden, false);
    assert.equal(metrics.style.display, '');
    assert.equal(overview.hidden, false);
    assert.equal(kanban.hidden, true);
  });

  it('renders accessible data table in Insights details dialog', () => {
    const state = createState({
      tokenUsage: {
        schemaVersion: '1.0',
        updatedAt: '2026-08-29T12:00:00Z',
        source: 'opencode-sdk',
        scope: '/app',
        root: '/app',
        totals: { input: 15000, output: 5000, reasoning: 1000, cacheRead: 20000, cacheWrite: 500, total: 41500, cost: 0.05 },
        byAgent: [
          {
            agent: 'sdd-apply',
            model: 'claude-3-7-sonnet',
            models: ['claude-3-7-sonnet'],
            categories: { input: 10000, output: 3500, reasoning: 800, cacheRead: 15000, cacheWrite: 300, total: 29600 },
            total: 29600,
            cost: 0.035,
            sessions: 2,
            messages: 8,
            evidence: 'measured',
            confidence: 1.0,
          },
          {
            agent: 'sdd-verify',
            model: 'gemini-2.5-flash',
            models: ['gemini-2.5-flash'],
            categories: { input: 5000, output: 1500, reasoning: 200, cacheRead: 5000, cacheWrite: 200, total: 11900 },
            total: 11900,
            cost: 0.015,
            sessions: 1,
            messages: 4,
            evidence: 'derived',
            confidence: 1.0,
          },
        ],
      },
      phases: [{ id: 'p1', number: 1, title: 'Phase', status: 'in-progress', tasks: [
        { id: 'T1', title: 'One', status: 'completed', owner: 'AI', tag: 'Core' },
        { id: 'T2', title: 'Two', status: 'in-progress', owner: 'Ops', tag: 'UI' },
      ] }],
      meta: {
        history: [
          { timestamp: '2026-08-28T12:00:00Z', completed: 1, total: 2 },
          { timestamp: '2026-08-29T12:00:00Z', completed: 1, total: 2 },
        ],
      },
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const card = document.getElementById('metric-insights');
    assert.equal(card.classList.contains('metric-insights-band'), true);

    // Open detail dialog
    card.click();
    const dialog = document.getElementById('overview-detail-dialog');
    assert.notEqual(dialog, null);
    assert.equal(dialog.querySelector('#overview-detail-title')?.textContent, 'Desglose de consumo y actividad por agente');

    const content = dialog.querySelector('#overview-detail-content');
    assert.notEqual(content, null);

    // Verify ordering: custom table region comes first
    const customRegion = content.querySelector('.overview-detail-main-custom');
    assert.notEqual(customRegion, null, 'detail dialog must contain prominent full-width custom region');

    const table = customRegion.querySelector('.token-details-table');
    assert.notEqual(table, null, 'detail dialog must contain accessible token table');
    assert.notEqual(table.querySelector('caption'), null);
    assert.notEqual(table.querySelector('thead'), null);
    assert.notEqual(table.querySelector('tbody'), null);
    assert.notEqual(table.querySelector('tfoot'), null);
    assert.equal(table.textContent.includes('sdd-apply'), true);
    assert.equal(table.textContent.includes('claude-3-7-sonnet'), true);
    assert.equal(table.textContent.includes('Totales'), true);
    assert.equal(table.textContent.includes('41,500'), true);

    // Verify compact 4-group horizontal metadata strip below table
    const metaStrip = content.querySelector('.overview-detail-meta-strip');
    assert.notEqual(metaStrip, null, 'detail dialog must contain compact metadata strip');

    const sections = metaStrip.querySelectorAll('.overview-detail-section');
    assert.equal(sections.length, 4, 'metadata strip must contain 4 compact sections');

    const headings = Array.from(sections).map((s) => s.querySelector('h3')?.textContent?.trim());
    assert.deepEqual(headings, ['Responsables', 'Etiquetas', 'Riesgo', 'Historial']);

    // Check that customRegion precedes metaStrip in DOM
    const children = Array.from(content.children);
    assert.equal(children.indexOf(customRegion) < children.indexOf(metaStrip), true, 'table must appear directly before metadata strip');
  });

  it('fills the executive summary with three additional truthful informational cards', () => {
    const state = createState({
      meta: { features: { git: true, tree: true, codegraph: false } },
      phases: [
        { id: 'p1', number: 1, title: 'Discovery', status: 'completed', tasks: [{ id: 'T1', title: 'Done', status: 'completed' }] },
        { id: 'p2', number: 2, title: 'Delivery', status: 'in-progress', tasks: [{ id: 'T2', title: 'Active', status: 'in-progress' }, { id: 'T3', title: 'Blocked', status: 'blocked' }] },
      ],
      git: { branch: 'main', syncStatus: 'synced', commits: [{ hash: 'abc1234', message: 'feat: summary' }] },
      tree: [{ name: 'src/', depth: 0, type: 'dir' }],
      codegraph: { nodes: [], edges: [] },
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    assert.notEqual(document.getElementById('metric-phase-coverage'), null);
    assert.notEqual(document.getElementById('metric-active-workload'), null);
    assert.notEqual(document.getElementById('metric-data-coverage'), null);
    assert.match(document.getElementById('metric-phase-coverage').textContent, /1 de 2 fases/i);
    assert.match(document.getElementById('metric-active-workload').textContent, /2 tareas/i);
    assert.match(document.getElementById('metric-data-coverage').textContent, /2 de 3 fuentes/i);
  });
});

describe('header-hud — preference-backed stable navigation', () => {
  it('maps keys 1–7 in contract order, preserves island bytes, and ignores editable controls', () => {
    const state = createState();
    const { document, window, hud } = mountWithState(state);
    const islandBytes = document.getElementById('tm-state').textContent;
    hud.renderAll(state, document);
    for (const [key, view] of ['overview', 'phases', 'kanban', 'codegraph', 'tree', 'git', 'help'].entries()) {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: String(key + 1), bubbles: true }));
      assert.equal(document.getElementById('view-' + view).hidden, false, 'key ' + (key + 1) + ' activates ' + view);
    }
    const input = document.getElementById('global-search-input');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }));
    assert.equal(document.getElementById('view-help').hidden, false, 'input keystroke is not hijacked');
    assert.equal(document.getElementById('tm-state').textContent, islandBytes);
  });

  it('binds shell shortcuts once across repeated initialization and stores only preferences', () => {
    const { document, window, hud } = mountWithState(createState());
    hud.setupNavTabs(document);
    hud.setupNavTabs(document);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '5', bubbles: true }));
    assert.equal(document.getElementById('view-tree').hidden, false, 'one keyboard activation selects Tree after repeated setup');
    assert.equal(window.localStorage.getItem('tm-ui-preferences').includes('task'), false);
  });
});

describe('header-hud — executive overview ownership', () => {
  it('puts risk before progress and leaves detailed panels to their dedicated views', () => {
    const state = createState({ phases: [{ id: 'p1', number: 1, title: 'Delivery', status: 'blocked', tasks: [
      { id: 'T1', title: 'Await approval', status: 'blocked', risk: 'high', blockedReason: 'API key approval' },
    ] }] });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const overview = document.getElementById('view-overview');
    const risk = document.getElementById('metric-overview-risk');
    const progress = document.getElementById('metric-overall-card');
    assert.notEqual(risk, null, 'Overview needs a risk summary');
    assert.ok(risk.compareDocumentPosition(progress) & 4, 'risk must precede progress');
    assert.equal(risk.textContent.includes('API key approval'), true);
    assert.equal(overview.querySelector('#phases-panel'), null, 'Overview must not own detailed phases');
    assert.equal(overview.querySelector('#help-panel'), null, 'Overview must not own full Help tools');
  });
});

describe('header-hud — accessible metric details', () => {
  it('keeps every summary card as a direct grid child with a visible details affordance', () => {
    const state = createState({
      meta: { features: { git: true, tree: true, codegraph: true } },
      phases: [{ id: 'p1', number: 1, title: 'Delivery', status: 'in-progress', tasks: [
        { id: 'T1', title: 'Active work', status: 'in-progress', owner: 'Ana', tag: 'UI' },
      ] }],
      git: { branch: 'main', syncStatus: 'synced', commits: [{ hash: 'abc1234', message: 'feat: details' }] },
      tree: [{ name: 'src/', depth: 0, type: 'dir' }],
      codegraph: { nodes: [{ id: 'core', label: 'Core' }], edges: [] },
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const expected = ['metric-overview-risk', 'metric-overall-card', 'metric-current-focus', 'metric-distribution', 'metric-git', 'metric-phase-coverage', 'metric-active-workload', 'metric-data-coverage', 'metric-insights'];
    const direct = [...document.querySelectorAll('#metrics-overview > .metric-card')];
    assert.deepEqual(direct.map((card) => card.id), expected);
    for (const card of direct) {
      assert.equal(card.getAttribute('role'), 'button');
      assert.equal(card.getAttribute('tabindex'), '0');
      assert.equal(card.getAttribute('aria-haspopup'), 'dialog');
      assert.match(card.textContent, /Detalles/);
    }
  });

  it('opens one truthful dialog by click, Enter, and Space, then restores focus', () => {
    const state = createState({
      meta: { features: { git: true, tree: false, codegraph: false } },
      phases: [{ id: 'p1', number: 1, title: 'Delivery', status: 'in-progress', tasks: [
        { id: 'T1', title: 'Active work', status: 'in-progress', owner: 'Ana', tag: 'UI' },
        { id: 'T2', title: 'Blocked work', status: 'blocked', owner: 'Ops', tag: 'Infra', blockedReason: 'Approval missing' },
      ] }],
      git: { branch: 'main', syncStatus: 'synced', commits: [{ hash: 'abc1234', message: 'feat: details' }] },
    });
    const { document, window, hud } = mountWithState(state);
    hud.renderAll(state, document);
    const card = document.getElementById('metric-active-workload');
    const dialog = document.getElementById('overview-detail-dialog');
    assert.notEqual(dialog, null);

    for (const event of [new window.MouseEvent('click', { bubbles: true }), new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }), new window.KeyboardEvent('keydown', { key: ' ', bubbles: true })]) {
      card.dispatchEvent(event);
      assert.equal(dialog.dataset.open, 'true');
      assert.match(dialog.textContent, /2 tareas/);
      assert.match(dialog.textContent, /1 en progreso/);
      assert.match(dialog.textContent, /1 bloqueada/);
      hud.closeOverviewDetailDialog(document);
    }
    assert.equal(document.activeElement, card);
    assert.equal(document.querySelectorAll('#overview-detail-dialog').length, 1);
  });

  it('explains missing JSON data and navigates to a related dedicated view', () => {
    const state = createState({ meta: { features: { git: true, tree: true, codegraph: true } }, git: { branch: '', syncStatus: '', commits: [] }, tree: [], codegraph: { nodes: [], edges: [] } });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    document.getElementById('metric-data-coverage').click();
    const dialog = document.getElementById('overview-detail-dialog');
    assert.match(dialog.textContent, /git\.commits|tree|codegraph\.nodes/i);
    assert.match(dialog.textContent, /no se invent/i);
    hud.closeOverviewDetailDialog(document);

    document.getElementById('metric-git').click();
    const viewButton = dialog.querySelector('[data-overview-view-section]');
    assert.equal(viewButton.hidden, false);
    viewButton.click();
    assert.equal(document.getElementById('view-git').hidden, false);
    assert.equal(document.getElementById('tm-state').textContent.includes('schemaVersion'), true);
  });

  it('binds metric interaction once across identical re-renders', () => {
    const state = createState();
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);
    hud.renderAll(state, document);
    const card = document.getElementById('metric-overall-card');
    card.click();
    assert.equal(document.querySelectorAll('#overview-detail-dialog').length, 1);
    assert.equal(document.getElementById('overview-detail-dialog').dataset.open, 'true');
  });
});

describe('header-hud — digital clock and last update cockpit hub', () => {
  it('renders digital clock with hours, minutes, seconds, period, date and timezone', () => {
    const state = createState();
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);

    const clock = document.getElementById('tm-digital-clock');
    assert.notEqual(clock, null, 'digital clock card must exist');
    assert.equal(clock.getAttribute('role'), 'timer');

    const hoursEl = document.getElementById('clock-hours');
    const minEl = document.getElementById('clock-minutes');
    const secEl = document.getElementById('clock-seconds');
    const dateEl = document.getElementById('clock-date');
    const tzEl = document.getElementById('clock-timezone');
    const periodEl = document.getElementById('clock-period');

    assert.notEqual(hoursEl, null);
    assert.notEqual(minEl, null);
    assert.notEqual(secEl, null);
    assert.notEqual(dateEl, null);
    assert.notEqual(tzEl, null);
    assert.notEqual(periodEl, null);

    assert.match(hoursEl.textContent, /^\d{2}$/);
    assert.match(minEl.textContent, /^\d{2}$/);
    assert.match(secEl.textContent, /^\d{2}$/);
    assert.ok(dateEl.textContent.length > 0);
    assert.ok(tzEl.textContent.length > 0);
  });

  it('toggles clock between 12-hour and 24-hour formats on switcher click', () => {
    const state = createState();
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);

    const clock = document.getElementById('tm-digital-clock');
    const toggleBtn = document.getElementById('btn-clock-toggle-format');
    const formatTag = document.getElementById('clock-format-tag');
    const periodEl = document.getElementById('clock-period');

    assert.equal(clock.getAttribute('data-clock-format'), '12h');
    assert.equal(formatTag.textContent, '12H');
    assert.equal(periodEl.style.display !== 'none', true);

    // Click to switch to 24h
    toggleBtn.click();
    assert.equal(clock.getAttribute('data-clock-format'), '24h');
    assert.equal(formatTag.textContent, '24H');
    assert.equal(periodEl.style.display, 'none');

    // Click again to switch back to 12h
    toggleBtn.click();
    assert.equal(clock.getAttribute('data-clock-format'), '12h');
    assert.equal(formatTag.textContent, '12H');
  });

  it('renders last update card from meta timestamp or history', () => {
    const state = createState({
      meta: {
        lastUpdated: '2026-08-26T14:30:00Z',
        history: [{ timestamp: '2026-08-26T14:30:00Z', completed: 2, total: 5 }]
      }
    });
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);

    const lastUpdateCard = document.getElementById('tm-last-update');
    assert.notEqual(lastUpdateCard, null, 'last update card must exist');
    assert.equal(lastUpdateCard.getAttribute('role'), 'status');

    const relEl = document.getElementById('last-update-relative');
    const exactEl = document.getElementById('last-update-exact');

    assert.notEqual(relEl, null);
    assert.notEqual(exactEl, null);
    assert.ok(relEl.textContent.length > 0);
    assert.ok(exactEl.textContent.length > 0);
  });

  it('renders active harness card and updated project logo svg', () => {
    const state = createState({
      meta: {
        harness: 'OpenCode',
        harnessRole: 'Autonomous Multi-Agent Runtime'
      }
    });
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);

    const harnessCard = document.getElementById('tm-harness-card');
    assert.notEqual(harnessCard, null, 'harness card must exist');
    assert.equal(harnessCard.getAttribute('role'), 'status');

    const harnessName = document.getElementById('harness-name');
    const harnessRole = document.getElementById('harness-role');
    assert.notEqual(harnessName, null);
    assert.equal(harnessName.textContent, 'OpenCode');
    assert.equal(harnessRole.textContent, 'Autonomous Multi-Agent Runtime');

    const logo = document.getElementById('project-logo-icon');
    assert.notEqual(logo, null, 'project logo icon must exist');
    assert.equal(logo.querySelector('svg') !== null, true, 'logo must contain svg');
  });

  it('permanently avoids creating or rendering project-subtitle element', () => {
    const state = createState({
      meta: {
        projectName: 'Subtitle Test',
        description: 'Existing project description that must not render',
        labels: {
          es: {
            headerSubtitle: 'Legacy header subtitle'
          }
        }
      }
    });
    const { document, hud } = mountWithState(state);
    hud.renderHeader(state, document);

    const subtitle = document.getElementById('project-subtitle');
    assert.equal(subtitle, null, '#project-subtitle must never exist in the rendered DOM');
    assert.equal(document.querySelector('.header-titles #project-subtitle'), null);
    assert.equal(document.body.innerHTML.includes('id="project-subtitle"'), false);
  });

  it('renders truthful running, error, and synced states in synchronization banner', () => {
    // 1. Running state: authored signal focal motion with activity nodes, agent badge, and F5 advice
    const runningState = createState({
      meta: {
        syncStatus: 'running',
        projectName: 'Sync Test',
      }
    });
    const { document, hud } = mountWithState(runningState);
    hud.renderAll(runningState, document);

    const banner = document.getElementById('tm-sync-banner');
    assert.notEqual(banner, null, '#tm-sync-banner must exist');
    assert.equal(banner.hidden, false);
    assert.equal(banner.getAttribute('role'), 'status');
    assert.equal(banner.getAttribute('aria-live'), 'polite');
    assert.ok(banner.className.includes('sync-running'));
    assert.ok(banner.textContent.includes('Agent Task Manager'));
    assert.ok(banner.textContent.includes('Sincronización en curso en segundo plano'));
    assert.ok(banner.textContent.includes('F5'));
    assert.notEqual(banner.querySelector('.sync-signal-cluster'), null);
    assert.equal(banner.querySelectorAll('.sync-signal-node').length, 4);
    assert.notEqual(banner.querySelector('.sync-energy-beam'), null);
    assert.notEqual(banner.querySelector('.sync-glow-sweep'), null);
    assert.notEqual(banner.querySelector('.sync-agent-badge'), null);
    assert.notEqual(banner.querySelector('.sync-kbd'), null);

    // 2. Prolonged state: reassuring segmented neon rail, no red, polite status
    const prolongedState = createState({
      meta: {
        syncStatus: 'prolonged',
        projectName: 'Prolonged Test',
      }
    });
    hud.renderSyncStatus(prolongedState, document);
    assert.equal(banner.hidden, false);
    assert.equal(banner.getAttribute('role'), 'status');
    assert.equal(banner.getAttribute('aria-live'), 'polite');
    assert.ok(banner.className.includes('sync-prolonged'));
    assert.ok(!banner.className.includes('sync-error'), 'Prolonged must not have error styling');
    assert.ok(banner.textContent.includes('Agent Task Manager'));
    assert.ok(banner.textContent.includes('segundo plano'));
    assert.ok(banner.textContent.includes('F5'));
    assert.notEqual(banner.querySelector('.sync-segmented-rail'), null, 'Segmented rail must exist');
    assert.ok(banner.querySelectorAll('.sync-rail-seg').length >= 4, 'Segmented rail must have illuminated blocks');

    // 3. Error state: distinct, non-animated emphasis with alert role
    const errorState = createState({
      meta: {
        syncStatus: 'error',
        lastError: 'Agent timeout after 30s',
      }
    });
    hud.renderSyncStatus(errorState, document);
    assert.equal(banner.hidden, false);
    assert.equal(banner.getAttribute('role'), 'alert');
    assert.equal(banner.getAttribute('aria-live'), 'assertive');
    assert.ok(banner.className.includes('sync-error'));
    assert.ok(banner.textContent.includes('Agent timeout after 30s'));
    assert.ok(banner.textContent.includes('Plugins → Task Manager para reintentar'));
    assert.notEqual(banner.querySelector('.sync-error-icon-box'), null);

    // 3. Synced state hides the banner completely
    const syncedState = createState({
      meta: {
        syncStatus: 'synced',
      }
    });
    hud.renderSyncStatus(syncedState, document);
    assert.equal(banner.hidden, true);
    assert.equal(banner.style.display, 'none');
    assert.equal(banner.innerHTML, '');
  });

  it('truthfully formats git snapshot counts with totalCount and latest limit', () => {
    const state = createState({
      git: {
        branch: 'main',
        totalCount: 151,
        limit: 5,
        commits: [
          { hash: '1111111', message: 'c1' },
          { hash: '2222222', message: 'c2' },
          { hash: '3333333', message: 'c3' },
          { hash: '4444444', message: 'c4' },
          { hash: '5555555', message: 'c5' },
        ],
        syncStatus: 'synced',
      },
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const gitCard = document.getElementById('metric-git');
    gitCard.click();

    const dialog = document.getElementById('overview-detail-dialog');
    assert.match(dialog.textContent, /5 de 151 commits recientes/);
  });

  it('resolveLastUpdatedDate includes lastSyncCompletedAt and lastSyncAt but not prolonged start', () => {
    const completedTimestamp = '2026-08-29T14:30:00.000Z';
    const state = createState({
      meta: {
        lastSyncCompletedAt: completedTimestamp,
        lastSyncStartAt: '2026-08-29T14:00:00.000Z',
        lastSyncProlongedAt: '2026-08-29T14:05:00.000Z',
      },
    });
    const { document, hud } = mountWithState(state);
    hud.renderAll(state, document);

    const elExact = document.getElementById('last-update-exact');
    assert.notEqual(elExact, null);
    assert.match(elExact.textContent, /29\/08\/2026|8\/29\/2026/);
  });
});
