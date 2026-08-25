/**
 * Erlangly Capacity Planning Tool (js/capacity.js)
 * 
 * Features:
 * - Single-interval interactive Erlang C solver & sensitivity explorer
 * - Bulk CSV multi-interval processor with summary metrics
 * - Multi-Period Staffing Simulator (Daily, Weekly, Monthly) with Chart.js visualizer
 * - CSV export & Cross-tool handoff to Scheduling (localStorage)
 * - Auto-loads handoffs from Hero or Forecasting (?from=hero / ?from=forecast / ?from=plans)
 */

(function() {
  'use strict';

  // --- State ---
  var state = {
    mode: 'single', // 'single' | 'bulk' | 'sim'
    single: {
      volume: 300,
      aht: 180,
      intervalSeconds: 1800,
      targetServiceLevel: 0.80,
      targetTimeSeconds: 20,
      maxOccupancy: 0.85,
      shrinkage: 0.30
    },
    bulk: {
      rows: [],
      targetServiceLevel: 0.80,
      targetTimeSeconds: 20,
      maxOccupancy: 0.85,
      shrinkage: 0.30,
      intervalSeconds: 1800,
      results: []
    },
    sim: {
      granularity: 'daily', // 'daily' | 'weekly' | 'monthly'
      horizon: 7,
      volume: 5000,
      aht: 180,
      growthRatePct: 2.0,
      ahtDriftPct: 0.0,
      operatingHours: 12,
      workWeekHours: 40.0,
      distribution: 'diurnal',
      operatingDays: 7,
      targetServiceLevel: 0.80,
      targetTimeSeconds: 20,
      maxOccupancy: 0.85,
      shrinkage: 0.30,
      hourlyWage: 25.00,
      results: null,
      chart: null
    },
    mq: {
      strategy: 'overflow', // 'siloed' | 'overflow' | 'skill' | 'blended'
      queues: [
        { id: 'q1', name: 'Inbound Support', volume: 400, aht: 240, targetSLA: 0.80, targetTime: 20 },
        { id: 'q2', name: 'Billing & Accounts', volume: 250, aht: 180, targetSLA: 0.80, targetTime: 20 },
        { id: 'q3', name: 'Tech Escalations', volume: 150, aht: 320, targetSLA: 0.80, targetTime: 20 }
      ],
      overflowThresholdSec: 30,
      specialistSplit: 0.70,
      intervalSeconds: 1800,
      shrinkage: 0.30,
      results: null,
      chart: null
    }
  };

  // --- Sample Daytime Contact Center Data (8:00 AM - 8:00 PM) ---
  var SAMPLE_BULK_DATA = [
    { interval: '08:00', volume: 110, aht: 175 },
    { interval: '08:30', volume: 160, aht: 180 },
    { interval: '09:00', volume: 240, aht: 190 },
    { interval: '09:30', volume: 310, aht: 195 },
    { interval: '10:00', volume: 380, aht: 200 },
    { interval: '10:30', volume: 420, aht: 205 },
    { interval: '11:00', volume: 450, aht: 210 },
    { interval: '11:30', volume: 430, aht: 205 },
    { interval: '12:00', volume: 390, aht: 195 },
    { interval: '12:30', volume: 370, aht: 190 },
    { interval: '13:00', volume: 350, aht: 185 },
    { interval: '13:30', volume: 360, aht: 185 },
    { interval: '14:00', volume: 410, aht: 190 },
    { interval: '14:30', volume: 440, aht: 195 },
    { interval: '15:00', volume: 460, aht: 200 },
    { interval: '15:30', volume: 430, aht: 195 },
    { interval: '16:00', volume: 390, aht: 190 },
    { interval: '16:30', volume: 340, aht: 185 },
    { interval: '17:00', volume: 290, aht: 180 },
    { interval: '17:30', volume: 240, aht: 175 },
    { interval: '18:00', volume: 190, aht: 170 },
    { interval: '18:30', volume: 150, aht: 165 },
    { interval: '19:00', volume: 120, aht: 160 },
    { interval: '19:30', volume: 90, aht: 155 }
  ];

  // --- DOM References ---
  var tabSingle = document.getElementById('tab-single');
  var tabBulk = document.getElementById('tab-bulk');
  var tabSim = document.getElementById('tab-sim');
  var tabMultiqueue = document.getElementById('tab-multiqueue');
  var viewSingle = document.getElementById('view-single');
  var viewBulk = document.getElementById('view-bulk');
  var viewSim = document.getElementById('view-sim');
  var viewMultiqueue = document.getElementById('view-multiqueue');

  // Multi-Queue DOM (Phase 11)
  var mqStrategyPills = document.querySelectorAll('#mq-strategy-pills button');
  var tbodyMqQueues = document.getElementById('tbody-mq-queues');
  var lblMqQueueCount = document.getElementById('lbl-mq-queue-count');
  var btnAddMqQueue = document.getElementById('btn-add-mq-queue');
  var btnResetMqQueues = document.getElementById('btn-reset-mq-queues');
  var btnExportMqCSV = document.getElementById('btn-export-mq-csv');
  var btnSaveMqPlan = document.getElementById('btn-save-mq-plan');

  var lblStrategyLeverTitle = document.getElementById('lbl-strategy-lever-title');
  var mqControlsOverflow = document.getElementById('mq-controls-overflow');
  var mqControlsSkill = document.getElementById('mq-controls-skill');
  var inputOverflowThreshold = document.getElementById('input-overflow-threshold');
  var lblOverflowThreshold = document.getElementById('lbl-overflow-threshold');
  var selectOverflowDest = document.getElementById('select-overflow-dest');
  var inputSpecialistSplit = document.getElementById('input-specialist-split');
  var lblSpecialistSplit = document.getElementById('lbl-specialist-split');
  var selectMqInterval = document.getElementById('select-mq-interval');
  var numMqShrinkage = document.getElementById('num-mq-shrinkage');

  var lblMqTotalAgents = document.getElementById('lbl-mq-total-agents');
  var lblMqSiloedAgents = document.getElementById('lbl-mq-siloed-agents');
  var lblMqSavedAgents = document.getElementById('lbl-mq-saved-agents');
  var lblMqShrinkageSaved = document.getElementById('lbl-mq-shrinkage-saved');
  var lblMqEfficiencyGain = document.getElementById('lbl-mq-efficiency-gain');
  var tbodyMqBreakdown = document.getElementById('tbody-mq-breakdown');
  var chartMqComparisonCanvas = document.getElementById('chart-mq-comparison');

  // Single inputs
  var inputVol = document.getElementById('input-vol');
  var numVol = document.getElementById('num-vol');
  var lblVol = document.getElementById('lbl-vol');
  var inputAht = document.getElementById('input-aht');
  var numAht = document.getElementById('num-aht');
  var lblAht = document.getElementById('lbl-aht');
  var selectInterval = document.getElementById('select-interval');
  var numSLA = document.getElementById('num-sla');
  var numThreshold = document.getElementById('num-threshold');
  var numOccupancy = document.getElementById('num-occupancy');
  var numShrinkage = document.getElementById('num-shrinkage');

  // Single outputs
  var resStaffed = document.getElementById('res-staffed');
  var resStaffedSub = document.getElementById('res-staffed-sub');
  var resBase = document.getElementById('res-base');
  var resSL = document.getElementById('res-sl');
  var resSLBadge = document.getElementById('res-sl-badge');
  var resASA = document.getElementById('res-asa');
  var resOcc = document.getElementById('res-occ');
  var resOccSub = document.getElementById('res-occ-sub');
  var resErlangs = document.getElementById('res-erlangs');
  var tbodySensitivity = document.getElementById('tbody-sensitivity');

  // Bulk DOM
  var bulkDropzone = document.getElementById('bulk-dropzone');
  var bulkFileInput = document.getElementById('bulk-file-input');
  var btnSampleCSV = document.getElementById('btn-sample-csv');
  var btnExportBulkCSV = document.getElementById('btn-export-bulk-csv');
  var tbodyBulk = document.getElementById('tbody-bulk');
  var bulkStatsBar = document.getElementById('bulk-stats-bar');
  var bulkTotalVol = document.getElementById('bulk-total-vol');
  var bulkWeightedAht = document.getElementById('bulk-weighted-aht');
  var bulkTotalErlangs = document.getElementById('bulk-total-erlangs');
  var bulkPeakAgents = document.getElementById('bulk-peak-agents');
  var bulkAvgStaffed = document.getElementById('bulk-avg-staffed');
  var bulkTotalHours = document.getElementById('bulk-total-hours');
  var selectBulkInterval = document.getElementById('select-bulk-interval');
  var numBulkSLA = document.getElementById('num-bulk-sla');
  var numBulkThreshold = document.getElementById('num-bulk-threshold');
  var numBulkOccupancy = document.getElementById('num-bulk-occupancy');
  var numBulkShrinkage = document.getElementById('num-bulk-shrinkage');
  var btnSendBulkScheduling = document.getElementById('btn-send-bulk-scheduling');

  // Global / Handoff DOM
  var handoffBanner = document.getElementById('handoff-banner');
  var handoffMessage = document.getElementById('handoff-message');
  var btnDismissHandoff = document.getElementById('btn-dismiss-handoff');
  var btnResetSingle = document.getElementById('btn-reset-single');
  var btnResetBulk = document.getElementById('btn-reset-bulk');
  var btnSendScheduling = document.getElementById('btn-send-scheduling');
  var btnExportSingleCSV = document.getElementById('btn-export-single-csv');

  // Simulator DOM
  var selectSimGranularity = document.getElementById('select-sim-granularity');
  var numSimHorizon = document.getElementById('num-sim-horizon');
  var lblSimHorizonUnit = document.getElementById('lbl-sim-horizon-unit');
  var numSimVol = document.getElementById('num-sim-vol');
  var numSimAht = document.getElementById('num-sim-aht');
  var numSimGrowth = document.getElementById('num-sim-growth');
  var numSimDrift = document.getElementById('num-sim-drift');
  var selectSimOpHours = document.getElementById('select-sim-op-hours');
  var selectSimWorkweek = document.getElementById('select-sim-workweek');
  var selectSimDistribution = document.getElementById('select-sim-distribution');
  var selectSimWorkdays = document.getElementById('select-sim-workdays');
  var numSimSLA = document.getElementById('num-sim-sla');
  var numSimTargetTime = document.getElementById('num-sim-target-time');
  var numSimOccupancy = document.getElementById('num-sim-occupancy');
  var numSimShrinkage = document.getElementById('num-sim-shrinkage');
  var numSimWage = document.getElementById('num-sim-wage');
  var btnResetSim = document.getElementById('btn-reset-sim');
  var simMetricTotalVol = document.getElementById('sim-metric-total-vol');
  var simMetricPeakStaff = document.getElementById('sim-metric-peak-staff');
  var simMetricAvgStaff = document.getElementById('sim-metric-avg-staff');
  var simMetricTotalHours = document.getElementById('sim-metric-total-hours');
  var simMetricTotalCost = document.getElementById('sim-metric-total-cost');
  var simMetricAvgSL = document.getElementById('sim-metric-avg-sl');
  var tbodySimResults = document.getElementById('tbody-sim-results');
  var btnExportSimCSV = document.getElementById('btn-export-sim-csv');
  var btnSendSimScheduling = document.getElementById('btn-send-sim-scheduling');

  // --- Initialization ---
  function init() {
    setupTabSwitching();
    setupSingleEventListeners();
    setupBulkEventListeners();
    setupSimulatorEventListeners();
    setupMultiQueueEventListeners();
    checkIncomingHandoff();
    calculateSingle();
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    tabSingle.addEventListener('click', function() {
      state.mode = 'single';
      tabSingle.className = 'btn btn-sm btn-primary';
      tabBulk.className = 'btn btn-sm btn-ghost';
      tabSim.className = 'btn btn-sm btn-ghost';
      if (tabMultiqueue) tabMultiqueue.className = 'btn btn-sm btn-ghost';
      viewSingle.style.display = 'grid';
      viewBulk.style.display = 'none';
      viewSim.style.display = 'none';
      if (viewMultiqueue) viewMultiqueue.style.display = 'none';
    });

    tabBulk.addEventListener('click', function() {
      state.mode = 'bulk';
      tabBulk.className = 'btn btn-sm btn-primary';
      tabSingle.className = 'btn btn-sm btn-ghost';
      tabSim.className = 'btn btn-sm btn-ghost';
      if (tabMultiqueue) tabMultiqueue.className = 'btn btn-sm btn-ghost';
      viewSingle.style.display = 'none';
      viewBulk.style.display = 'flex';
      viewSim.style.display = 'none';
      if (viewMultiqueue) viewMultiqueue.style.display = 'none';
      if (state.bulk.rows.length === 0) {
        loadBulkData(SAMPLE_BULK_DATA);
      }
    });

    tabSim.addEventListener('click', function() {
      state.mode = 'sim';
      tabSim.className = 'btn btn-sm btn-primary';
      tabSingle.className = 'btn btn-sm btn-ghost';
      tabBulk.className = 'btn btn-sm btn-ghost';
      if (tabMultiqueue) tabMultiqueue.className = 'btn btn-sm btn-ghost';
      viewSingle.style.display = 'none';
      viewBulk.style.display = 'none';
      viewSim.style.display = 'flex';
      if (viewMultiqueue) viewMultiqueue.style.display = 'none';
      runSimulation();
    });

    if (tabMultiqueue) {
      tabMultiqueue.addEventListener('click', function() {
        state.mode = 'multiqueue';
        tabMultiqueue.className = 'btn btn-sm btn-primary';
        tabSingle.className = 'btn btn-sm btn-ghost';
        tabBulk.className = 'btn btn-sm btn-ghost';
        tabSim.className = 'btn btn-sm btn-ghost';
        viewSingle.style.display = 'none';
        viewBulk.style.display = 'none';
        viewSim.style.display = 'none';
        if (viewMultiqueue) viewMultiqueue.style.display = 'flex';
        renderMultiQueueInputs();
        calculateMultiQueue();
      });
    }
  }

  // --- Single Mode Event Listeners ---
  function setupSingleEventListeners() {
    // Volume Sync
    inputVol.addEventListener('input', function() {
      numVol.value = inputVol.value;
      calculateSingle();
    });
    numVol.addEventListener('input', function() {
      inputVol.value = numVol.value;
      calculateSingle();
    });

    // AHT Sync
    inputAht.addEventListener('input', function() {
      numAht.value = inputAht.value;
      calculateSingle();
    });
    numAht.addEventListener('input', function() {
      inputAht.value = numAht.value;
      calculateSingle();
    });

    // Interval, SLA, Threshold, Occupancy, Shrinkage
    [selectInterval, numSLA, numThreshold, numOccupancy, numShrinkage].forEach(function(el) {
      el.addEventListener('input', calculateSingle);
      el.addEventListener('change', calculateSingle);
    });

    // Reset button
    btnResetSingle.addEventListener('click', function() {
      inputVol.value = 300; numVol.value = 300;
      inputAht.value = 180; numAht.value = 180;
      selectInterval.value = '1800';
      numSLA.value = 80;
      numThreshold.value = 20;
      numOccupancy.value = 85;
      numShrinkage.value = 30;
      calculateSingle();
      ErlanglyUtils.showToast('Reset parameters to defaults', 'info');
    });

    // Save single plan button
    var btnSaveSingle = document.getElementById('btn-save-single-plan');
    if (btnSaveSingle) {
      btnSaveSingle.addEventListener('click', function() {
        var params = getSingleParams();
        var res = Erlangly.agentsRequired(params);
        if (typeof ErlanglyPlans !== 'undefined') {
          ErlanglyPlans.showSaveModal('capacity', params, res);
        } else {
          ErlanglyUtils.showToast('Plans persistence module loading...', 'info');
        }
      });
    }

    // Send single requirement to Scheduling
    if (btnSendSingleScheduling) {
      btnSendSingleScheduling.addEventListener('click', function() {
        var res = Erlangly.agentsRequired(getSingleParams());
        var handoffPayload = {
          source: 'capacity_single',
          intervalLength: state.single.intervalSeconds,
          targetSLA: state.single.targetServiceLevel,
          shrinkage: state.single.shrinkage,
          intervals: [
            {
              interval: '09:00',
              volume: state.single.volume,
              aht: state.single.aht,
              erlangs: res.trafficIntensity,
              requiredAgents: res.baseAgents,
              staffedAgents: res.staffedAgents
            }
          ]
        };
        ErlanglyUtils.setHandoff('scheduling', handoffPayload);
        window.location.href = 'scheduling.html?from=capacity';
      });
    }
  }

  function getSingleParams() {
    var vol = Math.max(0, parseFloat(numVol.value) || 0);
    var aht = Math.max(0, parseFloat(numAht.value) || 0);
    var intervalSec = parseFloat(selectInterval.value) || 1800;
    var sla = (parseFloat(numSLA.value) || 80) / 100;
    var targetT = Math.max(1, parseFloat(numThreshold.value) || 20);
    var maxOcc = (parseFloat(numOccupancy.value) || 85) / 100;
    var shrink = (parseFloat(numShrinkage.value) || 0) / 100;

    state.single = {
      volume: vol,
      aht: aht,
      intervalSeconds: intervalSec,
      targetServiceLevel: sla,
      targetTimeSeconds: targetT,
      maxOccupancy: maxOcc,
      shrinkage: shrink
    };

    return state.single;
  }

  // --- Calculate Single Interval ---
  function calculateSingle() {
    var params = getSingleParams();

    // Labels
    lblVol.textContent = ErlanglyUtils.formatNumber(params.volume);
    lblAht.textContent = params.aht + 's';

    // Solve Erlang C
    var result = Erlangly.agentsRequired(params);

    // Update Stat Cards
    resStaffed.textContent = result.staffedAgents === Infinity ? '∞' : ErlanglyUtils.formatNumber(result.staffedAgents);
    resStaffedSub.textContent = 'Includes ' + Math.round(params.shrinkage * 100) + '% shrinkage';
    resBase.textContent = ErlanglyUtils.formatNumber(result.baseAgents);
    resSL.textContent = ErlanglyUtils.formatPercent(result.serviceLevel, 1);
    resASA.textContent = ErlanglyUtils.formatSeconds(result.asa);
    resOcc.textContent = ErlanglyUtils.formatPercent(result.occupancy, 1);
    resErlangs.textContent = ErlanglyUtils.formatErlangs(result.trafficIntensity);

    // Status Badge
    if (result.isZeroVolume) {
      resSLBadge.innerHTML = '<span class="badge badge-neutral">No Volume</span>';
    } else if (result.serviceLevel >= params.targetServiceLevel) {
      resSLBadge.innerHTML = '<span class="badge badge-success">On Target</span>';
    } else if (result.serviceLevel >= params.targetServiceLevel * 0.9) {
      resSLBadge.innerHTML = '<span class="badge badge-warn">At Risk</span>';
    } else {
      resSLBadge.innerHTML = '<span class="badge badge-danger">Breach</span>';
    }

    // Occupancy Subtext
    if (result.occupancy > 0.90) {
      resOccSub.innerHTML = '<span class="text-warn">High burnout risk (&gt;90%)</span>';
    } else {
      resOccSub.textContent = 'Handle time ratio';
    }

    // Render Sensitivity Table
    renderSensitivityTable(result.trafficIntensity, params.aht, params.targetTimeSeconds, result.baseAgents, params.targetServiceLevel, params.shrinkage);
  }

  function renderSensitivityTable(traffic, aht, targetTime, baseAgents, targetSLA, shrinkage) {
    tbodySensitivity.innerHTML = '';
    if (baseAgents <= 0 || traffic <= 0) {
      tbodySensitivity.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No active workload to analyze.</td></tr>';
      return;
    }

    var minAgents = Math.max(Math.floor(traffic) + 1, baseAgents - 3);
    var maxAgents = baseAgents + 3;
    var curve = Erlangly.sensitivityCurve(traffic, aht, targetTime, minAgents, maxAgents);

    curve.forEach(function(item) {
      var tr = document.createElement('tr');
      var grossStaffed = Math.ceil(Erlangly.shrinkageAdjust(item.agents, shrinkage));
      var isSolved = item.agents === baseAgents;

      if (isSolved) {
        tr.style.background = 'rgba(0, 210, 211, 0.08)';
        tr.style.fontWeight = '600';
      }

      var badgeHtml;
      if (item.serviceLevel >= targetSLA) {
        badgeHtml = isSolved ? '<span class="badge badge-success">Selected Plan</span>' : '<span class="badge badge-success">Target Met</span>';
      } else {
        badgeHtml = '<span class="badge badge-danger">Understaffed</span>';
      }

      tr.innerHTML = 
        '<td class="mono">' + item.agents + (isSolved ? ' ★' : '') + '</td>' +
        '<td class="mono text-accent">' + grossStaffed + '</td>' +
        '<td class="mono ' + (item.serviceLevel >= targetSLA ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(item.serviceLevel, 1) + '</td>' +
        '<td class="mono">' + ErlanglyUtils.formatSeconds(item.asa) + '</td>' +
        '<td class="mono ' + (item.occupancy > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(item.occupancy, 1) + '</td>' +
        '<td>' + badgeHtml + '</td>';

      tbodySensitivity.appendChild(tr);
    });
  }

  // --- Bulk CSV Mode Event Listeners ---
  function setupBulkEventListeners() {
    // Dropzone wiring
    ErlanglyUtils.wireFileDrop(bulkDropzone, bulkFileInput, function(text, file) {
      parseBulkCSV(text, file ? file.name : 'bulk_intervals.csv', file);
    });

    // Sample data button
    if (btnSampleCSV) {
      btnSampleCSV.addEventListener('click', function() {
        loadBulkData(SAMPLE_BULK_DATA);
        ErlanglyUtils.showToast('Loaded 24 sample daytime intervals (08:00 - 20:00)', 'success');
      });
    }

    // Download template CSV
    if (btnDownloadTemplate) {
      btnDownloadTemplate.addEventListener('click', function() {
        var headers = ['interval', 'volume', 'aht'];
        var rows = [
          ['08:00', 120, 180],
          ['08:30', 250, 180],
          ['09:00', 400, 190],
          ['09:30', 450, 200]
        ];
        ErlanglyUtils.exportCSV('capacity_template.csv', headers, rows);
      });
    }

    // Global constraints
    [bulkTargetSLA, bulkTargetTime, bulkOccupancyCap, bulkShrinkage, bulkIntervalLen].forEach(function(el) {
      if (el) {
        el.addEventListener('input', processBulkData);
        el.addEventListener('change', processBulkData);
      }
    });

    // Export Bulk Plan as CSV
    if (btnExportBulkCSV) {
      btnExportBulkCSV.addEventListener('click', function() {
        if (!state.bulk.results || state.bulk.results.length === 0) return;
        var headers = ['Interval', 'Volume', 'AHT_Seconds', 'Traffic_Erlangs', 'Base_Agents', 'Staffed_Agents', 'Service_Level_Pct', 'ASA_Seconds', 'Occupancy_Pct', 'Status'];
        var rows = state.bulk.results.map(function(r) {
          return [
            r.interval,
            r.volume,
            r.aht,
            r.trafficIntensity.toFixed(2),
            r.baseAgents,
            r.staffedAgents,
            (r.serviceLevel * 100).toFixed(1) + '%',
            r.asa.toFixed(1),
            (r.occupancy * 100).toFixed(1) + '%',
            r.serviceLevel >= state.bulk.targetServiceLevel ? 'ON_TARGET' : 'BREACH'
          ];
        });
        ErlanglyUtils.exportCSV('interval_capacity_plan.csv', headers, rows);
      });
    }

    // Send Bulk Plan to Scheduling
    if (btnSendBulkScheduling) {
      btnSendBulkScheduling.addEventListener('click', function() {
        if (!state.bulk.results || state.bulk.results.length === 0) return;
        var handoffPayload = {
          source: 'capacity_bulk',
          intervalLength: state.bulk.intervalSeconds,
          targetSLA: state.bulk.targetServiceLevel,
          shrinkage: state.bulk.shrinkage,
          intervals: state.bulk.results.map(function(r) {
            return {
              interval: r.interval,
              volume: r.volume,
              aht: r.aht,
              erlangs: r.trafficIntensity,
              requiredAgents: r.baseAgents,
              staffedAgents: r.staffedAgents
            };
          })
        };
        ErlanglyUtils.setHandoff('scheduling', handoffPayload);
        window.location.href = 'scheduling.html?from=capacity';
      });
    }

    // Theme change listener for Chart.js re-rendering
    if (typeof window !== 'undefined') {
      window.addEventListener('erlangly:themechange', function() {
        if (state.sim && state.sim.results) {
          runSimulation();
        }
        if (state.mq && state.mq.results) {
          renderMultiQueueChart(state.mq.results);
        }
      });
    }
  }

  // --- Bulk CSV Parser with Validation Preview ---
  function parseBulkCSV(text, filename, fileObj) {
    if (typeof ErlanglyUtils !== 'undefined' && typeof ErlanglyUtils.showCSVPreviewModal === 'function') {
      ErlanglyUtils.showCSVPreviewModal({
        title: 'Bulk Intervals CSV Preview',
        file: fileObj,
        filename: filename,
        text: text,
        requiredHeaders: ['interval', 'volume'],
        optionalHeaders: ['aht', 'target_sl', 'shrinkage'],
        rowValidator: function(row, lineNum) {
          var volVal = parseFloat(row.volume || row.calls || row.interactions || row.count);
          if (isNaN(volVal) || volVal < 0) {
            return { valid: false, error: 'Volume must be a non-negative number' };
          }
          if (row.aht !== undefined && row.aht !== '') {
            var ahtVal = parseFloat(row.aht || row.handletime || row.duration);
            if (isNaN(ahtVal) || ahtVal <= 0) {
              return { valid: false, error: 'AHT must be a positive number of seconds' };
            }
          }
          return { valid: true };
        },
        onConfirm: function(parsedResult) {
          var rows = [];
          parsedResult.rows.forEach(function(row, idx) {
            var intervalVal = row.interval || row.time || row.period || row.hour || ('Interval ' + (idx + 1));
            var volVal = parseFloat(row.volume || row.calls || row.interactions || row.count || 0);
            var ahtVal = parseFloat(row.aht || row.handletime || row.duration || row.avg_handle_time || 180);
            rows.push({
              interval: intervalVal,
              volume: Math.max(0, volVal),
              aht: Math.max(1, ahtVal)
            });
          });
          if (rows.length > 0) {
            loadBulkData(rows);
            ErlanglyUtils.showToast('Imported ' + rows.length + ' intervals from ' + filename, 'success');
          }
        }
      });
      return;
    }

    var parsed = ErlanglyUtils.parseCSV(text);
    if (!parsed.rows || parsed.rows.length === 0) {
      ErlanglyUtils.showToast('CSV contains no data rows.', 'error');
      return;
    }

    var rows = [];
    var skipped = 0;

    parsed.rows.forEach(function(row, idx) {
      var intervalVal = row.interval || row.time || row.period || row.hour || ('Interval ' + (idx + 1));
      var volVal = parseFloat(row.volume || row.calls || row.interactions || row.count || 0);
      var ahtVal = parseFloat(row.aht || row.handletime || row.duration || row.avg_handle_time || 180);

      if (isNaN(volVal) || isNaN(ahtVal)) {
        skipped++;
        return;
      }

      rows.push({
        interval: intervalVal,
        volume: Math.max(0, volVal),
        aht: Math.max(1, ahtVal)
      });
    });

    if (rows.length === 0) {
      ErlanglyUtils.showToast('Failed to parse interval rows from ' + filename, 'error');
      return;
    }

    if (skipped > 0) {
      ErlanglyUtils.showToast('Parsed ' + rows.length + ' rows (skipped ' + skipped + ' invalid)', 'warn');
    } else {
      ErlanglyUtils.showToast('Loaded ' + rows.length + ' intervals from ' + filename, 'success');
    }

    loadBulkData(rows);
  }

  function loadBulkData(rows) {
    state.bulk.rows = rows;
    processBulkData();
  }

  // --- Process Bulk Data ---
  function processBulkData() {
    if (!state.bulk.rows || state.bulk.rows.length === 0) return;

    var sla = (parseFloat(bulkTargetSLA.value) || 80) / 100;
    var targetT = Math.max(1, parseFloat(bulkTargetTime.value) || 20);
    var maxOcc = (parseFloat(bulkOccupancyCap.value) || 85) / 100;
    var shrink = (parseFloat(bulkShrinkage.value) || 0) / 100;
    var intervalSec = parseFloat(bulkIntervalLen.value) || 1800;

    state.bulk.targetServiceLevel = sla;
    state.bulk.targetTimeSeconds = targetT;
    state.bulk.maxOccupancy = maxOcc;
    state.bulk.shrinkage = shrink;
    state.bulk.intervalSeconds = intervalSec;

    var totalVolume = 0;
    var totalWorkloadSeconds = 0;
    var peakStaffed = 0;
    var peakInterval = '';
    var totalStaffIntervalHours = 0;
    var weightedSLSum = 0;
    var weightedOccSum = 0;
    var results = [];

    state.bulk.rows.forEach(function(row) {
      var solve = Erlangly.agentsRequired({
        volume: row.volume,
        aht: row.aht,
        intervalSeconds: intervalSec,
        targetServiceLevel: sla,
        targetTimeSeconds: targetT,
        maxOccupancy: maxOcc,
        shrinkage: shrink
      });

      var intervalHours = intervalSec / 3600;
      var staffHours = solve.staffedAgents * intervalHours;

      totalVolume += row.volume;
      totalWorkloadSeconds += (row.volume * row.aht);
      totalStaffIntervalHours += staffHours;

      if (solve.staffedAgents > peakStaffed) {
        peakStaffed = solve.staffedAgents;
        peakInterval = row.interval;
      }

      weightedSLSum += solve.serviceLevel * row.volume;
      weightedOccSum += solve.occupancy * row.volume;

      results.push({
        interval: row.interval,
        volume: row.volume,
        aht: row.aht,
        trafficIntensity: solve.trafficIntensity,
        baseAgents: solve.baseAgents,
        staffedAgents: solve.staffedAgents,
        serviceLevel: solve.serviceLevel,
        asa: solve.asa,
        occupancy: solve.occupancy,
        isZeroVolume: solve.isZeroVolume
      });
    });

    state.bulk.results = results;

    // Summary Metrics
    var weightedAvgAHT = totalVolume > 0 ? (totalWorkloadSeconds / totalVolume) : 0;
    var weightedAvgSL = totalVolume > 0 ? (weightedSLSum / totalVolume) : 1.0;
    var weightedAvgOcc = totalVolume > 0 ? (weightedOccSum / totalVolume) : 0.0;

    bulkTotalVol.textContent = ErlanglyUtils.formatNumber(totalVolume);
    bulkAvgAht.textContent = Math.round(weightedAvgAHT) + 's';
    bulkPeakStaffed.textContent = ErlanglyUtils.formatNumber(peakStaffed);
    bulkPeakTime.textContent = 'At ' + peakInterval;
    bulkTotalHours.textContent = Math.round(totalStaffIntervalHours).toLocaleString() + ' hrs';
    bulkAvgSL.textContent = ErlanglyUtils.formatPercent(weightedAvgSL, 1);
    bulkAvgOcc.textContent = ErlanglyUtils.formatPercent(weightedAvgOcc, 1);
    bulkIntervalCount.textContent = results.length;

    // Render Table Rows
    tbodyBulkResults.innerHTML = '';
    results.forEach(function(r) {
      var tr = document.createElement('tr');
      var isMet = r.serviceLevel >= sla;
      var badgeClass = r.isZeroVolume ? 'badge-neutral' : (isMet ? 'badge-success' : 'badge-danger');
      var statusLabel = r.isZeroVolume ? 'Zero' : (isMet ? 'Met' : 'Breach');

      tr.innerHTML = 
        '<td class="mono"><strong>' + r.interval + '</strong></td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(r.volume) + '</td>' +
        '<td class="mono">' + Math.round(r.aht) + 's</td>' +
        '<td class="mono">' + ErlanglyUtils.formatErlangs(r.trafficIntensity) + '</td>' +
        '<td class="mono">' + r.baseAgents + '</td>' +
        '<td class="mono text-accent"><strong>' + (r.staffedAgents === Infinity ? '∞' : r.staffedAgents) + '</strong></td>' +
        '<td class="mono ' + (isMet ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(r.serviceLevel, 1) + '</td>' +
        '<td class="mono">' + ErlanglyUtils.formatSeconds(r.asa) + '</td>' +
        '<td class="mono ' + (r.occupancy > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(r.occupancy, 1) + '</td>' +
        '<td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>';

      tbodyBulkResults.appendChild(tr);
    });

    bulkResultsSection.style.display = 'flex';
  }

  // =========================================================================
  // MULTI-PERIOD STAFFING SIMULATOR (Daily / Weekly / Monthly)
  // =========================================================================

  function setupSimulatorEventListeners() {
    // Granularity Switcher Pills
    btnGranularityDaily.addEventListener('click', function() {
      setSimulatorGranularity('daily');
    });

    btnGranularityWeekly.addEventListener('click', function() {
      setSimulatorGranularity('weekly');
    });

    btnGranularityMonthly.addEventListener('click', function() {
      setSimulatorGranularity('monthly');
    });

    // Horizon dropdown change
    selectSimHorizon.addEventListener('change', function() {
      state.sim.horizon = parseInt(selectSimHorizon.value, 10) || 7;
      runSimulation();
    });

    // Simulator input change listeners
    [
      numSimVol, numSimAht, numSimGrowth, numSimAhtDrift,
      selectSimOpHours, selectSimWorkweek, selectSimDistribution, selectSimOpDays,
      numSimSLA, numSimTargetTime, numSimOccupancy, numSimShrinkage, numSimWage
    ].forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', runSimulation);
      el.addEventListener('change', runSimulation);
    });

    // Reset button
    btnResetSim.addEventListener('click', function() {
      resetSimulatorDefaults();
      ErlanglyUtils.showToast('Reset simulator levers to defaults', 'info');
    });

    // Export CSV
    btnExportSimCSV.addEventListener('click', exportSimulatorCSV);

    // Send to Scheduling
    btnSendSimScheduling.addEventListener('click', sendSimulatorToScheduling);

    // Save Plan
    btnSaveSimPlan.addEventListener('click', saveSimulatorPlan);
  }

  function setSimulatorGranularity(granularity) {
    state.sim.granularity = granularity;

    // Update pill buttons style
    [btnGranularityDaily, btnGranularityWeekly, btnGranularityMonthly].forEach(function(btn) {
      btn.className = 'btn btn-xs btn-ghost';
    });

    if (granularity === 'daily') {
      btnGranularityDaily.className = 'btn btn-xs btn-primary';
      simLeversTitle.textContent = 'Daily Simulation Parameters';
      lblSimVol.textContent = 'Daily Interaction Volume';
      addonSimVol.textContent = 'calls/day';
      hintSimVol.textContent = 'Day 1 volume distributed across intervals';
      numSimVol.value = '5000';
      grpSimGrowth.style.display = 'none';
      grpSimDistribution.style.display = 'block';
      grpSimOpDays.style.display = 'none';

      // Update horizon options
      selectSimHorizon.innerHTML = 
        '<option value="7" selected>7 Days</option>' +
        '<option value="14">14 Days</option>' +
        '<option value="30">30 Days</option>';
      state.sim.horizon = 7;

    } else if (granularity === 'weekly') {
      btnGranularityWeekly.className = 'btn btn-xs btn-primary';
      simLeversTitle.textContent = 'Weekly Simulation Parameters';
      lblSimVol.textContent = 'Weekly Interaction Volume';
      addonSimVol.textContent = 'calls/week';
      hintSimVol.textContent = 'Baseline Week 1 volume distributed across days';
      numSimVol.value = '35000';
      grpSimGrowth.style.display = 'block';
      addonSimGrowth.textContent = '%/week';
      grpSimDistribution.style.display = 'block';
      grpSimOpDays.style.display = 'block';

      // Update horizon options
      selectSimHorizon.innerHTML = 
        '<option value="4">4 Weeks (1 Mo)</option>' +
        '<option value="8">8 Weeks (2 Mo)</option>' +
        '<option value="12" selected>12 Weeks (1 Qtr)</option>' +
        '<option value="26">26 Weeks (6 Mo)</option>' +
        '<option value="52">52 Weeks (1 Yr)</option>';
      state.sim.horizon = 12;

    } else if (granularity === 'monthly') {
      btnGranularityMonthly.className = 'btn btn-xs btn-primary';
      simLeversTitle.textContent = 'Monthly Simulation Parameters';
      lblSimVol.textContent = 'Monthly Interaction Volume';
      addonSimVol.textContent = 'calls/month';
      hintSimVol.textContent = 'Month 1 baseline across working calendar';
      numSimVol.value = '150000';
      grpSimGrowth.style.display = 'block';
      addonSimGrowth.textContent = '%/month';
      grpSimDistribution.style.display = 'block';
      grpSimOpDays.style.display = 'none';

      // Update horizon options
      selectSimHorizon.innerHTML = 
        '<option value="3">3 Months (Qtr)</option>' +
        '<option value="6">6 Months</option>' +
        '<option value="12" selected>12 Months (1 Yr)</option>' +
        '<option value="24">24 Months (2 Yr)</option>';
      state.sim.horizon = 12;
    }

    runSimulation();
  }

  function resetSimulatorDefaults() {
    numSimAht.value = 180;
    numSimGrowth.value = 2.0;
    numSimAhtDrift.value = 0.0;
    selectSimOpHours.value = '12';
    selectSimWorkweek.value = '40';
    selectSimDistribution.value = 'diurnal';
    selectSimOpDays.value = '7';
    numSimSLA.value = 80;
    numSimTargetTime.value = 20;
    numSimOccupancy.value = 85;
    numSimShrinkage.value = 30;
    numSimWage.value = '25.00';

    if (state.sim.granularity === 'daily') {
      numSimVol.value = '5000';
      selectSimHorizon.value = '7';
      state.sim.horizon = 7;
    } else if (state.sim.granularity === 'weekly') {
      numSimVol.value = '35000';
      selectSimHorizon.value = '12';
      state.sim.horizon = 12;
    } else {
      numSimVol.value = '150000';
      selectSimHorizon.value = '12';
      state.sim.horizon = 12;
    }

    runSimulation();
  }

  function getSimulatorInputs() {
    return {
      granularity: state.sim.granularity,
      horizon: parseInt(selectSimHorizon.value, 10) || state.sim.horizon || 7,
      volume: Math.max(0, parseFloat(numSimVol.value) || 0),
      aht: Math.max(1, parseFloat(numSimAht.value) || 180),
      growthRatePct: parseFloat(numSimGrowth.value) || 0,
      ahtDriftPct: parseFloat(numSimAhtDrift.value) || 0,
      operatingHours: parseInt(selectSimOpHours.value, 10) || 12,
      workWeekHours: parseFloat(selectSimWorkweek.value) || 40.0,
      distribution: selectSimDistribution.value || 'diurnal',
      operatingDays: parseInt(selectSimOpDays.value, 10) || 7,
      targetServiceLevel: (parseFloat(numSimSLA.value) || 80) / 100,
      targetTimeSeconds: Math.max(1, parseFloat(numSimTargetTime.value) || 20),
      maxOccupancy: (parseFloat(numSimOccupancy.value) || 85) / 100,
      shrinkage: (parseFloat(numSimShrinkage.value) || 0) / 100,
      hourlyWage: Math.max(0, parseFloat(numSimWage.value) || 0)
    };
  }

  function runSimulation() {
    var p = getSimulatorInputs();
    state.sim = Object.assign({}, state.sim, p);

    if (p.granularity === 'daily') {
      runDailySimulation(p);
    } else if (p.granularity === 'weekly') {
      runWeeklySimulation(p);
    } else if (p.granularity === 'monthly') {
      runMonthlySimulation(p);
    }
  }

  // --- 1. Daily Simulation Runner ---
  function runDailySimulation(p) {
    // 7-day or N-day schedule simulation
    var DAY_NAMES_7 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DAY_WEIGHTS_7 = [0.18, 0.17, 0.16, 0.16, 0.15, 0.10, 0.08];

    var totalVolume = 0;
    var totalGrossHours = 0;
    var totalNetHours = 0;
    var peakStaffed = 0;
    var totalCost = 0;
    var weightedSLSum = 0;
    var weightedOccSum = 0;
    var days = [];

    for (var i = 0; i < p.horizon; i++) {
      var dayIdx = i % 7;
      var dayVol = p.volume * (DAY_WEIGHTS_7[dayIdx] / (1 / 7)); // Scaled around base daily average

      var daySim = Erlangly.simulateDailyProfile({
        dailyVolume: dayVol,
        aht: p.aht,
        operatingHours: p.operatingHours,
        intervalMinutes: 30,
        distribution: p.distribution,
        targetServiceLevel: p.targetServiceLevel,
        targetTimeSeconds: p.targetTimeSeconds,
        maxOccupancy: p.maxOccupancy,
        shrinkage: p.shrinkage,
        workWeekHours: p.workWeekHours,
        hourlyWage: p.hourlyWage
      });

      totalVolume += dayVol;
      totalGrossHours += daySim.totalGrossStaffHours;
      totalNetHours += daySim.totalNetStaffHours;
      totalCost += daySim.laborCost;

      if (daySim.peakStaffedAgents > peakStaffed) {
        peakStaffed = daySim.peakStaffedAgents;
      }

      weightedSLSum += daySim.averageServiceLevel * dayVol;
      weightedOccSum += daySim.averageOccupancy * dayVol;

      var label = p.horizon <= 7 ? DAY_NAMES_7[dayIdx] : ('Day ' + (i + 1) + ' (' + DAY_NAMES_7[dayIdx].substring(0, 3) + ')');

      days.push({
        index: i + 1,
        label: label,
        volume: dayVol,
        aht: p.aht,
        peakAgents: daySim.peakStaffedAgents,
        peakErlangs: daySim.peakErlangs,
        baseFTE: daySim.baseFTE,
        staffedFTE: daySim.staffedFTE,
        grossHours: daySim.totalGrossStaffHours,
        serviceLevel: daySim.averageServiceLevel,
        occupancy: daySim.averageOccupancy,
        laborCost: daySim.laborCost,
        intervals: daySim.intervals
      });
    }

    var avgSL = totalVolume > 0 ? (weightedSLSum / totalVolume) : 1.0;
    var avgOcc = totalVolume > 0 ? (weightedOccSum / totalVolume) : 0.0;
    var dailyHoursPerFTE = p.workWeekHours / 5;
    var avgDailyStaffedFTE = (totalGrossHours / p.horizon) / dailyHoursPerFTE;

    state.sim.results = {
      granularity: 'daily',
      horizon: p.horizon,
      totalVolume: totalVolume,
      totalGrossHours: totalGrossHours,
      totalLaborCost: totalCost,
      peakStaffed: peakStaffed,
      averageStaffedFTE: avgDailyStaffedFTE,
      averageServiceLevel: avgSL,
      averageOccupancy: avgOcc,
      periods: days
    };

    // Update KPI Cards
    lblKpiStaffed.textContent = 'Peak Staffed Agents';
    simKpiPeakStaffed.textContent = ErlanglyUtils.formatNumber(peakStaffed);
    simKpiPeakStaffedSub.textContent = 'Peak concurrent agents';

    lblKpiFte.textContent = 'Avg Daily Staffed FTE';
    simKpiFte.textContent = avgDailyStaffedFTE.toFixed(1);
    simKpiFteSub.textContent = 'Based on ' + p.workWeekHours + 'h workweek';

    simKpiHours.textContent = Math.round(totalGrossHours).toLocaleString() + ' hrs';
    simKpiHoursSub.textContent = p.horizon + '-day gross paid hours';

    simKpiCost.textContent = '$' + Math.round(totalCost).toLocaleString();
    simKpiCostSub.textContent = 'At $' + p.hourlyWage.toFixed(2) + '/hr';

    simKpiSL.textContent = ErlanglyUtils.formatPercent(avgSL, 1);
    updateSLAStatusBadge(simKpiSLBadge, avgSL, p.targetServiceLevel);

    simKpiOcc.textContent = ErlanglyUtils.formatPercent(avgOcc, 1);
    updateOccupancySubtext(simKpiOccSub, avgOcc);

    // Update Chart & Table
    simChartTitle.textContent = 'Daily Staffed Headcount & Volume Profile (' + p.horizon + ' Days)';
    simTableTitle.textContent = 'Daily Staffing & Capacity Breakdown (' + p.horizon + ' Days)';
    renderSimulationTable(days, 'daily');
    updateSimulationChart(days, 'Day', 'Staffed Agents', 'calls');
  }

  // --- 2. Weekly Simulation Runner ---
  function runWeeklySimulation(p) {
    var res = Erlangly.simulateWeeklyProfile({
      weeklyVolume: p.volume,
      aht: p.aht,
      weeks: p.horizon,
      growthRatePct: p.growthRatePct,
      ahtDriftPct: p.ahtDriftPct,
      operatingDays: p.operatingDays,
      operatingHours: p.operatingHours,
      diurnalPattern: p.distribution,
      targetServiceLevel: p.targetServiceLevel,
      targetTimeSeconds: p.targetTimeSeconds,
      maxOccupancy: p.maxOccupancy,
      shrinkage: p.shrinkage,
      workWeekHours: p.workWeekHours,
      hourlyWage: p.hourlyWage
    });

    state.sim.results = {
      granularity: 'weekly',
      horizon: p.horizon,
      totalVolume: res.totalVolume,
      totalGrossHours: res.totalGrossHours,
      totalLaborCost: res.totalLaborCost,
      peakStaffed: res.peakConcurrentAgents,
      averageStaffedFTE: res.averageStaffedFTE,
      averageServiceLevel: res.averageServiceLevel,
      averageOccupancy: res.averageOccupancy,
      periods: res.weeks
    };

    // Update KPI Cards
    lblKpiStaffed.textContent = 'Peak Concurrent Staff';
    simKpiPeakStaffed.textContent = ErlanglyUtils.formatNumber(res.peakConcurrentAgents);
    simKpiPeakStaffedSub.textContent = 'Across ' + p.horizon + ' weeks';

    lblKpiFte.textContent = 'Average Required FTE';
    simKpiFte.textContent = res.averageStaffedFTE.toFixed(1);
    simKpiFteSub.textContent = 'Gross shrinkage-adjusted';

    simKpiHours.textContent = Math.round(res.totalGrossHours).toLocaleString() + ' hrs';
    simKpiHoursSub.textContent = p.horizon + '-week gross paid hours';

    simKpiCost.textContent = '$' + Math.round(res.totalLaborCost).toLocaleString();
    simKpiCostSub.textContent = 'At $' + p.hourlyWage.toFixed(2) + '/hr';

    simKpiSL.textContent = ErlanglyUtils.formatPercent(res.averageServiceLevel, 1);
    updateSLAStatusBadge(simKpiSLBadge, res.averageServiceLevel, p.targetServiceLevel);

    simKpiOcc.textContent = ErlanglyUtils.formatPercent(res.averageOccupancy, 1);
    updateOccupancySubtext(simKpiOccSub, res.averageOccupancy);

    // Update Chart & Table
    simChartTitle.textContent = 'Weekly Staffed FTE & Volume Horizon (' + p.horizon + ' Weeks)';
    simTableTitle.textContent = 'Weekly Capacity & Staffing Projections (' + p.horizon + ' Weeks)';
    renderSimulationTable(res.weeks, 'weekly');
    updateSimulationChart(res.weeks, 'Week', 'Staffed FTE', 'calls/wk');
  }

  // --- 3. Monthly Simulation Runner ---
  function runMonthlySimulation(p) {
    var res = Erlangly.simulateMonthlyProfile({
      monthlyVolume: p.volume,
      aht: p.aht,
      months: p.horizon,
      growthRatePct: p.growthRatePct,
      ahtDriftPct: p.ahtDriftPct,
      operatingHours: p.operatingHours,
      targetServiceLevel: p.targetServiceLevel,
      targetTimeSeconds: p.targetTimeSeconds,
      maxOccupancy: p.maxOccupancy,
      shrinkage: p.shrinkage,
      workWeekHours: p.workWeekHours,
      hourlyWage: p.hourlyWage
    });

    state.sim.results = {
      granularity: 'monthly',
      horizon: p.horizon,
      totalVolume: res.totalVolume,
      totalGrossHours: res.totalGrossHours,
      totalLaborCost: res.totalLaborCost,
      peakStaffed: res.peakConcurrentAgents,
      averageStaffedFTE: res.averageStaffedFTE,
      averageServiceLevel: res.averageServiceLevel,
      averageOccupancy: res.averageOccupancy,
      periods: res.months
    };

    // Update KPI Cards
    lblKpiStaffed.textContent = 'Peak Concurrent Staff';
    simKpiPeakStaffed.textContent = ErlanglyUtils.formatNumber(res.peakConcurrentAgents);
    simKpiPeakStaffedSub.textContent = 'Peak concurrent agents';

    lblKpiFte.textContent = 'Average Monthly FTE';
    simKpiFte.textContent = res.averageStaffedFTE.toFixed(1);
    simKpiFteSub.textContent = 'Gross staffed FTE';

    simKpiHours.textContent = Math.round(res.totalGrossHours).toLocaleString() + ' hrs';
    simKpiHoursSub.textContent = p.horizon + '-month gross paid hours';

    simKpiCost.textContent = '$' + Math.round(res.totalLaborCost).toLocaleString();
    simKpiCostSub.textContent = 'Total horizon labor budget';

    simKpiSL.textContent = ErlanglyUtils.formatPercent(res.averageServiceLevel, 1);
    updateSLAStatusBadge(simKpiSLBadge, res.averageServiceLevel, p.targetServiceLevel);

    simKpiOcc.textContent = ErlanglyUtils.formatPercent(res.averageOccupancy, 1);
    updateOccupancySubtext(simKpiOccSub, res.averageOccupancy);

    // Update Chart & Table
    simChartTitle.textContent = 'Monthly Staffed FTE & Volume Projections (' + p.horizon + ' Months)';
    simTableTitle.textContent = 'Monthly Capacity & Staffing Plan (' + p.horizon + ' Months)';
    renderSimulationTable(res.months, 'monthly');
    updateSimulationChart(res.months, 'Month', 'Staffed FTE', 'calls/mo');
  }

  function updateSLAStatusBadge(el, sl, target) {
    if (sl >= target) {
      el.innerHTML = '<span class="badge badge-success">On Target</span>';
    } else if (sl >= target * 0.9) {
      el.innerHTML = '<span class="badge badge-warn">At Risk</span>';
    } else {
      el.innerHTML = '<span class="badge badge-danger">Breach</span>';
    }
  }

  function updateOccupancySubtext(el, occ) {
    if (occ > 0.90) {
      el.innerHTML = '<span class="text-warn">High burnout risk (&gt;90%)</span>';
    } else {
      el.textContent = 'Productive utilization';
    }
  }

  // --- Render Table for Simulation ---
  function renderSimulationTable(periods, granularity) {
    theadSimResults.innerHTML = '';
    tbodySimResults.innerHTML = '';

    if (!periods || periods.length === 0) {
      tbodySimResults.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No simulation data generated.</td></tr>';
      return;
    }

    var trHead = document.createElement('tr');
    if (granularity === 'daily') {
      trHead.innerHTML = 
        '<th>Period</th>' +
        '<th>Volume</th>' +
        '<th>Peak Erlangs</th>' +
        '<th>Peak Staffed</th>' +
        '<th>Daily FTE</th>' +
        '<th>Paid Hours</th>' +
        '<th>Projected SLA</th>' +
        '<th>Occupancy</th>' +
        '<th>Labor Cost</th>' +
        '<th>Status</th>';
    } else if (granularity === 'weekly') {
      trHead.innerHTML = 
        '<th>Week</th>' +
        '<th>Weekly Volume</th>' +
        '<th>Peak Agents</th>' +
        '<th>Base FTE</th>' +
        '<th>Staffed FTE</th>' +
        '<th>Gross Hours</th>' +
        '<th>Avg SLA</th>' +
        '<th>Avg Occupancy</th>' +
        '<th>Weekly Cost</th>' +
        '<th>Status</th>';
    } else {
      trHead.innerHTML = 
        '<th>Month</th>' +
        '<th>Monthly Volume</th>' +
        '<th>Work Days</th>' +
        '<th>Daily Avg Vol</th>' +
        '<th>Peak Agents</th>' +
        '<th>Staffed FTE</th>' +
        '<th>Monthly Hours</th>' +
        '<th>Avg SLA</th>' +
        '<th>Occupancy</th>' +
        '<th>Monthly Cost</th>' +
        '<th>Status</th>';
    }
    theadSimResults.appendChild(trHead);

    var targetSLA = state.sim.targetServiceLevel;

    periods.forEach(function(row) {
      var tr = document.createElement('tr');
      var isMet = row.serviceLevel >= targetSLA;
      var badgeClass = isMet ? 'badge-success' : 'badge-danger';
      var statusLabel = isMet ? 'Target Met' : 'Breach';

      if (granularity === 'daily') {
        tr.innerHTML = 
          '<td class="mono"><strong>' + row.label + '</strong></td>' +
          '<td class="mono">' + ErlanglyUtils.formatNumber(row.volume) + '</td>' +
          '<td class="mono">' + ErlanglyUtils.formatErlangs(row.peakErlangs) + '</td>' +
          '<td class="mono text-accent"><strong>' + row.peakAgents + '</strong></td>' +
          '<td class="mono">' + row.staffedFTE.toFixed(1) + '</td>' +
          '<td class="mono">' + Math.round(row.grossHours) + 'h</td>' +
          '<td class="mono ' + (isMet ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(row.serviceLevel, 1) + '</td>' +
          '<td class="mono ' + (row.occupancy > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(row.occupancy, 1) + '</td>' +
          '<td class="mono text-accent">$' + Math.round(row.laborCost).toLocaleString() + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>';
      } else if (granularity === 'weekly') {
        tr.innerHTML = 
          '<td class="mono"><strong>' + row.label + '</strong></td>' +
          '<td class="mono">' + ErlanglyUtils.formatNumber(row.volume) + '</td>' +
          '<td class="mono text-accent"><strong>' + row.peakAgents + '</strong></td>' +
          '<td class="mono">' + row.baseFTE.toFixed(1) + '</td>' +
          '<td class="mono text-accent"><strong>' + row.staffedFTE.toFixed(1) + '</strong></td>' +
          '<td class="mono">' + Math.round(row.grossHours).toLocaleString() + 'h</td>' +
          '<td class="mono ' + (isMet ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(row.serviceLevel, 1) + '</td>' +
          '<td class="mono ' + (row.occupancy > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(row.occupancy, 1) + '</td>' +
          '<td class="mono text-accent">$' + Math.round(row.laborCost).toLocaleString() + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>';
      } else {
        tr.innerHTML = 
          '<td class="mono"><strong>' + row.label + '</strong></td>' +
          '<td class="mono">' + ErlanglyUtils.formatNumber(row.volume) + '</td>' +
          '<td class="mono">' + row.workingDays + '</td>' +
          '<td class="mono">' + ErlanglyUtils.formatNumber(row.dailyVolume) + '</td>' +
          '<td class="mono text-accent"><strong>' + row.peakConcurrentAgents + '</strong></td>' +
          '<td class="mono text-accent"><strong>' + row.staffedFTE.toFixed(1) + '</strong></td>' +
          '<td class="mono">' + Math.round(row.grossHours).toLocaleString() + 'h</td>' +
          '<td class="mono ' + (isMet ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(row.serviceLevel, 1) + '</td>' +
          '<td class="mono ' + (row.occupancy > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(row.occupancy, 1) + '</td>' +
          '<td class="mono text-accent">$' + Math.round(row.laborCost).toLocaleString() + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>';
      }

      tbodySimResults.appendChild(tr);
    });
  }

  // --- Update Simulation Chart.js Visualizer ---
  function updateSimulationChart(periods, labelPrefix, staffMetricName, volUnit) {
    if (!chartCanvas || typeof Chart === 'undefined') return;

    if (state.sim.chart) {
      state.sim.chart.destroy();
      state.sim.chart = null;
    }

    var themeColors = typeof ErlanglyUtils !== 'undefined' && typeof ErlanglyUtils.getChartColors === 'function' ?
      ErlanglyUtils.getChartColors() :
      { textSecondary: '#334155', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1', tooltipTitle: '#0f172a', tooltipBody: '#334155', gridX: 'rgba(0,0,0,0.05)', gridY: 'rgba(0,0,0,0.07)', textMuted: '#64748b', accent: '#0f766e', info: '#0284c7', warn: '#d97706' };

    var labels = periods.map(function(p) { return p.label; });
    var staffData = periods.map(function(p) { return p.staffedFTE || p.peakAgents; });
    var baseData = periods.map(function(p) { return p.baseFTE || (p.peakAgents ? Math.round(p.peakAgents * 0.7) : 0); });
    var volData = periods.map(function(p) { return p.volume; });

    var ctx = chartCanvas.getContext('2d');
    state.sim.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: staffMetricName + ' (Shrinkage-Adjusted)',
            data: staffData,
            backgroundColor: themeColors.isLight ? 'rgba(15, 118, 110, 0.65)' : 'rgba(0, 210, 211, 0.45)',
            borderColor: themeColors.accent,
            borderWidth: 1.5,
            borderRadius: 4,
            yAxisID: 'y',
            order: 2
          },
          {
            label: 'Base Net Productive FTE',
            data: baseData,
            type: 'line',
            borderColor: themeColors.info,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 3,
            pointBackgroundColor: themeColors.info,
            yAxisID: 'y',
            order: 1
          },
          {
            label: 'Interaction Volume (' + volUnit + ')',
            data: volData,
            type: 'line',
            borderColor: themeColors.warn,
            backgroundColor: themeColors.isLight ? 'rgba(217, 119, 6, 0.1)' : 'rgba(245, 158, 11, 0.08)',
            fill: true,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: themeColors.warn,
            yAxisID: 'y1',
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: themeColors.textSecondary,
              font: { family: 'Inter', size: 11 },
              boxWidth: 12,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.tooltipTitle,
            bodyColor: themeColors.tooltipBody,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { color: themeColors.gridX },
            ticks: { color: themeColors.textMuted, font: { family: 'IBM Plex Mono', size: 10 } }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            grid: { color: themeColors.gridY },
            ticks: { color: themeColors.accent, font: { family: 'IBM Plex Mono', size: 10 } },
            title: { display: true, text: staffMetricName, color: themeColors.accent, font: { size: 10 } }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: themeColors.warn, font: { family: 'IBM Plex Mono', size: 10 } },
            title: { display: true, text: 'Volume', color: themeColors.warn, font: { size: 10 } }
          }
        }
      }
    });
  }

  // --- Export Simulation CSV ---
  function exportSimulatorCSV() {
    if (!state.sim.results || !state.sim.results.periods || state.sim.results.periods.length === 0) {
      ErlanglyUtils.showToast('No simulation data to export.', 'error');
      return;
    }

    var gran = state.sim.granularity;
    var filename = 'erlang_simulation_' + gran + '_' + state.sim.horizon + 'periods.csv';
    var headers = ['Period', 'Volume', 'Peak_Agents', 'Staffed_FTE', 'Gross_Hours', 'Service_Level', 'Occupancy', 'Labor_Cost', 'Status'];

    var rows = state.sim.results.periods.map(function(r) {
      return [
        r.label,
        r.volume,
        r.peakAgents || r.peakConcurrentAgents || 0,
        (r.staffedFTE || 0).toFixed(2),
        Math.round(r.grossHours || 0),
        ((r.serviceLevel || 0) * 100).toFixed(1) + '%',
        ((r.occupancy || 0) * 100).toFixed(1) + '%',
        Math.round(r.laborCost || 0),
        (r.serviceLevel >= state.sim.targetServiceLevel) ? 'TARGET_MET' : 'BREACH'
      ];
    });

    ErlanglyUtils.exportCSV(filename, headers, rows);
    ErlanglyUtils.showToast('Exported ' + filename, 'success');
  }

  // --- Send Simulator Requirement to Scheduling Tool ---
  function sendSimulatorToScheduling() {
    if (!state.sim.results || !state.sim.results.periods || state.sim.results.periods.length === 0) {
      ErlanglyUtils.showToast('No simulation results to hand off.', 'error');
      return;
    }

    // Convert simulation periods into interval-level or daily schedule requirements
    var periods = state.sim.results.periods;
    var handoffPayload = {
      source: 'capacity_simulation',
      granularity: state.sim.granularity,
      targetSLA: state.sim.targetServiceLevel,
      shrinkage: state.sim.shrinkage,
      workWeekHours: state.sim.workWeekHours,
      intervals: []
    };

    if (state.sim.granularity === 'daily' && periods[0].intervals) {
      // Pass the first day's 24 intervals
      handoffPayload.intervals = periods[0].intervals.map(function(inv) {
        return {
          interval: inv.time,
          volume: Math.round(inv.volume),
          aht: state.sim.aht,
          erlangs: inv.erlangs,
          requiredAgents: inv.baseAgents,
          staffedAgents: inv.staffedAgents
        };
      });
    } else {
      // Pass period-by-period blocks
      handoffPayload.intervals = periods.map(function(p) {
        return {
          interval: p.label,
          volume: Math.round(p.volume),
          aht: state.sim.aht,
          erlangs: p.peakErlangs || 0,
          requiredAgents: Math.round(p.baseFTE || p.peakAgents || 0),
          staffedAgents: Math.round(p.staffedFTE || p.peakAgents || 0)
        };
      });
    }

    ErlanglyUtils.setHandoff('scheduling', handoffPayload);
    window.location.href = 'scheduling.html?from=capacity';
  }

  // --- Save Simulation Plan to My Plans ---
  function saveSimulatorPlan() {
    var p = getSimulatorInputs();
    var res = state.sim.results;

    if (typeof ErlanglyPlans !== 'undefined') {
      ErlanglyPlans.showSaveModal('capacity', {
        type: 'simulation',
        simulation: p
      }, {
        granularity: p.granularity,
        horizon: p.horizon,
        peakStaffed: res ? res.peakStaffed : 0,
        averageStaffedFTE: res ? res.averageStaffedFTE : 0,
        totalLaborCost: res ? res.totalLaborCost : 0,
        averageServiceLevel: res ? res.averageServiceLevel : 0.8
      });
    } else {
      ErlanglyUtils.showToast('Plans persistence module loading...', 'info');
    }
  }

  // --- Incoming Handoff Handler (from hero / forecast / plans / shared link) ---
  function checkIncomingHandoff() {
    var params = new URLSearchParams(window.location.search);
    var from = params.get('from');

    // Shared read-only link — load data encoded in the URL
    if (params.get('shared') === '1' && window.ERLANGLY_SHARED_DATA) {
      var sd = window.ERLANGLY_SHARED_DATA;
      if (sd.volume) { inputVol.value = sd.volume; numVol.value = sd.volume; }
      if (sd.aht) { inputAht.value = sd.aht; numAht.value = sd.aht; }
      if (sd.intervalSeconds) { selectInterval.value = String(sd.intervalSeconds); }
      if (sd.targetServiceLevel) { numSLA.value = Math.round(sd.targetServiceLevel * 100); }
      if (sd.targetTimeSeconds) { numThreshold.value = sd.targetTimeSeconds; }
      if (sd.shrinkage !== undefined) { numShrinkage.value = Math.round(sd.shrinkage * 100); }
      if (sd.maxOccupancy !== undefined) { numOccupancy.value = Math.round(sd.maxOccupancy * 100); }
      // Disable save controls in shared mode
      var saveBtn = document.getElementById('btn-save-single-plan');
      if (saveBtn) { saveBtn.style.display = 'none'; }
      var saveSimBtn = document.getElementById('btn-save-sim-plan');
      if (saveSimBtn) { saveSimBtn.style.display = 'none'; }
      return;
    }

    if (!from) return;

    var handoff = ErlanglyUtils.getHandoff('capacity');
    if (!handoff) return;

    if (from === 'hero') {
      if (handoff.volume) { inputVol.value = handoff.volume; numVol.value = handoff.volume; }
      if (handoff.aht) { inputAht.value = handoff.aht; numAht.value = handoff.aht; }
      if (handoff.intervalSeconds) { selectInterval.value = String(handoff.intervalSeconds); }
      if (handoff.targetServiceLevel) { numSLA.value = Math.round(handoff.targetServiceLevel * 100); }
      if (handoff.targetTimeSeconds) { numThreshold.value = handoff.targetTimeSeconds; }
      if (handoff.shrinkage !== undefined) { numShrinkage.value = Math.round(handoff.shrinkage * 100); }

      handoffMessage.textContent = 'Loaded parameters from Landing Hero calculator.';
      handoffBanner.style.display = 'flex';
    } else if (from === 'forecast' && handoff.intervals) {
      tabBulk.click();
      loadBulkData(handoff.intervals);
      handoffMessage.textContent = 'Loaded ' + handoff.intervals.length + ' intervals from Forecasting tool.';
      handoffBanner.style.display = 'flex';
    } else if (from === 'plans') {
      // Check if this was a saved simulation plan
      if (handoff.type === 'simulation' && handoff.simulation) {
        tabSim.click();
        var simCfg = handoff.simulation;
        if (simCfg.granularity) setSimulatorGranularity(simCfg.granularity);
        if (simCfg.volume) numSimVol.value = simCfg.volume;
        if (simCfg.aht) numSimAht.value = simCfg.aht;
        if (simCfg.growthRatePct !== undefined) numSimGrowth.value = simCfg.growthRatePct;
        if (simCfg.operatingHours) selectSimOpHours.value = String(simCfg.operatingHours);
        if (simCfg.workWeekHours) selectSimWorkweek.value = String(simCfg.workWeekHours);
        if (simCfg.distribution) selectSimDistribution.value = simCfg.distribution;
        if (simCfg.targetServiceLevel) numSimSLA.value = Math.round(simCfg.targetServiceLevel * 100);
        if (simCfg.targetTimeSeconds) numSimTargetTime.value = simCfg.targetTimeSeconds;
        if (simCfg.maxOccupancy) numSimOccupancy.value = Math.round(simCfg.maxOccupancy * 100);
        if (simCfg.shrinkage !== undefined) numSimShrinkage.value = Math.round(simCfg.shrinkage * 100);
        if (simCfg.hourlyWage !== undefined) numSimWage.value = simCfg.hourlyWage.toFixed(2);
        runSimulation();
        handoffMessage.textContent = 'Restored simulation plan from My Plans.';
        handoffBanner.style.display = 'flex';
        return;
      }

      // Restore saved single or bulk plan
      if (handoff.volume) { inputVol.value = handoff.volume; numVol.value = handoff.volume; }
      if (handoff.aht) { inputAht.value = handoff.aht; numAht.value = handoff.aht; }
      if (handoff.intervalSeconds) { selectInterval.value = String(handoff.intervalSeconds); }
      if (handoff.targetServiceLevel) { numSLA.value = Math.round(handoff.targetServiceLevel * 100); }
      if (handoff.targetTimeSeconds) { numThreshold.value = handoff.targetTimeSeconds; }
      if (handoff.shrinkage !== undefined) { numShrinkage.value = Math.round(handoff.shrinkage * 100); }
      if (handoff.maxOccupancy !== undefined) { numOccupancy.value = Math.round(handoff.maxOccupancy * 100); }
      // If multi-queue plan was saved
      if (handoff.multiQueue && handoff.mqState) {
        if (tabMultiqueue) tabMultiqueue.click();
        var mqCfg = handoff.mqState;
        if (mqCfg.strategy) state.mq.strategy = mqCfg.strategy;
        if (mqCfg.queues) state.mq.queues = mqCfg.queues;
        if (mqCfg.overflowThresholdSec !== undefined) state.mq.overflowThresholdSec = mqCfg.overflowThresholdSec;
        if (mqCfg.specialistSplit !== undefined) state.mq.specialistSplit = mqCfg.specialistSplit;
        if (mqCfg.intervalSeconds) state.mq.intervalSeconds = mqCfg.intervalSeconds;
        if (mqCfg.shrinkage !== undefined) state.mq.shrinkage = mqCfg.shrinkage;
        renderMultiQueueInputs();
        calculateMultiQueue();
        handoffMessage.textContent = 'Restored Multi-Queue plan from My Plans.';
        handoffBanner.style.display = 'flex';
        return;
      }

      // If bulk intervals were saved, load them too
      if (handoff.intervals && handoff.intervals.length > 0) {
        tabBulk.click();
        loadBulkData(handoff.intervals);
        handoffMessage.textContent = 'Restored bulk capacity plan from My Plans.';
      } else {
        handoffMessage.textContent = 'Restored capacity plan from My Plans.';
      }
      handoffBanner.style.display = 'flex';
    }

    btnDismissHandoff.addEventListener('click', function() {
      handoffBanner.style.display = 'none';
    });
  }

  /* ==========================================================================
     MULTI-QUEUE & SKILLS ROUTING ENGINE (Phase 11)
     ========================================================================== */

  function setupMultiQueueEventListeners() {
    if (!tabMultiqueue) return;

    // Strategy Pills
    mqStrategyPills.forEach(function(pill) {
      pill.addEventListener('click', function() {
        mqStrategyPills.forEach(function(p) { p.className = 'btn btn-sm btn-ghost'; });
        pill.className = 'btn btn-sm btn-primary';
        state.mq.strategy = pill.getAttribute('data-strategy');

        if (state.mq.strategy === 'overflow') {
          lblStrategyLeverTitle.textContent = '⚡ Overflow Routing Parameters';
          mqControlsOverflow.style.display = 'block';
          mqControlsSkill.style.display = 'none';
        } else if (state.mq.strategy === 'skill') {
          lblStrategyLeverTitle.textContent = '🎯 Skill-Based Flex Allocation Parameters';
          mqControlsOverflow.style.display = 'none';
          mqControlsSkill.style.display = 'block';
        } else if (state.mq.strategy === 'siloed') {
          lblStrategyLeverTitle.textContent = '🔒 Siloed Dedicated Parameters';
          mqControlsOverflow.style.display = 'none';
          mqControlsSkill.style.display = 'none';
        } else {
          lblStrategyLeverTitle.textContent = '🌐 Full Blended Pool Parameters';
          mqControlsOverflow.style.display = 'none';
          mqControlsSkill.style.display = 'none';
        }

        calculateMultiQueue();
      });
    });

    // Overflow threshold
    if (inputOverflowThreshold) {
      inputOverflowThreshold.addEventListener('input', function() {
        state.mq.overflowThresholdSec = parseInt(inputOverflowThreshold.value, 10) || 0;
        lblOverflowThreshold.textContent = state.mq.overflowThresholdSec + 's';
        calculateMultiQueue();
      });
    }

    // Specialist split
    if (inputSpecialistSplit) {
      inputSpecialistSplit.addEventListener('input', function() {
        var pct = parseInt(inputSpecialistSplit.value, 10) || 70;
        state.mq.specialistSplit = pct / 100;
        lblSpecialistSplit.textContent = pct + '%';
        calculateMultiQueue();
      });
    }

    // Shared interval & shrinkage
    if (selectMqInterval) {
      selectMqInterval.addEventListener('change', function() {
        state.mq.intervalSeconds = parseInt(selectMqInterval.value, 10) || 1800;
        calculateMultiQueue();
      });
    }
    if (numMqShrinkage) {
      numMqShrinkage.addEventListener('input', function() {
        state.mq.shrinkage = (parseFloat(numMqShrinkage.value) || 0) / 100;
        calculateMultiQueue();
      });
    }

    // Add Queue
    if (btnAddMqQueue) {
      btnAddMqQueue.addEventListener('click', function() {
        var nextId = 'q' + (state.mq.queues.length + 1);
        state.mq.queues.push({
          id: nextId,
          name: 'Queue ' + (state.mq.queues.length + 1),
          volume: 200,
          aht: 200,
          targetSLA: 0.80,
          targetTime: 20
        });
        renderMultiQueueInputs();
        calculateMultiQueue();
      });
    }

    // Reset Sample Queues
    if (btnResetMqQueues) {
      btnResetMqQueues.addEventListener('click', function() {
        state.mq.queues = [
          { id: 'q1', name: 'Inbound Support', volume: 400, aht: 240, targetSLA: 0.80, targetTime: 20 },
          { id: 'q2', name: 'Billing & Accounts', volume: 250, aht: 180, targetSLA: 0.80, targetTime: 20 },
          { id: 'q3', name: 'Tech Escalations', volume: 150, aht: 320, targetSLA: 0.80, targetTime: 20 }
        ];
        renderMultiQueueInputs();
        calculateMultiQueue();
      });
    }

    // Export CSV
    if (btnExportMqCSV) {
      btnExportMqCSV.addEventListener('click', exportMultiQueueCSV);
    }

    // Save Plan
    if (btnSaveMqPlan) {
      btnSaveMqPlan.addEventListener('click', saveMultiQueuePlan);
    }
  }

  function renderMultiQueueInputs() {
    if (!tbodyMqQueues) return;
    lblMqQueueCount.textContent = state.mq.queues.length;
    tbodyMqQueues.innerHTML = '';

    // Populate destination selector
    if (selectOverflowDest) {
      selectOverflowDest.innerHTML = '';
      state.mq.queues.forEach(function(q, i) {
        var opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.name + (i === state.mq.queues.length - 1 ? ' (Default Backup)' : '');
        if (i === state.mq.queues.length - 1) opt.selected = true;
        selectOverflowDest.appendChild(opt);
      });
    }

    state.mq.queues.forEach(function(q, idx) {
      var tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-subtle)';

      tr.innerHTML = 
        '<td style="padding: 4px 6px;">' +
          '<input type="text" class="form-control mq-name" value="' + (q.name || '') + '" style="height: 28px; font-size: 11px; width: 100%;">' +
        '</td>' +
        '<td style="padding: 4px 6px;">' +
          '<input type="number" class="form-control mono mq-vol" min="0" max="50000" value="' + q.volume + '" style="height: 28px; font-size: 11px; width: 70px;">' +
        '</td>' +
        '<td style="padding: 4px 6px;">' +
          '<input type="number" class="form-control mono mq-aht" min="1" max="10000" value="' + q.aht + '" style="height: 28px; font-size: 11px; width: 65px;">' +
        '</td>' +
        '<td style="padding: 4px 6px;">' +
          '<input type="number" class="form-control mono mq-sla" min="1" max="100" value="' + Math.round((q.targetSLA || 0.80) * 100) + '" style="height: 28px; font-size: 11px; width: 55px;">' +
        '</td>' +
        '<td style="padding: 4px 6px; text-align: center;">' +
          (state.mq.queues.length > 1 ? 
            '<button class="btn btn-ghost btn-sm btn-del-mq" style="color: var(--danger); padding: 0 4px; font-size: 12px;" title="Delete queue">✕</button>' : ''
          ) +
        '</td>';

      var inName = tr.querySelector('.mq-name');
      var inVol = tr.querySelector('.mq-vol');
      var inAht = tr.querySelector('.mq-aht');
      var inSla = tr.querySelector('.mq-sla');
      var btnDel = tr.querySelector('.btn-del-mq');

      inName.addEventListener('input', function() {
        q.name = inName.value.trim() || ('Queue ' + (idx + 1));
        calculateMultiQueue();
      });
      inVol.addEventListener('input', function() {
        q.volume = Math.max(0, parseInt(inVol.value, 10) || 0);
        calculateMultiQueue();
      });
      inAht.addEventListener('input', function() {
        q.aht = Math.max(1, parseInt(inAht.value, 10) || 180);
        calculateMultiQueue();
      });
      inSla.addEventListener('input', function() {
        q.targetSLA = (parseInt(inSla.value, 10) || 80) / 100;
        calculateMultiQueue();
      });

      if (btnDel) {
        btnDel.addEventListener('click', function() {
          state.mq.queues.splice(idx, 1);
          renderMultiQueueInputs();
          calculateMultiQueue();
        });
      }

      tbodyMqQueues.appendChild(tr);
    });
  }

  function calculateMultiQueue() {
    if (!state.mq.queues || state.mq.queues.length === 0) return;

    var sec = state.mq.intervalSeconds || 1800;
    var shrinkage = state.mq.shrinkage || 0.30;
    var strategy = state.mq.strategy || 'overflow';

    var results = {
      strategy: strategy,
      totalAgents: 0,
      siloedAgents: 0,
      pooledAgents: 0,
      headcountSaved: 0,
      percentEfficiencyGain: 0,
      breakdownRows: []
    };

    // 1. Compute Siloed Baseline
    var sumSiloed = 0;
    var siloedBreakdowns = [];
    state.mq.queues.forEach(function(q) {
      var solve = Erlangly.agentsRequired({
        volume: q.volume,
        aht: q.aht,
        intervalSeconds: sec,
        targetServiceLevel: q.targetSLA || 0.80,
        targetTimeSeconds: q.targetTime || 20
      });
      sumSiloed += solve.baseAgents;
      siloedBreakdowns.push({
        name: q.name,
        offeredVol: q.volume,
        handledVol: q.volume,
        overflowVol: 0,
        erlangs: solve.trafficIntensity,
        siloedAgents: solve.baseAgents,
        allocatedAgents: solve.baseAgents,
        serviceLevel: solve.serviceLevel,
        asa: solve.averageSpeedOfAnswer,
        occupancy: solve.occupancy
      });
    });

    // 2. Compute Unified Pooled Baseline
    var blendedWork = Erlangly.blendedWorkload(state.mq.queues, sec);
    var pooledSolve = Erlangly.agentsRequired({
      volume: blendedWork.totalVolume,
      aht: blendedWork.weightedAHT,
      intervalSeconds: sec,
      targetServiceLevel: 0.80,
      targetTimeSeconds: 20
    });

    results.siloedAgents = sumSiloed;
    results.pooledAgents = pooledSolve.baseAgents;

    // 3. Strategy Calculation
    if (strategy === 'siloed') {
      results.totalAgents = sumSiloed;
      results.headcountSaved = 0;
      results.percentEfficiencyGain = 0;
      results.breakdownRows = siloedBreakdowns;
    } else if (strategy === 'blended') {
      results.totalAgents = pooledSolve.baseAgents;
      results.headcountSaved = Math.max(0, sumSiloed - pooledSolve.baseAgents);
      results.percentEfficiencyGain = sumSiloed > 0 ? (results.headcountSaved / sumSiloed) * 100 : 0;
      results.breakdownRows = [{
        name: 'Unified Cross-Trained Queue',
        offeredVol: blendedWork.totalVolume,
        handledVol: blendedWork.totalVolume,
        overflowVol: 0,
        erlangs: blendedWork.totalErlangs,
        siloedAgents: sumSiloed,
        allocatedAgents: pooledSolve.baseAgents,
        serviceLevel: pooledSolve.serviceLevel,
        asa: pooledSolve.averageSpeedOfAnswer,
        occupancy: pooledSolve.occupancy
      }];
    } else if (strategy === 'overflow') {
      var ofRes = Erlangly.overflowRouting(state.mq.queues, state.mq.overflowThresholdSec, sec);
      results.totalAgents = ofRes.totalAgents;
      results.headcountSaved = ofRes.headcountSaved;
      results.percentEfficiencyGain = ofRes.percentEfficiencyGain;

      var rows = [];
      ofRes.primaryQueues.forEach(function(pq) {
        rows.push({
          name: pq.name + ' (Primary)',
          offeredVol: pq.volume,
          handledVol: Math.round(pq.handledVolume),
          overflowVol: Math.round(pq.overflowVolume),
          erlangs: pq.rawErlangs,
          siloedAgents: pq.siloedAgents,
          allocatedAgents: pq.primaryAgents,
          serviceLevel: pq.primarySLA,
          asa: pq.primaryASA,
          occupancy: pq.primaryOccupancy
        });
      });

      if (ofRes.secondaryQueue) {
        var sq = ofRes.secondaryQueue;
        rows.push({
          name: sq.name + ' (Secondary / Backup)',
          offeredVol: Math.round(sq.totalVolume),
          handledVol: Math.round(sq.totalVolume),
          overflowVol: 0,
          erlangs: sq.totalErlangs,
          siloedAgents: sq.siloedAgents,
          allocatedAgents: sq.secondaryAgents,
          serviceLevel: sq.secondarySLA,
          asa: sq.secondaryASA,
          occupancy: sq.secondaryOccupancy
        });
      }
      results.breakdownRows = rows;
    } else if (strategy === 'skill') {
      var skRes = Erlangly.skillBasedRouting(state.mq.queues, state.mq.specialistSplit, sec);
      results.totalAgents = skRes.totalAgents;
      results.headcountSaved = skRes.headcountSaved;
      results.percentEfficiencyGain = skRes.percentEfficiencyGain;

      var sRows = [];
      skRes.specialistGroups.forEach(function(sg) {
        sRows.push({
          name: sg.queueName + ' (Specialists)',
          offeredVol: Math.round(sg.dedicatedVolume + sg.flexVolume),
          handledVol: Math.round(sg.dedicatedVolume),
          overflowVol: Math.round(sg.flexVolume),
          erlangs: (sg.dedicatedVolume * sg.aht) / sec,
          siloedAgents: sg.siloedAgents,
          allocatedAgents: sg.specialistAgents,
          serviceLevel: sg.serviceLevel,
          asa: 15,
          occupancy: sg.occupancy
        });
      });

      if (skRes.flexGroup) {
        var fg = skRes.flexGroup;
        sRows.push({
          name: fg.name,
          offeredVol: Math.round(fg.totalFlexVolume),
          handledVol: Math.round(fg.totalFlexVolume),
          overflowVol: 0,
          erlangs: fg.flexErlangs,
          siloedAgents: 0,
          allocatedAgents: fg.flexAgents,
          serviceLevel: fg.serviceLevel,
          asa: 12,
          occupancy: fg.occupancy
        });
      }
      results.breakdownRows = sRows;
    }

    state.mq.results = results;
    renderMultiQueueResults(results);
    renderMultiQueueChart(results);
  }

  function renderMultiQueueResults(res) {
    if (!res) return;

    var shrinkage = state.mq.shrinkage || 0.30;
    var shrinkageStaffed = shrinkage < 1.0 ? Math.ceil(res.totalAgents / (1 - shrinkage)) : res.totalAgents;
    var siloedStaffed = shrinkage < 1.0 ? Math.ceil(res.siloedAgents / (1 - shrinkage)) : res.siloedAgents;
    var shrinkageSaved = Math.max(0, siloedStaffed - shrinkageStaffed);

    lblMqTotalAgents.textContent = res.totalAgents;
    lblMqSiloedAgents.textContent = res.siloedAgents;
    lblMqSavedAgents.textContent = res.headcountSaved > 0 ? ('-' + res.headcountSaved + ' FTE') : '0';
    lblMqShrinkageSaved.textContent = '+' + shrinkageSaved + ' saved with ' + Math.round(shrinkage * 100) + '% shrinkage';
    lblMqEfficiencyGain.textContent = res.percentEfficiencyGain.toFixed(1) + '%';

    if (tbodyMqBreakdown) {
      tbodyMqBreakdown.innerHTML = '';
      res.breakdownRows.forEach(function(row) {
        var tr = document.createElement('tr');
        var slaColor = (row.serviceLevel >= 0.80) ? 'var(--accent)' : 'var(--warn)';

        tr.innerHTML = 
          '<td style="font-weight: 600;">' + row.name + '</td>' +
          '<td class="mono">' + row.offeredVol + '</td>' +
          '<td class="mono">' + row.handledVol + '</td>' +
          '<td class="mono" style="color: var(--text-muted);">' + row.overflowVol + '</td>' +
          '<td class="mono">' + row.erlangs.toFixed(1) + '</td>' +
          '<td class="mono" style="color: var(--text-muted);">' + (row.siloedAgents || '—') + '</td>' +
          '<td class="mono" style="font-weight: 700; color: var(--accent);">' + row.allocatedAgents + '</td>' +
          '<td class="mono" style="color: ' + slaColor + '; font-weight: 600;">' + (row.serviceLevel * 100).toFixed(1) + '%</td>' +
          '<td class="mono">' + Math.round(row.asa) + 's</td>' +
          '<td class="mono">' + (row.occupancy * 100).toFixed(1) + '%</td>';

        tbodyMqBreakdown.appendChild(tr);
      });
    }
  }

  function renderMultiQueueChart(res) {
    if (!chartMqComparisonCanvas || typeof Chart === 'undefined') return;

    var ctx = chartMqComparisonCanvas.getContext('2d');
    if (state.mq.chart) {
      state.mq.chart.destroy();
    }

    var strategyLabels = {
      siloed: 'Siloed Dedicated',
      overflow: 'Overflow Routing',
      skill: 'Skill-Based Routing',
      blended: 'Full Blended Pool'
    };

    var currentStrategyLabel = strategyLabels[res.strategy] || 'Selected Strategy';

    var themeColors = typeof ErlanglyUtils !== 'undefined' && typeof ErlanglyUtils.getChartColors === 'function' ?
      ErlanglyUtils.getChartColors() :
      { isLight: true, textSecondary: '#334155', textMuted: '#64748b', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1', tooltipTitle: '#0f172a', tooltipBody: '#334155', gridY: 'rgba(0,0,0,0.07)', accent: '#0f766e', danger: '#dc2626', success: '#059669' };

    state.mq.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Siloed Dedicated Baseline', currentStrategyLabel, 'Unified Blended Pool'],
        datasets: [{
          label: 'Required Base Staffing (Agents)',
          data: [res.siloedAgents, res.totalAgents, res.pooledAgents],
          backgroundColor: [
            themeColors.isLight ? 'rgba(220, 38, 38, 0.6)' : 'rgba(255, 107, 107, 0.45)',
            themeColors.isLight ? 'rgba(15, 118, 110, 0.8)' : 'rgba(0, 210, 211, 0.75)',
            themeColors.isLight ? 'rgba(5, 150, 105, 0.6)' : 'rgba(29, 209, 161, 0.45)'
          ],
          borderColor: [
            themeColors.danger,
            themeColors.accent,
            themeColors.success
          ],
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.tooltipTitle,
            bodyColor: themeColors.tooltipBody,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              label: function(item) {
                return ' ' + item.formattedValue + ' agents required';
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: themeColors.gridY },
            ticks: { color: themeColors.textMuted, font: { family: 'IBM Plex Mono', size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: themeColors.textSecondary, font: { size: 11 } }
          }
        }
      }
    });
  }

  function exportMultiQueueCSV() {
    if (!state.mq.results) return;
    var res = state.mq.results;
    var rows = [
      ['Routing Strategy', res.strategy.toUpperCase()],
      ['Total Required Headcount', res.totalAgents],
      ['Siloed Baseline Headcount', res.siloedAgents],
      ['Headcount Saved', res.headcountSaved],
      ['Pooling Efficiency Gain %', res.percentEfficiencyGain.toFixed(2) + '%'],
      [],
      ['Queue / Tier', 'Offered Volume', 'Handled Volume', 'Overflow Volume', 'Erlangs', 'Siloed Staff', 'Allocated Staff', 'SLA %', 'ASA (s)', 'Occupancy %']
    ];

    res.breakdownRows.forEach(function(r) {
      rows.push([
        r.name,
        r.offeredVol,
        r.handledVol,
        r.overflowVol,
        r.erlangs.toFixed(2),
        r.siloedAgents,
        r.allocatedAgents,
        (r.serviceLevel * 100).toFixed(1) + '%',
        Math.round(r.asa),
        (r.occupancy * 100).toFixed(1) + '%'
      ]);
    });

    var csv = rows.map(function(row) {
      return row.map(function(cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    ErlanglyUtils.exportCSV('erlangly-multiqueue-' + res.strategy + '.csv', csv);
  }

  function saveMultiQueuePlan() {
    if (typeof root.ErlanglyPlans !== 'undefined' && root.ErlanglyPlans.showSaveModal) {
      var inputs = {
        multiQueue: true,
        mqState: {
          strategy: state.mq.strategy,
          queues: state.mq.queues,
          overflowThresholdSec: state.mq.overflowThresholdSec,
          specialistSplit: state.mq.specialistSplit,
          intervalSeconds: state.mq.intervalSeconds,
          shrinkage: state.mq.shrinkage
        }
      };
      var outputs = {
        strategy: state.mq.strategy,
        totalAgents: state.mq.results ? state.mq.results.totalAgents : 0,
        siloedAgents: state.mq.results ? state.mq.results.siloedAgents : 0,
        headcountSaved: state.mq.results ? state.mq.results.headcountSaved : 0,
        percentEfficiencyGain: state.mq.results ? state.mq.results.percentEfficiencyGain : 0
      };
      root.ErlanglyPlans.showSaveModal('capacity', inputs, outputs, function(saved) {
        ErlanglyUtils.showToast('Multi-Queue Plan saved successfully!', 'success');
      });
    }
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

