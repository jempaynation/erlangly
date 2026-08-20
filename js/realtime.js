/**
 * Erlangly Real-Time & VTO Calculator (js/realtime.js)
 * 
 * Features:
 * - Intraday "Simulate the Day" shift progression stepper with auto-advance
 * - Live queue metrics: Actual SLA, ASA, Occupancy, Adherence %
 * - Day-to-date cumulative scorecard (weighted SLA & volume variance) with mobile collapsible view
 * - Guarded VTO Calculator (SLA safety buffer, occupancy ceiling, agent cap)
 * - Inline VTO approval with live SLA recalculation & cost-savings tracking
 * - Mobile touch swipe gestures (left/right) to step through intraday shift intervals
 * - Client-side Live Data Feed Connector (HTTP polling JSON/CSV + Synthetic Live Demo + Stale detection)
 * - CSV export of intraday actuals and VTO offer sheets
 */

(function(root) {
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
    intervals: JSON.parse(JSON.stringify(INTRADAY_DATA)),
    currentIdx: 0,
    intervalLength: 1800, // 30 min (1800s)
    targetSLA: 0.80,
    targetTime: 20,
    isPlaying: false,
    timer: null,
    isScorecardCollapsed: false,
    feed: {
      mode: 'manual', // 'manual' | 'demo' | 'url'
      url: '',
      format: 'json', // 'json' | 'csv'
      intervalSeconds: 60,
      status: 'manual', // 'manual' | 'connected' | 'stale' | 'error'
      lastPolled: null,
      timer: null,
      staleTimer: null,
      errorMsg: ''
    },
    vto: {
      slaBuffer: 0.05,     // +5% (target 85% SLA post-VTO)
      occCeiling: 0.85,    // 85% max occupancy
      maxCapPerInterval: 8,
      hourlyRate: 22.00,
      offers: []
    }
  };

  // --- Pure Math & Feed Helpers ---
  var ErlangEngine = (typeof Erlangly !== 'undefined') ? Erlangly : (typeof require !== 'undefined' ? require('./erlang.js') : (root.Erlangly || null));

  /**
   * Calculate queue metrics for a single intraday interval
   */
  function calculateQueueMetrics(row, intervalLength, targetSLA, targetTime) {
    var length = intervalLength || 1800;
    var slaTarget = targetSLA !== undefined ? targetSLA : 0.80;
    var tTime = targetTime !== undefined ? targetTime : 20;

    var activeStaff = Math.max(1, (row.actStaff || row.staff || 1) - (row.vtoApproved || 0));
    var erlangs = (ErlangEngine && ErlangEngine.trafficIntensity) 
      ? ErlangEngine.trafficIntensity(row.actVol, row.actAht, length) 
      : ((row.actVol * row.actAht) / length);

    var sl = (ErlangEngine && ErlangEngine.serviceLevel)
      ? ErlangEngine.serviceLevel(erlangs, activeStaff, row.actAht, tTime)
      : 0;

    var asa = (ErlangEngine && ErlangEngine.averageSpeedOfAnswer)
      ? ErlangEngine.averageSpeedOfAnswer(erlangs, activeStaff, row.actAht)
      : 0;

    var occ = (ErlangEngine && ErlangEngine.occupancy)
      ? ErlangEngine.occupancy(erlangs, activeStaff)
      : (erlangs / activeStaff);

    var volVar = row.fcstVol > 0 ? ((row.actVol - row.fcstVol) / row.fcstVol) * 100 : 0;
    var adherence = row.schedStaff > 0 ? (row.actStaff / row.schedStaff) * 100 : 100;

    return {
      erlangs: erlangs,
      activeStaff: activeStaff,
      serviceLevel: sl,
      asa: asa,
      occupancy: occ,
      volVariance: volVar,
      adherence: adherence,
      isBreach: sl < slaTarget
    };
  }

  /**
   * Parse live feed payload string into standardized intraday rows array
   */
  function parseFeedPayload(rawText, format) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('Empty or invalid live feed payload received');
    }

    var cleanFormat = (format || 'json').toLowerCase();

    if (cleanFormat === 'json') {
      var data = JSON.parse(rawText);
      var items = Array.isArray(data) ? data : (data.intervals || data.data || data.rows);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('JSON feed must contain an array of interval objects');
      }

      return items.map(function(item, idx) {
        return {
          interval: String(item.interval || item.time || ('Interval ' + (idx + 1))),
          fcstVol: Math.max(0, parseInt(item.fcstVol || item.forecast_vol || item.fcst_volume || item.planned_vol, 10) || 100),
          actVol: Math.max(0, parseInt(item.actVol || item.actual_vol || item.act_volume || item.volume || item.calls, 10) || 100),
          fcstAht: Math.max(1, parseFloat(item.fcstAht || item.forecast_aht || item.fcst_aht || item.planned_aht) || 180),
          actAht: Math.max(1, parseFloat(item.actAht || item.actual_aht || item.act_aht || item.aht || item.handle_time) || 180),
          schedStaff: Math.max(1, parseInt(item.schedStaff || item.scheduled_staff || item.sched_staff || item.planned_staff, 10) || 20),
          actStaff: Math.max(1, parseInt(item.actStaff || item.actual_staff || item.act_staff || item.staff || item.agents, 10) || 20),
          vtoApproved: Math.max(0, parseInt(item.vtoApproved || item.vto_approved || item.vto, 10) || 0)
        };
      });
    }

    if (cleanFormat === 'csv') {
      var lines = rawText.trim().split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
      if (lines.length < 2) {
        throw new Error('CSV feed must have a header line and at least one data row');
      }

      var headerLine = lines[0].toLowerCase();
      var headers = headerLine.split(',').map(function(h) { return h.trim().replace(/^["']|["']$/g, ''); });

      var colMap = {
        interval: headers.findIndex(function(h) { return h.includes('interval') || h.includes('time'); }),
        fcstVol: headers.findIndex(function(h) { return h.includes('fcst') && (h.includes('vol') || h.includes('call')); }),
        actVol: headers.findIndex(function(h) { return (h.includes('act') && (h.includes('vol') || h.includes('call'))) || (h === 'vol' || h === 'calls' || h === 'volume'); }),
        fcstAht: headers.findIndex(function(h) { return h.includes('fcst') && h.includes('aht'); }),
        actAht: headers.findIndex(function(h) { return (h.includes('act') && h.includes('aht')) || h === 'aht' || h.includes('handle'); }),
        schedStaff: headers.findIndex(function(h) { return (h.includes('sched') || h.includes('plan')) && (h.includes('staff') || h.includes('agent')); }),
        actStaff: headers.findIndex(function(h) { return (h.includes('act') && (h.includes('staff') || h.includes('agent'))) || h === 'staff' || h === 'agents'; }),
        vto: headers.findIndex(function(h) { return h.includes('vto'); })
      };

      var parsedRows = [];
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(',').map(function(c) { return c.trim().replace(/^["']|["']$/g, ''); });
        if (cols.length < 2) continue;

        parsedRows.push({
          interval: colMap.interval >= 0 && cols[colMap.interval] ? cols[colMap.interval] : ('Interval ' + i),
          fcstVol: colMap.fcstVol >= 0 ? (parseInt(cols[colMap.fcstVol], 10) || 100) : 100,
          actVol: colMap.actVol >= 0 ? (parseInt(cols[colMap.actVol], 10) || 100) : 100,
          fcstAht: colMap.fcstAht >= 0 ? (parseFloat(cols[colMap.fcstAht]) || 180) : 180,
          actAht: colMap.actAht >= 0 ? (parseFloat(cols[colMap.actAht]) || 180) : 180,
          schedStaff: colMap.schedStaff >= 0 ? (parseInt(cols[colMap.schedStaff], 10) || 20) : 20,
          actStaff: colMap.actStaff >= 0 ? (parseInt(cols[colMap.actStaff], 10) || 20) : 20,
          vtoApproved: colMap.vto >= 0 ? (parseInt(cols[colMap.vto], 10) || 0) : 0
        });
      }

      if (parsedRows.length === 0) {
        throw new Error('Could not parse any valid interval rows from CSV feed');
      }

      return parsedRows;
    }

    throw new Error('Unsupported feed format: ' + format);
  }

  /**
   * Generate synthetic demo feed data with randomized realistic jitter
   */
  function generateSyntheticDemoFeed(existingIntervals) {
    var base = (existingIntervals && existingIntervals.length > 0) ? existingIntervals : INTRADAY_DATA;
    return base.map(function(item) {
      // ±7% volume variance jitter
      var volJitter = (Math.random() * 0.14 - 0.07);
      var actVol = Math.max(10, Math.round(item.fcstVol * (1 + volJitter)));

      // ±4% AHT jitter
      var ahtJitter = (Math.random() * 0.08 - 0.04);
      var actAht = Math.max(60, Math.round(item.fcstAht * (1 + ahtJitter)));

      // Slight adherence fluctuation (±1-2 agents)
      var staffJitter = Math.floor(Math.random() * 3) - 1;
      var actStaff = Math.max(1, item.schedStaff + staffJitter);

      return {
        interval: item.interval,
        fcstVol: item.fcstVol,
        actVol: actVol,
        fcstAht: item.fcstAht,
        actAht: actAht,
        schedStaff: item.schedStaff,
        actStaff: actStaff,
        vtoApproved: item.vtoApproved || 0
      };
    });
  }

  // --- Browser DOM Controller ---

  var tabIntradaySim, tabVtoCalc, viewIntraday, viewVto;
  var simCurrentTime, simStatusBadge, btnSimPrev, btnSimPlay, btnSimNext, btnSimReset, selectSimInterval;
  var mobileSwipePrompt, mobileSwipeIndicator, intradayStatGrid;
  var rtCurrentSL, rtSLStatus, rtCurrentASA, rtCurrentOcc, rtOccStatus, rtCurrentVol, rtVolVariance;
  var rtCurrentAdherence, rtAdherenceCount, rtCurrentErlangs;
  var panelDtdScorecard, headerDtdScorecard, btnToggleDtdScorecard, txtToggleDtdScorecard, bodyDtdScorecard;
  var dtdIntervalSpan, dtdTotalVol, dtdVolVar, dtdCumSL, dtdCumASA, dtdCumAdherence, dtdBreachCount;
  var tbodyIntradayTimeline, btnExportRtCSV;
  var numVtoBuffer, numVtoOccCeiling, numVtoMaxCap, numVtoHourlyRate, btnRecalcVto;
  var vtoSurplusCount, vtoMaxHours, vtoApprovedHours, vtoApprovedCount, vtoCostSaved, vtoRateNote;
  var tbodyVtoSheet, btnApproveAllVto, btnExportVtoCSV;

  // Live Feed DOM
  var btnOpenLiveFeedModal, badgeLiveFeedStatus, txtLiveFeedStatus;
  var modalLiveFeed, modalStatusDot, btnCloseFeedModal, selectFeedMode, containerUrlConfig;
  var inputFeedUrl, selectFeedFormat, selectFeedInterval, feedDiagnosticsText, feedStaleWarning;
  var btnTestFeedConnection, btnCancelFeedModal, btnApplyFeedSettings;

  function initDOM() {
    if (typeof document === 'undefined') return;

    tabIntradaySim = document.getElementById('tab-intraday-sim');
    tabVtoCalc = document.getElementById('tab-vto-calc');
    viewIntraday = document.getElementById('view-intraday');
    viewVto = document.getElementById('view-vto');

    simCurrentTime = document.getElementById('sim-current-time');
    simStatusBadge = document.getElementById('sim-status-badge');
    btnSimPrev = document.getElementById('btn-sim-prev');
    btnSimPlay = document.getElementById('btn-sim-play');
    btnSimNext = document.getElementById('btn-sim-next');
    btnSimReset = document.getElementById('btn-sim-reset');
    selectSimInterval = document.getElementById('select-sim-interval');

    mobileSwipePrompt = document.getElementById('mobile-swipe-prompt');
    mobileSwipeIndicator = document.getElementById('mobile-swipe-indicator');
    intradayStatGrid = document.getElementById('intraday-stat-grid');

    rtCurrentSL = document.getElementById('rt-current-sl');
    rtSLStatus = document.getElementById('rt-sl-status');
    rtCurrentASA = document.getElementById('rt-current-asa');
    rtCurrentOcc = document.getElementById('rt-current-occ');
    rtOccStatus = document.getElementById('rt-occ-status');
    rtCurrentVol = document.getElementById('rt-current-vol');
    rtVolVariance = document.getElementById('rt-vol-variance');
    rtCurrentAdherence = document.getElementById('rt-current-adherence');
    rtAdherenceCount = document.getElementById('rt-adherence-count');
    rtCurrentErlangs = document.getElementById('rt-current-erlangs');

    panelDtdScorecard = document.getElementById('panel-dtd-scorecard');
    headerDtdScorecard = document.getElementById('header-dtd-scorecard');
    btnToggleDtdScorecard = document.getElementById('btn-toggle-dtd-scorecard');
    txtToggleDtdScorecard = document.getElementById('txt-toggle-dtd-scorecard');
    bodyDtdScorecard = document.getElementById('body-dtd-scorecard');

    dtdIntervalSpan = document.getElementById('dtd-interval-span');
    dtdTotalVol = document.getElementById('dtd-total-vol');
    dtdVolVar = document.getElementById('dtd-vol-var');
    dtdCumSL = document.getElementById('dtd-cum-sl');
    dtdCumASA = document.getElementById('dtd-cum-asa');
    dtdCumAdherence = document.getElementById('dtd-cum-adherence');
    dtdBreachCount = document.getElementById('dtd-breach-count');

    tbodyIntradayTimeline = document.getElementById('tbody-intraday-timeline');
    btnExportRtCSV = document.getElementById('btn-export-rt-csv');

    numVtoBuffer = document.getElementById('num-vto-buffer');
    numVtoOccCeiling = document.getElementById('num-vto-occ-ceiling');
    numVtoMaxCap = document.getElementById('num-vto-max-cap');
    numVtoHourlyRate = document.getElementById('num-vto-hourly-rate');
    btnRecalcVto = document.getElementById('btn-recalc-vto');

    vtoSurplusCount = document.getElementById('vto-surplus-count');
    vtoMaxHours = document.getElementById('vto-max-hours');
    vtoApprovedHours = document.getElementById('vto-approved-hours');
    vtoApprovedCount = document.getElementById('vto-approved-count');
    vtoCostSaved = document.getElementById('vto-cost-saved');
    vtoRateNote = document.getElementById('vto-rate-note');

    tbodyVtoSheet = document.getElementById('tbody-vto-sheet');
    btnApproveAllVto = document.getElementById('btn-approve-all-vto');
    btnExportVtoCSV = document.getElementById('btn-export-vto-csv');

    // Live Feed DOM
    btnOpenLiveFeedModal = document.getElementById('btn-open-live-feed-modal');
    badgeLiveFeedStatus = document.getElementById('badge-live-feed-status');
    txtLiveFeedStatus = document.getElementById('txt-live-feed-status');

    modalLiveFeed = document.getElementById('modal-live-feed');
    modalStatusDot = document.getElementById('modal-status-dot');
    btnCloseFeedModal = document.getElementById('btn-close-feed-modal');
    selectFeedMode = document.getElementById('select-feed-mode');
    containerUrlConfig = document.getElementById('container-url-config');
    inputFeedUrl = document.getElementById('input-feed-url');
    selectFeedFormat = document.getElementById('select-feed-format');
    selectFeedInterval = document.getElementById('select-feed-interval');
    feedDiagnosticsText = document.getElementById('feed-diagnostics-text');
    feedStaleWarning = document.getElementById('feed-stale-warning');
    btnTestFeedConnection = document.getElementById('btn-test-feed-connection');
    btnCancelFeedModal = document.getElementById('btn-cancel-feed-modal');
    btnApplyFeedSettings = document.getElementById('btn-apply-feed-settings');
  }

  // --- Initialization ---
  function init() {
    if (typeof document === 'undefined') return;
    initDOM();
    setupTabSwitching();
    setupStepperControls();
    setupSwipeGestures();
    setupScorecardToggle();
    setupVtoControls();
    setupLiveFeedConnector();
    populateJumpDropdown();
    updateStepperDisplay();
    evaluateVTOOffers();
  }

  // --- Tab Switching ---
  function setupTabSwitching() {
    if (!tabIntradaySim || !tabVtoCalc) return;

    tabIntradaySim.addEventListener('click', function() {
      tabIntradaySim.className = 'btn btn-sm btn-primary';
      tabVtoCalc.className = 'btn btn-sm btn-ghost';
      if (viewIntraday) viewIntraday.style.display = 'flex';
      if (viewVto) viewVto.style.display = 'none';
    });

    tabVtoCalc.addEventListener('click', function() {
      tabVtoCalc.className = 'btn btn-sm btn-primary';
      tabIntradaySim.className = 'btn btn-sm btn-ghost';
      if (viewIntraday) viewIntraday.style.display = 'none';
      if (viewVto) viewVto.style.display = 'flex';
      evaluateVTOOffers();
    });
  }

  // --- Stepper Controls ---
  function setupStepperControls() {
    if (btnSimPrev) {
      btnSimPrev.addEventListener('click', function() {
        pauseAutoAdvance();
        if (state.currentIdx > 0) {
          state.currentIdx--;
          updateStepperDisplay();
        }
      });
    }

    if (btnSimNext) {
      btnSimNext.addEventListener('click', function() {
        pauseAutoAdvance();
        if (state.currentIdx < state.intervals.length - 1) {
          state.currentIdx++;
          updateStepperDisplay();
        }
      });
    }

    if (btnSimReset) {
      btnSimReset.addEventListener('click', function() {
        pauseAutoAdvance();
        state.currentIdx = 0;
        updateStepperDisplay();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Reset simulator to start of day (08:00)', 'info');
        }
      });
    }

    if (btnSimPlay) {
      btnSimPlay.addEventListener('click', function() {
        if (state.isPlaying) {
          pauseAutoAdvance();
        } else {
          startAutoAdvance();
        }
      });
    }

    if (selectSimInterval) {
      selectSimInterval.addEventListener('change', function() {
        pauseAutoAdvance();
        state.currentIdx = parseInt(selectSimInterval.value, 10) || 0;
        updateStepperDisplay();
      });
    }

    // Export Real-Time CSV
    if (btnExportRtCSV) {
      btnExportRtCSV.addEventListener('click', function() {
        var headers = ['Interval', 'Forecast_Vol', 'Actual_Vol', 'Vol_Variance_Pct', 'Sched_Staff', 'Actual_Staff', 'Adherence_Pct', 'Actual_SLA_Pct', 'ASA_Seconds', 'Occupancy_Pct', 'State'];
        var rows = state.intervals.map(function(r) {
          var metrics = calculateQueueMetrics(r, state.intervalLength, state.targetSLA, state.targetTime);
          return [
            r.interval,
            r.fcstVol,
            r.actVol,
            metrics.volVariance.toFixed(1) + '%',
            r.schedStaff,
            metrics.activeStaff,
            metrics.adherence.toFixed(1) + '%',
            (metrics.serviceLevel * 100).toFixed(1) + '%',
            metrics.asa.toFixed(1),
            (metrics.occupancy * 100).toFixed(1) + '%',
            metrics.isBreach ? 'BREACH' : 'ON_TARGET'
          ];
        });
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.exportCSV) {
          ErlanglyUtils.exportCSV('realtime_intraday_actuals.csv', headers, rows);
        }
      });
    }
  }

  function startAutoAdvance() {
    state.isPlaying = true;
    if (btnSimPlay) {
      btnSimPlay.textContent = '⏸ Pause Stepper';
      btnSimPlay.className = 'btn btn-warn btn-sm';
    }
    state.timer = setInterval(function() {
      if (state.currentIdx < state.intervals.length - 1) {
        state.currentIdx++;
        updateStepperDisplay();
      } else {
        pauseAutoAdvance();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Completed shift simulation run', 'success');
        }
      }
    }, 1500);
  }

  function pauseAutoAdvance() {
    state.isPlaying = false;
    if (btnSimPlay) {
      btnSimPlay.textContent = '▶ Play Auto-Advance';
      btnSimPlay.className = 'btn btn-primary btn-sm';
    }
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function populateJumpDropdown() {
    if (!selectSimInterval) return;
    selectSimInterval.innerHTML = '';
    state.intervals.forEach(function(inv, idx) {
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = inv.interval;
      selectSimInterval.appendChild(opt);
    });
  }

  // --- Mobile Touch Swipe Gesture Support ---
  function setupSwipeGestures() {
    var targets = [viewIntraday, intradayStatGrid];
    var startX = 0;
    var startY = 0;
    var startTime = 0;

    targets.forEach(function(el) {
      if (!el) return;

      el.addEventListener('touchstart', function(e) {
        if (!e.touches || e.touches.length === 0) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
      }, { passive: true });

      el.addEventListener('touchend', function(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        var endX = e.changedTouches[0].clientX;
        var endY = e.changedTouches[0].clientY;
        var deltaX = endX - startX;
        var deltaY = endY - startY;
        var elapsed = Date.now() - startTime;

        // Valid swipe: >40px horizontal distance, mostly horizontal (deltaX > 1.3*deltaY), <600ms duration
        if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3 && elapsed < 600) {
          if (deltaX < 0) {
            // Swipe Left -> Next Interval
            if (state.currentIdx < state.intervals.length - 1) {
              pauseAutoAdvance();
              state.currentIdx++;
              updateStepperDisplay();
              triggerSwipeFeedback('next');
            }
          } else {
            // Swipe Right -> Prev Interval
            if (state.currentIdx > 0) {
              pauseAutoAdvance();
              state.currentIdx--;
              updateStepperDisplay();
              triggerSwipeFeedback('prev');
            }
          }
        }
      }, { passive: true });
    });
  }

  function triggerSwipeFeedback(direction) {
    if (mobileSwipePrompt) {
      mobileSwipePrompt.style.borderColor = 'var(--accent)';
      setTimeout(function() {
        mobileSwipePrompt.style.borderColor = '';
      }, 300);
    }
  }

  // --- Mobile Collapsible Day-to-Date Scorecard ---
  function setupScorecardToggle() {
    var toggleFn = function() {
      state.isScorecardCollapsed = !state.isScorecardCollapsed;
      if (bodyDtdScorecard) {
        bodyDtdScorecard.style.display = state.isScorecardCollapsed ? 'none' : 'block';
      }
      if (txtToggleDtdScorecard) {
        txtToggleDtdScorecard.textContent = state.isScorecardCollapsed ? 'Expand 🔽' : 'Collapse 🔼';
      }
      if (btnToggleDtdScorecard) {
        btnToggleDtdScorecard.setAttribute('aria-expanded', String(!state.isScorecardCollapsed));
      }
    };

    if (btnToggleDtdScorecard) {
      btnToggleDtdScorecard.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFn();
      });
    }

    if (headerDtdScorecard) {
      headerDtdScorecard.addEventListener('click', function(e) {
        if (e.target !== btnToggleDtdScorecard && !btnToggleDtdScorecard.contains(e.target)) {
          toggleFn();
        }
      });
    }
  }

  // --- Update Stepper Display ---
  function updateStepperDisplay() {
    var curr = state.intervals[state.currentIdx];
    if (!curr) return;

    if (selectSimInterval) selectSimInterval.value = state.currentIdx;
    if (simCurrentTime) simCurrentTime.textContent = curr.interval;
    if (simStatusBadge) simStatusBadge.textContent = 'Interval ' + (state.currentIdx + 1) + ' of ' + state.intervals.length;
    if (mobileSwipeIndicator) mobileSwipeIndicator.textContent = (state.currentIdx + 1) + ' / ' + state.intervals.length;

    var metrics = calculateQueueMetrics(curr, state.intervalLength, state.targetSLA, state.targetTime);

    // Render Current Cards
    if (rtCurrentSL) {
      rtCurrentSL.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent) 
        ? ErlanglyUtils.formatPercent(metrics.serviceLevel, 1) 
        : (metrics.serviceLevel * 100).toFixed(1) + '%';

      if (metrics.serviceLevel >= state.targetSLA) {
        if (rtSLStatus) rtSLStatus.innerHTML = '<span class="badge badge-success">Target Met</span>';
        rtCurrentSL.style.color = 'var(--accent-light)';
      } else if (metrics.serviceLevel >= state.targetSLA * 0.9) {
        if (rtSLStatus) rtSLStatus.innerHTML = '<span class="badge badge-warn">At Risk</span>';
        rtCurrentSL.style.color = 'var(--warn-light)';
      } else {
        if (rtSLStatus) rtSLStatus.innerHTML = '<span class="badge badge-danger">SLA Breach</span>';
        rtCurrentSL.style.color = 'var(--danger-light)';
      }
    }

    if (rtCurrentASA) {
      rtCurrentASA.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatSeconds)
        ? ErlanglyUtils.formatSeconds(metrics.asa)
        : metrics.asa.toFixed(1) + 's';
    }

    if (rtCurrentOcc) {
      rtCurrentOcc.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(metrics.occupancy, 1)
        : (metrics.occupancy * 100).toFixed(1) + '%';

      if (rtOccStatus) {
        if (metrics.occupancy > 0.90) {
          rtOccStatus.innerHTML = '<span class="text-warn">High burnout (&gt;90%)</span>';
        } else {
          rtOccStatus.textContent = 'Handle load';
        }
      }
    }

    if (rtCurrentVol) rtCurrentVol.textContent = curr.actVol + ' / ' + curr.fcstVol;
    if (rtVolVariance) {
      var volVarPrefix = metrics.volVariance >= 0 ? '+' : '';
      rtVolVariance.textContent = volVarPrefix + metrics.volVariance.toFixed(1) + '% vs forecast';
      rtVolVariance.className = 'metric-subtext ' + (Math.abs(metrics.volVariance) > 10 ? 'text-warn' : 'text-secondary');
    }

    if (rtCurrentAdherence) rtCurrentAdherence.textContent = metrics.adherence.toFixed(1) + '%';
    if (rtAdherenceCount) {
      rtAdherenceCount.textContent = curr.actStaff + ' on queue / ' + curr.schedStaff + ' scheduled';
      if (metrics.adherence < 90) {
        rtAdherenceCount.className = 'metric-subtext text-danger';
      } else {
        rtAdherenceCount.className = 'metric-subtext text-secondary';
      }
    }

    if (rtCurrentErlangs) {
      rtCurrentErlangs.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatErlangs)
        ? ErlanglyUtils.formatErlangs(metrics.erlangs)
        : metrics.erlangs.toFixed(1) + ' E';
    }

    updateDtdScorecard();
    renderTimelineTable();
  }

  // --- Day-to-Date Scorecard ---
  function updateDtdScorecard() {
    var upTo = state.currentIdx + 1;
    if (dtdIntervalSpan) {
      dtdIntervalSpan.textContent = 'Intervals 1 to ' + upTo + ' (08:00 - ' + state.intervals[state.currentIdx].interval + ')';
    }

    var totalActVol = 0;
    var totalFcstVol = 0;
    var weightedSLSum = 0;
    var weightedASASum = 0;
    var totalSchedStaff = 0;
    var totalActStaff = 0;
    var breachCount = 0;

    for (var i = 0; i < upTo; i++) {
      var row = state.intervals[i];
      var metrics = calculateQueueMetrics(row, state.intervalLength, state.targetSLA, state.targetTime);

      totalActVol += row.actVol;
      totalFcstVol += row.fcstVol;
      weightedSLSum += (metrics.serviceLevel * row.actVol);
      weightedASASum += (metrics.asa * row.actVol);
      totalSchedStaff += row.schedStaff;
      totalActStaff += row.actStaff;

      if (metrics.serviceLevel < state.targetSLA || (row.schedStaff > 0 && (row.actStaff / row.schedStaff) < 0.90)) {
        breachCount++;
      }
    }

    var cumSL = totalActVol > 0 ? (weightedSLSum / totalActVol) : 1.0;
    var cumASA = totalActVol > 0 ? (weightedASASum / totalActVol) : 0.0;
    var cumAdherence = totalSchedStaff > 0 ? (totalActStaff / totalSchedStaff) * 100 : 100;
    var volVar = totalFcstVol > 0 ? ((totalActVol - totalFcstVol) / totalFcstVol) * 100 : 0;

    if (dtdTotalVol) {
      dtdTotalVol.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatNumber)
        ? ErlanglyUtils.formatNumber(totalActVol) + ' calls'
        : totalActVol.toLocaleString() + ' calls';
    }
    if (dtdVolVar) dtdVolVar.textContent = (volVar >= 0 ? '+' : '') + volVar.toFixed(1) + '% vs plan';
    if (dtdCumSL) {
      dtdCumSL.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(cumSL, 1)
        : (cumSL * 100).toFixed(1) + '%';
      dtdCumSL.className = 'metric-value mono ' + (cumSL >= state.targetSLA ? 'text-success' : 'text-danger');
    }
    if (dtdCumASA) {
      dtdCumASA.textContent = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatSeconds)
        ? ErlanglyUtils.formatSeconds(cumASA)
        : cumASA.toFixed(1) + 's';
    }
    if (dtdCumAdherence) dtdCumAdherence.textContent = cumAdherence.toFixed(1) + '%';
    if (dtdBreachCount) dtdBreachCount.textContent = breachCount + ' interval alerts';
  }

  // --- Timeline Table ---
  function renderTimelineTable() {
    if (!tbodyIntradayTimeline) return;
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

      var metrics = calculateQueueMetrics(row, state.intervalLength, state.targetSLA, state.targetTime);

      var stateBadge = '<span class="badge badge-success">Normal</span>';
      if (metrics.serviceLevel < state.targetSLA) {
        stateBadge = '<span class="badge badge-danger">Breach</span>';
      } else if (metrics.adherence < 90) {
        stateBadge = '<span class="badge badge-warn">Adherence</span>';
      } else if (metrics.volVariance > 10) {
        stateBadge = '<span class="badge badge-warn">Spike</span>';
      } else if (row.vtoApproved > 0) {
        stateBadge = '<span class="badge badge-neutral">VTO: ' + row.vtoApproved + '</span>';
      }

      var formattedSL = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(metrics.serviceLevel, 1)
        : (metrics.serviceLevel * 100).toFixed(1) + '%';

      var formattedASA = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatSeconds)
        ? ErlanglyUtils.formatSeconds(metrics.asa)
        : metrics.asa.toFixed(1) + 's';

      var formattedOcc = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(metrics.occupancy, 1)
        : (metrics.occupancy * 100).toFixed(1) + '%';

      tr.innerHTML = 
        '<td class="mono"><strong>' + row.interval + (isCurrent ? ' ▶' : '') + '</strong></td>' +
        '<td class="mono">' + row.fcstVol + '</td>' +
        '<td class="mono">' + row.actVol + '</td>' +
        '<td class="mono ' + (metrics.volVariance > 5 ? 'text-warn' : (metrics.volVariance < -5 ? 'text-muted' : '')) + '">' + (metrics.volVariance >= 0 ? '+' : '') + metrics.volVariance.toFixed(0) + '%</td>' +
        '<td class="mono">' + row.schedStaff + '</td>' +
        '<td class="mono text-accent">' + metrics.activeStaff + '</td>' +
        '<td class="mono ' + (metrics.adherence < 90 ? 'text-danger' : '') + '">' + metrics.adherence.toFixed(0) + '%</td>' +
        '<td class="mono ' + (metrics.serviceLevel >= state.targetSLA ? 'text-success' : 'text-danger') + '">' + formattedSL + '</td>' +
        '<td class="mono">' + formattedASA + '</td>' +
        '<td class="mono ' + (metrics.occupancy > 0.90 ? 'text-warn' : '') + '">' + formattedOcc + '</td>' +
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
    var inputs = [numVtoBuffer, numVtoOccCeiling, numVtoMaxCap, numVtoHourlyRate];
    inputs.forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', evaluateVTOOffers);
      el.addEventListener('change', evaluateVTOOffers);
    });

    if (btnRecalcVto) {
      btnRecalcVto.addEventListener('click', function() {
        evaluateVTOOffers();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Re-evaluated VTO safety guardrails', 'success');
        }
      });
    }

    if (btnApproveAllVto) {
      btnApproveAllVto.addEventListener('click', function() {
        state.vto.offers.forEach(function(offer) {
          offer.row.vtoApproved = offer.maxSafeVto;
        });
        evaluateVTOOffers();
        updateStepperDisplay();
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Approved all recommended safe VTO allocations', 'success');
        }
      });
    }

    if (btnExportVtoCSV) {
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
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.exportCSV) {
          ErlanglyUtils.exportCSV('vto_offer_management_sheet.csv', headers, rows);
        }
      });
    }
  }

  function evaluateVTOOffers() {
    if (numVtoBuffer) state.vto.slaBuffer = (parseFloat(numVtoBuffer.value) || 5) / 100;
    if (numVtoOccCeiling) state.vto.occCeiling = (parseFloat(numVtoOccCeiling.value) || 85) / 100;
    if (numVtoMaxCap) state.vto.maxCapPerInterval = Math.max(1, parseInt(numVtoMaxCap.value, 10) || 8);
    if (numVtoHourlyRate) state.vto.hourlyRate = Math.max(1, parseFloat(numVtoHourlyRate.value) || 22.00);

    var targetSafeSL = state.targetSLA + state.vto.slaBuffer; // e.g. 80% + 5% = 85%
    var offers = [];
    var totalMaxVtoHours = 0;
    var totalApprovedVtoHours = 0;
    var intervalHours = state.intervalLength / 3600;

    state.intervals.forEach(function(row) {
      var erlangs = (typeof Erlangly !== 'undefined' && Erlangly.trafficIntensity) 
        ? Erlangly.trafficIntensity(row.actVol, row.actAht, state.intervalLength)
        : ((row.actVol * row.actAht) / state.intervalLength);

      var requiredStaff = Math.ceil(erlangs + 1);
      if (typeof Erlangly !== 'undefined' && Erlangly.agentsRequired) {
        var solve = Erlangly.agentsRequired({
          volume: row.actVol,
          aht: row.actAht,
          intervalSeconds: state.intervalLength,
          targetServiceLevel: state.targetSLA
        });
        requiredStaff = solve.baseAgents;
      }

      var actualStaff = row.actStaff;

      // Find max safe VTO
      var maxVto = 0;
      var testMax = Math.min(state.vto.maxCapPerInterval, Math.max(0, actualStaff - requiredStaff));

      for (var v = testMax; v >= 1; v--) {
        var remStaff = actualStaff - v;
        if (remStaff <= erlangs) continue; // Unstable queue

        var testSL = (typeof Erlangly !== 'undefined' && Erlangly.serviceLevel)
          ? Erlangly.serviceLevel(erlangs, remStaff, row.actAht, state.targetTime)
          : 0;

        var testOcc = (typeof Erlangly !== 'undefined' && Erlangly.occupancy)
          ? Erlangly.occupancy(erlangs, remStaff)
          : (erlangs / remStaff);

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

      var projSL = (typeof Erlangly !== 'undefined' && Erlangly.serviceLevel)
        ? Erlangly.serviceLevel(erlangs, activeStaffPostVto, row.actAht, state.targetTime)
        : 0;

      var projOcc = (typeof Erlangly !== 'undefined' && Erlangly.occupancy)
        ? Erlangly.occupancy(erlangs, activeStaffPostVto)
        : (erlangs / activeStaffPostVto);

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
    if (vtoSurplusCount) vtoSurplusCount.textContent = offers.length + ' intervals';
    if (vtoMaxHours) vtoMaxHours.textContent = totalMaxVtoHours.toFixed(1) + ' hrs';
    if (vtoApprovedHours) vtoApprovedHours.textContent = totalApprovedVtoHours.toFixed(1) + ' hrs';
    if (vtoApprovedCount) vtoApprovedCount.textContent = Math.round(totalApprovedVtoHours / intervalHours) + ' agent-intervals';
    if (vtoCostSaved) vtoCostSaved.textContent = '$' + totalCostSaved.toFixed(2);
    if (vtoRateNote) vtoRateNote.textContent = '@ $' + state.vto.hourlyRate.toFixed(2) + ' / hr wage';

    renderVtoTable();
  }

  function renderVtoTable() {
    if (!tbodyVtoSheet) return;
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

      var formattedSL = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(o.projectedSL, 1)
        : (o.projectedSL * 100).toFixed(1) + '%';

      var formattedOcc = (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.formatPercent)
        ? ErlanglyUtils.formatPercent(o.projectedOcc, 1)
        : (o.projectedOcc * 100).toFixed(1) + '%';

      tr.innerHTML = 
        '<td class="mono"><strong>' + o.interval + '</strong></td>' +
        '<td class="mono">' + o.actualStaff + '</td>' +
        '<td class="mono">' + o.requiredStaff + '</td>' +
        '<td class="mono text-accent"><strong>' + o.maxSafeVto + ' agents (' + (o.maxSafeVto * intervalHours).toFixed(1) + 'h)</strong></td>' +
        '<td class="mono text-success"><strong>' + approved + '</strong></td>' +
        '<td class="mono ' + (o.projectedSL >= state.targetSLA ? 'text-success' : 'text-danger') + '">' + formattedSL + '</td>' +
        '<td class="mono ' + (o.projectedOcc > 0.85 ? 'text-warn' : '') + '">' + formattedOcc + '</td>' +
        '<td class="mono text-success">$' + costSaved.toFixed(2) + '</td>' +
        '<td>' +
          '<div style="display: flex; gap: 6px; align-items: center;">' +
            '<button class="btn btn-primary btn-sm btn-approve" style="min-width: 44px; min-height: 44px; padding: 0 8px;" title="Approve +1 agent VTO" ' + (approved >= o.maxSafeVto ? 'disabled' : '') + '>+1</button>' +
            '<button class="btn btn-ghost btn-sm btn-revoke" style="min-width: 44px; min-height: 44px; padding: 0 8px;" title="Revoke 1 agent VTO" ' + (approved <= 0 ? 'disabled' : '') + '>-1</button>' +
          '</div>' +
        '</td>';

      // Button listeners
      var btnApprove = tr.querySelector('.btn-approve');
      var btnRevoke = tr.querySelector('.btn-revoke');

      if (btnApprove) {
        btnApprove.addEventListener('click', function() {
          if (approved < o.maxSafeVto) {
            o.row.vtoApproved = approved + 1;
            evaluateVTOOffers();
            updateStepperDisplay();
          }
        });
      }

      if (btnRevoke) {
        btnRevoke.addEventListener('click', function() {
          if (approved > 0) {
            o.row.vtoApproved = approved - 1;
            evaluateVTOOffers();
            updateStepperDisplay();
          }
        });
      }

      tbodyVtoSheet.appendChild(tr);
    });
  }

  // --- Part 3: Live Data Feed Connector ---

  function setupLiveFeedConnector() {
    if (!btnOpenLiveFeedModal || !modalLiveFeed) return;

    btnOpenLiveFeedModal.addEventListener('click', function() {
      modalLiveFeed.style.display = 'flex';
      syncFeedModalFromState();
    });

    if (btnCloseFeedModal) {
      btnCloseFeedModal.addEventListener('click', function() {
        modalLiveFeed.style.display = 'none';
      });
    }

    if (btnCancelFeedModal) {
      btnCancelFeedModal.addEventListener('click', function() {
        modalLiveFeed.style.display = 'none';
      });
    }

    if (selectFeedMode) {
      selectFeedMode.addEventListener('change', function() {
        if (containerUrlConfig) {
          containerUrlConfig.style.display = selectFeedMode.value === 'url' ? 'flex' : 'none';
        }
      });
    }

    if (btnTestFeedConnection) {
      btnTestFeedConnection.addEventListener('click', testFeedConnection);
    }

    if (btnApplyFeedSettings) {
      btnApplyFeedSettings.addEventListener('click', function() {
        applyFeedSettings();
        modalLiveFeed.style.display = 'none';
      });
    }

    // Start background staleness checker (runs every 10s)
    if (!state.feed.staleTimer) {
      state.feed.staleTimer = setInterval(checkFeedStaleness, 10000);
    }
  }

  function syncFeedModalFromState() {
    if (selectFeedMode) selectFeedMode.value = state.feed.mode;
    if (inputFeedUrl) inputFeedUrl.value = state.feed.url;
    if (selectFeedFormat) selectFeedFormat.value = state.feed.format;
    if (selectFeedInterval) selectFeedInterval.value = String(state.feed.intervalSeconds);
    if (containerUrlConfig) containerUrlConfig.style.display = state.feed.mode === 'url' ? 'flex' : 'none';
    updateFeedDiagnosticsDisplay();
  }

  function updateFeedDiagnosticsDisplay() {
    if (!feedDiagnosticsText) return;

    var mode = state.feed.mode;
    var status = state.feed.status;

    if (mode === 'manual') {
      feedDiagnosticsText.textContent = 'Status: Manual Stepper active. Polling idle.';
      if (modalStatusDot) modalStatusDot.className = 'feed-status-dot feed-status-manual';
      if (feedStaleWarning) feedStaleWarning.style.display = 'none';
      return;
    }

    var timeStr = state.feed.lastPolled ? new Date(state.feed.lastPolled).toLocaleTimeString() : 'Never';

    if (status === 'connected') {
      feedDiagnosticsText.textContent = 'Status: 🟢 Connected (' + mode.toUpperCase() + '). Last sync: ' + timeStr;
      if (modalStatusDot) modalStatusDot.className = 'feed-status-dot feed-status-connected';
      if (feedStaleWarning) feedStaleWarning.style.display = 'none';
    } else if (status === 'stale') {
      feedDiagnosticsText.textContent = 'Status: 🟡 Stale Data. Last sync: ' + timeStr + ' (> ' + (state.feed.intervalSeconds * 2) + 's ago)';
      if (modalStatusDot) modalStatusDot.className = 'feed-status-dot feed-status-stale';
      if (feedStaleWarning) feedStaleWarning.style.display = 'inline-block';
    } else if (status === 'error') {
      feedDiagnosticsText.textContent = 'Status: 🔴 Connection Error: ' + (state.feed.errorMsg || 'Endpoint unreachable');
      if (modalStatusDot) modalStatusDot.className = 'feed-status-dot feed-status-error';
      if (feedStaleWarning) feedStaleWarning.style.display = 'none';
    }
  }

  function testFeedConnection() {
    var mode = selectFeedMode ? selectFeedMode.value : 'manual';
    if (mode === 'manual') {
      if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
        ErlanglyUtils.showToast('Manual mode selected. No live connection required.', 'info');
      }
      return;
    }

    if (mode === 'demo') {
      var sample = generateSyntheticDemoFeed(state.intervals);
      if (feedDiagnosticsText) feedDiagnosticsText.textContent = 'Status: 🟢 Demo Stream Test Passed (' + sample.length + ' intervals ready)';
      if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
        ErlanglyUtils.showToast('Synthetic Live Demo connection verified!', 'success');
      }
      return;
    }

    var url = inputFeedUrl ? inputFeedUrl.value.trim() : '';
    var fmt = selectFeedFormat ? selectFeedFormat.value : 'json';

    if (!url) {
      if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
        ErlanglyUtils.showToast('Please specify an endpoint URL first', 'warn');
      }
      return;
    }

    if (feedDiagnosticsText) feedDiagnosticsText.textContent = 'Status: ⏳ Polling ' + url + '...';

    fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
        return res.text();
      })
      .then(function(text) {
        var parsed = parseFeedPayload(text, fmt);
        if (feedDiagnosticsText) feedDiagnosticsText.textContent = 'Status: 🟢 Success! Verified ' + parsed.length + ' intervals from endpoint.';
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Live feed connection test successful!', 'success');
        }
      })
      .catch(function(err) {
        if (feedDiagnosticsText) feedDiagnosticsText.textContent = 'Status: 🔴 Error: ' + err.message;
        if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
          ErlanglyUtils.showToast('Test failed: ' + err.message, 'danger');
        }
      });
  }

  function applyFeedSettings() {
    var mode = selectFeedMode ? selectFeedMode.value : 'manual';
    var url = inputFeedUrl ? inputFeedUrl.value.trim() : '';
    var format = selectFeedFormat ? selectFeedFormat.value : 'json';
    var intervalSec = selectFeedInterval ? (parseInt(selectFeedInterval.value, 10) || 60) : 60;

    state.feed.mode = mode;
    state.feed.url = url;
    state.feed.format = format;
    state.feed.intervalSeconds = intervalSec;

    // Reset existing poll timer
    if (state.feed.timer) {
      clearInterval(state.feed.timer);
      state.feed.timer = null;
    }

    if (mode === 'manual') {
      state.feed.status = 'manual';
      updateFeedHeaderBadge();
      if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
        ErlanglyUtils.showToast('Live feed disconnected. Switched to manual stepper.', 'info');
      }
      return;
    }

    // Execute first immediate poll
    pollFeed();

    // Start background polling timer
    state.feed.timer = setInterval(pollFeed, intervalSec * 1000);

    if (typeof ErlanglyUtils !== 'undefined' && ErlanglyUtils.showToast) {
      ErlanglyUtils.showToast('Started live feed polling (' + mode.toUpperCase() + ' every ' + intervalSec + 's)', 'success');
    }
  }

  function pollFeed() {
    if (state.feed.mode === 'manual') return;

    if (state.feed.mode === 'demo') {
      state.intervals = generateSyntheticDemoFeed(state.intervals);
      state.feed.status = 'connected';
      state.feed.lastPolled = Date.now();
      updateFeedHeaderBadge();
      updateStepperDisplay();
      evaluateVTOOffers();
      return;
    }

    if (state.feed.mode === 'url' && state.feed.url) {
      fetch(state.feed.url)
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
          return res.text();
        })
        .then(function(text) {
          var parsed = parseFeedPayload(text, state.feed.format);
          state.intervals = parsed;
          state.feed.status = 'connected';
          state.feed.lastPolled = Date.now();
          state.feed.errorMsg = '';
          updateFeedHeaderBadge();
          populateJumpDropdown();
          updateStepperDisplay();
          evaluateVTOOffers();
        })
        .catch(function(err) {
          state.feed.status = 'error';
          state.feed.errorMsg = err.message;
          updateFeedHeaderBadge();
        });
    }
  }

  function checkFeedStaleness() {
    if (state.feed.mode === 'manual' || !state.feed.lastPolled) return;

    var elapsed = (Date.now() - state.feed.lastPolled) / 1000;
    var staleThreshold = state.feed.intervalSeconds * 2; // > 2 polling intervals without update

    if (elapsed > staleThreshold && state.feed.status !== 'error') {
      state.feed.status = 'stale';
      updateFeedHeaderBadge();
    }
  }

  function updateFeedHeaderBadge() {
    if (!badgeLiveFeedStatus || !txtLiveFeedStatus) return;

    var mode = state.feed.mode;
    var status = state.feed.status;

    if (mode === 'manual') {
      badgeLiveFeedStatus.className = 'feed-status-dot feed-status-manual';
      txtLiveFeedStatus.textContent = 'Feed: Manual';
      return;
    }

    if (status === 'connected') {
      badgeLiveFeedStatus.className = 'feed-status-dot feed-status-connected';
      txtLiveFeedStatus.textContent = mode === 'demo' ? 'Live Demo' : 'Live (' + state.feed.intervalSeconds + 's)';
    } else if (status === 'stale') {
      badgeLiveFeedStatus.className = 'feed-status-dot feed-status-stale';
      txtLiveFeedStatus.textContent = 'Feed: Stale';
    } else if (status === 'error') {
      badgeLiveFeedStatus.className = 'feed-status-dot feed-status-error';
      txtLiveFeedStatus.textContent = 'Feed: Error';
    }
  }

  // --- Export Module Interface for Unit Testing & Global Access ---
  var ErlanglyRealTime = {
    INTRADAY_DATA: INTRADAY_DATA,
    calculateQueueMetrics: calculateQueueMetrics,
    parseFeedPayload: parseFeedPayload,
    generateSyntheticDemoFeed: generateSyntheticDemoFeed,
    evaluateVTOOffers: evaluateVTOOffers,
    getState: function() { return state; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErlanglyRealTime;
  }
  root.ErlanglyRealTime = ErlanglyRealTime;

  // Run on DOM load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
