/**
 * Erlangly Capacity Planning Tool (js/capacity.js)
 * 
 * Features:
 * - Single-interval interactive Erlang C solver & sensitivity explorer
 * - Bulk CSV multi-interval processor with summary metrics
 * - CSV export & Cross-tool handoff to Scheduling (localStorage)
 * - Auto-loads handoffs from Hero or Forecasting (?from=hero / ?from=forecast)
 */

(function() {
  'use strict';

  // --- State ---
  var state = {
    mode: 'single', // 'single' | 'bulk'
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
  var viewSingle = document.getElementById('view-single');
  var viewBulk = document.getElementById('view-bulk');

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
  var btnDownloadTemplate = document.getElementById('btn-download-template');
  var bulkTargetSLA = document.getElementById('bulk-target-sla');
  var bulkTargetTime = document.getElementById('bulk-target-time');
  var bulkOccupancyCap = document.getElementById('bulk-occupancy-cap');
  var bulkShrinkage = document.getElementById('bulk-shrinkage');
  var bulkIntervalLen = document.getElementById('bulk-interval-len');

  var bulkResultsSection = document.getElementById('bulk-results-section');
  var bulkTotalVol = document.getElementById('bulk-total-vol');
  var bulkAvgAht = document.getElementById('bulk-avg-aht');
  var bulkPeakStaffed = document.getElementById('bulk-peak-staffed');
  var bulkPeakTime = document.getElementById('bulk-peak-time');
  var bulkTotalHours = document.getElementById('bulk-total-hours');
  var bulkAvgSL = document.getElementById('bulk-avg-sl');
  var bulkAvgOcc = document.getElementById('bulk-avg-occ');
  var bulkIntervalCount = document.getElementById('bulk-interval-count');
  var tbodyBulkResults = document.getElementById('tbody-bulk-results');

  var btnExportBulkCSV = document.getElementById('btn-export-bulk-csv');
  var btnSendBulkScheduling = document.getElementById('btn-send-bulk-scheduling');
  var btnSendSingleScheduling = document.getElementById('btn-send-to-scheduling-single');
  var btnResetSingle = document.getElementById('btn-reset-single');
  var handoffBanner = document.getElementById('handoff-banner');
  var handoffMessage = document.getElementById('handoff-message');
  var btnDismissHandoff = document.getElementById('btn-dismiss-handoff');

  // --- Initialization ---
  function init() {
    setupTabSwitching();
    setupSingleEventListeners();
    setupBulkEventListeners();
    checkIncomingHandoff();
    calculateSingle();
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    tabSingle.addEventListener('click', function() {
      state.mode = 'single';
      tabSingle.className = 'btn btn-sm btn-primary';
      tabBulk.className = 'btn btn-sm btn-ghost';
      viewSingle.style.display = 'grid';
      viewBulk.style.display = 'none';
    });

    tabBulk.addEventListener('click', function() {
      state.mode = 'bulk';
      tabBulk.className = 'btn btn-sm btn-primary';
      tabSingle.className = 'btn btn-sm btn-ghost';
      viewSingle.style.display = 'none';
      viewBulk.style.display = 'flex';
      if (state.bulk.rows.length === 0) {
        loadBulkData(SAMPLE_BULK_DATA);
      }
    });
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
      parseBulkCSV(text, file.name);
    });

    // Sample data button
    btnSampleCSV.addEventListener('click', function() {
      loadBulkData(SAMPLE_BULK_DATA);
      ErlanglyUtils.showToast('Loaded 24 sample daytime intervals (08:00 - 20:00)', 'success');
    });

    // Download template CSV
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

    // Global constraints
    [bulkTargetSLA, bulkTargetTime, bulkOccupancyCap, bulkShrinkage, bulkIntervalLen].forEach(function(el) {
      el.addEventListener('input', processBulkData);
      el.addEventListener('change', processBulkData);
    });

    // Export Bulk Plan as CSV
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

    // Send Bulk Plan to Scheduling
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

  // --- Bulk CSV Parser ---
  function parseBulkCSV(text, filename) {
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
      // Restore saved plan — handoff contains the plan's inputs object
      if (handoff.volume) { inputVol.value = handoff.volume; numVol.value = handoff.volume; }
      if (handoff.aht) { inputAht.value = handoff.aht; numAht.value = handoff.aht; }
      if (handoff.intervalSeconds) { selectInterval.value = String(handoff.intervalSeconds); }
      if (handoff.targetServiceLevel) { numSLA.value = Math.round(handoff.targetServiceLevel * 100); }
      if (handoff.targetTimeSeconds) { numThreshold.value = handoff.targetTimeSeconds; }
      if (handoff.shrinkage !== undefined) { numShrinkage.value = Math.round(handoff.shrinkage * 100); }
      if (handoff.maxOccupancy !== undefined) { numOccupancy.value = Math.round(handoff.maxOccupancy * 100); }
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

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
