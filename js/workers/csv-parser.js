/**
 * Erlangly Web Worker — Chunked Streaming CSV Parser (js/workers/csv-parser.js)
 * 
 * Efficiently streams and parses large historical contact center CSV files (100k+ rows)
 * off the main thread without freezing the UI.
 * 
 * Features:
 * - Chunk-by-chunk processing with progress reporting
 * - In-flight aggregation (rolls interval rows up to date/daily aggregates)
 * - Tolerant parsing: skips and counts malformed rows without crashing
 * - UTC-safe date parsing & chronological ascending sort
 */

'use strict';

self.onmessage = function(e) {
  var data = e.data;
  if (!data) return;

  if (data.type === 'parse_file') {
    parseFileInChunks(data.file, data.aggregateLevel);
  } else if (data.type === 'parse_text') {
    parseTextDirectly(data.text, data.aggregateLevel);
  }
};

function parseDateInfo(str) {
  if (!str) return null;
  str = String(str).trim();
  if (!str) return null;

  var rawDatePart = str;
  if (rawDatePart.indexOf('T') !== -1) {
    rawDatePart = rawDatePart.split('T')[0];
  } else if (rawDatePart.indexOf(' ') !== -1) {
    rawDatePart = rawDatePart.split(' ')[0];
  }

  var year = null;
  var month = null;
  var day = null;

  var mIso = rawDatePart.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (mIso) {
    year = parseInt(mIso[1], 10);
    month = parseInt(mIso[2], 10);
    day = parseInt(mIso[3], 10);
  }

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
}

function parseFileInChunks(file, aggregateLevel) {
  var CHUNK_SIZE = 64 * 1024; // 64 KB chunks
  var fileSize = file.size;
  var offset = 0;

  var buffer = '';
  var isFirstLine = true;
  var headerMap = null;

  var totalParsed = 0;
  var skippedCount = 0;
  var aggregated = {}; // key -> { date, skill, volume, count, totalAht, timestamp }
  var rawSeries = [];  // if not aggregating: [ { period, skill, volume, aht, timestamp } ]
  var skillsMap = {};

  var reader = new FileReaderSync();

  try {
    while (offset < fileSize) {
      var slice = file.slice(offset, offset + CHUNK_SIZE);
      var chunkText = reader.readAsText(slice);
      offset += CHUNK_SIZE;

      buffer += chunkText;
      var lines = buffer.split(/\r\n|\r|\n/);
      // Keep the last partial line in the buffer
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        if (isFirstLine) {
          headerMap = parseHeader(line);
          isFirstLine = false;
          continue;
        }

        var record = parseLine(line, headerMap);
        if (!record || isNaN(record.volume)) {
          skippedCount++;
          continue;
        }

        totalParsed++;
        if (record.skill) skillsMap[record.skill] = true;

        if (aggregateLevel === 'daily' && record.date) {
          var dateKey = record.date;
          var skillKey = record.skill || 'General';
          var aggKey = dateKey + ':::' + skillKey;
          if (!aggregated[aggKey]) {
            aggregated[aggKey] = {
              period: dateKey,
              date: dateKey,
              skill: skillKey,
              volume: 0,
              count: 0,
              ahtSum: 0,
              timestamp: record.timestamp
            };
          }
          aggregated[aggKey].volume += record.volume;
          aggregated[aggKey].count++;
          aggregated[aggKey].ahtSum += (record.aht || 180) * record.volume;
        } else {
          rawSeries.push({
            period: record.period || record.date || ('Row ' + totalParsed),
            skill: record.skill || 'General',
            volume: record.volume,
            aht: record.aht || 180,
            timestamp: record.timestamp
          });
        }
      }

      // Report progress
      var progress = Math.min(100, Math.round((Math.min(offset, fileSize) / fileSize) * 100));
      self.postMessage({
        type: 'progress',
        progress: progress,
        processedBytes: Math.min(offset, fileSize),
        totalBytes: fileSize,
        parsedCount: totalParsed,
        skippedCount: skippedCount
      });
    }

    // Process leftover buffer line
    if (buffer && buffer.trim() && !isFirstLine && headerMap) {
      var lastRecord = parseLine(buffer.trim(), headerMap);
      if (lastRecord && !isNaN(lastRecord.volume)) {
        totalParsed++;
        if (lastRecord.skill) skillsMap[lastRecord.skill] = true;
        if (aggregateLevel === 'daily' && lastRecord.date) {
          var k = lastRecord.date;
          var sk = lastRecord.skill || 'General';
          var aggK = k + ':::' + sk;
          if (!aggregated[aggK]) {
            aggregated[aggK] = {
              period: k,
              date: k,
              skill: sk,
              volume: 0,
              count: 0,
              ahtSum: 0,
              timestamp: lastRecord.timestamp
            };
          }
          aggregated[aggK].volume += lastRecord.volume;
          aggregated[aggK].count++;
          aggregated[aggK].ahtSum += (lastRecord.aht || 180) * lastRecord.volume;
        } else {
          rawSeries.push({
            period: lastRecord.period || lastRecord.date || ('Row ' + totalParsed),
            skill: lastRecord.skill || 'General',
            volume: lastRecord.volume,
            aht: lastRecord.aht || 180,
            timestamp: lastRecord.timestamp
          });
        }
      } else {
        skippedCount++;
      }
    }

    // Final result compilation sorted chronologically
    var finalRows = [];
    var detectedSkills = Object.keys(skillsMap);

    if (aggregateLevel === 'daily' && Object.keys(aggregated).length > 0) {
      var keys = Object.keys(aggregated);
      keys.sort(function(a, b) {
        var itemA = aggregated[a];
        var itemB = aggregated[b];
        var infoA = parseDateInfo(itemA.period);
        var infoB = parseDateInfo(itemB.period);
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        if (infoA && !infoB) return -1;
        if (!infoA && infoB) return 1;
        if (itemA.skill && itemB.skill && itemA.skill !== itemB.skill) {
          return itemA.skill.localeCompare(itemB.skill);
        }
        return a.localeCompare(b);
      });
      keys.forEach(function(k) {
        var item = aggregated[k];
        finalRows.push({
          period: item.period,
          skill: item.skill,
          volume: Math.round(item.volume),
          aht: item.volume > 0 ? Math.round(item.ahtSum / item.volume) : 180
        });
      });
    } else {
      rawSeries.sort(function(a, b) {
        var infoA = parseDateInfo(a.period);
        var infoB = parseDateInfo(b.period);
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        if (a.skill && b.skill && a.skill !== b.skill) return a.skill.localeCompare(b.skill);
        return 0;
      });
      finalRows = rawSeries.map(function(item) {
        return {
          period: item.period,
          skill: item.skill,
          volume: item.volume,
          aht: item.aht
        };
      });
    }

    self.postMessage({
      type: 'complete',
      rows: finalRows,
      skills: detectedSkills,
      hasMultiSkill: detectedSkills.length > 1,
      totalParsed: totalParsed,
      skippedCount: skippedCount
    });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Worker CSV parse failure'
    });
  }
}

