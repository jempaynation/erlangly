/**
 * Erlangly Workforce Planning Simulator (js/simulator.js)
 * 
 * Features:
 * - Multi-period what-if strategic simulation (Deterministic & Monte Carlo)
 * - Monte Carlo probabilistic iteration engine (Normal & Uniform sampling)
 * - Percentile aggregation (P10, P25, P50, P75, P90, Mean, StdDev)
 * - Confidence band visualizer on Chart.js (P10-P90 & P25-P75 shaded bands + P50 median)
 * - Attrition & hiring ramp with productivity nesting delay
 * - Multi-scenario comparison visualizer
 * - Breach detection (first period SLA drops or budget exceeds)
 * - Plain-language probabilistic executive narrative generator
 * - Plan persistence (Supabase / localStorage) & RFC-4180 CSV export
 */

(function(root) {
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

  var DEFAULT_MC_CONFIG = {
    volSigma: 5.0,        // ±5.0%
    ahtSigma: 4.0,        // ±4.0%
    attritionSigma: 1.0,  // ±1.0%
    hiresSigma: 1,        // ±1 agent
    distribution: 'normal', // 'normal' | 'uniform'
    iterations: 500
  };

  // --- State ---
  var state = {
    mode: 'deterministic', // 'deterministic' | 'montecarlo'
    activeScenarioIdx: 0,
    horizon: 12, // 12 months
    scenarios: JSON.parse(JSON.stringify(DEFAULT_SCENARIOS)),
    simResults: [], // deterministic results per scenario
    monteCarloConfig: JSON.parse(JSON.stringify(DEFAULT_MC_CONFIG)),
    mcResults: null, // Monte Carlo aggregated percentiles for active scenario
    chartMetric: 'sla', // 'sla' | 'requiredStaff' | 'productiveStaff' | 'cost'
    tableViewMode: 'points', // 'points' | 'percentiles'
    chart: null
  };

  // --- Pure Mathematical & Sampling Utilities ---

  /**
   * Sample from a Normal (Gaussian) distribution using Box-Muller transform
   */
  function sampleNormal(mean, stdDev, minVal, maxVal) {
    var u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    var z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    var val = mean + z0 * stdDev;
    if (minVal !== undefined && val < minVal) val = minVal;
    if (maxVal !== undefined && val > maxVal) val = maxVal;
    return val;
  }

  /**
   * Sample from a Uniform distribution between minVal and maxVal
   */
  function sampleUniform(minVal, maxVal) {
    return minVal + Math.random() * (maxVal - minVal);
  }

  /**
   * Calculate percentile value from a pre-sorted numeric array
   */
  function getPercentile(sortedArr, p) {
    if (!sortedArr || sortedArr.length === 0) return 0;
    if (p <= 0) return sortedArr[0];
    if (p >= 100) return sortedArr[sortedArr.length - 1];
    var idx = (p / 100) * (sortedArr.length - 1);
    var low = Math.floor(idx);
    var high = Math.ceil(idx);
    var weight = idx - low;
    return sortedArr[low] * (1 - weight) + sortedArr[high] * weight;
  }

  /**
   * Calculate summary statistics (mean, stdDev)
   */
  function getStats(arr) {
    if (!arr || arr.length === 0) return { mean: 0, stdDev: 0 };
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i];
    }
    var mean = sum / arr.length;
    var varianceSum = 0;
    for (var j = 0; j < arr.length; j++) {
      varianceSum += Math.pow(arr[j] - mean, 2);
    }
    var stdDev = Math.sqrt(varianceSum / arr.length);
    return { mean: mean, stdDev: stdDev };
  }

  // --- Deterministic Multi-Period Simulation ---
  function simulateScenario(sc, horizon) {
    var ErlangEngine = (typeof Erlangly !== 'undefined' && Erlangly) || (typeof require !== 'undefined' ? require('./erlang.js') : null);
    if (!ErlangEngine) throw new Error('Erlangly math engine required');

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
    var monthlyHoursPerAgent = 160; // 21.5 working days * 7.5 net hrs = 160h

    for (var m = 1; m <= horizon; m++) {
      var mVol = sc.startVol * Math.pow(1 + volGrowthFrac, m - 1);
      var mAht = sc.startAht * Math.pow(1 + ahtDriftFrac, m - 1);

      // Workload intensity in peak shift equivalent (30-min interval slice)
      var intervalWorkloadSeconds = (mVol / (22 * 16)) * mAht;
      var erlangs = intervalWorkloadSeconds / 1800;

      // Solve Required Gross Headcount
      var solve = ErlangEngine.agentsRequired({
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

      if (hireCohorts.length > 3) hireCohorts.pop();

      var productiveStaff = Math.round(retainedStaff + productiveFromHires);
      currentStaff = retainedStaff + newHires; // actual headcount on payroll

      // Resulting SLA & Queue Performance
      var netProductiveAgents = Math.max(1, Math.round(productiveStaff * (1.0 - (sc.shrinkage || 0.30))));
      var sl = ErlangEngine.serviceLevel(erlangs, netProductiveAgents, mAht, sc.targetTime || 20);
      var asa = ErlangEngine.averageSpeedOfAnswer(erlangs, netProductiveAgents, mAht);
      var occ = ErlangEngine.occupancy(erlangs, netProductiveAgents);

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

  // --- Monte Carlo Simulation Engine ---

  /**
   * Run Monte Carlo simulation across N iterations with randomized inputs
   */
  function runMonteCarloSimulation(sc, horizon, cfg) {
    var ErlangEngine = (typeof Erlangly !== 'undefined' && Erlangly) || (typeof require !== 'undefined' ? require('./erlang.js') : null);
    if (!ErlangEngine) throw new Error('Erlangly math engine required');

    var N = (cfg && cfg.iterations) || 500;
    var dist = (cfg && cfg.distribution) || 'normal';
    var volSig = (cfg && typeof cfg.volSigma === 'number') ? cfg.volSigma : 5.0;
    var ahtSig = (cfg && typeof cfg.ahtSigma === 'number') ? cfg.ahtSigma : 4.0;
    var attSig = (cfg && typeof cfg.attritionSigma === 'number') ? cfg.attritionSigma : 1.0;
    var hireSig = (cfg && typeof cfg.hiresSigma === 'number') ? cfg.hiresSigma : 1;

    var monthlyHoursPerAgent = 160;

    // Monthly metric distribution bins: arrays of length N for each month m in [1..horizon]
    var monthlySla = [];
    var monthlyReqStaff = [];
    var monthlyProdStaff = [];
    var monthlyAsa = [];
    var monthlyOcc = [];
    var monthlyCost = [];

    for (var mIdx = 0; mIdx < horizon; mIdx++) {
      monthlySla.push([]);
      monthlyReqStaff.push([]);
      monthlyProdStaff.push([]);
      monthlyAsa.push([]);
      monthlyOcc.push([]);
      monthlyCost.push([]);
    }

    var totalSpendRuns = [];
    var avgSlaRuns = [];
    var firstSlaBreachRuns = [];
    var firstBudgetBreachRuns = [];

    // Run N independent iterations
    for (var iter = 0; iter < N; iter++) {
      var currentStaff = sc.startingHeadcount;
      var hireCohorts = [];
      var iterTotalSpend = 0;
      var iterSlaSum = 0;
      var iterFirstSlaBreach = null;
      var iterFirstBudgetBreach = null;

      // Cumulative drift multipliers for this iteration
      var cumVolMult = 1.0;
      var cumAhtMult = 1.0;

      for (var m = 1; m <= horizon; m++) {
        // Draw randomized monthly variations
        var volGrowthRate, ahtDriftRate, attritionRate, monthlyHires;

        if (dist === 'normal') {
          volGrowthRate = sampleNormal(sc.volGrowth, volSig) / 100;
          ahtDriftRate = sampleNormal(sc.ahtDrift, ahtSig) / 100;
          attritionRate = sampleNormal(sc.monthlyAttrition, attSig, 0, 50) / 100;
          monthlyHires = Math.max(0, Math.round(sampleNormal(sc.monthlyHires, hireSig, 0, 200)));
        } else {
          // Uniform
          volGrowthRate = sampleUniform(sc.volGrowth - volSig, sc.volGrowth + volSig) / 100;
          ahtDriftRate = sampleUniform(sc.ahtDrift - ahtSig, sc.ahtDrift + ahtSig) / 100;
          attritionRate = sampleUniform(Math.max(0, sc.monthlyAttrition - attSig), sc.monthlyAttrition + attSig) / 100;
          monthlyHires = Math.max(0, Math.round(sampleUniform(Math.max(0, sc.monthlyHires - hireSig), sc.monthlyHires + hireSig)));
        }

        if (m > 1) {
          cumVolMult *= (1 + volGrowthRate);
          cumAhtMult *= (1 + ahtDriftRate);
        }

        var mVol = Math.max(100, sc.startVol * cumVolMult);
        var mAht = Math.max(10, sc.startAht * cumAhtMult);

        var intervalWorkloadSeconds = (mVol / (22 * 16)) * mAht;
        var erlangs = intervalWorkloadSeconds / 1800;

        var solve = ErlangEngine.agentsRequired({
          volume: (mVol / (22 * 16)),
          aht: mAht,
          intervalSeconds: 1800,
          targetServiceLevel: sc.targetSLA || 0.80,
          shrinkage: sc.shrinkage || 0.30
        });

        var requiredStaff = solve.staffedAgents;
        var retainedStaff = currentStaff * (1.0 - attritionRate);

        hireCohorts.unshift({ count: monthlyHires, age: 0 });

        var productiveFromHires = 0;
        hireCohorts.forEach(function(cohort) {
          var efficiency = 1.0;
          if (sc.nestingLag === 1) {
            if (cohort.age === 0) efficiency = 0.50;
          } else if (sc.nestingLag === 2) {
            if (cohort.age === 0) efficiency = 0.25;
            else if (cohort.age === 1) efficiency = 0.75;
          }
          productiveFromHires += (cohort.count * efficiency);
          cohort.age++;
        });

        if (hireCohorts.length > 3) hireCohorts.pop();

        var productiveStaff = Math.round(retainedStaff + productiveFromHires);
        currentStaff = retainedStaff + monthlyHires;

        var netProductiveAgents = Math.max(1, Math.round(productiveStaff * (1.0 - (sc.shrinkage || 0.30))));
        var sl = ErlangEngine.serviceLevel(erlangs, netProductiveAgents, mAht, sc.targetTime || 20);
        var asa = ErlangEngine.averageSpeedOfAnswer(erlangs, netProductiveAgents, mAht);
        var occ = ErlangEngine.occupancy(erlangs, netProductiveAgents);

        var laborCost = currentStaff * monthlyHoursPerAgent * sc.hourlyRate;
        iterTotalSpend += laborCost;
        iterSlaSum += sl;

        if (sl < (sc.targetSLA || 0.80) && iterFirstSlaBreach === null) {
          iterFirstSlaBreach = m;
        }
        if (laborCost > sc.budgetCap && iterFirstBudgetBreach === null) {
          iterFirstBudgetBreach = m;
        }

        // Store sample in month bucket
        monthlySla[m - 1].push(sl);
        monthlyReqStaff[m - 1].push(requiredStaff);
        monthlyProdStaff[m - 1].push(productiveStaff);
        monthlyAsa[m - 1].push(asa);
        monthlyOcc[m - 1].push(occ);
        monthlyCost[m - 1].push(laborCost);
      }

      totalSpendRuns.push(iterTotalSpend);
      avgSlaRuns.push(iterSlaSum / horizon);
      firstSlaBreachRuns.push(iterFirstSlaBreach);
      firstBudgetBreachRuns.push(iterFirstBudgetBreach);
    }

    // --- Percentile Aggregation Per Month ---
    var periods = [];
    var worstCaseBreachPeriod = null; // first month where P10 SLA < 80%

    for (var pIdx = 0; pIdx < horizon; pIdx++) {
      var sSla = monthlySla[pIdx].slice().sort(function(a, b) { return a - b; });
      var sReq = monthlyReqStaff[pIdx].slice().sort(function(a, b) { return a - b; });
      var sProd = monthlyProdStaff[pIdx].slice().sort(function(a, b) { return a - b; });
      var sAsa = monthlyAsa[pIdx].slice().sort(function(a, b) { return a - b; });
      var sOcc = monthlyOcc[pIdx].slice().sort(function(a, b) { return a - b; });
      var sCost = monthlyCost[pIdx].slice().sort(function(a, b) { return a - b; });

      var slaP10 = getPercentile(sSla, 10);
      var slaP25 = getPercentile(sSla, 25);
      var slaP50 = getPercentile(sSla, 50);
      var slaP75 = getPercentile(sSla, 75);
      var slaP90 = getPercentile(sSla, 90);
      var slaStats = getStats(sSla);

      if (slaP10 < (sc.targetSLA || 0.80) && worstCaseBreachPeriod === null) {
        worstCaseBreachPeriod = pIdx + 1;
      }

      periods.push({
        month: pIdx + 1,
        periodName: 'Month ' + (pIdx + 1),
        sla: {
          p10: slaP10,
          p25: slaP25,
          p50: slaP50,
          p75: slaP75,
          p90: slaP90,
          mean: slaStats.mean,
          stdDev: slaStats.stdDev
        },
        requiredStaff: {
          p10: Math.round(getPercentile(sReq, 10)),
          p25: Math.round(getPercentile(sReq, 25)),
          p50: Math.round(getPercentile(sReq, 50)),
          p75: Math.round(getPercentile(sReq, 75)),
          p90: Math.round(getPercentile(sReq, 90)),
          mean: getStats(sReq).mean,
          stdDev: getStats(sReq).stdDev
        },
        productiveStaff: {
          p10: Math.round(getPercentile(sProd, 10)),
          p25: Math.round(getPercentile(sProd, 25)),
          p50: Math.round(getPercentile(sProd, 50)),
          p75: Math.round(getPercentile(sProd, 75)),
          p90: Math.round(getPercentile(sProd, 90)),
          mean: getStats(sProd).mean,
          stdDev: getStats(sProd).stdDev
        },
        cost: {
          p10: Math.round(getPercentile(sCost, 10)),
          p25: Math.round(getPercentile(sCost, 25)),
          p50: Math.round(getPercentile(sCost, 50)),
          p75: Math.round(getPercentile(sCost, 75)),
          p90: Math.round(getPercentile(sCost, 90)),
          mean: getStats(sCost).mean,
          stdDev: getStats(sCost).stdDev
        },
        asa: {
          p50: getPercentile(sAsa, 50),
          p90: getPercentile(sAsa, 90)
        },
        occupancy: {
          p50: getPercentile(sOcc, 50),
          p90: getPercentile(sOcc, 90)
        }
      });
    }

    var sortedTotalSpend = totalSpendRuns.slice().sort(function(a, b) { return a - b; });
    var sortedAvgSla = avgSlaRuns.slice().sort(function(a, b) { return a - b; });

    // Breach likelihood across all runs
    var slaBreachRunsCount = firstSlaBreachRuns.filter(function(b) { return b !== null; }).length;
    var budgetBreachRunsCount = firstBudgetBreachRuns.filter(function(b) { return b !== null; }).length;

    return {
      scenario: sc,
      config: cfg,
      iterations: N,
      periods: periods,
      medianTotalSpend: getPercentile(sortedTotalSpend, 50),
      totalSpendP10: getPercentile(sortedTotalSpend, 10),
      totalSpendP90: getPercentile(sortedTotalSpend, 90),
      medianAvgSla: getPercentile(sortedAvgSla, 50),
      avgSlaP10: getPercentile(sortedAvgSla, 10),
      avgSlaP90: getPercentile(sortedAvgSla, 90),
      slaBreachProbability: (slaBreachRunsCount / N),
      budgetBreachProbability: (budgetBreachRunsCount / N),
      worstCaseBreachPeriod: worstCaseBreachPeriod,
      endingStaffingP10: periods[horizon - 1].productiveStaff.p10,
      endingStaffingP90: periods[horizon - 1].productiveStaff.p90,
      endingReqStaffP50: periods[horizon - 1].requiredStaff.p50
    };
  }

  // --- Browser DOM Controller ---

  // DOM References
  var btnModeDeterministic, btnModeMonteCarlo, scenarioTabBar, selectSimHorizon;
  var panelDeterministicLevers, panelMonteCarloConfig;
  var activeScenarioNameBadge, btnResetScenario, btnSimulate;
  var inputScenarioName, numBaseVol, numBaseAht, numVolGrowth, numAhtDrift;
  var numStartingHeadcount, numMonthlyAttrition, numMonthlyHires, selectNestingLag;
  var numSimHourlyRate, numBudgetCap;
  var numMcVolSigma, numMcAhtSigma, numMcAttritionSigma, numMcHiresSigma;
  var selectMcDist, selectMcIterations, btnResetMcConfig, btnRunMc;
  var lblScorecardBreach, simBreachText, simBreachSub;
  var lblScorecardBudget, simBudgetBreachText, simBudgetSub;
  var lblScorecardSpend, simTotalSpend, simTotalSpendSub;
  var lblScorecardSla, simAvgSla, simAvgSlaSub;
  var lblScorecardGap, simEndingGap, simGapSub;
  var lblChartTitle, selectChartMetric, boxChartLegend, canvasSimulatorChart;
  var narrativeSummaryText, btnCopyNarrative, lblTableScenarioTitle;
  var btnTableViewPoints, btnTableViewPercentiles, theadSimProjection, tbodySimProjection;
  var btnSaveScenario, btnExportScenarioCSV;

  function initDOM() {
    if (typeof document === 'undefined') return;
    btnModeDeterministic = document.getElementById('btn-mode-deterministic');
    btnModeMonteCarlo = document.getElementById('btn-mode-montecarlo');
    scenarioTabBar = document.getElementById('scenario-tab-bar');
    selectSimHorizon = document.getElementById('select-sim-horizon');

    panelDeterministicLevers = document.getElementById('panel-deterministic-levers');
    panelMonteCarloConfig = document.getElementById('panel-monte-carlo-config');

    activeScenarioNameBadge = document.getElementById('active-scenario-name-badge');
    btnResetScenario = document.getElementById('btn-reset-scenario-levers');
    btnSimulate = document.getElementById('btn-simulate');

    inputScenarioName = document.getElementById('input-scenario-name');
    numBaseVol = document.getElementById('num-base-vol');
    numBaseAht = document.getElementById('num-base-aht');
    numVolGrowth = document.getElementById('num-vol-growth');
    numAhtDrift = document.getElementById('num-aht-drift');
    numStartingHeadcount = document.getElementById('num-starting-headcount');
    numMonthlyAttrition = document.getElementById('num-monthly-attrition');
    numMonthlyHires = document.getElementById('num-monthly-hires');
    selectNestingLag = document.getElementById('select-nesting-lag');
    numSimHourlyRate = document.getElementById('num-sim-hourly-rate');
    numBudgetCap = document.getElementById('num-budget-cap');

    numMcVolSigma = document.getElementById('num-mc-vol-sigma');
    numMcAhtSigma = document.getElementById('num-mc-aht-sigma');
    numMcAttritionSigma = document.getElementById('num-mc-attrition-sigma');
    numMcHiresSigma = document.getElementById('num-mc-hires-sigma');
    selectMcDist = document.getElementById('select-mc-dist');
    selectMcIterations = document.getElementById('select-mc-iterations');
    btnResetMcConfig = document.getElementById('btn-reset-mc-config');
    btnRunMc = document.getElementById('btn-run-mc');

    lblScorecardBreach = document.getElementById('lbl-scorecard-breach');
    simBreachText = document.getElementById('sim-breach-text');
    simBreachSub = document.getElementById('sim-breach-sub');
    lblScorecardBudget = document.getElementById('lbl-scorecard-budget');
    simBudgetBreachText = document.getElementById('sim-budget-breach-text');
    simBudgetSub = document.getElementById('sim-budget-sub');
    lblScorecardSpend = document.getElementById('lbl-scorecard-spend');
    simTotalSpend = document.getElementById('sim-total-spend');
    simTotalSpendSub = document.getElementById('sim-total-spend-sub');
    lblScorecardSla = document.getElementById('lbl-scorecard-sla');
    simAvgSla = document.getElementById('sim-avg-sla');
    simAvgSlaSub = document.getElementById('sim-avg-sla-sub');
    lblScorecardGap = document.getElementById('lbl-scorecard-gap');
    simEndingGap = document.getElementById('sim-ending-gap');
    simGapSub = document.getElementById('sim-gap-sub');

    lblChartTitle = document.getElementById('lbl-chart-title');
    selectChartMetric = document.getElementById('select-chart-metric');
    boxChartLegend = document.getElementById('box-chart-legend');
    canvasSimulatorChart = document.getElementById('chart-simulator-comparison');

    narrativeSummaryText = document.getElementById('narrative-summary-text');
    btnCopyNarrative = document.getElementById('btn-copy-narrative');
    lblTableScenarioTitle = document.getElementById('lbl-table-scenario-title');
    btnTableViewPoints = document.getElementById('btn-table-view-points');
    btnTableViewPercentiles = document.getElementById('btn-table-view-percentiles');
    theadSimProjection = document.getElementById('thead-sim-projection');
    tbodySimProjection = document.getElementById('tbody-sim-projection');

    btnSaveScenario = document.getElementById('btn-save-scenario');
    btnExportScenarioCSV = document.getElementById('btn-export-scenario-csv');
  }

  // --- Incoming Handoff Handler ---
  function checkIncomingHandoff() {
    if (typeof window === 'undefined' || !window.location) return;
    var params = new URLSearchParams(window.location.search);

    if (params.get('shared') === '1' && window.ERLANGLY_SHARED_DATA) {
      var sd = window.ERLANGLY_SHARED_DATA;
      if (sd && typeof sd === 'object') {
        state.scenarios[state.activeScenarioIdx] = Object.assign(state.scenarios[state.activeScenarioIdx], sd);
        if (sd.monteCarloConfig) state.monteCarloConfig = sd.monteCarloConfig;
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
        if (handoff.monteCarloConfig) state.monteCarloConfig = handoff.monteCarloConfig;
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Loaded saved scenario: ' + handoff.name, 'success');
        }
      }
    }
  }

  // --- Initialization ---
  function init() {
    if (typeof document === 'undefined') return;
    initDOM();
    setupEventListeners();
    checkIncomingHandoff();
    loadScenarioForm(state.activeScenarioIdx);
    loadMonteCarloForm();
    runAllSimulations();
  }

  function setupEventListeners() {
    // Mode Switcher (Deterministic vs Monte Carlo)
    if (btnModeDeterministic && btnModeMonteCarlo) {
      btnModeDeterministic.addEventListener('click', function() {
        setEngineMode('deterministic');
      });
      btnModeMonteCarlo.addEventListener('click', function() {
        setEngineMode('montecarlo');
      });
    }

    // Tab Bar
    if (scenarioTabBar) {
      scenarioTabBar.querySelectorAll('button').forEach(function(btn) {
        btn.addEventListener('click', function() {
          scenarioTabBar.querySelectorAll('button').forEach(function(b) { b.className = 'btn btn-sm btn-ghost'; });
          btn.className = 'btn btn-sm btn-primary';
          state.activeScenarioIdx = parseInt(btn.getAttribute('data-scenario'), 10) || 0;
          loadScenarioForm(state.activeScenarioIdx);
          if (state.mode === 'montecarlo') {
            runMonteCarloForActive();
          } else {
            updateActiveScenarioView();
            renderComparisonChart();
            generateExecutiveNarrative();
          }
        });
      });
    }

    if (selectSimHorizon) {
      selectSimHorizon.addEventListener('change', function() {
        state.horizon = parseInt(selectSimHorizon.value, 10) || 12;
        runAllSimulations();
      });
    }

    // Metric selector
    if (selectChartMetric) {
      selectChartMetric.addEventListener('change', function() {
        state.chartMetric = selectChartMetric.value || 'sla';
        renderComparisonChart();
      });
    }

    // Table view mode buttons
    if (btnTableViewPoints && btnTableViewPercentiles) {
      btnTableViewPoints.addEventListener('click', function() {
        state.tableViewMode = 'points';
        btnTableViewPoints.className = 'btn btn-sm btn-primary';
        btnTableViewPercentiles.className = 'btn btn-sm btn-ghost';
        renderActiveTable();
      });
      btnTableViewPercentiles.addEventListener('click', function() {
        state.tableViewMode = 'percentiles';
        btnTableViewPercentiles.className = 'btn btn-sm btn-primary';
        btnTableViewPoints.className = 'btn btn-sm btn-ghost';
        renderActiveTable();
      });
    }

    // Deterministic Form inputs
    var formInputs = [
      inputScenarioName, numBaseVol, numBaseAht, numVolGrowth, numAhtDrift,
      numStartingHeadcount, numMonthlyAttrition, numMonthlyHires,
      selectNestingLag, numSimHourlyRate, numBudgetCap
    ];
    formInputs.forEach(function(input) {
      if (!input) return;
      input.addEventListener('input', function() {
        syncFormToState();
        runAllSimulations();
      });
      input.addEventListener('change', function() {
        syncFormToState();
        runAllSimulations();
      });
    });

    if (btnSimulate) {
      btnSimulate.addEventListener('click', function() {
        syncFormToState();
        runAllSimulations();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Re-ran multi-period scenario simulation', 'success');
        }
      });
    }

    if (btnResetScenario) {
      btnResetScenario.addEventListener('click', function() {
        state.scenarios[state.activeScenarioIdx] = JSON.parse(JSON.stringify(DEFAULT_SCENARIOS[state.activeScenarioIdx]));
        loadScenarioForm(state.activeScenarioIdx);
        runAllSimulations();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Reset scenario levers to defaults', 'info');
        }
      });
    }

    // Monte Carlo Config Inputs
    var mcInputs = [numMcVolSigma, numMcAhtSigma, numMcAttritionSigma, numMcHiresSigma, selectMcDist, selectMcIterations];
    mcInputs.forEach(function(el) {
      if (!el) return;
      el.addEventListener('change', syncMonteCarloForm);
    });

    if (btnRunMc) {
      btnRunMc.addEventListener('click', function() {
        syncMonteCarloForm();
        runMonteCarloForActive();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Executed ' + state.monteCarloConfig.iterations + ' Monte Carlo iterations', 'success');
        }
      });
    }

    if (btnResetMcConfig) {
      btnResetMcConfig.addEventListener('click', function() {
        state.monteCarloConfig = JSON.parse(JSON.stringify(DEFAULT_MC_CONFIG));
        loadMonteCarloForm();
        if (state.mode === 'montecarlo') {
          runMonteCarloForActive();
        }
      });
    }

    // Copy Narrative
    if (btnCopyNarrative) {
      btnCopyNarrative.addEventListener('click', function() {
        if (navigator.clipboard && narrativeSummaryText.textContent) {
          navigator.clipboard.writeText(narrativeSummaryText.textContent).then(function() {
            if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
              ErlanglyUtils.showToast('Copied executive narrative to clipboard!', 'success');
            }
          });
        }
      });
    }

    // Save Scenario
    if (btnSaveScenario) {
      btnSaveScenario.addEventListener('click', function() {
        var current = state.scenarios[state.activeScenarioIdx];
        var res = {
          deterministic: state.simResults[state.activeScenarioIdx],
          monteCarlo: state.mcResults,
          config: {
            horizon: state.horizon,
            monteCarloConfig: state.monteCarloConfig
          }
        };
        if (typeof ErlanglyPlans !== 'undefined') {
          ErlanglyPlans.showSaveModal('simulation', current, res);
        }
      });
    }

    // Export CSV
    if (btnExportScenarioCSV) {
      btnExportScenarioCSV.addEventListener('click', function() {
        if (state.mode === 'montecarlo' && state.mcResults) {
          exportMonteCarloCSV();
        } else {
          exportDeterministicCSV();
        }
      });
    }
  }

  function setEngineMode(mode) {
    state.mode = mode;
    if (mode === 'montecarlo') {
      btnModeMonteCarlo.className = 'btn btn-sm btn-primary';
      btnModeDeterministic.className = 'btn btn-sm btn-ghost';
      panelDeterministicLevers.style.display = 'none';
      panelMonteCarloConfig.style.display = 'flex';
      state.tableViewMode = 'percentiles';
      if (btnTableViewPercentiles && btnTableViewPoints) {
        btnTableViewPercentiles.className = 'btn btn-sm btn-primary';
        btnTableViewPoints.className = 'btn btn-sm btn-ghost';
      }
      runMonteCarloForActive();
    } else {
      btnModeDeterministic.className = 'btn btn-sm btn-primary';
      btnModeMonteCarlo.className = 'btn btn-sm btn-ghost';
      panelDeterministicLevers.style.display = 'flex';
      panelMonteCarloConfig.style.display = 'none';
      state.tableViewMode = 'points';
      if (btnTableViewPercentiles && btnTableViewPoints) {
        btnTableViewPercentiles.className = 'btn btn-sm btn-primary';
        btnTableViewPercentiles.className = 'btn btn-sm btn-ghost';
      }
      updateActiveScenarioView();
      renderComparisonChart();
      generateExecutiveNarrative();
    }
  }

  function loadScenarioForm(idx) {
    var sc = state.scenarios[idx];
    if (!sc) return;

    if (activeScenarioNameBadge) activeScenarioNameBadge.textContent = 'Scenario ' + String.fromCharCode(65 + idx);
    if (lblTableScenarioTitle) lblTableScenarioTitle.textContent = sc.name;

    if (inputScenarioName) inputScenarioName.value = sc.name;
    if (numBaseVol) numBaseVol.value = sc.startVol;
    if (numBaseAht) numBaseAht.value = sc.startAht;
    if (numVolGrowth) numVolGrowth.value = sc.volGrowth;
    if (numAhtDrift) numAhtDrift.value = sc.ahtDrift;
    if (numStartingHeadcount) numStartingHeadcount.value = sc.startingHeadcount;
    if (numMonthlyAttrition) numMonthlyAttrition.value = sc.monthlyAttrition;
    if (numMonthlyHires) numMonthlyHires.value = sc.monthlyHires;
    if (selectNestingLag) selectNestingLag.value = String(sc.nestingLag);
    if (numSimHourlyRate) numSimHourlyRate.value = sc.hourlyRate.toFixed(2);
    if (numBudgetCap) numBudgetCap.value = sc.budgetCap;

    if (scenarioTabBar) {
      var tabBtn = scenarioTabBar.querySelector('button[data-scenario="' + idx + '"]');
      if (tabBtn) {
        tabBtn.textContent = 'Scenario ' + String.fromCharCode(65 + idx) + ': ' + sc.name.substring(0, 16);
      }
    }
  }

  function loadMonteCarloForm() {
    var cfg = state.monteCarloConfig;
    if (numMcVolSigma) numMcVolSigma.value = cfg.volSigma;
    if (numMcAhtSigma) numMcAhtSigma.value = cfg.ahtSigma;
    if (numMcAttritionSigma) numMcAttritionSigma.value = cfg.attritionSigma;
    if (numMcHiresSigma) numMcHiresSigma.value = cfg.hiresSigma;
    if (selectMcDist) selectMcDist.value = cfg.distribution;
    if (selectMcIterations) selectMcIterations.value = String(cfg.iterations);
  }

  function syncFormToState() {
    var sc = state.scenarios[state.activeScenarioIdx];
    if (!sc) return;

    if (inputScenarioName) sc.name = inputScenarioName.value.trim() || ('Scenario ' + String.fromCharCode(65 + state.activeScenarioIdx));
    if (numBaseVol) sc.startVol = Math.max(100, parseFloat(numBaseVol.value) || 45000);
    if (numBaseAht) sc.startAht = Math.max(10, parseFloat(numBaseAht.value) || 210);
    if (numVolGrowth) sc.volGrowth = parseFloat(numVolGrowth.value) || 0;
    if (numAhtDrift) sc.ahtDrift = parseFloat(numAhtDrift.value) || 0;
    if (numStartingHeadcount) sc.startingHeadcount = Math.max(1, parseInt(numStartingHeadcount.value, 10) || 85);
    if (numMonthlyAttrition) sc.monthlyAttrition = Math.max(0, parseFloat(numMonthlyAttrition.value) || 0);
    if (numMonthlyHires) sc.monthlyHires = Math.max(0, parseInt(numMonthlyHires.value, 10) || 0);
    if (selectNestingLag) sc.nestingLag = parseInt(selectNestingLag.value, 10) || 1;
    if (numSimHourlyRate) sc.hourlyRate = Math.max(1, parseFloat(numSimHourlyRate.value) || 25.00);
    if (numBudgetCap) sc.budgetCap = Math.max(1000, parseFloat(numBudgetCap.value) || 380000);

    if (scenarioTabBar) {
      var tabBtn = scenarioTabBar.querySelector('button[data-scenario="' + state.activeScenarioIdx + '"]');
      if (tabBtn) {
        tabBtn.textContent = 'Scenario ' + String.fromCharCode(65 + state.activeScenarioIdx) + ': ' + sc.name.substring(0, 16);
      }
    }
  }

  function syncMonteCarloForm() {
    var cfg = state.monteCarloConfig;
    if (numMcVolSigma) cfg.volSigma = Math.max(0, parseFloat(numMcVolSigma.value) || 5.0);
    if (numMcAhtSigma) cfg.ahtSigma = Math.max(0, parseFloat(numMcAhtSigma.value) || 4.0);
    if (numMcAttritionSigma) cfg.attritionSigma = Math.max(0, parseFloat(numMcAttritionSigma.value) || 1.0);
    if (numMcHiresSigma) cfg.hiresSigma = Math.max(0, parseInt(numMcHiresSigma.value, 10) || 1);
    if (selectMcDist) cfg.distribution = selectMcDist.value || 'normal';
    if (selectMcIterations) cfg.iterations = parseInt(selectMcIterations.value, 10) || 500;
  }

  function runAllSimulations() {
    state.simResults = state.scenarios.map(function(sc) {
      return simulateScenario(sc, state.horizon);
    });

    if (state.mode === 'montecarlo') {
      runMonteCarloForActive();
    } else {
      updateActiveScenarioView();
      renderComparisonChart();
      generateExecutiveNarrative();
    }
  }

  function runMonteCarloForActive() {
    var sc = state.scenarios[state.activeScenarioIdx];
    state.mcResults = runMonteCarloSimulation(sc, state.horizon, state.monteCarloConfig);
    updateActiveScenarioView();
    renderComparisonChart();
    generateExecutiveNarrative();
  }

  // --- View Rendering ---
  function updateActiveScenarioView() {
    var sc = state.scenarios[state.activeScenarioIdx];
    if (lblTableScenarioTitle) lblTableScenarioTitle.textContent = sc.name;

    if (state.mode === 'montecarlo' && state.mcResults) {
      renderMonteCarloScorecards(state.mcResults);
    } else {
      renderDeterministicScorecards(state.simResults[state.activeScenarioIdx]);
    }

    renderActiveTable();
  }

  function renderDeterministicScorecards(res) {
    if (!res) return;

    if (lblScorecardBreach) lblScorecardBreach.textContent = 'First SLA Breach';
    if (lblScorecardBudget) lblScorecardBudget.textContent = 'Budget Breach';
    if (lblScorecardSpend) lblScorecardSpend.textContent = 'Total Horizon Spend';
    if (lblScorecardSla) lblScorecardSla.textContent = 'Average Horizon SLA';
    if (lblScorecardGap) lblScorecardGap.textContent = 'Ending Headcount Gap';

    if (res.firstSlaBreach) {
      simBreachText.textContent = 'Month ' + res.firstSlaBreach;
      simBreachText.style.color = 'var(--danger-light)';
      simBreachSub.innerHTML = '<span class="badge badge-danger">Breaches 80% Target</span>';
    } else {
      simBreachText.textContent = 'None';
      simBreachText.style.color = 'var(--success-light)';
      simBreachSub.innerHTML = '<span class="badge badge-success">Target Maintained</span>';
    }

    if (res.firstBudgetBreach) {
      simBudgetBreachText.textContent = 'Month ' + res.firstBudgetBreach;
      simBudgetBreachText.style.color = 'var(--warn-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-warn">Exceeds Cap</span>';
    } else {
      simBudgetBreachText.textContent = 'None';
      simBudgetBreachText.style.color = 'var(--success-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-success">Under Budget</span>';
    }

    simTotalSpend.textContent = '$' + (res.totalSpend / 1000000).toFixed(2) + 'M';
    simTotalSpendSub.textContent = state.horizon + '-Month Total Spend';

    simAvgSla.textContent = ErlanglyUtils.formatPercent(res.avgSla, 1);
    simAvgSla.className = 'metric-value mono ' + (res.avgSla >= 0.80 ? 'text-success' : 'text-danger');
    if (simAvgSlaSub) simAvgSlaSub.textContent = 'Cumulative service level';

    var gapPrefix = res.endingGap > 0 ? '+' : '';
    simEndingGap.textContent = gapPrefix + res.endingGap + ' agents';
    simEndingGap.className = 'metric-value mono ' + (res.endingGap >= 0 ? 'text-accent' : 'text-danger');
    simGapSub.textContent = 'Month ' + state.horizon + ' net staffing';
  }

  function renderMonteCarloScorecards(mc) {
    if (!mc) return;

    if (lblScorecardBreach) lblScorecardBreach.textContent = 'Worst-Case Breach (P10)';
    if (lblScorecardBudget) lblScorecardBudget.textContent = 'Budget Breach Risk';
    if (lblScorecardSpend) lblScorecardSpend.textContent = 'Median Spend (P50)';
    if (lblScorecardSla) lblScorecardSla.textContent = 'Median SLA (P10–P90)';
    if (lblScorecardGap) lblScorecardGap.textContent = 'Month ' + state.horizon + ' Staffing Range';

    if (mc.worstCaseBreachPeriod) {
      simBreachText.textContent = 'Month ' + mc.worstCaseBreachPeriod;
      simBreachText.style.color = 'var(--danger-light)';
      var riskPct = Math.round(mc.slaBreachProbability * 100);
      simBreachSub.innerHTML = '<span class="badge badge-danger">' + riskPct + '% Breach Probability</span>';
    } else {
      simBreachText.textContent = 'None';
      simBreachText.style.color = 'var(--success-light)';
      simBreachSub.innerHTML = '<span class="badge badge-success">&gt;90% Confidence &ge;80% SLA</span>';
    }

    var budgetRiskPct = Math.round(mc.budgetBreachProbability * 100);
    if (budgetRiskPct > 0) {
      simBudgetBreachText.textContent = budgetRiskPct + '% Risk';
      simBudgetBreachText.style.color = 'var(--warn-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-warn">P90 $' + (mc.totalSpendP90 / 1000000).toFixed(2) + 'M</span>';
    } else {
      simBudgetBreachText.textContent = '0% Risk';
      simBudgetBreachText.style.color = 'var(--success-light)';
      simBudgetSub.innerHTML = '<span class="badge badge-success">Under Budget Ceiling</span>';
    }

    simTotalSpend.textContent = '$' + (mc.medianTotalSpend / 1000000).toFixed(2) + 'M';
    simTotalSpendSub.textContent = 'P10 $' + (mc.totalSpendP10 / 1000000).toFixed(2) + 'M — P90 $' + (mc.totalSpendP90 / 1000000).toFixed(2) + 'M';

    simAvgSla.textContent = ErlanglyUtils.formatPercent(mc.medianAvgSla, 1);
    simAvgSla.className = 'metric-value mono ' + (mc.medianAvgSla >= 0.80 ? 'text-success' : 'text-danger');
    if (simAvgSlaSub) {
      simAvgSlaSub.textContent = 'P10: ' + ErlanglyUtils.formatPercent(mc.avgSlaP10, 1) + ' — P90: ' + ErlanglyUtils.formatPercent(mc.avgSlaP90, 1);
    }

    simEndingGap.textContent = mc.endingStaffingP10 + ' – ' + mc.endingStaffingP90;
    simEndingGap.className = 'metric-value mono text-accent';
    simGapSub.textContent = 'P50 need: ' + mc.endingReqStaffP50 + ' required staff';
  }

  function renderActiveTable() {
    if (state.tableViewMode === 'percentiles' && state.mcResults) {
      renderPercentileTable(state.mcResults.periods);
    } else {
      var det = state.simResults[state.activeScenarioIdx];
      if (det && det.periods) renderDeterministicTable(det.periods);
    }
  }

  function renderDeterministicTable(periods) {
    if (!theadSimProjection || !tbodySimProjection) return;

    theadSimProjection.innerHTML =
      '<tr>' +
        '<th>Period</th>' +
        '<th>Volume</th>' +
        '<th>AHT</th>' +
        '<th>Required Staff</th>' +
        '<th>Productive Staff</th>' +
        '<th>Headcount Gap</th>' +
        '<th>Projected SLA</th>' +
        '<th>ASA</th>' +
        '<th>Labor Cost</th>' +
        '<th>Status</th>' +
      '</tr>';

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

  function renderPercentileTable(periods) {
    if (!theadSimProjection || !tbodySimProjection) return;

    var metric = state.chartMetric || 'sla';
    var metricName = 'Service Level (%)';
    if (metric === 'requiredStaff') metricName = 'Required Staff';
    if (metric === 'productiveStaff') metricName = 'Productive Staff';
    if (metric === 'cost') metricName = 'Labor Cost ($)';

    theadSimProjection.innerHTML =
      '<tr>' +
        '<th>Period</th>' +
        '<th>P10 (Worst SLA / Best Cost)</th>' +
        '<th>P25 Lower Quartile</th>' +
        '<th style="color: var(--accent);">P50 Median</th>' +
        '<th>P75 Upper Quartile</th>' +
        '<th>P90 (Best SLA / Max Need)</th>' +
        '<th>Mean &plusmn; &sigma;</th>' +
        '<th>90% Confidence Interval</th>' +
      '</tr>';

    tbodySimProjection.innerHTML = '';
    periods.forEach(function(p) {
      var tr = document.createElement('tr');
      var mData = p[metric] || p.sla;

      var fmtVal = function(v) {
        if (metric === 'sla') return ErlanglyUtils.formatPercent(v, 1);
        if (metric === 'cost') return '$' + Math.round(v).toLocaleString();
        return Math.round(v);
      };

      var p10Fmt = fmtVal(mData.p10);
      var p25Fmt = fmtVal(mData.p25);
      var p50Fmt = fmtVal(mData.p50);
      var p75Fmt = fmtVal(mData.p75);
      var p90Fmt = fmtVal(mData.p90);
      var meanFmt = fmtVal(mData.mean) + ' &plusmn; ' + (metric === 'sla' ? (mData.stdDev * 100).toFixed(1) + '%' : Math.round(mData.stdDev));

      var isSlaBreach = metric === 'sla' && mData.p10 < 0.80;
      var isP50Breach = metric === 'sla' && mData.p50 < 0.80;

      tr.innerHTML =
        '<td class="mono"><strong>' + p.periodName + '</strong></td>' +
        '<td class="mono ' + (isSlaBreach ? 'text-danger' : '') + '">' + p10Fmt + '</td>' +
        '<td class="mono">' + p25Fmt + '</td>' +
        '<td class="mono text-accent" style="font-weight: 700;">' + p50Fmt + '</td>' +
        '<td class="mono">' + p75Fmt + '</td>' +
        '<td class="mono">' + p90Fmt + '</td>' +
        '<td class="mono text-secondary">' + meanFmt + '</td>' +
        '<td><span class="badge ' + (isP50Breach ? 'badge-danger' : (isSlaBreach ? 'badge-warn' : 'badge-success')) + '">' + p10Fmt + ' – ' + p90Fmt + '</span></td>';

      tbodySimProjection.appendChild(tr);
    });
  }

  // --- Chart.js Visualization ---
  function renderComparisonChart() {
    if (!canvasSimulatorChart || typeof Chart === 'undefined') return;

    var labels = [];
    for (var i = 1; i <= state.horizon; i++) {
      labels.push('Month ' + i);
    }

    var metric = state.chartMetric || 'sla';
    var metricTitle = 'Service Level (%)';
    var yMin = 0, yMax = 100, yFmt = function(v) { return v + '%'; };

    if (metric === 'requiredStaff' || metric === 'productiveStaff') {
      metricTitle = metric === 'requiredStaff' ? 'Required Staff Headcount' : 'Productive Staff Headcount';
      yMin = undefined; yMax = undefined; yFmt = function(v) { return v; };
    } else if (metric === 'cost') {
      metricTitle = 'Monthly Labor Cost ($)';
      yMin = 0; yMax = undefined; yFmt = function(v) { return '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v); };
    }

    if (lblChartTitle) {
      lblChartTitle.textContent = (state.mode === 'montecarlo' ? 'Monte Carlo Confidence Bands: ' : 'Multi-Scenario Comparison: ') + metricTitle;
    }

    var datasets = [];

    if (state.mode === 'montecarlo' && state.mcResults) {
      var mc = state.mcResults;
      var p10Vals = [], p25Vals = [], p50Vals = [], p75Vals = [], p90Vals = [];

      mc.periods.forEach(function(p) {
        var d = p[metric] || p.sla;
        var scale = (metric === 'sla') ? 100 : 1;
        p10Vals.push(d.p10 * scale);
        p25Vals.push(d.p25 * scale);
        p50Vals.push(d.p50 * scale);
        p75Vals.push(d.p75 * scale);
        p90Vals.push(d.p90 * scale);
      });

      // Deterministic comparison line
      var det = state.simResults[state.activeScenarioIdx];
      var detVals = det ? det.periods.map(function(p) {
        var val = p[metric] !== undefined ? p[metric] : p.sla;
        return (metric === 'sla') ? val * 100 : val;
      }) : [];

      // Dataset 0: P90 Top Outer Boundary
      datasets.push({
        label: 'P90 Outer Boundary',
        data: p90Vals,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        pointRadius: 0,
        fill: false,
        tension: 0.2
      });

      // Dataset 1: P10 Bottom Outer Boundary -> fill to Dataset 0
      datasets.push({
        label: 'P10–P90 (90% Confidence Interval)',
        data: p10Vals,
        borderColor: 'transparent',
        backgroundColor: 'rgba(0, 210, 211, 0.12)',
        fill: '-1',
        pointRadius: 0,
        tension: 0.2
      });

      // Dataset 2: P75 Upper Inner Boundary
      datasets.push({
        label: 'P75 Inner Boundary',
        data: p75Vals,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        pointRadius: 0,
        fill: false,
        tension: 0.2
      });

      // Dataset 3: P25 Lower Inner Boundary -> fill to Dataset 2
      datasets.push({
        label: 'P25–P75 (50% Inner Quartile Band)',
        data: p25Vals,
        borderColor: 'transparent',
        backgroundColor: 'rgba(0, 210, 211, 0.25)',
        fill: '-1',
        pointRadius: 0,
        tension: 0.2
      });

      // Dataset 4: P50 Median Line
      datasets.push({
        label: 'P50 Median Line',
        data: p50Vals,
        borderColor: '#00d2d3',
        backgroundColor: 'transparent',
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.2
      });

      // Dataset 5: Deterministic Benchmark
      datasets.push({
        label: 'Deterministic Benchmark',
        data: detVals,
        borderColor: '#94a3b8',
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.2
      });

      // Legend in Monte Carlo mode
      if (boxChartLegend) {
        boxChartLegend.innerHTML =
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: #00d2d3;">' +
            '<span style="display: inline-block; width: 12px; height: 3px; background: #00d2d3;"></span> P50 Median' +
          '</span>' +
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: rgba(0, 210, 211, 0.8);">' +
            '<span style="display: inline-block; width: 10px; height: 10px; background: rgba(0, 210, 211, 0.25); border: 1px solid #00d2d3;"></span> 50% &amp; 90% Bands' +
          '</span>' +
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: #94a3b8;">' +
            '<span style="display: inline-block; width: 12px; height: 2px; border-top: 2px dashed #94a3b8;"></span> Point Baseline' +
          '</span>';
      }
    } else {
      // Deterministic 3-Scenario Comparison
      var colors = ['#00d2d3', '#10b981', '#f59e0b'];
      datasets = state.simResults.map(function(res, idx) {
        var vals = res.periods.map(function(p) {
          var val = p[metric] !== undefined ? p[metric] : p.sla;
          return (metric === 'sla') ? Math.round(val * 100) : Math.round(val);
        });

        return {
          label: res.scenario.name,
          data: vals,
          borderColor: colors[idx] || '#cbd5e1',
          backgroundColor: 'transparent',
          borderWidth: idx === state.activeScenarioIdx ? 3 : 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.2
        };
      });

      if (boxChartLegend) {
        boxChartLegend.innerHTML =
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: #00d2d3;">' +
            '<span style="display: inline-block; width: 10px; height: 10px; background: #00d2d3; border-radius: 50%;"></span> Scenario A' +
          '</span>' +
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: #10b981;">' +
            '<span style="display: inline-block; width: 10px; height: 10px; background: #10b981; border-radius: 50%;"></span> Scenario B' +
          '</span>' +
          '<span style="display: inline-flex; align-items: center; gap: 4px; color: #f59e0b;">' +
            '<span style="display: inline-block; width: 10px; height: 10px; background: #f59e0b; border-radius: 50%;"></span> Scenario C' +
          '</span>';
      }
    }

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets = datasets;
      state.chart.options.scales.y.min = yMin;
      state.chart.options.scales.y.max = yMax;
      state.chart.options.scales.y.ticks.callback = yFmt;
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
                var rawVal = c.parsed.y;
                if (metric === 'sla') return c.dataset.label + ': ' + rawVal.toFixed(1) + '%';
                if (metric === 'cost') return c.dataset.label + ': $' + Math.round(rawVal).toLocaleString();
                return c.dataset.label + ': ' + Math.round(rawVal);
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
            min: yMin,
            max: yMax,
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'IBM Plex Mono', size: 11 },
              callback: yFmt
            }
          }
        }
      }
    });
  }

  // --- Executive Narrative Summary ---
  function generateExecutiveNarrative() {
    if (!narrativeSummaryText) return;

    if (state.mode === 'montecarlo' && state.mcResults) {
      var mc = state.mcResults;
      var sc = state.scenarios[state.activeScenarioIdx];

      var text = 'Probabilistic Monte Carlo Workforce Assessment (' + mc.iterations + ' Iterations, ' + state.horizon + '-Month Horizon):\n\n';
      text += '• Scenario: ' + sc.name + ' under ' + (mc.config.distribution === 'normal' ? 'Gaussian (&plusmn;' + mc.config.volSigma + '% vol, &plusmn;' + mc.config.ahtSigma + '% AHT)' : 'Uniform') + ' stochastic volatility.\n\n';

      text += '• Service Level Confidence: The median projected 12-month SLA is ' + ErlanglyUtils.formatPercent(mc.medianAvgSla, 1) + ', with a 90% confidence range spanning from ' + ErlanglyUtils.formatPercent(mc.avgSlaP10, 1) + ' (P10 pessimistic) to ' + ErlanglyUtils.formatPercent(mc.avgSlaP90, 1) + ' (P90 optimistic). ' +
        (mc.worstCaseBreachPeriod ? 'A downside SLA breach below 80% is anticipated as early as Month ' + mc.worstCaseBreachPeriod + ' in the lower 10th percentile.' : 'SLA targets are maintained with >90% probability throughout the horizon.') + '\n\n';

      text += '• Capacity & Headcount Needs: By Month ' + state.horizon + ', productive headcount is projected between ' + mc.endingStaffingP10 + ' and ' + mc.endingStaffingP90 + ' agents, against a median Erlang C requirement of ' + mc.endingReqStaffP50 + ' required staff.\n\n';

      text += '• Financial Exposure: Median total horizon spend is $' + (mc.medianTotalSpend / 1000000).toFixed(2) + 'M (P10 $' + (mc.totalSpendP10 / 1000000).toFixed(2) + 'M to P90 $' + (mc.totalSpendP90 / 1000000).toFixed(2) + 'M) with a ' + Math.round(mc.budgetBreachProbability * 100) + '% likelihood of exceeding the $' + (sc.budgetCap / 1000).toFixed(0) + 'k monthly budget ceiling.\n\n';

      text += 'Strategic Recommendation: ' + (mc.worstCaseBreachPeriod ? 'Institute an expedited hiring cohort by Month ' + Math.max(1, mc.worstCaseBreachPeriod - 2) + ' to mitigate the ' + Math.round(mc.slaBreachProbability * 100) + '% downside breach risk.' : 'Current staffing plan exhibits high probabilistic resilience.');

      narrativeSummaryText.textContent = text;
      return;
    }

    // Deterministic Narrative
    var scA = state.simResults[0];
    var scB = state.simResults[1];
    var scC = state.simResults[2];

    if (!scA || !scB || !scC) return;

    var dText = 'Strategic Workforce Simulation Summary (' + state.horizon + '-Month Horizon):\n\n';

    dText += '• ' + scA.scenario.name + ' projects an average service level of ' + (scA.avgSla * 100).toFixed(1) + '% with total labor expenditure of $' + (scA.totalSpend / 1000000).toFixed(2) + 'M. ' +
      (scA.firstSlaBreach ? 'Service level falls below 80% SLA in Month ' + scA.firstSlaBreach + ' as attrition outpaces baseline hiring.' : 'Maintains SLA targets throughout the horizon.') + '\n\n';

    dText += '• ' + scB.scenario.name + ' projects a robust average service level of ' + (scB.avgSla * 100).toFixed(1) + '% at $' + (scB.totalSpend / 1000000).toFixed(2) + 'M spend, ending Month ' + state.horizon + ' with a +' + scB.endingGap + ' headcount buffer, accounting for new-hire nesting ramp lag.\n\n';

    dText += '• ' + scC.scenario.name + ' saves capital ($' + (scC.totalSpend / 1000000).toFixed(2) + 'M total spend) but encounters an operational service breach by Month ' + (scC.firstSlaBreach || 'N/A') + ' due to cumulative attrition, ending with a deficit of ' + Math.abs(scC.endingGap) + ' agents.\n\n';

    dText += 'Recommendation: Scenario B is recommended for peak volume resilience, while Scenario A represents a viable cost-balanced operational posture.';

    narrativeSummaryText.textContent = dText;
  }

  // --- CSV Exporters ---
  function exportDeterministicCSV() {
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
  }

  function exportMonteCarloCSV() {
    var mc = state.mcResults;
    if (!mc || !mc.periods) return;

    var headers = ['Month', 'Metric', 'P10', 'P25', 'P50_Median', 'P75', 'P90', 'Mean', 'StdDev'];
    var rows = [];

    mc.periods.forEach(function(p) {
      // SLA
      rows.push([p.periodName, 'Service_Level_Pct', (p.sla.p10 * 100).toFixed(1) + '%', (p.sla.p25 * 100).toFixed(1) + '%', (p.sla.p50 * 100).toFixed(1) + '%', (p.sla.p75 * 100).toFixed(1) + '%', (p.sla.p90 * 100).toFixed(1) + '%', (p.sla.mean * 100).toFixed(1) + '%', (p.sla.stdDev * 100).toFixed(2) + '%']);
      // Required Staff
      rows.push([p.periodName, 'Required_Staff', p.requiredStaff.p10, p.requiredStaff.p25, p.requiredStaff.p50, p.requiredStaff.p75, p.requiredStaff.p90, p.requiredStaff.mean.toFixed(1), p.requiredStaff.stdDev.toFixed(2)]);
      // Productive Staff
      rows.push([p.periodName, 'Productive_Staff', p.productiveStaff.p10, p.productiveStaff.p25, p.productiveStaff.p50, p.productiveStaff.p75, p.productiveStaff.p90, p.productiveStaff.mean.toFixed(1), p.productiveStaff.stdDev.toFixed(2)]);
      // Cost
      rows.push([p.periodName, 'Labor_Cost_USD', '$' + p.cost.p10, '$' + p.cost.p25, '$' + p.cost.p50, '$' + p.cost.p75, '$' + p.cost.p90, '$' + Math.round(p.cost.mean), '$' + Math.round(p.cost.stdDev)]);
    });

    ErlanglyUtils.exportCSV('monte_carlo_simulation_' + (state.activeScenarioIdx + 1) + '.csv', headers, rows);
  }

  // --- Export Module Interface for Unit Testing & Global Access ---
  var ErlanglySimulator = {
    DEFAULT_SCENARIOS: DEFAULT_SCENARIOS,
    DEFAULT_MC_CONFIG: DEFAULT_MC_CONFIG,
    sampleNormal: sampleNormal,
    sampleUniform: sampleUniform,
    getPercentile: getPercentile,
    getStats: getStats,
    simulateScenario: simulateScenario,
    runMonteCarloSimulation: runMonteCarloSimulation,
    getState: function() { return state; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErlanglySimulator;
  }
  root.ErlanglySimulator = ErlanglySimulator;

  // Run on DOM load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

