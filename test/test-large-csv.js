/**
 * Test large CSV chunked parsing logic on 200k synthetic dataset
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'synthetic-200k.csv');
console.log('Testing chunked parse on:', filePath);

const startTime = Date.now();
const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks

let buffer = '';
let isFirstLine = true;
let totalParsed = 0;
let aggregated = {};

stream.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r\n|\r|\n/);
  buffer = lines.pop(); // keep partial

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    const parts = line.split(',');
    const date = parts[0];
    const vol = parseFloat(parts[2]);
    if (!isNaN(vol)) {
      totalParsed++;
      if (!aggregated[date]) aggregated[date] = 0;
      aggregated[date] += vol;
    }
  }
});

stream.on('end', () => {
  if (buffer && buffer.trim()) {
    const parts = buffer.trim().split(',');
    const date = parts[0];
    const vol = parseFloat(parts[2]);
    if (!isNaN(vol)) {
      totalParsed++;
      if (!aggregated[date]) aggregated[date] = 0;
      aggregated[date] += vol;
    }
  }

  const duration = Date.now() - startTime;
  const dayCount = Object.keys(aggregated).length;
  console.log(`✓ Successfully parsed and aggregated ${totalParsed} rows into ${dayCount} daily rollups in ${duration}ms!`);

  if (totalParsed >= 200000 && dayCount > 0) {
    console.log('Large CSV streaming verification PASSED!');
    process.exit(0);
  } else {
    console.error('FAIL: Incomplete rows parsed');
    process.exit(1);
  }
});
