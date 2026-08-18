/**
 * Erlangly Forecasting Tool (js/forecasting.js)
 * 
 * Features:
 * - Time series demand modeling (WMA, SMA, Linear Trend)
 * - Multiplicative seasonality weighting (Day-of-Week / Period indices)
 * - Large CSV streaming Web Worker integration (100k+ rows)
 * - Chart.js history vs forecast visualizer with dark control-room theme
 * - CSV export & Cross-tool handoff to Capacity Planning
 */

(function() {
  'use strict';

  // --- Sample 12-Week (84 Days) Contact Center Daily History ---
  // Models realistic weekly volume with Monday peak, weekend trough, and mild seasonal growth
  var SAMPLE_HISTORY = [
    { period: '2026-05-01', volume: 1420, aht: 185 }, // Fri
    { period: '2026-05-02', volume: 680, aht: 170 },  // Sat
    { period: '2026-05-03', volume: 520, aht: 165 },  // Sun
    { period: '2026-05-04', volume: 2150, aht: 195 }, // Mon
    { period: '2026-05-05', volume: 1820, aht: 190 }, // Tue
    { period: '2026-05-06', volume: 1710, aht: 185 }, // Wed
    { period: '2026-05-07', volume: 1640, aht: 180 }, // Thu
    { period: '2026-05-08', volume: 1480, aht: 185 }, // Fri
    { period: '2026-05-09', volume: 710, aht: 170 },  // Sat
    { period: '2026-05-10', volume: 540, aht: 165 },  // Sun
    { period: '2026-05-11', volume: 2210, aht: 195 }, // Mon
    { period: '2026-05-12', volume: 1860, aht: 190 }, // Tue
    { period: '2026-05-13', volume: 1750, aht: 185 }, // Wed
    { period: '2026-05-14', volume: 1690, aht: 180 }, // Thu
    { period: '2026-05-15', volume: 1510, aht: 185 }, // Fri
    { period: '2026-05-16', volume: 740, aht: 170 },  // Sat
    { period: '2026-05-17', volume: 560, aht: 165 },  // Sun
    { period: '2026-05-18', volume: 2280, aht: 195 }, // Mon
    { period: '2026-05-19', volume: 1910, aht: 190 }, // Tue
    { period: '2026-05-20', volume: 1790, aht: 185 }, // Wed
    { period: '2026-05-21', volume: 1730, aht: 180 }, // Thu
    { period: '2026-05-22', volume: 1540, aht: 185 }, // Fri
    { period: '2026-05-23', volume: 760, aht: 170 },  // Sat
    { period: '2026-05-24', volume: 580, aht: 165 },  // Sun
    { period: '2026-05-25', volume: 2340, aht: 195 }, // Mon
    { period: '2026-05-26', volume: 1960, aht: 190 }, // Tue
    { period: '2026-05-27', volume: 1840, aht: 185 }, // Wed
    { period: '2026-05-28', volume: 1780, aht: 180 }  // Thu
  ];

  // --- State ---
  var state = {
    history: [],
    forecast: [],
    model: 'wma', // 'wma' | 'trend' | 'sma'
    windowSize: 6,
    horizon: 8,
    useSeasonality: true,
    growthModifier: 0.0,
    assumedAht: 180,
    worker: null,
    chart: null
  };

  // --- DOM References ---
  var tabHistorySample = document.getElementById('tab-history-sample');
  var tabHistoryCSV = document.getElementById('tab-history-csv');
  var sectionManualHistory = document.getElementById('section-manual-history');
  var sectionCsvHistory = document.getElementById('section-csv-history');

  var tbodyHistoryInputs = document.getElementById('tbody-history-inputs');
  var lblHistoryCount = document.getElementById('lbl-history-count');
  var btnAddRow = document.getElementById('btn-add-row');
  var btnLoadSample = document.getElementById('btn-load-sample-forecast');
  var btnClearHistory = document.getElementById('btn-clear-history');

  var forecastDropzone = document.getElementById('forecast-dropzone');
  var forecastFileInput = document.getElementById('forecast-file-input');
  var selectCsvAggregate = document.getElementById('select-csv-aggregate');
  var workerProgressBox = document.getElementById('worker-progress-box');
  var workerStatusText = document.getElementById('worker-status-text');
  var workerPctText = document.getElementById('worker-pct-text');
  var workerProgressBar = document.getElementById('worker-progress-bar');
  var workerStatsText = document.getElementById('worker-stats-text');

  var selectModelType = document.getElementById('select-model-type');
  var numHistoryWindow = document.getElementById('num-history-window');
  var numForecastHorizon = document.getElementById('num-forecast-horizon');
  var checkSeasonality = document.getElementById('check-seasonality');
  var numGrowthModifier = document.getElementById('num-growth-modifier');
  var numForecastAht = document.getElementById('num-forecast-aht');
  var lblForecastAht = document.getElementById('lbl-forecast-aht');
  var btnRunForecast = document.getElementById('btn-run-forecast');

  var statHistTotal = document.getElementById('stat-hist-total');
  var statHistCount = document.getElementById('stat-hist-count');
  var statHistAvg = document.getElementById('stat-hist-avg');
  var statFcTotal = document.getElementById('stat-fc-total');
  var statFcCount = document.getElementById('stat-fc-count');
  var statFcAvg = document.getElementById('stat-fc-avg');
  var statGrowthPct = document.getElementById('stat-growth-pct');
  var statFcPeak = document.getElementById('stat-fc-peak');
  var statFcPeakTime = document.getElementById('stat-fc-peak-time');

  var canvasChart = document.getElementById('chart-forecast');
  var tbodyForecastResults = document.getElementById('tbody-forecast-results');
  var lblForecastTableCount = document.getElementById('lbl-forecast-table-count');
  var btnExportForecastCSV = document.getElementById('btn-export-forecast-csv');
  var btnSendToCapacity = document.getElementById('btn-send-to-capacity');

  // --- Initialization ---
  function init() {
    setupTabSwitching();
    setupEventListeners();
    initWebWorker();
    loadHistory(SAMPLE_HISTORY);
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    tabHistorySample.addEventListener('click', function() {
      tabHistorySample.className = 'btn btn-sm btn-primary';
      tabHistoryCSV.className = 'btn btn-sm btn-ghost';
      sectionManualHistory.style.display = 'block';
      sectionCsvHistory.style.display = 'none';
    });

    tabHistoryCSV.addEventListener('click', function() {
      tabHistoryCSV.className = 'btn btn-sm btn-primary';
      tabHistorySample.className = 'btn btn-sm btn-ghost';
      sectionManualHistory.style.display = 'none';
      sectionCsvHistory.style.display = 'flex';
    });
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    btnLoadSample.addEventListener('click', function() {
      loadHistory(SAMPLE_HISTORY);
      ErlanglyUtils.showToast('Loaded 28 daily sample history periods', 'success');
    });

    btnClearHistory.addEventListener('click', function() {
      loadHistory([]);
      ErlanglyUtils.showToast('Cleared historical data', 'info');
    });

    btnAddRow.addEventListener('click', function() {
      var nextIdx = state.history.length + 1;
      var lastItem = state.history[state.history.length - 1];
      var nextPeriod = 'Period ' + nextIdx;
      if (lastItem && lastItem.period && lastItem.period.indexOf('-') !== -1) {
        var d = new Date(lastItem.period);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 1);
          nextPeriod = d.toISOString().split('T')[0];
        }
      }
      state.history.push({ period: nextPeriod, volume: 1500, aht: 180 });
      renderHistoryTable();
      runForecast();
    });

    // Model parameter changes
    selectModelType.addEventListener('change', function() {
      state.model = selectModelType.value;
      runForecast();
    });

    numHistoryWindow.addEventListener('input', function() {
      state.windowSize = Math.max(2, parseInt(numHistoryWindow.value, 10) || 6);
      runForecast();
    });

    numForecastHorizon.addEventListener('input', function() {
      state.horizon = Math.max(1, parseInt(numForecastHorizon.value, 10) || 8);
      runForecast();
    });

    checkSeasonality.addEventListener('change', function() {
      state.useSeasonality = checkSeasonality.checked;
      runForecast();
    });

    numGrowthModifier.addEventListener('input', function() {
      state.growthModifier = (parseFloat(numGrowthModifier.value) || 0) / 100;
      runForecast();
    });

    numForecastAht.addEventListener('input', function() {
      state.assumedAht = Math.max(10, parseInt(numForecastAht.value, 10) || 180);
      lblForecastAht.textContent = state.assumedAht + 's';
      runForecast();
    });

    btnRunForecast.addEventListener('click', function() {
      runForecast();
      ErlanglyUtils.showToast('Recalculated demand forecast', 'success');
    });

    // Export CSV
    btnExportForecastCSV.addEventListener('click', function() {
      if (!state.forecast || state.forecast.length === 0) return;
      var headers = ['Future_Period', 'Base_Model_Volume', 'Trend_Component', 'Seasonality_Index', 'Projected_Volume', 'Assumed_AHT_Sec', 'Est_Erlangs'];
      var rows = state.forecast.map(function(r) {
        var erlangs = Erlangly.trafficIntensity(r.volume, state.assumedAht, 3600 * 8); // 8-hour shift equivalent
        return [
          r.period,
          Math.round(r.baseVolume),
          r.trendFactor.toFixed(3),
          r.seasonalityIndex.toFixed(3),
          Math.round(r.volume),
          state.assumedAht,
          erlangs.toFixed(2)
        ];
      });
      ErlanglyUtils.exportCSV('erlangly_forecast.csv', headers, rows);
    });

    // Send to Capacity Planning
    btnSendToCapacity.addEventListener('click', function() {
      if (!state.forecast || state.forecast.length === 0) return;
      var handoffPayload = {
        source: 'forecasting',
        aht: state.assumedAht,
        intervals: state.forecast.map(function(r) {
          return {
            interval: r.period,
            volume: Math.round(r.volume),
            aht: state.assumedAht
          };
        })
      };
      ErlanglyUtils.setHandoff('capacity', handoffPayload);
      window.location.href = 'capacity.html?from=forecast';
    });

    // Dropzone for CSV file upload
    ErlanglyUtils.wireFileDrop(forecastDropzone, forecastFileInput, function(text, file) {
      if (file && state.worker) {
        // Send file to Web Worker
        workerProgressBox.style.display = 'block';
        workerStatusText.textContent = 'Parsing ' + file.name + ' in Web Worker...';
        workerProgressBar.style.width = '0%';
        workerPctText.textContent = '0%';
        workerStatsText.textContent = 'File size: ' + (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        state.worker.postMessage({
          type: 'parse_file',
          file: file,
          aggregateLevel: selectCsvAggregate.value
        });
      } else {
        // Fallback main-thread CSV parse
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

  // --- Web Worker Setup ---
  function initWebWorker() {
    try {
      if (typeof Worker !== 'undefined') {
        state.worker = new Worker('js/workers/csv-parser.js');
        state.worker.onmessage = function(e) {
          var msg = e.data;
          if (msg.type === 'progress') {
            workerProgressBar.style.width = msg.progress + '%';
            workerPctText.textContent = msg.progress + '%';
            workerStatsText.textContent = 'Parsed ' + msg.parsedCount.toLocaleString() + ' rows (' + (msg.processedBytes / (1024 * 1024)).toFixed(1) + ' MB processed)';
          } else if (msg.type === 'complete') {
            workerProgressBar.style.width = '100%';
            workerPctText.textContent = '100%';
            workerStatusText.textContent = 'Complete!';
            workerStatsText.textContent = 'Successfully processed ' + msg.totalParsed.toLocaleString() + ' rows (skipped ' + msg.skippedCount + ' malformed).';

            setTimeout(function() {
              workerProgressBox.style.display = 'none';
            }, 3000);

            if (msg.rows && msg.rows.length > 0) {
              loadHistory(msg.rows);
              ErlanglyUtils.showToast('Loaded ' + msg.rows.length + ' aggregated periods from ' + msg.totalParsed.toLocaleString() + ' rows', 'success');
            }
          } else if (msg.type === 'error') {
            workerStatusText.textContent = 'Error: ' + msg.message;
            ErlanglyUtils.showToast('Worker CSV error: ' + msg.message, 'error');
          }
        };
      }
    } catch (e) {
      console.warn('Web Worker not supported or blocked, using main thread fallback:', e);
    }
  }

  // --- Load History & Render Table ---
  function loadHistory(rows) {
    state.history = rows ? rows.slice() : [];
    renderHistoryTable();
    runForecast();
  }

  function renderHistoryTable() {
    tbodyHistoryInputs.innerHTML = '';
    lblHistoryCount.textContent = state.history.length;

    if (state.history.length === 0) {
      tbodyHistoryInputs.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No historical data. Load sample or upload CSV.</td></tr>';
      return;
    }

    state.history.forEach(function(row, idx) {
      var tr = document.createElement('tr');

      var tdPeriod = document.createElement('td');
      var inputPeriod = document.createElement('input');
      inputPeriod.type = 'text';
      inputPeriod.className = 'form-control mono';
      inputPeriod.style.height = '28px';
      inputPeriod.style.fontSize = 'var(--text-xs)';
      inputPeriod.value = row.period;
      inputPeriod.addEventListener('input', function() {
        row.period = inputPeriod.value;
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
        state.history.splice(idx, 1);
        renderHistoryTable();
        runForecast();
      });
      tdAction.appendChild(btnDel);

      tr.appendChild(tdPeriod);
      tr.appendChild(tdVol);
      tr.appendChild(tdAction);

      tbodyHistoryInputs.appendChild(tr);
    });
  }

  // --- Forecasting Engine ---
  function runForecast() {
    if (!state.history || state.history.length === 0) {
      clearForecastDisplay();
      return;
    }

    var historyLen = state.history.length;
    var volumes = state.history.map(function(h) { return h.volume; });
    var windowK = Math.min(historyLen, state.windowSize);
    var horizonM = state.horizon;

    // 1. Calculate Seasonality Indices (7-day or period-position cyclical)
    var seasonalityIndices = computeSeasonalityIndices(state.history);

    // 2. Base Model & Trend Computation
    var baseRate = 0;
    var trendSlope = 0;
    var trendIntercept = 0;

    if (state.model === 'wma') {
      // Weighted Moving Average on recent windowK periods
      var sumWeights = 0;
      var sumWeightedVol = 0;
      for (var w = 1; w <= windowK; w++) {
        var historicalVal = volumes[historyLen - windowK + (w - 1)];
        sumWeights += w;
        sumWeightedVol += (w * historicalVal);
      }
      baseRate = sumWeightedVol / sumWeights;

      // Linear regression on the window for secondary trend drift
      var reg = linearRegression(volumes.slice(historyLen - windowK));
      trendSlope = reg.slope;
    } else if (state.model === 'sma') {
      // Simple Moving Average
      var sumVol = 0;
      for (var s = 0; s < windowK; s++) {
        sumVol += volumes[historyLen - windowK + s];
      }
      baseRate = sumVol / windowK;
    } else if (state.model === 'trend') {
      // Full OLS Linear Regression over entire history
      var fullReg = linearRegression(volumes);
      trendSlope = fullReg.slope;
      trendIntercept = fullReg.intercept;
    }

    // 3. Generate Future Projections
    var forecastResults = [];
    var lastItem = state.history[historyLen - 1];
    var isDateSeries = lastItem.period && lastItem.period.indexOf('-') !== -1;
    var lastDate = isDateSeries ? new Date(lastItem.period) : null;

    for (var h = 1; h <= horizonM; h++) {
      var futurePeriod = 'Future ' + h;
      var dayOfWeekIdx = (historyLen + h - 1) % 7;

      if (lastDate && !isNaN(lastDate.getTime())) {
        var nextD = new Date(lastDate);
        nextD.setDate(lastDate.getDate() + h);
        futurePeriod = nextD.toISOString().split('T')[0];
        dayOfWeekIdx = nextD.getDay(); // 0 = Sun, 1 = Mon ...
      }

      var rawModelVal = 0;
      var trendFactor = 1.0;

      if (state.model === 'trend') {
        rawModelVal = Math.max(0, trendIntercept + trendSlope * (historyLen + h));
        trendFactor = 1.0 + (trendSlope / (trendIntercept || 1)) * h;
      } else {
        rawModelVal = Math.max(0, baseRate + trendSlope * h);
        trendFactor = baseRate > 0 ? (rawModelVal / baseRate) : 1.0;
      }

      var seasonIdx = state.useSeasonality ? (seasonalityIndices[dayOfWeekIdx] || 1.0) : 1.0;
      var growthMult = 1.0 + state.growthModifier;

      var finalVol = Math.max(0, Math.round(rawModelVal * seasonIdx * growthMult));

      forecastResults.push({
        period: futurePeriod,
        baseVolume: rawModelVal,
        trendFactor: trendFactor,
        seasonalityIndex: seasonIdx,
        volume: finalVol
      });
    }

    state.forecast = forecastResults;

    // 4. Update Summary KPIs
    updateSummaryKPIs();

    // 5. Render Forecast Table
    renderForecastTable();

    // 6. Update Chart.js Visualizer
    renderChart();
  }

  // Linear Regression (OLS) Helper
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

  // Seasonality Index Calculator
  function computeSeasonalityIndices(history) {
    var bucketSums = [0, 0, 0, 0, 0, 0, 0];
    var bucketCounts = [0, 0, 0, 0, 0, 0, 0];
    var totalVolume = 0;

    history.forEach(function(row, idx) {
      var dayIdx = idx % 7;
      if (row.period && row.period.indexOf('-') !== -1) {
        var d = new Date(row.period);
        if (!isNaN(d.getTime())) {
          dayIdx = d.getDay();
        }
      }
      bucketSums[dayIdx] += row.volume;
      bucketCounts[dayIdx]++;
      totalVolume += row.volume;
    });

    var overallAvg = history.length > 0 ? (totalVolume / history.length) : 1;
    var indices = {};

    for (var b = 0; b < 7; b++) {
      if (bucketCounts[b] > 0 && overallAvg > 0) {
        var bucketAvg = bucketSums[b] / bucketCounts[b];
        indices[b] = bucketAvg / overallAvg;
      } else {
        indices[b] = 1.0;
      }
    }

    return indices;
  }

  // Update Summary KPI Cards
  function updateSummaryKPIs() {
    var histTotal = state.history.reduce(function(acc, h) { return acc + h.volume; }, 0);
    var histAvg = state.history.length > 0 ? (histTotal / state.history.length) : 0;

    var fcTotal = state.forecast.reduce(function(acc, f) { return acc + f.volume; }, 0);
    var fcAvg = state.forecast.length > 0 ? (fcTotal / state.forecast.length) : 0;

    var peakVol = 0;
    var peakTime = '--';
    state.forecast.forEach(function(f) {
      if (f.volume > peakVol) {
        peakVol = f.volume;
        peakTime = f.period;
      }
    });

    var growthRate = histAvg > 0 ? ((fcAvg - histAvg) / histAvg) : 0;

    statHistTotal.textContent = ErlanglyUtils.formatNumber(histTotal);
    statHistCount.textContent = state.history.length + ' periods';
    statHistAvg.textContent = ErlanglyUtils.formatNumber(Math.round(histAvg));

    statFcTotal.textContent = ErlanglyUtils.formatNumber(fcTotal);
    statFcCount.textContent = state.forecast.length + ' future periods';
    statFcAvg.textContent = ErlanglyUtils.formatNumber(Math.round(fcAvg));

    var growthPrefix = growthRate >= 0 ? '+' : '';
    statGrowthPct.textContent = growthPrefix + (growthRate * 100).toFixed(1) + '% vs hist avg';
    statGrowthPct.className = 'metric-subtext ' + (growthRate >= 0 ? 'text-success' : 'text-warn');

    statFcPeak.textContent = ErlanglyUtils.formatNumber(peakVol);
    statFcPeakTime.textContent = 'At ' + peakTime;
  }

  // Render Forecast Table
  function renderForecastTable() {
    tbodyForecastResults.innerHTML = '';
    lblForecastTableCount.textContent = state.forecast.length;

    state.forecast.forEach(function(r) {
      var tr = document.createElement('tr');
      var erlangs = Erlangly.trafficIntensity(r.volume, state.assumedAht, 3600 * 8);

      tr.innerHTML = 
        '<td class="mono"><strong>' + r.period + '</strong></td>' +
        '<td class="mono">' + Math.round(r.baseVolume).toLocaleString() + '</td>' +
        '<td class="mono">' + r.trendFactor.toFixed(2) + 'x</td>' +
        '<td class="mono ' + (r.seasonalityIndex > 1.1 ? 'text-accent' : (r.seasonalityIndex < 0.9 ? 'text-muted' : '')) + '">' + (r.seasonalityIndex * 100).toFixed(0) + '%</td>' +
        '<td class="mono text-accent"><strong>' + Math.round(r.volume).toLocaleString() + '</strong></td>' +
        '<td class="mono">' + erlangs.toFixed(2) + '</td>';

      tbodyForecastResults.appendChild(tr);
    });
  }

  // Render Chart.js
  function renderChart() {
    if (!canvasChart || typeof Chart === 'undefined') return;

    var histLabels = state.history.map(function(h) { return h.period; });
    var histData = state.history.map(function(h) { return h.volume; });

    var fcLabels = state.forecast.map(function(f) { return f.period; });
    var fcData = state.forecast.map(function(f) { return f.volume; });

    var combinedLabels = histLabels.concat(fcLabels);

    // Padding for history series (null for forecast slots)
    var paddedHistData = histData.concat(new Array(fcLabels.length).fill(null));

    // Padding for forecast series (null for history slots, but connect to last history point)
    var paddedFcData = new Array(Math.max(0, histLabels.length - 1)).fill(null);
    if (histData.length > 0) {
      paddedFcData.push(histData[histData.length - 1]);
    }
    paddedFcData = paddedFcData.concat(fcData);

    if (state.chart) {
      state.chart.data.labels = combinedLabels;
      state.chart.data.datasets[0].data = paddedHistData;
      state.chart.data.datasets[1].data = paddedFcData;
      state.chart.update();
      return;
    }

    var ctx = canvasChart.getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: combinedLabels,
        datasets: [
          {
            label: 'Historical Volume',
            data: paddedHistData,
            borderColor: '#00d2d3',
            backgroundColor: 'rgba(0, 210, 211, 0.1)',
            borderWidth: 2,
            pointRadius: combinedLabels.length > 50 ? 0 : 3,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.2
          },
          {
            label: 'Projected Forecast',
            data: paddedFcData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: combinedLabels.length > 50 ? 0 : 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981',
            fill: true,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
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
              maxTicksLimit: 12
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
    statHistTotal.textContent = '0';
    statHistCount.textContent = '0 periods';
    statHistAvg.textContent = '0';
    statFcTotal.textContent = '0';
    statFcCount.textContent = '0 future periods';
    statFcAvg.textContent = '0';
    statGrowthPct.textContent = '0%';
    statFcPeak.textContent = '0';
    statFcPeakTime.textContent = '--';
    tbodyForecastResults.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No forecast calculated.</td></tr>';
    lblForecastTableCount.textContent = '0';
    if (state.chart) {
      state.chart.data.labels = [];
      state.chart.data.datasets[0].data = [];
      state.chart.data.datasets[1].data = [];
      state.chart.update();
    }
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
