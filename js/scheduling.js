/**
 * Erlangly Scheduling & Labor Rules Toolkit (js/scheduling.js)
 * 
 * Phase 3 & Phase 9 Features:
 * - Forecast-to-Required FTE Converter (work-week, part-time mix, shrinkage)
 * - Daily staffing & FTE breakdown table
 * - Labor Rule Engine (Max daily/weekly hours, 11h min rest anti-clopening, max consecutive days)
 * - Variable-Length Part-Time Shift Patterns with Dynamic Break Schedules
 * - Constraint-Aware Multi-Day Roster Allocator (Hard & Soft Constraints)
 * - Infeasibility & Bottleneck Diagnostics (Root-cause reporting for unmet demand)
 * - Interactive 7-Day Roster Schedule Matrix with Real-Time Compliance Auditor
 * - Multi-Day Interval Coverage Chart.js Visualizer
 * - RFC-4180 Standardized CSV Exporters & Availability Importers
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./erlang.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./erlang.js'));
  } else {
    root.ErlanglyScheduling = factory(root.Erlangly);
  }
}(typeof self !== 'undefined' ? self : this, function (Erlangly) {
  'use strict';

  // --- Default Daytime Interval Schedule (08:00 - 20:00, 30-min intervals) ---
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

  // --- Dynamic Shift Break Rules ---
  function getBreakRulesForLength(lengthHours) {
    var len = parseFloat(lengthHours) || 8.0;
    if (len <= 4.0) {
      return {
        mealMins: 0,
        paidBreakMins: 0,
        unpaidMealMins: 0,
        paidHours: len,
        description: 'No meal break (100% paid)'
      };
    } else if (len <= 6.0) {
      return {
        mealMins: 15,
        paidBreakMins: 15,
        unpaidMealMins: 15,
        paidHours: Math.max(0, len - 0.25),
        description: '15m meal break'
      };
    } else if (len <= 8.5) {
      return {
        mealMins: 30,
        paidBreakMins: 15,
        unpaidMealMins: 30,
        paidHours: Math.max(0, len - 0.5),
        description: '30m unpaid meal + 15m rest'
      };
    } else {
      return {
        mealMins: 60,
        paidBreakMins: 30,
        unpaidMealMins: 60,
        paidHours: Math.max(0, len - 1.0),
        description: '60m unpaid meal + 2x 15m rest'
      };
    }
  }

  // --- Default Shift Patterns (Full-Time & Part-Time) ---
  var DEFAULT_SHIFTS = [
    { id: 'S1', name: 'Early Shift', type: 'FT', start: '08:00', lengthHours: 8.5, mealStart: '12:00', mealMins: 30, paidHours: 8.0 },
    { id: 'S2', name: 'Core Morning', type: 'FT', start: '09:00', lengthHours: 8.5, mealStart: '13:00', mealMins: 30, paidHours: 8.0 },
    { id: 'S3', name: 'Mid Day', type: 'FT', start: '10:30', lengthHours: 8.5, mealStart: '14:30', mealMins: 30, paidHours: 8.0 },
    { id: 'S4', name: 'Evening Close', type: 'FT', start: '11:30', lengthHours: 8.5, mealStart: '15:30', mealMins: 30, paidHours: 8.0 },
    { id: 'PT1', name: 'Morning PT', type: 'PT', start: '08:00', lengthHours: 4.0, mealStart: '', mealMins: 0, paidHours: 4.0 },
    { id: 'PT2', name: 'Peak Cover PT', type: 'PT', start: '11:00', lengthHours: 6.0, mealStart: '13:30', mealMins: 15, paidHours: 5.75 },
    { id: 'PT3', name: 'Afternoon PT', type: 'PT', start: '14:00', lengthHours: 4.0, mealStart: '', mealMins: 0, paidHours: 4.0 }
  ];

  // --- Default Global Labor Rules ---
  var DEFAULT_LABOR_RULES = {
    maxDailyHours: 10.0,
    maxWeeklyHours: 40.0,
    minRestHours: 11.0,
    maxConsecutiveDays: 6,
    requireMandatoryRestDay: true
  };

  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DAY_FACTORS = [1.25, 1.10, 1.05, 1.00, 0.95, 0.50, 0.40];

  // --- Time Conversion Helpers ---
  function parseTimeToMins(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    var parts = timeStr.trim().split(':');
    var h = parseInt(parts[0], 10) || 0;
    var m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }

  function formatMinsToTime(totalMins) {
    var m = ((totalMins % 1440) + 1440) % 1440;
    var hours = Math.floor(m / 60);
    var mins = m % 60;
    return (hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins;
  }

  // --- Rest Period Calculation Between Adjacent Shifts ---
  function computeRestPeriod(prevDayShift, currentDayShift) {
    if (!prevDayShift || !currentDayShift) return 24.0; // Unlimited / full rest
    var prevStartMins = parseTimeToMins(prevDayShift.start);
    var prevEndMins = prevStartMins + Math.round(prevDayShift.lengthHours * 60);
    var currStartMins = parseTimeToMins(currentDayShift.start) + 1440; // Next calendar day (+24h)
    var restMins = currStartMins - prevEndMins;
    return restMins / 60.0;
  }

  // --- Agent Roster Generator ---
  function generateRosterFromFte(options) {
    var opts = options || {};
    var totalBodies = Math.max(1, opts.totalBodies || 45);
    var ptMix = Math.max(0, Math.min(1, opts.ptMix !== undefined ? opts.ptMix : 0.20));
    var ptCount = Math.round(totalBodies * ptMix);
    var ftCount = totalBodies - ptCount;
    var ftWeeklyHours = opts.ftWeeklyHours || 40.0;
    var ptWeeklyHours = opts.ptWeeklyHours || 20.0;
    var globalRules = opts.globalRules || DEFAULT_LABOR_RULES;

    var agents = [];
    var agentIndex = 1;

    // Full-Time Agents
    for (var i = 0; i < ftCount; i++) {
      var id = 'FT-' + (i < 9 ? '0' : '') + (i + 1);
      var prefShifts = ['S1', 'S2', 'S3', 'S4'];
      var pref = prefShifts[i % prefShifts.length];

      agents.push({
        id: id,
        name: 'Agent ' + (agentIndex++),
        contractType: 'FT',
        targetWeeklyHours: ftWeeklyHours,
        maxDailyHours: globalRules.maxDailyHours || 10.0,
        maxWeeklyHours: globalRules.maxWeeklyHours || 40.0,
        minRestHours: globalRules.minRestHours || 11.0,
        maxConsecutiveDays: globalRules.maxConsecutiveDays || 6,
        preferredShift: pref,
        availability: [
          { day: 0, available: true, start: '07:00', end: '21:00' },
          { day: 1, available: true, start: '07:00', end: '21:00' },
          { day: 2, available: true, start: '07:00', end: '21:00' },
          { day: 3, available: true, start: '07:00', end: '21:00' },
          { day: 4, available: true, start: '07:00', end: '21:00' },
          { day: 5, available: (i % 3 === 0), start: '08:00', end: '18:00' },
          { day: 6, available: (i % 4 === 0), start: '08:00', end: '18:00' }
        ]
      });
    }

    // Part-Time Agents
    for (var j = 0; j < ptCount; j++) {
      var ptId = 'PT-' + (j < 9 ? '0' : '') + (j + 1);
      var ptPrefs = ['PT1', 'PT2', 'PT3'];
      var ptPref = ptPrefs[j % ptPrefs.length];

      agents.push({
        id: ptId,
        name: 'Agent ' + (agentIndex++),
        contractType: 'PT',
        targetWeeklyHours: ptWeeklyHours,
        maxDailyHours: 8.0,
        maxWeeklyHours: Math.max(ptWeeklyHours + 4, 24.0),
        minRestHours: globalRules.minRestHours || 11.0,
        maxConsecutiveDays: 5,
        preferredShift: ptPref,
        availability: [
          { day: 0, available: (j % 2 === 0), start: '08:00', end: '18:00' },
          { day: 1, available: true, start: '08:00', end: '18:00' },
          { day: 2, available: true, start: '08:00', end: '18:00' },
          { day: 3, available: true, start: '08:00', end: '18:00' },
          { day: 4, available: (j % 2 !== 0), start: '08:00', end: '18:00' },
          { day: 5, available: true, start: '08:00', end: '18:00' },
          { day: 6, available: true, start: '08:00', end: '18:00' }
        ]
      });
    }

    return agents;
  }

  // --- Shift Compliance & Labor Rule Checker ---
  function checkShiftCompliance(agent, dayIndex, candidateShift, currentWeekAssignments, globalRules, shiftsById) {
    var rules = globalRules || DEFAULT_LABOR_RULES;
    var maxDaily = agent.maxDailyHours || rules.maxDailyHours || 10.0;
    var maxWeekly = agent.maxWeeklyHours || rules.maxWeeklyHours || 40.0;
    var minRest = agent.minRestHours || rules.minRestHours || 11.0;
    var maxConsec = agent.maxConsecutiveDays || rules.maxConsecutiveDays || 6;

    var hardViolations = [];
    var softWarnings = [];
    var prefScore = 0;

    // 1. If candidate is OFF, no shift-level violations
    if (!candidateShift || candidateShift.id === 'OFF') {
      return {
        isFeasible: true,
        hardViolations: [],
        softWarnings: [],
        restHoursFromPrev: 24.0,
        restHoursToNext: 24.0,
        prefScore: 0
      };
    }

    // 2. Check Daily Availability Window
    var dayAvail = agent.availability ? agent.availability[dayIndex] : null;
    if (dayAvail) {
      if (!dayAvail.available) {
        hardViolations.push('Unavailable on ' + DAY_NAMES[dayIndex]);
      } else {
        var shiftStartMins = parseTimeToMins(candidateShift.start);
        var shiftEndMins = shiftStartMins + Math.round(candidateShift.lengthHours * 60);
        var availStartMins = parseTimeToMins(dayAvail.start || '00:00');
        var availEndMins = parseTimeToMins(dayAvail.end || '23:59');

        if (shiftStartMins < availStartMins || shiftEndMins > availEndMins) {
          hardViolations.push('Shift (' + candidateShift.start + '-' + formatMinsToTime(shiftEndMins) + ') outside availability (' + dayAvail.start + '-' + dayAvail.end + ')');
        }
      }
    }

    // 3. Check Daily Working Hours
    if (candidateShift.paidHours > maxDaily) {
      hardViolations.push('Daily paid hours (' + candidateShift.paidHours.toFixed(1) + 'h) exceeds max daily limit (' + maxDaily.toFixed(1) + 'h)');
    }

    // 4. Check Weekly Working Hours Accumulation
    var currentWeeklyHours = 0;
    for (var d = 0; d < 7; d++) {
      if (d === dayIndex) {
        currentWeeklyHours += candidateShift.paidHours;
      } else if (currentWeekAssignments && currentWeekAssignments[d]) {
        var s = shiftsById[currentWeekAssignments[d]];
        if (s) currentWeeklyHours += s.paidHours;
      }
    }
    if (currentWeeklyHours > (maxWeekly + 0.01)) {
      hardViolations.push('Weekly hours (' + currentWeeklyHours.toFixed(1) + 'h) exceeds statutory max (' + maxWeekly.toFixed(1) + 'h)');
    }

    // 5. Check Rest Period from Previous Day (Anti-Clopening)
    var restFromPrev = 24.0;
    if (dayIndex > 0 && currentWeekAssignments && currentWeekAssignments[dayIndex - 1]) {
      var prevShift = shiftsById[currentWeekAssignments[dayIndex - 1]];
      if (prevShift && prevShift.id !== 'OFF') {
        restFromPrev = computeRestPeriod(prevShift, candidateShift);
        if (restFromPrev < minRest) {
          hardViolations.push('Rest before shift (' + restFromPrev.toFixed(1) + 'h) violates ' + minRest.toFixed(1) + 'h minimum rest (Clopening breach)');
        }
      }
    }

    // 6. Check Rest Period to Next Day
    var restToNext = 24.0;
    if (dayIndex < 6 && currentWeekAssignments && currentWeekAssignments[dayIndex + 1]) {
      var nextShift = shiftsById[currentWeekAssignments[dayIndex + 1]];
      if (nextShift && nextShift.id !== 'OFF') {
        restToNext = computeRestPeriod(candidateShift, nextShift);
        if (restToNext < minRest) {
          hardViolations.push('Rest after shift (' + restToNext.toFixed(1) + 'h) violates ' + minRest.toFixed(1) + 'h minimum rest');
        }
      }
    }

    // 7. Check Consecutive Working Days
    var tempAssignments = currentWeekAssignments ? currentWeekAssignments.slice() : new Array(7).fill(null);
    tempAssignments[dayIndex] = candidateShift.id;
    var consecutiveStreak = 0;
    var maxStreakInWeek = 0;
    for (var c = 0; c < 7; c++) {
      if (tempAssignments[c] && tempAssignments[c] !== 'OFF') {
        consecutiveStreak++;
        if (consecutiveStreak > maxStreakInWeek) maxStreakInWeek = consecutiveStreak;
      } else {
        consecutiveStreak = 0;
      }
    }
    if (maxStreakInWeek > maxConsec) {
      hardViolations.push('Consecutive working days (' + maxStreakInWeek + ' days) exceeds maximum ' + maxConsec + ' days');
    }

    // 8. Soft Preference Scoring
    if (agent.preferredShift) {
      if (agent.preferredShift === candidateShift.id) {
        prefScore = 3.0; // Preferred boost
      } else if (candidateShift.type && agent.contractType && candidateShift.type !== agent.contractType) {
        softWarnings.push('Assigned ' + candidateShift.type + ' shift to ' + agent.contractType + ' worker');
        prefScore = -1.5;
      } else {
        softWarnings.push('Non-preferred shift assignment (preferred ' + agent.preferredShift + ')');
        prefScore = 0.5;
      }
    }

    return {
      isFeasible: hardViolations.length === 0,
      hardViolations: hardViolations,
      softWarnings: softWarnings,
      restHoursFromPrev: restFromPrev,
      restHoursToNext: restToNext,
      prefScore: prefScore
    };
  }

  // --- Schedule Compliance Auditor ---
  function auditRoster(rosterAssignments, agents, shiftsById, globalRules) {
    var results = {
      totalAgents: agents.length,
      compliantCount: 0,
      warnCount: 0,
      errorCount: 0,
      agentReports: {},
      bottlenecks: []
    };

    agents.forEach(function(agent) {
      var weekAssigned = rosterAssignments[agent.id] || new Array(7).fill('OFF');
      var agentHardViolations = [];
      var agentSoftWarnings = [];
      var totalPaidHours = 0;
      var daysWorked = 0;

      for (var d = 0; d < 7; d++) {
        var shiftId = weekAssigned[d];
        if (shiftId && shiftId !== 'OFF') {
          daysWorked++;
          var shift = shiftsById[shiftId];
          if (shift) {
            totalPaidHours += shift.paidHours;
            var check = checkShiftCompliance(agent, d, shift, weekAssigned, globalRules, shiftsById);
            if (check.hardViolations.length > 0) {
              agentHardViolations.push(DAY_NAMES[d] + ': ' + check.hardViolations.join('; '));
            }
            if (check.softWarnings.length > 0) {
              agentSoftWarnings.push(DAY_NAMES[d] + ': ' + check.softWarnings.join('; '));
            }
          }
        }
      }

      var status = 'PASS';
      if (agentHardViolations.length > 0) {
        status = 'ERROR';
        results.errorCount++;
      } else if (agentSoftWarnings.length > 0) {
        status = 'WARN';
        results.warnCount++;
      } else {
        results.compliantCount++;
      }

      results.agentReports[agent.id] = {
        agentId: agent.id,
        agentName: agent.name,
        contractType: agent.contractType,
        totalPaidHours: totalPaidHours,
        daysWorked: daysWorked,
        status: status,
        hardViolations: agentHardViolations,
        softWarnings: agentSoftWarnings
      };
    });

    return results;
  }

  // --- Constraint-Aware Heuristic Multi-Day Roster Allocator ---
  function optimizeRoster(options) {
    var opts = options || {};
    var intervals = opts.intervals || DEFAULT_INTERVALS;
    var intervalLength = opts.intervalLength || 1800;
    var operatingDays = Math.max(1, Math.min(7, opts.operatingDays || 7));
    var shifts = (opts.shifts && opts.shifts.length > 0) ? opts.shifts : DEFAULT_SHIFTS;
    var globalRules = opts.globalRules || DEFAULT_LABOR_RULES;
    var agents = (opts.agents && opts.agents.length > 0) ? opts.agents : generateRosterFromFte({
      totalBodies: opts.allocatedHeadcount || 45,
      ptMix: opts.ptMix || 0.20,
      globalRules: globalRules
    });

    var shiftsById = {};
    shifts.forEach(function(s) { shiftsById[s.id] = s; });

    var intervalMins = intervalLength / 60;
    var intervalHours = intervalLength / 3600;
    var numIntervals = intervals.length;

    // 1. Build Shift Coverage Vectors (which intervals does shift cover)
    var shiftCoverageVectors = {};
    shifts.forEach(function(shift) {
      var shiftStartMins = parseTimeToMins(shift.start);
      var shiftEndMins = shiftStartMins + Math.round(shift.lengthHours * 60);
      var mealStartMins = shift.mealStart ? parseTimeToMins(shift.mealStart) : -1;
      var mealEndMins = mealStartMins >= 0 ? (mealStartMins + shift.mealMins) : -1;

      var vector = [];
      intervals.forEach(function(inv) {
        var invStartMins = parseTimeToMins(inv.interval);
        var invEndMins = invStartMins + intervalMins;

        var inShift = invStartMins >= shiftStartMins && invEndMins <= shiftEndMins;
        var inMeal = mealStartMins >= 0 && invStartMins >= mealStartMins && invEndMins <= mealEndMins;

        vector.push(inShift && !inMeal ? 1 : 0);
      });
      shiftCoverageVectors[shift.id] = vector;
    });

    // 2. Initialize Roster Schedule Matrix
    var rosterAssignments = {};
    agents.forEach(function(a) {
      rosterAssignments[a.id] = new Array(7).fill('OFF');
    });

    var dailyCoverage = [];
    var allBottlenecks = [];

    // 3. Multi-Day Allocation Loop (Day 0 = Mon ... Day 6 = Sun)
    for (var day = 0; day < operatingDays; day++) {
      var factor = DAY_FACTORS[day] || 1.0;
      var dayRequired = intervals.map(function(inv) {
        var baseReq = inv.staffedAgents || inv.requiredAgents || 10;
        return Math.round(baseReq * factor);
      });

      var dayScheduled = new Array(numIntervals).fill(0);
      var dayAgentAssigned = {}; // agentId -> boolean
      var passes = 0;
      var maxPasses = agents.length;

      // Iteratively assign shifts to eliminate deficits
      while (passes < maxPasses) {
        passes++;

        // Find intervals with deficits
        var maxDeficit = 0;
        var peakDeficitIntervalIdx = -1;
        for (var i = 0; i < numIntervals; i++) {
          var deficit = dayRequired[i] - dayScheduled[i];
          if (deficit > maxDeficit) {
            maxDeficit = deficit;
            peakDeficitIntervalIdx = i;
          }
        }

        if (maxDeficit <= 0) break; // All demand satisfied for this day!

        // Rank candidate shifts by how many deficit intervals they cover
        var candidateShiftScores = [];
        shifts.forEach(function(shift) {
          var vec = shiftCoverageVectors[shift.id];
          if (!vec) return;
          var coverScore = 0;
          for (var k = 0; k < numIntervals; k++) {
            if (vec[k] === 1) {
              var d = dayRequired[k] - dayScheduled[k];
              if (d > 0) coverScore += (d * 5);
              else coverScore -= 1; // Slight penalty for surplus
            }
          }
          if (coverScore > 0) {
            candidateShiftScores.push({ shift: shift, score: coverScore });
          }
        });

        if (candidateShiftScores.length === 0) break;

        candidateShiftScores.sort(function(a, b) { return b.score - a.score; });

        var assignedInThisPass = false;
        var accumulatedBlockedReasons = { rest: 0, weeklyHours: 0, consecutiveDays: 0, unavailable: 0 };

        for (var sIdx = 0; sIdx < candidateShiftScores.length; sIdx++) {
          var candidateShift = candidateShiftScores[sIdx].shift;
          var candidateAgents = [];

          agents.forEach(function(agent) {
            if (dayAgentAssigned[agent.id]) return; // Already working today

            var check = checkShiftCompliance(agent, day, candidateShift, rosterAssignments[agent.id], globalRules, shiftsById);
            if (check.isFeasible) {
              var currentWeeklyHours = 0;
              for (var dIdx = 0; dIdx < 7; dIdx++) {
                var assignedS = shiftsById[rosterAssignments[agent.id][dIdx]];
                if (assignedS) currentWeeklyHours += assignedS.paidHours;
              }

              var targetHours = agent.targetWeeklyHours || 40.0;
              var hoursGap = targetHours - (currentWeeklyHours + candidateShift.paidHours);
              var hoursScore = (hoursGap >= 0) ? (5.0 - Math.abs(hoursGap) * 0.1) : (-Math.abs(hoursGap) * 2.0);
              var totalScore = check.prefScore + hoursScore + (check.restHoursFromPrev * 0.05);

              candidateAgents.push({
                agent: agent,
                score: totalScore
              });
            } else {
              check.hardViolations.forEach(function(v) {
                if (v.indexOf('Rest') !== -1) accumulatedBlockedReasons.rest++;
                else if (v.indexOf('Weekly') !== -1) accumulatedBlockedReasons.weeklyHours++;
                else if (v.indexOf('Consecutive') !== -1) accumulatedBlockedReasons.consecutiveDays++;
                else if (v.indexOf('Unavailable') !== -1) accumulatedBlockedReasons.unavailable++;
              });
            }
          });

          if (candidateAgents.length > 0) {
            candidateAgents.sort(function(a, b) { return b.score - a.score; });
            var chosenAgent = candidateAgents[0].agent;

            // Assign shift
            rosterAssignments[chosenAgent.id][day] = candidateShift.id;
            dayAgentAssigned[chosenAgent.id] = true;

            // Update day scheduled coverage
            var shiftVec = shiftCoverageVectors[candidateShift.id];
            for (var n = 0; n < numIntervals; n++) {
              dayScheduled[n] += shiftVec[n];
            }

            assignedInThisPass = true;
            break; // Successfully assigned one agent in this pass
          }
        }

        if (!assignedInThisPass) {
          allBottlenecks.push({
            day: DAY_NAMES[day],
            interval: intervals[peakDeficitIntervalIdx] ? intervals[peakDeficitIntervalIdx].interval : 'Peak',
            unmetDeficit: maxDeficit,
            blockedReasons: accumulatedBlockedReasons
          });
          break; // Feasibility ceiling reached for this day
        }
      }

      // Compile daily coverage results
      var dayReqHours = 0;
      var daySchedHours = 0;
      var dayDeficitHours = 0;
      var daySurplusHours = 0;
      var dayMatchedHours = 0;
      var dayIntervalsData = [];

      for (var j = 0; j < numIntervals; j++) {
        var rVal = dayRequired[j];
        var sVal = dayScheduled[j];
        var variance = sVal - rVal;
        var covPct = rVal > 0 ? (sVal / rVal) * 100 : 100;

        dayReqHours += (rVal * intervalHours);
        daySchedHours += (sVal * intervalHours);

        if (variance < 0) {
          dayDeficitHours += (Math.abs(variance) * intervalHours);
        } else {
          daySurplusHours += (variance * intervalHours);
        }
        dayMatchedHours += (Math.min(rVal, sVal) * intervalHours);

        var status = 'Optimal';
        if (variance < 0) status = 'Deficit';
        else if (variance > 4) status = 'Surplus';

        dayIntervalsData.push({
          interval: intervals[j].interval,
          volume: Math.round(intervals[j].volume * factor),
          required: rVal,
          scheduled: sVal,
          variance: variance,
          coveragePct: covPct,
          status: status
        });
      }

      var dayMatchPct = dayReqHours > 0 ? (dayMatchedHours / dayReqHours) * 100 : 100;

      dailyCoverage.push({
        dayIndex: day,
        dayName: DAY_NAMES[day],
        requiredHours: dayReqHours,
        scheduledHours: daySchedHours,
        deficitHours: dayDeficitHours,
        surplusHours: daySurplusHours,
        matchPct: dayMatchPct,
        intervals: dayIntervalsData
      });
    }

    // 4. Run Full Schedule Audit
    var auditResults = auditRoster(rosterAssignments, agents, shiftsById, globalRules);
    auditResults.bottlenecks = allBottlenecks;

    return {
      rosterAssignments: rosterAssignments,
      agents: agents,
      shifts: shifts,
      shiftsById: shiftsById,
      globalRules: globalRules,
      dailyCoverage: dailyCoverage,
      auditResults: auditResults
    };
  }

  // --- CSV Exporters & Template Generators ---
  function exportAgentRosterCSV(rosterAssignments, agents, shiftsById, auditResults) {
    var headers = [
      'Agent_ID',
      'Agent_Name',
      'Contract_Type',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
      'Total_Paid_Hours',
      'Compliance_Status',
      'Violations_And_Warnings'
    ];

    var rows = agents.map(function(agent) {
      var assigned = rosterAssignments[agent.id] || new Array(7).fill('OFF');
      var report = auditResults && auditResults.agentReports ? auditResults.agentReports[agent.id] : null;
      var totalHours = report ? report.totalPaidHours : 0;
      var status = report ? report.status : 'PASS';
      var notes = [];

      if (report) {
        if (report.hardViolations && report.hardViolations.length > 0) {
          notes.push('[ERR] ' + report.hardViolations.join(' | '));
        }
        if (report.softWarnings && report.softWarnings.length > 0) {
          notes.push('[WARN] ' + report.softWarnings.join(' | '));
        }
      }

      return [
        agent.id,
        agent.name,
        agent.contractType,
        assigned[0] || 'OFF',
        assigned[1] || 'OFF',
        assigned[2] || 'OFF',
        assigned[3] || 'OFF',
        assigned[4] || 'OFF',
        assigned[5] || 'OFF',
        assigned[6] || 'OFF',
        totalHours.toFixed(1),
        status,
        notes.join('; ')
      ];
    });

    return { headers: headers, rows: rows };
  }

  function downloadAgentAvailabilityTemplate() {
    var headers = [
      'Agent_ID',
      'Agent_Name',
      'Contract_Type',
      'Day_Of_Week',
      'Available_Start',
      'Available_End',
      'Preferred_Shift',
      'Max_Daily_Hours',
      'Max_Weekly_Hours',
      'Min_Rest_Hours',
      'Max_Consecutive_Days'
    ];

    var rows = [
      ['FT-01', 'Alice Walker', 'FT', 'Monday', '07:00', '21:00', 'S1', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Tuesday', '07:00', '21:00', 'S1', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Wednesday', '07:00', '21:00', 'S1', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Thursday', '07:00', '21:00', 'S1', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Friday', '07:00', '21:00', 'S1', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Saturday', 'OFF', 'OFF', 'OFF', '10.0', '40.0', '11.0', '6'],
      ['FT-01', 'Alice Walker', 'FT', 'Sunday', 'OFF', 'OFF', 'OFF', '10.0', '40.0', '11.0', '6'],
      ['PT-01', 'Bob Chen', 'PT', 'Monday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Tuesday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Wednesday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Thursday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Friday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Saturday', '08:00', '18:00', 'PT1', '8.0', '24.0', '11.0', '5'],
      ['PT-01', 'Bob Chen', 'PT', 'Sunday', 'OFF', 'OFF', 'OFF', '8.0', '24.0', '11.0', '5']
    ];

    if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.exportCSV) {
      ErlanglyUtils.exportCSV('agent_availability_template.csv', headers, rows);
    }
    return { headers: headers, rows: rows };
  }

  // --- Browser UI Implementation ---
  var UIState = {
    intervals: DEFAULT_INTERVALS.slice(),
    intervalLength: 1800,
    targetSLA: 0.80,
    shrinkage: 0.30,
    workWeekHours: 40.0,
    ptMix: 0.20,
    ptHours: 20.0,
    operatingDays: 7,
    allocatedHeadcount: 45,
    globalRules: Object.assign({}, DEFAULT_LABOR_RULES),
    shifts: DEFAULT_SHIFTS.slice(),
    agents: [],
    rosterAssignments: {},
    auditResults: null,
    dailyCoverage: [],
    activeCoverageDayIndex: 0,
    chart: null
  };

  function initUI() {
    if (typeof document === 'undefined') return;

    // DOM Elements
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

    var numRuleMaxDaily = document.getElementById('num-rule-max-daily');
    var numRuleMaxWeekly = document.getElementById('num-rule-max-weekly');
    var numRuleMinRest = document.getElementById('num-rule-min-rest');
    var numRuleMaxConsec = document.getElementById('num-rule-max-consec');
    var numAllocHeadcount = document.getElementById('num-alloc-headcount');

    var btnDownloadAgentTemplate = document.getElementById('btn-download-agent-template');
    var btnManageAgents = document.getElementById('btn-manage-agents');
    var btnRunRosterOptimizer = document.getElementById('btn-run-roster-optimizer');
    var btnAddShift = document.getElementById('btn-add-shift');
    var btnExportRosterCSV = document.getElementById('btn-export-roster-csv');
    var btnResetRoster = document.getElementById('btn-reset-roster');
    var btnExportScheduleCSV = document.getElementById('btn-export-schedule-csv');

    var countRosterBadge = document.getElementById('count-roster-badge');
    var statRosterCount = document.getElementById('stat-roster-count');
    var statCompliantPct = document.getElementById('stat-compliant-pct');
    var statHardViolations = document.getElementById('stat-hard-violations');
    var statSoftWarnings = document.getElementById('stat-soft-warnings');

    var tbodyShiftPatterns = document.getElementById('tbody-shift-patterns');
    var tbodyRosterMatrix = document.getElementById('tbody-roster-matrix');
    var tbodyCoverageDetails = document.getElementById('tbody-coverage-details');
    var labelActiveCoverageDay = document.getElementById('label-active-coverage-day');
    var daySelectorContainer = document.getElementById('day-selector-container');

    var boxBottleneckDiagnostics = document.getElementById('box-bottleneck-diagnostics');
    var textBottleneckSummary = document.getElementById('text-bottleneck-summary');
    var listBottleneckItems = document.getElementById('list-bottleneck-items');
    var btnDismissDiagnostics = document.getElementById('btn-dismiss-diagnostics');

    var covReqHours = document.getElementById('cov-req-hours');
    var covSchedHours = document.getElementById('cov-sched-hours');
    var covMatchPct = document.getElementById('cov-match-pct');
    var covMatchStatus = document.getElementById('cov-match-status');
    var covDeficitHours = document.getElementById('cov-deficit-hours');
    var covSurplusHours = document.getElementById('cov-surplus-hours');

    var modalAgentManager = document.getElementById('modal-agent-manager');
    var btnCloseAgentModal = document.getElementById('btn-close-agent-modal');
    var btnModalAddAgent = document.getElementById('btn-modal-add-agent');
    var btnModalGenFte = document.getElementById('btn-modal-gen-fte');
    var inputUploadAgentCsv = document.getElementById('input-upload-agent-csv');
    var tbodyAgentsList = document.getElementById('tbody-agents-list');
    var btnModalSaveClose = document.getElementById('btn-modal-save-close');

    var popoverShiftPicker = document.getElementById('popover-shift-picker');
    var popoverShiftOptions = document.getElementById('popover-shift-options');

    var schedHandoffBanner = document.getElementById('sched-handoff-banner');
    var schedHandoffText = document.getElementById('sched-handoff-text');
    var btnDismissSchedHandoff = document.getElementById('btn-dismiss-sched-handoff');

    // --- Tab Navigation ---
    if (tabFteConverter && tabShiftAllocation) {
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
        if (UIState.dailyCoverage.length === 0) {
          executeRosterOptimization();
        }
      });

      if (btnProceedToShifts) {
        btnProceedToShifts.addEventListener('click', function() {
          tabShiftAllocation.click();
        });
      }
    }

    // --- FTE Calculation ---
    function calculateFTE() {
      if (!numWorkWeek) return;
      UIState.workWeekHours = Math.max(10, parseFloat(numWorkWeek.value) || 40.0);
      UIState.ptMix = Math.max(0, Math.min(100, parseFloat(numPtMix.value) || 0)) / 100;
      UIState.ptHours = Math.max(5, parseFloat(numPtHours.value) || 20.0);
      UIState.shrinkage = Math.max(0, Math.min(99, parseFloat(numFteShrinkage.value) || 0)) / 100;
      UIState.operatingDays = parseInt(selectOperatingDays.value, 10) || 7;

      var intervalHours = UIState.intervalLength / 3600;
      var dailyNetHours = 0;
      var dailyGrossHours = 0;

      UIState.intervals.forEach(function(row) {
        var req = row.requiredAgents;
        var staffed = row.staffedAgents;

        if (req === undefined || req === null) {
          var solve = Erlangly.agentsRequired({
            volume: row.volume,
            aht: row.aht,
            intervalSeconds: UIState.intervalLength,
            targetServiceLevel: UIState.targetSLA,
            shrinkage: UIState.shrinkage
          });
          req = solve.baseAgents;
          staffed = solve.staffedAgents;
          row.requiredAgents = req;
          row.staffedAgents = staffed;
        }

        dailyNetHours += (req * intervalHours);
        dailyGrossHours += (staffed * intervalHours);
      });

      var weeklyNetHours = dailyNetHours * UIState.operatingDays;
      var weeklyGrossHours = dailyGrossHours * UIState.operatingDays;
      var requiredFTE = weeklyGrossHours / UIState.workWeekHours;
      var avgWeeklyHoursPerBody = (1.0 - UIState.ptMix) * UIState.workWeekHours + (UIState.ptMix * UIState.ptHours);
      var totalBodies = Math.ceil(weeklyGrossHours / avgWeeklyHoursPerBody);
      var ptBodies = Math.round(totalBodies * UIState.ptMix);
      var ftBodies = totalBodies - ptBodies;

      if (fteNetHours) fteNetHours.textContent = Math.round(weeklyNetHours).toLocaleString() + ' hrs';
      if (fteGrossHours) fteGrossHours.textContent = Math.round(weeklyGrossHours).toLocaleString() + ' hrs';
      if (fteRequiredTotal) fteRequiredTotal.textContent = requiredFTE.toFixed(1) + ' FTE';
      if (fteFtHeadcount) fteFtHeadcount.textContent = ftBodies + ' FT';
      if (ftePtHeadcount) ftePtHeadcount.textContent = ptBodies + ' PT';
      if (fteTotalBodies) fteTotalBodies.textContent = totalBodies + ' staff';

      if (fteShrinkageNote) fteShrinkageNote.textContent = 'Includes ' + Math.round(UIState.shrinkage * 100) + '% shrinkage';
      if (fteFtSub) fteFtSub.textContent = Math.round((1 - UIState.ptMix) * 100) + '% FT @ ' + UIState.workWeekHours + 'h/wk';
      if (ftePtSub) ftePtSub.textContent = Math.round(UIState.ptMix * 100) + '% PT @ ' + UIState.ptHours + 'h/wk';

      if (numAllocHeadcount) {
        UIState.allocatedHeadcount = totalBodies;
        numAllocHeadcount.value = totalBodies;
      }

      renderFteBreakdownTable();
    }

    function computeFteBreakdown() {
      var intervalHours = UIState.intervalLength / 3600;
      var baseDayVolume = UIState.intervals.reduce(function(sum, r) { return sum + r.volume; }, 0);
      var baseDayNetHours = UIState.intervals.reduce(function(sum, r) { return sum + ((r.requiredAgents || 0) * intervalHours); }, 0);
      var baseDayGrossHours = UIState.intervals.reduce(function(sum, r) { return sum + ((r.staffedAgents || 0) * intervalHours); }, 0);
      var peakErlangs = UIState.intervals.reduce(function(max, r) { return Math.max(max, r.erlangs || 0); }, 0);

      var dailyRows = [];
      for (var d = 0; d < UIState.operatingDays; d++) {
        var factor = DAY_FACTORS[d] || 1.0;
        var dVol = Math.round(baseDayVolume * factor);
        var dNetH = baseDayNetHours * factor;
        var dGrossH = baseDayGrossHours * factor;
        var dBaseFTE = (dNetH * 5) / UIState.workWeekHours;
        var dGrossFTE = (dGrossH * 5) / UIState.workWeekHours;

        dailyRows.push({
          day: DAY_NAMES[d] || ('Day ' + (d + 1)),
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
      if (!tbodyFteBreakdown) return;
      tbodyFteBreakdown.innerHTML = '';
      var breakdown = computeFteBreakdown();

      breakdown.forEach(function(d) {
        var tr = document.createElement('tr');
        tr.innerHTML = 
          '<td class="mono"><strong>' + d.day + '</strong></td>' +
          '<td class="mono">' + (typeof ErlanglyUtils !== 'undefined' ? ErlanglyUtils.formatNumber(d.volume) : d.volume) + '</td>' +
          '<td class="mono">' + d.peakErlangs.toFixed(1) + '</td>' +
          '<td class="mono">' + Math.round(d.netHours) + ' hrs</td>' +
          '<td class="mono">' + Math.round(d.grossHours) + ' hrs</td>' +
          '<td class="mono">' + d.baseFTE.toFixed(1) + '</td>' +
          '<td class="mono text-accent"><strong>' + d.grossFTE.toFixed(1) + ' FTE</strong></td>';
        tbodyFteBreakdown.appendChild(tr);
      });
    }

    // --- Shift Pattern Table Rendering ---
    function renderShiftPatternsTable() {
      if (!tbodyShiftPatterns) return;
      tbodyShiftPatterns.innerHTML = '';

      UIState.shifts.forEach(function(shift, idx) {
        var tr = document.createElement('tr');
        var breakInfo = getBreakRulesForLength(shift.lengthHours);
        var typeBadge = shift.type === 'PT' ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--info); border: 1px solid rgba(56, 189, 248, 0.3);">PT</span>' : '<span class="badge" style="background: rgba(0, 210, 211, 0.15); color: var(--accent); border: 1px solid rgba(0, 210, 211, 0.3);">FT</span>';

        tr.innerHTML = 
          '<td><strong class="mono text-accent">' + shift.id + '</strong> — <span class="mono">' + shift.name + '</span></td>' +
          '<td>' + typeBadge + '</td>' +
          '<td class="mono">' + shift.start + '</td>' +
          '<td class="mono">' + shift.lengthHours.toFixed(1) + ' hrs</td>' +
          '<td class="mono" style="font-size: var(--text-xs); color: var(--text-secondary);">' + breakInfo.description + (shift.mealStart ? ' (@ ' + shift.mealStart + ')' : '') + '</td>' +
          '<td class="mono text-accent"><strong>' + shift.paidHours.toFixed(2) + ' hrs</strong></td>' +
          '<td><button class="btn btn-ghost btn-sm btn-del-shift" data-idx="' + idx + '" style="color: var(--danger); padding: 0 6px;">✕</button></td>';

        tbodyShiftPatterns.appendChild(tr);
      });

      document.querySelectorAll('.btn-del-shift').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          if (UIState.shifts.length <= 1) {
            if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Must keep at least 1 shift pattern', 'warn');
            return;
          }
          UIState.shifts.splice(idx, 1);
          renderShiftPatternsTable();
          executeRosterOptimization();
        });
      });
    }

    // --- Optimization & Roster Solver Execution ---
    function executeRosterOptimization() {
      // Sync rules from inputs
      if (numRuleMaxDaily) UIState.globalRules.maxDailyHours = parseFloat(numRuleMaxDaily.value) || 10.0;
      if (numRuleMaxWeekly) UIState.globalRules.maxWeeklyHours = parseFloat(numRuleMaxWeekly.value) || 40.0;
      if (numRuleMinRest) UIState.globalRules.minRestHours = parseFloat(numRuleMinRest.value) || 11.0;
      if (numRuleMaxConsec) UIState.globalRules.maxConsecutiveDays = parseInt(numRuleMaxConsec.value, 10) || 6;
      if (numAllocHeadcount) UIState.allocatedHeadcount = parseInt(numAllocHeadcount.value, 10) || 45;

      if (UIState.agents.length === 0 || UIState.agents.length !== UIState.allocatedHeadcount) {
        UIState.agents = generateRosterFromFte({
          totalBodies: UIState.allocatedHeadcount,
          ptMix: UIState.ptMix,
          ftWeeklyHours: UIState.workWeekHours,
          ptWeeklyHours: UIState.ptHours,
          globalRules: UIState.globalRules,
          operatingDays: UIState.operatingDays
        });
      }

      var optResult = optimizeRoster({
        intervals: UIState.intervals,
        intervalLength: UIState.intervalLength,
        operatingDays: UIState.operatingDays,
        shifts: UIState.shifts,
        agents: UIState.agents,
        globalRules: UIState.globalRules
      });

      UIState.rosterAssignments = optResult.rosterAssignments;
      UIState.auditResults = optResult.auditResults;
      UIState.dailyCoverage = optResult.dailyCoverage;

      renderRosterMatrix();
      renderDiagnostics();
      renderCoverageForActiveDay();

      if (countRosterBadge) countRosterBadge.textContent = UIState.agents.length;
      if (statRosterCount) statRosterCount.textContent = UIState.agents.length;
    }

    // --- 7-Day Interactive Roster Matrix Rendering ---
    function renderRosterMatrix() {
      if (!tbodyRosterMatrix) return;
      tbodyRosterMatrix.innerHTML = '';

      var shiftsById = {};
      UIState.shifts.forEach(function(s) { shiftsById[s.id] = s; });

      var audit = UIState.auditResults || auditRoster(UIState.rosterAssignments, UIState.agents, shiftsById, UIState.globalRules);
      UIState.auditResults = audit;

      if (statCompliantPct) {
        var pct = audit.totalAgents > 0 ? (audit.compliantCount / audit.totalAgents) * 100 : 100;
        statCompliantPct.textContent = pct.toFixed(0) + '%';
        statCompliantPct.className = pct >= 95 ? 'text-success' : (pct >= 80 ? 'text-warn' : 'text-danger');
      }
      if (statHardViolations) {
        statHardViolations.textContent = audit.errorCount;
        statHardViolations.className = audit.errorCount > 0 ? 'text-danger font-bold' : 'text-muted';
      }
      if (statSoftWarnings) {
        statSoftWarnings.textContent = audit.warnCount;
        statSoftWarnings.className = audit.warnCount > 0 ? 'text-warn font-bold' : 'text-muted';
      }

      UIState.agents.forEach(function(agent) {
        var tr = document.createElement('tr');
        var assigned = UIState.rosterAssignments[agent.id] || new Array(7).fill('OFF');
        var report = audit.agentReports[agent.id] || { totalPaidHours: 0, status: 'PASS', hardViolations: [], softWarnings: [] };

        var badgeClass = report.status === 'ERROR' ? 'badge-compliance-error' : (report.status === 'WARN' ? 'badge-compliance-warn' : 'badge-compliance-pass');
        var badgeText = report.status === 'ERROR' ? '🚫 Error' : (report.status === 'WARN' ? '⚠️ Warn' : '✓ Pass');
        var tooltip = report.hardViolations.concat(report.softWarnings).join('; ');

        var contractBadge = agent.contractType === 'PT' 
          ? '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: var(--info); font-size: 10px;">PT</span>' 
          : '<span class="badge" style="background: rgba(0, 210, 211, 0.15); color: var(--accent); font-size: 10px;">FT</span>';

        var cellsHtml = '<td><strong class="mono">' + agent.id + '</strong> <span style="font-size: var(--text-xs); color: var(--text-secondary);">' + agent.name + '</span></td>';
        cellsHtml += '<td>' + contractBadge + '</td>';

        // 7 Day Shift Chip Cells
        for (var d = 0; d < 7; d++) {
          var sId = assigned[d] || 'OFF';
          var shiftObj = shiftsById[sId];
          var chipClass = 'shift-chip';
          var chipTime = '';
          var isViolation = false;

          if (sId === 'OFF') {
            chipClass += ' shift-off';
            chipTime = 'REST';
          } else if (shiftObj) {
            chipClass += shiftObj.type === 'PT' ? ' shift-pt' : ' shift-ft';
            chipTime = shiftObj.start + ' (' + shiftObj.paidHours.toFixed(1) + 'h)';

            // Check if this specific cell has a violation
            var cellCheck = checkShiftCompliance(agent, d, shiftObj, assigned, UIState.globalRules, shiftsById);
            if (cellCheck.hardViolations.length > 0) {
              chipClass += ' shift-violation';
              isViolation = true;
            } else if (cellCheck.softWarnings.length > 0) {
              chipClass += ' shift-warning';
            }
          }

          cellsHtml += '<td class="roster-day-col"><button class="' + chipClass + '" data-agent="' + agent.id + '" data-day="' + d + '" title="' + (isViolation ? 'Labor rule violation in this shift' : 'Click to reassign shift') + '"><span>' + sId + '</span><span class="shift-chip-time">' + chipTime + '</span></button></td>';
        }

        cellsHtml += '<td class="mono text-accent"><strong>' + report.totalPaidHours.toFixed(1) + 'h</strong></td>';
        cellsHtml += '<td><span class="' + badgeClass + '" title="' + (tooltip ? tooltip.replace(/"/g, '&quot;') : '100% Compliant') + '">' + badgeText + '</span></td>';

        tr.innerHTML = cellsHtml;
        tbodyRosterMatrix.appendChild(tr);
      });

      // Wire shift chip click handlers to open quick-shift popover
      document.querySelectorAll('.shift-chip').forEach(function(chip) {
        chip.addEventListener('click', function(e) {
          var agentId = e.currentTarget.getAttribute('data-agent');
          var dayIdx = parseInt(e.currentTarget.getAttribute('data-day'), 10);
          openShiftPickerPopover(e.currentTarget, agentId, dayIdx);
        });
      });
    }

    // --- Interactive Popover Shift Picker ---
    function openShiftPickerPopover(targetEl, agentId, dayIdx) {
      if (!popoverShiftPicker || !popoverShiftOptions) return;

      var rect = targetEl.getBoundingClientRect();
      popoverShiftPicker.style.display = 'block';
      popoverShiftPicker.style.top = (window.scrollY + rect.bottom + 4) + 'px';
      popoverShiftPicker.style.left = Math.max(10, (window.scrollX + rect.left - 30)) + 'px';

      popoverShiftOptions.innerHTML = '';

      var optionsList = [{ id: 'OFF', name: 'OFF / Rest Day', type: 'OFF', paidHours: 0 }];
      UIState.shifts.forEach(function(s) { optionsList.push(s); });

      optionsList.forEach(function(opt) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.style.justifyContent = 'space-between';
        btn.style.width = '100%';
        btn.style.fontSize = '11px';
        btn.style.padding = '4px 8px';
        btn.style.fontFamily = 'var(--mono)';

        var label = opt.id === 'OFF' ? '🛑 OFF' : ('📅 ' + opt.id + ' (' + opt.start + ')');
        var sub = opt.paidHours > 0 ? (opt.paidHours.toFixed(1) + 'h') : '';
        btn.innerHTML = '<span>' + label + '</span><span class="text-accent">' + sub + '</span>';

        btn.addEventListener('click', function() {
          UIState.rosterAssignments[agentId][dayIdx] = opt.id;
          popoverShiftPicker.style.display = 'none';

          // Re-audit and re-render
          var shiftsById = {};
          UIState.shifts.forEach(function(s) { shiftsById[s.id] = s; });
          UIState.auditResults = auditRoster(UIState.rosterAssignments, UIState.agents, shiftsById, UIState.globalRules);
          renderRosterMatrix();
          recalculateCoverageFromRoster();
        });

        popoverShiftOptions.appendChild(btn);
      });

      // Auto close popover on outside click
      var closeHandler = function(evt) {
        if (!popoverShiftPicker.contains(evt.target) && evt.target !== targetEl) {
          popoverShiftPicker.style.display = 'none';
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(function() { document.addEventListener('click', closeHandler); }, 10);
    }

    // --- Recalculate Coverage after Manual Shift Edit ---
    function recalculateCoverageFromRoster() {
      var shiftsById = {};
      UIState.shifts.forEach(function(s) { shiftsById[s.id] = s; });

      var intervalMins = UIState.intervalLength / 60;
      var intervalHours = UIState.intervalLength / 3600;
      var numIntervals = UIState.intervals.length;

      var dailyCoverage = [];
      for (var day = 0; day < UIState.operatingDays; day++) {
        var factor = DAY_FACTORS[day] || 1.0;
        var dayRequired = UIState.intervals.map(function(inv) {
          var baseReq = inv.staffedAgents || inv.requiredAgents || 10;
          return Math.round(baseReq * factor);
        });

        var dayScheduled = new Array(numIntervals).fill(0);

        UIState.agents.forEach(function(agent) {
          var sId = UIState.rosterAssignments[agent.id][day];
          if (sId && sId !== 'OFF') {
            var shift = shiftsById[sId];
            if (shift) {
              var sStartMins = parseTimeToMins(shift.start);
              var sEndMins = sStartMins + Math.round(shift.lengthHours * 60);
              var mStartMins = shift.mealStart ? parseTimeToMins(shift.mealStart) : -1;
              var mEndMins = mStartMins >= 0 ? (mStartMins + shift.mealMins) : -1;

              for (var i = 0; i < numIntervals; i++) {
                var invStartMins = parseTimeToMins(UIState.intervals[i].interval);
                var invEndMins = invStartMins + intervalMins;
                var inShift = invStartMins >= sStartMins && invEndMins <= sEndMins;
                var inMeal = mStartMins >= 0 && invStartMins >= mStartMins && invEndMins <= mEndMins;

                if (inShift && !inMeal) dayScheduled[i]++;
              }
            }
          }
        });

        var dayReqHours = 0;
        var daySchedHours = 0;
        var dayDeficitHours = 0;
        var daySurplusHours = 0;
        var dayMatchedHours = 0;
        var dayIntervalsData = [];

        for (var j = 0; j < numIntervals; j++) {
          var rVal = dayRequired[j];
          var sVal = dayScheduled[j];
          var variance = sVal - rVal;
          var covPct = rVal > 0 ? (sVal / rVal) * 100 : 100;

          dayReqHours += (rVal * intervalHours);
          daySchedHours += (sVal * intervalHours);

          if (variance < 0) {
            dayDeficitHours += (Math.abs(variance) * intervalHours);
          } else {
            daySurplusHours += (variance * intervalHours);
          }
          dayMatchedHours += (Math.min(rVal, sVal) * intervalHours);

          var status = 'Optimal';
          if (variance < 0) status = 'Deficit';
          else if (variance > 4) status = 'Surplus';

          dayIntervalsData.push({
            interval: UIState.intervals[j].interval,
            volume: Math.round(UIState.intervals[j].volume * factor),
            required: rVal,
            scheduled: sVal,
            variance: variance,
            coveragePct: covPct,
            status: status
          });
        }

        var dayMatchPct = dayReqHours > 0 ? (dayMatchedHours / dayReqHours) * 100 : 100;

        dailyCoverage.push({
          dayIndex: day,
          dayName: DAY_NAMES[day],
          requiredHours: dayReqHours,
          scheduledHours: daySchedHours,
          deficitHours: dayDeficitHours,
          surplusHours: daySurplusHours,
          matchPct: dayMatchPct,
          intervals: dayIntervalsData
        });
      }

      UIState.dailyCoverage = dailyCoverage;
      renderCoverageForActiveDay();
    }

    // --- Feasibility Diagnostics Rendering ---
    function renderDiagnostics() {
      if (!boxBottleneckDiagnostics || !listBottleneckItems) return;
      var bottlenecks = (UIState.auditResults && UIState.auditResults.bottlenecks) ? UIState.auditResults.bottlenecks : [];

      if (bottlenecks.length === 0) {
        boxBottleneckDiagnostics.style.display = 'none';
        return;
      }

      boxBottleneckDiagnostics.style.display = 'block';
      listBottleneckItems.innerHTML = '';

      bottlenecks.forEach(function(bn) {
        var reasons = [];
        if (bn.blockedReasons.rest > 0) reasons.push('11h Rest: ' + bn.blockedReasons.rest);
        if (bn.blockedReasons.weeklyHours > 0) reasons.push('Max Wk Hrs: ' + bn.blockedReasons.weeklyHours);
        if (bn.blockedReasons.consecutiveDays > 0) reasons.push('Consec Days: ' + bn.blockedReasons.consecutiveDays);
        if (bn.blockedReasons.unavailable > 0) reasons.push('Unavailable: ' + bn.blockedReasons.unavailable);

        var tag = document.createElement('div');
        tag.className = 'reason-tag';
        tag.innerHTML = '<strong class="text-warn">' + bn.day + ' ' + bn.interval + '</strong>: Deficit of ' + bn.unmetDeficit + ' agents (' + reasons.join(', ') + ')';
        listBottleneckItems.appendChild(tag);
      });
    }

    if (btnDismissDiagnostics && boxBottleneckDiagnostics) {
      btnDismissDiagnostics.addEventListener('click', function() {
        boxBottleneckDiagnostics.style.display = 'none';
      });
    }

    // --- Coverage For Active Day Rendering ---
    function renderCoverageForActiveDay() {
      if (!UIState.dailyCoverage || UIState.dailyCoverage.length === 0) return;
      var dayCov = UIState.dailyCoverage[UIState.activeCoverageDayIndex] || UIState.dailyCoverage[0];
      if (!dayCov) return;

      if (labelActiveCoverageDay) labelActiveCoverageDay.textContent = dayCov.dayName;

      if (covReqHours) covReqHours.textContent = Math.round(dayCov.requiredHours) + ' hrs';
      if (covSchedHours) covSchedHours.textContent = Math.round(dayCov.scheduledHours) + ' hrs';
      if (covMatchPct) covMatchPct.textContent = dayCov.matchPct.toFixed(1) + '%';
      if (covMatchStatus) {
        covMatchStatus.innerHTML = dayCov.matchPct >= 95 ? '<span class="badge badge-success">Optimal Alignment</span>' : '<span class="badge badge-warn">Coverage Variance</span>';
      }
      if (covDeficitHours) covDeficitHours.textContent = dayCov.deficitHours.toFixed(1) + ' hrs';
      if (covSurplusHours) covSurplusHours.textContent = dayCov.surplusHours.toFixed(1) + ' hrs';

      // Render Day Table
      if (tbodyCoverageDetails) {
        tbodyCoverageDetails.innerHTML = '';
        dayCov.intervals.forEach(function(c) {
          var tr = document.createElement('tr');
          var badgeCls = c.status === 'Optimal' ? 'badge-success' : (c.status === 'Deficit' ? 'badge-danger' : 'badge-warn');
          var varColor = c.variance < 0 ? 'text-danger' : (c.variance > 0 ? 'text-accent' : 'text-success');

          tr.innerHTML = 
            '<td class="mono"><strong>' + c.interval + '</strong></td>' +
            '<td class="mono">' + (typeof ErlanglyUtils !== 'undefined' ? ErlanglyUtils.formatNumber(c.volume) : c.volume) + '</td>' +
            '<td class="mono">' + c.required + '</td>' +
            '<td class="mono text-accent"><strong>' + c.scheduled + '</strong></td>' +
            '<td class="mono ' + varColor + '">' + (c.variance > 0 ? '+' : '') + c.variance + '</td>' +
            '<td class="mono">' + c.coveragePct.toFixed(0) + '%</td>' +
            '<td><span class="badge ' + badgeCls + '">' + c.status + '</span></td>';

          tbodyCoverageDetails.appendChild(tr);
        });
      }

      // Render Chart
      renderCoverageChart(dayCov);
    }

    function renderCoverageChart(dayCov) {
      var canvas = document.getElementById('chart-coverage');
      if (!canvas || typeof Chart === 'undefined') return;

      var labels = dayCov.intervals.map(function(c) { return c.interval; });
      var reqData = dayCov.intervals.map(function(c) { return c.required; });
      var schedData = dayCov.intervals.map(function(c) { return c.scheduled; });

      if (UIState.chart) {
        UIState.chart.data.labels = labels;
        UIState.chart.data.datasets[0].data = reqData;
        UIState.chart.data.datasets[1].data = schedData;
        UIState.chart.update();
        return;
      }

      var ctx = canvas.getContext('2d');
      UIState.chart = new Chart(ctx, {
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

    // --- Day Selector Buttons ---
    if (daySelectorContainer) {
      daySelectorContainer.querySelectorAll('.day-selector-pill').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          daySelectorContainer.querySelectorAll('.day-selector-pill').forEach(function(b) { b.classList.remove('active'); });
          e.currentTarget.classList.add('active');
          UIState.activeCoverageDayIndex = parseInt(e.currentTarget.getAttribute('data-day'), 10) || 0;
          renderCoverageForActiveDay();
        });
      });
    }

    // --- Agent Roster Manager Modal ---
    function openAgentModal() {
      if (!modalAgentManager || !tbodyAgentsList) return;
      tbodyAgentsList.innerHTML = '';

      UIState.agents.forEach(function(agent, idx) {
        var tr = document.createElement('tr');
        var availText = agent.availability ? agent.availability.filter(function(a) { return a.available; }).map(function(a) { return DAY_NAMES[a.day].substring(0, 3); }).join(', ') : 'All Days';

        tr.innerHTML = 
          '<td class="mono text-accent"><strong>' + agent.id + '</strong></td>' +
          '<td><input type="text" class="form-control mono agent-name-input" data-idx="' + idx + '" value="' + agent.name + '" style="height: 26px; font-size: 11px;"></td>' +
          '<td><select class="form-control mono agent-contract-select" data-idx="' + idx + '" style="height: 26px; font-size: 11px;"><option value="FT"' + (agent.contractType === 'FT' ? ' selected' : '') + '>FT (40h)</option><option value="PT"' + (agent.contractType === 'PT' ? ' selected' : '') + '>PT (20h)</option></select></td>' +
          '<td><input type="number" class="form-control mono agent-hours-input" data-idx="' + idx + '" value="' + agent.targetWeeklyHours + '" style="height: 26px; font-size: 11px; width: 65px;"></td>' +
          '<td class="mono" style="font-size: 10.5px; color: var(--text-secondary);">' + availText + '</td>' +
          '<td><select class="form-control mono agent-pref-select" data-idx="' + idx + '" style="height: 26px; font-size: 11px;">' + UIState.shifts.map(function(s) { return '<option value="' + s.id + '"' + (agent.preferredShift === s.id ? ' selected' : '') + '>' + s.id + ' (' + s.start + ')</option>'; }).join('') + '</select></td>' +
          '<td><button class="btn btn-ghost btn-sm btn-del-agent" data-idx="' + idx + '" style="color: var(--danger); padding: 0 4px;">✕</button></td>';

        tbodyAgentsList.appendChild(tr);
      });

      // Wire row edit listeners
      document.querySelectorAll('.agent-name-input').forEach(function(inp) {
        inp.addEventListener('change', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          if (UIState.agents[idx]) UIState.agents[idx].name = e.currentTarget.value;
        });
      });

      document.querySelectorAll('.agent-contract-select').forEach(function(sel) {
        sel.addEventListener('change', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          if (UIState.agents[idx]) {
            UIState.agents[idx].contractType = e.currentTarget.value;
            UIState.agents[idx].targetWeeklyHours = e.currentTarget.value === 'FT' ? 40.0 : 20.0;
          }
        });
      });

      document.querySelectorAll('.agent-hours-input').forEach(function(inp) {
        inp.addEventListener('change', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          if (UIState.agents[idx]) UIState.agents[idx].targetWeeklyHours = parseFloat(e.currentTarget.value) || 40.0;
        });
      });

      document.querySelectorAll('.agent-pref-select').forEach(function(sel) {
        sel.addEventListener('change', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          if (UIState.agents[idx]) UIState.agents[idx].preferredShift = e.currentTarget.value;
        });
      });

      document.querySelectorAll('.btn-del-agent').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          UIState.agents.splice(idx, 1);
          UIState.allocatedHeadcount = UIState.agents.length;
          if (numAllocHeadcount) numAllocHeadcount.value = UIState.allocatedHeadcount;
          openAgentModal();
        });
      });

      modalAgentManager.style.display = 'flex';
    }

    if (btnManageAgents) btnManageAgents.addEventListener('click', openAgentModal);
    if (btnCloseAgentModal) btnCloseAgentModal.addEventListener('click', function() { modalAgentManager.style.display = 'none'; });

    if (btnModalSaveClose) {
      btnModalSaveClose.addEventListener('click', function() {
        modalAgentManager.style.display = 'none';
        executeRosterOptimization();
        if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Saved agent roster and updated allocation', 'success');
      });
    }

    if (btnModalAddAgent) {
      btnModalAddAgent.addEventListener('click', function() {
        var newId = 'AG-' + (UIState.agents.length + 1);
        UIState.agents.push({
          id: newId,
          name: 'New Agent',
          contractType: 'FT',
          targetWeeklyHours: 40.0,
          maxDailyHours: 10.0,
          maxWeeklyHours: 40.0,
          minRestHours: 11.0,
          maxConsecutiveDays: 6,
          preferredShift: 'S1',
          availability: [
            { day: 0, available: true, start: '07:00', end: '21:00' },
            { day: 1, available: true, start: '07:00', end: '21:00' },
            { day: 2, available: true, start: '07:00', end: '21:00' },
            { day: 3, available: true, start: '07:00', end: '21:00' },
            { day: 4, available: true, start: '07:00', end: '21:00' },
            { day: 5, available: false, start: '', end: '' },
            { day: 6, available: false, start: '', end: '' }
          ]
        });
        UIState.allocatedHeadcount = UIState.agents.length;
        if (numAllocHeadcount) numAllocHeadcount.value = UIState.allocatedHeadcount;
        openAgentModal();
      });
    }

    if (btnModalGenFte) {
      btnModalGenFte.addEventListener('click', function() {
        UIState.agents = generateRosterFromFte({
          totalBodies: UIState.allocatedHeadcount,
          ptMix: UIState.ptMix,
          ftWeeklyHours: UIState.workWeekHours,
          ptWeeklyHours: UIState.ptHours,
          globalRules: UIState.globalRules,
          operatingDays: UIState.operatingDays
        });
        openAgentModal();
        if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Regenerated roster from FTE parameters', 'success');
      });
    }

    // --- CSV Upload Handler for Agent Availability ---
    if (inputUploadAgentCsv) {
      inputUploadAgentCsv.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(evt) {
          var text = evt.target.result;
          var lines = text.split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
          if (lines.length <= 1) {
            if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Uploaded CSV file is empty', 'error');
            return;
          }

          var agentsMap = {};
          for (var i = 1; i < lines.length; i++) {
            var cols = lines[i].split(',').map(function(c) { return c.trim().replace(/^"|"$/g, ''); });
            if (cols.length >= 3) {
              var aId = cols[0];
              if (!agentsMap[aId]) {
                agentsMap[aId] = {
                  id: aId,
                  name: cols[1] || aId,
                  contractType: cols[2] || 'FT',
                  preferredShift: cols[6] || 'S1',
                  targetWeeklyHours: cols[2] === 'PT' ? 20.0 : 40.0,
                  maxDailyHours: parseFloat(cols[7]) || 10.0,
                  maxWeeklyHours: parseFloat(cols[8]) || 40.0,
                  minRestHours: parseFloat(cols[9]) || 11.0,
                  maxConsecutiveDays: parseInt(cols[10], 10) || 6,
                  availability: new Array(7).fill(null).map(function(_, dIdx) {
                    return { day: dIdx, available: true, start: '07:00', end: '21:00' };
                  })
                };
              }

              var dayName = (cols[3] || '').toLowerCase();
              var dIdx = -1;
              DAY_NAMES.forEach(function(dn, idx) {
                if (dn.toLowerCase() === dayName || dn.toLowerCase().substring(0, 3) === dayName) dIdx = idx;
              });

              if (dIdx >= 0) {
                var isOff = cols[4] === 'OFF' || cols[5] === 'OFF';
                agentsMap[aId].availability[dIdx] = {
                  day: dIdx,
                  available: !isOff,
                  start: isOff ? '' : (cols[4] || '07:00'),
                  end: isOff ? '' : (cols[5] || '21:00')
                };
              }
            }
          }

          var parsedAgents = Object.values(agentsMap);
          if (parsedAgents.length > 0) {
            UIState.agents = parsedAgents;
            UIState.allocatedHeadcount = parsedAgents.length;
            if (numAllocHeadcount) numAllocHeadcount.value = parsedAgents.length;
            openAgentModal();
            if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Imported ' + parsedAgents.length + ' agents from CSV', 'success');
          }
        };
        reader.readAsText(file);
      });
    }

    // --- Action Buttons ---
    if (btnDownloadAgentTemplate) {
      btnDownloadAgentTemplate.addEventListener('click', function() {
        downloadAgentAvailabilityTemplate();
      });
    }

    if (btnRunRosterOptimizer) {
      btnRunRosterOptimizer.addEventListener('click', function() {
        executeRosterOptimization();
        if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Optimized workforce roster and labor compliance', 'success');
      });
    }

    if (btnResetRoster) {
      btnResetRoster.addEventListener('click', function() {
        executeRosterOptimization();
        if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Reset manual edits and re-optimized', 'info');
      });
    }

    if (btnAddShift) {
      btnAddShift.addEventListener('click', function() {
        var shiftNum = UIState.shifts.length + 1;
        var newShiftId = 'S' + shiftNum;
        var breakInfo = getBreakRulesForLength(8.5);

        UIState.shifts.push({
          id: newShiftId,
          name: 'Custom Shift ' + newShiftId,
          type: 'FT',
          start: '12:00',
          lengthHours: 8.5,
          mealStart: '16:00',
          mealMins: breakInfo.mealMins,
          paidHours: breakInfo.paidHours
        });
        renderShiftPatternsTable();
        executeRosterOptimization();
      });
    }

    // --- Export CSV Buttons ---
    if (btnExportRosterCSV) {
      btnExportRosterCSV.addEventListener('click', function() {
        var shiftsById = {};
        UIState.shifts.forEach(function(s) { shiftsById[s.id] = s; });
        var res = exportAgentRosterCSV(UIState.rosterAssignments, UIState.agents, shiftsById, UIState.auditResults);
        if (typeof ErlanglyUtils !== 'undefined') {
          ErlanglyUtils.exportCSV('weekly_agent_roster_schedule.csv', res.headers, res.rows);
        }
      });
    }

    if (btnExportScheduleCSV) {
      btnExportScheduleCSV.addEventListener('click', function() {
        var dayCov = UIState.dailyCoverage[UIState.activeCoverageDayIndex] || UIState.dailyCoverage[0];
        if (!dayCov) return;
        var headers = ['Day', 'Interval', 'Volume', 'Required_Headcount', 'Scheduled_Headcount', 'Variance', 'Coverage_Pct', 'Status'];
        var rows = dayCov.intervals.map(function(c) {
          return [
            dayCov.dayName,
            c.interval,
            c.volume,
            c.required,
            c.scheduled,
            c.variance,
            c.coveragePct.toFixed(1) + '%',
            c.status
          ];
        });
        if (typeof ErlanglyUtils !== 'undefined') {
          ErlanglyUtils.exportCSV('interval_coverage_' + dayCov.dayName.toLowerCase() + '.csv', headers, rows);
        }
      });
    }

    if (btnExportFteCSV) {
      btnExportFteCSV.addEventListener('click', function() {
        var headers = ['Day_Of_Week', 'Total_Volume', 'Peak_Erlangs', 'Net_Productive_Hours', 'Gross_Paid_Hours', 'Base_FTE', 'Gross_FTE'];
        var rows = computeFteBreakdown().map(function(d) {
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
        if (typeof ErlanglyUtils !== 'undefined') {
          ErlanglyUtils.exportCSV('fte_workforce_breakdown.csv', headers, rows);
        }
      });
    }

    // Input listeners for FTE parameters
    if (numWorkWeek) {
      [numWorkWeek, numPtMix, numPtHours, numFteShrinkage, selectOperatingDays].forEach(function(el) {
        if (!el) return;
        el.addEventListener('input', calculateFTE);
        el.addEventListener('change', calculateFTE);
      });
    }

    if (btnRecalcFte) {
      btnRecalcFte.addEventListener('click', function() {
        calculateFTE();
        if (typeof ErlanglyUtils !== 'undefined') ErlanglyUtils.showToast('Recalculated FTE staffing requirements', 'success');
      });
    }

    // Check Incoming Handoff
    checkIncomingHandoff();

    // Initial Execution
    calculateFTE();
    renderShiftPatternsTable();
    executeRosterOptimization();
  }

  // --- Incoming Handoff Handler ---
  function checkIncomingHandoff() {
    if (typeof window === 'undefined') return;
    var params = new URLSearchParams(window.location.search);
    var schedHandoffBanner = document.getElementById('sched-handoff-banner');
    var schedHandoffText = document.getElementById('sched-handoff-text');
    var btnDismissSchedHandoff = document.getElementById('btn-dismiss-sched-handoff');
    var numFteShrinkage = document.getElementById('num-fte-shrinkage');

    if (params.get('shared') === '1' && window.ERLANGLY_SHARED_DATA) {
      var sd = window.ERLANGLY_SHARED_DATA;
      if (sd.intervals && sd.intervals.length > 0) {
        UIState.intervals = sd.intervals;
        if (sd.intervalLength) UIState.intervalLength = sd.intervalLength;
        if (sd.targetSLA) UIState.targetSLA = sd.targetSLA;
        if (sd.shrinkage !== undefined) {
          UIState.shrinkage = sd.shrinkage;
          if (numFteShrinkage) numFteShrinkage.value = Math.round(sd.shrinkage * 100);
        }
        if (schedHandoffBanner && schedHandoffText) {
          schedHandoffBanner.style.display = 'flex';
          schedHandoffText.textContent = 'Shared plan loaded: ' + sd.intervals.length + ' staffing intervals restored.';
        }
      }
      return;
    }

    var from = params.get('from');
    if (from === 'capacity' && typeof ErlanglyUtils !== 'undefined') {
      var handoff = ErlanglyUtils.getHandoff('scheduling');
      if (handoff && handoff.intervals && handoff.intervals.length > 0) {
        UIState.intervals = handoff.intervals;
        if (handoff.intervalLength) UIState.intervalLength = handoff.intervalLength;
        if (handoff.targetSLA) UIState.targetSLA = handoff.targetSLA;
        if (handoff.shrinkage) {
          UIState.shrinkage = handoff.shrinkage;
          if (numFteShrinkage) numFteShrinkage.value = Math.round(handoff.shrinkage * 100);
        }
        if (schedHandoffBanner && schedHandoffText) {
          schedHandoffBanner.style.display = 'flex';
          schedHandoffText.textContent = 'Imported ' + handoff.intervals.length + ' staffing requirement intervals from Capacity Planning.';
        }
      }
    } else if (from === 'plans' && typeof ErlanglyUtils !== 'undefined') {
      var planHandoff = ErlanglyUtils.getHandoff('scheduling');
      if (planHandoff && planHandoff.intervals && planHandoff.intervals.length > 0) {
        UIState.intervals = planHandoff.intervals;
        if (planHandoff.intervalLength) UIState.intervalLength = planHandoff.intervalLength;
        if (planHandoff.targetSLA) UIState.targetSLA = planHandoff.targetSLA;
        if (planHandoff.shrinkage !== undefined) {
          UIState.shrinkage = planHandoff.shrinkage;
          if (numFteShrinkage) numFteShrinkage.value = Math.round(planHandoff.shrinkage * 100);
        }
        if (schedHandoffBanner && schedHandoffText) {
          schedHandoffBanner.style.display = 'flex';
          schedHandoffText.textContent = 'Scheduling plan restored from My Plans.';
        }
      }
    }

    if (btnDismissSchedHandoff && schedHandoffBanner) {
      btnDismissSchedHandoff.addEventListener('click', function() {
        schedHandoffBanner.style.display = 'none';
      });
    }
  }

  // Auto-init in browser
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      initUI();
    }
  }

  // Export module for testing and programmatic use
  return {
    DEFAULT_INTERVALS: DEFAULT_INTERVALS,
    DEFAULT_SHIFTS: DEFAULT_SHIFTS,
    DEFAULT_LABOR_RULES: DEFAULT_LABOR_RULES,
    DAY_NAMES: DAY_NAMES,
    DAY_FACTORS: DAY_FACTORS,
    parseTimeToMins: parseTimeToMins,
    formatMinsToTime: formatMinsToTime,
    computeRestPeriod: computeRestPeriod,
    getBreakRulesForLength: getBreakRulesForLength,
    generateRosterFromFte: generateRosterFromFte,
    checkShiftCompliance: checkShiftCompliance,
    auditRoster: auditRoster,
    optimizeRoster: optimizeRoster,
    exportAgentRosterCSV: exportAgentRosterCSV,
    downloadAgentAvailabilityTemplate: downloadAgentAvailabilityTemplate
  };
}));
