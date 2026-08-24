/**
 * Erlangly Shared Utilities (js/main.js)
 * 
 * Centralized helpers for:
 * - Navigation active-state and mobile menu toggle
 * - CSV Parsing (RFC-4180 compliant lightweight parser)
 * - CSV Export (client-side Blob download)
 * - Drag-and-drop file upload wiring
 * - Numeric and time formatting utilities
 * - Toast notification system
 * - LocalStorage cross-tool handoff
 */

(function(root) {
  'use strict';

  var ErlanglyUtils = {};

  /**
   * Initialize Global Navigation (active states & mobile drawer)
   */
  ErlanglyUtils.initNav = function() {
    var currentPath = window.location.pathname.split('/').pop() || 'index.html';
    var navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(function(link) {
      var href = link.getAttribute('href');
      if (href) {
        var linkPath = href.split('/').pop().split('?')[0];
        if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
          link.classList.add('active');
          link.setAttribute('aria-current', 'page');
        } else {
          link.classList.remove('active');
          link.removeAttribute('aria-current');
        }
      }
    });

    var mobileToggle = document.querySelector('.mobile-menu-toggle');
    var navList = document.querySelector('.nav-links');
    if (mobileToggle && navList) {
      mobileToggle.addEventListener('click', function() {
        var isOpen = navList.classList.toggle('open');
        mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    }
  };

  /**
   * Lightweight RFC-4180 Compliant CSV Parser
   * Handles quoted cells, escaped quotes (""), commas, and CRLF/LF line endings.
   *
   * @param {string} text - Raw CSV text
   * @returns {Object} { headers: Array<string>, rows: Array<Object>, rawRows: Array<Array<string>> }
   */
  ErlanglyUtils.parseCSV = function(text) {
    if (!text || typeof text !== 'string') {
      return { headers: [], rows: [], rawRows: [] };
    }

    var lines = [];
    var row = [''];
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    while (i < len) {
      var c = text[i];
      var next = text[i + 1];

      if (c === '"') {
        if (inQuotes && next === '"') {
          // Escaped quote
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push('');
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && next === '\n') {
          i++;
        }
        // End of row
        if (row.length > 1 || row[0].trim() !== '') {
          lines.push(row.map(function(cell) { return cell.trim(); }));
        }
        row = [''];
      } else {
        row[row.length - 1] += c;
      }
      i++;
    }

    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
      lines.push(row.map(function(cell) { return cell.trim(); }));
    }

    if (lines.length === 0) {
      return { headers: [], rows: [], rawRows: [] };
    }

    var headers = lines[0].map(function(h) { return h.toLowerCase().replace(/[^a-z0-9_]/g, ''); });
    var dataRows = [];

    for (var r = 1; r < lines.length; r++) {
      var line = lines[r];
      if (line.length === 0 || (line.length === 1 && line[0] === '')) continue;
      var isAllEmpty = true;
      for (var c = 0; c < line.length; c++) {
        if (line[c].trim() !== '') {
          isAllEmpty = false;
          break;
        }
      }
      if (isAllEmpty) continue;

      var obj = {};
      for (var h = 0; h < headers.length; h++) {
        var key = headers[h] || ('col_' + h);
        obj[key] = line[h] !== undefined ? line[h] : '';
      }
      dataRows.push(obj);
    }

    return {
      headers: lines[0],
      normalizedHeaders: headers,
      rows: dataRows,
      rawRows: lines
    };
  };

  /**
   * Export Data as CSV File (Client-side Blob download)
   *
   * @param {string} filename - Output filename (e.g. "capacity_plan.csv")
   * @param {Array<string>} headers - Column headers
   * @param {Array<Array<any>|Object>} rows - Data rows
   */
  ErlanglyUtils.exportCSV = function(filename, headers, rows) {
    if (!headers || !rows || rows.length === 0) {
      ErlanglyUtils.showToast('No data available to export.', 'warn');
      return;
    }

    var formatCell = function(cell) {
      if (cell === null || cell === undefined) return '""';
      var str = String(cell);
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    var csvContent = headers.map(formatCell).join(',') + '\r\n';

    rows.forEach(function(row) {
      var rowCells;
      if (Array.isArray(row)) {
        rowCells = row;
      } else if (typeof row === 'object') {
        rowCells = headers.map(function(h) {
          var normKey = h.toLowerCase().replace(/[^a-z0-9_]/g, '');
          return row[h] !== undefined ? row[h] : (row[normKey] !== undefined ? row[normKey] : '');
        });
      } else {
        rowCells = [row];
      }
      csvContent += rowCells.map(formatCell).join(',') + '\r\n';
    });

    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename.endsWith('.csv') ? filename : filename + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    ErlanglyUtils.showToast('Exported ' + filename + ' successfully', 'success');
  };

  /**
   * Wire Drag-and-Drop File Upload on a container
   *
   * @param {HTMLElement} dropzone - Target dropzone element
   * @param {HTMLInputElement} fileInput - Hidden file input element
   * @param {Function} onFileLoaded - Callback receiving (textContent, file)
   */
  ErlanglyUtils.wireFileDrop = function(dropzone, fileInput, onFileLoaded) {
    if (!dropzone || !fileInput || !onFileLoaded) return;

    var handleFile = function(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        onFileLoaded(e.target.result, file);
      };
      reader.onerror = function() {
        ErlanglyUtils.showToast('Failed to read file: ' + file.name, 'error');
      };
      reader.readAsText(file);
    };

    dropzone.addEventListener('click', function() {
      fileInput.click();
    });

    dropzone.addEventListener('dragenter', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('active');
    });

    dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('active');
    });

    dropzone.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('active');
    });

    dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('active');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', function(e) {
      if (e.target.files && e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });
  };

  /**
   * Toast Notification System
   *
   * @param {string} message - Message text
   * @param {string} [type='info'] - 'info' | 'success' | 'warn' | 'error'
   * @param {number} [duration=3500] - Duration in ms
   */
  ErlanglyUtils.showToast = function(message, type, duration) {
    type = type || 'info';
    duration = duration || 3500;

    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 200ms ease-out';
      setTimeout(function() {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    }, duration);
  };

  /**
   * Number & Time Formatting Helpers
   */
  ErlanglyUtils.formatPercent = function(val, decimals) {
    if (val === null || val === undefined || isNaN(val)) return '0.0%';
    decimals = typeof decimals === 'number' ? decimals : 1;
    return (val * 100).toFixed(decimals) + '%';
  };

  ErlanglyUtils.formatSeconds = function(seconds) {
    if (seconds === Infinity) return '∞';
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '0s';
    if (seconds < 60) {
      return seconds.toFixed(seconds < 10 && seconds % 1 !== 0 ? 1 : 0) + 's';
    }
    var mins = Math.floor(seconds / 60);
    var remSecs = Math.round(seconds % 60);
    return mins + 'm ' + (remSecs < 10 ? '0' : '') + remSecs + 's';
  };

  ErlanglyUtils.formatNumber = function(val, decimals) {
    if (val === Infinity) return '∞';
    if (val === null || val === undefined || isNaN(val)) return '0';
    decimals = typeof decimals === 'number' ? decimals : 0;
    return Number(val.toFixed(decimals)).toLocaleString('en-US');
  };

  ErlanglyUtils.formatErlangs = function(val) {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val.toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /**
   * Parse and Normalize Date Strings
   * Supports ISO (YYYY-MM-DD), US/European slash formats (M/D/YYYY, MM/DD/YYYY, D/M/YYYY),
   * 2-digit years (M/D/YY), month/day pairs (M/D), and timestamps (YYYY-MM-DD HH:mm).
   * Uses UTC epoch math to prevent timezone drift across client environments.
   *
   * @param {string|Date} dateStr - Input date string or Date object
   * @returns {Object|null} { year, month, day, isoDate: 'YYYY-MM-DD', timestamp, dayOfWeek, isDate: true } or null
   */
  ErlanglyUtils.parseDate = function(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) {
      if (isNaN(dateStr.getTime())) return null;
      var y = dateStr.getFullYear();
      var m = dateStr.getMonth() + 1;
      var d = dateStr.getDate();
      var pad = function(n) { return n < 10 ? '0' + n : String(n); };
      var utcTime = Date.UTC(y, m - 1, d);
      var dObj = new Date(utcTime);
      return {
        year: y,
        month: m,
        day: d,
        isoDate: y + '-' + pad(m) + '-' + pad(d),
        timestamp: utcTime,
        dayOfWeek: dObj.getUTCDay(),
        isDate: true
      };
    }

    var str = String(dateStr).trim();
    if (!str) return null;

    // Strip time/interval component if present (e.g. "8/1/2026 09:30:00", "2026-08-01T09:30:00")
    var rawDatePart = str;
    if (rawDatePart.indexOf('T') !== -1) {
      rawDatePart = rawDatePart.split('T')[0];
    } else if (rawDatePart.indexOf(' ') !== -1) {
      rawDatePart = rawDatePart.split(' ')[0];
    }

    var year = null;
    var month = null;
    var day = null;

    // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    var mIso = rawDatePart.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (mIso) {
      year = parseInt(mIso[1], 10);
      month = parseInt(mIso[2], 10);
      day = parseInt(mIso[3], 10);
    }

    // 2. M/D/YYYY or MM/DD/YYYY (or D/M/YYYY if first > 12)
    if (!year) {
      var mSlash4 = rawDatePart.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
      if (mSlash4) {
        var n1 = parseInt(mSlash4[1], 10);
        var n2 = parseInt(mSlash4[2], 10);
        var yr = parseInt(mSlash4[3], 10);
        if (n1 > 12 && n2 <= 12) {
          day = n1;
          month = n2;
        } else {
          month = n1;
          day = n2;
        }
        year = yr;
      }
    }

    // 3. M/D/YY or MM/DD/YY
    if (!year) {
      var mSlash2 = rawDatePart.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
      if (mSlash2) {
        var n1 = parseInt(mSlash2[1], 10);
        var n2 = parseInt(mSlash2[2], 10);
        var yr2 = parseInt(mSlash2[3], 10);
        var fullYr = yr2 < 70 ? (2000 + yr2) : (1900 + yr2);
        if (n1 > 12 && n2 <= 12) {
          day = n1;
          month = n2;
        } else {
          month = n1;
          day = n2;
        }
        year = fullYr;
      }
    }

    // 4. M/D or MM/DD without year (defaults to current year)
    if (!year) {
      var mShort = rawDatePart.match(/^(\d{1,2})[-\/.](\d{1,2})$/);
      if (mShort) {
        var n1 = parseInt(mShort[1], 10);
        var n2 = parseInt(mShort[2], 10);
        if (n1 <= 12 && n2 <= 31) {
          month = n1;
          day = n2;
          year = new Date().getFullYear();
        } else if (n1 > 12 && n2 <= 12) {
          day = n1;
          month = n2;
          year = new Date().getFullYear();
        }
      }
    }

    // 5. Fallback to native Date parsing ONLY if string contains textual month names (e.g. "Aug 1, 2026", "1-Aug-2026")
    if (!year && /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(str)) {
      var dNative = new Date(str);
      if (!isNaN(dNative.getTime())) {
        year = dNative.getFullYear();
        month = dNative.getMonth() + 1;
        day = dNative.getDate();
      }
    }

    if (year && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      var utcTime = Date.UTC(year, month - 1, day);
      var dObj = new Date(utcTime);
      if (dObj.getUTCFullYear() === year && (dObj.getUTCMonth() + 1) === month && dObj.getUTCDate() === day) {
        var pad = function(n) { return n < 10 ? '0' + n : String(n); };
        return {
          year: year,
          month: month,
          day: day,
          isoDate: year + '-' + pad(month) + '-' + pad(day),
          timestamp: utcTime,
          dayOfWeek: dObj.getUTCDay(),
          isDate: true
        };
      }
    }

    return null;
  };

  /**
   * Advance a Date by N Days (UTC-safe)
   *
   * @param {string|Date|Object} dateInput - Date string, Date instance, or parsed date info
   * @param {number} days - Number of days to add (can be negative)
   * @returns {Object|null} New parsed date info object
   */
  ErlanglyUtils.addDays = function(dateInput, days) {
    var info = dateInput && dateInput.isDate ? dateInput : ErlanglyUtils.parseDate(dateInput);
    if (!info) return null;
    var newTimestamp = info.timestamp + (days * 86400000);
    return ErlanglyUtils.parseDate(new Date(newTimestamp));
  };

  /**
   * Cross-Tool Handoff Utilities (Session persistence via localStorage)
   */
  ErlanglyUtils.setHandoff = function(toolName, data) {
    try {
      localStorage.setItem('erlangly_handoff_' + toolName, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      console.warn('LocalStorage handoff failed:', e);
    }
  };

  ErlanglyUtils.getHandoff = function(toolName, clearAfterRead) {
    try {
      var raw = localStorage.getItem('erlangly_handoff_' + toolName);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (clearAfterRead) {
        localStorage.removeItem('erlangly_handoff_' + toolName);
      }
      return parsed ? parsed.data : null;
    } catch (e) {
      console.warn('LocalStorage handoff read failed:', e);
      return null;
    }
  };

  /**
   * Decode shared plan data from URL parameters.
   * Returns the parsed plan object if ?shared=1&data=<b64> is present,
   * or null otherwise. Safe — catches malformed payloads gracefully.
   *
   * @returns {Object|null} Decoded plan data or null
   */
  ErlanglyUtils.getSharedData = function() {
    if (typeof window === 'undefined') return null;
    var params = new URLSearchParams(window.location.search);
    if (params.get('shared') !== '1') return null;
    var raw = params.get('data');
    if (!raw) return null;
    try {
      return JSON.parse(atob(decodeURIComponent(raw)));
    } catch (e) {
      return null;
    }
  };

  /**
   * Check for Shared Read-Only Link Mode — shows a banner and, if the
   * URL carries a base64 data payload, stores the decoded plan under
   * window.ERLANGLY_SHARED_DATA so tool init functions can restore inputs.
   */
  ErlanglyUtils.checkSharedPreview = function() {
    if (typeof window === 'undefined') return;
    var params = new URLSearchParams(window.location.search);
    if (params.get('shared') === '1') {
      // Decode and expose plan data for tool pages to consume
      var sharedData = ErlanglyUtils.getSharedData();
      if (sharedData) {
        window.ERLANGLY_SHARED_DATA = sharedData;
      }

      var header = document.querySelector('.tool-header');
      if (header) {
        var banner = document.createElement('div');
        banner.className = 'panel';
        banner.style.cssText = 'background: rgba(0, 210, 211, 0.12); border-color: var(--accent); margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);';
        banner.innerHTML = '<div><strong>🌐 Shared Plan Preview (Read-Only Mode)</strong> — Viewing a shared workforce plan. Inputs have been restored from the shared link.</div><a href="' + window.location.pathname + '" class="btn btn-secondary btn-sm">Create New Plan</a>';
        header.parentNode.insertBefore(banner, header);
      }
    }
  };

  /**
   * Theme Management (Dark / Light Theme Toggle & Persistence)
   */
  ErlanglyUtils.getTheme = function() {
    if (typeof localStorage !== 'undefined') {
      var saved = localStorage.getItem('erlangly_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) {
      return document.documentElement.getAttribute('data-theme');
    }
    return 'dark';
  };

  ErlanglyUtils.setTheme = function(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;

      // Update all toggle buttons on page
      var btns = document.querySelectorAll('.theme-toggle-btn');
      btns.forEach(function(btn) {
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme');
        btn.setAttribute('title', theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme');
        btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      });
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('erlangly_theme', theme);
      } catch (e) {
        console.warn('Failed to save theme in localStorage:', e);
      }
    }

    // Dispatch global event for Chart.js and other visualizers
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      var evt;
      try {
        evt = new CustomEvent('erlangly:themechange', { detail: { theme: theme } });
      } catch (e) {
        evt = document.createEvent('CustomEvent');
        evt.initCustomEvent('erlangly:themechange', true, true, { theme: theme });
      }
      window.dispatchEvent(evt);
    }
    return theme;
  };

  ErlanglyUtils.toggleTheme = function() {
    var current = ErlanglyUtils.getTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    return ErlanglyUtils.setTheme(next);
  };

  ErlanglyUtils.initTheme = function() {
    var currentTheme = ErlanglyUtils.getTheme();
    ErlanglyUtils.setTheme(currentTheme);

    if (typeof document !== 'undefined') {
      var btns = document.querySelectorAll('.theme-toggle-btn');
      btns.forEach(function(btn) {
        if (!btn.dataset.themeBound) {
          btn.dataset.themeBound = 'true';
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            ErlanglyUtils.toggleTheme();
          });
        }
      });
    }
  };

  /**
   * Contextual Inline Help & Tooltip System
   * Wires accessible tooltips across forms, inputs, and tables.
   */
  ErlanglyUtils.initTooltips = function(container) {
    if (typeof document === 'undefined') return;
    var rootEl = container || document;
    var tips = rootEl.querySelectorAll('.help-tip[data-help-text], [data-tooltip]');

    // One shared bubble appended to <body> so it escapes any overflow:hidden ancestor.
    // We reuse / lazily create it.
    var sharedBubble = document.getElementById('erlangly-shared-tooltip');
    if (!sharedBubble) {
      sharedBubble = document.createElement('div');
      sharedBubble.id = 'erlangly-shared-tooltip';
      sharedBubble.className = 'tooltip-bubble tooltip-bubble-fixed';
      sharedBubble.setAttribute('role', 'tooltip');
      document.body.appendChild(sharedBubble);
    }

    // Hide bubble when clicking elsewhere
    document.addEventListener('click', function(e) {
      if (!e.target.classList.contains('help-tip')) {
        sharedBubble.style.opacity = '0';
        sharedBubble.style.visibility = 'hidden';
        sharedBubble.style.pointerEvents = 'none';
      }
    }, true);

    function positionBubble(triggerEl) {
      var rect = triggerEl.getBoundingClientRect();
      var bw = sharedBubble.offsetWidth || 290;
      var bh = sharedBubble.offsetHeight || 80;
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var MARGIN = 10;

      // Preferred: above the button, centred
      var top = rect.top - bh - 10;
      var left = rect.left + rect.width / 2 - bw / 2;

      // If would go above viewport, flip below
      if (top < MARGIN) {
        top = rect.bottom + 10;
        sharedBubble.dataset.arrowDir = 'up'; // arrow points up (bubble is below)
      } else {
        sharedBubble.dataset.arrowDir = 'down';
      }

      // Clamp horizontally
      if (left + bw > vw - MARGIN) left = vw - bw - MARGIN;
      if (left < MARGIN) left = MARGIN;

      sharedBubble.style.top = top + 'px';
      sharedBubble.style.left = left + 'px';
    }

    function showBubble(triggerEl, title, text, example) {
      var contentHtml = '';
      if (title) contentHtml += '<div class="tooltip-title"><span>ℹ️</span> ' + title + '</div>';
      contentHtml += '<div>' + text + '</div>';
      if (example) contentHtml += '<div class="tooltip-example"><strong>Example:</strong> ' + example + '</div>';
      sharedBubble.innerHTML = contentHtml;

      // Make visible (but transparent) first so offsetWidth/Height resolve correctly
      sharedBubble.style.visibility = 'visible';
      sharedBubble.style.opacity = '0';
      sharedBubble.style.pointerEvents = 'auto';

      positionBubble(triggerEl);

      // Fade in
      sharedBubble.style.opacity = '1';
    }

    function hideBubble() {
      sharedBubble.style.opacity = '0';
      sharedBubble.style.visibility = 'hidden';
      sharedBubble.style.pointerEvents = 'none';
    }

    tips.forEach(function(el) {
      if (el.dataset.tooltipBound) return;
      el.dataset.tooltipBound = 'true';

      if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.getAttribute('role')) el.setAttribute('role', 'button');

      var tipId = 'erlangly-shared-tooltip';
      el.setAttribute('aria-describedby', tipId);

      var title = el.getAttribute('data-help-title') || '';
      var text = el.getAttribute('data-help-text') || el.getAttribute('data-tooltip') || '';
      var example = el.getAttribute('data-help-example') || '';

      el.addEventListener('mouseenter', function() { showBubble(el, title, text, example); });
      el.addEventListener('focus', function() { showBubble(el, title, text, example); });
      el.addEventListener('mouseleave', function() { hideBubble(); });
      el.addEventListener('blur', function() { hideBubble(); });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { hideBubble(); el.blur(); }
      });
      el.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isVisible = sharedBubble.style.visibility === 'visible' && sharedBubble.style.opacity === '1';
        if (isVisible) {
          hideBubble();
        } else {
          showBubble(el, title, text, example);
        }
      });
    });
  };

  /**
   * Universal CSV Import Validation Preview Modal
   */
  ErlanglyUtils.showCSVPreviewModal = function(options) {
    if (typeof document === 'undefined' || !options) return;
    var rawText = options.text || '';
    var file = options.file || null;
    var filename = file ? file.name : (options.filename || 'import.csv');
    var requiredHeaders = (options.requiredHeaders || []).map(function(h) { return h.toLowerCase().replace(/[^a-z0-9_]/g, ''); });

    var parsed = ErlanglyUtils.parseCSV(rawText);
    var rows = parsed.rows || [];
    var headers = parsed.headers || [];
    var normHeaders = parsed.normalizedHeaders || [];

    // Header validation
    var matchedRequired = [];
    var missingRequired = [];
    requiredHeaders.forEach(function(req) {
      if (normHeaders.indexOf(req) !== -1) {
        matchedRequired.push(req);
      } else {
        missingRequired.push(req);
      }
    });

    // Row validation
    var validRows = [];
    var malformedRows = [];

    rows.forEach(function(row, idx) {
      var lineNum = idx + 2;
      var isRowEmpty = Object.values(row).every(function(v) { return String(v).trim() === ''; });
      if (isRowEmpty) return;

      var isValid = true;
      var errReason = '';

      for (var r = 0; r < requiredHeaders.length; r++) {
        var rKey = requiredHeaders[r];
        if (normHeaders.indexOf(rKey) !== -1) {
          var val = row[rKey];
          if (val === undefined || val === null || String(val).trim() === '') {
            isValid = false;
            errReason = 'Missing required column value "' + rKey + '"';
            break;
          }
        }
      }

      if (isValid && typeof options.rowValidator === 'function') {
        var vRes = options.rowValidator(row, lineNum);
        if (vRes && vRes.valid === false) {
          isValid = false;
          errReason = vRes.error || 'Invalid row data';
        }
      }

      if (isValid) {
        validRows.push(row);
      } else {
        malformedRows.push({ line: lineNum, row: row, reason: errReason });
      }
    });

    var existing = document.getElementById('modal-csv-preview-overlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'modal-csv-preview-overlay';
    overlay.className = 'csv-preview-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'csv-preview-modal-title');

    var modal = document.createElement('div');
    modal.className = 'csv-preview-modal';

    var modalHeader = document.createElement('div');
    modalHeader.className = 'csv-preview-header';
    modalHeader.innerHTML = 
      '<div class="csv-preview-title" id="csv-preview-modal-title">' +
        '<span>📊</span>' +
        '<span>' + (options.title || 'CSV Import Preview & Validation') + '</span>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-close-csv-preview" aria-label="Close modal" style="padding: 4px 8px; font-size: 16px;">✕</button>';

    var modalBody = document.createElement('div');
    modalBody.className = 'csv-preview-body';

    var summaryHtml = 
      '<div class="csv-stat-summary">' +
        '<div class="csv-stat-card">' +
          '<div class="csv-stat-label">File</div>' +
          '<div class="csv-stat-val" style="font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + filename + '">' + filename + '</div>' +
        '</div>' +
        '<div class="csv-stat-card">' +
          '<div class="csv-stat-label">Total Rows</div>' +
          '<div class="csv-stat-val">' + rows.length.toLocaleString() + '</div>' +
        '</div>' +
        '<div class="csv-stat-card valid">' +
          '<div class="csv-stat-label">Valid Rows</div>' +
          '<div class="csv-stat-val text-success">' + validRows.length.toLocaleString() + '</div>' +
        '</div>' +
        '<div class="csv-stat-card' + (malformedRows.length > 0 ? ' skipped' : '') + '">' +
          '<div class="csv-stat-label">Skipped / Errors</div>' +
          '<div class="csv-stat-val ' + (malformedRows.length > 0 ? 'text-warn' : 'text-muted') + '">' + malformedRows.length.toLocaleString() + '</div>' +
        '</div>' +
      '</div>';

    var alertHtml = '';
    if (missingRequired.length > 0) {
      alertHtml += '<div class="csv-validation-alerts" style="border-color: var(--danger); background: var(--danger-muted);">' +
        '<div style="color: var(--danger); font-weight: 600;">🚫 Missing Required Column(s): ' + missingRequired.join(', ') + '</div>' +
        '<div style="color: var(--text-secondary);">Your file must contain columns named: ' + requiredHeaders.join(', ') + '. Please check headers and retry.</div>' +
      '</div>';
    } else if (malformedRows.length > 0) {
      var errList = malformedRows.slice(0, 4).map(function(m) {
        return '<li>Line ' + m.line + ': ' + m.reason + '</li>';
      }).join('');
      alertHtml += '<div class="csv-validation-alerts" style="border-color: var(--warn); background: var(--warn-muted);">' +
        '<div style="color: var(--warn); font-weight: 600;">⚠️ ' + malformedRows.length + ' Malformed Row(s) Detected (Will be skipped on import):</div>' +
        '<ul style="padding-left: 20px; color: var(--text-secondary); margin: 0;">' + errList + (malformedRows.length > 4 ? '<li>...and ' + (malformedRows.length - 4) + ' more</li>' : '') + '</ul>' +
      '</div>';
    }

    var previewRows = validRows.slice(0, 7);
    var tableHtml = '<div class="csv-preview-table-wrap"><table class="csv-preview-table"><thead><tr>';
    tableHtml += '<th style="width: 40px;">#</th>';
    headers.forEach(function(h) {
      tableHtml += '<th>' + h + '</th>';
    });
    tableHtml += '</tr></thead><tbody>';

    if (previewRows.length === 0) {
      tableHtml += '<tr><td colspan="' + (headers.length + 1) + '" style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No valid rows to preview.</td></tr>';
    } else {
      previewRows.forEach(function(pRow, rIdx) {
        tableHtml += '<tr>';
        tableHtml += '<td style="color: var(--text-muted);">' + (rIdx + 1) + '</td>';
        headers.forEach(function(h) {
          var normKey = h.toLowerCase().replace(/[^a-z0-9_]/g, '');
          var val = pRow[h] !== undefined ? pRow[h] : (pRow[normKey] !== undefined ? pRow[normKey] : '');
          tableHtml += '<td>' + val + '</td>';
        });
        tableHtml += '</tr>';
      });
    }
    tableHtml += '</tbody></table></div>';

    modalBody.innerHTML = summaryHtml + alertHtml + '<div><div style="font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-2);">Sample Data Preview (First ' + previewRows.length + ' rows):</div>' + tableHtml + '</div>';

    var modalFooter = document.createElement('div');
    modalFooter.className = 'csv-preview-footer';

    var canCommit = validRows.length > 0 && missingRequired.length === 0;
    modalFooter.innerHTML = 
      '<button type="button" class="btn btn-secondary btn-sm btn-cancel-csv-preview">Cancel</button>' +
      '<button type="button" class="btn btn-primary btn-sm btn-confirm-csv-preview"' + (canCommit ? '' : ' disabled style="opacity: 0.5; cursor: not-allowed;"') + '>' +
        '✓ Confirm & Import (' + validRows.length.toLocaleString() + ' rows)' +
      '</button>';

    modal.appendChild(modalHeader);
    modal.appendChild(modalBody);
    modal.appendChild(modalFooter);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var closeModal = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof options.onCancel === 'function') options.onCancel();
    };

    var confirmModal = function() {
      if (!canCommit) return;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (typeof options.onConfirm === 'function') {
        options.onConfirm({
          headers: headers,
          normalizedHeaders: normHeaders,
          rows: validRows,
          allRows: rows,
          malformedCount: malformedRows.length,
          malformedRows: malformedRows,
          filename: filename
        });
      }
    };

    overlay.querySelector('.btn-close-csv-preview').addEventListener('click', closeModal);
    overlay.querySelector('.btn-cancel-csv-preview').addEventListener('click', closeModal);
    overlay.querySelector('.btn-confirm-csv-preview').addEventListener('click', confirmModal);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });

    var handleEsc = function(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);
  };

  // Expose to global namespace and CommonJS
  root.ErlanglyUtils = ErlanglyUtils;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErlanglyUtils;
  }

  // Auto-init nav, theme, tooltips, and shared preview when DOM is ready
  if (typeof document !== 'undefined') {
    var runInit = function() {
      ErlanglyUtils.initTheme();
      ErlanglyUtils.initNav();
      ErlanglyUtils.initTooltips();
      ErlanglyUtils.checkSharedPreview();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runInit);
    } else {
      runInit();
    }
  }

})(typeof self !== 'undefined' ? self : this);

