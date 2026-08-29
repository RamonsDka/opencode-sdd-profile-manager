// @ts-nocheck
// modules/03-header-hud.js — Header + HUD renderers (PR3, classic script)
// Depends on TMCore (parse/derive/escape). Pure DOM updates, no fetch.
// English code, Spanish UI via meta.labels.es fallback.

(function (global) {
  'use strict';

  function getCore() {
    return (typeof window !== 'undefined' && window.TMCore) || (typeof globalThis !== 'undefined' && globalThis.TMCore) || (typeof global !== 'undefined' && global.TMCore) || null;
  }

  function esc(str) {
    var c = getCore();
    return c ? c.escapeHtml(str) : String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function finiteNumber(value, fallback) { value = Number(value); return isFinite(value) ? value : fallback; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, finiteNumber(value, min))); }
  function svgNumber(value) { return String(Math.round(clamp(value, -100000, 100000) * 100) / 100); }

  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatCompactTokens(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function resolveInsights(state, metrics, core, supplied) {
    return supplied || (core && state && typeof core.deriveInsights === 'function' ? core.deriveInsights(state) : {
      metrics: metrics, tasks: [], dimensions: { owner: {}, tag: {} }, blockers: { total: 0 }, history: [],
      forecast: { available: false, label: 'Forecast unavailable', reason: 'No history data' },
      tokenUsage: { hasData: false, totals: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: undefined }, byAgent: [] }
    });
  }

  function renderTokenChart(tokenUsage) {
    if (!tokenUsage || !tokenUsage.hasData || !tokenUsage.byAgent || !tokenUsage.byAgent.length) {
      return '<div class="insight-empty-telemetry">'
        + '<span class="insight-empty-title">Sin telemetría de tokens registrada</span>'
        + '<span class="insight-empty-copy">La telemetría se recopilará automáticamente en la próxima sincronización del orquestador.</span>'
        + '</div>';
    }

    var isActivityEstimation = tokenUsage.source === 'activity-estimation';
    var byAgent = tokenUsage.byAgent;
    var maxTotal = byAgent.reduce(function (max, item) { return Math.max(max, item.total); }, 1);
    var anyEstimated = false;

    var rows = byAgent.map(function (item) {
      if (item.evidence === 'estimated') anyEstimated = true;
      var agentPct = clamp(Math.round(item.total / maxTotal * 100), 4, 100);
      var cats = item.categories || {};
      var inpPct = item.total ? clamp(Math.round(cats.input / item.total * 100), 0, 100) : 0;
      var outPct = item.total ? clamp(Math.round(cats.output / item.total * 100), 0, 100) : 0;
      var cRdPct = item.total ? clamp(Math.round(cats.cacheRead / item.total * 100), 0, 100) : 0;
      var reaPct = item.total ? clamp(Math.round(cats.reasoning / item.total * 100), 0, 100) : 0;
      var cWrPct = (item.total && cats.cacheWrite > 0) ? clamp(Math.round(cats.cacheWrite / item.total * 100), 0, 100) : 0;

      var evidenceLabel = isActivityEstimation
        ? 'Estimación por actividad'
        : (item.evidence === 'measured' ? 'Medido' : (item.evidence === 'derived' ? 'Derivado' : 'Estimado'));
      var evidenceClass = isActivityEstimation ? 'token-evidence-estimated' : ('token-evidence-' + item.evidence);
      var costText = (!isActivityEstimation && item.cost !== undefined) ? ' · $' + item.cost.toFixed(3) : '';
      var unitLabel = isActivityEstimation ? ' u. activ.' : ' tokens';

      var barInnerHtml = isActivityEstimation
        ? '<div class="token-seg token-seg-activity" style="width:100%;" title="' + esc('Actividad: ' + formatNumber(item.total) + ' unidades') + '"></div>'
        : ('<div class="token-seg token-seg-input" style="width:' + inpPct + '%;" title="' + esc('Entrada: ' + formatNumber(cats.input)) + '"></div>'
          + '<div class="token-seg token-seg-output" style="width:' + outPct + '%;" title="' + esc('Salida: ' + formatNumber(cats.output)) + '"></div>'
          + '<div class="token-seg token-seg-cache-read" style="width:' + cRdPct + '%;" title="' + esc('Lectura Caché: ' + formatNumber(cats.cacheRead)) + '"></div>'
          + '<div class="token-seg token-seg-reasoning" style="width:' + reaPct + '%;" title="' + esc('Razonamiento: ' + formatNumber(cats.reasoning)) + '"></div>'
          + (cats.cacheWrite > 0 ? '<div class="token-seg token-seg-cache-write" style="width:' + cWrPct + '%;" title="' + esc('Escritura Caché: ' + formatNumber(cats.cacheWrite)) + '"></div>' : ''));

      return '<div class="token-agent-row">'
        + '<div class="token-agent-meta">'
        + '<div class="token-agent-meta-left">'
        + '<span class="token-agent-name">' + esc(item.agent) + '</span>'
        + (item.model ? '<span class="token-agent-model-badge">' + esc(item.model) + '</span>' : '')
        + '<span class="token-evidence-badge ' + evidenceClass + '">' + evidenceLabel + '</span>'
        + '</div>'
        + '<span class="token-agent-total">' + formatNumber(item.total) + unitLabel + costText + '</span>'
        + '</div>'
        + '<div class="token-bar-track" role="progressbar" aria-valuenow="' + item.total + '" aria-valuemin="0" aria-valuemax="' + maxTotal + '" aria-label="' + esc(item.agent + ': ' + formatNumber(item.total) + unitLabel) + '">'
        + '<div class="token-bar-fill" style="width:' + agentPct + '%;">'
        + barInnerHtml
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    var anyCacheWrite = !isActivityEstimation && byAgent.some(function (item) { return item.categories && item.categories.cacheWrite > 0; });

    var legendHtml = isActivityEstimation
      ? ('<div class="token-chart-legend">'
        + '<span class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#38bdf8,#818cf8);"></span> Unidades relativas de actividad</span>'
        + '<span class="token-estimate-note">* Estimación por actividad basada en asignación y avance de tareas (sin telemetría directa de tokens)</span>'
        + '</div>')
      : ('<div class="token-chart-legend">'
        + '<span class="legend-item"><span class="legend-swatch legend-input"></span> Entrada</span>'
        + '<span class="legend-item"><span class="legend-swatch legend-output"></span> Salida</span>'
        + '<span class="legend-item"><span class="legend-swatch legend-cache-read"></span> Lectura Caché</span>'
        + '<span class="legend-item"><span class="legend-swatch legend-reasoning"></span> Razonamiento</span>'
        + (anyCacheWrite ? '<span class="legend-item"><span class="legend-swatch legend-cache-write"></span> Escritura Caché</span>' : '')
        + (anyEstimated ? '<span class="token-estimate-note">* Estimación determinista (caracteres / 4)</span>' : '')
        + '</div>');

    return '<div class="token-chart-container">' + rows + '</div>' + legendHtml;
  }

  function renderTokenDetailsTable(tokenUsage) {
    if (!tokenUsage || !tokenUsage.hasData || !tokenUsage.byAgent || !tokenUsage.byAgent.length) {
      return '<p class="overview-section-copy">No hay telemetría de tokens registrada para este proyecto.</p>';
    }

    var isActivityEstimation = tokenUsage.source === 'activity-estimation';
    var byAgent = tokenUsage.byAgent;
    var totals = tokenUsage.totals;
    var anyEstimated = false;

    var rows = byAgent.map(function (item) {
      if (item.evidence === 'estimated') anyEstimated = true;
      var cats = item.categories || {};
      var costStr = (!isActivityEstimation && item.cost !== undefined) ? '$' + item.cost.toFixed(4) : '—';
      var evidenceLabel = isActivityEstimation
        ? 'Estimación por actividad'
        : (item.evidence === 'measured' ? 'Medido' : (item.evidence === 'derived' ? 'Derivado' : 'Estimado'));
      var modelsStr = (item.models && item.models.length) ? item.models.join(', ') : (item.model || '—');

      return '<tr>'
        + '<td><strong>' + esc(item.agent) + '</strong></td>'
        + '<td><code>' + esc(modelsStr) + '</code></td>'
        + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(cats.input)) + '</td>'
        + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(cats.output)) + '</td>'
        + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(cats.reasoning)) + '</td>'
        + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(cats.cacheRead)) + '</td>'
        + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(cats.cacheWrite)) + '</td>'
        + '<td class="num-col"><strong>' + formatNumber(item.total) + (isActivityEstimation ? ' u' : '') + '</strong></td>'
        + '<td class="num-col">' + costStr + '</td>'
        + '<td class="num-col">' + formatNumber(item.sessions || 0) + '</td>'
        + '<td class="num-col">' + formatNumber(item.messages || 0) + '</td>'
        + '<td><span class="token-evidence-badge token-evidence-' + item.evidence + '">' + evidenceLabel + '</span></td>'
        + '</tr>';
    }).join('');

    var totalCostStr = (!isActivityEstimation && totals.cost !== undefined) ? '$' + totals.cost.toFixed(4) : '—';
    var totalSessions = byAgent.reduce(function (sum, a) { return sum + (a.sessions || 0); }, 0);
    var totalMessages = byAgent.reduce(function (sum, a) { return sum + (a.messages || 0); }, 0);
    var totalColLabel = isActivityEstimation ? 'Total Actividad' : 'Total Tokens';

    var tableHtml = '<div class="token-table-container">'
      + '<table class="token-details-table" role="table" aria-label="Desglose detallado de telemetría por agente">'
      + '<caption>Desglose de consumo y actividad por agente</caption>'
      + '<thead>'
      + '<tr>'
      + '<th scope="col">Agente</th>'
      + '<th scope="col">Modelo(s)</th>'
      + '<th scope="col" class="num-col">Entrada</th>'
      + '<th scope="col" class="num-col">Salida</th>'
      + '<th scope="col" class="num-col">Razonamiento</th>'
      + '<th scope="col" class="num-col">Lectura Caché</th>'
      + '<th scope="col" class="num-col">Escritura Caché</th>'
      + '<th scope="col" class="num-col">' + totalColLabel + '</th>'
      + '<th scope="col" class="num-col">Costo</th>'
      + '<th scope="col" class="num-col">Sesiones</th>'
      + '<th scope="col" class="num-col">Tareas / Msg</th>'
      + '<th scope="col">Evidencia</th>'
      + '</tr>'
      + '</thead>'
      + '<tbody>' + rows + '</tbody>'
      + '<tfoot>'
      + '<tr>'
      + '<th scope="row">Totales</th>'
      + '<td>—</td>'
      + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(totals.input)) + '</td>'
      + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(totals.output)) + '</td>'
      + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(totals.reasoning)) + '</td>'
      + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(totals.cacheRead)) + '</td>'
      + '<td class="num-col">' + (isActivityEstimation ? '—' : formatNumber(totals.cacheWrite)) + '</td>'
      + '<td class="num-col"><strong>' + formatNumber(totals.total) + (isActivityEstimation ? ' u' : '') + '</strong></td>'
      + '<td class="num-col">' + totalCostStr + '</td>'
      + '<td class="num-col">' + formatNumber(totalSessions) + '</td>'
      + '<td class="num-col">' + formatNumber(totalMessages) + '</td>'
      + '<td>—</td>'
      + '</tr>'
      + '</tfoot>'
      + '</table>'
      + '</div>'
      + (isActivityEstimation
        ? '<p class="token-table-note">* Estimación determinista por volumen de tareas y subtareas asignadas.</p>'
        : (anyEstimated ? '<p class="token-table-note">* Estimación determinista basada en longitud de caracteres (chars / 4).</p>' : ''));

    return tableHtml;
  }
  function renderStatusSvg(insights) {
    var d = insights && insights.metrics && insights.metrics.distribution || {};
    var values = [
      ['Completed', d.completed, 'var(--accent-green)'], ['In progress', d['in-progress'] != null ? d['in-progress'] : d.inprogress, 'var(--accent-blue)'],
      ['Pending', d.pending, 'var(--accent-amber)'], ['Blocked', d.blocked, 'var(--accent-red)']
    ];
    var total = values.reduce(function (sum, item) { return sum + Math.max(0, finiteNumber(item[1], 0)); }, 0), cursor = 0;
    var html = '<svg class="insight-status-chart" width="240" height="18" viewBox="0 0 240 18" role="img" aria-labelledby="insight-status-title"><title id="insight-status-title">Task status composition</title>';
    values.forEach(function (item) {
      var value = Math.max(0, finiteNumber(item[1], 0)), segment = total ? clamp(value / total * 240, 0, 240 - cursor) : 0;
      html += '<rect x="' + svgNumber(cursor) + '" y="0" width="' + svgNumber(segment) + '" height="18" fill="' + item[2] + '"><title>' + esc(item[0] + ': ' + Math.round(value)) + '</title></rect>';
      cursor = clamp(cursor + segment, 0, 240);
    });
    return html + '</svg>';
  }
  function renderTrend(insights) {
    var history = insights && Array.isArray(insights.history) ? insights.history : [];
    if (!history.length) return '';
    var points = history.map(function (point, index) {
      var total = Math.max(0, finiteNumber(point && point.total, 0)), done = clamp(point && point.completed, 0, total);
      return svgNumber(history.length === 1 ? 0 : 240 * index / (history.length - 1)) + ',' + svgNumber(44 - (total ? done / total * 44 : 0));
    });
    var last = history[history.length - 1] || {}, forecast = insights.forecast || {};
    var text = forecast.available && forecast.range ? forecast.label + ' — ' + Math.round(forecast.range.min) + '–' + Math.round(forecast.range.max) + ' sessions' : (forecast.label || 'Forecast unavailable') + ' — ' + (forecast.reason || 'Insufficient trend data');
    return '<div class="insight-trend"><svg class="insight-trend-chart" width="240" height="44" viewBox="0 0 240 44" role="img" aria-labelledby="insight-trend-title"><title id="insight-trend-title">Bounded completion trend</title><polyline points="' + points.join(' ') + '" fill="none" stroke="var(--accent-purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg><div class="insight-trend-copy">History: ' + history.length + ' points · latest ' + Math.round(finiteNumber(last.completed, 0)) + '/' + Math.round(Math.max(0, finiteNumber(last.total, 0))) + '</div><div class="insight-forecast">' + esc(text) + '</div></div>';
  }
  function renderDimensionLines(map) {
    var keys = Object.keys(map || {});
    var lines = keys.length ? keys.map(function (key) { var bucket = map[key] || {}; return '<span class="insight-dimension-line"><strong>' + esc(key) + '</strong> ' + Math.round(finiteNumber(bucket.completed, 0)) + '/' + Math.round(Math.max(0, finiteNumber(bucket.total, 0))) + '</span>'; }).join('') : '<span class="insight-empty">No task data</span>';
    return '<div class="insight-dimension-list">' + lines + '</div>';
  }
  function riskCount(insights, level) {
    return (insights && Array.isArray(insights.tasks) ? insights.tasks : []).filter(function (task) { return task && task.risk === level; }).length;
  }

  function optionalDataCoverage(state) {
    var available = 0;
    if (state && state.git && (state.git.branch || state.git.syncStatus || (Array.isArray(state.git.commits) && state.git.commits.length))) available++;
    if (state && Array.isArray(state.tree) && state.tree.length) available++;
    if (state && state.codegraph && ((Array.isArray(state.codegraph.nodes) && state.codegraph.nodes.length) || (Array.isArray(state.codegraph.edges) && state.codegraph.edges.length))) available++;
    return available;
  }

  function detailSection(label, items) {
    return { label: label, items: (items || []).filter(Boolean) };
  }

  function buildMetricDetailModels(state, metrics, insights, context) {
    var phases = state && Array.isArray(state.phases) ? state.phases : [];
    var git = state && state.git || {};
    var tree = state && Array.isArray(state.tree) ? state.tree : [];
    var graph = state && state.codegraph || {};
    var graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    var graphEdges = Array.isArray(graph.edges) ? graph.edges : [];
    var riskTasks = context.riskTasks;
    var distribution = metrics.distribution || {};
    var remaining = Math.max(0, context.total - context.completed);
    var missingCoverage = [];
    if (!(git.branch || git.syncStatus || (Array.isArray(git.commits) && git.commits.length))) missingCoverage.push({ field: 'git.commits', guidance: 'Añade branch, syncStatus o commits al objeto git.' });
    if (!tree.length) missingCoverage.push({ field: 'tree', guidance: 'Añade elementos al arreglo tree.' });
    if (!graphNodes.length && !graphEdges.length) missingCoverage.push({ field: 'codegraph.nodes', guidance: 'Añade nodos o relaciones al objeto codegraph.' });
    var ownerLines = Object.keys(insights.dimensions && insights.dimensions.owner || {}).map(function (owner) { var bucket = insights.dimensions.owner[owner]; return owner + ': ' + bucket.completed + '/' + bucket.total; });
    var tagLines = Object.keys(insights.dimensions && insights.dimensions.tag || {}).map(function (tag) { var bucket = insights.dimensions.tag[tag]; return tag + ': ' + bucket.completed + '/' + bucket.total; });
    return {
      'metric-overview-risk': {
        title: 'Riesgos y bloqueos', value: riskTasks.length + (riskTasks.length === 1 ? ' requiere atención' : ' requieren atención'),
        summary: riskTasks.length ? 'Estas tareas necesitan revisión antes de continuar con normalidad.' : 'No hay bloqueos ni riesgos críticos informados.',
        sections: [detailSection('Tareas relacionadas', riskTasks.map(function (task) { return (task.id || 'Tarea') + ' · ' + (task.blockedReason || task.title || 'Requiere atención'); }))],
        missing: [], targetView: 'view-phases'
      },
      'metric-overall-card': {
        title: context.overallLabel, value: context.overallPct + '%', summary: context.completed + ' de ' + context.total + ' tareas completadas.',
        sections: [detailSection('Desglose', [context.completed + ' completadas', remaining + ' restantes', phases.length + ' fases registradas'])], missing: [], targetView: 'view-phases'
      },
      'metric-current-focus': {
        title: 'Fase Actual', value: context.focusPhase ? (context.focusPhase.title || 'Fase sin título') : 'Sin fase',
        summary: context.focusPhase ? context.focusPct + '% completado' : 'No existe una fase que pueda seleccionarse como foco actual.',
        sections: [detailSection('Contexto', context.focusPhase ? [context.focusPhase.target ? 'Objetivo: ' + context.focusPhase.target : 'Objetivo no informado', context.focusPhase.lead ? 'Responsable: ' + context.focusPhase.lead : 'Responsable no informado', (Array.isArray(context.focusPhase.tasks) ? context.focusPhase.tasks.length : 0) + ' tareas'] : [])],
        missing: context.focusPhase ? [] : [{ field: 'phases', guidance: 'Añade al menos una fase al arreglo phases.' }], targetView: 'view-phases'
      },
      'metric-distribution': {
        title: 'Distribución', value: context.total + ' tareas', summary: 'Composición actual del trabajo por estado.',
        sections: [detailSection('Estados', [context.done + ' hechas', context.inprog + ' activas', context.pending + ' pendientes', context.blocked + ' bloqueadas'])], missing: [], targetView: 'view-kanban'
      },
      'metric-git': {
        title: 'Git', value: (git.branch || state && state.meta && state.meta.branch || 'Sin rama'), summary: git.syncStatus || state && state.meta && state.meta.syncStatus || 'Estado de sincronización no informado.',
        sections: [detailSection('Snapshot', [Array.isArray(git.commits) ? (git.totalCount && git.totalCount > git.commits.length ? git.commits.length + ' de ' + git.totalCount + ' commits recientes' : (git.commits.length ? git.commits.length + ' commits recientes' : '0 commits visibles')) : 'Commits no informados', state && state.meta && state.meta.commit ? 'Commit actual: ' + String(state.meta.commit).substring(0, 7) : 'Commit actual no informado'])],
        missing: !(git.branch || git.syncStatus || (Array.isArray(git.commits) && git.commits.length)) ? [{ field: 'git', guidance: 'Añade branch, syncStatus o commits al objeto git.' }] : [], targetView: 'view-git'
      },
      'metric-phase-coverage': {
        title: 'Cobertura de fases', value: context.completedPhases + ' de ' + phases.length + ' fases', summary: (phases.length ? Math.round(context.completedPhases / phases.length * 100) : 0) + '% de las fases están cerradas.',
        sections: [detailSection('Fases', phases.map(function (phase) { return (phase.title || phase.id || 'Fase') + ' · ' + (phase.status || 'pending'); }))],
        missing: phases.length ? [] : [{ field: 'phases', guidance: 'Añade fases para calcular la cobertura.' }], targetView: 'view-phases'
      },
      'metric-active-workload': {
        title: 'Carga activa', value: context.activeWorkload + ' tareas', summary: context.inprog + ' en progreso · ' + context.blocked + (context.blocked === 1 ? ' bloqueada' : ' bloqueadas'),
        sections: [detailSection('Trabajo activo', (insights.tasks || []).filter(function (task) { return task.status === 'in-progress' || task.status === 'blocked'; }).map(function (task) { return (task.id || 'Tarea') + ' · ' + (task.title || 'Sin título') + ' · ' + task.status; }))],
        missing: [], targetView: 'view-kanban'
      },
      'metric-data-coverage': {
        title: 'Cobertura informativa', value: context.coverage + ' de 3 fuentes', summary: 'La interfaz solo muestra datos presentes; no se inventa información ausente.',
        sections: [detailSection('Fuentes disponibles', [(git.branch || git.syncStatus || (Array.isArray(git.commits) && git.commits.length)) ? 'Git disponible' : '', tree.length ? 'Tree disponible' : '', (graphNodes.length || graphEdges.length) ? 'Codegraph disponible' : ''])],
        missing: missingCoverage, targetView: null
      },
      'metric-insights': {
        title: 'Desglose de consumo y actividad por agente',
        value: (insights.tokenUsage && insights.tokenUsage.hasData ? formatNumber(insights.tokenUsage.totals.total) + ' tokens' : context.total + ' tareas analizadas'),
        summary: (insights.tokenUsage && insights.tokenUsage.hasData
          ? 'Telemetría de tokens por agente recopilada de OpenCode SDK. Desglose detallado y costos.'
          : 'Resumen derivado de estado, riesgos, responsables y etiquetas disponibles.'),
        customHtml: renderTokenDetailsTable(insights.tokenUsage),
        sections: [
          detailSection('Responsables', ownerLines),
          detailSection('Etiquetas', tagLines),
          detailSection('Riesgo', [
            'Bloqueos: ' + Math.max(0, finiteNumber(insights.blockers && insights.blockers.total, 0)),
            'Riesgo alto: ' + riskCount(insights, 'high'),
            'Riesgo medio: ' + riskCount(insights, 'med')
          ]),
          detailSection('Historial', insights.history && insights.history.length ? [insights.history.length + ' puntos disponibles', insights.forecast && insights.forecast.label || 'Pronóstico no disponible'] : [])
        ],
        missing: insights.history && insights.history.length ? [] : [{ field: 'meta.history', guidance: 'Añade historial acotado para mostrar tendencia y pronóstico.' }],
        targetView: null
      }
    };
  }

  function decorateMetricCards(hud) {
    if (!hud) return;
    hud.querySelectorAll(':scope > .metric-card').forEach(function (card) {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-haspopup', 'dialog');
      card.setAttribute('aria-expanded', 'false');
      card.setAttribute('data-metric-detail', card.id);
      var affordance = card.querySelector('.metric-details-affordance');
      if (!affordance) {
        affordance = card.ownerDocument.createElement('span');
        affordance.className = 'metric-details-affordance';
        affordance.textContent = 'Detalles';
        card.appendChild(affordance);
      }
    });
  }

  function renderOverviewDetail(dialog, model) {
    var content = dialog.querySelector('#overview-detail-content');
    dialog.querySelector('#overview-detail-title').textContent = model.title;
    dialog.querySelector('#overview-detail-value').textContent = model.value;
    dialog.querySelector('#overview-detail-summary').textContent = model.summary;
    var custom = model.customHtml || '';

    var sectionsHtml = '';
    if (model.sections && model.sections.length) {
      var sectionCards = model.sections.map(function (section) {
        if (!section.items.length) return '';
        var itemsHtml = section.items.map(function (item) {
          return '<li>' + esc(item) + '</li>';
        }).join('');
        return '<section class="overview-detail-section overview-meta-group">'
          + '<h3>' + esc(section.label) + '</h3>'
          + '<ul class="overview-meta-list">' + itemsHtml + '</ul>'
          + '</section>';
      }).filter(Boolean).join('');

      if (sectionCards) {
        sectionsHtml = '<div class="overview-detail-meta-strip">' + sectionCards + '</div>';
      }
    }

    var missingHtml = '';
    if (model.missing && model.missing.length) {
      missingHtml = '<section class="overview-detail-missing"><h3>Información no disponible</h3><p>No se inventa información ausente.</p><ul>'
        + model.missing.map(function (item) { return '<li><code>' + esc(item.field) + '</code> — ' + esc(item.guidance) + '</li>'; }).join('')
        + '</ul></section>';
    }

    var mainHtml = '';
    if (custom) {
      mainHtml = '<div class="overview-detail-main-custom">' + custom + '</div>';
    }

    content.innerHTML = mainHtml + sectionsHtml + missingHtml;

    var viewButton = dialog.querySelector('[data-overview-view-section]');
    viewButton.hidden = !model.targetView;
    viewButton.setAttribute('data-target-view', model.targetView || '');
  }

  function closeOverviewDetailDialog(doc) {
    var dialog = doc && doc.getElementById('overview-detail-dialog');
    if (!dialog) return;
    if (dialog.close) dialog.close();
    dialog.dataset.open = 'false';
    if (dialog._trigger) {
      dialog._trigger.setAttribute('aria-expanded', 'false');
      if (dialog._trigger.focus) dialog._trigger.focus();
    }
  }

  function bindOverviewDetails(doc, hud) {
    var dialog = doc.getElementById('overview-detail-dialog');
    if (!dialog || !hud) return;
    function open(card) {
      var model = hud._metricDetails && hud._metricDetails[card.id];
      if (!model) return;
      renderOverviewDetail(dialog, model);
      dialog._trigger = card;
      dialog.dataset.open = 'true';
      card.setAttribute('aria-expanded', 'true');
      if (dialog.showModal) dialog.showModal();
      (dialog.querySelector('[data-overview-close]') || dialog).focus();
    }
    if (hud.getAttribute('data-metric-details-bound') !== '1') {
      hud.setAttribute('data-metric-details-bound', '1');
      hud.addEventListener('click', function (event) { var card = event.target.closest && event.target.closest('[data-metric-detail]'); if (card && hud.contains(card)) open(card); });
      hud.addEventListener('keydown', function (event) { var card = event.target.closest && event.target.closest('[data-metric-detail]'); if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(card); } });
    }
    if (dialog.getAttribute('data-overview-dialog-bound') !== '1') {
      dialog.setAttribute('data-overview-dialog-bound', '1');
      dialog.querySelector('[data-overview-close]').addEventListener('click', function () { closeOverviewDetailDialog(doc); });
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeOverviewDetailDialog(doc);
      });
      dialog.querySelector('[data-overview-view-section]').addEventListener('click', function () { var target = this.getAttribute('data-target-view'); closeOverviewDetailDialog(doc); var tab = doc.querySelector('.tab-btn[data-target-view=\"' + target + '\"]'); if (tab) tab.click(); });
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeOverviewDetailDialog(doc); });
      dialog.addEventListener('keydown', function (event) {
        if (event.key !== 'Tab' || dialog.dataset.open !== 'true') return;
        var focusables = Array.prototype.slice.call(dialog.querySelectorAll('button, [href], [tabindex]')).filter(function (item) { return !item.hidden && !item.disabled && item.getAttribute('tabindex') !== '-1'; });
        if (!focusables.length) return;
        event.preventDefault();
        var index = focusables.indexOf(doc.activeElement);
        var next = event.shiftKey ? (index <= 0 ? focusables.length - 1 : index - 1) : (index === -1 || index === focusables.length - 1 ? 0 : index + 1);
        focusables[next].focus();
      });
    }
  }

  function label(key, state, fallback) {
    if (state && state.meta && state.meta.labels && state.meta.labels.es && typeof state.meta.labels.es[key] === 'string' && state.meta.labels.es[key]) {
      return state.meta.labels.es[key];
    }
    return fallback;
  }

  // Active clock interval ticker reference
  var _clockTicker = null;

  function padZero(num) {
    var s = String(num);
    return s.length < 2 ? '0' + s : s;
  }

  function getLocalTimezoneName() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        var parts = tz.split('/');
        return parts[parts.length - 1].replace(/_/g, ' ').toUpperCase();
      }
    } catch (_) {}
    return 'LOCAL';
  }

  function formatRelativeTime(date) {
    if (!date || isNaN(date.getTime())) return 'Recientemente';
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) diffMs = 0;
    var diffSec = Math.floor(diffMs / 1000);
    var diffMin = Math.floor(diffSec / 60);
    var diffHr = Math.floor(diffMin / 60);
    var diffDays = Math.floor(diffHr / 24);

    if (diffSec < 45) return 'Hace un momento';
    if (diffMin < 60) return 'Hace ' + (diffMin <= 1 ? '1 minuto' : diffMin + ' minutos');
    if (diffHr < 24) return 'Hace ' + (diffHr <= 1 ? '1 hora' : diffHr + ' horas');
    if (diffDays < 30) return 'Hace ' + (diffDays <= 1 ? '1 día' : diffDays + ' días');
    return date.toLocaleDateString();
  }

  function updateClockDisplay(doc, is24h) {
    if (!doc) return;
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var seconds = now.getSeconds();
    var period = '';

    if (!is24h) {
      period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 becomes 12
    }

    var hoursStr = padZero(hours);
    var minStr = padZero(minutes);
    var secStr = padZero(seconds);

    var elHours = doc.getElementById('clock-hours');
    var elMinutes = doc.getElementById('clock-minutes');
    var elSeconds = doc.getElementById('clock-seconds');
    var elPeriod = doc.getElementById('clock-period');
    var elDate = doc.getElementById('clock-date');
    var elTz = doc.getElementById('clock-timezone');
    var clockCard = doc.getElementById('tm-digital-clock');
    var formatTag = doc.getElementById('clock-format-tag');

    if (elHours) elHours.textContent = hoursStr;
    if (elMinutes) elMinutes.textContent = minStr;
    if (elSeconds) elSeconds.textContent = secStr;
    if (elPeriod) {
      elPeriod.textContent = period;
      elPeriod.style.display = is24h ? 'none' : 'inline-block';
    }
    if (formatTag) formatTag.textContent = is24h ? '24H' : '12H';
    if (clockCard) clockCard.setAttribute('data-clock-format', is24h ? '24h' : '12h');

    if (elDate) {
      try {
        var options = { weekday: 'short', month: 'short', day: 'numeric' };
        var dateFormatted = now.toLocaleDateString(undefined, options);
        // Capitalize first letter
        if (dateFormatted) {
          dateFormatted = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);
        }
        elDate.textContent = dateFormatted || now.toDateString();
      } catch (_) {
        elDate.textContent = now.toDateString();
      }
    }

    if (elTz && (!elTz.textContent || elTz.textContent === 'LOCAL')) {
      elTz.textContent = getLocalTimezoneName();
    }
  }

  function resolveLastUpdatedDate(state, doc) {
    var dates = [];
    // Check doc.lastModified (reflects actual file on disk modification)
    try {
      if (doc && doc.lastModified) {
        var dMod = new Date(doc.lastModified);
        if (!isNaN(dMod.getTime()) && dMod.getFullYear() > 2020) dates.push(dMod);
      }
    } catch (_) {}

    // Check meta timestamps: lastSyncCompletedAt, lastSyncAt, lastUpdated, updatedAt
    if (state && state.meta) {
      if (state.meta.lastSyncCompletedAt) {
        var dComp = new Date(state.meta.lastSyncCompletedAt);
        if (!isNaN(dComp.getTime())) dates.push(dComp);
      }
      if (state.meta.lastSyncAt) {
        var dSync = new Date(state.meta.lastSyncAt);
        if (!isNaN(dSync.getTime())) dates.push(dSync);
      }
      if (state.meta.lastUpdated) {
        var d1 = new Date(state.meta.lastUpdated);
        if (!isNaN(d1.getTime())) dates.push(d1);
      }
      if (state.meta.updatedAt) {
        var d2 = new Date(state.meta.updatedAt);
        if (!isNaN(d2.getTime())) dates.push(d2);
      }
    }

    // Check history items
    if (state && state.meta && Array.isArray(state.meta.history) && state.meta.history.length) {
      var latestHist = state.meta.history[state.meta.history.length - 1];
      if (latestHist && latestHist.timestamp) {
        var dHist = new Date(latestHist.timestamp);
        if (!isNaN(dHist.getTime())) dates.push(dHist);
      }
    }

    if (dates.length) {
      dates.sort(function (a, b) { return b.getTime() - a.getTime(); });
      return dates[0];
    }
    return new Date();
  }

  function renderHarness(state, doc) {
    if (!doc) return;
    var nameEl = doc.getElementById('harness-name');
    var roleEl = doc.getElementById('harness-role');
    var iconWrap = doc.getElementById('harness-icon');
    if (!nameEl) return;

    var harness = (state && state.meta && state.meta.harness) || 'OpenCode';
    var role = (state && state.meta && state.meta.harnessRole) || 'Autonomous Multi-Agent';

    nameEl.textContent = harness;
    if (roleEl) roleEl.textContent = role;

    if (iconWrap) {
      if (/claude/i.test(harness)) {
        iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#D97757"><path d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"/></svg>';
      } else if (/codex|openai/i.test(harness)) {
        iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457z"/></svg>';
      } else {
        iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
      }
    }
  }

  function renderLastUpdate(state, doc) {
    if (!doc) return;
    var elRel = doc.getElementById('last-update-relative');
    var elExact = doc.getElementById('last-update-exact');
    if (!elRel && !elExact) return;

    var date = resolveLastUpdatedDate(state, doc);
    if (elRel) {
      elRel.textContent = formatRelativeTime(date);
    }
    if (elExact) {
      try {
        var syncRaw = state && state.meta && state.meta.syncStatus;
        var syncLower = String(syncRaw || '').trim().toLowerCase();
        var isSynced = syncLower === 'synced' || syncLower === 'sincronizado';
        var timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        var dateStr = date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
        elExact.textContent = (isSynced ? '✓ ' : '') + dateStr + ' ' + timeStr;
      } catch (_) {
        elExact.textContent = date.toLocaleString();
      }
    }
  }

  function initDigitalClock(doc) {
    if (!doc) return;
    var clockCard = doc.getElementById('tm-digital-clock');
    if (!clockCard) return;

    var toggleBtn = doc.getElementById('btn-clock-toggle-format');
    var is24h = clockCard.getAttribute('data-clock-format') === '24h';

    // Immediate first tick
    updateClockDisplay(doc, is24h);

    if (toggleBtn && toggleBtn.getAttribute('data-clock-bound') !== '1') {
      toggleBtn.setAttribute('data-clock-bound', '1');
      toggleBtn.addEventListener('click', function () {
        var currentFmt = clockCard.getAttribute('data-clock-format');
        var nextIs24h = currentFmt !== '24h';
        clockCard.setAttribute('data-clock-format', nextIs24h ? '24h' : '12h');
        updateClockDisplay(doc, nextIs24h);
      });
    }

    // Set interval once if in real browser environment
    if (typeof setInterval === 'function' && !_clockTicker) {
      _clockTicker = setInterval(function () {
        if (!doc.defaultView || !doc.getElementById('tm-digital-clock')) {
          clearInterval(_clockTicker);
          _clockTicker = null;
          return;
        }
        var fmt = clockCard.getAttribute('data-clock-format') === '24h';
        updateClockDisplay(doc, fmt);
        var elRel = doc.getElementById('last-update-relative');
        if (elRel) {
          var date = resolveLastUpdatedDate(window.__TM_STATE__ || null, doc);
          elRel.textContent = formatRelativeTime(date);
        }
      }, 1000);
      if (_clockTicker && typeof _clockTicker.unref === 'function') {
        _clockTicker.unref();
      }
    }
  }

  /**
   * Render header panel from state.
   * Updates #project-title, header-meta badges.
   * @param {object} state
   * @param {Document} doc
   */
  function renderHeader(state, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !state || !state.meta) return;
    var meta = state.meta;

    // Title: projectName + version badge
    var titleEl = doc.getElementById('project-title');
    if (titleEl) {
      var nameRaw = meta.projectName || 'Proyecto';
      var versionRaw = meta.version || '';
      var spans = titleEl.querySelectorAll('span');
      if (spans.length >= 2) {
        spans[0].textContent = nameRaw;
        spans[1].textContent = versionRaw ? 'v' + versionRaw.replace(/^v/, '') : '';
        spans[1].style.display = versionRaw ? '' : 'none';
      } else {
        titleEl.innerHTML = '<span>' + esc(nameRaw) + '</span> ' + (versionRaw ? '<span class=\"badge\">v' + esc(versionRaw.replace(/^v/, '')) + '</span>' : '');
      }
    }

    // Dynamic digital clock, last update & harness card
    initDigitalClock(doc);
    renderLastUpdate(state, doc);
    renderHarness(state, doc);

    // Header meta: branch · commit and sync status
    var headerMeta = doc.querySelector('.header-meta');
    if (headerMeta) {
      var branchRaw = meta.branch || (state.git && state.git.branch) || '';
      var commitRaw = meta.commit || (state.git && state.git.commits && state.git.commits[0] && state.git.commits[0].hash) || '';
      commitRaw = commitRaw ? commitRaw.substring(0, 7) : '';
      var syncRaw = meta.syncStatus || (state.git && state.git.syncStatus) || '';

      var badges = headerMeta.querySelectorAll('.badge');
      if (badges.length >= 1) {
        var branchCommitText = '';
        if (branchRaw || commitRaw) {
          branchCommitText = (branchRaw ? branchRaw : '—') + (commitRaw ? ' · ' + commitRaw : '');
        } else {
          branchCommitText = '—';
        }
        var firstBadge = badges[0];
        var dot = firstBadge.querySelector('.badge-dot');
        if (dot) {
          var toRemove = [];
          firstBadge.childNodes.forEach(function (n) {
            if (n !== dot && n.nodeType === 3) toRemove.push(n);
          });
          toRemove.forEach(function (n) { firstBadge.removeChild(n); });
          firstBadge.appendChild(doc.createTextNode(' ' + branchCommitText));
        } else {
          firstBadge.textContent = branchCommitText;
        }
      }
      if (badges.length >= 2) {
        var syncBadge = badges[1];
        var syncText = syncRaw;
        var syncLower = String(syncRaw || '').trim().toLowerCase();
        if (syncLower === 'running' || syncLower === 'sincronizando') {
          syncText = 'Sincronizando...';
        } else if (syncLower === 'synced') {
          syncText = 'Sincronizado';
        } else if (syncLower === 'error') {
          syncText = 'Error';
        } else if (!syncText) {
          syncText = '—';
        }
        var dot2 = syncBadge.querySelector('.badge-dot');
        if (dot2) {
          if (syncLower === 'running' || syncLower === 'sincronizando') {
            dot2.className = 'badge-dot inprogress';
          } else if (syncLower === 'error') {
            dot2.className = 'badge-dot blocked';
          } else if (syncLower === 'synced' || syncLower === 'sincronizado') {
            dot2.className = 'badge-dot completed';
          }
          var removes = [];
          syncBadge.childNodes.forEach(function (n) { if (n !== dot2 && n.nodeType === 3) removes.push(n); });
          removes.forEach(function (n) { syncBadge.removeChild(n); });
          syncBadge.appendChild(doc.createTextNode(' ' + syncText));
        } else {
          syncBadge.textContent = syncText;
        }
      }
    }
    renderSyncStatus(state, doc);
  }

  /**
   * Render HUD metrics. Pure derived from state+metrics, updates #metrics-overview.
   * Overwrites legacy hardcoded 68% etc.
   * @param {object} state
   * @param {{overallPct:number,total:number,completed:number,distribution:object,perPhase:Array}} metrics
   * @param {Document} doc
   * @param {object} suppliedInsights
   */
  function renderHud(state, metrics, doc, suppliedInsights) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    var core = getCore();
    if (!metrics && core && state) {
      metrics = core.deriveMetrics(state);
    }
    if (!metrics) metrics = { overallPct: 0, total: 0, completed: 0, distribution: { completed: 0, pending: 0, inprogress: 0, blocked: 0 }, perPhase: [] };
    var insights = resolveInsights(state, metrics, core, suppliedInsights);

    var overallLabel = label('overallProgress', state, 'Progreso Global');
    var hud = doc.getElementById('metrics-overview');
    if (!hud) hud = doc.querySelector('.metrics-grid');
    if (!hud) return;

    var total = Math.max(0, Math.round(finiteNumber(metrics.total, 0)));
    var completed = clamp(Math.round(finiteNumber(metrics.completed, 0)), 0, total);
    var overallPct = clamp(Math.round(finiteNumber(metrics.overallPct, 0)), 0, 100);
    var dist = metrics.distribution || { completed: 0, pending: 0, inprogress: 0, blocked: 0 };
    var pending = dist.pending || 0;
    var inprog = dist.inprogress || dist['in-progress'] || 0;
    var blocked = dist.blocked || 0;
    var done = dist.completed || 0;
    var riskTasks = (insights && Array.isArray(insights.tasks) ? insights.tasks : []).filter(function (task) {
      return task && (task.risk === 'high' || task.status === 'blocked');
    });
    var blockerSummary = riskTasks.map(function (task) {
      return esc((task.id || 'Task') + ': ' + (task.blockedReason || task.title || 'Requires attention'));
    }).join(' · ');

    // Determine current focus phase: first in-progress, else first pending, else last completed, else placeholder
    var focusTitle = 'Sin fase';
    var focusPhase = null;
    var focusPct = 0;
    if (state && Array.isArray(state.phases) && state.phases.length) {
      for (var i = 0; i < state.phases.length; i++) {
        if (state.phases[i].status === 'in-progress') { focusPhase = state.phases[i]; break; }
      }
      if (!focusPhase) {
        for (var j = 0; j < state.phases.length; j++) {
          if (state.phases[j].status === 'pending') { focusPhase = state.phases[j]; break; }
        }
      }
      if (!focusPhase) focusPhase = state.phases[state.phases.length - 1];
      if (focusPhase) {
        focusTitle = esc(focusPhase.title || ('Fase ' + (focusPhase.number || '')));
        var matchedPer = metrics.perPhase.find(function(p){ return p.id === focusPhase.id; });
        focusPct = matchedPer ? clamp(matchedPer.pct, 0, 100) : 0;
      }
    }

    var gitBranch = esc((state && state.meta && state.meta.branch) || (state && state.git && state.git.branch) || '—');
    var statusOverallBadge = overallPct === 100 ? 'Completado' : overallPct > 0 ? 'En Progreso' : 'Pendiente';
    var statusOverallClass = overallPct === 100 ? 'badge-completed' : overallPct > 0 ? 'badge-inprogress' : 'badge-pending';
    var phases = state && Array.isArray(state.phases) ? state.phases : [];
    var completedPhases = phases.filter(function (phase) { return phase && phase.status === 'completed'; }).length;
    var activeWorkload = inprog + blocked;
    var coverage = optionalDataCoverage(state);

    var html = ''
      + '<div class="metric-card accent-amber" id="metric-overview-risk">'
      + '<div class="panel-title">Riesgos y bloqueos</div>'
      + '<div style="font-size:20px;font-weight:700;color:#fff;">' + riskTasks.length + (riskTasks.length === 1 ? ' requiere atención' : ' requieren atención') + '</div>'
      + '<div style="font-size:11.5px;color:' + (riskTasks.length ? 'var(--accent-red)' : 'var(--accent-green)') + ';">' + (riskTasks.length ? blockerSummary : '✓ Sin bloqueos ni riesgos críticos') + '</div>'
      + '</div>'
      + '<div class="metric-card accent-blue" id="metric-overall-card">'
      + '<div class="panel-title metric-title-row">'
      + '<span>' + esc(overallLabel) + '</span>'
      + '<span class="badge ' + statusOverallClass + '">' + statusOverallBadge + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">'
      + '<div style="font-size:28px;font-weight:700;color:#fff;font-family:var(--font-mono);letter-spacing:-0.02em;" id="overall-progress-num">' + overallPct + '%</div>'
      + '<div style="font-size:12px;color:var(--text-tertiary);"><span id="stat-completed-count">' + completed + '</span> de <span id="stat-total-count">' + total + '</span> tareas</div>'
      + '</div>'
      + '<div class="progress-track"><div id="overall-progress-bar" class="progress-bar inprogress" style="width:' + overallPct + '%;"></div></div>'
      + '<div class="metric-card-footer-row" style="font-size:11.5px;color:var(--text-tertiary);display:flex;justify-content:space-between;align-items:center;padding-right:72px;">'
      + '<span>' + completed + ' completadas</span>'
      + '<span>' + (total - completed) + ' restantes</span>'
      + '</div>'
      + '</div>'

      + '<div class="metric-card accent-purple" id="metric-current-focus">'
      + '<div class="panel-title metric-title-row">'
      + '<span>Fase Actual</span>'
      + (focusPhase && focusPhase.target ? '<span class="badge badge-tag">' + esc(focusPhase.target) + '</span>' : '')
      + '</div>'
      + '<div style="font-size:16px;font-weight:600;color:#fff;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" id="current-focus-title">' + focusTitle + '</div>'
      + '<div class="progress-track"><div style="width:' + focusPct + '%;height:100%;background:var(--accent-purple);border-radius:4px;transition:width 0.35s;"></div></div>'
      + '<div class="metric-card-footer-row" style="font-size:11.5px;color:var(--text-tertiary);display:flex;justify-content:space-between;align-items:center;padding-right:72px;">'
      + '<span>' + (focusPhase && focusPhase.lead ? 'Lead: ' + esc(focusPhase.lead) : 'Sprint activo') + '</span>'
      + '<span style="font-family:var(--font-mono);">' + focusPct + '%</span>'
      + '</div>'
      + '</div>'

      + '<div class="metric-card accent-green" id="metric-distribution">'
      + '<div class="panel-title">Distribución</div>'
      + '<div class="distribution-badges">'
      + '<span class="badge badge-completed"><span class="badge-dot completed"></span> ' + done + ' Hechas</span>'
      + '<span class="badge badge-inprogress"><span class="badge-dot inprogress"></span> ' + inprog + ' Activas</span>'
      + '<span class="badge badge-pending"><span class="badge-dot pending"></span> ' + pending + ' Pendientes</span>'
      + '<span class="badge badge-blocked"><span class="badge-dot blocked"></span> ' + blocked + ' Bloqueadas</span>'
      + '</div>'
      + (blocked > 0 ? '<div class="distribution-risk-warning" style="font-size:11.5px;color:var(--accent-red);margin-top:4px;display:flex;align-items:center;gap:4px;"><span class="badge-dot blocked"></span> ' + blocked + ' bloqueada(s) requiere(n) atención</div>' : '<div style="font-size:11.5px;color:var(--accent-green);margin-top:4px;">✓ Sin bloqueos activos</div>')
      + '</div>'

      + '<div class="metric-card accent-amber" id="metric-git">'
      + '<div class="panel-title metric-title-row">'
      + '<span>Git</span>'
      + '<span class="badge badge-tag" style="color:var(--accent-amber);border-color:rgba(210,153,34,0.3);">' + ((state && state.git && state.git.syncStatus) || 'Synced') + '</span>'
      + '</div>'
      + '<div style="font-size:13px;color:#fff;font-family:var(--font-mono);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">branch: ' + esc(gitBranch) + '</div>'
      + '<div style="font-size:11.5px;color:var(--text-tertiary);margin-top:2px;">' + total + ' tareas totales · ' + phases.length + ' fases</div>'
      + '</div>'

      + '<div class="metric-card accent-green" id="metric-phase-coverage">'
      + '<div class="panel-title">Cobertura de fases</div>'
      + '<div class="metric-summary-value">' + completedPhases + ' de ' + phases.length + ' fases</div>'
      + '<div class="metric-summary-copy">' + (phases.length ? Math.round(completedPhases / phases.length * 100) : 0) + '% cerradas · ' + Math.max(0, phases.length - completedPhases) + ' por completar</div>'
      + '</div>'

      + '<div class="metric-card accent-blue" id="metric-active-workload">'
      + '<div class="panel-title">Carga activa</div>'
      + '<div class="metric-summary-value">' + activeWorkload + ' tareas</div>'
      + '<div class="metric-summary-copy">' + inprog + ' en progreso · ' + blocked + ' bloqueadas</div>'
      + '</div>'

      + '<div class="metric-card accent-purple" id="metric-data-coverage">'
      + '<div class="panel-title">Cobertura informativa</div>'
      + '<div class="metric-summary-value">' + coverage + ' de 3 fuentes</div>'
      + '<div class="metric-summary-copy">Git · árbol · Codegraph según datos disponibles</div>'
      + '</div>'

      + '<div class="metric-card accent-blue metric-insights-band" id="metric-insights" data-tm-capability="token-insights-v2">'
      + '<div class="panel-title" style="grid-column:1 / -1;">Desglose de consumo y actividad por agente</div>'
      + '<div class="insight-band-stack">'
      + '<div class="insight-band-region insight-tokens-main">'
      + '<div class="insight-tokens-header">'
      + '<span class="insight-region-label">' + (insights.tokenUsage && insights.tokenUsage.source === 'activity-estimation' ? 'Estimación de Actividad por Agente' : 'Telemetría de Tokens por Agente') + '</span>'
      + (function () {
        var tokenUsage = insights.tokenUsage || { hasData: false, totals: { total: 0 } };
        if (tokenUsage.hasData) {
          var isAct = tokenUsage.source === 'activity-estimation';
          var totals = tokenUsage.totals;
          var cacheShare = (!isAct && totals.total > 0 && totals.cacheRead > 0) ? Math.round(totals.cacheRead / totals.total * 100) : 0;
          return '<div class="insight-tokens-summary-chips">'
            + '<span class="token-chip token-chip-total">' + formatCompactTokens(totals.total) + (isAct ? ' u. activ.' : ' tokens') + '</span>'
            + '<span class="token-chip">' + tokenUsage.byAgent.length + ' agentes</span>'
            + (cacheShare > 0 ? '<span class="token-chip">' + cacheShare + '% caché</span>' : '')
            + (totals.cost !== undefined ? '<span class="token-chip">$' + totals.cost.toFixed(3) + '</span>' : '')
            + (isAct ? '<span class="token-chip token-chip-estimate">Estimación por actividad</span>' : '')
            + (tokenUsage.isStale ? '<span class="token-chip token-chip-stale">⚠️ Desactualizado (&gt;24h)</span>' : '')
            + '</div>';
        }
        return '<div class="insight-tokens-summary-chips"><span class="token-chip">Sin telemetría</span></div>';
      })()
      + '</div>'
      + renderTokenChart(insights.tokenUsage)
      + '</div>'
      + '<div class="insight-band-region insight-meta-strip insight-side-rail">'
      + '<div class="insight-subregion insight-owners"><span class="insight-region-label">Owners</span>' + renderDimensionLines(insights.dimensions && insights.dimensions.owner) + '</div>'
      + '<div class="insight-subregion insight-tags"><span class="insight-region-label">Tags</span>' + renderDimensionLines(insights.dimensions && insights.dimensions.tag) + '</div>'
      + '</div>'
      + '</div>'
      + '</div>';

    hud.innerHTML = html;
    hud._metricDetails = buildMetricDetailModels(state, metrics, insights, { overallLabel: overallLabel, total: total, completed: completed, overallPct: overallPct, pending: pending, inprog: inprog, blocked: blocked, done: done, riskTasks: riskTasks, focusPhase: focusPhase, focusPct: focusPct, completedPhases: completedPhases, activeWorkload: activeWorkload, coverage: coverage });
    decorateMetricCards(hud);
    bindOverviewDetails(doc, hud);
  }

  /**
   * Setup Navigation Tabs & Global Search events
   * @param {Document} doc
   */
  function setupNavTabs(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    var tabButtons = doc.querySelectorAll('.tab-btn[data-target-view]');
    var core = getCore();
    var storage = core && typeof core.storageForDocument === 'function' ? core.storageForDocument(doc) : null;
    var store = core && typeof core.createUiPreferenceStore === 'function' ? core.createUiPreferenceStore(storage) : null;
    var preferences = store ? store.load() : null;
    function isEditable(target) {
      return !!(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(target.tagName) !== -1));
    }
    function activateView(targetId) {
      var currentTabButtons = doc.querySelectorAll('.tab-btn[data-target-view]');
      var targetButton = Array.prototype.find.call(currentTabButtons, function (button) { return button.getAttribute('data-target-view') === targetId; });
      if (!targetButton) return;
      currentTabButtons.forEach(function (b) {
        var active = b === targetButton;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      doc.querySelectorAll('.view-container').forEach(function (view) {
        var active = view.id === targetId;
        view.hidden = !active;
        view.style.display = active ? 'flex' : 'none';
      });
      var hud = doc.getElementById('metrics-overview');
      if (hud) { var overview = targetId === 'view-overview'; hud.hidden = !overview; hud.style.display = overview ? '' : 'none'; }
      if (store && preferences) { preferences.activeView = targetId.replace(/^view-/, ''); preferences = store.save(preferences); }
    }
    var initialTarget = doc.querySelector('.tab-btn.active[data-target-view]');
    var initialOverview = !initialTarget || initialTarget.getAttribute('data-target-view') === 'view-overview';
    var initialHud = doc.getElementById('metrics-overview');
    if (initialHud) {
      initialHud.hidden = !initialOverview;
      initialHud.style.display = initialOverview ? '' : 'none';
    }
    tabButtons.forEach(function (btn) {
      if (btn.getAttribute('data-tab-bound') === '1') return;
      btn.setAttribute('data-tab-bound', '1');

      btn.addEventListener('click', function () {
        activateView(btn.getAttribute('data-target-view'));
      });
    });

    // Global search input
    var searchInput = doc.getElementById('global-search-input');
    if (searchInput && searchInput.getAttribute('data-search-bound') !== '1') {
      searchInput.setAttribute('data-search-bound', '1');
      searchInput.addEventListener('input', function () {
        var query = searchInput.value.trim().toLowerCase();
        var phaseApi = (typeof window !== 'undefined' && window.TMPhases) || (typeof globalThis !== 'undefined' && globalThis.TMPhases);
        if (phaseApi && typeof phaseApi.setFilter === 'function') phaseApi.setFilter({ text: query }, doc);
        else doc.querySelectorAll('.task-item').forEach(function (item) {
          item.style.display = !query || item.textContent.toLowerCase().indexOf(query) !== -1 ? '' : 'none';
        });
      });
    }

    // Keyboard shortcuts: 1-7 for tabs
    if (doc.documentElement.getAttribute('data-tm-keyboard-bound') !== '1') {
      doc.documentElement.setAttribute('data-tm-keyboard-bound', '1');
      doc.addEventListener('keydown', function (e) {
        if (isEditable(e.target)) return;
        var num = parseInt(e.key, 10);
        if (num >= 1 && num <= 7) {
          var btns = doc.querySelectorAll('.tab-btn[data-target-view]');
          var targetBtn = btns[num - 1];
          if (targetBtn) activateView(targetBtn.getAttribute('data-target-view'));
        } else if (e.key === 'e' || e.key === 'E') {
          var expandBtn = doc.getElementById('btn-expand-all');
          if (expandBtn) expandBtn.click();
        } else if (e.key === '/') {
          e.preventDefault();
          if (searchInput) searchInput.focus();
        }
      });
    }
  }

  /**
   * Render Synchronization Status Overlay / Banner.
   * Truthful, state-driven representation of running, error, or idle/synced states.
   * @param {object} state
   * @param {Document} doc
   */
  function renderSyncStatus(state, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    var banner = doc.getElementById('tm-sync-banner');
    if (!banner) return;

    var meta = (state && state.meta) || {};
    var rawStatus = String(meta.syncStatus || '').trim().toLowerCase();
    var lastError = meta.lastError || '';

    if (rawStatus === 'running' || rawStatus === 'sincronizando' || rawStatus === 'sincronizando...') {
      banner.hidden = false;
      banner.removeAttribute('hidden');
      banner.style.display = 'flex';
      banner.className = 'sync-banner sync-running';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = '<div class=\"sync-energy-beam\" aria-hidden=\"true\"></div>'
        + '<div class=\"sync-glow-sweep\" aria-hidden=\"true\"></div>'
        + '<div class=\"sync-banner-content\">'
        + '<div class=\"sync-signal-cluster\" aria-hidden=\"true\">'
        + '<span class=\"sync-signal-node\"></span>'
        + '<span class=\"sync-signal-node\"></span>'
        + '<span class=\"sync-signal-node\"></span>'
        + '<span class=\"sync-signal-node\"></span>'
        + '</div>'
        + '<div class=\"sync-banner-text\">'
        + '<div class=\"sync-banner-header-row\">'
        + '<span class=\"sync-agent-badge\">Agent Task Manager</span>'
        + '<span class=\"sync-banner-title\">Sincronización en curso en segundo plano</span>'
        + '</div>'
        + '<span class=\"sync-banner-subtitle\">Analizando el workspace y sincronizando el estado técnico. Si no ves los cambios al terminar, presiona <kbd class=\"sync-kbd\">F5</kbd> para recargar.</span>'
        + '</div>'
        + '</div>';
    } else if (rawStatus === 'prolonged' || rawStatus === 'prolongado') {
      banner.hidden = false;
      banner.removeAttribute('hidden');
      banner.style.display = 'flex';
      banner.className = 'sync-banner sync-prolonged';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = '<div class=\"sync-banner-content\">'
        + '<div class=\"sync-segmented-rail\" aria-hidden=\"true\">'
        + '<span class=\"sync-rail-seg\"></span>'
        + '<span class=\"sync-rail-seg\"></span>'
        + '<span class=\"sync-rail-seg\"></span>'
        + '<span class=\"sync-rail-seg\"></span>'
        + '<span class=\"sync-rail-seg\"></span>'
        + '<span class=\"sync-rail-seg\"></span>'
        + '</div>'
        + '<div class=\"sync-banner-text\">'
        + '<div class=\"sync-banner-header-row\">'
        + '<span class=\"sync-agent-badge\" style=\"color:#7dd3fc;background:rgba(56,189,248,0.14);border-color:rgba(56,189,248,0.35);\">Agent Task Manager</span>'
        + '<span class=\"sync-banner-title\">Procesando sincronización en segundo plano</span>'
        + '</div>'
        + '<span class=\"sync-banner-subtitle\">El agente sigue procesando el workspace de forma autónoma. La tarea puede tardar unos momentos más; cuando finalice, presiona <kbd class=\"sync-kbd\">F5</kbd> para ver el estado actualizado.</span>'
        + '</div>'
        + '</div>';
    } else if (rawStatus === 'error') {
      banner.hidden = false;
      banner.removeAttribute('hidden');
      banner.style.display = 'flex';
      banner.className = 'sync-banner sync-error';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'assertive');
      var errText = lastError ? lastError : 'No se pudo completar la sincronización automática.';
      banner.innerHTML = '<div class=\"sync-banner-content\">'
        + '<div class=\"sync-error-icon-box\" aria-hidden=\"true\">⚠️</div>'
        + '<div class=\"sync-banner-text\">'
        + '<div class=\"sync-banner-header-row\">'
        + '<span class=\"sync-agent-badge\" style=\"color:#ff7b72;background:rgba(248,81,73,0.15);border-color:rgba(248,81,73,0.4);\">Agent Task Manager</span>'
        + '<span class=\"sync-banner-title\">Error en la sincronización del Task Manager</span>'
        + '</div>'
        + '<span class=\"sync-banner-subtitle\">' + esc(errText) + ' — Abre Plugins → Task Manager para reintentar.</span>'
        + '</div>'
        + '</div>';
    } else {
      // Synced / Idle / unknown -> hide banner
      banner.hidden = true;
      banner.setAttribute('hidden', '');
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }

  /**
   * Combined render for convenience
   * @param {object} state
   * @param {Document} doc
   */
  function renderAll(state, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !state) return;
    var core = getCore();
    var context = core && typeof core.createBootstrapContext === 'function' ? core.createBootstrapContext(doc, state) : null;
    var immutableState = context && context.state || state;
    var metrics = core ? core.deriveMetrics(immutableState) : null;
    var insights = context && context.viewModels || (core && typeof core.deriveInsights === 'function' ? core.deriveInsights(immutableState) : null);
    renderHeader(immutableState, doc);
    renderHud(immutableState, metrics, doc, insights);
    renderSyncStatus(immutableState, doc);
    setupNavTabs(doc);
    return context;
  }

  var TMHeaderHud = {
    renderHeader: renderHeader,
    renderHud: renderHud,
    renderSyncStatus: renderSyncStatus,
    initDigitalClock: initDigitalClock,
    renderLastUpdate: renderLastUpdate,
    renderHarness: renderHarness,
    updateClockDisplay: updateClockDisplay,
    closeOverviewDetailDialog: closeOverviewDetailDialog,
    setupNavTabs: setupNavTabs,
    activateView: function (targetId, doc) { setupNavTabs(doc); var button = doc.querySelector('.tab-btn[data-target-view=\"' + targetId + '\"]'); if (button) button.click(); },
    renderAll: renderAll
  };

  try { if (typeof window !== 'undefined') window.TMHeaderHud = TMHeaderHud; } catch (_) {}
  try { if (typeof globalThis !== 'undefined') globalThis.TMHeaderHud = TMHeaderHud; } catch (_) {}
  try { if (typeof global !== 'undefined') global.TMHeaderHud = TMHeaderHud; } catch (_) {}
  try { if (typeof module !== 'undefined' && module.exports) module.exports = TMHeaderHud; } catch (_) {}

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
