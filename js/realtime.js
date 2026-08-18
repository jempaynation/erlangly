/**
 * Erlangly Real-Time & VTO Calculator (js/realtime.js)
 * 
 * Features:
 * - Intraday "Simulate the Day" shift progression stepper with auto-advance
 * - Live queue metrics: Actual SLA, ASA, Occupancy, Adherence %
 * - Day-to-date cumulative scorecard (weighted SLA & volume variance)
 * - Guarded VTO Calculator (SLA safety buffer, occupancy ceiling, agent cap)
 * - Inline VTO approval with live SLA recalculation & cost-savings tracking
 * - CSV export of intraday actuals and VTO offer sheets
 */

(function() {
  'use strict';

  // --- Realistic 24-Interval Daytime Contact Center Intraday Dataset ---
  var INTRADAY_DATA = [
    { interval: '08:00', fcstVol: 110, actVol: 105, fcstAht: 175, actAht: 172, schedStaff: 20, actStaff: 19, vtoApproved: 0 },
    { interval: '08:30', fcstVol: 160, actVol: 165, fcstAht: 180, actAht: 184, schedStaff: 29, actStaff: 28, vtoApproved: 0 },
    { interval: '09:00', fcstVol: 240, actVol: 255, fcstAht: 190, actAht: 196, schedStaff: 45, actStaff: 43, vtoApproved: 0 },
    { interval: '09:30', fcstVol: 310, actVol: 340, fcstAht: 195, actAht: 205, schedStaff: 58, actStaff: 52, vtoApproved: 0 }, // Spike & slight adherence breach
    { interval: '10:00', fcstVol: 380, actVol: 410, fcstAht: 200, actAht: 212, schedStaff: 70, actStaff: 64, vtoApproved: 0 }, // Mid-morning peak
    { interval: '10:30', fcstVol: 420, actVol: 435, fcstAht: 205, actAht: 208, schedStaff: 79, actStaff: 76, vtoApproved: 0 },
    { interval: '11:00', fcstVol: 450, actVol: 440, fcstAht: 210, actAht: 204, schedStaff: 86, actStaff: 85, vtoApproved: 0 },
    { interval: '11:30', fcstVol: 430, actVol: 415, fcstAht: 205, actAht: 200, schedStaff: 80, actStaff: 81, vtoApproved: 0 },
    { interval: '12:00', fcstVol: 390, actVol: 360, fcstAht: 195, actAht: 190, schedStaff: 70, actStaff: 72, vtoApproved: 0 }, // Lunch drop -> Surplus
    { interval: '12:30', fcstVol: 370, actVol: 330, fcstAht: 190, actAht: 185, schedStaff: 66, actStaff: 68, vtoApproved: 0 }, // Surplus
    { interval: '13:00', fcstVol: 350, actVol: 320, fcstAht: 185, actAht: 180, schedStaff: 60, actStaff: 62, vtoApproved: 0 }, // Surplus
    { interval: '13:30', fcstVol: 360, actVol: 355, fcstAht: 185, actAht: 186, schedStaff: 63, actStaff: 61, vtoApproved: 0 },
    { interval: '14:00', fcstVol: 410, actVol: 425, fcstAht: 190, actAht: 194, schedStaff: 72, actStaff: 70, vtoApproved: 0 },
    { interval: '14:30', fcstVol: 440, actVol: 460, fcstAht: 195, actAht: 200, schedStaff: 79, actStaff: 77, vtoApproved: 0 },
    { interval: '15:00', fcstVol: 460, actVol: 475, fcstAht: 200, actAht: 205, schedStaff: 85, actStaff: 84, vtoApproved: 0 },
    { interval: '15:30', fcstVol: 430, actVol: 410, fcstAht: 195, actAht: 190, schedStaff: 78, actStaff: 79, vtoApproved: 0 },
    { interval: '16:00', fcstVol: 390, actVol: 365, fcstAht: 190, actAht: 185, schedStaff: 69, actStaff: 71, vtoApproved: 0 }, // Late afternoon surplus
    { interval: '16:30', fcstVol: 340, actVol: 315, fcstAht: 185, actAht: 180, schedStaff: 59, actStaff: 62, vtoApproved: 0 }, // Surplus
    { interval: '17:00', fcstVol: 290, actVol: 270, fcstAht: 180, actAht: 175, schedStaff: 50, actStaff: 53, vtoApproved: 0 }, // Surplus
    { interval: '17:30', fcstVol: 240, actVol: 220, fcstAht: 175, actAht: 170, schedStaff: 42, actStaff: 45, vtoApproved: 0 }, // Surplus
    { interval: '18:00', fcstVol: 190, actVol: 175, fcstAht: 170, actAht: 165, schedStaff: 33, actStaff: 35, vtoApproved: 0 }, // Surplus
    { interval: '18:30', fcstVol: 150, actVol: 140, fcstAht: 165, actAht: 160, schedStaff: 26, actStaff: 28, vtoApproved: 0 },
    { interval: '19:00', fcstVol: 120, actVol: 110, fcstAht: 160, actAht: 155, schedStaff: 20, actStaff: 21, vtoApproved: 0 },
    { interval: '19:30', fcstVol: 90, actVol: 85, fcstAht: 155, actAht: 150, schedStaff: 16, actStaff: 17, vtoApproved: 0 }
  ];

  // --- State ---
  var state = {
    intervals: INTRADAY_DATA.slice(),
    currentIdx: 0,
    intervalLength: 1800, // 30 min
    targetSLA: 0.80,
    targetTime: 20,
    isPlaying: false,
    timer: null,
    vto: {
      slaBuffer: 0.05,     // +5% (target 85% SLA post-VTO)
      occCeiling: 0.85,    // 85% max occupancy
      maxCapPerInterval: 8,
      hourlyRate: 22.00,
      offers: []
    }
  };

  // --- DOM References ---
  var tabIntradaySim = document.getElementById('tab-intraday-sim');
  var tabVtoCalc = document.getElementById('tab-vto-calc');
  var viewIntraday = document.getElementById('view-intraday');
  var viewVto = document.getElementById('view-vto');

  var simCurrentTime = document.getElementById('sim-current-time');
  var simStatusBadge = document.getElementById('sim-status-badge');
  var btnSimPrev = document.getElementById('btn-sim-prev');
  var btnSimPlay = document.getElementById('btn-sim-play');
  var btnSimNext = document.getElementById('btn-sim-next');
  var btnSimReset = document.getElementById('btn-sim-reset');
  var selectSimInterval = document.getElementById('select-sim-interval');

  var rtCurrentSL = document.getElementById('rt-current-sl');
  var rtSLStatus = document.getElementById('rt-sl-status');
  var rtCurrentASA = document.getElementById('rt-current-asa');
  var rtCurrentOcc = document.getElementById('rt-current-occ');
  var rtOccStatus = document.getElementById('rt-occ-status');
  var rtCurrentVol = document.getElementById('rt-current-vol');
  var rtVolVariance = document.getElementById('rt-vol-variance');
  var rtCurrentAdherence = document.getElementById('rt-current-adherence');
  var rtAdherenceCount = document.getElementById('rt-adherence-count');
  var rtCurrentErlangs = document.getElementById('rt-current-erlangs');

  var dtdIntervalSpan = document.getElementById('dtd-interval-span');
  var dtdTotalVol = document.getElementById('dtd-total-vol');
  var dtdVolVar = document.getElementById('dtd-vol-var');
  var dtdCumSL = document.getElementById('dtd-cum-sl');
  var dtdCumASA = document.getElementById('dtd-cum-asa');
  var dtdCumAdherence = document.getElementById('dtd-cum-adherence');
  var dtdBreachCount = document.getElementById('dtd-breach-count');
  var tbodyIntradayTimeline = document.getElementById('tbody-intraday-timeline');
  var btnExportRtCSV = document.getElementById('btn-export-rt-csv');

  // VTO DOM
  var numVtoBuffer = document.getElementById('num-vto-buffer');
  var numVtoOccCeiling = document.getElementById('num-vto-occ-ceiling');
  var numVtoMaxCap = document.getElementById('num-vto-max-cap');
  var numVtoHourlyRate = document.getElementById('num-vto-hourly-rate');
  var btnRecalcVto = document.getElementById('btn-recalc-vto');

  var vtoSurplusCount = document.getElementById('vto-surplus-count');
  var vtoMaxHours = document.getElementById('vto-max-hours');
  var vtoApprovedHours = document.getElementById('vto-approved-hours');
  var vtoApprovedCount = document.getElementById('vto-approved-count');
  var vtoCostSaved = document.getElementById('vto-cost-saved');
  var vtoRateNote = document.getElementById('vto-rate-note');

  var tbodyVtoSheet = document.getElementById('tbody-vto-sheet');
  var btnApproveAllVto = document.getElementById('btn-approve-all-vto');
  var btnExportVtoCSV = document.getElementById('btn-export-vto-csv');

  // --- Initialization ---
  function init() {
    setupTabSwitching();
    setupStepperControls();
    setupVtoControls();
    populateJumpDropdown();
    updateStepperDisplay();
    evaluateVTOOffers();
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    tabIntradaySim.addEventListener('click', function() {
      tabIntradaySim.className = 'btn btn-sm btn-primary';
      tabVtoCalc.className = 'btn btn-sm btn-ghost';
      viewIntraday.style.display = 'flex';
      viewVto.style.display = 'none';
    });

    tabVtoCalc.addEventListener('click', function() {
      tabVtoCalc.className = 'btn btn-sm btn-primary';
      tabIntradaySim.className = 'btn btn-sm btn-ghost';
      viewIntraday.style.display = 'none';
      viewVto.style.display = 'flex';
      evaluateVTOOffers();
    });
  }

  // --- Stepper Controls ---
  function setupStepperControls() {
    btnSimPrev.addEventListener('click', function() {
      pauseAutoAdvance();
      if (state.currentIdx > 0) {
        state.currentIdx--;
        updateStepperDisplay();
      }
    });

    btnSimNext.addEventListener('click', function() {
      pauseAutoAdvance();
      if (state.currentIdx < state.intervals.length - 1) {
        state.currentIdx++;
        updateStepperDisplay();
      }
    });

    btnSimReset.addEventListener('click', function() {
      pauseAutoAdvance();
      state.currentIdx = 0;
      updateStepperDisplay();
      ErlanglyUtils.showToast('Reset simulator to start of day (08:00)', 'info');
    });

    btnSimPlay.addEventListener('click', function() {
      if (state.isPlaying) {
        pauseAutoAdvance();
      } else {
        startAutoAdvance();
      }
    });

    selectSimInterval.addEventListener('change', function() {
      pauseAutoAdvance();
      state.currentIdx = parseInt(selectSimInterval.value, 10) || 0;
      updateStepperDisplay();
    });

    // Export Real-Time CSV
    btnExportRtCSV.addEventListener('click', function() {
      var headers = ['Interval', 'Forecast_Vol', 'Actual_Vol', 'Vol_Variance_Pct', 'Sched_Staff', 'Actual_Staff', 'Adherence_Pct', 'Actual_SLA_Pct', 'ASA_Seconds', 'Occupancy_Pct', 'State'];
      var rows = state.intervals.map(function(r) {
        var erlangs = Erlangly.trafficIntensity(r.actVol, r.actAht, state.intervalLength);
        var activeStaff = Math.max(1, r.actStaff - (r.vtoApproved || 0));
        var sl = Erlangly.serviceLevel(erlangs, activeStaff, r.actAht, state.targetTime);
        var asa = Erlangly.averageSpeedOfAnswer(erlangs, activeStaff, r.actAht);
        var occ = Erlangly.occupancy(erlangs, activeStaff);
        var volVar = r.fcstVol > 0 ? ((r.actVol - r.fcstVol) / r.fcstVol) * 100 : 0;
        var adh = r.schedStaff > 0 ? (r.actStaff / r.schedStaff) * 100 : 100;

        return [
          r.interval,
          r.fcstVol,
          r.actVol,
          volVar.toFixed(1) + '%',
          r.schedStaff,
          activeStaff,
          adh.toFixed(1) + '%',
          (sl * 100).toFixed(1) + '%',
          asa.toFixed(1),
          (occ * 100).toFixed(1) + '%',
          sl >= state.targetSLA ? 'ON_TARGET' : 'BREACH'
        ];
      });
      ErlanglyUtils.exportCSV('realtime_intraday_actuals.csv', headers, rows);
    });
  }

  function startAutoAdvance() {
    state.isPlaying = true;
    btnSimPlay.textContent = '⏸ Pause Stepper';
    btnSimPlay.className = 'btn btn-warn btn-sm';
    state.timer = setInterval(function() {
      if (state.currentIdx < state.intervals.length - 1) {
        state.currentIdx++;
        updateStepperDisplay();
      } else {
        pauseAutoAdvance();
        ErlanglyUtils.showToast('Completed shift simulation run', 'success');
      }
    }, 1500);
  }

  function pauseAutoAdvance() {
    state.isPlaying = false;
    btnSimPlay.textContent = '▶ Play Auto-Advance';
    btnSimPlay.className = 'btn btn-primary btn-sm';
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function populateJumpDropdown() {
    selectSimInterval.innerHTML = '';
    state.intervals.forEach(function(inv, idx) {
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = inv.interval;
      selectSimInterval.appendChild(opt);
    });
  }

  // --- Update Stepper Display ---
  function updateStepperDisplay() {
    var curr = state.intervals[state.currentIdx];
    if (!curr) return;

    selectSimInterval.value = state.currentIdx;
    simCurrentTime.textContent = curr.interval;
    simStatusBadge.textContent = 'Interval ' + (state.currentIdx + 1) + ' of ' + state.intervals.length;

    // Calculate Current Interval Queue Metrics
    var activeStaff = Math.max(1, curr.actStaff - (curr.vtoApproved || 0));
    var erlangs = Erlangly.trafficIntensity(curr.actVol, curr.actAht, state.intervalLength);
    var sl = Erlangly.serviceLevel(erlangs, activeStaff, curr.actAht, state.targetTime);
    var asa = Erlangly.averageSpeedOfAnswer(erlangs, activeStaff, curr.actAht);
    var occ = Erlangly.occupancy(erlangs, activeStaff);

    var volVar = curr.fcstVol > 0 ? ((curr.actVol - curr.fcstVol) / curr.fcstVol) * 100 : 0;
    var adherence = curr.schedStaff > 0 ? (curr.actStaff / curr.schedStaff) * 100 : 100;

    // Render Current Cards
    rtCurrentSL.textContent = ErlanglyUtils.formatPercent(sl, 1);
    if (sl >= state.targetSLA) {
      rtSLStatus.innerHTML = '<span class="badge badge-success">Target Met</span>';
      rtCurrentSL.style.color = 'var(--accent-light)';
    } else if (sl >= state.targetSLA * 0.9) {
      rtSLStatus.innerHTML = '<span class="badge badge-warn">At Risk</span>';
      rtCurrentSL.style.color = 'var(--warn-light)';
    } else {
      rtSLStatus.innerHTML = '<span class="badge badge-danger">SLA Breach</span>';
      rtCurrentSL.style.color = 'var(--danger-light)';
    }

    rtCurrentASA.textContent = ErlanglyUtils.formatSeconds(asa);
    rtCurrentOcc.textContent = ErlanglyUtils.formatPercent(occ, 1);
    if (occ > 0.90) {
      rtOccStatus.innerHTML = '<span class="text-warn">High burnout (&gt;90%)</span>';
    } else {
      rtOccStatus.textContent = 'Handle load';
    }

    rtCurrentVol.textContent = curr.actVol + ' / ' + curr.fcstVol;
    var volVarPrefix = volVar >= 0 ? '+' : '';
    rtVolVariance.textContent = volVarPrefix + volVar.toFixed(1) + '% vs forecast';
    rtVolVariance.className = 'metric-subtext ' + (Math.abs(volVar) > 10 ? 'text-warn' : 'text-secondary');

    rtCurrentAdherence.textContent = adherence.toFixed(1) + '%';
    rtAdherenceCount.textContent = curr.actStaff + ' on queue / ' + curr.schedStaff + ' scheduled';
    if (adherence < 90) {
      rtAdherenceCount.className = 'metric-subtext text-danger';
    } else {
      rtAdherenceCount.className = 'metric-subtext text-secondary';
    }

    rtCurrentErlangs.textContent = ErlanglyUtils.formatErlangs(erlangs);

    // Update Day-to-Date Performance Scorecard
    updateDtdScorecard();

    // Render Timeline Table
    renderTimelineTable();
  }

  // --- Day-to-Date Scorecard ---
  function updateDtdScorecard() {
    var upTo = state.currentIdx + 1;
    dtdIntervalSpan.textContent = 'Intervals 1 to ' + upTo + ' (08:00 - ' + state.intervals[state.currentIdx].interval + ')';

    var totalActVol = 0;
    var totalFcstVol = 0;
    var weightedSLSum = 0;
    var weightedASASum = 0;
    var totalSchedStaff = 0;
    var totalActStaff = 0;
    var breachCount = 0;

    for (var i = 0; i < upTo; i++) {
      var row = state.intervals[i];
      var erlangs = Erlangly.trafficIntensity(row.actVol, row.actAht, state.intervalLength);
      var activeStaff = Math.max(1, row.actStaff - (row.vtoApproved || 0));
      var sl = Erlangly.serviceLevel(erlangs, activeStaff, row.actAht, state.targetTime);
      var asa = Erlangly.averageSpeedOfAnswer(erlangs, activeStaff, row.actAht);

      totalActVol += row.actVol;
      totalFcstVol += row.fcstVol;
      weightedSLSum += (sl * row.actVol);
      weightedASASum += (asa * row.actVol);
      totalSchedStaff += row.schedStaff;
      totalActStaff += row.actStaff;

      if (sl < state.targetSLA || (row.schedStaff > 0 && (row.actStaff / row.schedStaff) < 0.90)) {
        breachCount++;
      }
    }

    var cumSL = totalActVol > 0 ? (weightedSLSum / totalActVol) : 1.0;
    var cumASA = totalActVol > 0 ? (weightedASASum / totalActVol) : 0.0;
    var cumAdherence = totalSchedStaff > 0 ? (totalActStaff / totalSchedStaff) * 100 : 100;
    var volVar = totalFcstVol > 0 ? ((totalActVol - totalFcstVol) / totalFcstVol) * 100 : 0;

    dtdTotalVol.textContent = ErlanglyUtils.formatNumber(totalActVol) + ' calls';
    dtdVolVar.textContent = (volVar >= 0 ? '+' : '') + volVar.toFixed(1) + '% vs plan';
    dtdCumSL.textContent = ErlanglyUtils.formatPercent(cumSL, 1);
    dtdCumSL.className = 'metric-value mono ' + (cumSL >= state.targetSLA ? 'text-success' : 'text-danger');
    dtdCumASA.textContent = ErlanglyUtils.formatSeconds(cumASA);
    dtdCumAdherence.textContent = cumAdherence.toFixed(1) + '%';
    dtdBreachCount.textContent = breachCount + ' interval alerts';
  }

  // --- Timeline Table ---
  function renderTimelineTable() {
    tbodyIntradayTimeline.innerHTML = '';

    state.intervals.forEach(function(row, idx) {
      var tr = document.createElement('tr');
      var isCurrent = idx === state.currentIdx;
      var isPast = idx < state.currentIdx;

      if (isCurrent) {
        tr.style.background = 'rgba(0, 210, 211, 0.12)';
        tr.style.fontWeight = '600';
      } else if (!isPast) {
        tr.style.opacity = '0.65';
      }

      var erlangs = Erlangly.trafficIntensity(row.actVol, row.actAht, state.intervalLength);
      var activeStaff = Math.max(1, row.actStaff - (row.vtoApproved || 0));
      var sl = Erlangly.serviceLevel(erlangs, activeStaff, row.actAht, state.targetTime);
      var asa = Erlangly.averageSpeedOfAnswer(erlangs, activeStaff, row.actAht);
      var occ = Erlangly.occupancy(erlangs, activeStaff);

      var volVar = row.fcstVol > 0 ? ((row.actVol - row.fcstVol) / row.fcstVol) * 100 : 0;
      var adh = row.schedStaff > 0 ? (row.actStaff / row.schedStaff) * 100 : 100;

      var stateBadge = '<span class="badge badge-success">Normal</span>';
      if (sl < state.targetSLA) {
        stateBadge = '<span class="badge badge-danger">Breach</span>';
      } else if (adh < 90) {
        stateBadge = '<span class="badge badge-warn">Adherence</span>';
      } else if (volVar > 10) {
        stateBadge = '<span class="badge badge-warn">Spike</span>';
      } else if (row.vtoApproved > 0) {
        stateBadge = '<span class="badge badge-neutral">VTO: ' + row.vtoApproved + '</span>';
      }

      tr.innerHTML = 
        '<td class="mono"><strong>' + row.interval + (isCurrent ? ' ▶' : '') + '</strong></td>' +
        '<td class="mono">' + row.fcstVol + '</td>' +
        '<td class="mono">' + row.actVol + '</td>' +
        '<td class="mono ' + (volVar > 5 ? 'text-warn' : (volVar < -5 ? 'text-muted' : '')) + '">' + (volVar >= 0 ? '+' : '') + volVar.toFixed(0) + '%</td>' +
        '<td class="mono">' + row.schedStaff + '</td>' +
        '<td class="mono text-accent">' + activeStaff + '</td>' +
        '<td class="mono ' + (adh < 90 ? 'text-danger' : '') + '">' + adh.toFixed(0) + '%</td>' +
        '<td class="mono ' + (sl >= state.targetSLA ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(sl, 1) + '</td>' +
        '<td class="mono">' + ErlanglyUtils.formatSeconds(asa) + '</td>' +
        '<td class="mono ' + (occ > 0.90 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(occ, 1) + '</td>' +
        '<td>' + stateBadge + '</td>';

      // Click row to jump
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function() {
        pauseAutoAdvance();
        state.currentIdx = idx;
        updateStepperDisplay();
      });

      tbodyIntradayTimeline.appendChild(tr);
    });
  }

  // --- Part 2: Voluntary Time Off (VTO) Calculator ---
  function setupVtoControls() {
    [numVtoBuffer, numVtoOccCeiling, numVtoMaxCap, numVtoHourlyRate].forEach(function(el) {
      el.addEventListener('input', evaluateVTOOffers);
      el.addEventListener('change', evaluateVTOOffers);
    });

    btnRecalcVto.addEventListener('click', function() {
      evaluateVTOOffers();
      ErlanglyUtils.showToast('Re-evaluated VTO safety guardrails', 'success');
    });

    btnApproveAllVto.addEventListener('click', function() {
      state.vto.offers.forEach(function(offer) {
        offer.row.vtoApproved = offer.maxSafeVto;
      });
      evaluateVTOOffers();
      updateStepperDisplay();
      ErlanglyUtils.showToast('Approved all recommended safe VTO allocations', 'success');
    });

    btnExportVtoCSV.addEventListener('click', function() {
      if (!state.vto.offers || state.vto.offers.length === 0) return;
      var headers = ['Interval', 'Actual_Staff', 'Required_Staff', 'Max_Safe_VTO_Agents', 'Approved_VTO_Agents', 'Projected_SLA_Pct', 'Projected_Occ_Pct', 'Estimated_Cost_Saved'];
      var rows = state.vto.offers.map(function(o) {
        var intervalHours = state.intervalLength / 3600;
        var cost = (o.row.vtoApproved || 0) * intervalHours * state.vto.hourlyRate;
        return [
          o.interval,
          o.actualStaff,
          o.requiredStaff,
          o.maxSafeVto,
          o.row.vtoApproved || 0,
          (o.projectedSL * 100).toFixed(1) + '%',
          (o.projectedOcc * 100).toFixed(1) + '%',
          '$' + cost.toFixed(2)
        ];
      });
      ErlanglyUtils.exportCSV('vto_offer_management_sheet.csv', headers, rows);
    });
  }

  function evaluateVTOOffers() {
    state.vto.slaBuffer = (parseFloat(numVtoBuffer.value) || 5) / 100;
    state.vto.occCeiling = (parseFloat(numVtoOccCeiling.value) || 85) / 100;
    state.vto.maxCapPerInterval = Math.max(1, parseInt(numVtoMaxCap.value, 10) || 8);
    state.vto.hourlyRate = Math.max(1, parseFloat(numVtoHourlyRate.value) || 22.00);

    var targetSafeSL = state.targetSLA + state.vto.slaBuffer; // e.g. 80% + 5% = 85%
    var offers = [];
    var totalMaxVtoHours = 0;
    var totalApprovedVtoHours = 0;
    var intervalHours = state.intervalLength / 3600;

    state.intervals.forEach(function(row) {
      var erlangs = Erlangly.trafficIntensity(row.actVol, row.actAht, state.intervalLength);
      var solve = Erlangly.agentsRequired({
        volume: row.actVol,
        aht: row.actAht,
        intervalSeconds: state.intervalLength,
        targetServiceLevel: state.targetSLA
      });

      var requiredStaff = solve.baseAgents;
      var actualStaff = row.actStaff;

      // Find max safe VTO
      var maxVto = 0;
      var testMax = Math.min(state.vto.maxCapPerInterval, Math.max(0, actualStaff - requiredStaff));

      for (var v = testMax; v >= 1; v--) {
        var remStaff = actualStaff - v;
        if (remStaff <= erlangs) continue; // Unstable queue

        var testSL = Erlangly.serviceLevel(erlangs, remStaff, row.actAht, state.targetTime);
        var testOcc = Erlangly.occupancy(erlangs, remStaff);

        if (testSL >= targetSafeSL && testOcc <= state.vto.occCeiling) {
          maxVto = v;
          break;
        }
      }

      // Bound approved VTO
      if (row.vtoApproved > maxVto) {
        row.vtoApproved = maxVto;
      }

      var currentApproved = row.vtoApproved || 0;
      var activeStaffPostVto = Math.max(1, actualStaff - currentApproved);
      var projSL = Erlangly.serviceLevel(erlangs, activeStaffPostVto, row.actAht, state.targetTime);
      var projOcc = Erlangly.occupancy(erlangs, activeStaffPostVto);

      totalMaxVtoHours += (maxVto * intervalHours);
      totalApprovedVtoHours += (currentApproved * intervalHours);

      if (maxVto > 0 || currentApproved > 0) {
        offers.push({
          row: row,
          interval: row.interval,
          actualStaff: actualStaff,
          requiredStaff: requiredStaff,
          maxSafeVto: maxVto,
          projectedSL: projSL,
          projectedOcc: projOcc
        });
      }
    });

    state.vto.offers = offers;

    // Update VTO KPI metrics
    var totalCostSaved = totalApprovedVtoHours * state.vto.hourlyRate;
    vtoSurplusCount.textContent = offers.length + ' intervals';
    vtoMaxHours.textContent = totalMaxVtoHours.toFixed(1) + ' hrs';
    vtoApprovedHours.textContent = totalApprovedVtoHours.toFixed(1) + ' hrs';
    vtoApprovedCount.textContent = Math.round(totalApprovedVtoHours / intervalHours) + ' agent-intervals';
    vtoCostSaved.textContent = '$' + totalCostSaved.toFixed(2);
    vtoRateNote.textContent = '@ $' + state.vto.hourlyRate.toFixed(2) + ' / hr wage';

    renderVtoTable();
  }

  function renderVtoTable() {
    tbodyVtoSheet.innerHTML = '';

    if (state.vto.offers.length === 0) {
      tbodyVtoSheet.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No surplus intervals meet VTO safety guardrails today.</td></tr>';
      return;
    }

    var intervalHours = state.intervalLength / 3600;

    state.vto.offers.forEach(function(o) {
      var tr = document.createElement('tr');
      var approved = o.row.vtoApproved || 0;
      var costSaved = approved * intervalHours * state.vto.hourlyRate;

      tr.innerHTML = 
        '<td class="mono"><strong>' + o.interval + '</strong></td>' +
        '<td class="mono">' + o.actualStaff + '</td>' +
        '<td class="mono">' + o.requiredStaff + '</td>' +
        '<td class="mono text-accent"><strong>' + o.maxSafeVto + ' agents (' + (o.maxSafeVto * intervalHours).toFixed(1) + 'h)</strong></td>' +
        '<td class="mono text-success"><strong>' + approved + '</strong></td>' +
        '<td class="mono ' + (o.projectedSL >= state.targetSLA ? 'text-success' : 'text-danger') + '">' + ErlanglyUtils.formatPercent(o.projectedSL, 1) + '</td>' +
        '<td class="mono ' + (o.projectedOcc > 0.85 ? 'text-warn' : '') + '">' + ErlanglyUtils.formatPercent(o.projectedOcc, 1) + '</td>' +
        '<td class="mono text-success">$' + costSaved.toFixed(2) + '</td>' +
        '<td>' +
          '<div style="display: flex; gap: 4px;">' +
            '<button class="btn btn-primary btn-sm btn-approve" style="padding: 0 6px;" title="Approve +1 agent VTO" ' + (approved >= o.maxSafeVto ? 'disabled' : '') + '>+1</button>' +
            '<button class="btn btn-ghost btn-sm btn-revoke" style="padding: 0 6px;" title="Revoke 1 agent VTO" ' + (approved <= 0 ? 'disabled' : '') + '>-1</button>' +
          '</div>' +
        '</td>';

      // Button listeners
      var btnApprove = tr.querySelector('.btn-approve');
      var btnRevoke = tr.querySelector('.btn-revoke');

      btnApprove.addEventListener('click', function() {
        if (approved < o.maxSafeVto) {
          o.row.vtoApproved = approved + 1;
          evaluateVTOOffers();
          updateStepperDisplay();
        }
      });

      btnRevoke.addEventListener('click', function() {
        if (approved > 0) {
          o.row.vtoApproved = approved - 1;
          evaluateVTOOffers();
          updateStepperDisplay();
        }
      });

      tbodyVtoSheet.appendChild(tr);
    });
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
