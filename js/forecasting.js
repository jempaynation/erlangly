/**
 * Erlangly Forecasting Tool (js/forecasting.js)
 * 
 * Phase 8 & Phase 12: Advanced Time-Series Forecasting & Accuracy Suite
 * Features:
 * - Pluggable model architecture with common interface (fit, predict, metrics)
 * - 10 Time-series forecasting algorithms:
 *   1. Weighted Moving Average (WMA)
 *   2. Simple Moving Average (SMA)
 *   3. Linear Trend Projection (OLS)
 *   4. Seasonal Decomposition (Multiplicative)
 *   5. Seasonal Decomposition (Additive)
 *   6. Simple Exponential Smoothing (SES) with auto-optimization
 *   7. Holt's Double Exponential Smoothing (Trend-aware) with auto-optimization
 *   8. Multi-Variable Regression (with Day-of-Week dummy variables)
 *   9. Year-over-Year Seasonal Trend Projection (YoY) with 12-month guard
 *   10. Ensemble / Blended Forecast with Auto/Manual weighting
 * - Walk-Forward Out-of-Sample Backtesting (MAE, MAPE, RMSE, WAPE, Overfit Gap)
 * - Forecast Accuracy Tracking Tool (WAPE, MAPE, Signed Bias %, Tracking Signal)
 * - Multi-run Accuracy History Log & Persistence
 * - Holiday & Event flag system (multiplicative scaling or outlier exclusion)
 * - User-defined Trend Profiles (Monthly billing, week-of-month, biweekly pay, etc.)
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
   * Calculate standard in-sample forecast fit metrics (MAE, MAPE, RMSE, MSE, R2, WAPE, Bias)
   */
  function calculateFitMetrics(actuals, fitted) {
    var n = Math.min(actuals.length, fitted.length);
    if (n === 0) return { mae: 0, mape: 0, rmse: 0, mse: 0, r2: 0, wape: 0, biasPct: 0 };

    var sumAbsErr = 0;
    var sumPctErr = 0;
    var sumSqErr = 0;
    var sumActual = 0;
    var sumFitted = 0;
    var validPctCount = 0;

    for (var i = 0; i < n; i++) {
      var act = actuals[i];
      var fit = fitted[i];
      var err = act - fit;
      sumAbsErr += Math.abs(err);
      sumSqErr += (err * err);
      sumActual += act;
      sumFitted += fit;

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
    var wape = sumActual > 0 ? (sumAbsErr / sumActual) * 100 : 0;
    var biasPct = sumActual > 0 ? ((sumFitted - sumActual) / sumActual) * 100 : 0;

    return {
      mae: mae,
      mape: mape,
      rmse: rmse,
      mse: mse,
      r2: r2,
      wape: wape,
      biasPct: biasPct
    };
  }

  /**
   * Phase 12: Calculate comprehensive forecast accuracy metrics for a set of actuals vs forecasts.
   * Standard WFM metrics:
   * - WAPE %: Volume-weighted absolute error = sum(|A - F|) / sum(A) * 100
   * - MAPE %: Mean absolute percentage error = avg(|A - F| / A) * 100
   * - Signed Bias %: Systematic over/under-forecast = sum(F - A) / sum(A) * 100 (+ = over, - = under)
   * - MAE: Mean absolute error in units (calls)
   * - RMSE: Root mean squared error in units (calls)
   * - Tracking Signal: Cumulative error / MAD
   */
  function calculateAccuracyMetrics(actuals, forecasts) {
    var n = Math.min(actuals.length, forecasts.length);
    if (n === 0) {
      return {
        count: 0,
        mae: 0,
        mape: 0,
        rmse: 0,
        mse: 0,
        wape: 0,
        biasPct: 0,
        trackingSignal: 0,
        totalActual: 0,
        totalForecast: 0,
        varianceTotal: 0,
        details: []
      };
    }

    var sumAbsErr = 0;
    var sumSignedErr = 0; // F - A
    var sumSqErr = 0;
    var sumActual = 0;
    var sumForecast = 0;
    var validPctCount = 0;
    var sumPctErr = 0;
    var details = [];
    var cumSignedErr = 0;

    for (var i = 0; i < n; i++) {
      var act = actuals[i];
      var fc = forecasts[i];
      var err = fc - act; // signed error (positive = over-forecast)
      var absErr = Math.abs(err);

      sumAbsErr += absErr;
      sumSignedErr += err;
      sumSqErr += (err * err);
      sumActual += act;
      sumForecast += fc;
      cumSignedErr += err;

      var pctErr = act > 0 ? (absErr / act) * 100 : 0;
      var signedPct = act > 0 ? (err / act) * 100 : 0;

      if (act > 0) {
        sumPctErr += (absErr / act);
        validPctCount++;
      }

      details.push({
        index: i,
        actual: act,
        forecast: fc,
        error: err,
        absError: absErr,
        pctError: pctErr,
        signedPct: signedPct,
        cumBias: sumActual > 0 ? (cumSignedErr / sumActual) * 100 : 0
      });
    }

    var mae = sumAbsErr / n;
    var mape = validPctCount > 0 ? (sumPctErr / validPctCount) * 100 : 0;
    var mse = sumSqErr / n;
    var rmse = Math.sqrt(mse);
    var wape = sumActual > 0 ? (sumAbsErr / sumActual) * 100 : 0;
    var biasPct = sumActual > 0 ? (sumSignedErr / sumActual) * 100 : 0;
    var trackingSignal = mae > 0 ? (sumSignedErr / mae) : 0;

    return {
      count: n,
      mae: mae,
      mape: mape,
      rmse: rmse,
      mse: mse,
      wape: wape,
      biasPct: biasPct,
      trackingSignal: trackingSignal,
      totalActual: sumActual,
      totalForecast: sumForecast,
      varianceTotal: sumForecast - sumActual,
      details: details
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
          // Reference day = 0. Dummies for 1..6
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

  // --- MODEL 9: Year-over-Year Seasonal Trend Projection (Phase 12) ---
  registerModel({
    id: 'yoy_trend',
    name: 'Year-over-Year (YoY) Seasonal Trend',
    category: 'Year-over-Year',
    description: 'Projects volume from matched calendar periods 1 year prior (52 weeks / 365 days) blended with trailing YoY growth rate and seasonal indices. Requires ≥ 12 months history (24+ months recommended).',
    minHistoryRequired: 52, // 52 weeks or 365 daily periods
    params: [
      { id: 'lookbackWeeks', label: 'YoY Trailing Lookback', type: 'number', default: 8, min: 2, max: 52, step: 1, unit: 'periods' }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var lookback = Math.max(2, parseInt(params.lookbackWeeks, 10) || 8);

      // Check date span and length
      var hasSufficientHistory = n >= 52;
      var dateMap = {};
      var firstInfo = history[0] && history[0].period ? ErlanglyUtils.parseDate(history[0].period) : null;
      var lastInfo = history[n - 1] && history[n - 1].period ? ErlanglyUtils.parseDate(history[n - 1].period) : null;
      
      var daySpan = 0;
      if (firstInfo && lastInfo) {
        daySpan = Math.round((lastInfo.timestamp - firstInfo.timestamp) / 86400000);
        if (daySpan >= 360) hasSufficientHistory = true;
      }

      history.forEach(function(row, idx) {
        var info = ErlanglyUtils.parseDate(row.period);
        if (info) {
          dateMap[info.isoDate] = { volume: row.volume, index: idx };
        }
      });

      // Fallback if history is insufficient (< 12 months / < 52 periods / < 360 days)
      if (!hasSufficientHistory) {
        var fallbackReg = linearRegression(volumes);
        var fittedFallback = [];
        for (var t = 0; t < n; t++) {
          fittedFallback.push(Math.max(0, fallbackReg.intercept + fallbackReg.slope * t));
        }
        return {
          insufficientHistory: true,
          requiredHistoryMonths: 12,
          currentHistoryCount: n,
          daySpan: daySpan,
          yoyGrowthRate: 0,
          intercept: fallbackReg.intercept,
          slope: fallbackReg.slope,
          historyLength: n,
          fitted: fittedFallback,
          metrics: calculateFitMetrics(volumes, fittedFallback)
        };
      }

      // Compute YoY Growth Rate: compare trailing recent window to same window 1 year prior (52 weeks / 364 days ago)
      var offsetPeriods = (daySpan >= 360 && n >= 300) ? 364 : (n >= 52 ? 52 : 364);
      var recentWindow = Math.min(lookback, Math.floor(n / 4));
      var recentSum = 0;
      var priorYearSum = 0;
      var pairedCount = 0;

      for (var k = 0; k < recentWindow; k++) {
        var recentIdx = n - 1 - k;
        var priorIdx = recentIdx - offsetPeriods;
        if (priorIdx >= 0 && volumes[priorIdx] > 0) {
          recentSum += volumes[recentIdx];
          priorYearSum += volumes[priorIdx];
          pairedCount++;
        }
      }

      var yoyGrowthRate = (pairedCount > 0 && priorYearSum > 0) ? ((recentSum - priorYearSum) / priorYearSum) : 0;
      yoyGrowthRate = Math.max(-0.50, Math.min(1.00, yoyGrowthRate));

      // Day-of-week seasonality indices
      var bucketSums = new Array(7).fill(0);
      var bucketCounts = new Array(7).fill(0);
      for (var t = 0; t < n; t++) {
        var dayIdx = t % 7;
        if (history[t] && history[t].period) {
          var info = ErlanglyUtils.parseDate(history[t].period);
          if (info) dayIdx = info.dayOfWeek;
        }
        bucketSums[dayIdx] += volumes[t];
        bucketCounts[dayIdx]++;
      }
      var meanVol = volumes.reduce(function(a, b) { return a + b; }, 0) / n;
      var seasonalIndices = new Array(7).fill(1.0);
      for (var d = 0; d < 7; d++) {
        if (bucketCounts[d] > 0 && meanVol > 0) {
          seasonalIndices[d] = (bucketSums[d] / bucketCounts[d]) / meanVol;
        }
      }

      // In-sample fitted series
      var fitted = [];
      for (var t = 0; t < n; t++) {
        var priorT = t - offsetPeriods;
        if (priorT >= 0) {
          var priorVol = volumes[priorT];
          fitted.push(Math.max(0, priorVol * (1 + yoyGrowthRate)));
        } else {
          var dayIdx = t % 7;
          if (history[t] && history[t].period) {
            var info = ErlanglyUtils.parseDate(history[t].period);
            if (info) dayIdx = info.dayOfWeek;
          }
          fitted.push(Math.max(0, meanVol * seasonalIndices[dayIdx]));
        }
      }

      return {
        insufficientHistory: false,
        offsetPeriods: offsetPeriods,
        yoyGrowthRate: yoyGrowthRate,
        seasonalIndices: seasonalIndices,
        dateMap: dateMap,
        historyLength: n,
        history: history,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var n = fitResult.historyLength;

      if (fitResult.insufficientHistory) {
        for (var h = 1; h <= horizon; h++) {
          var raw = Math.max(0, fitResult.intercept + fitResult.slope * (n + h - 1));
          predictions.push({
            baseVolume: raw,
            trendFactor: 1.0,
            seasonalityIndex: 1.0,
            rawVolume: raw,
            warning: 'History < 12 months; fallback trend used.'
          });
        }
        return predictions;
      }

      var growth = fitResult.yoyGrowthRate;
      var offset = fitResult.offsetPeriods;
      var dateMap = fitResult.dateMap || {};
      var history = fitResult.history || [];

      for (var h = 1; h <= horizon; h++) {
        var futureDateStr = options && options.futureDates ? options.futureDates[h - 1] : null;
        var matchedPriorVolume = null;

        // 1. Try exact calendar matching 52 weeks (364 days) prior for day-of-week alignment
        if (futureDateStr && ErlanglyUtils && ErlanglyUtils.parseDate) {
          var fInfo = ErlanglyUtils.parseDate(futureDateStr);
          if (fInfo) {
            var prior364 = ErlanglyUtils.addDays(fInfo, -364);
            if (prior364 && dateMap[prior364.isoDate] !== undefined) {
              matchedPriorVolume = dateMap[prior364.isoDate].volume;
            } else {
              var prior365 = ErlanglyUtils.addDays(fInfo, -365);
              if (prior365 && dateMap[prior365.isoDate] !== undefined) {
                matchedPriorVolume = dateMap[prior365.isoDate].volume;
              }
            }
          }
        }

        // 2. Index offset fallback
        if (matchedPriorVolume === null) {
          var priorIdx = n + h - 1 - offset;
          if (priorIdx >= 0 && priorIdx < history.length) {
            matchedPriorVolume = history[priorIdx].volume;
          } else if (history.length > 0) {
            matchedPriorVolume = history[history.length - 1].volume;
          } else {
            matchedPriorVolume = 1000;
          }
        }

        var projected = Math.max(0, matchedPriorVolume * (1 + growth));
        predictions.push({
          baseVolume: matchedPriorVolume,
          trendFactor: 1 + growth,
          seasonalityIndex: 1.0,
          rawVolume: projected,
          priorVolumeMatched: matchedPriorVolume
        });
      }
      return predictions;
    }
  });

  // --- MODEL 10: Ensemble / Blended Forecast Model (Phase 12) ---
  registerModel({
    id: 'ensemble',
    name: 'Ensemble / Blended Forecast',
    category: 'Ensemble',
    description: 'Combines 2+ time series models into a unified forecast via weighted average, with auto-derived weights (from out-of-sample backtest accuracy) or manual sliders.',
    params: [
      { id: 'weightMode', label: 'Weighting Strategy', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'Auto (Inverse Backtest RMSE)' }, { value: 'manual', label: 'Manual Weights' }] },
      { id: 'selectedModels', label: 'Models to Combine', type: 'multiselect', default: ['holt', 'decomp_mult', 'trend'] }
    ],
    fit: function(history, params) {
      var volumes = history.map(function(h) { return h.volume; });
      var n = volumes.length;
      var selected = params.selectedModels && params.selectedModels.length > 0
        ? params.selectedModels.filter(function(id) { return id !== 'ensemble' && MODEL_REGISTRY[id]; })
        : ['holt', 'decomp_mult', 'trend'];

      if (selected.length === 0) selected = ['holt', 'decomp_mult', 'trend'];

      var mode = params.weightMode || 'auto';
      var weights = {};

      if (mode === 'auto') {
        var holdout = Math.min(Math.max(3, Math.floor(n * 0.2)), 14);
        var rawWeights = {};
        var sumInvErr = 0;

        selected.forEach(function(mId) {
          var bt = backtestModel(history, mId, params, holdout, {});
          var errScore = bt.outOfSampleMetrics ? Math.max(1, bt.outOfSampleMetrics.rmse) : 100;
          var inv = 1 / errScore;
          rawWeights[mId] = inv;
          sumInvErr += inv;
        });

        selected.forEach(function(mId) {
          weights[mId] = sumInvErr > 0 ? (rawWeights[mId] / sumInvErr) : (1 / selected.length);
        });
      } else {
        var manual = params.manualWeights || {};
        var sumManual = 0;
        selected.forEach(function(mId) {
          var w = parseFloat(manual[mId]);
          if (isNaN(w) || w <= 0) w = 1.0;
          sumManual += w;
        });
        selected.forEach(function(mId) {
          var w = parseFloat(manual[mId]);
          if (isNaN(w) || w <= 0) w = 1.0;
          weights[mId] = sumManual > 0 ? (w / sumManual) : (1 / selected.length);
        });
      }

      var subFits = {};
      selected.forEach(function(mId) {
        var mDef = MODEL_REGISTRY[mId];
        if (mDef) {
          subFits[mId] = mDef.fit(history, params);
        }
      });

      var fitted = new Array(n).fill(0);
      selected.forEach(function(mId) {
        var w = weights[mId] || 0;
        var subFitted = subFits[mId] ? subFits[mId].fitted : [];
        for (var t = 0; t < n; t++) {
          fitted[t] += (subFitted[t] !== undefined ? subFitted[t] : volumes[t]) * w;
        }
      });

      for (var t = 0; t < n; t++) {
        fitted[t] = Math.max(0, fitted[t]);
      }

      return {
        selectedModels: selected,
        weights: weights,
        weightMode: mode,
        subFits: subFits,
        historyLength: n,
        fitted: fitted,
        metrics: calculateFitMetrics(volumes, fitted)
      };
    },
    predict: function(fitResult, horizon, options) {
      var predictions = [];
      var selected = fitResult.selectedModels || [];
      var weights = fitResult.weights || {};
      var subFits = fitResult.subFits || {};

      var subPredictions = {};
      selected.forEach(function(mId) {
        var mDef = MODEL_REGISTRY[mId];
        if (mDef && subFits[mId]) {
          subPredictions[mId] = mDef.predict(subFits[mId], horizon, options);
        }
      });

      for (var h = 0; h < horizon; h++) {
        var blendedRaw = 0;
        var blendedBase = 0;

        selected.forEach(function(mId) {
          var w = weights[mId] || 0;
          var pList = subPredictions[mId];
          if (pList && pList[h]) {
            blendedRaw += pList[h].rawVolume * w;
            blendedBase += (pList[h].baseVolume !== undefined ? pList[h].baseVolume : pList[h].rawVolume) * w;
          }
        });

        predictions.push({
          baseVolume: Math.max(0, blendedBase),
          trendFactor: 1.0,
          seasonalityIndex: 1.0,
          rawVolume: Math.max(0, blendedRaw),
          ensembleWeights: weights
        });
      }
      return predictions;
    }
  });

  // =========================================================================
  // 3. OUT-OF-SAMPLE BACKTESTING (WALK-FORWARD VALIDATION)
  // =========================================================================

  /**
   * Phase 12: Perform Walk-Forward Out-of-Sample Backtesting on a single model.
   * Splits history into training series (0..N-H-1) and holdout evaluation series (N-H..N-1).
   * Fits model purely on training series, predicts H steps ahead, and computes
   * Out-of-Sample MAE, MAPE, RMSE, WAPE, and Signed Bias.
   */
  function backtestModel(history, modelId, modelParams, holdoutPeriods, options) {
    if (!history || history.length < 4) {
      return {
        modelId: modelId,
        modelName: MODEL_REGISTRY[modelId] ? MODEL_REGISTRY[modelId].name : modelId,
        trainCount: 0,
        holdoutCount: 0,
        inSampleMetrics: { mae: 0, mape: 0, rmse: 0, wape: 0 },
        outOfSampleMetrics: { mae: 0, mape: 0, rmse: 0, wape: 0, biasPct: 0 },
        overfitGap: 0,
        predictions: [],
        actuals: []
      };
    }

    var n = history.length;
    var H = Math.max(1, Math.min(parseInt(holdoutPeriods, 10) || 7, Math.floor(n / 2)));
    var trainHistory = history.slice(0, n - H);
    var holdoutHistory = history.slice(n - H);

    var model = MODEL_REGISTRY[modelId] || MODEL_REGISTRY['wma'];
    var fitResult = model.fit(trainHistory, modelParams || {});

    var futureDates = holdoutHistory.map(function(h) { return h.period; });
    var predictions = model.predict(fitResult, H, { futureDates: futureDates });

    var actualVolumes = holdoutHistory.map(function(h) { return h.volume; });
    var predictedVolumes = predictions.map(function(p) { return Math.max(0, Math.round(p.rawVolume)); });

    var oosMetrics = calculateAccuracyMetrics(actualVolumes, predictedVolumes);
    var inSampleMetrics = fitResult.metrics || { mae: 0, mape: 0, rmse: 0, wape: 0 };
    var overfitGap = Math.max(0, oosMetrics.mape - inSampleMetrics.mape);

    return {
      modelId: model.id,
      modelName: model.name,
      trainCount: trainHistory.length,
      holdoutCount: H,
      inSampleMetrics: inSampleMetrics,
      outOfSampleMetrics: oosMetrics,
      overfitGap: overfitGap,
      predictions: predictedVolumes,
      actuals: actualVolumes,
      holdoutPeriods: futureDates
    };
  }

  /**
   * Run backtest across all available or specified models for side-by-side comparison
   */
  function runBacktestAll(history, modelIds, modelParams, holdoutPeriods, options) {
    var targets = modelIds || Object.keys(MODEL_REGISTRY).filter(function(k) { return k !== 'ensemble'; });
    var results = [];

    targets.forEach(function(mId) {
      if (MODEL_REGISTRY[mId]) {
        var res = backtestModel(history, mId, modelParams, holdoutPeriods, options);
        results.push(res);
      }
    });

    results.sort(function(a, b) {
      return a.outOfSampleMetrics.mape - b.outOfSampleMetrics.mape;
    });

    return results;
  }

  // =========================================================================
  // 4. USER-DEFINED TREND PROFILES
  // =========================================================================

  var TREND_PROFILES = {
    none: {
      id: 'none',
      name: 'No Trend Profile',
      description: 'No additional cyclical adjustment — forecast uses model output only.',
      ranges: []
    },
    billing_cycle: {
      id: 'billing_cycle',
      name: 'Monthly Billing Cycle',
      description: 'High volume in the first two weeks (bills arrive), tapering in the second half.',
      ranges: [
        { startDay: 1, endDay: 7, factor: 1.20, label: 'Days 1–7' },
        { startDay: 8, endDay: 15, factor: 1.10, label: 'Days 8–15' },
        { startDay: 16, endDay: 23, factor: 0.90, label: 'Days 16–23' },
        { startDay: 24, endDay: 31, factor: 0.80, label: 'Days 24–31' }
      ]
    },
    week_of_month: {
      id: 'week_of_month',
      name: 'Week-of-Month Pattern',
      description: 'Gradual decline through each month — Week 1 highest, Week 4 lowest.',
      ranges: [
        { startDay: 1, endDay: 7, factor: 1.15, label: 'Week 1' },
        { startDay: 8, endDay: 14, factor: 1.05, label: 'Week 2' },
        { startDay: 15, endDay: 21, factor: 0.95, label: 'Week 3' },
        { startDay: 22, endDay: 31, factor: 0.85, label: 'Week 4+' }
      ]
    },
    biweekly_pay: {
      id: 'biweekly_pay',
      name: 'Biweekly Payroll Cycle',
      description: 'Spikes around the 1st and 15th of each month (common payroll dates).',
      ranges: [
        { startDay: 1, endDay: 3, factor: 1.25, label: 'Payday 1st' },
        { startDay: 4, endDay: 7, factor: 1.05, label: 'Post-pay 1st' },
        { startDay: 8, endDay: 12, factor: 0.90, label: 'Mid-cycle low' },
        { startDay: 13, endDay: 17, factor: 1.25, label: 'Payday 15th' },
        { startDay: 18, endDay: 21, factor: 1.05, label: 'Post-pay 15th' },
        { startDay: 22, endDay: 31, factor: 0.85, label: 'End-of-month low' }
      ]
    },
    quarter_end: {
      id: 'quarter_end',
      name: 'Quarter-End Surge',
      description: 'Volume surges in the last week of each quarter (Mar, Jun, Sep, Dec).',
      ranges: [
        { startDay: 1, endDay: 24, factor: 1.00, label: 'Normal days' },
        { startDay: 25, endDay: 31, factor: 1.25, label: 'Quarter-end surge' }
      ],
      quarterOnly: true
    },
    custom: {
      id: 'custom',
      name: 'Custom Period Scaling',
      description: 'Define your own day-of-month ranges and scaling factors.',
      ranges: [
        { startDay: 1, endDay: 10, factor: 1.15, label: 'Early month' },
        { startDay: 11, endDay: 20, factor: 1.00, label: 'Mid month' },
        { startDay: 21, endDay: 31, factor: 0.85, label: 'Late month' }
      ]
    }
  };

  function extractDateParts(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    if (ErlanglyUtils && ErlanglyUtils.parseDate) {
      var info = ErlanglyUtils.parseDate(dateString);
      if (info) {
        var d = new Date(info.timestamp);
        return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
      }
    }
    var parts = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) {
      return { day: parseInt(parts[3], 10), month: parseInt(parts[2], 10), year: parseInt(parts[1], 10) };
    }
    return null;
  }

  function getTrendProfileFactor(profileId, profileParams, dateString) {
    if (!profileId || profileId === 'none') return 1.0;

    var profile = TREND_PROFILES[profileId];
    if (!profile) return 1.0;

    var dateParts = extractDateParts(dateString);
    if (!dateParts) return 1.0;

    var dayOfMonth = dateParts.day;
    var month = dateParts.month;
    var params = profileParams || {};
    var intensity = params.intensity !== undefined ? parseFloat(params.intensity) : 100;
    intensity = Math.max(0, Math.min(200, intensity));
    var intensityMult = intensity / 100;

    var ranges;
    if (profileId === 'custom' && params.customRanges && params.customRanges.length > 0) {
      ranges = params.customRanges;
    } else {
      ranges = profile.ranges;
    }

    if (!ranges || ranges.length === 0) return 1.0;

    if (profile.quarterOnly) {
      var isQuarterEnd = (month === 3 || month === 6 || month === 9 || month === 12);
      if (!isQuarterEnd) return 1.0;
    }

    var rawFactor = 1.0;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      var start = parseInt(r.startDay, 10) || 1;
      var end = parseInt(r.endDay, 10) || 31;
      var factor = parseFloat(r.factor);
      if (isNaN(factor)) factor = 1.0;

      if (dayOfMonth >= start && dayOfMonth <= end) {
        rawFactor = factor;
        break;
      }
    }

    var deviation = rawFactor - 1.0;
    return 1.0 + (deviation * intensityMult);
  }

  // =========================================================================
  // 5. COMPLETE TIME SERIES FORECASTING PIPELINE
  // =========================================================================

  function executeForecast(rawHistory, modelId, modelParams, pipelineOptions) {
    if (!rawHistory || rawHistory.length === 0) {
      return {
        history: [],
        forecast: [],
        metrics: { mae: 0, mape: 0, rmse: 0, mse: 0, r2: 0, wape: 0, biasPct: 0 },
        modelId: modelId || 'wma',
        modelName: MODEL_REGISTRY[modelId] ? MODEL_REGISTRY[modelId].name : 'Default'
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
      var pred = rawPredictions[h] || { rawVolume: 0 };
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

      var tpFactor = getTrendProfileFactor(
        options.trendProfile || 'none',
        options.trendProfileParams || {},
        periodName
      );

      var finalVolume = Math.max(0, Math.round(rawVol * tpFactor * growthMult * holidayFactor));

      forecastResults.push({
        period: periodName,
        baseVolume: pred.baseVolume !== undefined ? pred.baseVolume : rawVol,
        trendFactor: trendFactor,
        seasonalityIndex: seasonIdx,
        trendProfileFactor: tpFactor,
        holidayFactor: holidayFactor,
        holidayName: holidayName,
        volume: finalVolume
      });
    }

    return {
      history: processedHistory,
      forecast: forecastResults,
      fitResult: fitResult,
      metrics: fitResult.metrics || { mae: 0, mape: 0, rmse: 0, mse: 0, r2: 0, wape: 0, biasPct: 0 },
      modelId: model.id,
      modelName: model.name
    };
  }

  // =========================================================================
  // 6. SYNTHETIC SAMPLE DATASETS
  // =========================================================================

  // Sample 28-Day contact center dataset (Phase 8 baseline)
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

  // Phase 12: 730-day 2-Year Synthetic Multi-Year Dataset (Generates 2 years of daily volume for YoY testing)
  function generateMultiYearHistory(startDateStr, totalDays, startBase, annualGrowthPct) {
    var rows = [];
    var startInfo = ErlanglyUtils.parseDate(startDateStr || '2024-06-01');
    var base = startBase || 1500;
    var growth = (annualGrowthPct || 8.0) / 100;
    var days = totalDays || 730;

    var dowWeights = [0.35, 1.35, 1.15, 1.10, 1.05, 0.95, 0.45]; // index 0 = Sun

    for (var i = 0; i < days; i++) {
      var d = ErlanglyUtils.addDays(startInfo, i);
      var dayOfWeek = d.dayOfWeek;
      var dowFactor = dowWeights[dayOfWeek] || 1.0;
      var trendFactor = 1.0 + (growth * (i / 365));
      var monthVal = d.month;
      var monthFactor = 1.0 + 0.15 * Math.sin((monthVal - 3) * (2 * Math.PI / 12));
      var pseudoNoise = 1.0 + 0.05 * Math.sin(i * 13.7);

      var vol = Math.round(base * trendFactor * dowFactor * monthFactor * pseudoNoise);
      rows.push({
        period: d.isoDate,
        volume: Math.max(100, vol),
        aht: 180
      });
    }
    return rows;
  }

  var SAMPLE_MULTI_YEAR_HISTORY = generateMultiYearHistory('2024-06-01', 730, 1500, 8.0);

  // Sample Accuracy Tracking Dataset (Forecast vs Actual paired series)
  var SAMPLE_ACCURACY_DATA = [
    { period: '2026-05-15', forecast: 1520, actual: 1510 },
    { period: '2026-05-16', forecast: 750, actual: 740 },
    { period: '2026-05-17', forecast: 550, actual: 560 },
    { period: '2026-05-18', forecast: 2200, actual: 2280 },
    { period: '2026-05-19', forecast: 1880, actual: 1910 },
    { period: '2026-05-20', forecast: 1750, actual: 1790 },
    { period: '2026-05-21', forecast: 1700, actual: 1730 },
    { period: '2026-05-22', forecast: 1500, actual: 1540 },
    { period: '2026-05-23', forecast: 780, actual: 760 },
    { period: '2026-05-24', forecast: 600, actual: 580 },
    { period: '2026-05-25', forecast: 2400, actual: 2340 },
    { period: '2026-05-26', forecast: 1920, actual: 1960 },
    { period: '2026-05-27', forecast: 1800, actual: 1840 },
    { period: '2026-05-28', forecast: 1750, actual: 1780 }
  ];

  var SAMPLE_HOLIDAYS = [
    { date: '2026-05-25', name: 'Memorial Day Spike', impactPct: 20, action: 'scale' },
    { date: '2026-05-30', name: 'Weekend Promo Sale', impactPct: 50, action: 'scale' }
  ];

  // =========================================================================
  // 7. BROWSER UI STATE & INTEGRATION
  // =========================================================================

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
      includeDummies: true,
      lookbackWeeks: 8,
      weightMode: 'auto',
      selectedModels: ['holt', 'decomp_mult', 'trend'],
      manualWeights: { holt: 40, decomp_mult: 40, trend: 20 }
    },
    trendProfile: 'none',
    trendProfileParams: {
      intensity: 100,
      customRanges: [
        { startDay: 1, endDay: 10, factor: 1.15, label: 'Early month' },
        { startDay: 11, endDay: 20, factor: 1.00, label: 'Mid month' },
        { startDay: 21, endDay: 31, factor: 0.85, label: 'Late month' }
      ]
    },
    horizon: 8,
    growthModifier: 0.0,
    assumedAht: 180,
    activeTab: 'history', // 'history' | 'csv' | 'holidays' | 'accuracy'
    compareMode: false,
    compareModelIds: ['holt', 'decomp_mult', 'trend', 'regression', 'yoy_trend', 'ensemble'],
    backtestHoldout: 7,
    lastBacktestResults: [],
    
    // Accuracy tracking state (Phase 12 / Enhancement)
    accuracyPairs: [],
    accuracyRunsHistory: [],
    lastAccuracyMetrics: null,
    lockedForecast: null,

    chart: null,
    worker: null
  };

  function renderLockedForecastUI() {
    var btnLock = document.getElementById('btn-lock-forecast');
    var statusDiv = document.getElementById('locked-forecast-status');
    if (!statusDiv) return;

    if (UIState.lockedForecast) {
      if (btnLock) {
        btnLock.textContent = '🔒 Re-lock';
        btnLock.className = 'btn btn-primary btn-sm';
      }
      var dateStr = '';
      try {
        dateStr = new Date(UIState.lockedForecast.timestamp).toLocaleDateString();
      } catch (e) {
        dateStr = 'Saved';
      }
      statusDiv.innerHTML = '<span class="text-accent" style="font-weight: 600;">🔒 Pinned Baseline: ' + (UIState.lockedForecast.modelName || 'Forecast') + '</span> (' + (UIState.lockedForecast.periodCount || (UIState.lockedForecast.forecast ? UIState.lockedForecast.forecast.length : 0)) + ' periods, ' + dateStr + ')';
    } else {
      if (btnLock) {
        btnLock.textContent = '📌 Lock Forecast';
        btnLock.className = 'btn btn-secondary btn-sm';
      }
      statusDiv.innerHTML = '<span class="text-warn">● Active forecast mutable</span> — Lock to pin baseline for monthly actuals.';
    }
  }

  function initUI() {
    setupTabSwitching();
    setupModelSelector();
    setupEventListeners();
    renderTrendProfileUI();
    renderLockedForecastUI();
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
      if (shared.trendProfile) UIState.trendProfile = shared.trendProfile;
      if (shared.trendProfileParams) UIState.trendProfileParams = shared.trendProfileParams;
      if (shared.accuracyPairs) UIState.accuracyPairs = shared.accuracyPairs;
      if (shared.accuracyRunsHistory) UIState.accuracyRunsHistory = shared.accuracyRunsHistory;
      if (shared.lockedForecast) UIState.lockedForecast = shared.lockedForecast;
      loadHistory(UIState.history);
      renderHolidaysTable();
      renderAccuracyTable();
      renderLockedForecastUI();
      updateModelParamsUI();
      renderTrendProfileUI();
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
        if (saved.trendProfile) UIState.trendProfile = saved.trendProfile;
        if (saved.trendProfileParams) UIState.trendProfileParams = saved.trendProfileParams;
        if (saved.accuracyPairs) UIState.accuracyPairs = saved.accuracyPairs;
        if (saved.accuracyRunsHistory) UIState.accuracyRunsHistory = saved.accuracyRunsHistory;
        if (saved.lockedForecast) UIState.lockedForecast = saved.lockedForecast;
        loadHistory(UIState.history);
        renderHolidaysTable();
        renderAccuracyTable();
        renderLockedForecastUI();
        updateModelParamsUI();
        renderTrendProfileUI();
        ErlanglyUtils.showToast('Loaded plan from My Plans dashboard', 'success');
        return;
      }
    }

    // Default: load sample history & default accuracy pairs
    UIState.holidays = SAMPLE_HOLIDAYS.slice();
    UIState.accuracyPairs = SAMPLE_ACCURACY_DATA.slice();
    renderHolidaysTable();
    renderAccuracyTable();
    renderLockedForecastUI();
    loadHistory(SAMPLE_HISTORY);
  }

  function renderTrendProfileUI() {
    var container = document.getElementById('trend-profile-container');
    if (!container) return;

    var profile = TREND_PROFILES[UIState.trendProfile] || TREND_PROFILES['none'];
    var params = UIState.trendProfileParams || {};
    var intensity = params.intensity !== undefined ? params.intensity : 100;

    var displayRanges = (UIState.trendProfile === 'custom' && params.customRanges && params.customRanges.length > 0)
      ? params.customRanges
      : profile.ranges;

    var html = '';

    // Profile selector dropdown
    html += '<div class="form-group">';
    html += '<label for="select-trend-profile" class="form-label">Trend Profile</label>';
    html += '<select id="select-trend-profile" class="form-control mono">';
    Object.keys(TREND_PROFILES).forEach(function(key) {
      var p = TREND_PROFILES[key];
      html += '<option value="' + key + '"' + (key === UIState.trendProfile ? ' selected' : '') + '>' + p.name + '</option>';
    });
    html += '</select>';
    html += '<span class="form-hint" style="margin-top: var(--space-1); display: block; color: var(--text-secondary);">' + profile.description + '</span>';
    html += '</div>';

    // Visual bar preview
    if (displayRanges && displayRanges.length > 0 && UIState.trendProfile !== 'none') {
      html += '<div style="margin-bottom: var(--space-3);">';
      html += '<span class="form-label" style="font-size: var(--text-xs); margin-bottom: var(--space-1); display: block;">Profile Preview:</span>';
      displayRanges.forEach(function(r) {
        var deviation = r.factor - 1.0;
        var scaledDev = deviation * (intensity / 100);
        var displayPct = (scaledDev >= 0 ? '+' : '') + (scaledDev * 100).toFixed(0) + '%';
        var barWidth = Math.min(100, Math.max(10, 50 + scaledDev * 200));
        var barColor = scaledDev > 0.05 ? 'var(--accent)' : (scaledDev < -0.05 ? 'var(--warn)' : 'var(--text-muted)');

        html += '<div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: 3px; font-size: var(--text-xs); font-family: var(--mono);">';
        html += '<span style="width: 90px; color: var(--text-secondary); flex-shrink: 0;">' + (r.label || ('Day ' + r.startDay + '–' + r.endDay)) + '</span>';
        html += '<div style="flex: 1; height: 14px; background: var(--bg-input); border-radius: var(--radius-sm); overflow: hidden; position: relative;">';
        html += '<div style="width: ' + barWidth + '%; height: 100%; background: ' + barColor + '; border-radius: var(--radius-sm); opacity: 0.7; transition: width 200ms;"></div>';
        html += '</div>';
        html += '<span style="width: 42px; text-align: right; color: ' + barColor + '; font-weight: 600;">' + displayPct + '</span>';
        html += '</div>';
      });
      html += '</div>';

      html += '<div class="form-group">';
      html += '<div class="form-label"><span>Profile Intensity</span><span class="form-label-val" id="lbl-trend-intensity">' + intensity + '%</span></div>';
      html += '<input type="range" id="range-trend-intensity" min="0" max="200" step="5" value="' + intensity + '">';
      html += '<span class="form-hint">0% = no effect, 100% = as defined, 200% = double effect</span>';
      html += '</div>';
    }

    container.innerHTML = html;

    var selectProfile = document.getElementById('select-trend-profile');
    if (selectProfile) {
      selectProfile.addEventListener('change', function() {
        UIState.trendProfile = selectProfile.value;
        renderTrendProfileUI();
        runForecast();
      });
    }

    var rangeIntensity = document.getElementById('range-trend-intensity');
    var lblIntensity = document.getElementById('lbl-trend-intensity');
    if (rangeIntensity) {
      rangeIntensity.addEventListener('input', function() {
        UIState.trendProfileParams.intensity = parseInt(rangeIntensity.value, 10);
        if (lblIntensity) lblIntensity.textContent = rangeIntensity.value + '%';
        renderTrendProfileUI();
        runForecast();
      });
    }
  }

  function setupTabSwitching() {
    var tabSample = document.getElementById('tab-history-sample');
    var tabCSV = document.getElementById('tab-history-csv');
    var tabHolidays = document.getElementById('tab-holidays');
    var tabAccuracy = document.getElementById('tab-accuracy');

    var secManual = document.getElementById('section-manual-history');
    var secCSV = document.getElementById('section-csv-history');
    var secHolidays = document.getElementById('section-holidays');
    var secAccuracy = document.getElementById('section-accuracy');
    var panelAccuracy = document.getElementById('panel-accuracy-tracking');

    function selectTab(active) {
      if (tabSample) tabSample.className = active === 'history' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      if (tabCSV) tabCSV.className = active === 'csv' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      if (tabHolidays) tabHolidays.className = active === 'holidays' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      if (tabAccuracy) tabAccuracy.className = active === 'accuracy' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';

      if (secManual) secManual.style.display = active === 'history' ? 'block' : 'none';
      if (secCSV) secCSV.style.display = active === 'csv' ? 'flex' : 'none';
      if (secHolidays) secHolidays.style.display = active === 'holidays' ? 'block' : 'none';
      if (secAccuracy) secAccuracy.style.display = active === 'accuracy' ? 'block' : 'none';
      if (panelAccuracy) panelAccuracy.style.display = active === 'accuracy' ? 'block' : 'none';

      UIState.activeTab = active;
      if (active === 'accuracy') {
        renderAccuracyDashboard();
      }
    }

    if (tabSample) tabSample.addEventListener('click', function() { selectTab('history'); });
    if (tabCSV) tabCSV.addEventListener('click', function() { selectTab('csv'); });
    if (tabHolidays) tabHolidays.addEventListener('click', function() { selectTab('holidays'); });
    if (tabAccuracy) tabAccuracy.addEventListener('click', function() { selectTab('accuracy'); });
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

    var hasYoYHistory = checkHistorySufficiency(UIState.history, 52).sufficient;

    Object.keys(categories).forEach(function(cat) {
      var optgroup = document.createElement('optgroup');
      optgroup.label = cat;
      categories[cat].forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name + (m.id === 'yoy_trend' && !hasYoYHistory ? ' (⚠️ Requires ≥12m)' : '');
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

  function checkHistorySufficiency(history, minPeriods) {
    if (!history || history.length === 0) {
      return { sufficient: false, count: 0, daySpan: 0, reason: 'No historical volume loaded.' };
    }
    var n = history.length;
    var first = ErlanglyUtils.parseDate(history[0].period);
    var last = ErlanglyUtils.parseDate(history[n - 1].period);
    var daySpan = (first && last) ? Math.round((last.timestamp - first.timestamp) / 86400000) : 0;

    if (n >= minPeriods || daySpan >= 360) {
      return { sufficient: true, count: n, daySpan: daySpan, reason: 'Sufficient history loaded (' + n + ' periods, ' + daySpan + ' days).' };
    }
    return {
      sufficient: false,
      count: n,
      daySpan: daySpan,
      reason: 'Requires ≥ 12 months history (365 days / 52 weeks). Currently loaded: ' + n + ' periods (' + daySpan + ' days).'
    };
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
    } else if (model.id === 'yoy_trend') {
      var check = checkHistorySufficiency(UIState.history, 52);
      var guardHtml = check.sufficient 
        ? '<div style="padding: var(--space-2) var(--space-3); background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); border-radius: var(--radius-md); font-size: var(--text-xs); color: var(--success-light); margin-bottom: var(--space-3);">✓ ' + check.reason + ' Prior-year calendar projection active.</div>'
        : '<div style="padding: var(--space-2) var(--space-3); background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warn); border-radius: var(--radius-md); font-size: var(--text-xs); color: var(--warn-light); margin-bottom: var(--space-3);">⚠️ <strong>Minimum History Guard:</strong> ' + check.reason + '<br><a href="#" id="link-load-2yr-sample" style="color: var(--accent); text-decoration: underline; margin-top: 4px; display: inline-block;">Load 2-Year Sample Dataset (730 days) →</a></div>';

      container.innerHTML = 
        guardHtml +
        '<div class="form-group">' +
          '<label for="num-yoy-lookback" class="form-label">YoY Trailing Growth Lookback Window</label>' +
          '<div class="input-group">' +
            '<input type="number" id="num-yoy-lookback" class="form-control mono" min="2" max="52" value="' + (UIState.modelParams.lookbackWeeks || 8) + '">' +
            '<span class="input-addon">periods</span>' +
          '</div>' +
          '<span class="form-hint">Computes recent YoY drift against matched calendar window 1 year prior</span>' +
        '</div>';

      var inpY = document.getElementById('num-yoy-lookback');
      if (inpY) {
        inpY.addEventListener('input', function() {
          UIState.modelParams.lookbackWeeks = Math.max(2, parseInt(inpY.value, 10) || 8);
          runForecast();
        });
      }

      var link2yr = document.getElementById('link-load-2yr-sample');
      if (link2yr) {
        link2yr.addEventListener('click', function(e) {
          e.preventDefault();
          loadHistory(SAMPLE_MULTI_YEAR_HISTORY);
          ErlanglyUtils.showToast('Loaded 2-Year Multi-Year History (730 periods)', 'success');
        });
      }
    } else if (model.id === 'ensemble') {
      var subCandidates = [
        { id: 'holt', name: "Holt's Double Smoothing" },
        { id: 'decomp_mult', name: "Multiplicative Decomposition" },
        { id: 'trend', name: "Linear Trend (OLS)" },
        { id: 'regression', name: "Multi-Variable Regression" },
        { id: 'wma', name: "Weighted Moving Average" },
        { id: 'ses', name: "Simple Exp Smoothing" }
      ];

      var selectedSet = UIState.modelParams.selectedModels || ['holt', 'decomp_mult', 'trend'];
      var mode = UIState.modelParams.weightMode || 'auto';

      var html = '<div class="form-group">';
      html += '<label class="form-label">Strategy &amp; Weighting Mode</label>';
      html += '<div style="display: flex; gap: var(--space-2); margin-bottom: var(--space-3);">';
      html += '<button type="button" class="btn btn-sm ' + (mode === 'auto' ? 'btn-primary' : 'btn-ghost') + '" id="btn-ensemble-mode-auto" style="font-size: var(--text-xs); flex: 1;">Auto (Inverse Backtest RMSE)</button>';
      html += '<button type="button" class="btn btn-sm ' + (mode === 'manual' ? 'btn-primary' : 'btn-ghost') + '" id="btn-ensemble-mode-manual" style="font-size: var(--text-xs); flex: 1;">Manual Weights</button>';
      html += '</div>';
      html += '</div>';

      html += '<div class="form-group">';
      html += '<label class="form-label" style="margin-bottom: var(--space-1);">Candidate Sub-Models:</label>';
      subCandidates.forEach(function(sc) {
        var isChecked = selectedSet.indexOf(sc.id) !== -1;
        var manualVal = (UIState.modelParams.manualWeights && UIState.modelParams.manualWeights[sc.id]) ? UIState.modelParams.manualWeights[sc.id] : 33;

        html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-1) 0; border-bottom: 1px solid var(--border-subtle);">';
        html += '<label style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); cursor: pointer; color: var(--text-primary); margin: 0;">';
        html += '<input type="checkbox" data-ensemble-model="' + sc.id + '" ' + (isChecked ? 'checked' : '') + ' style="cursor: pointer;">';
        html += '<span>' + sc.name + '</span>';
        html += '</label>';

        if (mode === 'manual' && isChecked) {
          html += '<div style="display: flex; align-items: center; gap: 4px; width: 90px;">';
          html += '<input type="number" class="form-control mono" style="height: 24px; font-size: 11px; padding: 2px 4px;" data-ensemble-weight="' + sc.id + '" min="1" max="100" value="' + manualVal + '">';
          html += '<span style="font-size: 10px; color: var(--text-muted);">pts</span>';
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';

      container.innerHTML = html;

      var btnAuto = document.getElementById('btn-ensemble-mode-auto');
      var btnMan = document.getElementById('btn-ensemble-mode-manual');

      if (btnAuto) {
        btnAuto.addEventListener('click', function() {
          UIState.modelParams.weightMode = 'auto';
          updateModelParamsUI();
          runForecast();
        });
      }
      if (btnMan) {
        btnMan.addEventListener('click', function() {
          UIState.modelParams.weightMode = 'manual';
          updateModelParamsUI();
          runForecast();
        });
      }

      var chks = container.querySelectorAll('[data-ensemble-model]');
      chks.forEach(function(chk) {
        chk.addEventListener('change', function() {
          var mId = chk.getAttribute('data-ensemble-model');
          var curr = UIState.modelParams.selectedModels || [];
          if (chk.checked) {
            if (curr.indexOf(mId) === -1) curr.push(mId);
          } else {
            curr = curr.filter(function(x) { return x !== mId; });
          }
          if (curr.length === 0) curr = ['holt'];
          UIState.modelParams.selectedModels = curr;
          updateModelParamsUI();
          runForecast();
        });
      });

      var wInputs = container.querySelectorAll('[data-ensemble-weight]');
      wInputs.forEach(function(winp) {
        winp.addEventListener('input', function() {
          var mId = winp.getAttribute('data-ensemble-weight');
          UIState.modelParams.manualWeights = UIState.modelParams.manualWeights || {};
          UIState.modelParams.manualWeights[mId] = Math.max(1, parseFloat(winp.value) || 1);
          runForecast();
        });
      });
    }
  }

  function setupEventListeners() {
    var btnLoadSample = document.getElementById('btn-load-sample-forecast');
    var btnLoad2Yr = document.getElementById('btn-load-2yr-sample');
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

    // Accuracy Tracking Listeners (Phase 12 / Enhancement)
    var btnLockForecast = document.getElementById('btn-lock-forecast');
    var btnMergeActualsHistory = document.getElementById('btn-merge-actuals-history');
    var accuracyDropzone = document.getElementById('accuracy-dropzone');
    var accuracyFileInput = document.getElementById('accuracy-file-input');
    var btnLoadSampleAccuracy = document.getElementById('btn-load-sample-accuracy');
    var btnClearAccuracy = document.getElementById('btn-clear-accuracy');
    var btnAddAccuracyRow = document.getElementById('btn-add-accuracy-row');
    var btnPullFromForecast = document.getElementById('btn-pull-forecast-actuals');
    var btnSaveAccuracyRun = document.getElementById('btn-save-accuracy-run');
    var btnExportAccuracyCSV = document.getElementById('btn-export-accuracy-csv');

    // Backtest Controls
    var btnRunBacktest = document.getElementById('btn-run-backtest');
    var inpBacktestHoldout = document.getElementById('num-backtest-holdout');

    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', function() {
        UIState.holidays = SAMPLE_HOLIDAYS.slice();
        renderHolidaysTable();
        loadHistory(SAMPLE_HISTORY);
        ErlanglyUtils.showToast('Loaded sample contact center history & holidays', 'success');
      });
    }

    if (btnLoad2Yr) {
      btnLoad2Yr.addEventListener('click', function() {
        loadHistory(SAMPLE_MULTI_YEAR_HISTORY);
        ErlanglyUtils.showToast('Loaded 2-Year multi-year series (730 periods)', 'success');
      });
    }

    if (btnClearHistory) {
      btnClearHistory.addEventListener('click', function() {
        loadHistory([]);
        ErlanglyUtils.showToast('Cleared historical series', 'info');
      });
    }

    if (btnAddRow) {
      btnAddRow.addEventListener('click', function() {
        var nextIdx = UIState.history.length + 1;
        var last = UIState.history[UIState.history.length - 1];
        var nextPeriod = 'Period ' + nextIdx;
        if (last && ErlanglyUtils.parseDate(last.period)) {
          var nextDate = ErlanglyUtils.addDays(last.period, 1);
          if (nextDate) nextPeriod = nextDate.isoDate;
        }
        UIState.history.push({ period: nextPeriod, volume: 1500, aht: UIState.assumedAht });
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
        btnCompareToggle.textContent = UIState.compareMode ? 'Hide Comparison & Backtesting' : 'Model Comparison & Backtest';
        btnCompareToggle.className = UIState.compareMode ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
        runForecast();
      });
    }

    if (btnRunBacktest) {
      btnRunBacktest.addEventListener('click', function() {
        if (inpBacktestHoldout) {
          UIState.backtestHoldout = Math.max(1, parseInt(inpBacktestHoldout.value, 10) || 7);
        }
        runForecast();
        ErlanglyUtils.showToast('Recomputed walk-forward backtesting across all candidate models', 'success');
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
        var nextDate = new Date().toISOString().split('T')[0];
        if (UIState.history.length > 0) {
          var last = UIState.history[UIState.history.length - 1];
          if (ErlanglyUtils.parseDate(last.period)) {
            var nd = ErlanglyUtils.addDays(last.period, 5);
            if (nd) nextDate = nd.isoDate;
          }
        }
        UIState.holidays.push({
          id: 'ev_' + Date.now(),
          date: nextDate,
          label: 'Special Event',
          factor: 1.5,
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

    // Lock Baseline Forecast Snapshot
    if (btnLockForecast) {
      btnLockForecast.addEventListener('click', function() {
        if (!UIState.lastForecast || !UIState.lastForecast.forecast || UIState.lastForecast.forecast.length === 0) {
          ErlanglyUtils.showToast('Generate a forecast first to lock as baseline', 'warn');
          return;
        }
        UIState.lockedForecast = {
          timestamp: new Date().toISOString(),
          modelName: UIState.lastForecast.modelName,
          modelId: UIState.modelId,
          periodCount: UIState.lastForecast.forecast.length,
          forecast: JSON.parse(JSON.stringify(UIState.lastForecast.forecast))
        };
        renderLockedForecastUI();
        ErlanglyUtils.showToast('Pinned ' + UIState.lockedForecast.periodCount + ' forecast periods as official baseline', 'success');
      });
    }

    // Actuals CSV File Dropzone
    if (accuracyDropzone && accuracyFileInput) {
      ErlanglyUtils.wireFileDrop(accuracyDropzone, accuracyFileInput, function(text, file) {
        var parsed = ErlanglyUtils.parseCSV(text);
        if (!parsed.rows || parsed.rows.length === 0) {
          ErlanglyUtils.showToast('No valid data rows found in CSV', 'warn');
          return;
        }

        var baselineForecast = UIState.lockedForecast ? UIState.lockedForecast.forecast : (UIState.lastForecast ? UIState.lastForecast.forecast : []);
        var forecastMap = {};
        baselineForecast.forEach(function(f) {
          if (f.period) forecastMap[f.period.trim().toLowerCase()] = f.volume;
        });

        var pairs = [];
        var matchedCount = 0;

        parsed.rows.forEach(function(r, idx) {
          var p = (r.period || r.date || r.interval || r.day || ('Period ' + (idx + 1))).trim();
          var act = parseFloat(r.actual || r.actual_volume || r.actuals || r.volume || r.calls || 0) || 0;
          var key = p.toLowerCase();
          var fc = forecastMap[key] !== undefined ? forecastMap[key] : (r.forecast ? parseFloat(r.forecast) : 0);
          if (forecastMap[key] !== undefined) matchedCount++;

          pairs.push({
            period: p,
            forecast: fc,
            actual: act
          });
        });

        if (pairs.length > 0) {
          UIState.accuracyPairs = pairs;
          renderAccuracyTable();
          renderAccuracyDashboard();
          var matchMsg = matchedCount > 0 ? (' (' + matchedCount + ' auto-matched to forecast)') : '';
          ErlanglyUtils.showToast('Uploaded ' + pairs.length + ' actuals from ' + (file ? file.name : 'CSV') + matchMsg, 'success');
        }
      });
    }

    // Merge Actuals into Historical Training Series
    if (btnMergeActualsHistory) {
      btnMergeActualsHistory.addEventListener('click', function() {
        var validActuals = UIState.accuracyPairs.filter(function(p) { return p.actual > 0; });
        if (validActuals.length === 0) {
          ErlanglyUtils.showToast('No actual volume records to merge into history', 'warn');
          return;
        }

        var historyMap = {};
        UIState.history.forEach(function(h) {
          historyMap[h.period.trim().toLowerCase()] = h;
        });

        var updatedCount = 0;
        var appendedCount = 0;

        validActuals.forEach(function(pair) {
          var key = pair.period.trim().toLowerCase();
          if (historyMap[key]) {
            historyMap[key].volume = pair.actual;
            updatedCount++;
          } else {
            var newEntry = {
              period: pair.period.trim(),
              volume: pair.actual,
              aht: UIState.assumedAht
            };
            UIState.history.push(newEntry);
            historyMap[key] = newEntry;
            appendedCount++;
          }
        });

        // Chronological sort if dates are valid
        UIState.history.sort(function(a, b) {
          var dA = ErlanglyUtils.parseDate(a.period);
          var dB = ErlanglyUtils.parseDate(b.period);
          var tA = dA ? (dA.timestamp || (typeof dA.getTime === 'function' ? dA.getTime() : 0)) : 0;
          var tB = dB ? (dB.timestamp || (typeof dB.getTime === 'function' ? dB.getTime() : 0)) : 0;
          if (tA && tB) return tA - tB;
          return 0;
        });

        loadHistory(UIState.history);
        ErlanglyUtils.showToast('Merged ' + validActuals.length + ' actuals (' + appendedCount + ' new, ' + updatedCount + ' updated) into history and re-forecasted!', 'success');
      });
    }

    // Accuracy Tracking Listeners (Phase 12)
    if (btnLoadSampleAccuracy) {
      btnLoadSampleAccuracy.addEventListener('click', function() {
        UIState.accuracyPairs = SAMPLE_ACCURACY_DATA.slice();
        renderAccuracyTable();
        renderAccuracyDashboard();
        ErlanglyUtils.showToast('Loaded sample Forecast vs Actual pairs', 'success');
      });
    }

    if (btnClearAccuracy) {
      btnClearAccuracy.addEventListener('click', function() {
        UIState.accuracyPairs = [];
        renderAccuracyTable();
        renderAccuracyDashboard();
        ErlanglyUtils.showToast('Cleared accuracy tracking table', 'info');
      });
    }

    if (btnAddAccuracyRow) {
      btnAddAccuracyRow.addEventListener('click', function() {
        var nextIdx = UIState.accuracyPairs.length + 1;
        var last = UIState.accuracyPairs[UIState.accuracyPairs.length - 1];
        var nextP = 'Period ' + nextIdx;
        if (last && ErlanglyUtils.parseDate(last.period)) {
          var nD = ErlanglyUtils.addDays(last.period, 1);
          if (nD) nextP = nD.isoDate;
        }
        UIState.accuracyPairs.push({ period: nextP, forecast: 1600, actual: 1620 });
        renderAccuracyTable();
        renderAccuracyDashboard();
      });
    }

    if (btnPullFromForecast) {
      btnPullFromForecast.addEventListener('click', function() {
        var source = UIState.lockedForecast ? UIState.lockedForecast.forecast : (UIState.lastForecast ? UIState.lastForecast.forecast : null);
        if (!source || source.length === 0) {
          ErlanglyUtils.showToast('Generate or lock a forecast first to populate periods', 'warn');
          return;
        }
        UIState.accuracyPairs = source.map(function(f) {
          return {
            period: f.period,
            forecast: f.volume,
            actual: f.volume
          };
        });
        renderAccuracyTable();
        renderAccuracyDashboard();
        var label = UIState.lockedForecast ? 'locked baseline forecast' : 'active forecast plan';
        ErlanglyUtils.showToast('Populated ' + UIState.accuracyPairs.length + ' periods from ' + label, 'success');
      });
    }

    if (btnSaveAccuracyRun) {
      btnSaveAccuracyRun.addEventListener('click', function() {
        if (!UIState.lastAccuracyMetrics || UIState.lastAccuracyMetrics.count === 0) {
          ErlanglyUtils.showToast('No accuracy data to record', 'warn');
          return;
        }
        var m = UIState.lastAccuracyMetrics;
        var runRecord = {
          id: 'acc_' + Date.now(),
          timestamp: new Date().toISOString(),
          label: (UIState.lockedForecast ? UIState.lockedForecast.modelName : (UIState.lastForecast ? UIState.lastForecast.modelName : 'Forecast Plan')) + ' Review',
          count: m.count,
          wape: m.wape,
          mape: m.mape,
          biasPct: m.biasPct,
          mae: m.mae,
          rmse: m.rmse,
          totalActual: m.totalActual,
          totalForecast: m.totalForecast
        };
        UIState.accuracyRunsHistory.unshift(runRecord);
        renderAccuracyHistoryTable();
        ErlanglyUtils.showToast('Logged accuracy evaluation to history log', 'success');
      });
    }

    if (btnExportAccuracyCSV) {
      btnExportAccuracyCSV.addEventListener('click', function() {
        if (!UIState.lastAccuracyMetrics || UIState.lastAccuracyMetrics.count === 0) {
          ErlanglyUtils.showToast('No accuracy data to export', 'warn');
          return;
        }
        var headers = ['Period', 'Forecast_Volume', 'Actual_Volume', 'Variance_Calls', 'Abs_Error_Calls', 'Error_Pct', 'Signed_Bias_Pct', 'Status'];
        var rows = UIState.lastAccuracyMetrics.details.map(function(d, i) {
          var pair = UIState.accuracyPairs[i] || {};
          var status = Math.abs(d.signedPct) <= 5.0 ? 'On Target' : (d.signedPct > 5.0 ? 'Over-Forecast' : 'Under-Forecast');
          return [
            pair.period || ('Period ' + (i + 1)),
            Math.round(d.forecast),
            Math.round(d.actual),
            Math.round(d.error),
            Math.round(d.absError),
            d.pctError.toFixed(2) + '%',
            (d.signedPct >= 0 ? '+' : '') + d.signedPct.toFixed(2) + '%',
            status
          ];
        });
        ErlanglyUtils.exportCSV('erlangly_forecast_accuracy.csv', headers, rows);
      });
    }

    // Export Forecast CSV
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', function() {
        if (!UIState.lastForecast || UIState.lastForecast.forecast.length === 0) return;
        var headers = ['Future_Period', 'Algorithm', 'Base_Model_Volume', 'Trend_Factor', 'Seasonality_Index', 'Trend_Profile_Factor', 'Holiday_Factor', 'Holiday_Name', 'Projected_Volume', 'Assumed_AHT_Sec', 'Est_Erlangs'];
        var rows = UIState.lastForecast.forecast.map(function(r) {
          var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, UIState.assumedAht, 3600 * 8) : (r.volume * UIState.assumedAht / 28800);
          return [
            r.period,
            UIState.lastForecast.modelName,
            Math.round(r.baseVolume),
            r.trendFactor.toFixed(3),
            r.seasonalityIndex.toFixed(3),
            (r.trendProfileFactor || 1.0).toFixed(3),
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
            trendProfile: UIState.trendProfile,
            trendProfileParams: UIState.trendProfileParams,
            horizon: UIState.horizon,
            growthModifier: UIState.growthModifier,
            assumedAht: UIState.assumedAht,
            accuracyPairs: UIState.accuracyPairs,
            accuracyRunsHistory: UIState.accuracyRunsHistory,
            lockedForecast: UIState.lockedForecast
          };
          var outputs = UIState.lastForecast ? {
            modelName: UIState.lastForecast.modelName,
            metrics: UIState.lastForecast.metrics,
            forecastCount: UIState.lastForecast.forecast.length,
            totalVolume: UIState.lastForecast.forecast.reduce(function(a, b) { return a + b.volume; }, 0),
            accuracyMetrics: UIState.lastAccuracyMetrics,
            lockedForecast: UIState.lockedForecast
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
            trendProfile: UIState.trendProfile,
            trendProfileParams: UIState.trendProfileParams,
            horizon: UIState.horizon,
            growthModifier: UIState.growthModifier,
            assumedAht: UIState.assumedAht,
            accuracyPairs: UIState.accuracyPairs,
            accuracyRunsHistory: UIState.accuracyRunsHistory,
            lockedForecast: UIState.lockedForecast
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
    setupModelSelector();
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

  // =========================================================================
  // 8. ACCURACY TRACKING UI (PHASE 12)
  // =========================================================================

  function renderAccuracyTable() {
    var tbody = document.getElementById('tbody-accuracy-inputs');
    var badgeCount = document.getElementById('lbl-accuracy-count');
    var innerCount = document.getElementById('lbl-accuracy-count-inner');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (badgeCount) badgeCount.textContent = UIState.accuracyPairs.length;
    if (innerCount) innerCount.textContent = UIState.accuracyPairs.length;

    if (UIState.accuracyPairs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No pairs loaded. Upload an Actuals CSV, click "From Forecast", or click "+ Add".</td></tr>';
      return;
    }

    UIState.accuracyPairs.forEach(function(pair, idx) {
      var tr = document.createElement('tr');

      var tdPeriod = document.createElement('td');
      var inP = document.createElement('input');
      inP.type = 'text';
      inP.className = 'form-control mono';
      inP.style.height = '28px';
      inP.style.fontSize = 'var(--text-xs)';
      inP.value = pair.period;
      inP.addEventListener('change', function() {
        pair.period = inP.value.trim();
        renderAccuracyDashboard();
      });
      tdPeriod.appendChild(inP);

      var tdFc = document.createElement('td');
      var inFc = document.createElement('input');
      inFc.type = 'number';
      inFc.className = 'form-control mono';
      inFc.style.height = '28px';
      inFc.style.fontSize = 'var(--text-xs)';
      inFc.value = Math.round(pair.forecast);
      inFc.addEventListener('input', function() {
        pair.forecast = Math.max(0, parseFloat(inFc.value) || 0);
        renderAccuracyDashboard();
      });
      tdFc.appendChild(inFc);

      var tdAct = document.createElement('td');
      var inAct = document.createElement('input');
      inAct.type = 'number';
      inAct.className = 'form-control mono';
      inAct.style.height = '28px';
      inAct.style.fontSize = 'var(--text-xs)';
      inAct.value = Math.round(pair.actual);
      inAct.addEventListener('input', function() {
        pair.actual = Math.max(0, parseFloat(inAct.value) || 0);
        renderAccuracyDashboard();
      });
      tdAct.appendChild(inAct);

      var tdDel = document.createElement('td');
      var btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm';
      btnDel.style.padding = '0 6px';
      btnDel.style.color = 'var(--danger)';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', function() {
        UIState.accuracyPairs.splice(idx, 1);
        renderAccuracyTable();
        renderAccuracyDashboard();
      });
      tdDel.appendChild(btnDel);

      tr.appendChild(tdPeriod);
      tr.appendChild(tdFc);
      tr.appendChild(tdAct);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function renderAccuracyDashboard() {
    var acts = UIState.accuracyPairs.map(function(p) { return p.actual; });
    var fcs = UIState.accuracyPairs.map(function(p) { return p.forecast; });

    var m = calculateAccuracyMetrics(acts, fcs);
    UIState.lastAccuracyMetrics = m;

    var statWape = document.getElementById('stat-acc-wape');
    var statMape = document.getElementById('stat-acc-mape');
    var statBias = document.getElementById('stat-acc-bias');
    var statMae = document.getElementById('stat-acc-mae');
    var statRmse = document.getElementById('stat-acc-rmse');
    var statTotalVar = document.getElementById('stat-acc-total-var');

    if (statWape) statWape.textContent = m.wape.toFixed(1) + '%';
    if (statMape) statMape.textContent = m.mape.toFixed(1) + '%';
    if (statBias) {
      var prefix = m.biasPct >= 0 ? '+' : '';
      statBias.textContent = prefix + m.biasPct.toFixed(1) + '%';
      statBias.className = 'metric-value ' + (Math.abs(m.biasPct) <= 5.0 ? 'text-success' : (m.biasPct > 0 ? 'text-warn' : 'text-danger'));
    }
    if (statMae) statMae.textContent = Math.round(m.mae).toLocaleString();
    if (statRmse) statRmse.textContent = Math.round(m.rmse).toLocaleString();
    if (statTotalVar) {
      var vPrefix = m.varianceTotal >= 0 ? '+' : '';
      statTotalVar.textContent = vPrefix + Math.round(m.varianceTotal).toLocaleString();
    }

    var tbodyVar = document.getElementById('tbody-accuracy-variance');
    if (tbodyVar) {
      tbodyVar.innerHTML = '';
      if (m.details.length === 0) {
        tbodyVar.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No accuracy evaluations calculated.</td></tr>';
      } else {
        m.details.forEach(function(d, i) {
          var pair = UIState.accuracyPairs[i] || {};
          var tr = document.createElement('tr');
          var statusBadge = '';
          if (Math.abs(d.signedPct) <= 5.0) {
            statusBadge = '<span class="badge badge-success" style="font-size: 10px;">✓ On Target</span>';
          } else if (d.signedPct > 5.0) {
            statusBadge = '<span class="badge badge-warn" style="font-size: 10px;">⚠️ Over-Forecast</span>';
          } else {
            statusBadge = '<span class="badge badge-danger" style="font-size: 10px;">⚠️ Under-Forecast</span>';
          }

          var errColor = d.error >= 0 ? 'text-warn' : 'text-danger';
          if (Math.abs(d.signedPct) <= 5.0) errColor = 'text-success';

          tr.innerHTML = 
            '<td class="mono"><strong>' + (pair.period || ('Period ' + (i + 1))) + '</strong></td>' +
            '<td class="mono">' + Math.round(d.forecast).toLocaleString() + '</td>' +
            '<td class="mono">' + Math.round(d.actual).toLocaleString() + '</td>' +
            '<td class="mono ' + errColor + '">' + (d.error >= 0 ? '+' : '') + Math.round(d.error).toLocaleString() + '</td>' +
            '<td class="mono">' + Math.round(d.absError).toLocaleString() + '</td>' +
            '<td class="mono">' + d.pctError.toFixed(1) + '%</td>' +
            '<td class="mono ' + errColor + '">' + (d.signedPct >= 0 ? '+' : '') + d.signedPct.toFixed(1) + '%</td>' +
            '<td>' + statusBadge + '</td>';

          tbodyVar.appendChild(tr);
        });
      }
    }

    renderAccuracyHistoryTable();
  }

  function renderAccuracyHistoryTable() {
    var tbody = document.getElementById('tbody-accuracy-history');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (UIState.accuracyRunsHistory.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No historical evaluation runs recorded. Click "Log Current Accuracy Run".</td></tr>';
      return;
    }

    UIState.accuracyRunsHistory.forEach(function(run) {
      var tr = document.createElement('tr');
      var dateStr = new Date(run.timestamp).toLocaleDateString();
      var biasPrefix = run.biasPct >= 0 ? '+' : '';

      tr.innerHTML = 
        '<td class="mono">' + dateStr + '</td>' +
        '<td><strong>' + (run.label || 'Forecast Review') + '</strong></td>' +
        '<td class="mono">' + run.count + ' periods</td>' +
        '<td class="mono text-accent"><strong>' + run.wape.toFixed(1) + '%</strong></td>' +
        '<td class="mono">' + run.mape.toFixed(1) + '%</td>' +
        '<td class="mono ' + (Math.abs(run.biasPct) <= 5.0 ? 'text-success' : 'text-warn') + '">' + biasPrefix + run.biasPct.toFixed(1) + '%</td>' +
        '<td class="mono">' + Math.round(run.mae).toLocaleString() + '</td>';

      tbody.appendChild(tr);
    });
  }

  // =========================================================================
  // 9. EXECUTION & VISUALIZATION
  // =========================================================================

  function runForecast() {
    if (!UIState.history || UIState.history.length === 0) {
      clearForecastDisplay();
      return;
    }

    var options = {
      horizon: UIState.horizon,
      growthModifier: UIState.growthModifier,
      assumedAht: UIState.assumedAht,
      holidays: UIState.holidays,
      trendProfile: UIState.trendProfile,
      trendProfileParams: UIState.trendProfileParams
    };

    // 1. Run main active forecast
    var result = executeForecast(UIState.history, UIState.modelId, UIState.modelParams, options);
    UIState.lastForecast = result;

    // Sync auto-optimized parameters back to UIState
    if (result.fitResult) {
      if (result.fitResult.alpha !== undefined) UIState.modelParams.alpha = result.fitResult.alpha;
      if (result.fitResult.beta !== undefined) UIState.modelParams.beta = result.fitResult.beta;
    }

    // 2. Run model comparison & backtesting if comparison view is open
    var comparisonResults = [];
    if (UIState.compareMode) {
      var modelsToCompare = UIState.compareModelIds.length > 0 ? UIState.compareModelIds : ['holt', 'decomp_mult', 'trend', 'regression', 'yoy_trend', 'ensemble'];
      modelsToCompare.forEach(function(mId) {
        var compRes = executeForecast(UIState.history, mId, UIState.modelParams, options);
        comparisonResults.push(compRes);
      });

      UIState.lastBacktestResults = runBacktestAll(UIState.history, modelsToCompare, UIState.modelParams, UIState.backtestHoldout, options);
    }

    // 3. Update KPI metrics cards
    updateSummaryKPIs(result);

    // 4. Render Forecast breakdown table
    renderForecastTable(result);

    // 5. Render Chart.js
    renderChart(result, comparisonResults);

    // 6. Render Model Comparison table
    if (UIState.compareMode) {
      renderComparisonTable(comparisonResults, UIState.lastBacktestResults);
    }

    // 7. Update Accuracy Dashboard if active
    if (UIState.activeTab === 'accuracy') {
      renderAccuracyDashboard();
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

      var tpf = r.trendProfileFactor || 1.0;
      var tpfPct = ((tpf - 1.0) * 100);
      var tpfDisplay = (tpf === 1.0) ? '—' : ((tpfPct >= 0 ? '+' : '') + tpfPct.toFixed(0) + '%');
      var tpfClass = tpf > 1.05 ? 'text-accent' : (tpf < 0.95 ? 'text-warn' : '');

      tr.innerHTML = 
        '<td class="mono"><strong>' + r.period + '</strong>' + eventBadge + '</td>' +
        '<td class="mono">' + Math.round(r.baseVolume).toLocaleString() + '</td>' +
        '<td class="mono">' + r.trendFactor.toFixed(2) + 'x</td>' +
        '<td class="mono ' + (r.seasonalityIndex > 1.1 ? 'text-accent' : (r.seasonalityIndex < 0.9 ? 'text-muted' : '')) + '">' + (r.seasonalityIndex * 100).toFixed(0) + '%</td>' +
        '<td class="mono ' + tpfClass + '">' + tpfDisplay + '</td>' +
        '<td class="mono text-accent"><strong>' + Math.round(r.volume).toLocaleString() + '</strong></td>' +
        '<td class="mono">' + erlangs.toFixed(2) + '</td>';

      tbody.appendChild(tr);
    });
  }

  function renderComparisonTable(compResults, backtestResults) {
    var tbody = document.getElementById('tbody-model-comparison');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (compResults.length === 0) return;

    var btMap = {};
    if (backtestResults) {
      backtestResults.forEach(function(bt) {
        btMap[bt.modelId] = bt;
      });
    }

    var minMAPE = Math.min.apply(null, compResults.map(function(c) { return c.metrics.mape; }));

    compResults.forEach(function(c) {
      var tr = document.createElement('tr');
      var isBest = Math.abs(c.metrics.mape - minMAPE) < 0.001;
      var isActive = c.modelId === UIState.modelId;
      var totalVol = c.forecast.reduce(function(a, b) { return a + b.volume; }, 0);
      var bt = btMap[c.modelId];

      var oosMapeStr = bt ? bt.outOfSampleMetrics.mape.toFixed(1) + '%' : '—';
      var oosWapeStr = bt ? bt.outOfSampleMetrics.wape.toFixed(1) + '%' : '—';
      var oosRmseStr = bt ? Math.round(bt.outOfSampleMetrics.rmse).toLocaleString() : '—';
      var overfitGapStr = bt ? '+' + bt.overfitGap.toFixed(1) + '%' : '—';

      tr.innerHTML = 
        '<td>' +
          '<strong>' + c.modelName + '</strong>' +
          (isBest ? ' <span class="badge badge-success" style="font-size: 10px; margin-left: 4px;">Best In-Sample</span>' : '') +
          (isActive ? ' <span class="badge badge-neutral" style="font-size: 10px; margin-left: 4px;">Active</span>' : '') +
        '</td>' +
        '<td class="mono text-accent"><strong>' + c.metrics.mape.toFixed(1) + '%</strong></td>' +
        '<td class="mono" style="color: var(--info);">' + oosMapeStr + '</td>' +
        '<td class="mono">' + oosWapeStr + '</td>' +
        '<td class="mono">' + oosRmseStr + '</td>' +
        '<td class="mono ' + (bt && bt.overfitGap > 10 ? 'text-warn' : '') + '">' + overfitGapStr + '</td>' +
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

    var paddedHist = histData.concat(new Array(fcLabels.length).fill(null));

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

    if (UIState.compareMode && compResults && compResults.length > 0) {
      var compareColors = ['#f59e0b', '#a855f7', '#38bdf8', '#ec4899', '#34d399', '#f87171'];
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
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No forecast calculated.</td></tr>';
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
    trendProfiles: TREND_PROFILES,
    registerModel: registerModel,
    linearRegression: linearRegression,
    solveLinearSystem: solveLinearSystem,
    calculateFitMetrics: calculateFitMetrics,
    calculateAccuracyMetrics: calculateAccuracyMetrics,
    backtestModel: backtestModel,
    runBacktestAll: runBacktestAll,
    checkHistorySufficiency: checkHistorySufficiency,
    preprocessHistory: preprocessHistory,
    getTrendProfileFactor: getTrendProfileFactor,
    extractDateParts: extractDateParts,
    executeForecast: executeForecast,
    generateMultiYearHistory: generateMultiYearHistory,
    SAMPLE_HISTORY: SAMPLE_HISTORY,
    SAMPLE_MULTI_YEAR_HISTORY: SAMPLE_MULTI_YEAR_HISTORY,
    SAMPLE_ACCURACY_DATA: SAMPLE_ACCURACY_DATA,
    SAMPLE_HOLIDAYS: SAMPLE_HOLIDAYS
  };
});
