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
  // 3b. PHASE 13 — FORECAST HOLDOUT SANDBOX ENGINE
  // =========================================================================

  /**
   * Phase 13: Extract all distinct calendar months (YYYY-MM) from history.
   * Returns array of month objects sorted chronologically with metadata and eligibility.
   */
  function extractHistoryMonths(history) {
    if (!history || history.length === 0) return [];

    var monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    var monthMap = {};

    history.forEach(function(row) {
      if (!row || !row.period) return;
      var dInfo = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(row.period) : null;
      if (!dInfo || !dInfo.isDate) return;

      var mPad = dInfo.month < 10 ? '0' + dInfo.month : String(dInfo.month);
      var key = dInfo.year + '-' + mPad;

      if (!monthMap[key]) {
        monthMap[key] = {
          key: key,
          label: monthNames[dInfo.month - 1] + ' ' + dInfo.year,
          shortLabel: monthNames[dInfo.month - 1].substring(0, 3) + ' ' + dInfo.year,
          year: dInfo.year,
          month: dInfo.month,
          periodCount: 0,
          firstDate: dInfo.isoDate,
          lastDate: dInfo.isoDate,
          firstTimestamp: dInfo.timestamp,
          lastTimestamp: dInfo.timestamp,
          totalVolume: 0,
          rows: []
        };
      }

      var mObj = monthMap[key];
      mObj.periodCount++;
      mObj.totalVolume += (row.volume || 0);
      mObj.rows.push(row);
      if (dInfo.timestamp < mObj.firstTimestamp) {
        mObj.firstTimestamp = dInfo.timestamp;
        mObj.firstDate = dInfo.isoDate;
      }
      if (dInfo.timestamp > mObj.lastTimestamp) {
        mObj.lastTimestamp = dInfo.timestamp;
        mObj.lastDate = dInfo.isoDate;
      }
    });

    var monthKeys = Object.keys(monthMap).sort();
    var resultList = [];

    monthKeys.forEach(function(k) {
      var m = monthMap[k];
      // Start of month timestamp (UTC)
      var monthStartUtc = Date.UTC(m.year, m.month - 1, 1);

      // Count rows in history that occur strictly BEFORE this month
      var precedingRows = history.filter(function(r) {
        var info = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(r.period) : null;
        return info && info.isDate && info.timestamp < monthStartUtc;
      });

      m.precedingCount = precedingRows.length;
      m.precedingStartDate = precedingRows[0] ? precedingRows[0].period : null;
      m.precedingEndDate = precedingRows[precedingRows.length - 1] ? precedingRows[precedingRows.length - 1].period : null;
      m.isEligible = m.precedingCount >= 4; // At least 4 data points before target month

      resultList.push(m);
    });

    return resultList;
  }

  /**
   * Phase 13: Execute Holdout Sandbox for specific target month(s).
   * Strict before-only training: for each target month M, models train exclusively on
   * history prior to the 1st of that month (t < M_start), with zero data leakage.
   * Configurable lookback: lookbackMonths specifies max history window preceding target.
   * 
   * @param {Array} history - Full historical time series dataset
   * @param {string|Array} targetMonths - Target month key(s), e.g. '2025-10' or ['2025-09', '2025-10']
   * @param {Array} [modelIds] - Candidate model IDs to evaluate
   * @param {Object} [modelParams] - Model parameters configuration
   * @param {string|number} [lookbackMonths] - 'all' or integer number of months (1, 3, 6, 12)
   * @param {Object} [options] - Additional options (holidays, assumedAht, etc.)
   * @returns {Object} Sandbox results containing per-month, per-model evaluations
   */
  function runHoldoutSandbox(history, targetMonths, modelIds, modelParams, lookbackMonths, options) {
    var targets = Array.isArray(targetMonths) ? targetMonths.slice() : (targetMonths ? [targetMonths] : []);
    if (!history || history.length === 0 || targets.length === 0) {
      return { targetMonths: [], lookbackMonths: lookbackMonths || 'all', monthEvaluations: [] };
    }

    var defaultModels = ['holt', 'decomp_mult', 'trend', 'regression', 'yoy_trend', 'ensemble'];
    var activeModels = (modelIds && modelIds.length > 0) ? modelIds : defaultModels;
    var allMonthMetadata = extractHistoryMonths(history);
    var monthMetaMap = {};
    allMonthMetadata.forEach(function(m) { monthMetaMap[m.key] = m; });

    var perMonthEvaluations = [];

    targets.forEach(function(mKey) {
      var meta = monthMetaMap[mKey];
      var mYear, mMonth;
      if (meta) {
        mYear = meta.year;
        mMonth = meta.month;
      } else {
        var parts = mKey.split('-');
        mYear = parseInt(parts[0], 10);
        mMonth = parseInt(parts[1], 10);
      }

      if (isNaN(mYear) || isNaN(mMonth)) return;

      var monthStartUtc = Date.UTC(mYear, mMonth - 1, 1);
      var monthEndUtc = Date.UTC(mYear, mMonth, 0, 23, 59, 59, 999);

      // 1. Extract holdout rows (evaluation ground truth) for this month
      var holdoutRows = history.filter(function(r) {
        var info = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(r.period) : null;
        return info && info.isDate && info.timestamp >= monthStartUtc && info.timestamp <= monthEndUtc;
      });

      if (holdoutRows.length === 0) return;

      // 2. Extract candidate training pool (strictly before the 1st of target month)
      var beforePool = history.filter(function(r) {
        var info = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(r.period) : null;
        return info && info.isDate && info.timestamp < monthStartUtc;
      });

      // 3. Apply configurable lookback window
      var trainingRows = beforePool;
      var lookbackVal = lookbackMonths !== undefined ? lookbackMonths : 'all';
      if (lookbackVal !== 'all' && lookbackVal !== 0 && lookbackVal !== '0') {
        var lbInt = parseInt(lookbackVal, 10);
        if (lbInt > 0) {
          // Lookback start timestamp = mMonth - lbInt
          var lbStartUtc = Date.UTC(mYear, mMonth - 1 - lbInt, 1);
          trainingRows = beforePool.filter(function(r) {
            var info = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(r.period) : null;
            return info && info.isDate && info.timestamp >= lbStartUtc;
          });
        }
      }

      if (trainingRows.length < 3) {
        perMonthEvaluations.push({
          monthKey: mKey,
          monthLabel: meta ? meta.label : mKey,
          isFeasible: false,
          reason: 'Insufficient training data before ' + mKey + ' (found ' + trainingRows.length + ' periods, min 3 required)',
          models: []
        });
        return;
      }

      var modelResults = [];
      var futureDates = holdoutRows.map(function(h) { return h.period; });
      var actualVolumes = holdoutRows.map(function(h) { return h.volume; });

      activeModels.forEach(function(mId) {
        var model = MODEL_REGISTRY[mId];
        if (!model) return;

        // Fit candidate model strictly on training slice
        var fitResult = model.fit(trainingRows, modelParams || {});

        // Predict H steps matching exact holdout target dates
        var predictions = model.predict(fitResult, holdoutRows.length, {
          futureDates: futureDates,
          assumedAht: options ? options.assumedAht : 180,
          holidays: options ? options.holidays : []
        });

        var predictedVolumes = predictions.map(function(p) {
          return Math.max(0, Math.round(p.rawVolume !== undefined ? p.rawVolume : (p.volume || 0)));
        });

        // Compute out-of-sample accuracy metrics using reused Phase 12 engine
        var oosMetrics = calculateAccuracyMetrics(actualVolumes, predictedVolumes);
        var inSampleMetrics = fitResult.metrics || { mae: 0, mape: 0, rmse: 0, wape: 0 };
        var overfitGap = Math.max(0, oosMetrics.mape - inSampleMetrics.mape);

        modelResults.push({
          modelId: model.id,
          modelName: model.name,
          monthKey: mKey,
          monthLabel: meta ? meta.label : mKey,
          trainCount: trainingRows.length,
          trainStartDate: trainingRows[0] ? trainingRows[0].period : '',
          trainEndDate: trainingRows[trainingRows.length - 1] ? trainingRows[trainingRows.length - 1].period : '',
          holdoutCount: holdoutRows.length,
          holdoutStartDate: holdoutRows[0] ? holdoutRows[0].period : '',
          holdoutEndDate: holdoutRows[holdoutRows.length - 1] ? holdoutRows[holdoutRows.length - 1].period : '',
          lookbackWindow: lookbackVal,
          inSampleMetrics: inSampleMetrics,
          holdoutMetrics: oosMetrics,
          overfitGap: overfitGap,
          predictions: predictedVolumes,
          actuals: actualVolumes,
          holdoutPeriods: futureDates,
          totalActual: oosMetrics.totalActual,
          totalForecast: oosMetrics.totalForecast,
          varianceTotal: oosMetrics.varianceTotal
        });
      });

      // Sort models by holdout WAPE %
      modelResults.sort(function(a, b) {
        return a.holdoutMetrics.wape - b.holdoutMetrics.wape;
      });

      perMonthEvaluations.push({
        monthKey: mKey,
        monthLabel: meta ? meta.label : mKey,
        isFeasible: true,
        holdoutPeriodsCount: holdoutRows.length,
        trainPeriodsCount: trainingRows.length,
        models: modelResults
      });
    });

    return {
      targetMonths: targets,
      lookbackMonths: lookbackMonths || 'all',
      monthEvaluations: perMonthEvaluations
    };
  }

  /**
   * Phase 13: Multi-month consistency aggregation.
   * Compares model accuracy across all selected target months side-by-side,
   * computing volume-weighted overall WAPE, mean bias, variance/stability, and ranking.
   */
  function evaluateSandboxConsistency(history, targetMonths, modelIds, modelParams, lookbackMonths, options) {
    var rawSandbox = runHoldoutSandbox(history, targetMonths, modelIds, modelParams, lookbackMonths, options);
    var validMonths = rawSandbox.monthEvaluations.filter(function(m) { return m.isFeasible && m.models.length > 0; });

    if (validMonths.length === 0) {
      return {
        targetMonths: rawSandbox.targetMonths,
        lookbackMonths: rawSandbox.lookbackMonths,
        monthEvaluations: [],
        modelSummaries: [],
        winner: null
      };
    }

    var modelMap = {};

    validMonths.forEach(function(mEval) {
      mEval.models.forEach(function(mRes) {
        if (!modelMap[mRes.modelId]) {
          modelMap[mRes.modelId] = {
            modelId: mRes.modelId,
            modelName: mRes.modelName,
            monthResults: {},
            allActuals: [],
            allForecasts: [],
            inSampleMapeSum: 0,
            monthCount: 0
          };
        }
        var mRec = modelMap[mRes.modelId];
        mRec.monthResults[mRes.monthKey] = mRes;
        mRec.allActuals = mRec.allActuals.concat(mRes.actuals);
        mRec.allForecasts = mRec.allForecasts.concat(mRes.predictions);
        mRec.inSampleMapeSum += (mRes.inSampleMetrics.mape || 0);
        mRec.monthCount++;
      });
    });

    var modelSummaries = [];

    Object.keys(modelMap).forEach(function(mId) {
      var mRec = modelMap[mId];
      var overallMetrics = calculateAccuracyMetrics(mRec.allActuals, mRec.allForecasts);
      var wapes = [];
      var mapes = [];
      var biases = [];

      validMonths.forEach(function(mEval) {
        var res = mRec.monthResults[mEval.monthKey];
        if (res) {
          wapes.push(res.holdoutMetrics.wape);
          mapes.push(res.holdoutMetrics.mape);
          biases.push(res.holdoutMetrics.biasPct);
        }
      });

      // Calculate WAPE stability (Standard Deviation & Range across months)
      var n = wapes.length;
      var wapeMean = n > 0 ? (wapes.reduce(function(a, b) { return a + b; }, 0) / n) : 0;
      var wapeVariance = 0;
      for (var i = 0; i < n; i++) {
        var diff = wapes[i] - wapeMean;
        wapeVariance += (diff * diff);
      }
      var wapeStdDev = n > 1 ? Math.sqrt(wapeVariance / n) : 0;
      var minWape = n > 0 ? Math.min.apply(null, wapes) : 0;
      var maxWape = n > 0 ? Math.max.apply(null, wapes) : 0;
      var wapeRange = maxWape - minWape;

      modelSummaries.push({
        modelId: mId,
        modelName: mRec.modelName,
        monthCount: n,
        avgInSampleMape: mRec.monthCount > 0 ? (mRec.inSampleMapeSum / mRec.monthCount) : 0,
        overallWape: overallMetrics.wape,
        overallMape: overallMetrics.mape,
        overallBiasPct: overallMetrics.biasPct,
        overallMae: overallMetrics.mae,
        overallRmse: overallMetrics.rmse,
        totalActual: overallMetrics.totalActual,
        totalForecast: overallMetrics.totalForecast,
        varianceTotal: overallMetrics.varianceTotal,
        monthResults: mRec.monthResults,
        wapeMean: wapeMean,
        wapeStdDev: wapeStdDev,
        wapeRange: wapeRange,
        isBestOverall: false,
        isMostConsistent: false
      });
    });

    // Rank by overall volume-weighted WAPE (ascending)
    modelSummaries.sort(function(a, b) {
      return a.overallWape - b.overallWape;
    });

    if (modelSummaries.length > 0) {
      modelSummaries[0].isBestOverall = true;

      // Find most consistent (lowest WAPE std dev among top performers)
      var minStdDev = Infinity;
      var mostConsistentIdx = 0;
      modelSummaries.forEach(function(s, idx) {
        if (s.wapeStdDev < minStdDev) {
          minStdDev = s.wapeStdDev;
          mostConsistentIdx = idx;
        }
      });
      modelSummaries[mostConsistentIdx].isMostConsistent = true;
    }

    return {
      targetMonths: rawSandbox.targetMonths,
      lookbackMonths: rawSandbox.lookbackMonths,
      monthEvaluations: validMonths,
      modelSummaries: modelSummaries,
      winner: modelSummaries[0] || null,
      mostConsistent: (modelSummaries.length > 0 ? modelSummaries[mostConsistentIdx] : null)
    };
  }

  // =========================================================================
  // 3b. TIME SERIES AGGREGATION & DATE RANGE HELPERS (DAILY, WEEKLY, MONTHLY)
  // =========================================================================

  /**
   * Aggregate an array of time series data points into Daily, Weekly, or Monthly buckets.
   *
   * @param {Array<{period: string, volume: number, baseVolume?: number, holidayName?: string}>} data - Raw series
   * @param {'daily'|'weekly'|'monthly'} granularity - Aggregation level
   * @returns {Array<{period: string, label: string, volume: number, count: number, firstPeriod: string, lastPeriod: string}>}
   */
  function aggregateTimeSeries(data, granularity) {
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    if (granularity === 'daily' || !granularity) {
      return data.map(function(d) {
        return {
          period: d.period,
          label: d.period,
          volume: d.volume,
          baseVolume: d.baseVolume !== undefined ? d.baseVolume : d.volume,
          count: 1,
          firstPeriod: d.period,
          lastPeriod: d.period,
          holidayName: d.holidayName || null
        };
      });
    }

    var groups = {};
    var order = [];

    data.forEach(function(item, idx) {
      var p = item.period;
      var dInfo = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(p) : null;
      var key = p;
      var label = p;

      if (granularity === 'weekly') {
        if (dInfo && dInfo.isDate) {
          var offset = (dInfo.dayOfWeek + 6) % 7; // Monday = 0, Sunday = 6
          var mondayTs = dInfo.timestamp - (offset * 86400000);
          var monObj = ErlanglyUtils.parseDate(new Date(mondayTs));
          key = monObj.isoDate;
          label = 'Wk ' + monObj.isoDate;
        } else {
          var wkNum = Math.floor(idx / 7) + 1;
          key = 'Wk ' + wkNum;
          label = 'Week ' + wkNum;
        }
      } else if (granularity === 'monthly') {
        if (dInfo && dInfo.isDate) {
          var pad = function(n) { return n < 10 ? '0' + n : String(n); };
          key = dInfo.year + '-' + pad(dInfo.month);
          var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          label = monthNames[dInfo.month - 1] + ' ' + dInfo.year;
        } else {
          var moNum = Math.floor(idx / 30) + 1;
          key = 'Mo ' + moNum;
          label = 'Month ' + moNum;
        }
      }

      if (!groups[key]) {
        groups[key] = {
          period: key,
          label: label,
          volume: 0,
          baseVolume: 0,
          count: 0,
          firstPeriod: p,
          lastPeriod: p,
          holidayName: item.holidayName || null
        };
        order.push(key);
      }

      groups[key].volume += (item.volume || 0);
      groups[key].baseVolume += (item.baseVolume !== undefined ? item.baseVolume : (item.volume || 0));
      groups[key].count++;
      groups[key].lastPeriod = p;
      if (item.holidayName) groups[key].holidayName = item.holidayName;
    });

    return order.map(function(k) { return groups[k]; });
  }

  /**
   * Filter time series data to a specified [startDate, endDate] window.
   *
   * @param {Array<{period: string, volume: number}>} series
   * @param {string|null} startDate - 'YYYY-MM-DD' or null
   * @param {string|null} endDate - 'YYYY-MM-DD' or null
   * @returns {Array<{period: string, volume: number}>}
   */
  function filterTimeSeriesByDate(series, startDate, endDate) {
    if (!series || !Array.isArray(series)) return [];
    return series.filter(function(item) {
      if (!item || !item.period) return false;
      var p = item.period;
      if (startDate && p < startDate) return false;
      if (endDate && p > endDate) return false;
      return true;
    });
  }

  /**
   * Calculate date range window bounds based on full date set and preset selection.
   *
   * @param {Array<string>} allDates - Array of 'YYYY-MM-DD' strings
   * @param {'all'|'1y'|'6m'|'3m'|'1m'|'forecast'|'custom'} preset
   * @param {Array<string>} [forecastDates]
   * @returns {{startDate: string|null, endDate: string|null}}
   */
  function computeRangeBounds(allDates, preset, forecastDates) {
    if (!allDates || allDates.length === 0) return { startDate: null, endDate: null };
    var sorted = allDates.slice().sort();
    var minDate = sorted[0];
    var maxDate = sorted[sorted.length - 1];

    if (!preset || preset === 'all') {
      return { startDate: minDate, endDate: maxDate };
    }

    if (preset === 'forecast') {
      if (forecastDates && forecastDates.length > 0) {
        var fcSorted = forecastDates.slice().sort();
        var fcStart = fcSorted[0];
        var fcEnd = fcSorted[fcSorted.length - 1];
        var fcStartInfo = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(fcStart) : null;
        if (fcStartInfo && fcStartInfo.isDate) {
          var padDays = 14 * 86400000;
          var padObj = ErlanglyUtils.parseDate(new Date(fcStartInfo.timestamp - padDays));
          var padIso = padObj ? padObj.isoDate : fcStart;
          return { startDate: padIso < minDate ? minDate : padIso, endDate: fcEnd };
        }
        return { startDate: fcStart, endDate: fcEnd };
      }
      var trailingCount = Math.min(sorted.length, 30);
      return { startDate: sorted[sorted.length - trailingCount], endDate: maxDate };
    }

    var maxInfo = ErlanglyUtils && ErlanglyUtils.parseDate ? ErlanglyUtils.parseDate(maxDate) : null;
    if (!maxInfo || !maxInfo.isDate) {
      var count = sorted.length;
      var sliceCount = count;
      if (preset === '1y') sliceCount = Math.min(count, 365);
      else if (preset === '6m') sliceCount = Math.min(count, 180);
      else if (preset === '3m') sliceCount = Math.min(count, 90);
      else if (preset === '1m') sliceCount = Math.min(count, 30);
      var sIdx = Math.max(0, count - sliceCount);
      return { startDate: sorted[sIdx], endDate: maxDate };
    }

    var daysToSubtract = 365;
    if (preset === '1y') daysToSubtract = 365;
    else if (preset === '6m') daysToSubtract = 180;
    else if (preset === '3m') daysToSubtract = 90;
    else if (preset === '1m') daysToSubtract = 30;

    var startTs = maxInfo.timestamp - (daysToSubtract * 86400000);
    var startObj = ErlanglyUtils.parseDate(new Date(startTs));
    var startIso = startObj ? startObj.isoDate : minDate;
    if (startIso < minDate) startIso = minDate;

    return { startDate: startIso, endDate: maxDate };
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

  // Multi-Skill Synthetic Dataset (Customer Care, Technical Support, Billing & Inquiries)
  function generateMultiSkillHistory(startDateStr, totalDays) {
    var rows = [];
    var startInfo = ErlanglyUtils.parseDate(startDateStr || '2026-05-01');
    var days = totalDays || 28;
    var skills = [
      { name: 'Customer Care', base: 1400, aht: 180, dowWeights: [0.35, 1.35, 1.15, 1.10, 1.05, 0.95, 0.45] },
      { name: 'Technical Support', base: 650, aht: 300, dowWeights: [0.25, 1.40, 1.25, 1.15, 1.05, 0.85, 0.35] },
      { name: 'Billing & Inquiries', base: 450, aht: 150, dowWeights: [0.15, 1.50, 1.30, 1.10, 0.95, 0.80, 0.20] }
    ];

    for (var i = 0; i < days; i++) {
      var d = ErlanglyUtils.addDays(startInfo, i);
      var dayOfWeek = d.dayOfWeek;
      skills.forEach(function(sk) {
        var dowFactor = sk.dowWeights[dayOfWeek] || 1.0;
        var trendFactor = 1.0 + (0.05 * (i / days));
        var pseudoNoise = 1.0 + 0.04 * Math.sin(i * 7.3 + (sk.aht % 10));
        var vol = Math.round(sk.base * trendFactor * dowFactor * pseudoNoise);
        rows.push({
          period: d.isoDate,
          skill: sk.name,
          volume: Math.max(50, vol),
          aht: sk.aht
        });
      });
    }
    return rows;
  }

  var SAMPLE_MULTI_SKILL_HISTORY = generateMultiSkillHistory('2026-05-01', 28);

  // Standardized Template Generators (RFC-4180 CSV with multi-skill queue support)
  function downloadHistoricalTemplate() {
    var headers = ['Date', 'Skill', 'Volume', 'AHT'];
    var sampleRows = [
      ['2026-05-01', 'Customer Care', 1450, 180],
      ['2026-05-01', 'Technical Support', 620, 300],
      ['2026-05-01', 'Billing & Inquiries', 410, 150],
      ['2026-05-02', 'Customer Care', 680, 180],
      ['2026-05-02', 'Technical Support', 310, 300],
      ['2026-05-02', 'Billing & Inquiries', 180, 150],
      ['2026-05-03', 'Customer Care', 520, 180],
      ['2026-05-03', 'Technical Support', 240, 300],
      ['2026-05-03', 'Billing & Inquiries', 140, 150],
      ['2026-05-04', 'Customer Care', 2150, 180],
      ['2026-05-04', 'Technical Support', 920, 300],
      ['2026-05-04', 'Billing & Inquiries', 640, 150],
      ['2026-05-05', 'Customer Care', 1820, 180],
      ['2026-05-05', 'Technical Support', 780, 300],
      ['2026-05-05', 'Billing & Inquiries', 530, 150],
      ['2026-05-06', 'Customer Care', 1710, 180],
      ['2026-05-06', 'Technical Support', 730, 300],
      ['2026-05-06', 'Billing & Inquiries', 490, 150],
      ['2026-05-07', 'Customer Care', 1640, 180],
      ['2026-05-07', 'Technical Support', 700, 300],
      ['2026-05-07', 'Billing & Inquiries', 470, 150]
    ];
    if (ErlanglyUtils && ErlanglyUtils.exportCSV) {
      ErlanglyUtils.exportCSV('erlangly_demand_forecast_template.csv', headers, sampleRows);
    }
  }

  function downloadActualsTemplate() {
    var headers = ['Date', 'Skill', 'Forecast', 'Actual', 'AHT'];
    var sampleRows = [
      ['2026-05-01', 'Customer Care', 1450, 1480, 180],
      ['2026-05-01', 'Technical Support', 620, 610, 300],
      ['2026-05-01', 'Billing & Inquiries', 410, 425, 150],
      ['2026-05-02', 'Customer Care', 680, 695, 180],
      ['2026-05-02', 'Technical Support', 310, 305, 300],
      ['2026-05-02', 'Billing & Inquiries', 180, 175, 150],
      ['2026-05-03', 'Customer Care', 520, 510, 180],
      ['2026-05-03', 'Technical Support', 240, 245, 300],
      ['2026-05-03', 'Billing & Inquiries', 140, 138, 150],
      ['2026-05-04', 'Customer Care', 2150, 2180, 180],
      ['2026-05-04', 'Technical Support', 920, 905, 300],
      ['2026-05-04', 'Billing & Inquiries', 640, 660, 150],
      ['2026-05-05', 'Customer Care', 1820, 1845, 180],
      ['2026-05-05', 'Technical Support', 780, 765, 300],
      ['2026-05-05', 'Billing & Inquiries', 530, 545, 150]
    ];
    if (ErlanglyUtils && ErlanglyUtils.exportCSV) {
      ErlanglyUtils.exportCSV('erlangly_actuals_template.csv', headers, sampleRows);
    }
  }

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
    multiSkillHistory: [],
    skills: [],
    selectedSkill: 'all',
    perSkillForecasts: {},
    combinedForecast: null,
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

    // Phase 13: Holdout Sandbox State
    backtestMode: 'last_n', // 'last_n' | 'month_sandbox'
    sandboxTargetMonths: [],
    sandboxLookback: 'all',
    sandboxActiveModelId: null,
    lastSandboxResults: null,
    sandboxMultiView: 'comparison', // 'comparison' | 'consistency'
    sandboxAdvancedOpen: false,
    sandboxMonthDrawerOpen: false,
    
    // Accuracy tracking state (Phase 12 / Enhancement)
    accuracyPairs: [],
    accuracyRunsHistory: [],
    lastAccuracyMetrics: null,
    lockedForecast: null,

    // Chart Interactive Controls (Granularity & Date Range Zoom & CI)
    chartGranularity: 'daily', // 'daily' | 'weekly' | 'monthly'
    chartRangePreset: 'all',   // 'all' | '1y' | '6m' | '3m' | '1m' | 'forecast' | 'custom'
    chartStartDate: null,
    chartEndDate: null,
    confidenceInterval: 'none', // 'none' | '80' | '95'
    lastComparisonResults: [],

    chart: null,
    worker: null
  };

  /**
   * Compute Statistical Forecast Confidence Bounds (80% / 95% CI)
   */
  function computeForecastConfidenceBounds(forecastPoints, modelMetrics, historyLength, ciLevel) {
    if (!forecastPoints || forecastPoints.length === 0 || ciLevel === 'none') {
      return null;
    }
    var z = ciLevel === '95' ? 1.95996 : 1.28155; // 95% or 80%
    var baseRmse = (modelMetrics && modelMetrics.rmse > 0) ? modelMetrics.rmse : 0;

    if (baseRmse === 0) {
      if (modelMetrics && modelMetrics.mae > 0) {
        baseRmse = modelMetrics.mae * 1.2533; // Normal distribution approximation
      } else if (UIState.history && UIState.history.length > 1) {
        var mean = UIState.history.reduce(function(a, b) { return a + b.volume; }, 0) / UIState.history.length;
        var variance = UIState.history.reduce(function(a, b) { return a + Math.pow(b.volume - mean, 2); }, 0) / (UIState.history.length - 1);
        baseRmse = Math.sqrt(variance) * 0.15;
      } else {
        baseRmse = 50;
      }
    }

    var k = Math.max(1, historyLength || (UIState.history ? UIState.history.length : 28));
    var upper = [];
    var lower = [];

    forecastPoints.forEach(function(fp, hIdx) {
      var h = hIdx + 1;
      // Dispersion expands across forecast horizon
      var se_h = baseRmse * Math.sqrt(1 + (h - 1) / k);
      var margin = z * se_h;
      var uVal = Math.round(fp.volume + margin);
      var lVal = Math.max(0, Math.round(fp.volume - margin));
      upper.push({ period: fp.period, volume: uVal, label: fp.label, skill: fp.skill });
      lower.push({ period: fp.period, volume: lVal, label: fp.label, skill: fp.skill });
    });

    return {
      upper: upper,
      lower: lower,
      level: ciLevel,
      z: z,
      rmse: baseRmse
    };
  }

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

  /**
   * Dynamically adjust the forecast breakdown table container max-height.
   * When Model Comparison & Backtest or Accuracy Tracking is shown in the right column,
   * compact the table to clamp(320px, 45vh, 520px) to prevent excessive page height.
   * When backtest sandbox and accuracy tracking are hidden (standard view),
   * stretch the table to clamp(450px, 75vh, 900px) showing 15-25+ rows comfortably.
   */
  function updateTableContainerHeight() {
    var compPanel = document.getElementById('panel-model-comparison');
    var accuracyPanel = document.getElementById('panel-accuracy-tracking');
    var tableContainer = document.querySelector('#panel-forecast-table .table-container');
    if (!tableContainer) return;
    
    var compVisible = compPanel && compPanel.style.display === 'block';
    var accuracyVisible = accuracyPanel && accuracyPanel.style.display === 'block';
    
    if (compVisible || accuracyVisible) {
      tableContainer.style.maxHeight = 'clamp(320px, 45vh, 520px)';
    } else {
      tableContainer.style.maxHeight = 'clamp(450px, 75vh, 900px)';
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
    updateTableContainerHeight();
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
      if (shared.backtestMode) UIState.backtestMode = shared.backtestMode;
      if (shared.sandboxTargetMonths) UIState.sandboxTargetMonths = shared.sandboxTargetMonths;
      if (shared.sandboxLookback) UIState.sandboxLookback = shared.sandboxLookback;
      if (shared.sandboxActiveModelId) UIState.sandboxActiveModelId = shared.sandboxActiveModelId;
      if (shared.chartGranularity) UIState.chartGranularity = shared.chartGranularity;
      if (shared.chartRangePreset) UIState.chartRangePreset = shared.chartRangePreset;
      if (shared.chartStartDate) UIState.chartStartDate = shared.chartStartDate;
      if (shared.chartEndDate) UIState.chartEndDate = shared.chartEndDate;
      loadHistory(UIState.history);
      renderHolidaysTable();
      renderAccuracyTable();
      renderLockedForecastUI();
      updateModelParamsUI();
      renderTrendProfileUI();
      updateBacktestModeUI();
      updateChartControlsUI();
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
        if (saved.backtestMode) UIState.backtestMode = saved.backtestMode;
        if (saved.sandboxTargetMonths) UIState.sandboxTargetMonths = saved.sandboxTargetMonths;
        if (saved.sandboxLookback) UIState.sandboxLookback = saved.sandboxLookback;
        if (saved.sandboxActiveModelId) UIState.sandboxActiveModelId = saved.sandboxActiveModelId;
        if (saved.chartGranularity) UIState.chartGranularity = saved.chartGranularity;
        if (saved.chartRangePreset) UIState.chartRangePreset = saved.chartRangePreset;
        if (saved.chartStartDate) UIState.chartStartDate = saved.chartStartDate;
        if (saved.chartEndDate) UIState.chartEndDate = saved.chartEndDate;
        loadHistory(UIState.history);
        renderHolidaysTable();
        renderAccuracyTable();
        renderLockedForecastUI();
        updateModelParamsUI();
        renderTrendProfileUI();
        updateBacktestModeUI();
        updateChartControlsUI();
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
      updateTableContainerHeight();
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
    var btnLoadMultiSkill = document.getElementById('btn-load-multiskill-sample');
    var btnClearHistory = document.getElementById('btn-clear-history');
    var btnAddRow = document.getElementById('btn-add-row');

    var btnDownloadForecastTemplate = document.getElementById('btn-download-forecast-template');
    var btnDownloadAccuracyTemplate = document.getElementById('btn-download-accuracy-template');
    var selectSkill = document.getElementById('select-skill-filter');

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

    // Backtest & Sandbox Controls
    var btnRunBacktest = document.getElementById('btn-run-backtest');
    var inpBacktestHoldout = document.getElementById('num-backtest-holdout');
    var btnModeLastN = document.getElementById('btn-mode-last-n');
    var btnModeSandbox = document.getElementById('btn-mode-sandbox');
    var btnSandboxSelectLast = document.getElementById('btn-sandbox-select-last');
    var btnSandboxSelectLast3 = document.getElementById('btn-sandbox-select-last3');
    var btnSandboxClearMonths = document.getElementById('btn-sandbox-clear-months');
    var selectSandboxLookback = document.getElementById('select-sandbox-lookback');
    var btnRunSandbox = document.getElementById('btn-run-sandbox');
    var btnExportSandboxCSV = document.getElementById('btn-export-sandbox-csv');
    var btnApplySandboxWinner = document.getElementById('btn-apply-sandbox-winner');

    // Multi-Skill Filter Listener
    if (selectSkill) {
      selectSkill.addEventListener('change', function() {
        UIState.selectedSkill = selectSkill.value;
        updateActiveSkillView();
        renderHistoryTable();
        setupSkillFilterUI();
        runForecast();
        var label = UIState.selectedSkill === 'all' ? 'Combined (All Skills)' : UIState.selectedSkill;
        ErlanglyUtils.showToast('Switched queue view to ' + label, 'info');
      });
    }

    // Template Download Listeners
    if (btnDownloadForecastTemplate) {
      btnDownloadForecastTemplate.addEventListener('click', function() {
        downloadHistoricalTemplate();
      });
    }

    if (btnDownloadAccuracyTemplate) {
      btnDownloadAccuracyTemplate.addEventListener('click', function() {
        downloadActualsTemplate();
      });
    }

    if (btnModeLastN && btnModeSandbox) {
      btnModeLastN.addEventListener('click', function() {
        UIState.backtestMode = 'last_n';
        updateBacktestModeUI();
        runForecast();
      });
      btnModeSandbox.addEventListener('click', function() {
        UIState.backtestMode = 'month_sandbox';
        updateBacktestModeUI();
        renderSandboxMonthChips();
        runForecast();
      });
    }

    if (btnSandboxSelectLast) {
      btnSandboxSelectLast.addEventListener('click', function() {
        var months = extractHistoryMonths(UIState.history).filter(function(m) { return m.isEligible; });
        if (months.length > 0) {
          UIState.sandboxTargetMonths = [months[months.length - 1].key];
          renderSandboxMonthChips();
          runForecast();
        } else {
          ErlanglyUtils.showToast('No eligible holdout months with preceding data available', 'warn');
        }
      });
    }

    if (btnSandboxSelectLast3) {
      btnSandboxSelectLast3.addEventListener('click', function() {
        var months = extractHistoryMonths(UIState.history).filter(function(m) { return m.isEligible; });
        if (months.length > 0) {
          UIState.sandboxTargetMonths = months.slice(Math.max(0, months.length - 3)).map(function(m) { return m.key; });
          renderSandboxMonthChips();
          runForecast();
        } else {
          ErlanglyUtils.showToast('No eligible holdout months with preceding data available', 'warn');
        }
      });
    }

    if (btnSandboxClearMonths) {
      btnSandboxClearMonths.addEventListener('click', function() {
        UIState.sandboxTargetMonths = [];
        renderSandboxMonthChips();
        runForecast();
        ErlanglyUtils.showToast('Cleared holdout target months', 'info');
      });
    }

    if (selectSandboxLookback) {
      selectSandboxLookback.addEventListener('change', function() {
        UIState.sandboxLookback = selectSandboxLookback.value;
        runForecast();
      });
    }

    if (btnRunSandbox) {
      btnRunSandbox.addEventListener('click', function() {
        runForecast();
        ErlanglyUtils.showToast('Re-evaluated holdout sandbox across candidate models', 'success');
      });
    }

    if (btnExportSandboxCSV) {
      btnExportSandboxCSV.addEventListener('click', function() {
        exportSandboxCSV();
      });
    }

    if (btnApplySandboxWinner) {
      btnApplySandboxWinner.addEventListener('click', function() {
        if (UIState.lastSandboxResults && UIState.lastSandboxResults.winner) {
          applySandboxWinner(UIState.lastSandboxResults.winner.modelId);
        } else if (UIState.sandboxActiveModelId) {
          applySandboxWinner(UIState.sandboxActiveModelId);
        } else {
          ErlanglyUtils.showToast('No sandbox winner identified yet', 'warn');
        }
      });
    }

    // Toggle Collapsible Month Selector Drawer
    var btnToggleMonthDrawer = document.getElementById('btn-toggle-month-drawer');
    if (btnToggleMonthDrawer) {
      btnToggleMonthDrawer.addEventListener('click', function() {
        UIState.sandboxMonthDrawerOpen = !UIState.sandboxMonthDrawerOpen;
        var drawer = document.getElementById('sandbox-month-drawer');
        if (drawer) {
          if (UIState.sandboxMonthDrawerOpen) {
            drawer.classList.add('open');
            btnToggleMonthDrawer.textContent = '📅 Close Picker ▴';
          } else {
            drawer.classList.remove('open');
            btnToggleMonthDrawer.textContent = '📅 Pick Months ▾';
          }
        }
      });
    }

    // Toggle Progressive Disclosure: Advanced Metrics Drawer
    var btnToggleAdv = document.getElementById('btn-toggle-advanced-metrics');
    if (btnToggleAdv) {
      btnToggleAdv.addEventListener('click', function() {
        UIState.sandboxAdvancedOpen = !UIState.sandboxAdvancedOpen;
        var advDrawer = document.getElementById('sandbox-advanced-drawer');
        if (advDrawer) {
          if (UIState.sandboxAdvancedOpen) {
            advDrawer.classList.add('open');
            btnToggleAdv.innerHTML = '<span>▲ Hide Advanced Metrics</span><span style="font-size: 10px; opacity: 0.7;">Diagnostics</span>';
          } else {
            advDrawer.classList.remove('open');
            btnToggleAdv.innerHTML = '<span>▾ Show Advanced Metrics (In-Sample MAPE, MAE, RMSE, Overfit Gap)</span><span style="font-size: 10px; opacity: 0.7;">Diagnostics</span>';
          }
        }
      });
    }

    // Multi-Month View Switcher Tabs (Model Comparison vs Month Consistency)
    var btnViewComp = document.getElementById('btn-view-comparison');
    var btnViewCons = document.getElementById('btn-view-consistency');
    if (btnViewComp && btnViewCons) {
      btnViewComp.addEventListener('click', function() {
        UIState.sandboxMultiView = 'comparison';
        btnViewComp.className = 'segmented-btn active';
        btnViewCons.className = 'segmented-btn';
        if (UIState.lastSandboxResults) {
          renderSandboxUI(UIState.lastSandboxResults);
        }
      });
      btnViewCons.addEventListener('click', function() {
        UIState.sandboxMultiView = 'consistency';
        btnViewComp.className = 'segmented-btn';
        btnViewCons.className = 'segmented-btn active';
        if (UIState.lastSandboxResults) {
          renderSandboxUI(UIState.lastSandboxResults);
        }
      });
    }

    // Chart Granularity Toggle Buttons (Daily, Weekly, Monthly)
    var btnDaily = document.getElementById('btn-granularity-daily');
    var btnWeekly = document.getElementById('btn-granularity-weekly');
    var btnMonthly = document.getElementById('btn-granularity-monthly');

    if (btnDaily) {
      btnDaily.addEventListener('click', function() {
        UIState.chartGranularity = 'daily';
        updateChartControlsUI();
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
      });
    }
    if (btnWeekly) {
      btnWeekly.addEventListener('click', function() {
        UIState.chartGranularity = 'weekly';
        updateChartControlsUI();
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
      });
    }
    if (btnMonthly) {
      btnMonthly.addEventListener('click', function() {
        UIState.chartGranularity = 'monthly';
        updateChartControlsUI();
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
      });
    }

    // Chart Range Preset Buttons (All, 1Y, 6M, 3M, 1M, Forecast)
    var rangePresets = [
      { id: 'btn-range-all', preset: 'all' },
      { id: 'btn-range-1y', preset: '1y' },
      { id: 'btn-range-6m', preset: '6m' },
      { id: 'btn-range-3m', preset: '3m' },
      { id: 'btn-range-1m', preset: '1m' },
      { id: 'btn-range-fc', preset: 'forecast' }
    ];
    rangePresets.forEach(function(rp) {
      var btn = document.getElementById(rp.id);
      if (btn) {
        btn.addEventListener('click', function() {
          UIState.chartRangePreset = rp.preset;
          UIState.chartStartDate = null;
          UIState.chartEndDate = null;
          updateChartControlsUI();
          renderChart(UIState.lastForecast, UIState.lastComparisonResults);
        });
      }
    });

    // Chart Custom Date Inputs & Reset Button
    var inpChartStart = document.getElementById('input-chart-start-date');
    var inpChartEnd = document.getElementById('input-chart-end-date');
    var btnChartReset = document.getElementById('btn-chart-reset-range');
    var selectChartCI = document.getElementById('select-chart-ci');

    if (selectChartCI) {
      selectChartCI.value = UIState.confidenceInterval || 'none';
      selectChartCI.addEventListener('change', function() {
        UIState.confidenceInterval = selectChartCI.value;
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
        if (UIState.lastForecast) {
          renderForecastTable(UIState.lastForecast);
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('erlangly:themechange', function() {
        // Do NOT destroy the chart — destroying causes the canvas to lose its
        // constrained size and the replacement chart renders taller than intended.
        // The renderChart() in-place update path (lines ~5435-5449) already
        // updates all theme-sensitive colors without a full rebuild.
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
      });
    }

    if (inpChartStart) {
      inpChartStart.addEventListener('change', function() {
        if (inpChartStart.value) {
          UIState.chartRangePreset = 'custom';
          UIState.chartStartDate = inpChartStart.value;
          updateChartControlsUI();
          renderChart(UIState.lastForecast, UIState.lastComparisonResults);
        }
      });
    }
    if (inpChartEnd) {
      inpChartEnd.addEventListener('change', function() {
        if (inpChartEnd.value) {
          UIState.chartRangePreset = 'custom';
          UIState.chartEndDate = inpChartEnd.value;
          updateChartControlsUI();
          renderChart(UIState.lastForecast, UIState.lastComparisonResults);
        }
      });
    }
    if (btnChartReset) {
      btnChartReset.addEventListener('click', function() {
        UIState.chartRangePreset = 'all';
        UIState.chartStartDate = null;
        UIState.chartEndDate = null;
        updateChartControlsUI();
        renderChart(UIState.lastForecast, UIState.lastComparisonResults);
        ErlanglyUtils.showToast('Reset chart window to all available dates', 'info');
      });
    }

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

    if (btnLoadMultiSkill) {
      btnLoadMultiSkill.addEventListener('click', function() {
        loadHistory(SAMPLE_MULTI_SKILL_HISTORY);
        ErlanglyUtils.showToast('Loaded multi-skill sample dataset (Customer Care, Tech Support, Billing)', 'success');
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

        // In multi-skill mode default to the first known skill (not 'General')
        // so the new row appears in a real queue and is editable via the skill dropdown.
        var defaultSkill;
        if (UIState.skills.length > 1) {
          defaultSkill = UIState.selectedSkill !== 'all' ? UIState.selectedSkill : UIState.skills[0];
        } else {
          defaultSkill = UIState.selectedSkill === 'all' ? 'General' : UIState.selectedSkill;
        }

        var newRow = {
          period: nextPeriod,
          skill: defaultSkill,
          volume: 1500,
          aht: UIState.assumedAht
        };
        UIState.history.push(newRow);
        if (UIState.multiSkillHistory.length > 0) {
          UIState.multiSkillHistory.push(newRow);
        }
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
        updateTableContainerHeight();
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

    // Actuals CSV File Dropzone (Multi-Skill Aware with Preview Modal)
    if (accuracyDropzone && accuracyFileInput) {
      ErlanglyUtils.wireFileDrop(accuracyDropzone, accuracyFileInput, function(text, file) {
        if (typeof ErlanglyUtils !== 'undefined' && typeof ErlanglyUtils.showCSVPreviewModal === 'function') {
          ErlanglyUtils.showCSVPreviewModal({
            title: 'Actuals Demand CSV Preview',
            file: file,
            filename: file ? file.name : 'actuals.csv',
            text: text,
            requiredHeaders: ['Date', 'Actual'],
            optionalHeaders: ['Forecast', 'Skill', 'AHT', 'Volume', 'Calls', 'Queue', 'Period', 'Interval'],
            rowValidator: function(row) {
              var p = (row.date || row.period || row.interval || row.day || row.timestamp || row.time);
              if (!p) return { valid: false, error: 'Missing Date / Period column value' };
              var act = parseFloat(row.actual || row.actual_volume || row.actuals || row.volume || row.calls);
              if (isNaN(act) || act < 0) return { valid: false, error: 'Actual volume must be a valid non-negative number' };
              return { valid: true };
            },
            onConfirm: function(parsedResult) {
              processActualsRows(parsedResult.rows, file ? file.name : 'actuals.csv');
            }
          });
          return;
        }

        var parsed = ErlanglyUtils.parseCSV(text);
        if (!parsed.rows || parsed.rows.length === 0) {
          ErlanglyUtils.showToast('No valid data rows found in CSV', 'warn');
          return;
        }
        processActualsRows(parsed.rows, file ? file.name : 'actuals.csv');
      });
    }

    function processActualsRows(rows, filename) {
      var baselineForecast = UIState.lockedForecast ? UIState.lockedForecast.forecast : (UIState.lastForecast ? UIState.lastForecast.forecast : []);
      var forecastMap = {};
      baselineForecast.forEach(function(f) {
        if (f.period) {
          var kSimple = f.period.trim().toLowerCase();
          forecastMap[kSimple] = f.volume;
          if (f.skill) {
            var kSkill = (f.period.trim() + ':::' + f.skill.trim()).toLowerCase();
            forecastMap[kSkill] = f.volume;
          }
        }
      });

      if (UIState.perSkillForecasts) {
        Object.keys(UIState.perSkillForecasts).forEach(function(sk) {
          var sf = UIState.perSkillForecasts[sk];
          if (sf && sf.forecast) {
            sf.forecast.forEach(function(f) {
              var kSkill = (f.period.trim() + ':::' + sk.trim()).toLowerCase();
              forecastMap[kSkill] = f.volume;
            });
          }
        });
      }

      var pairs = [];
      var matchedCount = 0;

      rows.forEach(function(r, idx) {
        var p = (r.period || r.date || r.interval || r.day || ('Period ' + (idx + 1))).trim();
        var sk = (r.skill || r.queue || r.channel || r.lob || '').trim();
        var act = parseFloat(r.actual || r.actual_volume || r.actuals || r.volume || r.calls || 0) || 0;
        var keySimple = p.toLowerCase();
        var keySkill = (p + ':::' + sk).toLowerCase();

        var fc = 0;
        if (sk && forecastMap[keySkill] !== undefined) {
          fc = forecastMap[keySkill];
          matchedCount++;
        } else if (forecastMap[keySimple] !== undefined) {
          fc = forecastMap[keySimple];
          matchedCount++;
        } else if (r.forecast) {
          fc = parseFloat(r.forecast) || 0;
        }

        pairs.push({
          period: p,
          skill: sk || 'General',
          forecast: fc,
          actual: act
        });
      });

      if (pairs.length > 0) {
        UIState.accuracyPairs = pairs;
        renderAccuracyTable();
        renderAccuracyDashboard();
        var matchMsg = matchedCount > 0 ? (' (' + matchedCount + ' auto-matched to forecast)') : '';
        ErlanglyUtils.showToast('Uploaded ' + pairs.length + ' actuals from ' + filename + matchMsg, 'success');
      }
    }

    // Merge Actuals into Historical Training Series (Multi-Skill Aware)
    if (btnMergeActualsHistory) {
      btnMergeActualsHistory.addEventListener('click', function() {
        var validActuals = UIState.accuracyPairs.filter(function(p) { return p.actual > 0; });
        if (validActuals.length === 0) {
          ErlanglyUtils.showToast('No actual volume records to merge into history', 'warn');
          return;
        }

        var targetList = UIState.multiSkillHistory.length > 0 ? UIState.multiSkillHistory : UIState.history;
        var historyMap = {};
        targetList.forEach(function(h) {
          var k = (h.period.trim() + ':::' + (h.skill || 'General')).toLowerCase();
          historyMap[k] = h;
          historyMap[h.period.trim().toLowerCase()] = h;
        });

        var updatedCount = 0;
        var appendedCount = 0;

        validActuals.forEach(function(pair) {
          var pairSkill = pair.skill || (UIState.selectedSkill === 'all' ? 'General' : UIState.selectedSkill);
          var keySkill = (pair.period.trim() + ':::' + pairSkill).toLowerCase();
          var keySimple = pair.period.trim().toLowerCase();

          if (historyMap[keySkill]) {
            historyMap[keySkill].volume = pair.actual;
            updatedCount++;
          } else if (historyMap[keySimple] && (!historyMap[keySimple].skill || historyMap[keySimple].skill === pairSkill)) {
            historyMap[keySimple].volume = pair.actual;
            updatedCount++;
          } else {
            var newEntry = {
              period: pair.period.trim(),
              skill: pairSkill,
              volume: pair.actual,
              aht: UIState.assumedAht
            };
            targetList.push(newEntry);
            historyMap[keySkill] = newEntry;
            appendedCount++;
          }
        });

        loadHistory(targetList);
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
        UIState.accuracyPairs.push({
          period: nextP,
          skill: UIState.selectedSkill === 'all' ? 'General' : UIState.selectedSkill,
          forecast: 1600,
          actual: 1620
        });
        renderAccuracyTable();
        renderAccuracyDashboard();
      });
    }

    if (btnPullFromForecast) {
      btnPullFromForecast.addEventListener('click', function() {
        var pairs = [];
        if (UIState.skills.length > 1 && UIState.perSkillForecasts && UIState.selectedSkill === 'all') {
          // Pull from all skills
          Object.keys(UIState.perSkillForecasts).forEach(function(sk) {
            var sf = UIState.perSkillForecasts[sk];
            if (sf && sf.forecast) {
              sf.forecast.forEach(function(f) {
                pairs.push({
                  period: f.period,
                  skill: sk,
                  forecast: f.volume,
                  actual: f.volume
                });
              });
            }
          });
        } else {
          var source = UIState.lockedForecast ? UIState.lockedForecast.forecast : (UIState.lastForecast ? UIState.lastForecast.forecast : null);
          if (!source || source.length === 0) {
            ErlanglyUtils.showToast('Generate or lock a forecast first to populate periods', 'warn');
            return;
          }
          pairs = source.map(function(f) {
            return {
              period: f.period,
              skill: f.skill || (UIState.selectedSkill === 'all' ? 'Combined' : UIState.selectedSkill),
              forecast: f.volume,
              actual: f.volume
            };
          });
        }

        UIState.accuracyPairs = pairs;
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
        var hasSkills = UIState.accuracyPairs.some(function(p) { return p.skill && p.skill !== 'General'; });
        var headers = hasSkills ?
          ['Period', 'Skill', 'Forecast_Volume', 'Actual_Volume', 'Variance_Calls', 'Abs_Error_Calls', 'Error_Pct', 'Signed_Bias_Pct', 'Status'] :
          ['Period', 'Forecast_Volume', 'Actual_Volume', 'Variance_Calls', 'Abs_Error_Calls', 'Error_Pct', 'Signed_Bias_Pct', 'Status'];

        var rows = UIState.lastAccuracyMetrics.details.map(function(d, i) {
          var pair = UIState.accuracyPairs[i] || {};
          var status = Math.abs(d.signedPct) <= 5.0 ? 'On Target' : (d.signedPct > 5.0 ? 'Over-Forecast' : 'Under-Forecast');
          if (hasSkills) {
            return [
              pair.period || ('Period ' + (i + 1)),
              pair.skill || 'General',
              Math.round(d.forecast),
              Math.round(d.actual),
              Math.round(d.error),
              Math.round(d.absError),
              d.pctError.toFixed(2) + '%',
              (d.signedPct >= 0 ? '+' : '') + d.signedPct.toFixed(2) + '%',
              status
            ];
          }
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

    // Export Forecast CSV (Multi-Skill Aware)
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', function() {
        if (!UIState.lastForecast || UIState.lastForecast.forecast.length === 0) return;
        var headers = ['Future_Period', 'Skill', 'Algorithm', 'Base_Model_Volume', 'Trend_Factor', 'Seasonality_Index', 'Trend_Profile_Factor', 'Holiday_Factor', 'Holiday_Name', 'Projected_Volume', 'Assumed_AHT_Sec', 'Est_Erlangs'];
        var rows = [];

        if (UIState.skills.length > 1 && UIState.perSkillForecasts && Object.keys(UIState.perSkillForecasts).length > 0) {
          // Export all skills
          UIState.skills.forEach(function(sk) {
            var sf = UIState.perSkillForecasts[sk];
            if (sf && sf.forecast) {
              var skAht = sf.assumedAht || UIState.assumedAht;
              sf.forecast.forEach(function(r) {
                var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, skAht, 3600 * 8) : (r.volume * skAht / 28800);
                rows.push([
                  r.period,
                  sk,
                  sf.modelName || UIState.lastForecast.modelName,
                  Math.round(r.baseVolume),
                  r.trendFactor.toFixed(3),
                  r.seasonalityIndex.toFixed(3),
                  (r.trendProfileFactor || 1.0).toFixed(3),
                  r.holidayFactor.toFixed(2),
                  r.holidayName || 'None',
                  Math.round(r.volume),
                  skAht,
                  erlangs.toFixed(2)
                ]);
              });
            }
          });

          // Also export Combined projection
          if (UIState.combinedForecast && UIState.combinedForecast.forecast) {
            var combAht = UIState.combinedForecast.assumedAht || UIState.assumedAht;
            UIState.combinedForecast.forecast.forEach(function(r) {
              var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, combAht, 3600 * 8) : (r.volume * combAht / 28800);
              rows.push([
                r.period,
                'Combined (All Skills)',
                UIState.combinedForecast.modelName || UIState.lastForecast.modelName,
                Math.round(r.baseVolume),
                r.trendFactor.toFixed(3),
                r.seasonalityIndex.toFixed(3),
                (r.trendProfileFactor || 1.0).toFixed(3),
                r.holidayFactor.toFixed(2),
                r.holidayName || 'None',
                Math.round(r.volume),
                combAht,
                erlangs.toFixed(2)
              ]);
            });
          }
        } else {
          // Single skill
          var activeSkill = UIState.selectedSkill === 'all' ? 'General' : UIState.selectedSkill;
          UIState.lastForecast.forecast.forEach(function(r) {
            var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, UIState.assumedAht, 3600 * 8) : (r.volume * UIState.assumedAht / 28800);
            rows.push([
              r.period,
              r.skill || activeSkill,
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
            ]);
          });
        }

        ErlanglyUtils.exportCSV('erlangly_multiskill_forecast.csv', headers, rows);
      });
    }

    // Send to Capacity Planning (Multi-Skill Aware)
    if (btnSendCapacity) {
      btnSendCapacity.addEventListener('click', function() {
        if (!UIState.lastForecast || UIState.lastForecast.forecast.length === 0) return;
        var activeSkillName = UIState.selectedSkill === 'all' ? 'Combined (All Skills)' : UIState.selectedSkill;
        var payload = {
          source: 'forecasting',
          skill: activeSkillName,
          aht: UIState.assumedAht,
          modelName: UIState.lastForecast.modelName,
          intervals: UIState.lastForecast.forecast.map(function(r) {
            return {
              interval: r.period,
              skill: r.skill || activeSkillName,
              volume: Math.round(r.volume),
              aht: UIState.assumedAht
            };
          })
        };
        ErlanglyUtils.setHandoff('capacity', payload);
        window.location.href = 'capacity.html?from=forecast';
      });
    }

    // Save Plan Modal Handler
    function handleSavePlanModal() {
      if (typeof window.ErlanglyPlans !== 'undefined' && window.ErlanglyPlans.showSaveModal) {
        var inputs = {
          history: UIState.history,
          multiSkillHistory: UIState.multiSkillHistory,
          skills: UIState.skills,
          selectedSkill: UIState.selectedSkill,
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
          lockedForecast: UIState.lockedForecast,
          backtestMode: UIState.backtestMode,
          sandboxTargetMonths: UIState.sandboxTargetMonths,
          sandboxLookback: UIState.sandboxLookback,
          sandboxActiveModelId: UIState.sandboxActiveModelId,
          chartGranularity: UIState.chartGranularity,
          chartRangePreset: UIState.chartRangePreset,
          chartStartDate: UIState.chartStartDate,
          chartEndDate: UIState.chartEndDate
        };
        var outputs = UIState.lastForecast ? {
          modelName: UIState.lastForecast.modelName,
          metrics: UIState.lastForecast.metrics,
          forecastCount: UIState.lastForecast.forecast.length,
          totalVolume: UIState.lastForecast.forecast.reduce(function(a, b) { return a + b.volume; }, 0),
          accuracyMetrics: UIState.lastAccuracyMetrics,
          lockedForecast: UIState.lockedForecast,
          sandboxResults: UIState.lastSandboxResults
        } : {};
        window.ErlanglyPlans.showSaveModal('forecasting', inputs, outputs);
      }
    }

    if (btnSavePlan) btnSavePlan.addEventListener('click', handleSavePlanModal);
    var btnSavePlanBottom = document.getElementById('btn-save-forecast-plan-bottom');
    if (btnSavePlanBottom) btnSavePlanBottom.addEventListener('click', handleSavePlanModal);

    // Share Plan Link Handler
    function handleSharePlanModal() {
      if (typeof window.ErlanglyPlans !== 'undefined' && window.ErlanglyPlans.showShareModal) {
        var inputs = {
          history: UIState.history,
          multiSkillHistory: UIState.multiSkillHistory,
          skills: UIState.skills,
          selectedSkill: UIState.selectedSkill,
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
          lockedForecast: UIState.lockedForecast,
          backtestMode: UIState.backtestMode,
          sandboxTargetMonths: UIState.sandboxTargetMonths,
          sandboxLookback: UIState.sandboxLookback,
          sandboxActiveModelId: UIState.sandboxActiveModelId,
          chartGranularity: UIState.chartGranularity,
          chartRangePreset: UIState.chartRangePreset,
          chartStartDate: UIState.chartStartDate,
          chartEndDate: UIState.chartEndDate
        };
        var planTitle = 'Demand Forecast (' + (UIState.lastForecast ? UIState.lastForecast.modelName : 'Active Series') + ')';
        window.ErlanglyPlans.showShareModal('forecasting', planTitle, inputs);
      }
    }

    if (btnSharePlan) btnSharePlan.addEventListener('click', handleSharePlanModal);
    var btnSharePlanBottom = document.getElementById('btn-share-forecast-plan-bottom');
    if (btnSharePlanBottom) btnSharePlanBottom.addEventListener('click', handleSharePlanModal);

    // CSV File Dropzone (Multi-Skill Supported with Preview Modal)
    var dropzone = document.getElementById('forecast-dropzone');
    var fileInput = document.getElementById('forecast-file-input');
    var selectAgg = document.getElementById('select-csv-aggregate');

    if (dropzone && fileInput) {
      ErlanglyUtils.wireFileDrop(dropzone, fileInput, function(text, file) {
        if (file && file.size > 2 * 1024 * 1024 && UIState.worker) {
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
        } else if (typeof ErlanglyUtils !== 'undefined' && typeof ErlanglyUtils.showCSVPreviewModal === 'function') {
          ErlanglyUtils.showCSVPreviewModal({
            title: 'Historical Demand Series CSV Preview',
            file: file,
            filename: file ? file.name : 'history.csv',
            text: text,
            requiredHeaders: ['Date', 'Volume'],
            optionalHeaders: ['Skill', 'AHT', 'Queue', 'Channel', 'Interval', 'Period', 'Calls', 'Count'],
            rowValidator: function(row) {
              var p = (row.date || row.period || row.interval || row.day || row.timestamp || row.time);
              if (!p) return { valid: false, error: 'Missing Date / Period column value' };
              var vol = parseFloat(row.volume || row.calls || row.contacts || row.count || row.interactions);
              if (isNaN(vol) || vol < 0) return { valid: false, error: 'Volume must be a non-negative number' };
              return { valid: true };
            },
            onConfirm: function(parsedResult) {
              var skillsFound = {};
              var rows = parsedResult.rows.map(function(r, i) {
                var sk = (r.skill || r.queue || r.channel || r.lob || r.service || 'General').trim();
                if (sk && sk !== 'General') skillsFound[sk] = true;
                return {
                  period: r.date || r.period || r.interval || r.day || ('Row ' + (i + 1)),
                  skill: sk || 'General',
                  volume: parseFloat(r.volume || r.calls || r.contacts || 100) || 100,
                  aht: parseFloat(r.aht || r.handletime || r.duration || 180) || 180
                };
              });
              loadHistory(rows, Object.keys(skillsFound));
              ErlanglyUtils.showToast('Loaded ' + rows.length + ' history periods from ' + (file ? file.name : 'CSV'), 'success');
            }
          });
        } else {
          var parsed = ErlanglyUtils.parseCSV(text);
          if (parsed.rows && parsed.rows.length > 0) {
            var skillsFound = {};
            var rows = parsed.rows.map(function(r, i) {
              var sk = (r.skill || r.queue || r.channel || r.lob || r.service || 'General').trim();
              if (sk && sk !== 'General') skillsFound[sk] = true;
              return {
                period: r.period || r.date || r.interval || ('Row ' + (i + 1)),
                skill: sk || 'General',
                volume: parseFloat(r.volume || r.calls || 100) || 100,
                aht: parseFloat(r.aht || 180) || 180
              };
            });
            loadHistory(rows, Object.keys(skillsFound));
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
              loadHistory(msg.rows, msg.skills);
              var skillMsg = msg.skills && msg.skills.length > 1 ? (' across ' + msg.skills.length + ' skills') : '';
              ErlanglyUtils.showToast('Loaded ' + msg.rows.length + ' aggregated periods' + skillMsg + ' from ' + msg.totalParsed.toLocaleString() + ' rows', 'success');
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

  function updateActiveSkillView() {
    if (UIState.skills.length > 1) {
      if (UIState.selectedSkill === 'all') {
        var rollMap = {};
        UIState.multiSkillHistory.forEach(function(r) {
          var p = r.period;
          if (!rollMap[p]) {
            rollMap[p] = { period: p, skill: 'Combined', volume: 0, ahtSum: 0 };
          }
          rollMap[p].volume += r.volume;
          rollMap[p].ahtSum += (r.aht || 180) * r.volume;
        });

        var combinedList = Object.keys(rollMap).map(function(p) {
          var item = rollMap[p];
          return {
            period: item.period,
            skill: 'Combined',
            volume: Math.round(item.volume),
            aht: item.volume > 0 ? Math.round(item.ahtSum / item.volume) : 180
          };
        });

        combinedList.sort(function(a, b) {
          var infoA = ErlanglyUtils.parseDate(a.period);
          var infoB = ErlanglyUtils.parseDate(b.period);
          if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
          return 0;
        });

        UIState.history = combinedList;
      } else {
        var filtered = UIState.multiSkillHistory.filter(function(r) {
          return r.skill === UIState.selectedSkill;
        });
        filtered.sort(function(a, b) {
          var infoA = ErlanglyUtils.parseDate(a.period);
          var infoB = ErlanglyUtils.parseDate(b.period);
          if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
          return 0;
        });
        UIState.history = filtered;
      }
    } else {
      if (UIState.multiSkillHistory.length > 0) {
        UIState.history = UIState.multiSkillHistory;
      }
    }
  }

  function setupSkillFilterUI() {
    var sel = document.getElementById('select-skill-filter');
    var badge = document.getElementById('badge-skill-mode');
    var info = document.getElementById('lbl-skill-filter-info');
    var thHistSkill = document.getElementById('th-history-skill');
    var thFcSkill = document.getElementById('th-forecast-skill');
    var countSpan = document.getElementById('lbl-active-skill-count');

    if (!sel) return;

    if (UIState.skills.length > 1) {
      if (thHistSkill) thHistSkill.style.display = UIState.selectedSkill === 'all' ? 'none' : 'table-cell';
      if (thFcSkill) thFcSkill.style.display = 'table-cell';

      sel.innerHTML = '<option value="all">🌐 Combined (All Skills)</option>' +
        UIState.skills.map(function(sk) {
          return '<option value="' + sk + '" ' + (UIState.selectedSkill === sk ? 'selected' : '') + '>🏷️ ' + sk + '</option>';
        }).join('');
      sel.value = UIState.selectedSkill;

      if (badge) {
        if (UIState.selectedSkill === 'all') {
          badge.textContent = '🌐 Blended Multi-Skill';
          badge.className = 'badge badge-neutral';
        } else {
          badge.textContent = '🏷️ Skill: ' + UIState.selectedSkill;
          badge.className = 'badge badge-accent';
        }
      }

      if (countSpan) countSpan.textContent = UIState.skills.length;
      if (info) {
        if (UIState.selectedSkill === 'all') {
          info.innerHTML = 'Viewing combined aggregate across all queues (<span class="mono text-accent">' + UIState.skills.length + '</span> queues)';
        } else {
          info.innerHTML = 'Viewing queue: <strong class="text-accent">' + UIState.selectedSkill + '</strong> (<a href="#" id="link-reset-skill" style="color: var(--accent); text-decoration: underline;">switch to combined</a>)';
          var linkReset = document.getElementById('link-reset-skill');
          if (linkReset) {
            linkReset.addEventListener('click', function(e) {
              e.preventDefault();
              UIState.selectedSkill = 'all';
              sel.value = 'all';
              updateActiveSkillView();
              renderHistoryTable();
              setupSkillFilterUI();
              runForecast();
            });
          }
        }
      }
    } else {
      if (thHistSkill) thHistSkill.style.display = 'none';
      if (thFcSkill) thFcSkill.style.display = 'none';
      sel.innerHTML = '<option value="all">🌐 Single Skill (General)</option>';
      sel.value = 'all';
      if (badge) {
        badge.textContent = '🌐 Single Queue';
        badge.className = 'badge badge-neutral';
      }
      if (info) info.textContent = 'Single queue mode';
    }
  }

  function loadHistory(rows, detectedSkills) {
    var rawList = rows ? rows.slice() : [];

    // Check if rows have skill attribute
    var skillsMap = {};
    rawList.forEach(function(r) {
      if (r && r.skill && r.skill !== 'General' && r.skill !== 'Combined') {
        skillsMap[r.skill] = true;
      }
    });

    if (detectedSkills && Array.isArray(detectedSkills)) {
      detectedSkills.forEach(function(s) {
        if (s && s !== 'General' && s !== 'Combined') skillsMap[s] = true;
      });
    }

    var distinctSkills = Object.keys(skillsMap);
    if (distinctSkills.length > 1) {
      UIState.skills = distinctSkills;
      UIState.multiSkillHistory = rawList;
      if (UIState.selectedSkill !== 'all' && distinctSkills.indexOf(UIState.selectedSkill) === -1) {
        UIState.selectedSkill = 'all';
      }
    } else {
      UIState.skills = [];
      UIState.multiSkillHistory = [];
      UIState.selectedSkill = 'all';
    }

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
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        if (infoA && !infoB) return -1;
        if (!infoA && infoB) return 1;
        if (a.skill && b.skill && a.skill !== b.skill) return a.skill.localeCompare(b.skill);
        return 0;
      });

      rawList.forEach(function(row) {
        var info = ErlanglyUtils.parseDate(row.period);
        if (info) row.period = info.isoDate;
      });
    }

    updateActiveSkillView();
    if (UIState.skills.length <= 1) {
      UIState.history = rawList;
    }

    renderHistoryTable();
    renderSandboxMonthChips();
    updateBacktestModeUI();
    setupModelSelector();
    setupSkillFilterUI();
    runForecast();
  }

  function renderHistoryTable() {
    var tbody = document.getElementById('tbody-history-inputs');
    var countLbl = document.getElementById('lbl-history-count');
    var thHistSkill = document.getElementById('th-history-skill');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countLbl) countLbl.textContent = UIState.history.length;

    var showSkillCol = UIState.skills.length > 1;
    if (thHistSkill) thHistSkill.style.display = showSkillCol ? 'table-cell' : 'none';

    if (UIState.history.length === 0) {
      var colSpan = showSkillCol ? 4 : 3;
      tbody.innerHTML = '<tr><td colspan="' + colSpan + '" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No historical data. Load sample or upload CSV.</td></tr>';
      return;
    }

    UIState.history.forEach(function(row, idx) {
      var tr = document.createElement('tr');

      var tdPeriod = document.createElement('td');
      tdPeriod.style.minWidth = '90px';
      var inputPeriod = document.createElement('input');
      inputPeriod.type = 'text';
      inputPeriod.className = 'form-control mono';
      inputPeriod.style.height = '28px';
      inputPeriod.style.fontSize = 'var(--text-xs)';
      inputPeriod.style.width = '100%';
      inputPeriod.style.minWidth = '80px';
      inputPeriod.value = row.period;
      inputPeriod.addEventListener('input', function() { row.period = inputPeriod.value; });
      inputPeriod.addEventListener('change', function() {
        row.period = inputPeriod.value.trim();
        var info = ErlanglyUtils.parseDate(row.period);
        if (info) {
          row.period = info.isoDate;
          loadHistory(UIState.multiSkillHistory.length > 0 ? UIState.multiSkillHistory : UIState.history);
        } else {
          runForecast();
        }
      });
      tdPeriod.appendChild(inputPeriod);
      tr.appendChild(tdPeriod);

      if (showSkillCol) {
        var tdSkill = document.createElement('td');
        tdSkill.className = 'mono';
        tdSkill.style.whiteSpace = 'nowrap';

        // Build a select with every known skill so the user can re-assign the row
        var selSkill = document.createElement('select');
        selSkill.className = 'form-control mono';
        selSkill.style.height = '28px';
        selSkill.style.fontSize = 'var(--text-xs)';
        selSkill.style.minWidth = '110px';
        selSkill.style.cursor = 'pointer';
        selSkill.setAttribute('aria-label', 'Queue / Skill for this row');

        // Populate options from the known skills list
        UIState.skills.forEach(function(sk) {
          var opt = document.createElement('option');
          opt.value = sk;
          opt.textContent = sk;
          selSkill.appendChild(opt);
        });

        // Set current value
        var currentSkill = row.skill || UIState.skills[0];
        selSkill.value = UIState.skills.indexOf(currentSkill) !== -1 ? currentSkill : UIState.skills[0];
        // Keep row.skill in sync immediately (covers initial assignment)
        row.skill = selSkill.value;

        selSkill.addEventListener('change', function() {
          row.skill = selSkill.value;
          // Re-run the full load so skill-based aggregation updates correctly
          loadHistory(UIState.multiSkillHistory.length > 0 ? UIState.multiSkillHistory : UIState.history);
        });

        tdSkill.appendChild(selSkill);
        tr.appendChild(tdSkill);
      }

      var tdVol = document.createElement('td');
      tdVol.style.minWidth = '80px';
      var inputVol = document.createElement('input');
      inputVol.type = 'number';
      inputVol.className = 'form-control mono';
      inputVol.style.height = '28px';
      inputVol.style.fontSize = 'var(--text-xs)';
      inputVol.style.width = '100%';
      inputVol.style.minWidth = '70px';
      inputVol.value = Math.round(row.volume);
      inputVol.addEventListener('input', function() {
        row.volume = Math.max(0, parseFloat(inputVol.value) || 0);
        runForecast();
      });
      tdVol.appendChild(inputVol);
      tr.appendChild(tdVol);

      var tdAction = document.createElement('td');
      var btnDel = document.createElement('button');
      btnDel.className = 'btn btn-ghost btn-sm';
      btnDel.style.padding = '0 6px';
      btnDel.style.color = 'var(--danger)';
      btnDel.textContent = '✕';
      btnDel.title = 'Remove row';
      btnDel.addEventListener('click', function() {
        UIState.history.splice(idx, 1);
        if (UIState.multiSkillHistory.length > 0) {
          var mIdx = UIState.multiSkillHistory.indexOf(row);
          if (mIdx !== -1) UIState.multiSkillHistory.splice(mIdx, 1);
        }
        renderHistoryTable();
        runForecast();
      });
      tdAction.appendChild(btnDel);
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

    // If multi-skill dataset exists, compute forecasts for all individual skills + combined
    if (UIState.skills.length > 1 && UIState.multiSkillHistory.length > 0) {
      UIState.perSkillForecasts = {};
      UIState.skills.forEach(function(sk) {
        var skHistory = UIState.multiSkillHistory.filter(function(r) { return r.skill === sk; });
        skHistory.sort(function(a, b) {
          var infoA = ErlanglyUtils.parseDate(a.period);
          var infoB = ErlanglyUtils.parseDate(b.period);
          if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
          return 0;
        });

        var skAht = skHistory.length > 0 && skHistory[0].aht ? skHistory[0].aht : UIState.assumedAht;
        var skOptions = Object.assign({}, options, { assumedAht: skAht });
        var skRes = executeForecast(skHistory, UIState.modelId, UIState.modelParams, skOptions);
        skRes.forecast.forEach(function(f) {
          f.skill = sk;
          f.aht = skAht;
        });
        skRes.assumedAht = skAht;
        UIState.perSkillForecasts[sk] = skRes;
      });

      // Compute combined blended series
      var rollMap = {};
      UIState.multiSkillHistory.forEach(function(r) {
        var p = r.period;
        if (!rollMap[p]) {
          rollMap[p] = { period: p, skill: 'Combined', volume: 0, ahtSum: 0 };
        }
        rollMap[p].volume += r.volume;
        rollMap[p].ahtSum += (r.aht || 180) * r.volume;
      });
      var combinedHistory = Object.keys(rollMap).map(function(p) {
        var item = rollMap[p];
        return {
          period: item.period,
          skill: 'Combined',
          volume: Math.round(item.volume),
          aht: item.volume > 0 ? Math.round(item.ahtSum / item.volume) : 180
        };
      });
      combinedHistory.sort(function(a, b) {
        var infoA = ErlanglyUtils.parseDate(a.period);
        var infoB = ErlanglyUtils.parseDate(b.period);
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        return 0;
      });

      var avgCombinedAht = combinedHistory.length > 0 ? (combinedHistory.reduce(function(acc, row) { return acc + (row.aht * row.volume); }, 0) / Math.max(1, combinedHistory.reduce(function(acc, row) { return acc + row.volume; }, 0))) : UIState.assumedAht;
      var combOptions = Object.assign({}, options, { assumedAht: Math.round(avgCombinedAht) });
      var combRes = executeForecast(combinedHistory, UIState.modelId, UIState.modelParams, combOptions);
      combRes.forecast.forEach(function(f) {
        f.skill = 'Combined';
        f.aht = Math.round(avgCombinedAht);
      });
      combRes.assumedAht = Math.round(avgCombinedAht);
      UIState.combinedForecast = combRes;
    }

    // 1. Run main active forecast for UIState.history
    var result;
    if (UIState.skills.length > 1) {
      if (UIState.selectedSkill === 'all' && UIState.combinedForecast) {
        result = UIState.combinedForecast;
      } else if (UIState.perSkillForecasts && UIState.perSkillForecasts[UIState.selectedSkill]) {
        result = UIState.perSkillForecasts[UIState.selectedSkill];
      } else {
        result = executeForecast(UIState.history, UIState.modelId, UIState.modelParams, options);
      }
    } else {
      result = executeForecast(UIState.history, UIState.modelId, UIState.modelParams, options);
    }
    UIState.lastForecast = result;

    // Sync auto-optimized parameters back to UIState
    if (result.fitResult) {
      if (result.fitResult.alpha !== undefined) UIState.modelParams.alpha = result.fitResult.alpha;
      if (result.fitResult.beta !== undefined) UIState.modelParams.beta = result.fitResult.beta;
    }

    // 2. Run model comparison & backtesting / sandbox if comparison view is open
    var comparisonResults = [];
    if (UIState.compareMode) {
      var modelsToCompare = UIState.compareModelIds.length > 0 ? UIState.compareModelIds : ['holt', 'decomp_mult', 'trend', 'regression', 'yoy_trend', 'ensemble'];
      modelsToCompare.forEach(function(mId) {
        var compRes = executeForecast(UIState.history, mId, UIState.modelParams, options);
        comparisonResults.push(compRes);
      });

      if (UIState.backtestMode === 'last_n') {
        UIState.lastBacktestResults = runBacktestAll(UIState.history, modelsToCompare, UIState.modelParams, UIState.backtestHoldout, options);
      } else {
        // Phase 13: Month Holdout Sandbox Evaluation
        var sandboxRes = evaluateSandboxConsistency(UIState.history, UIState.sandboxTargetMonths, modelsToCompare, UIState.modelParams, UIState.sandboxLookback, options);
        UIState.lastSandboxResults = sandboxRes;
      }
    }

    // 3. Update KPI metrics cards
    updateSummaryKPIs(result);

    // 4. Render Forecast breakdown table
    renderForecastTable(result);

    // 5. Render Chart.js (with sandbox overlay if active)
    renderChart(result, comparisonResults);

    // 6. Render Model Comparison / Sandbox table
    if (UIState.compareMode) {
      if (UIState.backtestMode === 'last_n') {
        renderComparisonTable(comparisonResults, UIState.lastBacktestResults);
      } else {
        renderSandboxUI(UIState.lastSandboxResults);
      }
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
    var thFcSkill = document.getElementById('th-forecast-skill');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countLbl) countLbl.textContent = result.forecast.length;

    var showSkillCol = UIState.skills.length > 1;
    if (thFcSkill) thFcSkill.style.display = showSkillCol ? 'table-cell' : 'none';

    result.forecast.forEach(function(r) {
      var tr = document.createElement('tr');
      var ahtToUse = (r.aht || UIState.assumedAht);
      var erlangs = Erlangly ? Erlangly.trafficIntensity(r.volume, ahtToUse, 3600 * 8) : (r.volume * ahtToUse / 28800);

      var eventBadge = '';
      if (r.holidayName) {
        eventBadge = ' <span class="badge badge-warn" style="margin-left: 4px; font-size: 10px;">🎉 ' + r.holidayName + '</span>';
      }

      var tpf = r.trendProfileFactor || 1.0;
      var tpfPct = ((tpf - 1.0) * 100);
      var tpfDisplay = (tpf === 1.0) ? '—' : ((tpfPct >= 0 ? '+' : '') + tpfPct.toFixed(0) + '%');
      var tpfClass = tpf > 1.05 ? 'text-accent' : (tpf < 0.95 ? 'text-warn' : '');

      var skillTd = '';
      if (showSkillCol) {
        var skName = r.skill || (UIState.selectedSkill === 'all' ? 'Combined' : UIState.selectedSkill);
        skillTd = '<td class="mono"><span class="badge ' + (skName === 'Combined' ? 'badge-neutral' : 'badge-accent') + '" style="font-size: 10px;">' + skName + '</span></td>';
      }

      tr.innerHTML = 
        '<td class="mono"><strong>' + r.period + '</strong>' + eventBadge + '</td>' +
        skillTd +
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

    var sorted = compResults.slice().sort(function(a, b) {
      var btA = btMap[a.modelId];
      var btB = btMap[b.modelId];
      if (btA && btB) {
        return btA.outOfSampleMetrics.wape - btB.outOfSampleMetrics.wape;
      }
      return a.metrics.mape - b.metrics.mape;
    });

    sorted.forEach(function(c, idx) {
      var tr = document.createElement('tr');
      var isActive = c.modelId === UIState.modelId;
      var totalVol = c.forecast.reduce(function(a, b) { return a + b.volume; }, 0);
      var bt = btMap[c.modelId];

      var oosMapeStr = bt ? bt.outOfSampleMetrics.mape.toFixed(1) + '%' : '—';
      var oosWapeStr = bt ? bt.outOfSampleMetrics.wape.toFixed(1) + '%' : '—';
      var overfitGapStr = bt ? '+' + bt.overfitGap.toFixed(1) + '%' : '—';

      if (idx === 0 && bt) {
        tr.className = 'winner-row';
      }

      tr.innerHTML = 
        '<td style="text-align: center;"><span class="rank-badge ' + (idx === 0 ? 'rank-1' : '') + '">#' + (idx + 1) + '</span></td>' +
        '<td>' +
          '<strong>' + c.modelName + '</strong>' +
          (isActive ? '<span class="viewing-indicator">Active</span>' : '') +
        '</td>' +
        '<td class="mono text-accent"><strong>' + oosWapeStr + '</strong></td>' +
        '<td class="mono" style="color: var(--info);">' + oosMapeStr + '</td>' +
        '<td class="mono text-muted">' + c.metrics.mape.toFixed(1) + '%</td>' +
        '<td class="mono ' + (bt && bt.overfitGap > 10 ? 'text-warn' : '') + '">' + overfitGapStr + '</td>' +
        '<td class="mono">' + ErlanglyUtils.formatNumber(totalVol) + '</td>' +
        '<td style="text-align: right;">' +
          '<button class="btn btn-sm ' + (isActive ? 'btn-ghost' : 'btn-secondary') + '" style="font-size: 11px; height: 24px; padding: 2px 8px;" data-select-model="' + c.modelId + '">' +
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

  // =========================================================================
  // 9b. PHASE 13: HOLDOUT SANDBOX UI RENDERING & ACTIONS
  // =========================================================================

  function updateBacktestModeUI() {
    var isLastN = UIState.backtestMode === 'last_n';
    var btnModeLastN = document.getElementById('btn-mode-last-n');
    var btnModeSandbox = document.getElementById('btn-mode-sandbox');
    var boxLastNControls = document.getElementById('box-last-n-controls');
    var boxLastNTable = document.getElementById('box-last-n-table');
    var boxSandboxControls = document.getElementById('box-sandbox-controls');
    var boxSandboxResults = document.getElementById('box-sandbox-results');

    if (btnModeLastN) btnModeLastN.className = 'segmented-btn ' + (isLastN ? 'active' : '');
    if (btnModeSandbox) btnModeSandbox.className = 'segmented-btn ' + (!isLastN ? 'active' : '');

    if (boxLastNControls) boxLastNControls.style.display = isLastN ? 'flex' : 'none';
    if (boxLastNTable) boxLastNTable.style.display = isLastN ? 'block' : 'none';
    if (boxSandboxControls) boxSandboxControls.style.display = !isLastN ? 'block' : 'none';
    if (boxSandboxResults) boxSandboxResults.style.display = !isLastN ? 'block' : 'none';

    var selLookback = document.getElementById('select-sandbox-lookback');
    if (selLookback && UIState.sandboxLookback !== undefined) {
      selLookback.value = String(UIState.sandboxLookback);
    }
  }

  function renderSandboxMonthChips() {
    var container = document.getElementById('sandbox-month-chips');
    var pillsContainer = document.getElementById('sandbox-selected-pills');
    var hintLabel = document.getElementById('sandbox-eligible-count-hint');
    var btnToggleDrawer = document.getElementById('btn-toggle-month-drawer');
    if (!container) return;

    var allMonths = extractHistoryMonths(UIState.history);
    var eligibleMonths = allMonths.filter(function(m) { return m.isEligible; });

    if (allMonths.length === 0) {
      container.innerHTML = '<span class="text-muted" style="font-size: 11px;">No history loaded. Load sample or CSV to enable holdout sandbox.</span>';
      if (pillsContainer) pillsContainer.innerHTML = '<span class="text-muted" style="font-size: 11px;">No history</span>';
      return;
    }

    if (eligibleMonths.length === 0) {
      container.innerHTML = '<span class="text-muted" style="font-size: 11px;">Single month dataset detected (' + allMonths[0].label + '). Multi-month history required for month holdout sandbox.</span>';
      if (pillsContainer) pillsContainer.innerHTML = '<span class="text-muted" style="font-size: 11px;">Single month (insufficient before-data)</span>';
      return;
    }

    // Default auto-select last eligible month if nothing selected
    if (!UIState.sandboxTargetMonths || UIState.sandboxTargetMonths.length === 0) {
      UIState.sandboxTargetMonths = [eligibleMonths[eligibleMonths.length - 1].key];
    }

    // Render Compact Selected Months Summary Pills
    if (pillsContainer) {
      pillsContainer.innerHTML = '';
      var selCount = UIState.sandboxTargetMonths.length;
      if (selCount === 0) {
        pillsContainer.innerHTML = '<span class="text-muted" style="font-size: 11px;">None selected</span>';
      } else if (selCount <= 3) {
        UIState.sandboxTargetMonths.forEach(function(mKey) {
          var meta = allMonths.find(function(m) { return m.key === mKey; });
          var label = meta ? meta.label : mKey;
          var pill = document.createElement('span');
          pill.className = 'sandbox-selected-pill';
          pill.innerHTML = '<span>' + label + '</span>';
          pillsContainer.appendChild(pill);
        });
      } else {
        // Show first 2 + count pill
        var first2 = UIState.sandboxTargetMonths.slice(0, 2);
        first2.forEach(function(mKey) {
          var meta = allMonths.find(function(m) { return m.key === mKey; });
          var label = meta ? meta.label : mKey;
          var pill = document.createElement('span');
          pill.className = 'sandbox-selected-pill';
          pill.innerHTML = '<span>' + label + '</span>';
          pillsContainer.appendChild(pill);
        });
        var morePill = document.createElement('span');
        morePill.className = 'sandbox-selected-pill';
        morePill.style.background = 'var(--bg-surface-elevated)';
        morePill.style.borderColor = 'var(--border-default)';
        morePill.style.color = 'var(--text-secondary)';
        morePill.textContent = '+' + (selCount - 2) + ' more';
        pillsContainer.appendChild(morePill);
      }
    }

    if (hintLabel) {
      hintLabel.textContent = UIState.sandboxTargetMonths.length + ' of ' + eligibleMonths.length + ' eligible months selected';
    }

    if (btnToggleDrawer) {
      var isDrawerOpen = UIState.sandboxMonthDrawerOpen;
      btnToggleDrawer.textContent = isDrawerOpen ? '📅 Close Picker ▴' : '📅 Pick Months (' + UIState.sandboxTargetMonths.length + '/' + eligibleMonths.length + ') ▾';
    }

    // Render Full Chips in Drawer
    container.innerHTML = '';
    allMonths.forEach(function(m) {
      var isSel = UIState.sandboxTargetMonths.indexOf(m.key) !== -1;
      var chip = document.createElement('div');
      chip.className = 'sandbox-month-chip' + (isSel ? ' active' : '') + (!m.isEligible ? ' disabled' : '');
      chip.setAttribute('data-month-key', m.key);
      chip.title = m.isEligible
        ? (m.label + ' (' + m.periodCount + ' days, ' + m.precedingCount + ' preceding training days)')
        : (m.label + ' (First month in series — no preceding training data)');
      chip.innerHTML = 
        '<span>' + (isSel ? '✓ ' : '') + m.label + '</span>' +
        '<span style="opacity: 0.7; font-size: 10px;">(' + m.periodCount + 'd)</span>';

      if (m.isEligible) {
        chip.addEventListener('click', function() {
          var idx = UIState.sandboxTargetMonths.indexOf(m.key);
          if (idx !== -1) {
            UIState.sandboxTargetMonths.splice(idx, 1);
          } else {
            UIState.sandboxTargetMonths.push(m.key);
          }
          renderSandboxMonthChips();
          runForecast();
        });
      }

      container.appendChild(chip);
    });
  }

  function renderSandboxUI(sandboxResults) {
    if (!sandboxResults) return;

    var decisionSummary = document.getElementById('sandbox-decision-summary');
    var headlineWinner = document.getElementById('lbl-decision-winner-headline');
    var subtextWinner = document.getElementById('lbl-decision-winner-subtext');
    var valWinner = document.getElementById('val-decision-winner');
    var valWape = document.getElementById('val-decision-wape');
    var valBias = document.getElementById('val-decision-bias');
    var subBias = document.getElementById('sub-decision-bias');
    var cardStability = document.getElementById('card-decision-stability');
    var valStability = document.getElementById('val-decision-stability');
    var subStability = document.getElementById('sub-decision-stability');
    var btnApplyWinner = document.getElementById('btn-apply-sandbox-winner');

    var banner = document.getElementById('sandbox-active-banner');
    var bannerText = document.getElementById('sandbox-banner-text');
    var badgeOverlayTarget = document.getElementById('lbl-overlay-target-badge');

    var multiTabs = document.getElementById('sandbox-multi-tabs');
    var lblConsistencyTabCount = document.getElementById('lbl-consistency-tab-count');
    var btnViewComp = document.getElementById('btn-view-comparison');
    var btnViewCons = document.getElementById('btn-view-consistency');

    var singleBox = document.getElementById('sandbox-single-results');
    var multiBox = document.getElementById('sandbox-multi-results');
    var tbodySingle = document.getElementById('tbody-sandbox-single');
    var tbodyAdvanced = document.getElementById('tbody-sandbox-advanced');
    var theadConsistency = document.getElementById('thead-sandbox-consistency');
    var tbodyConsistency = document.getElementById('tbody-sandbox-consistency');

    var validMonths = sandboxResults.monthEvaluations ? sandboxResults.monthEvaluations.filter(function(m) { return m.isFeasible; }) : [];

    if (validMonths.length === 0) {
      if (decisionSummary) decisionSummary.style.display = 'none';
      if (banner) banner.style.display = 'none';
      if (multiTabs) multiTabs.style.display = 'none';
      if (singleBox) singleBox.style.display = 'block';
      if (multiBox) multiBox.style.display = 'none';
      if (tbodySingle) {
        tbodySingle.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No valid holdout months selected or insufficient preceding training data. Select 1+ target months above.</td></tr>';
      }
      if (tbodyAdvanced) tbodyAdvanced.innerHTML = '';
      return;
    }

    // Set default active overlay model if null
    if (!UIState.sandboxActiveModelId) {
      UIState.sandboxActiveModelId = sandboxResults.winner ? sandboxResults.winner.modelId : UIState.modelId;
    }

    var activeModelName = MODEL_REGISTRY[UIState.sandboxActiveModelId] ? MODEL_REGISTRY[UIState.sandboxActiveModelId].name : UIState.sandboxActiveModelId;

    // 1. Render Decision Summary (Section 5 & 6)
    if (decisionSummary && sandboxResults.winner) {
      decisionSummary.style.display = 'block';
      var win = sandboxResults.winner;
      var winWape = (win.overallWape !== undefined ? win.overallWape : (win.holdoutMetrics ? win.holdoutMetrics.wape : (win.wape || 0)));
      var winBias = (win.overallBiasPct !== undefined ? win.overallBiasPct : (win.holdoutMetrics ? win.holdoutMetrics.biasPct : (win.biasPct || 0)));
      var biasPrefix = winBias >= 0 ? '+' : '';

      if (headlineWinner) headlineWinner.textContent = '🏆 Best Holdout Model: ' + win.modelName;
      if (subtextWinner) {
        subtextWinner.textContent = validMonths.length === 1 
          ? 'Evaluated against ' + validMonths[0].monthLabel + ' holdout actuals (' + validMonths[0].holdoutPeriodsCount + ' days)'
          : 'Evaluated across ' + validMonths.length + ' holdout months with strict before-only training';
      }
      if (valWinner) valWinner.textContent = win.modelName;
      if (valWape) valWape.textContent = winWape.toFixed(1) + '%';
      if (valBias) {
        valBias.textContent = biasPrefix + winBias.toFixed(1) + '%';
        valBias.className = 'sandbox-card-value ' + (Math.abs(winBias) <= 5 ? 'text-success' : 'text-warn');
      }
      if (subBias) {
        if (Math.abs(winBias) <= 1.0) {
          subBias.textContent = 'Balanced forecast';
        } else if (winBias < 0) {
          subBias.textContent = 'Slight under-forecast';
        } else {
          subBias.textContent = 'Slight over-forecast';
        }
      }

      if (cardStability) {
        if (validMonths.length > 1 && win.wapeStdDev !== undefined) {
          cardStability.style.display = 'flex';
          if (valStability) valStability.textContent = '±' + win.wapeStdDev.toFixed(1) + '%';
          if (subStability) subStability.textContent = 'Across ' + validMonths.length + ' selected months';
        } else {
          cardStability.style.display = 'none';
        }
      }

      if (btnApplyWinner) {
        btnApplyWinner.textContent = '⚡ Use ' + win.modelName + ' for Production';
      }
    }

    // 2. Render Active Overlay Banner
    if (banner) {
      banner.style.display = 'flex';
      if (bannerText) {
        bannerText.innerHTML = '<strong class="text-accent">👁️ Active Overlay:</strong> Plotting <span class="text-accent" style="font-weight: 600;">' + activeModelName + '</span> holdout forecast vs actuals on chart below.';
      }
      if (badgeOverlayTarget) {
        badgeOverlayTarget.textContent = validMonths.length === 1 
          ? validMonths[0].monthLabel 
          : validMonths.length + ' Target Months';
      }
    }

    // 3. Render Table Views
    if (validMonths.length === 1) {
      // Single Month Evaluation
      if (multiTabs) multiTabs.style.display = 'none';
      if (singleBox) singleBox.style.display = 'block';
      if (multiBox) multiBox.style.display = 'none';
      if (!tbodySingle) return;

      tbodySingle.innerHTML = '';
      if (tbodyAdvanced) tbodyAdvanced.innerHTML = '';

      var mEval = validMonths[0];

      mEval.models.forEach(function(m, idx) {
        var tr = document.createElement('tr');
        var isOverlayActive = m.modelId === UIState.sandboxActiveModelId;
        var isWinner = idx === 0;
        var biasPrefix = m.holdoutMetrics.biasPct >= 0 ? '+' : '';

        if (isWinner) tr.className = 'winner-row';

        tr.innerHTML = 
          '<td style="text-align: center;"><span class="rank-badge ' + (isWinner ? 'rank-1' : '') + '">#' + (idx + 1) + '</span></td>' +
          '<td>' +
            '<strong>' + m.modelName + '</strong>' +
            (isOverlayActive ? '<span class="viewing-indicator">Viewing</span>' : '') +
          '</td>' +
          '<td class="mono text-accent"><strong>' + m.holdoutMetrics.wape.toFixed(1) + '%</strong></td>' +
          '<td class="mono">' + m.holdoutMetrics.mape.toFixed(1) + '%</td>' +
          '<td class="mono ' + (Math.abs(m.holdoutMetrics.biasPct) <= 5 ? 'text-success' : 'text-warn') + '">' + biasPrefix + m.holdoutMetrics.biasPct.toFixed(1) + '%</td>' +
          '<td style="text-align: right;">' +
            '<button class="btn btn-sm ' + (isOverlayActive ? 'btn-primary' : 'btn-ghost') + '" style="font-size: 11px; height: 24px; padding: 2px 8px;" data-overlay-model="' + m.modelId + '">' +
              (isOverlayActive ? '👁️ Viewing' : '👁️ View') +
            '</button>' +
          '</td>';

        var btnOverlay = tr.querySelector('[data-overlay-model]');
        if (btnOverlay) {
          btnOverlay.addEventListener('click', function() {
            UIState.sandboxActiveModelId = m.modelId;
            renderSandboxUI(sandboxResults);
            renderChart(UIState.lastForecast, []);
          });
        }

        tbodySingle.appendChild(tr);

        // Advanced metrics row
        if (tbodyAdvanced) {
          var trAdv = document.createElement('tr');
          var overfitStr = m.overfitGap !== undefined ? '+' + m.overfitGap.toFixed(1) + '%' : '—';
          trAdv.innerHTML = 
            '<td><strong>' + m.modelName + '</strong></td>' +
            '<td class="mono">' + m.inSampleMetrics.mape.toFixed(1) + '%</td>' +
            '<td class="mono">' + Math.round(m.holdoutMetrics.mae).toLocaleString() + '</td>' +
            '<td class="mono">' + Math.round(m.holdoutMetrics.rmse).toLocaleString() + '</td>' +
            '<td class="mono ' + (m.overfitGap > 10 ? 'text-warn' : '') + '">' + overfitStr + '</td>' +
            '<td class="mono">' + Math.round(m.totalActual).toLocaleString() + ' / ' + Math.round(m.totalForecast).toLocaleString() + '</td>';
          tbodyAdvanced.appendChild(trAdv);
        }
      });
    } else {
      // Multi-Month Evaluation (Section 10)
      if (multiTabs) multiTabs.style.display = 'flex';
      if (lblConsistencyTabCount) lblConsistencyTabCount.textContent = validMonths.length;

      var view = UIState.sandboxMultiView || 'comparison';
      if (btnViewComp) btnViewComp.className = 'segmented-btn ' + (view === 'comparison' ? 'active' : '');
      if (btnViewCons) btnViewCons.className = 'segmented-btn ' + (view === 'consistency' ? 'active' : '');

      if (view === 'comparison') {
        if (singleBox) singleBox.style.display = 'block';
        if (multiBox) multiBox.style.display = 'none';
        if (!tbodySingle) return;

        tbodySingle.innerHTML = '';
        if (tbodyAdvanced) tbodyAdvanced.innerHTML = '';

        sandboxResults.modelSummaries.forEach(function(s, idx) {
          var tr = document.createElement('tr');
          var isOverlayActive = s.modelId === UIState.sandboxActiveModelId;
          var isWinner = idx === 0;
          var biasPrefix = s.overallBiasPct >= 0 ? '+' : '';

          if (isWinner) tr.className = 'winner-row';

          tr.innerHTML = 
            '<td style="text-align: center;"><span class="rank-badge ' + (isWinner ? 'rank-1' : '') + '">#' + (idx + 1) + '</span></td>' +
            '<td>' +
              '<strong>' + s.modelName + '</strong>' +
              (isWinner ? ' <span class="badge badge-success" style="font-size: 10px; margin-left: 4px;">Best Overall</span>' : '') +
              (isOverlayActive ? '<span class="viewing-indicator">Viewing</span>' : '') +
            '</td>' +
            '<td class="mono text-accent"><strong>' + s.overallWape.toFixed(1) + '%</strong></td>' +
            '<td class="mono">' + (s.overallMape !== undefined ? s.overallMape.toFixed(1) + '%' : '—') + '</td>' +
            '<td class="mono ' + (Math.abs(s.overallBiasPct) <= 5 ? 'text-success' : 'text-warn') + '">' + biasPrefix + s.overallBiasPct.toFixed(1) + '%</td>' +
            '<td style="text-align: right;">' +
              '<button class="btn btn-sm ' + (isOverlayActive ? 'btn-primary' : 'btn-ghost') + '" style="font-size: 11px; height: 24px; padding: 2px 8px;" data-overlay-model="' + s.modelId + '">' +
                (isOverlayActive ? '👁️ Viewing' : '👁️ View') +
              '</button>' +
            '</td>';

          var btnOverlay = tr.querySelector('[data-overlay-model]');
          if (btnOverlay) {
            btnOverlay.addEventListener('click', function() {
              UIState.sandboxActiveModelId = s.modelId;
              renderSandboxUI(sandboxResults);
              renderChart(UIState.lastForecast, []);
            });
          }

          tbodySingle.appendChild(tr);

          // Advanced metrics row
          if (tbodyAdvanced) {
            var trAdv = document.createElement('tr');
            var overfitStr = s.overallMape && s.avgInSampleMape ? '+' + Math.max(0, s.overallMape - s.avgInSampleMape).toFixed(1) + '%' : '—';
            trAdv.innerHTML = 
              '<td><strong>' + s.modelName + '</strong></td>' +
              '<td class="mono">' + (s.avgInSampleMape ? s.avgInSampleMape.toFixed(1) + '%' : '—') + '</td>' +
              '<td class="mono">' + (s.overallMae ? Math.round(s.overallMae).toLocaleString() : '—') + '</td>' +
              '<td class="mono">' + (s.overallRmse ? Math.round(s.overallRmse).toLocaleString() : '—') + '</td>' +
              '<td class="mono">' + overfitStr + '</td>' +
              '<td class="mono">' + (s.totalActual ? Math.round(s.totalActual).toLocaleString() + ' / ' + Math.round(s.totalForecast).toLocaleString() : '—') + '</td>';
            tbodyAdvanced.appendChild(trAdv);
          }
        });
      } else {
        // Consistency Matrix View
        if (singleBox) singleBox.style.display = 'none';
        if (multiBox) multiBox.style.display = 'block';
        if (!theadConsistency || !tbodyConsistency) return;

        // Build Headers
        var headerHtml = '<tr><th style="width: 48px; text-align: center;">Rank</th><th>Model Algorithm</th><th style="color: var(--accent);">Overall WAPE</th><th>Overall Bias</th>';
        validMonths.forEach(function(mEval) {
          headerHtml += '<th class="mono">' + mEval.monthLabel + '</th>';
        });
        headerHtml += '<th>Stability (StdDev)</th><th>WAPE Range</th><th style="width: 80px; text-align: right;">Action</th></tr>';
        theadConsistency.innerHTML = headerHtml;

        tbodyConsistency.innerHTML = '';
        sandboxResults.modelSummaries.forEach(function(s, idx) {
          var tr = document.createElement('tr');
          var isOverlayActive = s.modelId === UIState.sandboxActiveModelId;
          var isWinner = idx === 0;
          var biasPrefix = s.overallBiasPct >= 0 ? '+' : '';

          if (isWinner) tr.className = 'winner-row';

          var rowHtml = 
            '<td style="text-align: center;"><span class="rank-badge ' + (isWinner ? 'rank-1' : '') + '">#' + (idx + 1) + '</span></td>' +
            '<td>' +
              '<strong>' + s.modelName + '</strong>' +
              (isWinner ? ' <span class="badge badge-success" style="font-size: 10px; margin-left: 4px;">Best Overall</span>' : '') +
              (isOverlayActive ? '<span class="viewing-indicator">Viewing</span>' : '') +
            '</td>' +
            '<td class="mono text-accent"><strong>' + s.overallWape.toFixed(1) + '%</strong></td>' +
            '<td class="mono ' + (Math.abs(s.overallBiasPct) <= 5 ? 'text-success' : 'text-warn') + '">' + biasPrefix + s.overallBiasPct.toFixed(1) + '%</td>';

          validMonths.forEach(function(mEval) {
            var mRes = s.monthResults[mEval.monthKey];
            var mWape = mRes ? mRes.holdoutMetrics.wape.toFixed(1) + '%' : '—';
            rowHtml += '<td class="mono">' + mWape + '</td>';
          });

          rowHtml += 
            '<td class="mono text-muted">±' + s.wapeStdDev.toFixed(2) + '%</td>' +
            '<td class="mono text-muted">' + s.wapeRange.toFixed(1) + '%</td>' +
            '<td style="text-align: right;">' +
              '<button class="btn btn-sm ' + (isOverlayActive ? 'btn-primary' : 'btn-ghost') + '" style="font-size: 11px; height: 24px; padding: 2px 8px;" data-overlay-model="' + s.modelId + '">' +
                (isOverlayActive ? '👁️ Viewing' : '👁️ View') +
              '</button>' +
            '</td>';

          tr.innerHTML = rowHtml;

          var btnOverlay = tr.querySelector('[data-overlay-model]');
          if (btnOverlay) {
            btnOverlay.addEventListener('click', function() {
              UIState.sandboxActiveModelId = s.modelId;
              renderSandboxUI(sandboxResults);
              renderChart(UIState.lastForecast, []);
            });
          }

          tbodyConsistency.appendChild(tr);
        });
      }
    }
  }

  function applySandboxWinner(winnerModelId) {
    if (!winnerModelId || !MODEL_REGISTRY[winnerModelId]) {
      ErlanglyUtils.showToast('Invalid model ID', 'error');
      return;
    }
    UIState.modelId = winnerModelId;
    var sel = document.getElementById('select-model-type');
    if (sel) sel.value = winnerModelId;
    updateModelParamsUI();
    runForecast();
    var modelName = MODEL_REGISTRY[winnerModelId].name;
    ErlanglyUtils.showToast('⚡ Applied ' + modelName + ' as active forecast algorithm for future periods', 'success');
  }

  function exportSandboxCSV() {
    if (!UIState.lastSandboxResults || !UIState.lastSandboxResults.monthEvaluations || UIState.lastSandboxResults.monthEvaluations.length === 0) {
      ErlanglyUtils.showToast('No sandbox evaluation results to export', 'warn');
      return;
    }

    var headers = [
      'Target_Month',
      'Model_ID',
      'Model_Name',
      'Lookback_Window',
      'Holdout_Periods',
      'Actual_Total_Volume',
      'Forecast_Total_Volume',
      'Variance_Calls',
      'Holdout_WAPE_Pct',
      'Holdout_MAPE_Pct',
      'Signed_Bias_Pct',
      'Holdout_MAE',
      'Holdout_RMSE',
      'In_Sample_MAPE_Pct'
    ];

    var rows = [];
    UIState.lastSandboxResults.monthEvaluations.forEach(function(mEval) {
      if (!mEval.isFeasible || !mEval.models) return;
      mEval.models.forEach(function(m) {
        rows.push([
          m.monthLabel || m.monthKey,
          m.modelId,
          m.modelName,
          m.lookbackWindow || 'All',
          m.holdoutCount,
          Math.round(m.totalActual),
          Math.round(m.totalForecast),
          Math.round(m.varianceTotal),
          m.holdoutMetrics.wape.toFixed(2) + '%',
          m.holdoutMetrics.mape.toFixed(2) + '%',
          (m.holdoutMetrics.biasPct >= 0 ? '+' : '') + m.holdoutMetrics.biasPct.toFixed(2) + '%',
          m.holdoutMetrics.mae.toFixed(2),
          m.holdoutMetrics.rmse.toFixed(2),
          m.inSampleMetrics.mape.toFixed(2) + '%'
        ]);
      });
    });

    if (rows.length === 0) {
      ErlanglyUtils.showToast('No valid model rows in sandbox results', 'warn');
      return;
    }

    ErlanglyUtils.exportCSV('erlangly_holdout_sandbox.csv', headers, rows);
    ErlanglyUtils.showToast('Exported ' + rows.length + ' sandbox evaluation records to CSV', 'success');
  }

  function updateChartControlsUI() {
    var gran = UIState.chartGranularity || 'daily';
    var range = UIState.chartRangePreset || 'all';

    var btnDaily = document.getElementById('btn-granularity-daily');
    var btnWeekly = document.getElementById('btn-granularity-weekly');
    var btnMonthly = document.getElementById('btn-granularity-monthly');

    if (btnDaily) btnDaily.className = 'segmented-btn ' + (gran === 'daily' ? 'active' : '');
    if (btnWeekly) btnWeekly.className = 'segmented-btn ' + (gran === 'weekly' ? 'active' : '');
    if (btnMonthly) btnMonthly.className = 'segmented-btn ' + (gran === 'monthly' ? 'active' : '');

    var rangePresets = ['all', '1y', '6m', '3m', '1m', 'forecast'];
    rangePresets.forEach(function(rKey) {
      var el = document.getElementById('btn-range-' + (rKey === 'forecast' ? 'fc' : rKey));
      if (el) {
        el.className = 'segmented-btn ' + (range === rKey ? 'active' : '');
      }
    });

    var inpStart = document.getElementById('input-chart-start-date');
    var inpEnd = document.getElementById('input-chart-end-date');
    if (inpStart && UIState.chartStartDate) inpStart.value = UIState.chartStartDate;
    if (inpEnd && UIState.chartEndDate) inpEnd.value = UIState.chartEndDate;
  }

  function renderChart(result, compResults) {
    var canvas = document.getElementById('chart-forecast');
    if (!canvas || typeof Chart === 'undefined') return;

    var histPeriods = UIState.history.map(function(h) { return h.period; });
    var fcPeriods = (result && result.forecast) ? result.forecast.map(function(f) { return f.period; }) : [];
    var allDates = histPeriods.concat(fcPeriods);

    if (allDates.length === 0) {
      if (UIState.chart) {
        UIState.chart.data.labels = [];
        UIState.chart.data.datasets = [];
        UIState.chart.update();
      }
      return;
    }

    // Compute or validate active date window bounds
    var bounds;
    if (UIState.chartRangePreset && UIState.chartRangePreset !== 'custom') {
      bounds = computeRangeBounds(allDates, UIState.chartRangePreset, fcPeriods);
      UIState.chartStartDate = bounds.startDate;
      UIState.chartEndDate = bounds.endDate;
    } else {
      bounds = {
        startDate: UIState.chartStartDate || allDates[0],
        endDate: UIState.chartEndDate || allDates[allDates.length - 1]
      };
    }

    // Update Start and End date inputs & buttons
    updateChartControlsUI();

    var granularity = UIState.chartGranularity || 'daily';

    // 1. Filter raw history and forecast by date bounds
    var filteredHistory = filterTimeSeriesByDate(UIState.history, bounds.startDate, bounds.endDate);
    var filteredForecast = (result && result.forecast) ? filterTimeSeriesByDate(result.forecast, bounds.startDate, bounds.endDate) : [];

    // 2. Aggregate history and forecast
    var aggHistory = aggregateTimeSeries(filteredHistory, granularity);
    var aggForecast = aggregateTimeSeries(filteredForecast, granularity);

    var histLabels = aggHistory.map(function(h) { return h.label; });
    var histData = aggHistory.map(function(h) { return h.volume; });

    var fcLabels = aggForecast.map(function(f) { return f.label; });
    var fcData = aggForecast.map(function(f) { return f.volume; });

    var combinedLabels = histLabels.concat(fcLabels);
    var paddedHist = histData.concat(new Array(fcLabels.length).fill(null));

    function createPaddedForecast(rawForecastList) {
      var filtered = filterTimeSeriesByDate(rawForecastList, bounds.startDate, bounds.endDate);
      var aggFc = aggregateTimeSeries(filtered, granularity);
      var arr = new Array(Math.max(0, histLabels.length - 1)).fill(null);
      if (histData.length > 0) {
        arr.push(histData[histData.length - 1]);
      }
      return arr.concat(aggFc.map(function(f) { return f.volume; }));
    }

    // Update View badge in panel title
    var viewBadge = document.getElementById('lbl-chart-view-badge');
    if (viewBadge) {
      var granLabel = granularity.charAt(0).toUpperCase() + granularity.slice(1);
      var ptsCount = combinedLabels.length;
      var unit = granularity === 'daily' ? 'days' : (granularity === 'weekly' ? 'wks' : 'mos');
      viewBadge.textContent = granLabel + ' (' + ptsCount + ' ' + unit + ')';
    }

    var datasets = [];

    // Check if in Sandbox Mode with valid holdout results
    if (UIState.compareMode && UIState.backtestMode === 'month_sandbox' && UIState.lastSandboxResults && UIState.lastSandboxResults.monthEvaluations && UIState.lastSandboxResults.monthEvaluations.length > 0) {
      var activeModelId = UIState.sandboxActiveModelId || (UIState.lastSandboxResults.winner ? UIState.lastSandboxResults.winner.modelId : UIState.modelId);
      var modelName = MODEL_REGISTRY[activeModelId] ? MODEL_REGISTRY[activeModelId].name : activeModelId;

      // Build map of holdout forecasts and actuals
      var rawHoldoutMap = {};
      var rawHoldoutActualMap = {};
      UIState.lastSandboxResults.monthEvaluations.forEach(function(mEval) {
        var mModel = mEval.models.find(function(m) { return m.modelId === activeModelId; });
        if (mModel) {
          mModel.holdoutPeriods.forEach(function(p, i) {
            rawHoldoutMap[p] = mModel.predictions[i];
            rawHoldoutActualMap[p] = mModel.actuals[i];
          });
        }
      });

      // Aggregate target actuals and predictions
      var targetActualsList = [];
      var holdoutPredsList = [];
      filteredHistory.forEach(function(h) {
        if (rawHoldoutActualMap[h.period] !== undefined) {
          targetActualsList.push({ period: h.period, volume: rawHoldoutActualMap[h.period] });
          holdoutPredsList.push({ period: h.period, volume: rawHoldoutMap[h.period] });
        }
      });

      var aggTargetActuals = aggregateTimeSeries(targetActualsList, granularity);
      var aggHoldoutPreds = aggregateTimeSeries(holdoutPredsList, granularity);

      var targetActualsMap = {};
      var holdoutPredsMap = {};
      aggTargetActuals.forEach(function(a) { targetActualsMap[a.period] = a.volume; });
      aggHoldoutPreds.forEach(function(p) { holdoutPredsMap[p.period] = p.volume; });

      // Dataset 1: Full History Actuals
      datasets.push({
        label: 'Historical Actuals' + (granularity !== 'daily' ? ' (' + granularity + ' total)' : ''),
        data: histData,
        borderColor: '#00d2d3',
        backgroundColor: 'rgba(0, 210, 211, 0.08)',
        borderWidth: 2,
        pointRadius: histLabels.length > 50 ? 0 : 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.2
      });

      // Dataset 2: Holdout Target Actuals (Highlighted Ground Truth)
      var targetActualsPadded = aggHistory.map(function(h) {
        return targetActualsMap[h.period] !== undefined ? targetActualsMap[h.period] : null;
      });
      datasets.push({
        label: 'Target Month Actuals (Ground Truth)',
        data: targetActualsPadded,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#38bdf8',
        fill: false,
        tension: 0.2
      });

      // Dataset 3: Model Holdout Prediction
      var holdoutPredictionsPadded = aggHistory.map(function(h) {
        return holdoutPredsMap[h.period] !== undefined ? holdoutPredsMap[h.period] : null;
      });
      datasets.push({
        label: modelName + ' (Holdout Forecast)',
        data: holdoutPredictionsPadded,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderWidth: 2.5,
        borderDash: [5, 5],
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#10b981',
        fill: false,
        tension: 0.2
      });

      combinedLabels = histLabels;
    } else {
      // Standard or Last-N Comparison Mode
      var skillSuffix = UIState.skills.length > 1 ? ' [' + (UIState.selectedSkill === 'all' ? 'Combined' : UIState.selectedSkill) + ']' : '';
      datasets.push({
        label: 'Historical Actuals' + skillSuffix + (granularity !== 'daily' ? ' (' + granularity + ' total)' : ''),
        data: paddedHist,
        borderColor: '#00d2d3',
        backgroundColor: 'rgba(0, 210, 211, 0.08)',
        borderWidth: 2,
        pointRadius: combinedLabels.length > 50 ? 0 : 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.2
      });

      if (result) {
        var isLight = typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.getTheme() === 'light';
        var ciLevel = UIState.confidenceInterval || 'none';
        var ciBounds = (!UIState.compareMode && ciLevel !== 'none') ? computeForecastConfidenceBounds(result.forecast, result.metrics, UIState.history.length, ciLevel) : null;

        if (ciBounds && ciBounds.upper && ciBounds.lower) {
          // Upper CI bound dataset
          datasets.push({
            label: 'Upper ' + ciLevel + '% CI',
            data: createPaddedForecast(ciBounds.upper),
            borderColor: isLight ? 'rgba(15, 118, 110, 0.45)' : 'rgba(0, 210, 211, 0.45)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.2
          });

          // Lower CI bound dataset with translucent area fill between upper and lower
          datasets.push({
            label: 'Lower ' + ciLevel + '% CI',
            data: createPaddedForecast(ciBounds.lower),
            borderColor: isLight ? 'rgba(15, 118, 110, 0.45)' : 'rgba(0, 210, 211, 0.45)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: '-1',
            backgroundColor: isLight ? 'rgba(15, 118, 110, 0.12)' : 'rgba(0, 210, 211, 0.14)',
            tension: 0.2
          });
        }

        datasets.push({
          label: result.modelName + skillSuffix + ' (Active)',
          data: createPaddedForecast(result.forecast),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          borderWidth: 2.5,
          borderDash: [5, 5],
          pointRadius: combinedLabels.length > 50 ? 0 : 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981',
          fill: (!UIState.compareMode && ciLevel === 'none'),
          tension: 0.2
        });
      }

      if (UIState.compareMode && compResults && compResults.length > 0) {
        var compareColors = ['#f59e0b', '#a855f7', '#38bdf8', '#ec4899', '#34d399', '#f87171'];
        var cIdx = 0;
        compResults.forEach(function(cr) {
          if (!result || cr.modelId !== result.modelId) {
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
    }

    var isLight = typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.getTheme() === 'light';
    var legendColor = isLight ? '#475569' : '#94a3b8';
    var tooltipBg = isLight ? '#ffffff' : '#0f172a';
    var tooltipBorder = isLight ? '#cbd5e1' : '#2b3954';
    var tooltipText = isLight ? '#0f172a' : '#f8fafc';
    var gridXColor = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)';
    var gridYColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.06)';
    var tickColor = isLight ? '#64748b' : '#94a3b8';

    if (UIState.chart) {
      UIState.chart.data.labels = combinedLabels;
      UIState.chart.data.datasets = datasets;
      UIState.chart.options.plugins.legend.display = UIState.compareMode || (UIState.confidenceInterval && UIState.confidenceInterval !== 'none');
      UIState.chart.options.plugins.legend.labels.color = legendColor;
      UIState.chart.options.plugins.tooltip.backgroundColor = tooltipBg;
      UIState.chart.options.plugins.tooltip.borderColor = tooltipBorder;
      UIState.chart.options.plugins.tooltip.titleColor = tooltipText;
      UIState.chart.options.plugins.tooltip.bodyColor = tooltipText;
      UIState.chart.options.scales.x.grid.color = gridXColor;
      UIState.chart.options.scales.x.ticks.color = tickColor;
      UIState.chart.options.scales.y.grid.color = gridYColor;
      UIState.chart.options.scales.y.ticks.color = tickColor;
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
            display: UIState.compareMode || (UIState.confidenceInterval && UIState.confidenceInterval !== 'none'),
            labels: {
              color: legendColor,
              font: { family: 'IBM Plex Mono', size: 11 },
              boxWidth: 12
            }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            borderColor: tooltipBorder,
            borderWidth: 1,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            titleFont: { family: 'IBM Plex Mono', size: 12 },
            bodyFont: { family: 'IBM Plex Mono', size: 12 },
            callbacks: {
              label: function(context) {
                var val = context.parsed.y;
                var granSuffix = UIState.chartGranularity === 'weekly' ? ' (Weekly Total)' : (UIState.chartGranularity === 'monthly' ? ' (Monthly Total)' : '');
                return context.dataset.label + ': ' + (val !== null ? Math.round(val).toLocaleString() + ' calls' + granSuffix : '');
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridXColor },
            ticks: {
              color: tickColor,
              font: { family: 'IBM Plex Mono', size: 10 },
              maxTicksLimit: 14
            }
          },
          y: {
            grid: { color: gridYColor },
            ticks: {
              color: tickColor,
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

  // Chart.js with responsive:true and maintainAspectRatio:false on the fixed-height
  // #panel-chart-forecast container handles canvas sizing automatically.
  // No manual ResizeObserver is needed — it was a source of resize loop feedback.

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
    extractHistoryMonths: extractHistoryMonths,
    runHoldoutSandbox: runHoldoutSandbox,
    evaluateSandboxConsistency: evaluateSandboxConsistency,
    checkHistorySufficiency: checkHistorySufficiency,
    preprocessHistory: preprocessHistory,
    getTrendProfileFactor: getTrendProfileFactor,
    extractDateParts: extractDateParts,
    executeForecast: executeForecast,
    aggregateTimeSeries: aggregateTimeSeries,
    filterTimeSeriesByDate: filterTimeSeriesByDate,
    computeRangeBounds: computeRangeBounds,
    generateMultiYearHistory: generateMultiYearHistory,
    generateMultiSkillHistory: generateMultiSkillHistory,
    downloadHistoricalTemplate: downloadHistoricalTemplate,
    downloadActualsTemplate: downloadActualsTemplate,
    SAMPLE_HISTORY: SAMPLE_HISTORY,
    SAMPLE_MULTI_YEAR_HISTORY: SAMPLE_MULTI_YEAR_HISTORY,
    SAMPLE_MULTI_SKILL_HISTORY: SAMPLE_MULTI_SKILL_HISTORY,
    SAMPLE_ACCURACY_DATA: SAMPLE_ACCURACY_DATA,
    SAMPLE_HOLIDAYS: SAMPLE_HOLIDAYS
  };
});
