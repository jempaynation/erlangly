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

  return Erlangly;
});