function parseTextDirectly(text, aggregateLevel) {
  try {
    var lines = text.split(/\r\n|\r|\n/);
    if (lines.length === 0) {
      self.postMessage({ type: 'complete', rows: [], skills: [], hasMultiSkill: false, totalParsed: 0, skippedCount: 0 });
      return;
    }

    var headerMap = parseHeader(lines[0]);
    var aggregated = {};
    var rawSeries = [];
    var totalParsed = 0;
    var skippedCount = 0;
    var skillsMap = {};

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var record = parseLine(line, headerMap);
      if (!record || isNaN(record.volume)) {
        skippedCount++;
        continue;
      }
      totalParsed++;
      if (record.skill) skillsMap[record.skill] = true;

      if (aggregateLevel === 'daily' && record.date) {
        var k = record.date;
        var sk = record.skill || 'General';
        var aggK = k + ':::' + sk;
        if (!aggregated[aggK]) {
          aggregated[aggK] = {
            period: k,
            date: k,
            skill: sk,
            volume: 0,
            count: 0,
            ahtSum: 0,
            timestamp: record.timestamp
          };
        }
        aggregated[aggK].volume += record.volume;
        aggregated[aggK].count++;
        aggregated[aggK].ahtSum += (record.aht || 180) * record.volume;
      } else {
        rawSeries.push({
          period: record.period || record.date || ('Row ' + totalParsed),
          skill: record.skill || 'General',
          volume: record.volume,
          aht: record.aht || 180,
          timestamp: record.timestamp
        });
      }
    }

    var finalRows = [];
    var detectedSkills = Object.keys(skillsMap);

    if (aggregateLevel === 'daily' && Object.keys(aggregated).length > 0) {
      var keys = Object.keys(aggregated);
      keys.sort(function(a, b) {
        var itemA = aggregated[a];
        var itemB = aggregated[b];
        var infoA = parseDateInfo(itemA.period);
        var infoB = parseDateInfo(itemB.period);
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        if (infoA && !infoB) return -1;
        if (!infoA && infoB) return 1;
        if (itemA.skill && itemB.skill && itemA.skill !== itemB.skill) {
          return itemA.skill.localeCompare(itemB.skill);
        }
        return a.localeCompare(b);
      });
      keys.forEach(function(k) {
        var item = aggregated[k];
        finalRows.push({
          period: item.period,
          skill: item.skill,
          volume: Math.round(item.volume),
          aht: item.volume > 0 ? Math.round(item.ahtSum / item.volume) : 180
        });
      });
    } else {
      rawSeries.sort(function(a, b) {
        var infoA = parseDateInfo(a.period);
        var infoB = parseDateInfo(b.period);
        if (infoA && infoB && infoA.timestamp !== infoB.timestamp) return infoA.timestamp - infoB.timestamp;
        if (a.skill && b.skill && a.skill !== b.skill) return a.skill.localeCompare(b.skill);
        return 0;
      });
      finalRows = rawSeries.map(function(item) {
        return {
          period: item.period,
          skill: item.skill,
          volume: item.volume,
          aht: item.aht
        };
      });
    }

    self.postMessage({
      type: 'complete',
      rows: finalRows,
      skills: detectedSkills,
      hasMultiSkill: detectedSkills.length > 1,
      totalParsed: totalParsed,
      skippedCount: skippedCount
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}

function parseHeader(line) {
  var cols = line.split(',').map(function(c) {
    return c.replace(/["']/g, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  });

  var map = {
    dateIndex: -1,
    timeIndex: -1,
    volumeIndex: -1,
    ahtIndex: -1,
    skillIndex: -1
  };

  cols.forEach(function(col, idx) {
    if (col === 'date' || col === 'day' || col === 'timestamp' || col === 'datetime') {
      map.dateIndex = idx;
    } else if (col === 'time' || col === 'interval' || col === 'period' || col === 'hour') {
      map.timeIndex = idx;
    } else if (col === 'volume' || col === 'calls' || col === 'interactions' || col === 'count' || col === 'contacts') {
      map.volumeIndex = idx;
    } else if (col === 'aht' || col === 'handletime' || col === 'duration' || col === 'avg_handle_time') {
      map.ahtIndex = idx;
    } else if (col === 'skill' || col === 'queue' || col === 'channel' || col === 'lob' || col === 'service' || col === 'skill_group' || col === 'skillgroup' || col === 'line_of_business') {
      map.skillIndex = idx;
    }
  });

  // Fallbacks if not explicitly named
  if (map.volumeIndex === -1 && cols.length >= 2) {
    map.volumeIndex = 1;
  }
  if (map.dateIndex === -1 && map.timeIndex === -1 && cols.length >= 1) {
    map.dateIndex = 0;
  }

  return map;
}

function parseLine(line, headerMap) {
  var parts = line.split(',');
  if (parts.length < 2) return null;

  var clean = function(val) {
    return val ? val.replace(/["']/g, '').trim() : '';
  };

  var volStr = headerMap.volumeIndex !== -1 ? clean(parts[headerMap.volumeIndex]) : clean(parts[1]);
  var vol = parseFloat(volStr);
  if (isNaN(vol) || vol < 0) return null;

  var dateStr = headerMap.dateIndex !== -1 ? clean(parts[headerMap.dateIndex]) : '';
  var timeStr = headerMap.timeIndex !== -1 ? clean(parts[headerMap.timeIndex]) : '';
  var ahtStr = headerMap.ahtIndex !== -1 ? clean(parts[headerMap.ahtIndex]) : '180';
  var aht = parseFloat(ahtStr) || 180;
  var skillStr = headerMap.skillIndex !== -1 ? clean(parts[headerMap.skillIndex]) : 'General';
  if (!skillStr) skillStr = 'General';

  var dateInfo = parseDateInfo(dateStr || (!timeStr ? clean(parts[0]) : ''));
  var normalizedDate = dateInfo ? dateInfo.isoDate : (dateStr || clean(parts[0]));

  var periodStr = normalizedDate;
  if (timeStr) {
    periodStr = normalizedDate ? (normalizedDate + ' ' + timeStr) : timeStr;
  }
  if (!periodStr) {
    periodStr = clean(parts[0]);
  }

  return {
    date: normalizedDate,
    period: periodStr,
    skill: skillStr,
    volume: vol,
    aht: aht,
    timestamp: dateInfo ? dateInfo.timestamp : 0
  };
}
