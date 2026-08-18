/**
 * Erlangly Scheduling & FTE Converter Tool (js/scheduling.js)
 * 
 * Features:
 * - Forecast-to-Required FTE Converter (work-week, part-time mix, shrinkage)
 * - Daily staffing & FTE breakdown table
 * - Shift pattern definition & Integer Coverage Optimizer
 * - Chart.js Coverage Analysis Visualizer (Required vs. Scheduled)
 * - Cross-tool handoff receiver from Capacity Planning
 */

(function() {
  'use strict';

  // --- Default Daytime Interval Schedule (08:00 - 20:00) ---
  var DEFAULT_INTERVALS = [
    { interval: '08:00', volume: 110, aht: 175, erlangs: 10.7, requiredAgents: 14, staffedAgents: 20 },
    { interval: '08:30', volume: 160, aht: 180, erlangs: 16.0, requiredAgents: 20, staffedAgents: 29 },
    { interval: '09:00', volume: 240, aht: 190, erlangs: 25.3, requiredAgents: 31, staffedAgents: 45 },
    { interval: '09:30', volume: 310, aht: 195, erlangs: 33.6, requiredAgents: 40, staffedAgents: 58 },
    { interval: '10:00', volume: 380, aht: 200, erlangs: 42.2, requiredAgents: 49, staffedAgents: 70 },
    { interval: '10:30', volume: 420, aht: 205, erlangs: 47.8, requiredAgents: 55, staffedAgents: 79 },
    { interval: '11:00', volume: 450, aht: 210, erlangs: 52.5, requiredAgents: 60, staffedAgents: 86 },
    { interval: '11:30', volume: 430, aht: 205, erlangs: 49.0, requiredAgents: 56, staffedAgents: 80 },
    { interval: '12:00', volume: 390, aht: 195, erlangs: 42.3, requiredAgents: 49, staffedAgents: 70 },
    { interval: '12:30', volume: 370, aht: 190, erlangs: 39.1, requiredAgents: 46, staffedAgents: 66 },
    { interval: '13:00', volume: 350, aht: 185, erlangs: 36.0, requiredAgents: 42, staffedAgents: 60 },
    { interval: '13:30', volume: 360, aht: 185, erlangs: 37.0, requiredAgents: 44, staffedAgents: 63 },
    { interval: '14:00', volume: 410, aht: 190, erlangs: 43.3, requiredAgents: 50, staffedAgents: 72 },
    { interval: '14:30', volume: 440, aht: 195, erlangs: 47.7, requiredAgents: 55, staffedAgents: 79 },
    { interval: '15:00', volume: 460, aht: 200, erlangs: 51.1, requiredAgents: 59, staffedAgents: 85 },
    { interval: '15:30', volume: 430, aht: 195, erlangs: 46.6, requiredAgents: 54, staffedAgents: 78 },
    { interval: '16:00', volume: 390, aht: 190, erlangs: 41.2, requiredAgents: 48, staffedAgents: 69 },
    { interval: '16:30', volume: 340, aht: 185, erlangs: 34.9, requiredAgents: 41, staffedAgents: 59 },
    { interval: '17:00', volume: 290, aht: 180, erlangs: 29.0, requiredAgents: 35, staffedAgents: 50 },
    { interval: '17:30', volume: 240, aht: 175, erlangs: 23.3, requiredAgents: 29, staffedAgents: 42 },
    { interval: '18:00', volume: 190, aht: 170, erlangs: 17.9, requiredAgents: 23, staffedAgents: 33 },
    { interval: '18:30', volume: 150, aht: 165, erlangs: 13.8, requiredAgents: 18, staffedAgents: 26 },
    { interval: '19:00', volume: 120, aht: 160, erlangs: 10.7, requiredAgents: 14, staffedAgents: 20 },
    { interval: '19:30', volume: 90, aht: 155, erlangs: 7.8, requiredAgents: 11, staffedAgents: 16 }
  ];

  // --- Default Shift Patterns ---
  var DEFAULT_SHIFTS = [
    { id: 'S1', name: 'Early Shift', start: '08:00', lengthHours: 8.5, mealStart: '12:00', mealMins: 30, paidHours: 8.0, assigned: 0 },
    { id: 'S2', name: 'Core Morning', start: '09:00', lengthHours: 8.5, mealStart: '13:00', mealMins: 30, paidHours: 8.0, assigned: 0 },
    { id: 'S3', name: 'Mid Day', start: '10:30', lengthHours: 8.5, mealStart: '14:30', mealMins: 30, paidHours: 8.0, assigned: 0 },
    { id: 'S4', name: 'Evening Close', start: '11:30', lengthHours: 8.5, mealStart: '15:30', mealMins: 30, paidHours: 8.0, assigned: 0 }
  ];

  // --- State ---
  var state = {
    intervals: DEFAULT_INTERVALS.slice(),
    intervalLength: 1800, // 30 min
    targetSLA: 0.80,
    shrinkage: 0.30,
    workWeekHours: 40.0,
    ptMix: 0.20,
    ptHours: 20.0,
    operatingDays: 7,
    shifts: DEFAULT_SHIFTS.slice(),
    allocatedHeadcount: 85,
    coverageResults: [],
    chart: null
  };

  // --- DOM References ---
  var tabFteConverter = document.getElementById('tab-fte-converter');
  var tabShiftAllocation = document.getElementById('tab-shift-allocation');
  var viewFteConverter = document.getElementById('view-fte-converter');
  var viewShiftAllocation = document.getElementById('view-shift-allocation');

  var numWorkWeek = document.getElementById('num-work-week');
  var numPtMix = document.getElementById('num-pt-mix');
  var numPtHours = document.getElementById('num-pt-hours');
  var numFteShrinkage = document.getElementById('num-fte-shrinkage');
  var selectOperatingDays = document.getElementById('select-operating-days');
  var btnRecalcFte = document.getElementById('btn-recalc-fte');

  var fteNetHours = document.getElementById('fte-net-hours');
  var fteGrossHours = document.getElementById('fte-gross-hours');
  var fteRequiredTotal = document.getElementById('fte-required-total');
  var fteFtHeadcount = document.getElementById('fte-ft-headcount');
  var ftePtHeadcount = document.getElementById('fte-pt-headcount');
  var fteTotalBodies = document.getElementById('fte-total-bodies');
  var fteShrinkageNote = document.getElementById('fte-shrinkage-note');
  var fteFtSub = document.getElementById('fte-ft-sub');
  var ftePtSub = document.getElementById('fte-pt-sub');
  var tbodyFteBreakdown = document.getElementById('tbody-fte-breakdown');

  var btnExportFteCSV = document.getElementById('btn-export-fte-csv');
  var btnProceedToShifts = document.getElementById('btn-proceed-to-shifts');

  var tbodyShiftPatterns = document.getElementById('tbody-shift-patterns');
  var btnAddShift = document.getElementById('btn-add-shift');
  var numAllocHeadcount = document.getElementById('num-alloc-headcount');
  var btnRunOptimizer = document.getElementById('btn-run-optimizer');

  var covReqHours = document.getElementById('cov-req-hours');
  var covSchedHours = document.getElementById('cov-sched-hours');
  var covMatchPct = document.getElementById('cov-match-pct');
  var covMatchStatus = document.getElementById('cov-match-status');
  var covDeficitHours = document.getElementById('cov-deficit-hours');
  var covSurplusHours = document.getElementById('cov-surplus-hours');
  var canvasCoverageChart = document.getElementById('chart-coverage');
  var tbodyCoverageDetails = document.getElementById('tbody-coverage-details');
  var btnExportScheduleCSV = document.getElementById('btn-export-schedule-csv');

  var schedHandoffBanner = document.getElementById('sched-handoff-banner');
  var schedHandoffText = document.getElementById('sched-handoff-text');
  var btnDismissSchedHandoff = document.getElementById('btn-dismiss-sched-handoff');

  // --- Initialization ---
  function init() {
    setupTabSwitching();
    setupEventListeners();
    checkIncomingHandoff();
    calculateFTE();
    renderShiftTable();
    runShiftOptimizer();
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    tabFteConverter.addEventListener('click', function() {
      tabFteConverter.className = 'btn btn-sm btn-primary';
      tabShiftAllocation.className = 'btn btn-sm btn-ghost';
      viewFteConverter.style.display = 'flex';
      viewShiftAllocation.style.display = 'none';
    });

    tabShiftAllocation.addEventListener('click', function() {
      tabShiftAllocation.className = 'btn btn-sm btn-primary';
      tabFteConverter.className = 'btn btn-sm btn-ghost';
      viewFteConverter.style.display = 'none';
      viewShiftAllocation.style.display = 'flex';
      if (state.coverageResults.length === 0) {
        runShiftOptimizer();
      }
    });

    btnProceedToShifts.addEventListener('click', function() {
      tabShiftAllocation.click();
    });
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    [numWorkWeek, numPtMix, numPtHours, numFteShrinkage, selectOperatingDays].forEach(function(el) {
      el.addEventListener('input', calculateFTE);
      el.addEventListener('change', calculateFTE);
    });

    btnRecalcFte.addEventListener('click', function() {
      calculateFTE();
      ErlanglyUtils.showToast('Recalculated FTE staffing requirements', 'success');
    });

    btnAddShift.addEventListener('click', function() {
      var nextId = 'S' + (state.shifts.length + 1);
      state.shifts.push({
        id: nextId,
        name: 'Shift ' + nextId,
        start: '12:00',
        lengthHours: 8.5,
        mealStart: '16:00',
        mealMins: 30,
        paidHours: 8.0,
        assigned: 0
      });
      renderShiftTable();
      runShiftOptimizer();
    });

    btnRunOptimizer.addEventListener('click', function() {
      runShiftOptimizer();
      ErlanglyUtils.showToast('Optimized shift pattern coverage', 'success');
    });

    numAllocHeadcount.addEventListener('input', function() {
      state.allocatedHeadcount = Math.max(1, parseInt(numAllocHeadcount.value, 10) || 45);
      runShiftOptimizer();
    });

    // Export FTE CSV
    btnExportFteCSV.addEventListener('click', function() {
      var headers = ['Day_Of_Week', 'Total_Volume', 'Peak_Erlangs', 'Net_Productive_Hours', 'Gross_Paid_Hours', 'Base_FTE', 'Gross_FTE'];
      var rows = computeDailyBreakdown().map(function(d) {
        return [
          d.day,
          d.volume,
          d.peakErlangs.toFixed(2),
          d.netHours.toFixed(1),
          d.grossHours.toFixed(1),
          d.baseFTE.toFixed(1),
          d.grossFTE.toFixed(1)
        ];
      });
      ErlanglyUtils.exportCSV('fte_workforce_breakdown.csv', headers, rows);
    });

    // Export Shift Schedule CSV
    btnExportScheduleCSV.addEventListener('click', function() {
      if (!state.coverageResults || state.coverageResults.length === 0) return;
      var headers = ['Interval', 'Call_Volume', 'Required_Headcount', 'Scheduled_Headcount', 'Variance', 'Coverage_Pct', 'Status'];
      var rows = state.coverageResults.map(function(c) {
        return [
          c.interval,
          c.volume,
          c.required,
          c.scheduled,
          c.variance,
          c.coveragePct.toFixed(1) + '%',
          c.status
        ];
      });
      ErlanglyUtils.exportCSV('shift_coverage_schedule.csv', headers, rows);
    });
  }

  // --- Part 1: Forecast to FTE Calculations ---
  function calculateFTE() {
    state.workWeekHours = Math.max(10, parseFloat(numWorkWeek.value) || 40.0);
    state.ptMix = Math.max(0, Math.min(100, parseFloat(numPtMix.value) || 0)) / 100;
    state.ptHours = Math.max(5, parseFloat(numPtHours.value) || 20.0);
    state.shrinkage = Math.max(0, Math.min(99, parseFloat(numFteShrinkage.value) || 0)) / 100;
    state.operatingDays = parseInt(selectOperatingDays.value, 10) || 7;

    var intervalHours = state.intervalLength / 3600;
    var dailyNetHours = 0;
    var dailyGrossHours = 0;

    state.intervals.forEach(function(row) {
      var req = row.requiredAgents;
      var staffed = row.staffedAgents;

      if (req === undefined || req === null) {
        var solve = Erlangly.agentsRequired({
          volume: row.volume,
          aht: row.aht,
          intervalSeconds: state.intervalLength,
          targetServiceLevel: state.targetSLA,
          shrinkage: state.shrinkage
        });
        req = solve.baseAgents;
        staffed = solve.staffedAgents;
        row.requiredAgents = req;
        row.staffedAgents = staffed;
      }

      dailyNetHours += (req * intervalHours);
      dailyGrossHours += (staffed * intervalHours);
    });

    // Weekly scaled hours
    var weeklyNetHours = dailyNetHours * state.operatingDays;
    var weeklyGrossHours = dailyGrossHours * state.operatingDays;

    // Standard FTE = Weekly Paid Hours / Standard Work Week
    var requiredFTE = weeklyGrossHours / state.workWeekHours;

    // Average effective weekly hours per body considering part-time mix
    var avgWeeklyHoursPerBody = (1.0 - state.ptMix) * state.workWeekHours + (state.ptMix * state.ptHours);
    var totalBodies = Math.ceil(weeklyGrossHours / avgWeeklyHoursPerBody);
    var ptBodies = Math.round(totalBodies * state.ptMix);
    var ftBodies = totalBodies - ptBodies;

    // Update KPI Display
    fteNetHours.textContent = Math.round(weeklyNetHours).toLocaleString() + ' hrs';
    fteGrossHours.textContent = Math.round(weeklyGrossHours).toLocaleString() + ' hrs';
    fteRequiredTotal.textContent = requiredFTE.toFixed(1) + ' FTE';
    fteFtHeadcount.textContent = ftBodies + ' FT';
    ftePtHeadcount.textContent = ptBodies + ' PT';
    fteTotalBodies.textContent = totalBodies + ' staff';

    fteShrinkageNote.textContent = 'Includes ' + Math.round(state.shrinkage * 100) + '% shrinkage';
    fteFtSub.textContent = Math.round((1 - state.ptMix) * 100) + '% FT @ ' + state.workWeekHours + 'h/wk';
    ftePtSub.textContent = Math.round(state.ptMix * 100) + '% PT @ ' + state.ptHours + 'h/wk';

    // Auto-set the recommended daily headcount in the shift optimizer
    var peakStaffedInDay = state.intervals.reduce(function(max, r) { return Math.max(max, r.staffedAgents || 0); }, 0);
    numAllocHeadcount.value = Math.max(peakStaffedInDay, Math.round(totalBodies / (state.operatingDays / 5)));
    state.allocatedHeadcount = parseInt(numAllocHeadcount.value, 10);

    renderFteBreakdownTable();
  }

  function computeDailyBreakdown() {
    var dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var dayFactors = [1.25, 1.10, 1.05, 1.00, 0.95, 0.50, 0.40]; // Representative contact center profile
    var intervalHours = state.intervalLength / 3600;

    var baseDayVolume = state.intervals.reduce(function(sum, r) { return sum + r.volume; }, 0);
    var baseDayNetHours = state.intervals.reduce(function(sum, r) { return sum + ((r.requiredAgents || 0) * intervalHours); }, 0);
    var baseDayGrossHours = state.intervals.reduce(function(sum, r) { return sum + ((r.staffedAgents || 0) * intervalHours); }, 0);
    var peakErlangs = state.intervals.reduce(function(max, r) { return Math.max(max, r.erlangs || 0); }, 0);

    var dailyRows = [];
    for (var d = 0; d < state.operatingDays; d++) {
      var factor = dayFactors[d] || 1.0;
      var dVol = Math.round(baseDayVolume * factor);
      var dNetH = baseDayNetHours * factor;
      var dGrossH = baseDayGrossHours * factor;
      var dBaseFTE = (dNetH * 5) / state.workWeekHours;
      var dGrossFTE = (dGrossH * 5) / state.workWeekHours;

      dailyRows.push({
        day: dayNames[d] || ('Day ' + (d + 1)),
        volume: dVol,
        peakErlangs: peakErlangs * factor,
        netHours: dNetH,
        grossHours: dGrossH,
        baseFTE: dBaseFTE,
        grossFTE: dGrossFTE
      });
    }

    return dailyRows;
  }

  function renderFteBreakdownTable() {
    tbodyFteBreakdown.innerHTML = '';
    var breakdown = computeDailyBreakdown();

    breakdown.forEach(function(d) {
      var tr = document.createElement('tr');
      tr.innerHTML = 
        '<td class="mono"><strong>' + d.day + '</strong></td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(d.volume) + '</td>' +
        '<td class="mono">' + d.peakErlangs.toFixed(1) + '</td>' +
        '<td class="mono">' + Math.round(d.netHours) + ' hrs</td>' +
        '<td class="mono">' + Math.round(d.grossHours) + ' hrs</td>' +
        '<td class="mono">' + d.baseFTE.toFixed(1) + '</td>' +
        '<td class="mono text-accent"><strong>' + d.grossFTE.toFixed(1) + ' FTE</strong></td>';
      tbodyFteBreakdown.appendChild(tr);
    });
  }

  // --- Part 2: Shift Pattern Allocator & Coverage Optimizer ---
  function renderShiftTable() {
    tbodyShiftPatterns.innerHTML = '';

    state.shifts.forEach(function(shift, idx) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      var inputName = document.createElement('input');
      inputName.type = 'text';
      inputName.className = 'form-control mono';
      inputName.style.height = '28px';
      inputName.style.fontSize = 'var(--text-xs)';
      inputName.value = shift.name;
      inputName.addEventListener('input', function() { shift.name = inputName.value; });
      tdName.appendChild(inputName);

      var tdStart = document.createElement('td');
      var inputStart = document.createElement('input');
      inputStart.type = 'text';
      inputStart.className = 'form-control mono';
      inputStart.style.height = '28px';
      inputStart.style.fontSize = 'var(--text-xs)';
      inputStart.value = shift.start;
      inputStart.addEventListener('input', function() { shift.start = inputStart.value; runShiftOptimizer(); });
      tdStart.appendChild(inputStart);

      var tdLen = document.createElement('td');
      var inputLen = document.createElement('input');
      inputLen.type = 'number';
      inputLen.className = 'form-control mono';
      inputLen.style.height = '28px';
      inputLen.style.fontSize = 'var(--text-xs)';
      inputLen.step = '0.5';
      inputLen.value = shift.lengthHours;
      inputLen.addEventListener('input', function() {
        shift.lengthHours = parseFloat(inputLen.value) || 8.5;
        shift.paidHours = shift.lengthHours - (shift.mealMins / 60);
        tdPaid.textContent = shift.paidHours.toFixed(1) + ' hrs';
        runShiftOptimizer();
      });
      tdLen.appendChild(inputLen);

      var tdMealStart = document.createElement('td');
      var inputMealStart = document.createElement('input');
      inputMealStart.type = 'text';
      inputMealStart.className = 'form-control mono';
      inputMealStart.style.height = '28px';
      inputMealStart.style.fontSize = 'var(--text-xs)';
      inputMealStart.value = shift.mealStart;
      inputMealStart.addEventListener('input', function() { shift.mealStart = inputMealStart.value; runShiftOptimizer(); });
      tdMealStart.appendChild(inputMealStart);

      var tdMealLen = document.createElement('td');
      tdMealLen.className = 'mono';
      tdMealLen.textContent = shift.mealMins + ' min';

      var tdPaid = document.createElement('td');
      tdPaid.className = 'mono text-accent';
      tdPaid.textContent = (shift.lengthHours - (shift.mealMins / 60)).toFixed(1) + ' hrs';

      var tdAction = document.createElement('td');
      var btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm';
      btnDel.style.padding = '0 6px';
      btnDel.style.color = 'var(--danger)';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', function() {
        if (state.shifts.length <= 1) {
          ErlanglyUtils.showToast('Must keep at least 1 shift pattern', 'warn');
          return;
        }
        state.shifts.splice(idx, 1);
        renderShiftTable();
        runShiftOptimizer();
      });
      tdAction.appendChild(btnDel);

      tr.appendChild(tdName);
      tr.appendChild(tdStart);
      tr.appendChild(tdLen);
      tr.appendChild(tdMealStart);
      tr.appendChild(tdMealLen);
      tr.appendChild(tdPaid);
      tr.appendChild(tdAction);

      tbodyShiftPatterns.appendChild(tr);
    });
  }

  // Parse "HH:MM" to minutes from midnight
  function parseTimeToMins(timeStr) {
    if (!timeStr) return 0;
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10) || 0;
    var m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }

  // Shift Optimizer (Greedy / Ridge Coverage Solver)
  function runShiftOptimizer() {
    if (!state.intervals || state.intervals.length === 0 || !state.shifts || state.shifts.length === 0) return;

    var numIntervals = state.intervals.length;
    var numShifts = state.shifts.length;
    var intervalMins = state.intervalLength / 60;

    // 1. Build Shift Coverage Matrix: coverageMatrix[shiftIdx][intervalIdx] = 1 (on duty), 0 (off duty or on meal)
    var coverageMatrix = [];

    state.shifts.forEach(function(shift) {
      var shiftStartMins = parseTimeToMins(shift.start);
      var shiftEndMins = shiftStartMins + (shift.lengthHours * 60);
      var mealStartMins = parseTimeToMins(shift.mealStart);
      var mealEndMins = mealStartMins + shift.mealMins;

      var rowCover = [];
      state.intervals.forEach(function(inv) {
        var invStartMins = parseTimeToMins(inv.interval);
        var invEndMins = invStartMins + intervalMins;

        // Is agent working in this interval?
        var inShift = invStartMins >= shiftStartMins && invEndMins <= shiftEndMins;
        var inMeal = invStartMins >= mealStartMins && invEndMins <= mealEndMins;

        rowCover.push(inShift && !inMeal ? 1 : 0);
      });
      coverageMatrix.push(rowCover);
    });

    // 2. Greedy Headcount Allocation
    var assigned = new Array(numShifts).fill(0);
    var currentScheduled = new Array(numIntervals).fill(0);
    var required = state.intervals.map(function(inv) { return inv.staffedAgents || inv.requiredAgents || 10; });

    var totalToAllocate = state.allocatedHeadcount;

    for (var a = 0; a < totalToAllocate; a++) {
      var bestShift = 0;
      var bestScore = -Infinity;

      for (var s = 0; s < numShifts; s++) {
        var score = 0;
        for (var i = 0; i < numIntervals; i++) {
          if (coverageMatrix[s][i] === 1) {
            var deficit = required[i] - currentScheduled[i];
            if (deficit > 0) {
              score += 10.0; // High reward for eliminating deficit
            } else {
              score -= 1.0;  // Small penalty for surplus
            }
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestShift = s;
        }
      }

      assigned[bestShift]++;
      for (var k = 0; k < numIntervals; k++) {
        currentScheduled[k] += coverageMatrix[bestShift][k];
      }
    }

    // 3. Compile Coverage Metrics
    var totalReqHeadcountHours = 0;
    var totalSchedHeadcountHours = 0;
    var totalDeficitHours = 0;
    var totalSurplusHours = 0;
    var totalMatchedHours = 0;

    var coverageResults = [];
    var intervalHours = state.intervalLength / 3600;

    for (var j = 0; j < numIntervals; j++) {
      var reqVal = required[j];
      var schedVal = currentScheduled[j];
      var variance = schedVal - reqVal;
      var covPct = reqVal > 0 ? (schedVal / reqVal) * 100 : 100;

      totalReqHeadcountHours += (reqVal * intervalHours);
      totalSchedHeadcountHours += (schedVal * intervalHours);

      if (variance < 0) {
        totalDeficitHours += (Math.abs(variance) * intervalHours);
      } else {
        totalSurplusHours += (variance * intervalHours);
      }
      totalMatchedHours += (Math.min(reqVal, schedVal) * intervalHours);

      var status = 'Optimal';
      if (variance < 0) {
        status = 'Deficit';
      } else if (variance > 4) {
        status = 'Surplus';
      }

      coverageResults.push({
        interval: state.intervals[j].interval,
        volume: state.intervals[j].volume,
        required: reqVal,
        scheduled: schedVal,
        variance: variance,
        coveragePct: covPct,
        status: status
      });
    }

    state.coverageResults = coverageResults;

    // Update KPI cards
    covReqHours.textContent = Math.round(totalReqHeadcountHours) + ' hrs';
    covSchedHours.textContent = Math.round(totalSchedHeadcountHours) + ' hrs';
    var overallMatch = totalReqHeadcountHours > 0 ? (totalMatchedHours / totalReqHeadcountHours) * 100 : 100;
    covMatchPct.textContent = overallMatch.toFixed(1) + '%';
    covMatchStatus.innerHTML = overallMatch >= 95 ? '<span class="badge badge-success">Optimal Alignment</span>' : '<span class="badge badge-warn">Moderate Variance</span>';
    covDeficitHours.textContent = totalDeficitHours.toFixed(1) + ' hrs';
    covSurplusHours.textContent = totalSurplusHours.toFixed(1) + ' hrs';

    // 4. Render Table & Chart
    renderCoverageTable();
    renderCoverageChart();
  }

  function renderCoverageTable() {
    tbodyCoverageDetails.innerHTML = '';
    state.coverageResults.forEach(function(c) {
      var tr = document.createElement('tr');
      var badgeCls = c.status === 'Optimal' ? 'badge-success' : (c.status === 'Deficit' ? 'badge-danger' : 'badge-warn');
      var varColor = c.variance < 0 ? 'text-danger' : (c.variance > 0 ? 'text-accent' : 'text-success');

      tr.innerHTML = 
        '<td class="mono"><strong>' + c.interval + '</strong></td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(c.volume) + '</td>' +
        '<td class="mono">' + c.required + '</td>' +
        '<td class="mono text-accent"><strong>' + c.scheduled + '</strong></td>' +
        '<td class="mono ' + varColor + '">' + (c.variance > 0 ? '+' : '') + c.variance + '</td>' +
        '<td class="mono">' + c.coveragePct.toFixed(0) + '%</td>' +
        '<td><span class="badge ' + badgeCls + '">' + c.status + '</span></td>';

      tbodyCoverageDetails.appendChild(tr);
    });
  }

  function renderCoverageChart() {
    if (!canvasCoverageChart || typeof Chart === 'undefined') return;

    var labels = state.coverageResults.map(function(c) { return c.interval; });
    var reqData = state.coverageResults.map(function(c) { return c.required; });
    var schedData = state.coverageResults.map(function(c) { return c.scheduled; });

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = reqData;
      state.chart.data.datasets[1].data = schedData;
      state.chart.update();
      return;
    }

    var ctx = canvasCoverageChart.getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Required Headcount',
            data: reqData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            borderWidth: 2,
            pointRadius: 3,
            stepped: 'middle',
            fill: false
          },
          {
            label: 'Scheduled Headcount',
            data: schedData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#10b981',
            fill: true,
            tension: 0.2
          }
        ]
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
            bodyFont: { family: 'IBM Plex Mono', size: 12 }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#64748b', font: { family: 'IBM Plex Mono', size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'IBM Plex Mono', size: 11 },
              callback: function(v) { return v + ' agents'; }
            }
          }
        }
      }
    });
  }

  // --- Incoming Handoff Handler (from capacity / plans / shared link) ---
  function checkIncomingHandoff() {
    var params = new URLSearchParams(window.location.search);

    // Shared read-only link — restore state from URL-encoded data
    if (params.get('shared') === '1' && window.ERLANGLY_SHARED_DATA) {
      var sd = window.ERLANGLY_SHARED_DATA;
      if (sd.intervals && sd.intervals.length > 0) {
        state.intervals = sd.intervals;
        if (sd.intervalLength) state.intervalLength = sd.intervalLength;
        if (sd.targetSLA) state.targetSLA = sd.targetSLA;
        if (sd.shrinkage !== undefined) {
          state.shrinkage = sd.shrinkage;
          numFteShrinkage.value = Math.round(sd.shrinkage * 100);
        }
        schedHandoffBanner.style.display = 'flex';
        schedHandoffText.textContent = 'Shared plan loaded: ' + sd.intervals.length + ' staffing intervals restored.';
      }
      return;
    }

    var from = params.get('from');
    if (from === 'capacity') {
      var handoff = ErlanglyUtils.getHandoff('scheduling');
      if (handoff && handoff.intervals && handoff.intervals.length > 0) {
        state.intervals = handoff.intervals;
        if (handoff.intervalLength) state.intervalLength = handoff.intervalLength;
        if (handoff.targetSLA) state.targetSLA = handoff.targetSLA;
        if (handoff.shrinkage) {
          state.shrinkage = handoff.shrinkage;
          numFteShrinkage.value = Math.round(handoff.shrinkage * 100);
        }

        schedHandoffBanner.style.display = 'flex';
        schedHandoffText.textContent = 'Imported ' + handoff.intervals.length + ' staffing requirement intervals from Capacity Planning.';
      }
    } else if (from === 'plans') {
      var planHandoff = ErlanglyUtils.getHandoff('scheduling');
      if (planHandoff) {
        if (planHandoff.intervals && planHandoff.intervals.length > 0) {
          state.intervals = planHandoff.intervals;
        }
        if (planHandoff.intervalLength) state.intervalLength = planHandoff.intervalLength;
        if (planHandoff.targetSLA) state.targetSLA = planHandoff.targetSLA;
        if (planHandoff.shrinkage !== undefined) {
          state.shrinkage = planHandoff.shrinkage;
          numFteShrinkage.value = Math.round(planHandoff.shrinkage * 100);
        }
        schedHandoffBanner.style.display = 'flex';
        schedHandoffText.textContent = 'Scheduling plan restored from My Plans.';
      }
    }

    btnDismissSchedHandoff.addEventListener('click', function() {
      schedHandoffBanner.style.display = 'none';
    });
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
