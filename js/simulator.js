/**
 * Erlangly Workforce Planning Simulator (js/simulator.js)
 * 
 * Features:
 * - Multi-period what-if strategic simulation
 * - Attrition & hiring ramp with productivity nesting delay
 * - Multi-scenario comparison visualizer (Chart.js)
 * - Breach detection (first period SLA drops or budget exceeds)
 * - Plain-language executive narrative generator
 * - Plan persistence & CSV export
 */

(function() {
  'use strict';

  // --- Default Predefined Scenarios ---
  var DEFAULT_SCENARIOS = [
    {
      id: 0,
      name: 'Status Quo (Moderate Hiring)',
      startVol: 45000,
      startAht: 210,
      volGrowth: 2.0,       // +2%/mo
      ahtDrift: 0.0,        // 0%
      startingHeadcount: 85,
      monthlyAttrition: 3.5,// 3.5%/mo
      monthlyHires: 4,      // 4 hires/mo
      nestingLag: 1,        // 1 month nesting (50% efficiency)
      hourlyRate: 25.00,
      budgetCap: 380000,
      shrinkage: 0.30,
      targetSLA: 0.80,
      targetTime: 20
    },
    {
      id: 1,
      name: 'Aggressive Hiring & Scale',
      startVol: 45000,
      startAht: 210,
      volGrowth: 3.5,       // +3.5%/mo
      ahtDrift: -0.5,       // -0.5%/mo efficiency gain
      startingHeadcount: 85,
      monthlyAttrition: 3.5,
      monthlyHires: 8,      // 8 hires/mo
      nestingLag: 1,
      hourlyRate: 25.00,
      budgetCap: 450000,
      shrinkage: 0.30,
      targetSLA: 0.80,
      targetTime: 20
    },
    {
      id: 2,
      name: 'Hiring Freeze (Budget Capped)',
      startVol: 45000,
      startAht: 210,
      volGrowth: 2.0,
      ahtDrift: 0.5,        // +0.5%/mo burnout drift
      startingHeadcount: 85,
      monthlyAttrition: 4.0,// higher attrition
      monthlyHires: 0,      // 0 hires
      nestingLag: 0,
      hourlyRate: 25.00,
      budgetCap: 340000,
      shrinkage: 0.30,
      targetSLA: 0.80,
      targetTime: 20
    }
  ];

  // --- State ---
  var state = {
    activeScenarioIdx: 0,
    horizon: 12, // 12 months
    scenarios: JSON.parse(JSON.stringify(DEFAULT_SCENARIOS)),
    simResults: [], // per-scenario results
    chart: null
  };

  // --- DOM References ---
  var scenarioTabBar = document.getElementById('scenario-tab-bar');
  var selectSimHorizon = document.getElementById('select-sim-horizon');
  var activeScenarioNameBadge = document.getElementById('active-scenario-name-badge');
  var btnResetScenario = document.getElementById('btn-reset-scenario-levers');
  var btnSimulate = document.getElementById('btn-simulate');

  var inputScenarioName = document.getElementById('input-scenario-name');
  var numBaseVol = document.getElementById('num-base-vol');
  var numBaseAht = document.getElementById('num-base-aht');
  var numVolGrowth = document.getElementById('num-vol-growth');
  var numAhtDrift = document.getElementById('num-aht-drift');
  var numStartingHeadcount = document.getElementById('num-starting-headcount');
  var numMonthlyAttrition = document.getElementById('num-monthly-attrition');
  var numMonthlyHires = document.getElementById('num-monthly-hires');
  var selectNestingLag = document.getElementById('select-nesting-lag');
  var numSimHourlyRate = document.getElementById('num-sim-hourly-rate');
  var numBudgetCap = document.getElementById('num-budget-cap');

  var simBreachText = document.getElementById('sim-breach-text');
  var simBreachSub = document.getElementById('sim-breach-sub');
  var cardBreachPeriod = document.getElementById('card-breach-period');
  var simBudgetBreachText = document.getElementById('sim-budget-breach-text');
  var simBudgetSub = document.getElementById('sim-budget-sub');
  var cardBudgetBreach = document.getElementById('card-budget-breach');
  var simTotalSpend = document.getElementById('sim-total-spend');
  var simTotalSpendSub = document.getElementById('sim-total-spend-sub');
  var simAvgSla = document.getElementById('sim-avg-sla');
  var simEndingGap = document.getElementById('sim-ending-gap');
  var simGapSub = document.getElementById('sim-gap-sub');

  var canvasSimulatorChart = document.getElementById('chart-simulator-comparison');
  var narrativeSummaryText = document.getElementById('narrative-summary-text');
  var btnCopyNarrative = document.getElementById('btn-copy-narrative');
  var lblTableScenarioTitle = document.getElementById('lbl-table-scenario-title');
  var tbodySimProjection = document.getElementById('tbody-sim-projection');

  var btnSaveScenario = document.getElementById('btn-save-scenario');
  var btnExportScenarioCSV = document.getElementById('btn-export-scenario-csv');

  // --- Incoming Handoff Handler (from plans / shared link) ---
  function checkIncomingHandoff() {
    var params = new URLSearchParams(window.location.search);

    // Shared read-only link — restore scenario from URL-encoded data
    if (params.get('shared') === '1' && window.ERLANGLY_SHARED_DATA) {
      var sd = window.ERLANGLY_SHARED_DATA;
      if (sd && typeof sd === 'object') {
        state.scenarios[state.activeScenarioIdx] = Object.assign(state.scenarios[state.activeScenarioIdx], sd);
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Shared scenario loaded (read-only preview)', 'info');
        }
      }
      return;
    }

    var from = params.get('from');
    if (from === 'plans') {
      var handoff = ErlanglyUtils.getHandoff('simulation');
      if (handoff) {
        state.scenarios[state.activeScenarioIdx] = handoff;
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Loaded saved scenario: ' + handoff.name, 'success');
        }
      }
    }
  }

  // --- Initialization ---
  function init() {
    setupEventListeners();
    checkIncomingHandoff();
    loadScenarioForm(state.activeScenarioIdx);
    runAllSimulations();
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    // Tab Bar
    scenarioTabBar.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        scenarioTabBar.querySelectorAll('button').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
        btn.className = 'btn btn-sm btn-primary';
        state.activeScenarioIdx = parseInt(btn.getAttribute('data-scenario'), 10) || 0;
        loadScenarioForm(state.activeScenarioIdx);
        updateActiveScenarioView();
      });
    });

    selectSimHorizon.addEventListener('change', function() {
      state.horizon = parseInt(selectSimHorizon.value, 10) || 12;
      runAllSimulations();
    });

    // Form inputs change -> live recalculate
    var formInputs = [
      inputScenarioName, numBaseVol, numBaseAht, numVolGrowth, numAhtDrift,
      numStartingHeadcount, numMonthlyAttrition, numMonthlyHires,
      selectNestingLag, numSimHourlyRate, numBudgetCap
    ];
    formInputs.forEach(function(input) {
      input.addEventListener('input', function() {
        syncFormToState();
        runAllSimulations();
      });
      input.addEventListener('change', function() {
        syncFormToState();
        runAllSimulations();
      });
    });

    btnSimulate.addEventListener('click', function() {
      syncFormToState();
      runAllSimulations();
      ErlanglyUtils.showToast('Re-ran multi-period scenario simulation', 'success');
    });

    btnResetScenario.addEventListener('click', function() {
      state.scenarios[state.activeScenarioIdx] = JSON.parse(JSON.stringify(DEFAULT_SCENARIOS[state.activeScenarioIdx]));
      loadScenarioForm(state.activeScenarioIdx);
      runAllSimulations();
      ErlanglyUtils.showToast('Reset scenario levers to defaults', 'info');
    });

    // Copy Narrative
    btnCopyNarrative.addEventListener('click', function() {
      if (navigator.clipboard && narrativeSummaryText.textContent) {
        navigator.clipboard.writeText(narrativeSummaryText.textContent).then(function() {
          ErlanglyUtils.showToast('Copied executive narrative to clipboard!', 'success');
        });
      }
    });

    // Save Scenario to Plans
    btnSaveScenario.addEventListener('click', function() {
      var current = state.scenarios[state.activeScenarioIdx];
      var res = state.simResults[state.activeScenarioIdx];
      if (typeof ErlanglyPlans !== 'undefined') {
        ErlanglyPlans.showSaveModal('simulation', current, res);
      } else {
        ErlanglyUtils.showToast('Persistence engine ready', 'info');
      }
    });

    // Export Scenario CSV
    btnExportScenarioCSV.addEventListener('click', function() {
      var activeRes = state.simResults[state.activeScenarioIdx];
      if (!activeRes || !activeRes.periods) return;

      var headers = ['Month', 'Volume', 'AHT_Sec', 'Required_Staff', 'Productive_Staff', 'Headcount_Gap', 'Projected_SLA_Pct', 'ASA_Sec', 'Labor_Cost', 'Status'];
      var rows = activeRes.periods.map(function(p) {
        return [
          p.periodName,
          Math.round(p.volume),
          Math.round(p.aht),
          p.requiredStaff,
          p.productiveStaff,
          p.gap,
          (p.sla * 100).toFixed(1) + '%',
          p.asa.toFixed(1),
          '$' + Math.round(p.cost).toLocaleString(),
          p.status
        ];
      });
      ErlanglyUtils.exportCSV('scenario_simulation_' + (state.activeScenarioIdx + 1) + '.csv', headers, rows);
    });
  }

  function loadScenarioForm(idx) {
    var sc = state.scenarios[idx];
    if (!sc) return;

    activeScenarioNameBadge.textContent = 'Scenario ' + String.fromCharCode(65 + idx);
    lblTableScenarioTitle.textContent = sc.name;

    inputScenarioName.value = sc.name;
    numBaseVol.value = sc.startVol;
    numBaseAht.value = sc.startAht;
    numVolGrowth.value = sc.volGrowth;
    numAhtDrift.value = sc.ahtDrift;
    numStartingHeadcount.value = sc.startingHeadcount;
    numMonthlyAttrition.value = sc.monthlyAttrition;
    numMonthlyHires.value = sc.monthlyHires;
    selectNestingLag.value = String(sc.nestingLag);
    numSimHourlyRate.value = sc.hourlyRate.toFixed(2);
    numBudgetCap.value = sc.budgetCap;

    // Update tab text in case scenario name changed
    var tabBtn = scenarioTabBar.querySelector('button[data-scenario="' + idx + '"]');
    if (tabBtn) {
      tabBtn.textContent = 'Scenario ' + String.fromCharCode(65 + idx) + ': ' + sc.name.substring(0, 16);
    }
  }

  function syncFormToState() {
    var sc = state.scenarios[state.activeScenarioIdx];
    if (!sc) return;

    sc.name = inputScenarioName.value.trim() || ('Scenario ' + String.fromCharCode(65 + state.activeScenarioIdx));
    sc.startVol = Math.max(100, parseFloat(numBaseVol.value) || 45000);
    sc.startAht = Math.max(10, parseFloat(numBaseAht.value) || 210);
    sc.volGrowth = parseFloat(numVolGrowth.value) || 0;
    sc.ahtDrift = parseFloat(numAhtDrift.value) || 0;
    sc.startingHeadcount = Math.max(1, parseInt(numStartingHeadcount.value, 10) || 85);
    sc.monthlyAttrition = Math.max(0, parseFloat(numMonthlyAttrition.value) || 0);
    sc.monthlyHires = Math.max(0, parseInt(numMonthlyHires.value, 10) || 0);
    sc.nestingLag = parseInt(selectNestingLag.value, 10) || 1;
    sc.hourlyRate = Math.max(1, parseFloat(numSimHourlyRate.value) || 25.00);
    sc.budgetCap = Math.max(1000, parseFloat(numBudgetCap.value) || 380000);

    // Update tab text
    var tabBtn = scenarioTabBar.querySelector('button[data-scenario="' + state.activeScenarioIdx + '"]');
    if (tabBtn) {
      tabBtn.textContent = 'Scenario ' + String.fromCharCode(65 + state.activeScenarioIdx) + ': ' + sc.name.substring(0, 16);
    }
  }

  // --- Simulation Computation ---
  function runAllSimulations() {
    state.simResults = state.scenarios.map(function(sc) {
      return simulateScenario(sc, state.horizon);
    });

    updateActiveScenarioView();
    renderComparisonChart();
    generateExecutiveNarrative();
  }

  function simulateScenario(sc, horizon) {
    var periods = [];
    var currentStaff = sc.startingHeadcount;
    var hireCohorts = []; // history of recent hires for nesting lag: [ { count, age } ]

    var totalSpend = 0;
    var firstSlaBreach = null;
    var firstBudgetBreach = null;
    var slaSum = 0;

    var volGrowthFrac = sc.volGrowth / 100;
    var ahtDriftFrac = sc.ahtDrift / 100;
    var attritionFrac = sc.monthlyAttrition / 100;

    // Standard working hours per agent per month (21.5 working days * 7.5 net hrs = 160h)
    var monthlyHoursPerAgent = 160;

    for (var m = 1; m <= horizon; m++) {
      var mVol = sc.startVol * Math.pow(1 + volGrowthFrac, m - 1);
      var mAht = sc.startAht * Math.pow(1 + ahtDriftFrac, m - 1);

      // Workload intensity in peak shift equivalent
      var intervalWorkloadSeconds = (mVol / (22 * 16)) * mAht; // 30-min slice
      var erlangs = intervalWorkloadSeconds / 1800;

      // Solve Required Gross Headcount (30% shrinkage)
      var solve = Erlangly.agentsRequired({
        volume: (mVol / (22 * 16)),
        aht: mAht,
        intervalSeconds: 1800,
        targetServiceLevel: sc.targetSLA || 0.80,
        shrinkage: sc.shrinkage || 0.30
      });

      var requiredStaff = solve.staffedAgents;

      // Attrition on existing staff
      var retainedStaff = currentStaff * (1.0 - attritionFrac);

      // New Hires joining in month m
      var newHires = sc.monthlyHires;
      hireCohorts.unshift({ count: newHires, age: 0 });

      // Compute productive headcount factoring nesting lag
      var productiveFromHires = 0;
      hireCohorts.forEach(function(cohort) {
        var efficiency = 1.0;
        if (sc.nestingLag === 1) {
          if (cohort.age === 0) efficiency = 0.50; // Month 1: 50%
        } else if (sc.nestingLag === 2) {
          if (cohort.age === 0) efficiency = 0.25; // Month 1: 25%
          else if (cohort.age === 1) efficiency = 0.75; // Month 2: 75%
        }
        productiveFromHires += (cohort.count * efficiency);
        cohort.age++;
      });

      // Keep only recent cohorts
      if (hireCohorts.length > 3) hireCohorts.pop();

      var productiveStaff = Math.round(retainedStaff + productiveFromHires);
      currentStaff = retainedStaff + newHires; // actual headcount on payroll

      // Resulting SLA & Queue Performance
      var netProductiveAgents = Math.max(1, Math.round(productiveStaff * (1.0 - (sc.shrinkage || 0.30))));
      var sl = Erlangly.serviceLevel(erlangs, netProductiveAgents, mAht, sc.targetTime || 20);
      var asa = Erlangly.averageSpeedOfAnswer(erlangs, netProductiveAgents, mAht);
      var occ = Erlangly.occupancy(erlangs, netProductiveAgents);

      var laborCost = currentStaff * monthlyHoursPerAgent * sc.hourlyRate;
      totalSpend += laborCost;
      slaSum += sl;

      var gap = productiveStaff - requiredStaff;

      var status = 'Optimal';
      if (sl < (sc.targetSLA || 0.80)) {
        status = 'SLA Breach';
        if (firstSlaBreach === null) firstSlaBreach = m;
      }
      if (laborCost > sc.budgetCap) {
        status = status === 'Optimal' ? 'Budget Breach' : 'SLA & Budget Breach';
        if (firstBudgetBreach === null) firstBudgetBreach = m;
      }

      periods.push({
        month: m,
        periodName: 'Month ' + m,
        volume: mVol,
        aht: mAht,
        erlangs: erlangs,
        requiredStaff: requiredStaff,
        productiveStaff: productiveStaff,
        actualPayrollStaff: Math.round(currentStaff),
        gap: gap,
        sla: sl,
        asa: asa,
        occupancy: occ,
        cost: laborCost,
        status: status
      });
    }

    return {
      scenario: sc,
      periods: periods,
      totalSpend: totalSpend,
      avgSla: slaSum / horizon,
      firstSlaBreach: firstSlaBreach,
      firstBudgetBreach: firstBudgetBreach,
      endingGap: periods[horizon - 1].gap
    };
  }

  // --- Update Active Scenario Display ---
  function updateActiveScenarioView() {
    var res = state.simResults[state.activeScenarioIdx];
    if (!res) return;

    lblTableScenarioTitle.textContent = res.scenario.name;

    // SLA Breach Card
    if (res.firstSlaBreach) {
      simBreachText.textContent = 'Month ' + res.firstSlaBreach;
      simBreachText.style.color = 'var(--danger-light)';
      simBreachSub.innerHTML = '<span class="badge badge-danger">Breaches 80% Target</span>';
    } else {
      simBreachText.textContent = 'None';
      simBreachText.style.color = 'var(--success-light)';
      simBreachSub.innerHTML = '<span class="badge badge-success">Target Maintained</span>';
    }

    // Budget Breach Card
    if (res.firstBudgetBreach) {
      simBudgetBreachText.textContent = 'Month ' + res.firstBudgetBreach;
      simBudgetBreachText.style.color = 'var(--warn-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-warn">Exceeds Cap</span>';
    } else {
      simBudgetBreachText.textContent = 'None';
      simBudgetBreachText.style.color = 'var(--success-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-success">Under Budget</span>';
    }

    // Total Spend & Summary
    simTotalSpend.textContent = '$' + (res.totalSpend / 1000000).toFixed(2) + 'M';
    simTotalSpendSub.textContent = state.horizon + '-Month Total Spend';

    simAvgSla.textContent = ErlanglyUtils.formatPercent(res.avgSla, 1);
    simAvgSla.className = 'metric-value mono ' + (res.avgSla >= 0.80 ? 'text-success' : 'text-danger');

    var gapPrefix = res.endingGap > 0 ? '+' : '';
    simEndingGap.textContent = gapPrefix + res.endingGap + ' agents';
    simEndingGap.className = 'metric-value mono ' + (res.endingGap >= 0 ? 'text-accent' : 'text-danger');
    simGapSub.textContent = 'Month ' + state.horizon + ' net staffing';

    // Render Table
    renderProjectionTable(res.periods);
  }

  function renderProjectionTable(periods) {
    tbodySimProjection.innerHTML = '';
    periods.forEach(function(p) {
      var tr = document.createElement('tr');
      var isBreach = p.sla < 0.80;
      var isBudgetOver = p.cost > state.scenarios[state.activeScenarioIdx].budgetCap;

      var badgeCls = 'badge-success';
      if (isBreach && isBudgetOver) badgeCls = 'badge-danger';
      else if (isBreach) badgeCls = 'badge-danger';
      else if (isBudgetOver) badgeCls = 'badge-warn';

      tr.innerHTML = 
        '<td class="mono"><strong>' + p.periodName + '</strong></td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(Math.round(p.volume)) + '</td>' +
        '<td class="mono">' + Math.round(p.aht) + 's</td>' +
        '<td class="mono">' + p.requiredStaff + '</td>' +
        '<td class="mono text-accent"><strong>' + p.productiveStaff + '</strong></td>' +
        '<td class="mono ' + (p.gap < 0 ? 'text-danger' : 'text-success') + '">' + (p.gap > 0 ? '+' : '') + p.gap + '</td>' +
        '<td class="mono ' + (p.sla >= 0.80 ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(p.sla, 1) + '</td>' +
        '<td class="mono">' + ErlanglyUtils.formatSeconds(p.asa) + '</td>' +
        '<td class="mono ' + (isBudgetOver ? 'text-warn' : '') + '">$' + Math.round(p.cost).toLocaleString() + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + p.status + '</span></td>';

      tbodySimProjection.appendChild(tr);
    });
  }

  // --- Comparison Chart ---
  function renderComparisonChart() {
    if (!canvasSimulatorChart || typeof Chart === 'undefined') return;

    var labels = [];
    for (var i = 1; i <= state.horizon; i++) {
      labels.push('Month ' + i);
    }

    var colors = ['#00d2d3', '#10b981', '#f59e0b'];

    var datasets = state.simResults.map(function(res, idx) {
      return {
        label: res.scenario.name,
        data: res.periods.map(function(p) { return Math.round(p.sla * 100); }),
        borderColor: colors[idx] || '#cbd5e1',
        backgroundColor: 'transparent',
        borderWidth: idx === state.activeScenarioIdx ? 3 : 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.2
      };
    });

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets = datasets;
      state.chart.update();
      return;
    }

    var ctx = canvasSimulatorChart.getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#2b3954',
            borderWidth: 1,
            titleFont: { family: 'IBM Plex Mono', size: 12 },
            bodyFont: { family: 'IBM Plex Mono', size: 12 },
            callbacks: {
              label: function(c) {
                return c.dataset.label + ': ' + c.parsed.y + '% SLA';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#64748b', font: { family: 'IBM Plex Mono', size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'IBM Plex Mono', size: 11 },
              callback: function(v) { return v + '%'; }
            }
          }
        }
      }
    });
  }

  // --- Executive Narrative Summary Generator ---
  function generateExecutiveNarrative() {
    var scA = state.simResults[0];
    var scB = state.simResults[1];
    var scC = state.simResults[2];

    if (!scA || !scB || !scC) return;

    var text = 'Strategic Workforce Simulation Summary (' + state.horizon + '-Month Horizon):\n\n';

    text += '• ' + scA.scenario.name + ' projects an average service level of ' + (scA.avgSla * 100).toFixed(1) + '% with total labor expenditure of $' + (scA.totalSpend / 1000000).toFixed(2) + 'M. ' +
      (scA.firstSlaBreach ? 'Service level falls below 80% SLA in Month ' + scA.firstSlaBreach + ' as attrition outpaces baseline hiring.' : 'Maintains SLA targets throughout the horizon.') + '\n\n';

    text += '• ' + scB.scenario.name + ' projects a robust average service level of ' + (scB.avgSla * 100).toFixed(1) + '% at $' + (scB.totalSpend / 1000000).toFixed(2) + 'M spend, ending Month ' + state.horizon + ' with a +' + scB.endingGap + ' headcount buffer, accounting for new-hire nesting ramp lag.\n\n';

    text += '• ' + scC.scenario.name + ' saves capital ($' + (scC.totalSpend / 1000000).toFixed(2) + 'M total spend) but encounters an operational service breach by Month ' + (scC.firstSlaBreach || 'N/A') + ' due to cumulative attrition, ending with a deficit of ' + Math.abs(scC.endingGap) + ' agents.\n\n';

    text += 'Recommendation: Scenario B is recommended for peak volume resilience, while Scenario A represents a viable cost-balanced operational posture.';

    narrativeSummaryText.textContent = text;
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
