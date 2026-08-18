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
 */

'use strict';

self.onmessage = function(e) {
  var data = e.data;
  if (!data) return;

  if (data.type === 'parse_file') {
    parseFileInChunks(data.file, data.aggregateLevel);
  } else if (data.type === 'parse_text') {
    parseTextDirectly(data.text);
  }
};

function parseFileInChunks(file, aggregateLevel) {
  var CHUNK_SIZE = 64 * 1024; // 64 KB chunks
  var fileSize = file.size;
  var offset = 0;

  var buffer = '';
  var isFirstLine = true;
  var headerMap = null;

  var totalParsed = 0;
  var skippedCount = 0;
  var aggregated = {}; // key -> { date, volume, count, totalAht }
  var rawSeries = [];  // if not aggregating: [ { period, volume, aht } ]

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

        if (aggregateLevel === 'daily' && record.date) {
          var dateKey = record.date;
          if (!aggregated[dateKey]) {
            aggregated[dateKey] = { period: dateKey, volume: 0, count: 0, ahtSum: 0 };
          }
          aggregated[dateKey].volume += record.volume;
          aggregated[dateKey].count++;
          aggregated[dateKey].ahtSum += (record.aht || 180) * record.volume;
        } else {
          rawSeries.push({
            period: record.period || record.date || ('Row ' + totalParsed),
            volume: record.volume,
            aht: record.aht || 180
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
        if (aggregateLevel === 'daily' && lastRecord.date) {
          var k = lastRecord.date;
          if (!aggregated[k]) aggregated[k] = { period: k, volume: 0, count: 0, ahtSum: 0 };
          aggregated[k].volume += lastRecord.volume;
          aggregated[k].count++;
          aggregated[k].ahtSum += (lastRecord.aht || 180) * lastRecord.volume;
        } else {
          rawSeries.push({
            period: lastRecord.period || lastRecord.date || ('Row ' + totalParsed),
            volume: lastRecord.volume,
            aht: lastRecord.aht || 180
          });
        }
      } else {
        skippedCount++;
      }
    }

    // Final result compilation
    var finalRows = [];
    if (aggregateLevel === 'daily' && Object.keys(aggregated).length > 0) {
      var keys = Object.keys(aggregated).sort();
      keys.forEach(function(k) {
        var item = aggregated[k];
        finalRows.push({
          period: item.period,
          volume: Math.round(item.volume),
          aht: item.volume > 0 ? Math.round(item.ahtSum / item.volume) : 180
        });
      });
    } else {
      finalRows = rawSeries;
    }

    self.postMessage({
      type: 'complete',
      rows: finalRows,
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

function parseHeader(line) {
  var cols = line.split(',').map(function(c) {
    return c.replace(/["']/g, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  });

  var map = {
    dateIndex: -1,
    timeIndex: -1,
    volumeIndex: -1,
    ahtIndex: -1
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

  var periodStr = dateStr;
  if (timeStr) {
    periodStr = dateStr ? (dateStr + ' ' + timeStr) : timeStr;
  }
  if (!periodStr) {
    periodStr = clean(parts[0]);
  }

  // Extract pure YYYY-MM-DD date if dateStr contains timestamp
  var pureDate = dateStr;
  if (pureDate && pureDate.indexOf(' ') !== -1) {
    pureDate = pureDate.split(' ')[0];
  } else if (pureDate && pureDate.indexOf('T') !== -1) {
    pureDate = pureDate.split('T')[0];
  }

  return {
    date: pureDate || periodStr,
    period: periodStr,
    volume: vol,
    aht: aht
  };
}
