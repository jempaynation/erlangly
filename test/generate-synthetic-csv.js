/**
 * Generate a synthetic ~200k row interval CSV for testing Web Worker streaming parser
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'synthetic-200k.csv');
const writeStream = fs.createWriteStream(filePath);

writeStream.write('date,time,volume,aht\n');

const startDate = new Date('2024-01-01');
const totalRows = 200000;

console.log('Generating synthetic 200k row CSV...');

for (let i = 0; i < totalRows; i++) {
  // 15-minute intervals (96 intervals per day)
  const dayOffset = Math.floor(i / 96);
  const intervalIdx = i % 96;
  
  const d = new Date(startDate);
  d.setDate(d.getDate() + dayOffset);
  const dateStr = d.toISOString().split('T')[0];
  
  const hour = Math.floor(intervalIdx / 4);
  const min = (intervalIdx % 4) * 15;
  const timeStr = `${hour < 10 ? '0' : ''}${hour}:${min < 10 ? '0' : ''}${min}`;
  
  // Realistic volume variation: peak at noon, low at night, weekend factor
  const dayOfWeek = d.getDay(); // 0 is Sunday
  const weekendMult = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.4 : 1.0;
  const timeFactor = Math.sin((intervalIdx / 96) * Math.PI);
  const baseVol = Math.max(5, Math.round((50 + 200 * timeFactor) * weekendMult + (Math.random() * 20 - 10)));
  const aht = Math.round(180 + (Math.random() * 40 - 20));
  
  writeStream.write(`${dateStr},${timeStr},${baseVol},${aht}\n`);
}

writeStream.end(() => {
  const stats = fs.statSync(filePath);
  console.log(`Generated ${totalRows} rows at ${filePath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
});
