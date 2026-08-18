/**
 * Erlangly Core Math Engine (js/erlang.js)
 * 
 * Pure numerical queueing library implementing Erlang B, Erlang C,
 * Service Level (SLA), Average Speed of Answer (ASA), Occupancy,
 * Shrinkage adjustment, and Headcount Requirement Solver.
 * 
 * Follows AGENTS.md rules:
 * - Single source of truth for all staffing math across all tools
 * - Pure functions, no DOM access, no external state
 * - Numerically stable iterative algorithms (prevents factorial overflow)
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Erlangly = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var Erlangly = {};

  /**
   * Calculate Traffic Intensity (Workload in Erlangs)
   * Formula: A = (Volume * AHT) / IntervalSeconds
   *
   * @param {number} volume - Call or interaction volume in the interval
   * @param {number} aht - Average Handle Time in seconds
   * @param {number} intervalSeconds - Interval duration in seconds (e.g. 900 for 15m, 1800 for 30m, 3600 for 1h)
   * @returns {number} Traffic intensity A in Erlangs
   */
  Erlangly.trafficIntensity = function(volume, aht, intervalSeconds) {
    if (typeof volume !== 'number' || typeof aht !== 'number' || typeof intervalSeconds !== 'number') {
      return 0;
    }
    if (volume <= 0 || aht <= 0 || intervalSeconds <= 0 || isNaN(volume) || isNaN(aht) || isNaN(intervalSeconds)) {
      return 0;
    }
    return (volume * aht) / intervalSeconds;
  };

  /**
   * Erlang B Formula (Loss model - M/M/m/m)
   * Computes blocking probability using numerically stable iterative recursion:
   * B(0, A) = 1
   * B(k, A) = (A * B(k-1, A)) / (k + A * B(k-1, A))
   *
   * @param {number} traffic - Traffic intensity in Erlangs (A)
   * @param {number} servers - Number of agents / channels (m)
   * @returns {number} Probability of blocking [0, 1]
   */
  Erlangly.erlangB = function(traffic, servers) {
    if (traffic <= 0) return 0;
    if (servers <= 0) return 1;

    var m = Math.floor(servers);
    var b = 1.0;

    for (var k = 1; k <= m; k++) {
      b = (traffic * b) / (k + traffic * b);
    }

    return Math.max(0, Math.min(1, b));
  };

  /**
   * Erlang C Formula (Delay model - M/M/m)
   * Computes probability of an incoming caller having to wait in queue: P(Wait > 0)
   * Formula: C(m, A) = B(m, A) / (1 - (A / m) * (1 - B(m, A)))
   * 
   * Stability condition: m > A.
   * If m <= A, the queue is unstable / overloaded, so P(Wait > 0) = 1.0.
   *
   * @param {number} traffic - Traffic intensity in Erlangs (A)
   * @param {number} servers - Number of agents (m)
   * @returns {number} Probability of waiting Pw [0, 1]
   */
  Erlangly.erlangC = function(traffic, servers) {
    if (traffic <= 0) return 0.0;
    if (servers <= 0) return 1.0;

    var m = Math.floor(servers);
    if (m <= traffic) {
      return 1.0; // Unstable queue
    }

    var b = Erlangly.erlangB(traffic, m);
    var rho = traffic / m;
    var denominator = 1.0 - rho * (1.0 - b);

    if (denominator <= 0) {
      return 1.0;
    }

    var pw = b / denominator;
    return Math.max(0.0, Math.min(1.0, pw));
  };

  /**
   * Service Level (SLA) Formula
   * Fraction of calls answered within target threshold time T.
   * Formula: SL(T) = 1 - Pw * exp(-(m - A) * (T / AHT))
   *
   * @param {number} traffic - Traffic intensity in Erlangs (A)
   * @param {number} servers - Number of agents (m)
   * @param {number} aht - Average handle time in seconds
   * @param {number} targetTimeSeconds - Target answer threshold (e.g. 20s)
   * @returns {number} Service level fraction [0, 1] (e.g. 0.80 = 80%)
   */
  Erlangly.serviceLevel = function(traffic, servers, aht, targetTimeSeconds) {
    if (traffic <= 0) return 1.0;
    if (servers <= traffic) return 0.0;
    if (aht <= 0) return 1.0;

    var targetT = typeof targetTimeSeconds === 'number' && targetTimeSeconds >= 0 ? targetTimeSeconds : 20;
    var pw = Erlangly.erlangC(traffic, servers);
    var exponent = -1.0 * (servers - traffic) * (targetT / aht);
    var sl = 1.0 - pw * Math.exp(exponent);

    return Math.max(0.0, Math.min(1.0, sl));
  };

  /**
   * Average Speed of Answer (ASA)
   * Expected wait time in queue across ALL incoming interactions (in seconds).
   * Formula: ASA = (Pw * AHT) / (m - A)
   *
   * @param {number} traffic - Traffic intensity in Erlangs (A)
   * @param {number} servers - Number of agents (m)
   * @param {number} aht - Average handle time in seconds
   * @returns {number} ASA in seconds (approaches Infinity if m <= traffic)
   */
  Erlangly.averageSpeedOfAnswer = function(traffic, servers, aht) {
    if (traffic <= 0) return 0.0;
    if (servers <= traffic) return Infinity;
    if (aht <= 0) return 0.0;

    var pw = Erlangly.erlangC(traffic, servers);
    var asa = (pw * aht) / (servers - traffic);
    return Math.max(0.0, asa);
  };

  /**
   * Agent Occupancy (Utilization)
   * Fraction of logged-in time agents spend actively handling calls.
   * Formula: Occupancy = Traffic / Servers (A / m)
   *
   * @param {number} traffic - Traffic intensity in Erlangs (A)
   * @param {number} servers - Number of agents (m)
   * @returns {number} Occupancy ratio [0, Infinity)
   */
  Erlangly.occupancy = function(traffic, servers) {
    if (servers <= 0) return traffic > 0 ? Infinity : 0.0;
    if (traffic <= 0) return 0.0;
    return traffic / servers;
  };

  /**
   * Shrinkage Adjustment (Gross Staffing)
   * Converts base productive agents to scheduled/staffed headcount.
   * Formula: Staffed = Base / (1 - ShrinkageFraction)
   *
   * @param {number} baseAgents - Net productive agents required on queue
   * @param {number} shrinkageFraction - Shrinkage percentage as decimal (e.g. 0.30 for 30%)
   * @returns {number} Gross staffed agents required (unrounded)
   */
  Erlangly.shrinkageAdjust = function(baseAgents, shrinkageFraction) {
    if (baseAgents <= 0) return 0;
    var shrinkage = typeof shrinkageFraction === 'number' ? shrinkageFraction : 0;
    if (shrinkage <= 0) return baseAgents;
    if (shrinkage >= 1.0) return Infinity; // 100% shrinkage means infinite staffing
    return baseAgents / (1.0 - shrinkage);
  };

  /**
   * Inverse Shrinkage (Net Productive Staffing from Gross)
   * Formula: Base = Staffed * (1 - ShrinkageFraction)
   *
   * @param {number} staffedAgents - Gross scheduled agents
   * @param {number} shrinkageFraction - Shrinkage decimal
   * @returns {number} Net productive agents
   */
  Erlangly.shrinkageFromStaffed = function(staffedAgents, shrinkageFraction) {
    if (staffedAgents <= 0) return 0;
    var shrinkage = typeof shrinkageFraction === 'number' ? shrinkageFraction : 0;
    if (shrinkage <= 0) return staffedAgents;
    if (shrinkage >= 1.0) return 0;
    return staffedAgents * (1.0 - shrinkage);
  };

  /**
   * Headcount Requirement Solver (agentsRequired)
   * Finds the minimum integer headcount m (m > A) that satisfies both:
   * 1. Service Level >= targetServiceLevel
   * 2. (Optional) Occupancy <= maxOccupancy
   *
   * @param {Object} params
   * @param {number} params.volume - Call volume per interval
   * @param {number} params.aht - Average handle time in seconds
   * @param {number} [params.intervalSeconds=1800] - Interval length in seconds (default 30 min)
   * @param {number} [params.targetServiceLevel=0.80] - Target SLA (e.g. 0.80 for 80%)
   * @param {number} [params.targetTimeSeconds=20] - Target response time (e.g. 20s)
   * @param {number} [params.maxOccupancy=null] - Maximum occupancy ceiling (e.g. 0.85)
   * @param {number} [params.shrinkage=0] - Shrinkage fraction (e.g. 0.30 for 30%)
   * 
   * @returns {Object} Comprehensive calculation results:
   *   - trafficIntensity: Erlangs
   *   - baseAgents: Net productive integer headcount
   *   - staffedAgents: Gross integer headcount after shrinkage
   *   - serviceLevel: Projected SLA fraction [0, 1]
   *   - rawServiceLevel: Unclamped SLA
   *   - asa: Average speed of answer in seconds
   *   - occupancy: Agent occupancy ratio [0, 1]
   *   - isOverloaded: Boolean
   *   - isZeroVolume: Boolean
   */
  Erlangly.agentsRequired = function(params) {
    params = params || {};
    var volume = typeof params.volume === 'number' ? params.volume : 0;
    var aht = typeof params.aht === 'number' ? params.aht : 0;
    var intervalSeconds = typeof params.intervalSeconds === 'number' && params.intervalSeconds > 0 ? params.intervalSeconds : 1800;
    var targetServiceLevel = typeof params.targetServiceLevel === 'number' ? params.targetServiceLevel : 0.80;
    var targetTimeSeconds = typeof params.targetTimeSeconds === 'number' ? params.targetTimeSeconds : 20;
    var maxOccupancy = typeof params.maxOccupancy === 'number' && params.maxOccupancy > 0 ? params.maxOccupancy : null;
    var shrinkage = typeof params.shrinkage === 'number' ? params.shrinkage : 0;

    // Zero volume or zero AHT edge-case
    if (volume <= 0 || aht <= 0) {
      return {
        trafficIntensity: 0,
        baseAgents: 0,
        staffedAgents: 0,
        serviceLevel: 1.0,
        rawServiceLevel: 1.0,
        asa: 0.0,
        occupancy: 0.0,
        isOverloaded: false,
        isZeroVolume: true
      };
    }

    var A = Erlangly.trafficIntensity(volume, aht, intervalSeconds);
    var minServers = Math.floor(A) + 1; // Strict queue stability requirement: m > A
    var m = minServers;
    var maxSearchLimit = minServers + 50000;

    while (m < maxSearchLimit) {
      var sl = Erlangly.serviceLevel(A, m, aht, targetTimeSeconds);
      var occ = Erlangly.occupancy(A, m);

      var meetsSL = sl >= targetServiceLevel;
      var meetsOcc = maxOccupancy === null || occ <= maxOccupancy;

      if (meetsSL && meetsOcc) {
        break;
      }
      m++;
    }

    var finalSL = Erlangly.serviceLevel(A, m, aht, targetTimeSeconds);
    var finalASA = Erlangly.averageSpeedOfAnswer(A, m, aht);
    var finalOcc = Erlangly.occupancy(A, m);
    var grossStaffed = Erlangly.shrinkageAdjust(m, shrinkage);
    var staffedInt = grossStaffed === Infinity ? Infinity : Math.ceil(grossStaffed);

    return {
      trafficIntensity: A,
      baseAgents: m,
      staffedAgents: staffedInt,
      serviceLevel: finalSL,
      rawServiceLevel: finalSL,
      asa: finalASA,
      occupancy: finalOcc,
      isOverloaded: false,
      isZeroVolume: false
    };
  };

  /**
   * Helper: Staffing Sensitivity Curve
   * Generates SL, ASA, and Occupancy for a range of agent counts around the baseline.
   * Useful for charting trade-offs in UI.
   *
   * @param {number} traffic - Traffic intensity in Erlangs
   * @param {number} aht - AHT in seconds
   * @param {number} targetTime - SLA target seconds
   * @param {number} minAgents - Start of agent range
   * @param {number} maxAgents - End of agent range
   * @returns {Array<Object>} Array of { agents, serviceLevel, asa, occupancy }
   */
  Erlangly.sensitivityCurve = function(traffic, aht, targetTime, minAgents, maxAgents) {
    if (traffic <= 0 || minAgents > maxAgents) return [];
    var results = [];
    var start = Math.max(1, Math.floor(minAgents));
    var end = Math.floor(maxAgents);

    for (var n = start; n <= end; n++) {
      results.push({
        agents: n,
        serviceLevel: Erlangly.serviceLevel(traffic, n, aht, targetTime),
        asa: Erlangly.averageSpeedOfAnswer(traffic, n, aht),
        occupancy: Erlangly.occupancy(traffic, n)
      });
    }

    return results;
  };

  /**
   * Multi-Channel & Blended Workload Calculator
   * Aggregates multiple queues/channels (e.g. Inbound Voice, Live Chat, Backoffice Email)
   * into total blended traffic intensity and weighted composite AHT.
   *
   * @param {Array<{volume: number, aht: number}>} queues - List of channel workloads
   * @param {number} [intervalSeconds=1800] - Interval length in seconds
   * @returns {Object} { totalVolume, totalWorkloadSeconds, weightedAHT, totalErlangs }
   */
  Erlangly.blendedWorkload = function(queues, intervalSeconds) {
    if (!Array.isArray(queues) || queues.length === 0) {
      return { totalVolume: 0, totalWorkloadSeconds: 0, weightedAHT: 0, totalErlangs: 0 };
    }
    var intervalSec = typeof intervalSeconds === 'number' && intervalSeconds > 0 ? intervalSeconds : 1800;
    var totalVol = 0;
    var totalWorkloadSec = 0;

    for (var i = 0; i < queues.length; i++) {
      var q = queues[i];
      var v = Math.max(0, typeof q.volume === 'number' ? q.volume : 0);
      var a = Math.max(0, typeof q.aht === 'number' ? q.aht : 0);
      totalVol += v;
      totalWorkloadSec += (v * a);
    }

    var weightedAht = totalVol > 0 ? (totalWorkloadSec / totalVol) : 0;
    var totalErlangs = totalWorkloadSec / intervalSec;

    return {
      totalVolume: totalVol,
      totalWorkloadSeconds: totalWorkloadSec,
      weightedAHT: weightedAht,
      totalErlangs: totalErlangs
    };
  };

  /**
   * Multi-Skill Pooling Efficiency Analysis
   * Compares dedicated/siloed staffing requirements against a blended multi-skilled pool.
   * Demonstrates the Erlang pooling principle: a unified queue requires fewer agents than
   * separate queues for the same target service level.
   *
   * @param {Array<{volume: number, aht: number}>} queues - Individual skill queues
   * @param {number} [targetSLA=0.80] - Target Service Level fraction
   * @param {number} [targetTime=20] - Answer threshold in seconds
   * @param {number} [intervalSec=1800] - Interval seconds
   * @returns {Object} { dedicatedAgents, pooledAgents, headcountSaved, percentEfficiencyGain }
   */
  Erlangly.multiSkillPoolingEfficiency = function(queues, targetSLA, targetTime, intervalSec) {
    if (!Array.isArray(queues) || queues.length === 0) {
      return { dedicatedAgents: 0, pooledAgents: 0, headcountSaved: 0, percentEfficiencyGain: 0 };
    }
    var sla = typeof targetSLA === 'number' ? targetSLA : 0.80;
    var tt = typeof targetTime === 'number' ? targetTime : 20;
    var sec = typeof intervalSec === 'number' ? intervalSec : 1800;

    var sumDedicated = 0;
    for (var i = 0; i < queues.length; i++) {
      var solve = Erlangly.agentsRequired({
        volume: queues[i].volume,
        aht: queues[i].aht,
        intervalSeconds: sec,
        targetServiceLevel: sla,
        targetTimeSeconds: tt
      });
      sumDedicated += solve.baseAgents;
    }

    var blended = Erlangly.blendedWorkload(queues, sec);
    var pooledSolve = Erlangly.agentsRequired({
      volume: blended.totalVolume,
      aht: blended.weightedAHT,
      intervalSeconds: sec,
      targetServiceLevel: sla,
      targetTimeSeconds: tt
    });
    var pooledAgents = pooledSolve.baseAgents;

    var saved = Math.max(0, sumDedicated - pooledAgents);
    var pctGain = sumDedicated > 0 ? (saved / sumDedicated) * 100 : 0;

    return {
      dedicatedAgents: sumDedicated,
      pooledAgents: pooledAgents,
      headcountSaved: saved,
      percentEfficiencyGain: pctGain
    };
  };

  /**
   * Helper: Generate Normalized Diurnal Distribution Weights
   * @param {number} numIntervals - Total intervals in the operating day
   * @param {string|Array<number>} pattern - 'diurnal' | 'uniform' | 'morning' | 'evening' | custom weights
   * @returns {Array<number>} Normalized weights summing to 1.0
   */
  Erlangly.getDistributionWeights = function(numIntervals, pattern) {
    var n = Math.max(1, Math.floor(numIntervals || 24));
    if (Array.isArray(pattern) && pattern.length === n) {
      var sum = pattern.reduce(function(acc, val) { return acc + Math.max(0, val); }, 0);
      return sum > 0 ? pattern.map(function(v) { return Math.max(0, v) / sum; }) : Array(n).fill(1 / n);
    }

    var weights = [];
    var patternType = typeof pattern === 'string' ? pattern.toLowerCase() : 'diurnal';

    for (var i = 0; i < n; i++) {
      var t = i / (n - 1 || 1); // 0.0 to 1.0 across the operating day
      var w = 1.0;

      if (patternType === 'uniform') {
        w = 1.0;
      } else if (patternType === 'morning') {
        // Peak around 25-30% of day
        w = 0.3 + 1.2 * Math.exp(-Math.pow((t - 0.28) / 0.18, 2)) + 0.3 * Math.exp(-Math.pow((t - 0.7) / 0.25, 2));
      } else if (patternType === 'evening') {
        // Peak around 70-75% of day
        w = 0.3 + 0.4 * Math.exp(-Math.pow((t - 0.3) / 0.25, 2)) + 1.2 * Math.exp(-Math.pow((t - 0.72) / 0.18, 2));
      } else {
        // Standard contact center diurnal curve (Twin peaks: morning ~30% and afternoon ~65%)
        w = 0.25 + 0.95 * Math.exp(-Math.pow((t - 0.30) / 0.15, 2)) + 0.85 * Math.exp(-Math.pow((t - 0.65) / 0.16, 2));
      }
      weights.push(Math.max(0.01, w));
    }

    var total = weights.reduce(function(acc, val) { return acc + val; }, 0);
    return weights.map(function(w) { return w / total; });
  };

  /**
   * Daily Staffing Simulator
   * Simulates interval-by-interval staffing needs across an operating day using Erlang C.
   *
   * @param {Object} params
   * @param {number} params.dailyVolume - Total volume for the day
   * @param {number} params.aht - Average handle time in seconds
   * @param {number} [params.operatingHours=12] - Operating hours per day
   * @param {number} [params.intervalMinutes=30] - Interval granularity in minutes (15, 30, 60)
   * @param {string|Array<number>} [params.distribution='diurnal'] - Intraday volume arrival pattern
   * @param {number} [params.targetServiceLevel=0.80] - Target SLA (e.g. 0.80)
   * @param {number} [params.targetTimeSeconds=20] - Answer threshold in seconds
   * @param {number} [params.maxOccupancy=0.85] - Occupancy ceiling
   * @param {number} [params.shrinkage=0.30] - Shrinkage fraction
   * @param {number} [params.workWeekHours=40] - Standard work week hours
   * @param {number} [params.hourlyWage=0] - Hourly loaded labor cost
   * @returns {Object} Daily simulation results and interval breakdown
   */
  Erlangly.simulateDailyProfile = function(params) {
    params = params || {};
    var dailyVol = Math.max(0, typeof params.dailyVolume === 'number' ? params.dailyVolume : 0);
    var aht = Math.max(1, typeof params.aht === 'number' ? params.aht : 180);
    var opHours = Math.max(1, Math.min(24, typeof params.operatingHours === 'number' ? params.operatingHours : 12));
    var intervalMins = Math.max(5, Math.min(120, typeof params.intervalMinutes === 'number' ? params.intervalMinutes : 30));
    var intervalSec = intervalMins * 60;
    var numIntervals = Math.max(1, Math.round((opHours * 60) / intervalMins));
    var sla = typeof params.targetServiceLevel === 'number' ? params.targetServiceLevel : 0.80;
    var targetT = typeof params.targetTimeSeconds === 'number' ? params.targetTimeSeconds : 20;
    var maxOcc = typeof params.maxOccupancy === 'number' ? params.maxOccupancy : 0.85;
    var shrinkage = typeof params.shrinkage === 'number' ? params.shrinkage : 0.30;
    var workWeek = typeof params.workWeekHours === 'number' && params.workWeekHours > 0 ? params.workWeekHours : 40.0;
    var wage = Math.max(0, typeof params.hourlyWage === 'number' ? params.hourlyWage : 0);

    var weights = Erlangly.getDistributionWeights(numIntervals, params.distribution || 'diurnal');
    var intervals = [];
    var totalNetStaffHours = 0;
    var totalGrossStaffHours = 0;
    var peakStaffed = 0;
    var peakBase = 0;
    var peakErlangs = 0;
    var weightedSLSum = 0;
    var weightedOccSum = 0;
    var weightedASASum = 0;

    var startHour = Math.max(0, Math.min(23, typeof params.startHour === 'number' ? params.startHour : (opHours === 24 ? 0 : 8)));

    for (var i = 0; i < numIntervals; i++) {
      var intervalVol = dailyVol * weights[i];
      var solve = Erlangly.agentsRequired({
        volume: intervalVol,
        aht: aht,
        intervalSeconds: intervalSec,
        targetServiceLevel: sla,
        targetTimeSeconds: targetT,
        maxOccupancy: maxOcc,
        shrinkage: shrinkage
      });

      var intervalHours = intervalSec / 3600;
      var netHours = solve.baseAgents * intervalHours;
      var grossHours = (solve.staffedAgents === Infinity ? solve.baseAgents : solve.staffedAgents) * intervalHours;

      totalNetStaffHours += netHours;
      totalGrossStaffHours += grossHours;

      if (solve.staffedAgents > peakStaffed && solve.staffedAgents !== Infinity) {
        peakStaffed = solve.staffedAgents;
      }
      if (solve.baseAgents > peakBase) {
        peakBase = solve.baseAgents;
      }
      if (solve.trafficIntensity > peakErlangs) {
        peakErlangs = solve.trafficIntensity;
      }

      weightedSLSum += solve.serviceLevel * intervalVol;
      weightedOccSum += solve.occupancy * intervalVol;
      weightedASASum += (solve.asa === Infinity ? 0 : solve.asa) * intervalVol;

      // Format time label (e.g. "08:00" or "08:30")
      var minsFromStart = i * intervalMins;
      var curHour = (startHour + Math.floor(minsFromStart / 60)) % 24;
      var curMin = minsFromStart % 60;
      var timeLabel = (curHour < 10 ? '0' : '') + curHour + ':' + (curMin < 10 ? '0' : '') + curMin;

      intervals.push({
        intervalIndex: i,
        time: timeLabel,
        volume: intervalVol,
        weightPct: weights[i] * 100,
        erlangs: solve.trafficIntensity,
        baseAgents: solve.baseAgents,
        staffedAgents: solve.staffedAgents,
        serviceLevel: solve.serviceLevel,
        asa: solve.asa,
        occupancy: solve.occupancy,
        netHours: netHours,
        grossHours: grossHours
      });
    }

    var avgSL = dailyVol > 0 ? (weightedSLSum / dailyVol) : 1.0;
    var avgOcc = dailyVol > 0 ? (weightedOccSum / dailyVol) : 0.0;
    var avgASA = dailyVol > 0 ? (weightedASASum / dailyVol) : 0.0;
    var standardDayHours = workWeek / 5; // e.g. 8h per day for 40h workweek
    var baseFTE = standardDayHours > 0 ? (totalNetStaffHours / standardDayHours) : 0;
    var staffedFTE = standardDayHours > 0 ? (totalGrossStaffHours / standardDayHours) : 0;
    var laborCost = totalGrossStaffHours * wage;

    return {
      dailyVolume: dailyVol,
      aht: aht,
      operatingHours: opHours,
      intervalMinutes: intervalMins,
      numIntervals: numIntervals,
      peakBaseAgents: peakBase,
      peakStaffedAgents: peakStaffed,
      peakErlangs: peakErlangs,
      totalNetStaffHours: totalNetStaffHours,
      totalGrossStaffHours: totalGrossStaffHours,
      baseFTE: baseFTE,
      staffedFTE: staffedFTE,
      averageServiceLevel: avgSL,
      averageOccupancy: avgOcc,
      averageASA: avgASA,
      laborCost: laborCost,
      intervals: intervals
    };
  };

  /**
   * Weekly Staffing Simulator
   * Simulates week-by-week capacity, staffing needs, and daily breakdowns across multiple weeks.
   *
   * @param {Object} params
   * @param {number} params.weeklyVolume - Starting weekly volume
   * @param {number} params.aht - AHT in seconds
   * @param {number} [params.weeks=12] - Number of weeks in horizon (e.g. 4, 8, 12, 26, 52)
   * @param {number} [params.growthRatePct=0] - Volume growth rate per week in %
   * @param {number} [params.ahtDriftPct=0] - AHT drift per week in %
   * @param {number} [params.operatingDays=7] - Operating days per week (5, 6, 7)
   * @param {Array<number>} [params.dayWeights] - Day of week volume weights
   * @param {number} [params.operatingHours=12] - Operating hours per day
   * @param {string} [params.diurnalPattern='diurnal'] - Intraday profile
   * @param {number} [params.targetServiceLevel=0.80] - Target SLA
   * @param {number} [params.targetTimeSeconds=20] - Answer threshold in seconds
   * @param {number} [params.maxOccupancy=0.85] - Occupancy ceiling
   * @param {number} [params.shrinkage=0.30] - Shrinkage fraction
   * @param {number} [params.workWeekHours=40] - Standard work week hours
   * @param {number} [params.hourlyWage=0] - Loaded hourly wage
   * @returns {Object} Weekly simulation results
   */
  Erlangly.simulateWeeklyProfile = function(params) {
    params = params || {};
    var startVol = Math.max(0, typeof params.weeklyVolume === 'number' ? params.weeklyVolume : 35000);
    var startAht = Math.max(1, typeof params.aht === 'number' ? params.aht : 180);
    var weeksCount = Math.max(1, Math.min(104, typeof params.weeks === 'number' ? params.weeks : 12));
    var growthRate = typeof params.growthRatePct === 'number' ? params.growthRatePct / 100 : 0;
    var ahtDrift = typeof params.ahtDriftPct === 'number' ? params.ahtDriftPct / 100 : 0;
    var opDays = Math.max(1, Math.min(7, typeof params.operatingDays === 'number' ? params.operatingDays : 7));
    var workWeek = typeof params.workWeekHours === 'number' && params.workWeekHours > 0 ? params.workWeekHours : 40.0;
    var wage = Math.max(0, typeof params.hourlyWage === 'number' ? params.hourlyWage : 0);

    // Default day of week weights
    var dayWeights = params.dayWeights;
    if (!Array.isArray(dayWeights) || dayWeights.length !== opDays) {
      if (opDays === 7) {
        dayWeights = [0.18, 0.17, 0.16, 0.16, 0.15, 0.10, 0.08]; // Mon to Sun
      } else if (opDays === 6) {
        dayWeights = [0.19, 0.18, 0.18, 0.17, 0.16, 0.12]; // Mon to Sat
      } else {
        dayWeights = [0.22, 0.21, 0.20, 0.20, 0.17]; // Mon to Fri
      }
    }
    var dayWeightSum = dayWeights.reduce(function(a, b) { return a + b; }, 0) || 1;
    var normDayWeights = dayWeights.map(function(w) { return w / dayWeightSum; });

    var DAY_NAMES_7 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var DAY_NAMES_5 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var dayNames = opDays === 7 ? DAY_NAMES_7 : (opDays === 5 ? DAY_NAMES_5 : DAY_NAMES_7.slice(0, opDays));

    var weeks = [];
    var totalPeriodVolume = 0;
    var totalPeriodGrossHours = 0;
    var totalPeriodNetHours = 0;
    var maxStaffedFTE = 0;
    var maxPeakAgents = 0;
    var totalPeriodCost = 0;

    for (var w = 1; w <= weeksCount; w++) {
      var currentVol = startVol * Math.pow(1 + growthRate, w - 1);
      var currentAht = Math.max(1, startAht * Math.pow(1 + ahtDrift, w - 1));

      var dayResults = [];
      var weekNetHours = 0;
      var weekGrossHours = 0;
      var weekPeakAgents = 0;
      var weekPeakErlangs = 0;
      var weekWeightedSL = 0;
      var weekWeightedOcc = 0;

      for (var d = 0; d < opDays; d++) {
        var dayVol = currentVol * normDayWeights[d];
        var daySim = Erlangly.simulateDailyProfile({
          dailyVolume: dayVol,
          aht: currentAht,
          operatingHours: params.operatingHours || 12,
          intervalMinutes: params.intervalMinutes || 30,
          distribution: params.diurnalPattern || 'diurnal',
          targetServiceLevel: params.targetServiceLevel || 0.80,
          targetTimeSeconds: params.targetTimeSeconds || 20,
          maxOccupancy: params.maxOccupancy || 0.85,
          shrinkage: params.shrinkage !== undefined ? params.shrinkage : 0.30,
          workWeekHours: workWeek,
          hourlyWage: wage
        });

        weekNetHours += daySim.totalNetStaffHours;
        weekGrossHours += daySim.totalGrossStaffHours;
        if (daySim.peakStaffedAgents > weekPeakAgents) weekPeakAgents = daySim.peakStaffedAgents;
        if (daySim.peakErlangs > weekPeakErlangs) weekPeakErlangs = daySim.peakErlangs;

        weekWeightedSL += daySim.averageServiceLevel * dayVol;
        weekWeightedOcc += daySim.averageOccupancy * dayVol;

        dayResults.push({
          dayIndex: d,
          dayName: dayNames[d] || ('Day ' + (d + 1)),
          volume: dayVol,
          peakStaffedAgents: daySim.peakStaffedAgents,
          netHours: daySim.totalNetStaffHours,
          grossHours: daySim.totalGrossStaffHours,
          serviceLevel: daySim.averageServiceLevel,
          occupancy: daySim.averageOccupancy
        });
      }

      var weekBaseFTE = workWeek > 0 ? (weekNetHours / workWeek) : 0;
      var weekStaffedFTE = workWeek > 0 ? (weekGrossHours / workWeek) : 0;
      var weekCost = weekGrossHours * wage;
      var weekAvgSL = currentVol > 0 ? (weekWeightedSL / currentVol) : 1.0;
      var weekAvgOcc = currentVol > 0 ? (weekWeightedOcc / currentVol) : 0.0;

      totalPeriodVolume += currentVol;
      totalPeriodGrossHours += weekGrossHours;
      totalPeriodNetHours += weekNetHours;
      totalPeriodCost += weekCost;

      if (weekStaffedFTE > maxStaffedFTE) maxStaffedFTE = weekStaffedFTE;
      if (weekPeakAgents > maxPeakAgents) maxPeakAgents = weekPeakAgents;

      weeks.push({
        weekNumber: w,
        label: 'Week ' + w,
        volume: currentVol,
        aht: currentAht,
        peakAgents: weekPeakAgents,
        peakErlangs: weekPeakErlangs,
        netHours: weekNetHours,
        grossHours: weekGrossHours,
        baseFTE: weekBaseFTE,
        staffedFTE: weekStaffedFTE,
        serviceLevel: weekAvgSL,
        occupancy: weekAvgOcc,
        laborCost: weekCost,
        days: dayResults
      });
    }

    return {
      weeksCount: weeksCount,
      startVolume: startVol,
      startAht: startAht,
      growthRatePct: params.growthRatePct || 0,
      totalVolume: totalPeriodVolume,
      totalGrossHours: totalPeriodGrossHours,
      totalNetHours: totalPeriodNetHours,
      totalLaborCost: totalPeriodCost,
      averageStaffedFTE: weeksCount > 0 ? (weeks.reduce(function(a, b) { return a + b.staffedFTE; }, 0) / weeksCount) : 0,
      peakStaffedFTE: maxStaffedFTE,
      peakConcurrentAgents: maxPeakAgents,
      averageServiceLevel: totalPeriodVolume > 0 ? (weeks.reduce(function(a, b) { return a + b.serviceLevel * b.volume; }, 0) / totalPeriodVolume) : 1.0,
      averageOccupancy: totalPeriodVolume > 0 ? (weeks.reduce(function(a, b) { return a + b.occupancy * b.volume; }, 0) / totalPeriodVolume) : 0.0,
      weeks: weeks
    };
  };

  /**
   * Monthly Staffing Simulator
   * Simulates month-by-month strategic workforce planning, accounting for working days,
   * peak-hour arrival concentration, monthly growth, seasonality, and labor budgets.
   *
   * @param {Object} params
   * @param {number} params.monthlyVolume - Starting monthly volume
   * @param {number} params.aht - AHT in seconds
   * @param {number} [params.months=12] - Number of months (e.g. 3, 6, 12, 24)
   * @param {number} [params.growthRatePct=0] - Volume growth rate per month in %
   * @param {number} [params.ahtDriftPct=0] - AHT drift per month in %
   * @param {Array<number>|number} [params.workingDays=21.75] - Working days per month
   * @param {Array<number>} [params.seasonalityIndices] - Monthly seasonal multipliers
   * @param {number} [params.operatingHours=12] - Operating hours per day
   * @param {number} [params.peakHourFactor=0.105] - Fraction of daily volume in peak hour
   * @param {number} [params.targetServiceLevel=0.80] - Target SLA
   * @param {number} [params.targetTimeSeconds=20] - Answer threshold
   * @param {number} [params.maxOccupancy=0.85] - Occupancy ceiling
   * @param {number} [params.shrinkage=0.30] - Shrinkage fraction
   * @param {number} [params.workWeekHours=40] - Standard work week hours
   * @param {number} [params.hourlyWage=0] - Loaded hourly wage
   * @returns {Object} Monthly simulation results
   */
  Erlangly.simulateMonthlyProfile = function(params) {
    params = params || {};
    var startVol = Math.max(0, typeof params.monthlyVolume === 'number' ? params.monthlyVolume : 150000);
    var startAht = Math.max(1, typeof params.aht === 'number' ? params.aht : 180);
    var monthsCount = Math.max(1, Math.min(60, typeof params.months === 'number' ? params.months : 12));
    var growthRate = typeof params.growthRatePct === 'number' ? params.growthRatePct / 100 : 0;
    var ahtDrift = typeof params.ahtDriftPct === 'number' ? params.ahtDriftPct / 100 : 0;
    var workWeek = typeof params.workWeekHours === 'number' && params.workWeekHours > 0 ? params.workWeekHours : 40.0;
    var wage = Math.max(0, typeof params.hourlyWage === 'number' ? params.hourlyWage : 0);
    var opHours = Math.max(1, Math.min(24, typeof params.operatingHours === 'number' ? params.operatingHours : 12));
    var sla = typeof params.targetServiceLevel === 'number' ? params.targetServiceLevel : 0.80;
    var targetT = typeof params.targetTimeSeconds === 'number' ? params.targetTimeSeconds : 20;
    var maxOcc = typeof params.maxOccupancy === 'number' ? params.maxOccupancy : 0.85;
    var shrinkage = typeof params.shrinkage === 'number' ? params.shrinkage : 0.30;

    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var CALENDAR_WORK_DAYS = [22, 20, 22, 21, 22, 21, 22, 22, 21, 22, 21, 22]; // Standard working days

    var months = [];
    var totalHorizonVolume = 0;
    var totalHorizonGrossHours = 0;
    var totalHorizonNetHours = 0;
    var totalHorizonCost = 0;
    var peakStaffedFTE = 0;
    var peakConcurrentStaff = 0;

    for (var m = 1; m <= monthsCount; m++) {
      var monthIdx = (m - 1) % 12;
      var seasonalFactor = 1.0;
      if (Array.isArray(params.seasonalityIndices) && params.seasonalityIndices[monthIdx] !== undefined) {
        seasonalFactor = Math.max(0.1, params.seasonalityIndices[monthIdx]);
      }

      var workDays = 21.75;
      if (Array.isArray(params.workingDays) && params.workingDays[monthIdx] !== undefined) {
        workDays = Math.max(1, params.workingDays[monthIdx]);
      } else if (typeof params.workingDays === 'number' && params.workingDays > 0) {
        workDays = params.workingDays;
      } else {
        workDays = CALENDAR_WORK_DAYS[monthIdx] || 21.75;
      }

      var currentVol = startVol * Math.pow(1 + growthRate, m - 1) * seasonalFactor;
      var currentAht = Math.max(1, startAht * Math.pow(1 + ahtDrift, m - 1));

      var avgDailyVol = workDays > 0 ? (currentVol / workDays) : 0;

      // Simulate a representative daily profile for this month
      var daySim = Erlangly.simulateDailyProfile({
        dailyVolume: avgDailyVol,
        aht: currentAht,
        operatingHours: opHours,
        intervalMinutes: params.intervalMinutes || 30,
        distribution: params.diurnalPattern || 'diurnal',
        targetServiceLevel: sla,
        targetTimeSeconds: targetT,
        maxOccupancy: maxOcc,
        shrinkage: shrinkage,
        workWeekHours: workWeek,
        hourlyWage: wage
      });

      var monthlyNetHours = daySim.totalNetStaffHours * workDays;
      var monthlyGrossHours = daySim.totalGrossStaffHours * workDays;
      var monthlyLaborCost = monthlyGrossHours * wage;

      // Monthly standard work hours per full-time FTE
      var monthlyHoursPerFTE = workDays * (workWeek / 5);
      var baseFTE = monthlyHoursPerFTE > 0 ? (monthlyNetHours / monthlyHoursPerFTE) : 0;
      var staffedFTE = monthlyHoursPerFTE > 0 ? (monthlyGrossHours / monthlyHoursPerFTE) : 0;

      totalHorizonVolume += currentVol;
      totalHorizonGrossHours += monthlyGrossHours;
      totalHorizonNetHours += monthlyNetHours;
      totalHorizonCost += monthlyLaborCost;

      if (staffedFTE > peakStaffedFTE) peakStaffedFTE = staffedFTE;
      if (daySim.peakStaffedAgents > peakConcurrentStaff) peakConcurrentStaff = daySim.peakStaffedAgents;

      var label = monthsCount <= 12 ? (MONTH_NAMES[monthIdx] || ('M' + m)) : ('M' + m + ' (' + MONTH_NAMES[monthIdx] + ')');

      months.push({
        monthNumber: m,
        monthIndex: monthIdx,
        label: label,
        volume: currentVol,
        aht: currentAht,
        workingDays: workDays,
        dailyVolume: avgDailyVol,
        peakConcurrentAgents: daySim.peakStaffedAgents,
        peakErlangs: daySim.peakErlangs,
        baseFTE: baseFTE,
        staffedFTE: staffedFTE,
        grossHours: monthlyGrossHours,
        netHours: monthlyNetHours,
        serviceLevel: daySim.averageServiceLevel,
        occupancy: daySim.averageOccupancy,
        laborCost: monthlyLaborCost
      });
    }

    return {
      monthsCount: monthsCount,
      startVolume: startVol,
      startAht: startAht,
      growthRatePct: params.growthRatePct || 0,
      totalVolume: totalHorizonVolume,
      totalGrossHours: totalHorizonGrossHours,
      totalNetHours: totalHorizonNetHours,
      totalLaborCost: totalHorizonCost,
      averageStaffedFTE: monthsCount > 0 ? (months.reduce(function(a, b) { return a + b.staffedFTE; }, 0) / monthsCount) : 0,
      peakStaffedFTE: peakStaffedFTE,
      peakConcurrentAgents: peakConcurrentStaff,
      averageServiceLevel: totalHorizonVolume > 0 ? (months.reduce(function(a, b) { return a + b.serviceLevel * b.volume; }, 0) / totalHorizonVolume) : 1.0,
      averageOccupancy: totalHorizonVolume > 0 ? (months.reduce(function(a, b) { return a + b.occupancy * b.volume; }, 0) / totalHorizonVolume) : 0.0,
      months: months
    };
  };

  return Erlangly;
});

