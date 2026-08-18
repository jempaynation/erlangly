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

  // Expose to global namespace and CommonJS
  root.ErlanglyUtils = ErlanglyUtils;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErlanglyUtils;
  }

  // Auto-init nav and shared preview when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        ErlanglyUtils.initNav();
        ErlanglyUtils.checkSharedPreview();
      });
    } else {
      ErlanglyUtils.initNav();
      ErlanglyUtils.checkSharedPreview();
    }
  }

})(typeof self !== 'undefined' ? self : this);

