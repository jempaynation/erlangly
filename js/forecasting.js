/**
 * Erlangly Forecasting Tool (js/forecasting.js)
 * 
 * Phase 8: Advanced Forecasting Models
 * Features:
 * - Pluggable model architecture with common interface (fit, predict, metrics)
 * - 8 Time-series forecasting algorithms:
 *   1. Weighted Moving Average (WMA)
 *   2. Simple Moving Average (SMA)
 *   3. Linear Trend Projection (OLS)
 *   4. Seasonal Decomposition (Multiplicative)
 *   5. Seasonal Decomposition (Additive)
 *   6. Simple Exponential Smoothing (SES) with auto-optimization
 *   7. Holt's Double Exponential Smoothing (Trend-aware) with auto-optimization
 *   8. Multi-Variable Regression (with Day-of-Week dummy variables)
 * - Holiday & Event flag system (multiplicative scaling or outlier exclusion)
 * - Model Comparison View (multi-curve overlay & comparative MAE, MAPE, RMSE, R2 table)
 * - Large CSV streaming Web Worker integration (100k+ rows)
 * - Chart.js dark control-room visualizer with dynamic datasets
 * - Cross-tool handoff to Capacity Planning & Supabase/Plans persistence
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./erlang.js'), require('./main.js'));
  } else {
    root.ErlanglyForecast = factory(root.Erlangly, root.ErlanglyUtils);
  }
})(typeof self !== 'undefined' ? self : this, function(Erlangly, ErlanglyUtils) {
  'use strict';

  // Fallbacks if dependencies are loaded in different order
  Erlangly = Erlangly || (typeof window !== 'undefined' ? window.Erlangly : null);
  ErlanglyUtils = ErlanglyUtils || (typeof window !== 'undefined' ? window.ErlanglyUtils : null);

  // =========================================================================
  // 1. STATISTICAL & MATHEMATICAL UTILITIES
  // =========================================================================

  /**
   * Ordinary Least Squares (OLS) Linear Regression: y = intercept + slope * x
   */
  function linearRegression(ySeries) {
    var n = ySeries.length;
    if (n <= 1) return { slope: 0, intercept: ySeries[0] || 0 };

    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var x = 0; x < n; x++) {
      var y = ySeries[x];
      sumX += x;
      sumY += y;
      sumXY += (x * y);
      sumXX += (x * x);
    }

    var denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return { slope: 0, intercept: sumY / n };

    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;

    return { slope: slope, intercept: intercept };
  }

  /**
   * Gaussian Elimination with Partial Pivoting to solve A * x = B
   * For multiple linear regression (matrix dimensions <= 8x8)
   */
  function solveLinearSystem(A, B) {
    var n = B.length;
    var M = [];
    for (var i = 0; i < n; i++) {
      M[i] = A[i].slice();
      M[i].push(B[i]);
    }

    for (var i = 0; i < n; i++) {
      var maxRow = i;
      for (var k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k;
        }
      }
      if (Math.abs(M[maxRow][i]) < 1e-12) {
        return null; // Singular or collinear
      }
      var tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      for (var k = i + 1; k < n; k++) {
        var factor = M[k][i] / M[i][i];
        for (var j = i; j <= n; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }

    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var sum = M[i][n];
      for (var j = i + 1; j < n; j++) {
        sum -= M[i][j] * x[j];
      }
      x[i] = sum / M[i][i];
    }
    return x;
  }

  /**
   * Calculate standard in-sample forecast fit metrics (MAE, MAPE, RMSE, MSE, R2)
   */
  function calculateFitMetrics(actuals, fitted) {
    var n = Math.min(actuals.length, fitted.length);
    if (n === 0) return { mae: 0, mape: 0, rmse: 0, mse: 0, r2: 0 };

    var sumAbsErr = 0;
    var sumPctErr = 0;
    var sumSqErr = 0;
    var sumActual = 0;
    var validPctCount = 0;

    for (var i = 0; i < n; i++) {
      var act = actuals[i];
      var fit = fitted[i];
      var err = act - fit;
      sumAbsErr += Math.abs(err);
      sumSqErr += (err * err);
      sumActual += act;

      if (act > 0) {
        sumPctErr += Math.abs(err) / act;
        validPctCount++;
      }
    }

    var meanActual = sumActual / n;
    var ssTot = 0;
    for (var i = 0; i < n; i++) {
      var diff = actuals[i] - meanActual;
      ssTot += (diff * diff);
    }

    var mae = sumAbsErr / n;
    var mape = validPctCount > 0 ? (sumPctErr / validPctCount) * 100 : 0;
    var mse = sumSqErr / n;
    var rmse = Math.sqrt(mse);
    var r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - (sumSqErr / ssTot))) * 100 : 100;

    return {
      mae: mae,
      mape: mape,
      rmse: rmse,
      mse: mse,
      r2: r2
    };
  }

  /**
   * Helper to normalize history with holiday/event exclusions or scaling
   */
  function preprocessHistory(history, holidays) {
    if (!history || history.length === 0) return [];
    var eventMap = {};
    if (holidays && holidays.length > 0) {
      holidays.forEach(function(ev) {
        if (ev && ev.date) {
          eventMap[ev.date] = ev;
        }
      });
    }

    var clean = [];
    for (var i = 0; i < history.length; i++) {
      var row = history[i];
      var ev = eventMap[row.period];
      if (ev) {
        if (ev.action === 'exclude') {
          // Linear interpolation if neighbor exists, else skip
          var prev = history[i - 1] ? history[i - 1].volume : null;
          var next = history[i + 1] ? history[i + 1].volume : null;
          var interpVol = row.volume;
          if (prev !== null && next !== null) {
            interpVol = (prev + next) / 2;
          } else if (prev !== null) {
            interpVol = prev;
          } else if (next !== null) {
            interpVol = next;
          }
          clean.push({ period: row.period, volume: interpVol, originalVolume: row.volume, isInterpolated: true });
          continue;
        } else if (ev.action === 'scale') {
          var impactFactor = 1 + ((parseFloat(ev.impactPct) || 0) / 100);
          if (impactFactor > 0) {
            clean.push({ period: row.period, volume: row.volume / impactFactor, originalVolume: row.volume, isScaled: true });
            continue;
          }
        }
      }
      clean.push({ period: row.period, volume: row.volume, originalVolume: row.volume });
    }
    return clean;
  }

  // =========================================================================
  // 2. PLUGGABLE FORECASTING ALGORITHMS
  // =========================================================================

  var MODEL_REGISTRY = {};

  /**
   * Register a forecasting model
   */
  function registerModel(modelDef) {
    MODEL_REGISTRY[modelDef.id] = modelDef;
  }

  // --- MODEL 1: Weighted Moving Average (WMA) ---
  registerModel({
    id: 'wma',
    name: 'Weighted Moving Average (WMA)',
    category: 'Moving Average',
    description: 'Applies linearly increasing weights to recent periods plus local window trend drift.',
    params: [
      { id: 'windowSize', label: 'Lookback Window', type: 'number', default: 6, min: 2, max: 52, step: 1, unit: 'periods' }
    ],
    fit: function(history, params) {
      var k = Math.min(history.length, Math.max(2, parseInt(params.windowSize, 10) || 6));
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var fitted = [];

      for (var t = 0; t < n; t++) {
        if (t < 1) {
          fitted.push(volumes[0]);
        } else {
          var win = Math.min(t, k);
          var sW = (win * (win + 1)) / 2;
          var sWV = 0;
          for (var j = 1; j <= win; j++) {
            sWV += j * volumes[t - win + j - 1];
          }
          fitted.push(sWV / sW);
        }
      }

      // Compute last window metrics for projection
      var lastWin = Math.min(n, k);
      var lastSW = (lastWin * (lastWin + 1)) / 2;
      var lastSWV = 0;
      for (var j = 1; j <= lastWin; j++) {
        lastSWV += j * volumes[n - lastWin + j - 1];
      }
      var baseLevel = lastSWV / lastSW;
      var reg = linearRegression(volumes.slice(n - lastWin));

      return {
        baseLevel: baseLevel,
        trendSlope: reg.slope,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var base = fitResult.baseLevel;
      var slope = fitResult.trendSlope;

      for (var h = 1; h <= horizon; h++) {
        var raw = Math.max(0, base + slope * h);
        var trendFactor = base > 0 ? (raw / base) : 1.0;
        predictions.push({
          baseVolume: raw,
          trendFactor: trendFactor,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // --- MODEL 2: Simple Moving Average (SMA) ---
  registerModel({
    id: 'sma',
    name: 'Simple Moving Average (SMA)',
    category: 'Moving Average',
    description: 'Equal-weight unweighted rolling mean of the most recent K periods.',
    params: [
      { id: 'windowSize', label: 'Lookback Window', type: 'number', default: 6, min: 2, max: 52, step: 1, unit: 'periods' }
    ],
    fit: function(history, params) {
      var k = Math.min(history.length, Math.max(2, parseInt(params.windowSize, 10) || 6));
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var fitted = [];

      for (var t = 0; t < n; t++) {
        var win = Math.min(t + 1, k);
        var sum = 0;
        for (var j = 0; j < win; j++) {
          sum += volumes[t - j];
        }
        fitted.push(sum / win);
      }

      var lastWin = Math.min(n, k);
      var lastSum = 0;
      for (var j = 0; j < lastWin; j++) {
        lastSum += volumes[n - 1 - j];
      }
      var baseLevel = lastSum / lastWin;

      return {
        baseLevel: baseLevel,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      for (var h = 1; h <= horizon; h++) {
        predictions.push({
          baseVolume: fitResult.baseLevel,
          trendFactor: 1.0,
          rawVolume: fitResult.baseLevel
        });
      }
      return predictions;
    }
  });

  // --- MODEL 3: Linear Trend Projection (OLS) ---
  registerModel({
    id: 'trend',
    name: 'Linear Trend Projection (OLS)',
    category: 'Trend',
    description: 'Global Ordinary Least Squares linear regression line over the entire historical horizon.',
    params: [],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var reg = linearRegression(volumes);
      var fitted = [];
      for (var t = 0; t < volumes.length; t++) {
        fitted.push(Math.max(0, reg.intercept + reg.slope * t));
      }

      return {
        intercept: reg.intercept,
        slope: reg.slope,
        historyLength: volumes.length,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var N = fitResult.historyLength;
      for (var h = 1; h <= horizon; h++) {
        var raw = Math.max(0, fitResult.intercept + fitResult.slope * (N + h - 1));
        var baseRef = fitResult.intercept + fitResult.slope * (N - 1);
        var trendFactor = baseRef > 0 ? (raw / baseRef) : 1.0;
        predictions.push({
          baseVolume: raw,
          trendFactor: trendFactor,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // --- MODEL 4: Seasonal Decomposition (Multiplicative) ---
  registerModel({
    id: 'decomp_mult',
    name: 'Seasonal Decomposition (Multiplicative)',
    category: 'Decomposition',
    description: 'Decomposes volume into Trend × Seasonal × Residual components for cyclical contact center demand.',
    params: [
      { id: 'seasonLength', label: 'Cycle Length', type: 'number', default: 7, min: 2, max: 31, step: 1, unit: 'days' }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var P = Math.max(2, parseInt(params.seasonLength, 10) || 7);

      // Step 1: Baseline trend
      var baseReg = linearRegression(volumes);

      // Step 2: Seasonal ratios
      var bucketSums = new Array(P).fill(0);
      var bucketCounts = new Array(P).fill(0);

      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendAtT = Math.max(1, baseReg.intercept + baseReg.slope * t);
        var ratio = volumes[t] / trendAtT;
        bucketSums[dayIdx] += ratio;
        bucketCounts[dayIdx]++;
      }

      var indices = new Array(P).fill(1.0);
      var sumIndices = 0;
      for (var p = 0; p < P; p++) {
        if (bucketCounts[p] > 0) {
          indices[p] = bucketSums[p] / bucketCounts[p];
        }
        sumIndices += indices[p];
      }
      // Normalize so mean index = 1.0
      var meanIndex = sumIndices / P;
      if (meanIndex > 0) {
        for (var p = 0; p < P; p++) {
          indices[p] /= meanIndex;
        }
      }

      // Step 3: Deseasonalize and fit final trend
      var deseasonalized = [];
      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        deseasonalized.push(volumes[t] / (indices[dayIdx] || 1.0));
      }

      var finalTrendReg = linearRegression(deseasonalized);

      // In-sample fitted series
      var fitted = [];
      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendVal = Math.max(0, finalTrendReg.intercept + finalTrendReg.slope * t);
        fitted.push(trendVal * (indices[dayIdx] || 1.0));
      }

      return {
        intercept: finalTrendReg.intercept,
        slope: finalTrendReg.slope,
        seasonalIndices: indices,
        seasonLength: P,
        historyLength: n,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var N = fitResult.historyLength;
      var P = fitResult.seasonLength;
      var indices = fitResult.seasonalIndices;

      for (var h = 1; h <= horizon; h++) {
        var t = N + h - 1;
        var dayIdx = t % P;
        if (options && options.futureDates && options.futureDates[h - 1] && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(options.futureDates[h - 1]);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendVal = Math.max(0, fitResult.intercept + fitResult.slope * t);
        var sIdx = indices[dayIdx] || 1.0;
        var raw = Math.max(0, trendVal * sIdx);

        predictions.push({
          baseVolume: trendVal,
          trendFactor: 1.0,
          seasonalityIndex: sIdx,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // --- MODEL 5: Seasonal Decomposition (Additive) ---
  registerModel({
    id: 'decomp_add',
    name: 'Seasonal Decomposition (Additive)',
    category: 'Decomposition',
    description: 'Decomposes volume into Trend + Seasonal + Residual components with zero-sum seasonal offsets.',
    params: [
      { id: 'seasonLength', label: 'Cycle Length', type: 'number', default: 7, min: 2, max: 31, step: 1, unit: 'days' }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var P = Math.max(2, parseInt(params.seasonLength, 10) || 7);

      var baseReg = linearRegression(volumes);
      var bucketSums = new Array(P).fill(0);
      var bucketCounts = new Array(P).fill(0);

      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendAtT = baseReg.intercept + baseReg.slope * t;
        var diff = volumes[t] - trendAtT;
        bucketSums[dayIdx] += diff;
        bucketCounts[dayIdx]++;
      }

      var offsets = new Array(P).fill(0);
      var sumOffsets = 0;
      for (var p = 0; p < P; p++) {
        if (bucketCounts[p] > 0) {
          offsets[p] = bucketSums[p] / bucketCounts[p];
        }
        sumOffsets += offsets[p];
      }
      // Normalize so sum of additive seasonal offsets = 0
      var meanOffset = sumOffsets / P;
      for (var p = 0; p < P; p++) {
        offsets[p] -= meanOffset;
      }

      var deseasonalized = [];
      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        deseasonalized.push(volumes[t] - offsets[dayIdx]);
      }

      var finalTrendReg = linearRegression(deseasonalized);
      var fitted = [];
      for (var t = 0; t < n; t++) {
        var dayIdx = t % P;
        if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendVal = finalTrendReg.intercept + finalTrendReg.slope * t;
        fitted.push(Math.max(0, trendVal + offsets[dayIdx]));
      }

      return {
        intercept: finalTrendReg.intercept,
        slope: finalTrendReg.slope,
        seasonalOffsets: offsets,
        seasonLength: P,
        historyLength: n,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var N = fitResult.historyLength;
      var P = fitResult.seasonLength;
      var offsets = fitResult.seasonalOffsets;

      for (var h = 1; h <= horizon; h++) {
        var t = N + h - 1;
        var dayIdx = t % P;
        if (options && options.futureDates && options.futureDates[h - 1] && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(options.futureDates[h - 1]);
          if (info) dayIdx = info.dayOfWeek % P;
        }
        var trendVal = Math.max(0, fitResult.intercept + fitResult.slope * t);
        var offset = offsets[dayIdx] || 0;
        var raw = Math.max(0, trendVal + offset);
        var pseudoIdx = trendVal > 0 ? (raw / trendVal) : 1.0;

        predictions.push({
          baseVolume: trendVal,
          trendFactor: 1.0,
          seasonalityIndex: pseudoIdx,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // --- MODEL 6: Simple Exponential Smoothing (SES) ---
  registerModel({
    id: 'ses',
    name: 'Simple Exponential Smoothing (SES)',
    category: 'Exponential Smoothing',
    description: 'Level-based exponential smoothing for stationary demand, with MSE auto-optimization for α.',
    params: [
      { id: 'alpha', label: 'Smoothing Constant (α)', type: 'number', default: 0.20, min: 0.01, max: 0.99, step: 0.01, unit: '' },
      { id: 'autoOptimize', label: 'Auto-optimize α (Min MSE)', type: 'boolean', default: false }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var alpha = parseFloat(params.alpha) || 0.20;

      // Auto-optimization grid search if requested
      if (params.autoOptimize) {
        var bestAlpha = 0.20;
        var bestMSE = Infinity;
        for (var a = 0.01; a <= 0.99; a += 0.02) {
          var curL = volumes[0];
          var curSqErr = 0;
          for (var t = 1; t < n; t++) {
            var err = volumes[t] - curL;
            curSqErr += (err * err);
            curL = a * volumes[t] + (1 - a) * curL;
          }
          if (curSqErr < bestMSE) {
            bestMSE = curSqErr;
            bestAlpha = parseFloat(a.toFixed(2));
          }
        }
        alpha = bestAlpha;
      }

      var fitted = [volumes[0]];
      var L = volumes[0];
      for (var t = 1; t < n; t++) {
        fitted.push(L); // 1-step ahead forecast
        L = alpha * volumes[t] + (1 - alpha) * L;
      }

      return {
        level: L,
        alpha: alpha,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      for (var h = 1; h <= horizon; h++) {
        predictions.push({
          baseVolume: fitResult.level,
          trendFactor: 1.0,
          rawVolume: fitResult.level
        });
      }
      return predictions;
    }
  });

  // --- MODEL 7: Holt's Double Exponential Smoothing (Trend-Aware) ---
  registerModel({
    id: 'holt',
    name: "Holt's Double Exponential Smoothing",
    category: 'Exponential Smoothing',
    description: 'Captures both level (α) and slope trend (β), with 2D grid search auto-optimization.',
    params: [
      { id: 'alpha', label: 'Level Constant (α)', type: 'number', default: 0.30, min: 0.01, max: 0.99, step: 0.01, unit: '' },
      { id: 'beta', label: 'Trend Constant (β)', type: 'number', default: 0.10, min: 0.01, max: 0.99, step: 0.01, unit: '' },
      { id: 'autoOptimize', label: 'Auto-optimize (α, β)', type: 'boolean', default: false }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var alpha = parseFloat(params.alpha) || 0.30;
      var beta = parseFloat(params.beta) || 0.10;

      if (params.autoOptimize) {
        var bestAlpha = 0.30;
        var bestBeta = 0.10;
        var bestMSE = Infinity;

        for (var a = 0.05; a <= 0.95; a += 0.05) {
          for (var b = 0.01; b <= 0.50; b += 0.02) {
            var curL = volumes[0];
            var curT = n > 1 ? (volumes[1] - volumes[0]) : 0;
            var curSqErr = 0;
            for (var t = 1; t < n; t++) {
              var pred = curL + curT;
              var err = volumes[t] - pred;
              curSqErr += (err * err);
              var nextL = a * volumes[t] + (1 - a) * (curL + curT);
              var nextT = b * (nextL - curL) + (1 - b) * curT;
              curL = nextL;
              curT = nextT;
            }
            if (curSqErr < bestMSE) {
              bestMSE = curSqErr;
              bestAlpha = parseFloat(a.toFixed(2));
              bestBeta = parseFloat(b.toFixed(2));
            }
          }
        }
        alpha = bestAlpha;
        beta = bestBeta;
      }

      var L = volumes[0];
      var T = n > 1 ? (volumes[1] - volumes[0]) : 0;
      var fitted = [volumes[0]];

      for (var t = 1; t < n; t++) {
        fitted.push(Math.max(0, L + T));
        var nextL = alpha * volumes[t] + (1 - alpha) * (L + T);
        var nextT = beta * (nextL - L) + (1 - beta) * T;
        L = nextL;
        T = nextT;
      }

      return {
        level: L,
        trend: T,
        alpha: alpha,
        beta: beta,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var L = fitResult.level;
      var T = fitResult.trend;

      for (var h = 1; h <= horizon; h++) {
        var raw = Math.max(0, L + h * T);
        var trendFactor = L > 0 ? (raw / L) : 1.0;
        predictions.push({
          baseVolume: raw,
          trendFactor: trendFactor,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // --- MODEL 8: Multi-Variable Regression (with Day-of-Week Dummies) ---
  registerModel({
    id: 'regression',
    name: 'Multi-Variable Regression (Day Dummies)',
    category: 'Regression',
    description: 'Estimates linear time trend plus 6 day-of-week indicator binary variables via OLS normal equations.',
    params: [
      { id: 'includeDummies', label: 'Day-of-Week Dummies', type: 'boolean', default: true }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var useDummies = params.includeDummies !== false;

      var numVars = useDummies ? 8 : 2; // [1, t, d1..d6]
      var X = [];
      for (var t = 0; t < n; t++) {
        var row = [1, t];
        if (useDummies) {
          var dayIdx = t % 7;
          if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
            var info = ErlanglyUtils.parseDate(history[t].period);
            if (info) dayIdx = info.dayOfWeek;
          }
          // Reference day = 0 (Monday). Dummies for 1 (Tue) .. 6 (Sun)
          for (var d = 1; d <= 6; d++) {
            row.push(dayIdx === d ? 1 : 0);
          }
        }
        X.push(row);
      }

      // Compute X^T * X and X^T * Y
      var XtX = [];
      for (var r = 0; r < numVars; r++) {
        XtX[r] = new Array(numVars).fill(0);
        for (var c = 0; c < numVars; c++) {
          var sum = 0;
          for (var i = 0; i < n; i++) {
            sum += X[i][r] * X[i][c];
          }
          XtX[r][c] = sum;
        }
      }

      var XtY = new Array(numVars).fill(0);
      for (var r = 0; r < numVars; r++) {
        var sum = 0;
        for (var i = 0; i < n; i++) {
          sum += X[i][r] * volumes[i];
        }
        XtY[r] = sum;
      }

      var coeffs = solveLinearSystem(XtX, XtY);
      if (!coeffs) {
        // Fallback to simple linear regression
        var fallback = linearRegression(volumes);
        coeffs = [fallback.intercept, fallback.slope];
        for (var d = 1; d <= 6; d++) coeffs.push(0);
      }

      var fitted = [];
      for (var t = 0; t < n; t++) {
        var val = coeffs[0] + coeffs[1] * t;
        if (useDummies) {
          var dayIdx = t % 7;
          if (history[t] && history[t].period && ErlanglyUtils && ErlanglyUtils.parseDate) {
            var info = ErlanglyUtils.parseDate(history[t].period);
            if (info) dayIdx = info.dayOfWeek;
          }
          if (dayIdx >= 1 && dayIdx <= 6) {
            val += coeffs[1 + dayIdx];
          }
        }
        fitted.push(Math.max(0, val));
      }

      return {
        coeffs: coeffs,
        useDummies: useDummies,
        historyLength: n,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var coeffs = fitResult.coeffs;
      var useDummies = fitResult.useDummies;
      var N = fitResult.historyLength;

      for (var h = 1; h <= horizon; h++) {
        var t = N + h - 1;
        var dayIdx = t % 7;
        if (options && options.futureDates && options.futureDates[h - 1] && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var info = ErlanglyUtils.parseDate(options.futureDates[h - 1]);
          if (info) dayIdx = info.dayOfWeek;
        }

        var base = coeffs[0] + coeffs[1] * t;
        var dummyOffset = 0;
        if (useDummies && dayIdx >= 1 && dayIdx <= 6) {
          dummyOffset = coeffs[1 + dayIdx] || 0;
        }
        var raw = Math.max(0, base + dummyOffset);
        var pseudoIdx = base > 0 ? (raw / base) : 1.0;

        predictions.push({
          baseVolume: Math.max(0, base),
          trendFactor: 1.0,
          seasonalityIndex: pseudoIdx,
          rawVolume: raw
        });
      }
      return predictions;
    }
  });

  // =========================================================================
  // 3. COMPLETE TIME SERIES FORECASTING PIPELINE
  // =========================================================================

  /**
   * Main forecasting execution function
   *
   * @param {Array<Object>} rawHistory - [{ period, volume, aht }]
   * @param {string} modelId - e.g. 'wma', 'holt', 'decomp_mult', etc.
   * @param {Object} modelParams - parameters for selected model
   * @param {Object} pipelineOptions - { horizon, useSeasonality, growthModifier, assumedAht, holidays }
   * @returns {Object} Full forecast results & metrics
   */
  function executeForecast(rawHistory, modelId, modelParams, pipelineOptions) {
    if (!rawHistory || rawHistory.length === 0) {
      return {
        history: [],
        forecast: [],
        metrics: { mae: 0, mape: 0, rmse: 0, mse: 0, r2: 0 },
        model: modelId
      };
    }

    var model = MODEL_REGISTRY[modelId] || MODEL_REGISTRY['wma'];
    var options = pipelineOptions || {};
    var horizon = Math.max(1, parseInt(options.horizon, 10) || 8);
    var growthModifier = (parseFloat(options.growthModifier) || 0) / 100;
    var holidays = options.holidays || [];

    // 1. Preprocess history (holiday exclusion/scaling)
    var processedHistory = preprocessHistory(rawHistory, holidays);

    // 2. Fit selected model
    var fitResult = model.fit(processedHistory, modelParams || {});

    // 3. Generate future dates
    var lastItem = rawHistory[rawHistory.length - 1];
    var lastDateInfo = lastItem ? ErlanglyUtils.parseDate(lastItem.period) : null;
    var futureDates = [];

    for (var h = 1; h <= horizon; h++) {
      var nextPeriod = 'Future ' + h;
      if (lastDateInfo) {
        var nextDate = ErlanglyUtils.addDays(lastDateInfo, h);
        if (nextDate) nextPeriod = nextDate.isoDate;
      }
      futureDates.push(nextPeriod);
    }

    // 4. Generate raw predictions
    var rawPredictions = model.predict(fitResult, horizon, {
      futureDates: futureDates
    });

    // 5. Apply Global Seasonality / Growth / Holiday adjustments
    var holidayMap = {};
    holidays.forEach(function(ev) {
      if (ev && ev.date) holidayMap[ev.date] = ev;
    });

    var forecastResults = [];

    for (var h = 0; h < horizon; h++) {
      var periodName = futureDates[h];
      var pred = rawPredictions[h];
      var rawVol = pred.rawVolume;
      var trendFactor = pred.trendFactor || 1.0;
      var seasonIdx = pred.seasonalityIndex !== undefined ? pred.seasonalityIndex : 1.0;

      // Check for future holiday/event flag
      var ev = holidayMap[periodName];
      var holidayFactor = 1.0;
      var holidayName = null;

      if (ev && ev.action === 'scale') {
        holidayFactor = 1 + ((parseFloat(ev.impactPct) || 0) / 100);
        holidayName = ev.name;
      }

      var growthMult = 1.0 + growthModifier;
      var finalVolume = Math.max(0, Math.round(rawVol * growthMult * holidayFactor));

      forecastResults.push({
        period: periodName,
        baseVolume: pred.baseVolume !== undefined ? pred.baseVolume : rawVol,
        trendFactor: trendFactor,
        seasonalityIndex: seasonIdx,
        holidayFactor: holidayFactor,
        holidayName: holidayName,
        volume: finalVolume
      });
    }

    return {
      history: processedHistory,
      forecast: forecastResults,
      fitResult: fitResult,
      metrics: fitResult.metrics,
      modelId: model.id,
      modelName: model.name
    };
  }

  // =========================================================================
  // 4. BROWSER UI INTEGRATION
  // =========================================================================

  // Sample 28-Day contact center dataset
  var SAMPLE_HISTORY = [
    { period: '2026-05-01', volume: 1420, aht: 185 },
    { period: '2026-05-02', volume: 680, aht: 170 },
    { period: '2026-05-03', volume: 520, aht: 165 },
    { period: '2026-05-04', volume: 2150, aht: 195 },
    { period: '2026-05-05', volume: 1820, aht: 190 },
    { period: '2026-05-06', volume: 1710, aht: 185 },
    { period: '2026-05-07', volume: 1640, aht: 180 },
    { period: '2026-05-08', volume: 1480, aht: 185 },
    { period: '2026-05-09', volume: 710, aht: 170 },
    { period: '2026-05-10', volume: 540, aht: 165 },
    { period: '2026-05-11', volume: 2210, aht: 195 },
    { period: '2026-05-12', volume: 1860, aht: 190 },
    { period: '2026-05-13', volume: 1750, aht: 185 },
    { period: '2026-05-14', volume: 1690, aht: 180 },
    { period: '2026-05-15', volume: 1510, aht: 185 },
    { period: '2026-05-16', volume: 740, aht: 170 },
    { period: '2026-05-17', volume: 560, aht: 165 },
    { period: '2026-05-18', volume: 2280, aht: 195 },
    { period: '2026-05-19', volume: 1910, aht: 190 },
    { period: '2026-05-20', volume: 1790, aht: 185 },
    { period: '2026-05-21', volume: 1730, aht: 180 },
    { period: '2026-05-22', volume: 1540, aht: 185 },
    { period: '2026-05-23', volume: 760, aht: 170 },
    { period: '2026-05-24', volume: 580, aht: 165 },
    { period: '2026-05-25', volume: 2340, aht: 195 },
    { period: '2026-05-26', volume: 1960, aht: 190 },
    { period: '2026-05-27', volume: 1840, aht: 185 },
    { period: '2026-05-28', volume: 1780, aht: 180 }
  ];

  // Sample default holidays / events
  var SAMPLE_HOLIDAYS = [
    { date: '2026-05-25', name: 'Memorial Day Spike', impactPct: 20, action: 'scale' },
    { date: '2026-05-30', name: 'Weekend Promo Sale', impactPct: 50, action: 'scale' }
  ];

  var UIState = {
    history: [],
    holidays: [],
    modelId: 'holt',
    modelParams: {
      windowSize: 6,
      seasonLength: 7,
      alpha: 0.30,
      beta: 0.10,
      autoOptimize: false,
      includeDummies: true
    },
    horizon: 8,
    growthModifier: 0.0,
    assumedAht: 180,
    activeTab: 'history', // 'history' | 'csv' | 'holidays'
    compareMode: false,
    compareModelIds: ['holt', 'decomp_mult', 'trend'],
    chart: null,
    worker: null
  };

  function initUI() {
    setupTabSwitching();
    setupModelSelector();
    setupEventListeners();
    initWebWorker();
    handleIncomingHandoff();
  }

  function handleIncomingHandoff() {
    // Check shared link preview
    if (typeof window !== 'undefined' && window.ERLANGLY_SHARED_DATA) {
      var shared = window.ERLANGLY_SHARED_DATA;
      if (shared.history) UIState.history = shared.history;
      if (shared.holidays) UIState.holidays = shared.holidays;
      if (shared.modelId) UIState.modelId = shared.modelId;
      if (shared.modelParams) UIState.modelParams = shared.modelParams;
      if (shared.horizon) UIState.horizon = shared.horizon;
      if (shared.growthModifier !== undefined) UIState.growthModifier = shared.growthModifier;
      if (shared.assumedAht) UIState.assumedAht = shared.assumedAht;
      loadHistory(UIState.history);
      renderHolidaysTable();
      updateModelParamsUI();
      ErlanglyUtils.showToast('Restored shared forecast plan', 'info');
      return;
    }

    // Check plans dashboard handoff
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('from') === 'plans') {
      var saved = ErlanglyUtils.getHandoff('forecasting');
      if (saved) {
        if (saved.history) UIState.history = saved.history;
        if (saved.holidays) UIState.holidays = saved.holidays;
        if (saved.modelId) UIState.modelId = saved.modelId;
        if (saved.modelParams) UIState.modelParams = saved.modelParams;
        if (saved.horizon) UIState.horizon = saved.horizon;
        if (saved.growthModifier !== undefined) UIState.growthModifier = saved.growthModifier;
        if (saved.assumedAht) UIState.assumedAht = saved.assumedAht;
        loadHistory(UIState.history);
        renderHolidaysTable();
        updateModelParamsUI();
        ErlanglyUtils.showToast('Loaded plan from My Plans dashboard', 'success');
        return;
      }
    }

    // Default: load sample history
    UIState.holidays = SAMPLE_HOLIDAYS.slice();
    renderHolidaysTable();
    loadHistory(SAMPLE_HISTORY);
  }

  function setupTabSwitching() {
    var tabSample = document.getElementById('tab-history-sample');
    var tabCSV = document.getElementById('tab-history-csv');
    var tabHolidays = document.getElementById('tab-holidays');

    var secManual = document.getElementById('section-manual-history');
    var secCSV = document.getElementById('section-csv-history');
    var secHolidays = document.getElementById('section-holidays');

    function selectTab(active) {
      if (tabSample) tabSample.className = active === 'history' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      if (tabCSV) tabCSV.className = active === 'csv' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      if (tabHolidays) tabHolidays.className = active === 'holidays' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';

      if (secManual) secManual.style.display = active === 'history' ? 'block' : 'none';
      if (secCSV) secCSV.style.display = active === 'csv' ? 'flex' : 'none';
      if (secHolidays) secHolidays.style.display = active === 'holidays' ? 'block' : 'none';
      UIState.activeTab = active;
    }

    if (tabSample) tabSample.addEventListener('click', function() { selectTab('history'); });
    if (tabCSV) tabCSV.addEventListener('click', function() { selectTab('csv'); });
    if (tabHolidays) tabHolidays.addEventListener('click', function() { selectTab('holidays'); });
  }

  function setupModelSelector() {
    var selectModel = document.getElementById('select-model-type');
    if (!selectModel) return;

    selectModel.innerHTML = '';
    var categories = {};
    Object.keys(MODEL_REGISTRY).forEach(function(key) {
      var m = MODEL_REGISTRY[key];
      categories[m.category] = categories[m.category] || [];
      categories[m.category].push(m);
    });

    Object.keys(categories).forEach(function(cat) {
      var optgroup = document.createElement('optgroup');
      optgroup.label = cat;
      categories[cat].forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === UIState.modelId) opt.selected = true;
        optgroup.appendChild(opt);
      });
      selectModel.appendChild(optgroup);
    });

    selectModel.addEventListener('change', function() {
      UIState.modelId = selectModel.value;
      updateModelParamsUI();
      runForecast();
    });

    updateModelParamsUI();
  }

  function updateModelParamsUI() {
    var container = document.getElementById('dynamic-model-params');
    var descEl = document.getElementById('model-description-text');
    if (!container) return;

    var model = MODEL_REGISTRY[UIState.modelId] || MODEL_REGISTRY['wma'];
    if (descEl) descEl.textContent = model.description;

    container.innerHTML = '';

    if (model.id === 'wma' || model.id === 'sma') {
      container.innerHTML = 
        '<div class="form-group">' +
          '<label for="num-history-window" class="form-label">Lookback Window</label>' +
          '<div class="input-group">' +
            '<input type="number" id="num-history-window" class="form-control mono" min="2" max="52" value="' + (UIState.modelParams.windowSize || 6) + '">' +
            '<span class="input-addon">periods</span>' +
          '</div>' +
        '</div>';

      var inp = document.getElementById('num-history-window');
      if (inp) {
        inp.addEventListener('input', function() {
          UIState.modelParams.windowSize = Math.max(2, parseInt(inp.value, 10) || 6);
          runForecast();
        });
      }
    } else if (model.id === 'decomp_mult' || model.id === 'decomp_add') {
      container.innerHTML = 
        '<div class="form-group">' +
          '<label for="num-season-length" class="form-label">Seasonality Cycle Length</label>' +
          '<div class="input-group">' +
            '<input type="number" id="num-season-length" class="form-control mono" min="2" max="31" value="' + (UIState.modelParams.seasonLength || 7) + '">' +
            '<span class="input-addon">days</span>' +
          '</div>' +
          '<span class="form-hint">' + (model.id === 'decomp_mult' ? 'Multiplicative Trend × Season index' : 'Additive Trend + Season offset') + '</span>' +
        '</div>';

      var inp = document.getElementById('num-season-length');
      if (inp) {
        inp.addEventListener('input', function() {
          UIState.modelParams.seasonLength = Math.max(2, parseInt(inp.value, 10) || 7);
          runForecast();
        });
      }
    } else if (model.id === 'ses') {
      container.innerHTML = 
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">' +
          '<div class="form-group">' +
            '<div class="form-label"><span>Alpha (α)</span><span class="form-label-val" id="lbl-ses-alpha">' + (UIState.modelParams.alpha || 0.20) + '</span></div>' +
            '<input type="range" id="range-ses-alpha" min="0.01" max="0.99" step="0.01" value="' + (UIState.modelParams.alpha || 0.20) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Optimization</label>' +
            '<div style="display: flex; align-items: center; height: 36px; gap: var(--space-2);">' +
              '<input type="checkbox" id="chk-ses-auto" ' + (UIState.modelParams.autoOptimize ? 'checked' : '') + ' style="width: 18px; height: 18px; cursor: pointer;">' +
              '<span style="font-size: var(--text-xs); color: var(--text-secondary);">Auto Min-MSE</span>' +
            '</div>' +
          '</div>' +
        '</div>';

      var rangeA = document.getElementById('range-ses-alpha');
      var lblA = document.getElementById('lbl-ses-alpha');
      var chkAuto = document.getElementById('chk-ses-auto');

      if (rangeA) {
        rangeA.addEventListener('input', function() {
          UIState.modelParams.alpha = parseFloat(rangeA.value);
          if (lblA) lblA.textContent = rangeA.value;
          if (chkAuto) chkAuto.checked = false;
          UIState.modelParams.autoOptimize = false;
          runForecast();
        });
      }
      if (chkAuto) {
        chkAuto.addEventListener('change', function() {
          UIState.modelParams.autoOptimize = chkAuto.checked;
          runForecast();
          if (chkAuto.checked && rangeA && lblA) {
            rangeA.value = UIState.modelParams.alpha;
            lblA.textContent = UIState.modelParams.alpha;
          }
        });
      }
    } else if (model.id === 'holt') {
      container.innerHTML = 
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">' +
          '<div class="form-group">' +
            '<div class="form-label"><span>Level (α)</span><span class="form-label-val" id="lbl-holt-alpha">' + (UIState.modelParams.alpha || 0.30) + '</span></div>' +
            '<input type="range" id="range-holt-alpha" min="0.01" max="0.99" step="0.01" value="' + (UIState.modelParams.alpha || 0.30) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<div class="form-label"><span>Trend (β)</span><span class="form-label-val" id="lbl-holt-beta">' + (UIState.modelParams.beta || 0.10) + '</span></div>' +
            '<input type="range" id="range-holt-beta" min="0.01" max="0.50" step="0.01" value="' + (UIState.modelParams.beta || 0.10) + '">' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<div style="display: flex; align-items: center; justify-content: space-between;">' +
            '<label for="chk-holt-auto" class="form-label" style="margin: 0;">Parameter Search:</label>' +
            '<div style="display: flex; align-items: center; gap: var(--space-2);">' +
              '<input type="checkbox" id="chk-holt-auto" ' + (UIState.modelParams.autoOptimize ? 'checked' : '') + ' style="width: 18px; height: 18px; cursor: pointer;">' +
              '<span style="font-size: var(--text-xs); color: var(--text-secondary);">2D Grid Search (Min MSE)</span>' +
            '</div>' +
          '</div>' +
        '</div>';

      var rangeA = document.getElementById('range-holt-alpha');
      var lblA = document.getElementById('lbl-holt-alpha');
      var rangeB = document.getElementById('range-holt-beta');
      var lblB = document.getElementById('lbl-holt-beta');
      var chkAuto = document.getElementById('chk-holt-auto');

      if (rangeA) {
        rangeA.addEventListener('input', function() {
          UIState.modelParams.alpha = parseFloat(rangeA.value);
          if (lblA) lblA.textContent = rangeA.value;
          if (chkAuto) chkAuto.checked = false;
          UIState.modelParams.autoOptimize = false;
          runForecast();
        });
      }
      if (rangeB) {
        rangeB.addEventListener('input', function() {
          UIState.modelParams.beta = parseFloat(rangeB.value);
          if (lblB) lblB.textContent = rangeB.value;
          if (chkAuto) chkAuto.checked = false;
          UIState.modelParams.autoOptimize = false;
          runForecast();
        });
      }
      if (chkAuto) {
        chkAuto.addEventListener('change', function() {
          UIState.modelParams.autoOptimize = chkAuto.checked;
          runForecast();
          if (chkAuto.checked) {
            if (rangeA && lblA) { rangeA.value = UIState.modelParams.alpha; lblA.textContent = UIState.modelParams.alpha; }
            if (rangeB && lblB) { rangeB.value = UIState.modelParams.beta; lblB.textContent = UIState.modelParams.beta; }
          }
        });
      }
    } else if (model.id === 'regression') {
      container.innerHTML = 
        '<div class="form-group">' +
          '<div style="display: flex; align-items: center; justify-content: space-between;">' +
            '<label for="chk-reg-dummies" class="form-label" style="margin: 0;">Multi-variable Model:</label>' +
            '<div style="display: flex; align-items: center; gap: var(--space-2);">' +
              '<input type="checkbox" id="chk-reg-dummies" ' + (UIState.modelParams.includeDummies !== false ? 'checked' : '') + ' style="width: 18px; height: 18px; cursor: pointer;">' +
              '<span style="font-size: var(--text-xs); color: var(--text-secondary);">Include Day Dummies ($D_1..D_6$)</span>' +
            '</div>' +
          '</div>' +
          '<span class="form-hint">Solves $8\\times8$ OLS matrix system for trend + day shifts</span>' +
        '</div>';

      var chkD = document.getElementById('chk-reg-dummies');
      if (chkD) {
        chkD.addEventListener('change', function() {
          UIState.modelParams.includeDummies = chkD.checked;
          runForecast();
        });
      }
    }
  }

  function setupEventListeners() {
    var btnLoadSample = document.getElementById('btn-load-sample-forecast');
    var btnClearHistory = document.getElementById('btn-clear-history');
    var btnAddRow = document.getElementById('btn-add-row');

    var numHorizon = document.getElementById('num-forecast-horizon');
    var numGrowth = document.getElementById('num-growth-modifier');
    var numAht = document.getElementById('num-forecast-aht');
    var lblAht = document.getElementById('lbl-forecast-aht');

    var btnCompareToggle = document.getElementById('btn-toggle-comparison');
    var btnRunForecast = document.getElementById('btn-run-forecast');
    var btnExportCSV = document.getElementById('btn-export-forecast-csv');
    var btnSendCapacity = document.getElementById('btn-send-to-capacity');
    var btnSavePlan = document.getElementById('btn-save-forecast-plan');
    var btnSharePlan = document.getElementById('btn-share-forecast-plan');

    var btnAddHoliday = document.getElementById('btn-add-holiday');
    var btnClearHolidays = document.getElementById('btn-clear-holidays');

    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', function() {
        UIState.holidays = SAMPLE_HOLIDAYS.slice();
        renderHolidaysTable();
        loadHistory(SAMPLE_HISTORY);
        ErlanglyUtils.showToast('Loaded sample contact center history & holidays', 'success');
      });
    }

    if (btnClearHistory) {
      btnClearHistory.addEventListener('click', function() {
        loadHistory([]);
        ErlanglyUtils.showToast('Cleared historical volume series', 'info');
      });
    }

    if (btnAddRow) {
      btnAddRow.addEventListener('click', function() {
        var nextIdx = UIState.history.length + 1;
        var lastItem = UIState.history[UIState.history.length - 1];
        var nextPeriod = 'Period ' + nextIdx;
        if (lastItem && lastItem.period && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var lastInfo = ErlanglyUtils.parseDate(lastItem.period);
          if (lastInfo) {
            var nextDate = ErlanglyUtils.addDays(lastInfo, 1);
            if (nextDate) nextPeriod = nextDate.isoDate;
          }
        }
        UIState.history.push({ period: nextPeriod, volume: 1500, aht: 180 });
        renderHistoryTable();
        runForecast();
      });
    }

    if (numHorizon) {
      numHorizon.addEventListener('input', function() {
        UIState.horizon = Math.max(1, parseInt(numHorizon.value, 10) || 8);
        runForecast();
      });
    }

    if (numGrowth) {
      numGrowth.addEventListener('input', function() {
        UIState.growthModifier = parseFloat(numGrowth.value) || 0;
        runForecast();
      });
    }

    if (numAht) {
      numAht.addEventListener('input', function() {
        UIState.assumedAht = Math.max(10, parseInt(numAht.value, 10) || 180);
        if (lblAht) lblAht.textContent = UIState.assumedAht + 's';
        runForecast();
      });
    }

    if (btnCompareToggle) {
      btnCompareToggle.addEventListener('click', function() {
        UIState.compareMode = !UIState.compareMode;
        var compPanel = document.getElementById('panel-model-comparison');
        if (compPanel) compPanel.style.display = UIState.compareMode ? 'block' : 'none';
        btnCompareToggle.textContent = UIState.compareMode ? 'Hide Comparison View' : 'Compare 2–4 Models';
        btnCompareToggle.className = UIState.compareMode ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
        runForecast();
      });
    }

    if (btnRunForecast) {
      btnRunForecast.addEventListener('click', function() {
        runForecast();
        ErlanglyUtils.showToast('Recalculated demand forecast', 'success');
      });
    }

    // Holiday events management
    if (btnAddHoliday) {
      btnAddHoliday.addEventListener('click', function() {
        var defaultDate = '2026-06-01';
        if (UIState.history.length > 0) {
          var last = UIState.history[UIState.history.length - 1];
          if (last.period) defaultDate = last.period;
        }
        UIState.holidays.push({
          date: defaultDate,
          name: 'Special Event',
          impactPct: 25,
          action: 'scale'
        });
        renderHolidaysTable();
        runForecast();
      });
    }

    if (btnClearHolidays) {
      btnClearHolidays.addEventListener('click', function() {
        UIState.holidays = [];
        renderHolidaysTable();
        runForecast();
        ErlanglyUtils.showToast('Cleared all holiday and event flags', 'info');
      });
    }

    // Export CSV
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', function() {
        if (!UIState.lastForecast || UIState.lastForecast.forecast.length === 0) return;
        var headers = ['Future_Period', 'Algorithm', 'Base_Model_Volume', 'Trend_Factor', 'Seasonality_Index', 'Holiday_Factor', 'Holiday_Name', 'Projected_Volume', 'Assumed_AHT_Sec', 'Est_Erlangs'];
        var rows = UIState.lastForecast.forecast.map(function(r) {
          var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, UIState.assumedAht, 3600 * 8) : (r.volume * UIState.assumedAht / 28800);
          return [
            r.period,
            UIState.lastForecast.modelName,
            Math.round(r.baseVolume),
            r.trendFactor.toFixed(3),
            r.seasonalityIndex.toFixed(3),
            r.holidayFactor.toFixed(2),
            r.holidayName || 'None',
            Math.round(r.volume),
            UIState.assumedAht,
            erlangs.toFixed(2)
          ];
        });
        ErlanglyUtils.exportCSV('erlangly_forecast.csv', headers, rows);
      });
    }

    // Send to Capacity Planning
    if (btnSendCapacity) {
      btnSendCapacity.addEventListener('click', function() {
        if (!UIState.lastForecast || UIState.lastForecast.forecast.length === 0) return;
        var payload = {
          source: 'forecasting',
          aht: UIState.assumedAht,
          modelName: UIState.lastForecast.modelName,
          intervals: UIState.lastForecast.forecast.map(function(r) {
            return {
              interval: r.period,
              volume: Math.round(r.volume),
              aht: UIState.assumedAht
            };
          })
        };
        ErlanglyUtils.setHandoff('capacity', payload);
        window.location.href = 'capacity.html?from=forecast';
      });
    }

    // Save Plan Modal
    if (btnSavePlan) {
      btnSavePlan.addEventListener('click', function() {
        if (typeof window.ErlanglyPlans !== 'undefined' && window.ErlanglyPlans.showSaveModal) {
          var inputs = {
            history: UIState.history,
            holidays: UIState.holidays,
            modelId: UIState.modelId,
            modelParams: UIState.modelParams,
            horizon: UIState.horizon,
            growthModifier: UIState.growthModifier,
            assumedAht: UIState.assumedAht
          };
          var outputs = UIState.lastForecast ? {
            modelName: UIState.lastForecast.modelName,
            metrics: UIState.lastForecast.metrics,
            forecastCount: UIState.lastForecast.forecast.length,
            totalVolume: UIState.lastForecast.forecast.reduce(function(a, b) { return a + b.volume; }, 0)
          } : {};
          window.ErlanglyPlans.showSaveModal('forecasting', inputs, outputs);
        }
      });
    }

    // Share Plan Link
    if (btnSharePlan) {
      btnSharePlan.addEventListener('click', function() {
        if (typeof window.ErlanglyPlans !== 'undefined' && window.ErlanglyPlans.showShareModal) {
          var inputs = {
            history: UIState.history,
            holidays: UIState.holidays,
            modelId: UIState.modelId,
            modelParams: UIState.modelParams,
            horizon: UIState.horizon,
            growthModifier: UIState.growthModifier,
            assumedAht: UIState.assumedAht
          };
          window.ErlanglyPlans.showShareModal('forecasting', inputs);
        }
      });
    }

    // CSV File Dropzone
    var dropzone = document.getElementById('forecast-dropzone');
    var fileInput = document.getElementById('forecast-file-input');
    var selectAgg = document.getElementById('select-csv-aggregate');

    if (dropzone && fileInput) {
      ErlanglyUtils.wireFileDrop(dropzone, fileInput, function(text, file) {
        if (file && UIState.worker) {
          var pBox = document.getElementById('worker-progress-box');
          var sTxt = document.getElementById('worker-status-text');
          var pBar = document.getElementById('worker-progress-bar');
          var pTxt = document.getElementById('worker-pct-text');
          var stTxt = document.getElementById('worker-stats-text');

          if (pBox) pBox.style.display = 'block';
          if (sTxt) sTxt.textContent = 'Parsing ' + file.name + ' in Web Worker...';
          if (pBar) pBar.style.width = '0%';
          if (pTxt) pTxt.textContent = '0%';
          if (stTxt) stTxt.textContent = 'File size: ' + (file.size / (1024 * 1024)).toFixed(2) + ' MB';

          UIState.worker.postMessage({
            type: 'parse_file',
            file: file,
            aggregateLevel: selectAgg ? selectAgg.value : 'daily'
          });
        } else {
          var parsed = ErlanglyUtils.parseCSV(text);
          if (parsed.rows && parsed.rows.length > 0) {
            var rows = parsed.rows.map(function(r, i) {
              return {
                period: r.period || r.date || r.interval || ('Row ' + (i + 1)),
                volume: parseFloat(r.volume || r.calls || 100) || 100,
                aht: parseFloat(r.aht || 180) || 180
              };
            });
            loadHistory(rows);
            ErlanglyUtils.showToast('Parsed ' + rows.length + ' history periods', 'success');
          }
        }
      });
    }
  }

  function initWebWorker() {
    try {
      if (typeof Worker !== 'undefined') {
        UIState.worker = new Worker('js/workers/csv-parser.js');
        UIState.worker.onmessage = function(e) {
          var msg = e.data;
          var pBox = document.getElementById('worker-progress-box');
          var sTxt = document.getElementById('worker-status-text');
          var pBar = document.getElementById('worker-progress-bar');
          var pTxt = document.getElementById('worker-pct-text');
          var stTxt = document.getElementById('worker-stats-text');

          if (msg.type === 'progress') {
            if (pBar) pBar.style.width = msg.progress + '%';
            if (pTxt) pTxt.textContent = msg.progress + '%';
            if (stTxt) stTxt.textContent = 'Parsed ' + msg.parsedCount.toLocaleString() + ' rows (' + (msg.processedBytes / (1024 * 1024)).toFixed(1) + ' MB)';
          } else if (msg.type === 'complete') {
            if (pBar) pBar.style.width = '100%';
            if (pTxt) pTxt.textContent = '100%';
            if (sTxt) sTxt.textContent = 'Complete!';
            if (stTxt) stTxt.textContent = 'Successfully processed ' + msg.totalParsed.toLocaleString() + ' rows (skipped ' + msg.skippedCount + ' malformed).';

            setTimeout(function() {
              if (pBox) pBox.style.display = 'none';
            }, 3000);

            if (msg.rows && msg.rows.length > 0) {
              loadHistory(msg.rows);
              ErlanglyUtils.showToast('Loaded ' + msg.rows.length + ' aggregated periods from ' + msg.totalParsed.toLocaleString() + ' rows', 'success');
            }
          } else if (msg.type === 'error') {
            if (sTxt) sTxt.textContent = 'Error: ' + msg.message;
            ErlanglyUtils.showToast('Worker CSV error: ' + msg.message, 'error');
          }
        };
      }
    } catch (e) {
      console.warn('Web Worker not supported or blocked:', e);
    }
  }

  function loadHistory(rows) {
    var rawList = rows ? rows.slice() : [];
    var hasDates = false;
    for (var i = 0; i < Math.min(rawList.length, 20); i++) {
      if (rawList[i] && ErlanglyUtils.parseDate(rawList[i].period)) {
        hasDates = true;
        break;
      }
    }

    if (hasDates) {
      rawList.sort(function(a, b) {
        var infoA = ErlanglyUtils.parseDate(a.period);
        var infoB = ErlanglyUtils.parseDate(b.period);
        if (infoA && infoB) return infoA.timestamp - infoB.timestamp;
        if (infoA) return -1;
        if (infoB) return 1;
        return 0;
      });

      rawList.forEach(function(row) {
        var info = ErlanglyUtils.parseDate(row.period);
        if (info) row.period = info.isoDate;
      });
    }

    UIState.history = rawList;
    renderHistoryTable();
    runForecast();
  }

  function renderHistoryTable() {
    var tbody = document.getElementById('tbody-history-inputs');
    var countLbl = document.getElementById('lbl-history-count');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countLbl) countLbl.textContent = UIState.history.length;

    if (UIState.history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No historical data. Load sample or upload CSV.</td></tr>';
      return;
    }

    UIState.history.forEach(function(row, idx) {
      var tr = document.createElement('tr');

      var tdPeriod = document.createElement('td');
      var inputPeriod = document.createElement('input');
      inputPeriod.type = 'text';
      inputPeriod.className = 'form-control mono';
      inputPeriod.style.height = '28px';
      inputPeriod.style.fontSize = 'var(--text-xs)';
      inputPeriod.value = row.period;
      inputPeriod.addEventListener('input', function() { row.period = inputPeriod.value; });
      inputPeriod.addEventListener('change', function() {
        row.period = inputPeriod.value.trim();
        var info = ErlanglyUtils.parseDate(row.period);
        if (info) {
          row.period = info.isoDate;
          loadHistory(UIState.history);
        } else {
          runForecast();
        }
      });
      tdPeriod.appendChild(inputPeriod);

      var tdVol = document.createElement('td');
      var inputVol = document.createElement('input');
      inputVol.type = 'number';
      inputVol.className = 'form-control mono';
      inputVol.style.height = '28px';
      inputVol.style.fontSize = 'var(--text-xs)';
      inputVol.value = Math.round(row.volume);
      inputVol.addEventListener('input', function() {
        row.volume = Math.max(0, parseFloat(inputVol.value) || 0);
        runForecast();
      });
      tdVol.appendChild(inputVol);

      var tdAction = document.createElement('td');
      var btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm';
      btnDel.style.padding = '0 6px';
      btnDel.style.color = 'var(--danger)';
      btnDel.textContent = '✕';
      btnDel.title = 'Remove row';
      btnDel.addEventListener('click', function() {
        UIState.history.splice(idx, 1);
        renderHistoryTable();
        runForecast();
      });
      tdAction.appendChild(btnDel);

      tr.appendChild(tdPeriod);
      tr.appendChild(tdVol);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });
  }

  function renderHolidaysTable() {
    var tbody = document.getElementById('tbody-holidays');
    var badgeCount = document.getElementById('lbl-holidays-count');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badgeCount) badgeCount.textContent = UIState.holidays.length;

    if (UIState.holidays.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No events defined. Click "+ Add Event" to tag dates.</td></tr>';
      return;
    }

    UIState.holidays.forEach(function(ev, idx) {
      var tr = document.createElement('tr');

      var tdDate = document.createElement('td');
      var inDate = document.createElement('input');
      inDate.type = 'text';
      inDate.className = 'form-control mono';
      inDate.style.height = '28px';
      inDate.style.fontSize = 'var(--text-xs)';
      inDate.value = ev.date;
      inDate.addEventListener('change', function() {
        ev.date = inDate.value.trim();
        runForecast();
      });
      tdDate.appendChild(inDate);

      var tdName = document.createElement('td');
      var inName = document.createElement('input');
      inName.type = 'text';
      inName.className = 'form-control';
      inName.style.height = '28px';
      inName.style.fontSize = 'var(--text-xs)';
      inName.value = ev.name;
      inName.addEventListener('change', function() {
        ev.name = inName.value.trim();
        runForecast();
      });
      tdName.appendChild(inName);

      var tdAction = document.createElement('td');
      var selAction = document.createElement('select');
      selAction.className = 'form-control mono';
      selAction.style.height = '28px';
      selAction.style.fontSize = 'var(--text-xs)';
      selAction.innerHTML = 
        '<option value="scale" ' + (ev.action === 'scale' ? 'selected' : '') + '>Scale: ' + (ev.impactPct >= 0 ? '+' : '') + ev.impactPct + '%</option>' +
        '<option value="exclude" ' + (ev.action === 'exclude' ? 'selected' : '') + '>Exclude (Outlier)</option>';
      selAction.addEventListener('change', function() {
        ev.action = selAction.value;
        runForecast();
      });
      tdAction.appendChild(selAction);

      var tdDel = document.createElement('td');
      var btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm';
      btnDel.style.padding = '0 6px';
      btnDel.style.color = 'var(--danger)';
      btnDel.textContent = '✕';
      btnDel.title = 'Remove event';
      btnDel.addEventListener('click', function() {
        UIState.holidays.splice(idx, 1);
        renderHolidaysTable();
        runForecast();
      });
      tdDel.appendChild(btnDel);

      tr.appendChild(tdDate);
      tr.appendChild(tdName);
      tr.appendChild(tdAction);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function runForecast() {
    if (!UIState.history || UIState.history.length === 0) {
      clearForecastDisplay();
      return;
    }

    var options = {
      horizon: UIState.horizon,
      growthModifier: UIState.growthModifier,
      assumedAht: UIState.assumedAht,
      holidays: UIState.holidays
    };

    // 1. Run main active forecast
    var result = executeForecast(UIState.history, UIState.modelId, UIState.modelParams, options);
    UIState.lastForecast = result;

    // Sync auto-optimized parameters back to UIState
    if (result.fitResult) {
      if (result.fitResult.alpha !== undefined) UIState.modelParams.alpha = result.fitResult.alpha;
      if (result.fitResult.beta !== undefined) UIState.modelParams.beta = result.fitResult.beta;
    }

    // 2. Run model comparison if comparison view is open
    var comparisonResults = [];
    if (UIState.compareMode) {
      var modelsToCompare = UIState.compareModelIds.length > 0 ? UIState.compareModelIds : ['holt', 'decomp_mult', 'trend'];
      modelsToCompare.forEach(function(mId) {
        var compRes = executeForecast(UIState.history, mId, UIState.modelParams, options);
        comparisonResults.push(compRes);
      });
    }

    // 3. Update KPI metrics cards
    updateSummaryKPIs(result);

    // 4. Render Forecast breakdown table
    renderForecastTable(result);

    // 5. Render Chart.js
    renderChart(result, comparisonResults);

    // 6. Render Model Comparison table
    if (UIState.compareMode) {
      renderComparisonTable(comparisonResults);
    }
  }

  function updateSummaryKPIs(result) {
    var histTotal = UIState.history.reduce(function(a, b) { return a + b.volume; }, 0);
    var histAvg = UIState.history.length > 0 ? (histTotal / UIState.history.length) : 0;

    var fcTotal = result.forecast.reduce(function(a, b) { return a + b.volume; }, 0);
    var fcAvg = result.forecast.length > 0 ? (fcTotal / result.forecast.length) : 0;

    var peakVol = 0;
    var peakTime = '--';
    result.forecast.forEach(function(f) {
      if (f.volume > peakVol) {
        peakVol = f.volume;
        peakTime = f.period;
      }
    });

    var growthRate = histAvg > 0 ? ((fcAvg - histAvg) / histAvg) : 0;

    var statHistTotal = document.getElementById('stat-hist-total');
    var statHistCount = document.getElementById('stat-hist-count');
    var statHistAvg = document.getElementById('stat-hist-avg');
    var statFcTotal = document.getElementById('stat-fc-total');
    var statFcCount = document.getElementById('stat-fc-count');
    var statFcAvg = document.getElementById('stat-fc-avg');
    var statGrowthPct = document.getElementById('stat-growth-pct');
    var statFcPeak = document.getElementById('stat-fc-peak');
    var statFcPeakTime = document.getElementById('stat-fc-peak-time');

    var statMape = document.getElementById('stat-fit-mape');
    var statR2 = document.getElementById('stat-fit-r2');

    if (statHistTotal) statHistTotal.textContent = ErlanglyUtils.formatNumber(histTotal);
    if (statHistCount) statHistCount.textContent = UIState.history.length + ' periods';
    if (statHistAvg) statHistAvg.textContent = ErlanglyUtils.formatNumber(Math.round(histAvg));

    if (statFcTotal) statFcTotal.textContent = ErlanglyUtils.formatNumber(fcTotal);
    if (statFcCount) statFcCount.textContent = result.forecast.length + ' future periods';
    if (statFcAvg) statFcAvg.textContent = ErlanglyUtils.formatNumber(Math.round(fcAvg));

    if (statGrowthPct) {
      var growthPrefix = growthRate >= 0 ? '+' : '';
      statGrowthPct.textContent = growthPrefix + (growthRate * 100).toFixed(1) + '% vs hist avg';
      statGrowthPct.className = 'metric-subtext ' + (growthRate >= 0 ? 'text-success' : 'text-warn');
    }

    if (statFcPeak) statFcPeak.textContent = ErlanglyUtils.formatNumber(peakVol);
    if (statFcPeakTime) statFcPeakTime.textContent = 'At ' + peakTime;

    if (statMape) statMape.textContent = result.metrics.mape.toFixed(1) + '%';
    if (statR2) statR2.textContent = result.metrics.r2.toFixed(1) + '%';
  }

  function renderForecastTable(result) {
    var tbody = document.getElementById('tbody-forecast-results');
    var countLbl = document.getElementById('lbl-forecast-table-count');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countLbl) countLbl.textContent = result.forecast.length;

    result.forecast.forEach(function(r) {
      var tr = document.createElement('tr');
      var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, UIState.assumedAht, 3600 * 8) : (r.volume * UIState.assumedAht / 28800);

      var eventBadge = '';
      if (r.holidayName) {
        eventBadge = ' <span class="badge badge-warn" style="margin-left: 4px; font-size: 10px;">🎉 ' + r.holidayName + '</span>';
      }

      tr.innerHTML = 
        '<td class="mono"><strong>' + r.period + '</strong>' + eventBadge + '</td>' +
        '<td class="mono">' + Math.round(r.baseVolume).toLocaleString() + '</td>' +
        '<td class="mono">' + r.trendFactor.toFixed(2) + 'x</td>' +
        '<td class="mono ' + (r.seasonalityIndex > 1.1 ? 'text-accent' : (r.seasonalityIndex < 0.9 ? 'text-muted' : '')) + '">' + (r.seasonalityIndex * 100).toFixed(0) + '%</td>' +
        '<td class="mono text-accent"><strong>' + Math.round(r.volume).toLocaleString() + '</strong></td>' +
        '<td class="mono">' + erlangs.toFixed(2) + '</td>';

      tbody.appendChild(tr);
    });
  }

  function renderComparisonTable(compResults) {
    var tbody = document.getElementById('tbody-model-comparison');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (compResults.length === 0) return;

    // Find best MAPE
    var minMAPE = Math.min.apply(null, compResults.map(function(c) { return c.metrics.mape; }));

    compResults.forEach(function(c) {
      var tr = document.createElement('tr');
      var isBest = Math.abs(c.metrics.mape - minMAPE) < 0.001;
      var isActive = c.modelId === UIState.modelId;
      var totalVol = c.forecast.reduce(function(a, b) { return a + b.volume; }, 0);

      tr.innerHTML = 
        '<td>' +
          '<strong>' + c.modelName + '</strong>' +
          (isBest ? ' <span class="badge badge-success" style="font-size: 10px; margin-left: 4px;">Best Fit</span>' : '') +
          (isActive ? ' <span class="badge badge-neutral" style="font-size: 10px; margin-left: 4px;">Active</span>' : '') +
        '</td>' +
        '<td class="mono text-accent"><strong>' + c.metrics.mape.toFixed(1) + '%</strong></td>' +
        '<td class="mono">' + Math.round(c.metrics.mae).toLocaleString() + '</td>' +
        '<td class="mono">' + Math.round(c.metrics.rmse).toLocaleString() + '</td>' +
        '<td class="mono">' + c.metrics.r2.toFixed(1) + '%</td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(totalVol) + '</td>' +
        '<td>' +
          '<button class="btn btn-sm ' + (isActive ? 'btn-ghost' : 'btn-secondary') + '" style="font-size: 11px; height: 26px;" data-select-model="' + c.modelId + '">' +
            (isActive ? 'Active' : 'Select') +
          '</button>' +
        '</td>';

      var btnSel = tr.querySelector('[data-select-model]');
      if (btnSel && !isActive) {
        btnSel.addEventListener('click', function() {
          UIState.modelId = c.modelId;
          var sel = document.getElementById('select-model-type');
          if (sel) sel.value = c.modelId;
          updateModelParamsUI();
          runForecast();
          ErlanglyUtils.showToast('Switched active model to ' + c.modelName, 'success');
        });
      }

      tbody.appendChild(tr);
    });
  }

  function renderChart(result, compResults) {
    var canvas = document.getElementById('chart-forecast');
    if (!canvas || typeof Chart === 'undefined') return;

    var histLabels = UIState.history.map(function(h) { return h.period; });
    var histData = UIState.history.map(function(h) { return h.volume; });

    var fcLabels = result.forecast.map(function(f) { return f.period; });
    var combinedLabels = histLabels.concat(fcLabels);

    // Padding for history series
    var paddedHist = histData.concat(new Array(fcLabels.length).fill(null));

    // Pad forecast series to bridge smoothly with last historical point
    function createPaddedForecast(forecastList) {
      var arr = new Array(Math.max(0, histLabels.length - 1)).fill(null);
      if (histData.length > 0) {
        arr.push(histData[histData.length - 1]);
      }
      return arr.concat(forecastList.map(function(f) { return f.volume; }));
    }

    var datasets = [
      {
        label: 'Historical Actuals',
        data: paddedHist,
        borderColor: '#00d2d3',
        backgroundColor: 'rgba(0, 210, 211, 0.08)',
        borderWidth: 2,
        pointRadius: combinedLabels.length > 50 ? 0 : 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.2
      },
      {
        label: result.modelName + ' (Active)',
        data: createPaddedForecast(result.forecast),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderWidth: 2.5,
        borderDash: [5, 5],
        pointRadius: combinedLabels.length > 50 ? 0 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#10b981',
        fill: !UIState.compareMode,
        tension: 0.2
      }
    ];

    // If in compare mode, add comparison model datasets
    if (UIState.compareMode && compResults && compResults.length > 0) {
      var compareColors = ['#f59e0b', '#a855f7', '#38bdf8', '#ec4899'];
      var cIdx = 0;
      compResults.forEach(function(cr) {
        if (cr.modelId !== result.modelId) {
          var color = compareColors[cIdx % compareColors.length];
          cIdx++;
          datasets.push({
            label: cr.modelName,
            data: createPaddedForecast(cr.forecast),
            borderColor: color,
            borderWidth: 2,
            borderDash: [2, 4],
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: color,
            fill: false,
            tension: 0.2
          });
        }
      });
    }

    if (UIState.chart) {
      UIState.chart.data.labels = combinedLabels;
      UIState.chart.data.datasets = datasets;
      UIState.chart.update();
      return;
    }

    var ctx = canvas.getContext('2d');
    UIState.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: combinedLabels,
        datasets: datasets
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
            display: UIState.compareMode,
            labels: {
              color: '#94a3b8',
              font: { family: 'IBM Plex Mono', size: 11 },
              boxWidth: 12
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#2b3954',
            borderWidth: 1,
            titleFont: { family: 'IBM Plex Mono', size: 12 },
            bodyFont: { family: 'IBM Plex Mono', size: 12 },
            callbacks: {
              label: function(context) {
                var val = context.parsed.y;
                return context.dataset.label + ': ' + (val !== null ? Math.round(val).toLocaleString() + ' calls' : '');
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: {
              color: '#64748b',
              font: { family: 'IBM Plex Mono', size: 10 },
              maxTicksLimit: 14
            }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'IBM Plex Mono', size: 11 },
              callback: function(val) { return Number(val).toLocaleString(); }
            }
          }
        }
      }
    });
  }

  function clearForecastDisplay() {
    var ids = ['stat-hist-total', 'stat-hist-avg', 'stat-fc-total', 'stat-fc-avg', 'stat-fc-peak', 'stat-fit-mape', 'stat-fit-r2'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '--';
    });
    var tbody = document.getElementById('tbody-forecast-results');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No forecast calculated.</td></tr>';
    if (UIState.chart) {
      UIState.chart.data.labels = [];
      UIState.chart.data.datasets = [];
      UIState.chart.update();
    }
  }

  // Auto-init on browser DOM ready
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      initUI();
    }
  }

  // Export module for testing and programmatic execution
  return {
    models: MODEL_REGISTRY,
    registerModel: registerModel,
    linearRegression: linearRegression,
    solveLinearSystem: solveLinearSystem,
    calculateFitMetrics: calculateFitMetrics,
    preprocessHistory: preprocessHistory,
    executeForecast: executeForecast,
    SAMPLE_HISTORY: SAMPLE_HISTORY,
    SAMPLE_HOLIDAYS: SAMPLE_HOLIDAYS
  };
});
