/**
 * Erlangly Mathematical & Functional Verification Suite
 * Run with: node test/run-tests.js
 */

const Erlangly = require('../js/erlang.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertClose(actual, expected, tolerance = 0.005, message = '') {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  assert(ok, `${message} (expected ~${expected.toFixed(4)}, got ${actual.toFixed(4)}, diff ${diff.toFixed(6)})`);
}

console.log('====================================================');
console.log('ERLANGLY CORE MATH VERIFICATION (js/erlang.js)');
console.log('====================================================\n');

// 1. Traffic Intensity
console.log('[1] Traffic Intensity (Erlangs)');
const A1 = Erlangly.trafficIntensity(300, 180, 1800); // 300 calls * 180s / 1800s = 30.0 Erlangs
assert(A1 === 30.0, `300 calls, 180s AHT, 1800s interval = 30 Erlangs`);
assert(Erlangly.trafficIntensity(0, 180, 1800) === 0, `Zero volume gives 0 Erlangs`);
assert(Erlangly.trafficIntensity(300, 0, 1800) === 0, `Zero AHT gives 0 Erlangs`);
assert(Erlangly.trafficIntensity(-10, 180, 1800) === 0, `Negative volume gives 0 Erlangs`);

// 2. Reference Point: 100 Erlangs with 110 Servers
console.log('\n[2] Reference Point: 100 Erlangs, 110 Servers, 180s AHT, 20s SLA');
const A_ref = 100;
const m_ref = 110;
const aht_ref = 180;
const targetT_ref = 20;

const b_ref = Erlangly.erlangB(A_ref, m_ref);
assertClose(b_ref, 0.02746, 0.001, 'Erlang B loss probability ~ 0.0275');

const pw_ref = Erlangly.erlangC(A_ref, m_ref);
assertClose(pw_ref, 0.2370, 0.001, 'Erlang C wait probability ~ 0.2370');

const sl_ref = Erlangly.serviceLevel(A_ref, m_ref, aht_ref, targetT_ref);
assertClose(sl_ref, 0.9220, 0.001, 'Service level at 20s ~ 92.2%');

const asa_ref = Erlangly.averageSpeedOfAnswer(A_ref, m_ref, aht_ref);
assertClose(asa_ref, 4.266, 0.01, 'ASA ~ 4.27 seconds');

const occ_ref = Erlangly.occupancy(A_ref, m_ref);
assertClose(occ_ref, 100 / 110, 0.0001, 'Occupancy = 100/110 = 90.91%');

// 3. Monotonicity Checks
console.log('\n[3] Monotonicity Checks (Adding servers improves metrics)');
const traffic_mono = 50; // 50 Erlangs
const aht_mono = 240;
let lastSL = -1;
let lastASA = 999999;
let lastOcc = 999999;
let monotonic = true;

for (let s = 52; s <= 70; s++) {
  const currentSL = Erlangly.serviceLevel(traffic_mono, s, aht_mono, 20);
  const currentASA = Erlangly.averageSpeedOfAnswer(traffic_mono, s, aht_mono);
  const currentOcc = Erlangly.occupancy(traffic_mono, s);

  if (currentSL <= lastSL || currentASA >= lastASA || currentOcc >= lastOcc) {
    monotonic = false;
    console.error(`Monotonicity violation at servers=${s}: SL=${currentSL} vs ${lastSL}, ASA=${currentASA} vs ${lastASA}`);
  }
  lastSL = currentSL;
  lastASA = currentASA;
  lastOcc = currentOcc;
}
assert(monotonic, 'Service level strictly increases, ASA strictly decreases, and Occupancy strictly decreases as servers increase');

// 4. Boundary & Overload (Unstable Queue) Checks
console.log('\n[4] Boundary & Overload States (m <= A)');
assert(Erlangly.erlangC(50, 50) === 1.0, 'Erlang C returns 1.0 when servers equal traffic (unstable)');
assert(Erlangly.erlangC(50, 45) === 1.0, 'Erlang C returns 1.0 when servers < traffic (unstable)');
assert(Erlangly.serviceLevel(50, 50, 180, 20) === 0.0, 'Service level returns 0.0 when servers <= traffic');
assert(Erlangly.averageSpeedOfAnswer(50, 50, 180) === Infinity, 'ASA returns Infinity when servers <= traffic');

// 5. Shrinkage Calculations
console.log('\n[5] Shrinkage Calculations');
assert(Erlangly.shrinkageAdjust(10, 0.0) === 10, '0% shrinkage leaves headcount unchanged');
assertClose(Erlangly.shrinkageAdjust(10, 0.30), 14.2857, 0.001, '10 base agents with 30% shrinkage = 14.2857 gross');
assert(Erlangly.shrinkageAdjust(10, 1.0) === Infinity, '100% shrinkage returns Infinity safely');
assert(Erlangly.shrinkageAdjust(0, 0.30) === 0, '0 base agents returns 0 gross');

// 6. Headcount Requirement Solver (agentsRequired)
console.log('\n[6] agentsRequired Solver');
const solveZero = Erlangly.agentsRequired({ volume: 0, aht: 180 });
assert(solveZero.baseAgents === 0 && solveZero.staffedAgents === 0 && solveZero.isZeroVolume === true, 'Zero volume returns 0 base and staffed agents gracefully');

const solveNormal = Erlangly.agentsRequired({
  volume: 300,
  aht: 180,
  intervalSeconds: 1800,
  targetServiceLevel: 0.80,
  targetTimeSeconds: 20,
  maxOccupancy: 0.85,
  shrinkage: 0.30
});

assert(solveNormal.trafficIntensity === 30.0, 'Solver computed 30.0 Erlangs');
assert(solveNormal.baseAgents > 30, `Solver found base agents > 30 (found: ${solveNormal.baseAgents})`);
assert(solveNormal.serviceLevel >= 0.80, `Projected SL >= 80% (got: ${(solveNormal.serviceLevel * 100).toFixed(1)}%)`);
assert(solveNormal.occupancy <= 0.85, `Projected Occupancy <= 85% (got: ${(solveNormal.occupancy * 100).toFixed(1)}%)`);
assert(solveNormal.staffedAgents === Math.ceil(solveNormal.baseAgents / 0.70), `Staffed agents correctly applies 30% shrinkage with Math.ceil (base: ${solveNormal.baseAgents} -> staffed: ${solveNormal.staffedAgents})`);

// 8. Multi-Skill & Blended Queue Modeling
console.log('\n[8] Multi-Skill & Blended Queue Pooling (Erlang Efficiency)');
const queues = [
  { name: 'English Tier 1', volume: 150, aht: 180 },  // 15 Erlangs
  { name: 'Spanish Support', volume: 80, aht: 220 },   // 9.77 Erlangs
  { name: 'VIP Priority', volume: 40, aht: 260 }       // 5.77 Erlangs
];

const blended = Erlangly.blendedWorkload(queues, 1800);
assert(blended.totalVolume === 270, 'Blended total volume is 270 calls');
assertClose(blended.totalErlangs, 30.555, 0.01, 'Blended total Erlangs ~ 30.56');
assertClose(blended.weightedAHT, 203.70, 0.05, 'Weighted composite AHT ~ 203.7s');

const pooling = Erlangly.multiSkillPoolingEfficiency(queues, 0.80, 20, 1800);
assert(pooling.dedicatedAgents > pooling.pooledAgents, `Pooling creates headcount savings (Dedicated: ${pooling.dedicatedAgents}, Pooled: ${pooling.pooledAgents})`);
assert(pooling.headcountSaved >= 2, `Headcount saved >= 2 agents (saved: ${pooling.headcountSaved} agents, ${pooling.percentEfficiencyGain.toFixed(1)}% gain)`);

// 9. Multi-Period Staffing Simulation (Daily, Weekly, Monthly)
console.log('\n[9] Multi-Period Staffing Simulation (Daily, Weekly, Monthly)');

// Daily simulation test
const dailySim = Erlangly.simulateDailyProfile({
  dailyVolume: 5000,
  aht: 180,
  operatingHours: 12,
  intervalMinutes: 30,
  distribution: 'diurnal',
  targetServiceLevel: 0.80,
  targetTimeSeconds: 20,
  shrinkage: 0.30,
  workWeekHours: 40.0,
  hourlyWage: 25.0
});

assert(dailySim.intervals.length === 24, 'Daily simulation generates 24 intervals for 12h @ 30min');
assert(dailySim.peakStaffedAgents > 0, `Daily peak staffed agents > 0 (found: ${dailySim.peakStaffedAgents})`);
assert(dailySim.totalGrossStaffHours > dailySim.totalNetStaffHours, 'Gross staff hours exceed net hours due to shrinkage');
assert(dailySim.staffedFTE > dailySim.baseFTE, 'Staffed FTE exceeds base FTE');
assert(dailySim.averageServiceLevel >= 0.80, `Daily average service level meets target (got: ${(dailySim.averageServiceLevel * 100).toFixed(1)}%)`);
assert(dailySim.laborCost > 0, `Daily labor cost calculated ($${dailySim.laborCost.toFixed(2)})`);

// Weekly simulation test
const weeklySim = Erlangly.simulateWeeklyProfile({
  weeklyVolume: 35000,
  aht: 180,
  weeks: 12,
  growthRatePct: 2.0,
  operatingDays: 7,
  operatingHours: 12,
  shrinkage: 0.30,
  workWeekHours: 40.0,
  hourlyWage: 25.0
});

assert(weeklySim.weeks.length === 12, 'Weekly simulation generates 12 weeks');
assert(weeklySim.weeks[11].volume > weeklySim.weeks[0].volume, 'Weekly volume increases under positive growth rate');
assert(weeklySim.weeks[11].staffedFTE > weeklySim.weeks[0].staffedFTE, 'Staffed FTE scales with growing weekly volume');
assert(weeklySim.totalLaborCost > 0, `Total 12-week labor cost calculated ($${weeklySim.totalLaborCost.toLocaleString()})`);

// Monthly simulation test
const monthlySim = Erlangly.simulateMonthlyProfile({
  monthlyVolume: 150000,
  aht: 180,
  months: 12,
  growthRatePct: 1.0,
  shrinkage: 0.30,
  workWeekHours: 40.0,
  hourlyWage: 25.0
});

assert(monthlySim.months.length === 12, 'Monthly simulation generates 12 months');
assert(monthlySim.months[0].workingDays > 15, 'Calendar working days assigned per month');
assert(monthlySim.months[0].staffedFTE > 0, `Month 1 staffed FTE > 0 (got: ${monthlySim.months[0].staffedFTE.toFixed(1)})`);
assert(monthlySim.totalVolume > 1500000, `Total 12-month volume aggregated correctly (${monthlySim.totalVolume.toLocaleString()})`);
assert(monthlySim.totalLaborCost > 0, `Total annual labor budget calculated ($${monthlySim.totalLaborCost.toLocaleString()})`);

// 10. Date Parsing, Chronological Ordering & Forecast Progression
console.log('\n[10] Date Parsing, Chronological Ordering & Forecast Progression');
const ErlanglyUtils = require('../js/main.js');

// 10a. Date Parsing Across Formats
const d1 = ErlanglyUtils.parseDate('2026-08-01');
assert(d1 && d1.isoDate === '2026-08-01' && d1.dayOfWeek === 6, 'Parses ISO date 2026-08-01 (Saturday)');

const d2 = ErlanglyUtils.parseDate('8/1/2026');
assert(d2 && d2.isoDate === '2026-08-01' && d2.month === 8 && d2.day === 1, 'Parses US slash date 8/1/2026 into 2026-08-01');

const d3 = ErlanglyUtils.parseDate('10/31/2026');
assert(d3 && d3.isoDate === '2026-10-31' && d3.month === 10 && d3.day === 31, 'Parses US slash date 10/31/2026 into 2026-10-31');

const d4 = ErlanglyUtils.parseDate('8/1/26');
assert(d4 && d4.isoDate === '2026-08-01', 'Parses 2-digit year 8/1/26 into 2026-08-01');

const d5 = ErlanglyUtils.parseDate('08/01/2026 09:30:00');
assert(d5 && d5.isoDate === '2026-08-01', 'Parses date with timestamp 08/01/2026 09:30:00');

const dNon = ErlanglyUtils.parseDate('Period 1');
assert(dNon === null, 'Non-date string returns null safely');

// 10b. Chronological Multi-Month Ordering (Fixes 10/1 before 8/1 bug)
const rawDates = ['10/1/2026', '8/1/2026', '9/1/2026', '10/31/2026', '8/15/2026'];
const sortedDates = rawDates.slice().sort((a, b) => {
  const infoA = ErlanglyUtils.parseDate(a);
  const infoB = ErlanglyUtils.parseDate(b);
  if (infoA && infoB) return infoA.timestamp - infoB.timestamp;
  return 0;
}).map(d => ErlanglyUtils.parseDate(d).isoDate);

assert(sortedDates[0] === '2026-08-01', `First date is Aug 1 (got: ${sortedDates[0]})`);
assert(sortedDates[1] === '2026-08-15', `Second date is Aug 15 (got: ${sortedDates[1]})`);
assert(sortedDates[2] === '2026-09-01', `Third date is Sep 1 (got: ${sortedDates[2]})`);
assert(sortedDates[3] === '2026-10-01', `Fourth date is Oct 1 (got: ${sortedDates[3]})`);
assert(sortedDates[4] === '2026-10-31', `Fifth date is Oct 31 (got: ${sortedDates[4]})`);
assert(sortedDates.indexOf('2026-08-01') < sortedDates.indexOf('2026-10-01'), 'Aug 1 is strictly sorted BEFORE Oct 1');

// 10c. Future Date Progression
const nextDayAfterOct31 = ErlanglyUtils.addDays('10/31/2026', 1);
assert(nextDayAfterOct31 && nextDayAfterOct31.isoDate === '2026-11-01', 'Oct 31 + 1 day correctly advances to Nov 1 (2026-11-01)');

const future8Days = [];
for (let h = 1; h <= 8; h++) {
  future8Days.push(ErlanglyUtils.addDays('10/31/2026', h).isoDate);
}
assert(future8Days[0] === '2026-11-01' && future8Days[7] === '2026-11-08', '8-day forecast horizon from 10/31 spans 2026-11-01 to 2026-11-08');

// 10d. Leap Year Date Progression
const leapNext = ErlanglyUtils.addDays('2024-02-28', 1);
assert(leapNext && leapNext.isoDate === '2024-02-29', 'Leap year 2024-02-28 + 1 day advances to 2024-02-29');
const leapNext2 = ErlanglyUtils.addDays('2024-02-29', 1);
assert(leapNext2 && leapNext2.isoDate === '2024-03-01', 'Leap year 2024-02-29 + 1 day advances to 2024-03-01');

// 11. Phase 8 — Advanced Forecasting Models & Pluggable Architecture
console.log('\n[11] Phase 8 — Advanced Forecasting Models & Algorithms');
const ErlanglyForecast = require('../js/forecasting.js');

// 11a. Model Registry Verification
const registeredModels = Object.keys(ErlanglyForecast.models);
assert(registeredModels.includes('wma'), 'WMA model registered');
assert(registeredModels.includes('sma'), 'SMA model registered');
assert(registeredModels.includes('trend'), 'Linear Trend model registered');
assert(registeredModels.includes('decomp_mult'), 'Multiplicative Decomposition model registered');
assert(registeredModels.includes('decomp_add'), 'Additive Decomposition model registered');
assert(registeredModels.includes('ses'), 'Simple Exponential Smoothing model registered');
assert(registeredModels.includes('holt'), "Holt's Double Exponential Smoothing model registered");
assert(registeredModels.includes('regression'), 'Multi-variable Regression model registered');
assert(registeredModels.length >= 8, `At least 8 forecasting models registered (found: ${registeredModels.length})`);

// 11b. Test Fit Metrics Calculation
const actuals = [100, 150, 200, 250];
const fitted = [110, 140, 210, 240];
const metrics = ErlanglyForecast.calculateFitMetrics(actuals, fitted);
assert(metrics.mae === 10, `MAE is 10 (got: ${metrics.mae})`);
assertClose(metrics.rmse, 10, 0.001, 'RMSE is 10');
assert(metrics.mse === 100, 'MSE is 100');
assert(metrics.r2 > 90, `R2 fit is high (>90%, got: ${metrics.r2.toFixed(1)}%)`);

// 11c. Seasonal Decomposition (Multiplicative & Additive)
const sampleHistory = ErlanglyForecast.SAMPLE_HISTORY;
const multDecompRes = ErlanglyForecast.executeForecast(sampleHistory, 'decomp_mult', { seasonLength: 7 }, { horizon: 7 });
assert(multDecompRes.forecast.length === 7, 'Multiplicative decomposition produces 7 horizon periods');
assert(multDecompRes.metrics.mape < 25, `Multiplicative decomposition fit MAPE is good (<25%, got: ${multDecompRes.metrics.mape.toFixed(1)}%)`);
assert(multDecompRes.fitResult.seasonalIndices.length === 7, 'Computed 7-day seasonal indices');

const addDecompRes = ErlanglyForecast.executeForecast(sampleHistory, 'decomp_add', { seasonLength: 7 }, { horizon: 7 });
assert(addDecompRes.forecast.length === 7, 'Additive decomposition produces 7 horizon periods');
assert(addDecompRes.fitResult.seasonalOffsets.length === 7, 'Computed 7-day seasonal offsets');
const sumOffsets = addDecompRes.fitResult.seasonalOffsets.reduce((a, b) => a + b, 0);
assertClose(sumOffsets, 0, 0.01, 'Additive seasonal offsets sum to 0');

// 11d. Exponential Smoothing: SES and Holt's Double
const sesRes = ErlanglyForecast.executeForecast(sampleHistory, 'ses', { alpha: 0.25, autoOptimize: false }, { horizon: 5 });
assert(sesRes.forecast.length === 5, 'SES produces 5 horizon periods');
assert(sesRes.forecast[0].volume === sesRes.forecast[4].volume, 'SES produces flat future projection');

const sesAuto = ErlanglyForecast.executeForecast(sampleHistory, 'ses', { autoOptimize: true }, { horizon: 5 });
assert(sesAuto.fitResult.alpha > 0 && sesAuto.fitResult.alpha < 1, `SES auto-optimized alpha to valid range (${sesAuto.fitResult.alpha})`);

const holtRes = ErlanglyForecast.executeForecast(sampleHistory, 'holt', { alpha: 0.3, beta: 0.1, autoOptimize: false }, { horizon: 5 });
assert(holtRes.forecast.length === 5, "Holt's smoothing produces 5 horizon periods");
assert(holtRes.fitResult.level > 0, "Holt's calculated positive level");

const holtAuto = ErlanglyForecast.executeForecast(sampleHistory, 'holt', { autoOptimize: true }, { horizon: 5 });
assert(holtAuto.fitResult.alpha > 0 && holtAuto.fitResult.beta >= 0, `Holt's auto-optimized (alpha=${holtAuto.fitResult.alpha}, beta=${holtAuto.fitResult.beta})`);

// 11e. Multi-Variable Regression (with Day-of-Week Dummies)
const regRes = ErlanglyForecast.executeForecast(sampleHistory, 'regression', { includeDummies: true }, { horizon: 7 });
assert(regRes.forecast.length === 7, 'Regression produces 7 horizon predictions');
assert(regRes.fitResult.coeffs.length === 8, 'Regression estimated 8 coefficients (intercept, slope, 6 day dummies)');
assert(regRes.metrics.mape < 25, `Regression with day dummies achieves low MAPE (${regRes.metrics.mape.toFixed(1)}%)`);

// 11f. Holiday & Event Flag System
const holidayOptions = {
  horizon: 7,
  holidays: [
    { date: '2026-05-29', name: 'Product Launch Spike', impactPct: 50, action: 'scale' },
    { date: '2026-05-04', name: 'Past Outage', impactPct: 0, action: 'exclude' }
  ]
};

const holidayRes = ErlanglyForecast.executeForecast(sampleHistory, 'trend', {}, holidayOptions);
const futureLaunchDay = holidayRes.forecast.find(f => f.period === '2026-05-29');
assert(futureLaunchDay && futureLaunchDay.holidayFactor === 1.50, 'Future holiday applies 1.5x multiplicative scaling (+50%)');
assert(futureLaunchDay.holidayName === 'Product Launch Spike', 'Future holiday tags event name');

// 11g. Edge Cases & Robustness
const emptyRes = ErlanglyForecast.executeForecast([], 'holt', {}, { horizon: 5 });
assert(emptyRes.forecast.length === 0 && emptyRes.metrics.mae === 0, 'Empty history handled gracefully with 0 forecasts');

const singleRowRes = ErlanglyForecast.executeForecast([{ period: '2026-06-01', volume: 500 }], 'wma', {}, { horizon: 3 });
assert(singleRowRes.forecast.length === 3, 'Single row history produces valid forecasts without throwing');

// ============================================================
// [12] Phase 8b — User-Defined Trend Profiles
// ============================================================
console.log('\n[12] Phase 8b — User-Defined Trend Profiles');

// Trend profile registry exists
assert(ErlanglyForecast.trendProfiles !== undefined, 'Trend profiles registry is exported');
assert(Object.keys(ErlanglyForecast.trendProfiles).length >= 6, 'At least 6 trend profiles registered (found: ' + Object.keys(ErlanglyForecast.trendProfiles).length + ')');

// getTrendProfileFactor function exists
assert(typeof ErlanglyForecast.getTrendProfileFactor === 'function', 'getTrendProfileFactor is a function');

// Profile 'none' always returns 1.0
const noneF = ErlanglyForecast.getTrendProfileFactor('none', {}, '2026-06-05');
assert(noneF === 1.0, 'Profile "none" returns 1.0 (got: ' + noneF + ')');

// Billing cycle: day 5 (early month) should be > 1.0
const billingEarly = ErlanglyForecast.getTrendProfileFactor('billing_cycle', {}, '2026-06-05');
assert(billingEarly > 1.0, 'Billing cycle: day 5 factor > 1.0 (got: ' + billingEarly.toFixed(3) + ')');

// Billing cycle: day 25 (late month) should be < 1.0
const billingLate = ErlanglyForecast.getTrendProfileFactor('billing_cycle', {}, '2026-06-25');
assert(billingLate < 1.0, 'Billing cycle: day 25 factor < 1.0 (got: ' + billingLate.toFixed(3) + ')');

// Billing cycle: exact factor for days 1-7 at 100% intensity = 1.20
assert(Math.abs(billingEarly - 1.20) < 0.001, 'Billing cycle: day 5 = 1.20 at 100% intensity (got: ' + billingEarly.toFixed(3) + ')');

// Billing cycle: exact factor for days 24-31 at 100% intensity = 0.80
assert(Math.abs(billingLate - 0.80) < 0.001, 'Billing cycle: day 25 = 0.80 at 100% intensity (got: ' + billingLate.toFixed(3) + ')');

// Week-of-month: week 1 vs week 4
const wom1 = ErlanglyForecast.getTrendProfileFactor('week_of_month', {}, '2026-06-03');
const wom4 = ErlanglyForecast.getTrendProfileFactor('week_of_month', {}, '2026-06-28');
assert(wom1 > wom4, 'Week-of-month: Week 1 factor (' + wom1.toFixed(2) + ') > Week 4 factor (' + wom4.toFixed(2) + ')');

// Intensity at 0% should return 1.0 (no effect)
const zeroIntensity = ErlanglyForecast.getTrendProfileFactor('billing_cycle', { intensity: 0 }, '2026-06-05');
assert(zeroIntensity === 1.0, 'Intensity 0% returns exactly 1.0 (got: ' + zeroIntensity + ')');

// Intensity at 50% should halve the deviation
const halfIntensity = ErlanglyForecast.getTrendProfileFactor('billing_cycle', { intensity: 50 }, '2026-06-05');
const expectedHalf = 1.0 + (0.20 * 0.5); // 1.10
assert(Math.abs(halfIntensity - expectedHalf) < 0.001, 'Intensity 50%: +20% becomes +10% (expected ' + expectedHalf + ', got: ' + halfIntensity.toFixed(3) + ')');

// Intensity at 200% should double the deviation
const doubleIntensity = ErlanglyForecast.getTrendProfileFactor('billing_cycle', { intensity: 200 }, '2026-06-05');
const expectedDouble = 1.0 + (0.20 * 2.0); // 1.40
assert(Math.abs(doubleIntensity - expectedDouble) < 0.001, 'Intensity 200%: +20% becomes +40% (expected ' + expectedDouble + ', got: ' + doubleIntensity.toFixed(3) + ')');

// Custom profile with user-defined ranges
const customRanges = [
  { startDay: 1, endDay: 15, factor: 1.30, label: 'High' },
  { startDay: 16, endDay: 31, factor: 0.70, label: 'Low' }
];
const customHigh = ErlanglyForecast.getTrendProfileFactor('custom', { customRanges: customRanges }, '2026-06-10');
assert(Math.abs(customHigh - 1.30) < 0.001, 'Custom profile: day 10 maps to factor 1.30 (got: ' + customHigh.toFixed(3) + ')');
const customLow = ErlanglyForecast.getTrendProfileFactor('custom', { customRanges: customRanges }, '2026-06-20');
assert(Math.abs(customLow - 0.70) < 0.001, 'Custom profile: day 20 maps to factor 0.70 (got: ' + customLow.toFixed(3) + ')');

// Quarter-end: only applies in quarter-end months (3, 6, 9, 12)
const qeJune = ErlanglyForecast.getTrendProfileFactor('quarter_end', {}, '2026-06-28');
assert(qeJune > 1.0, 'Quarter-end: June 28 (quarter-end month) factor > 1.0 (got: ' + qeJune.toFixed(3) + ')');
const qeJuly = ErlanglyForecast.getTrendProfileFactor('quarter_end', {}, '2026-07-28');
assert(qeJuly === 1.0, 'Quarter-end: July 28 (non quarter-end month) factor = 1.0 (got: ' + qeJuly + ')');

// Non-date string returns 1.0
const nonDate = ErlanglyForecast.getTrendProfileFactor('billing_cycle', {}, 'Future 5');
assert(nonDate === 1.0, 'Non-date string returns 1.0 (got: ' + nonDate + ')');

// Pipeline integration: forecast with billing_cycle profile should differ from 'none'
const histForTP = [
  { period: '2026-05-25', volume: 2000 },
  { period: '2026-05-26', volume: 1800 },
  { period: '2026-05-27', volume: 1900 },
  { period: '2026-05-28', volume: 1850 }
];
const noProfileRes = ErlanglyForecast.executeForecast(histForTP, 'sma', { windowSize: 4 }, { horizon: 8, trendProfile: 'none' });
const withProfileRes = ErlanglyForecast.executeForecast(histForTP, 'sma', { windowSize: 4 }, { horizon: 8, trendProfile: 'billing_cycle' });

// The forecast with profile should have different volumes
let volumesDiffer = false;
for (let i = 0; i < noProfileRes.forecast.length; i++) {
  if (noProfileRes.forecast[i].volume !== withProfileRes.forecast[i].volume) {
    volumesDiffer = true;
    break;
  }
}
assert(volumesDiffer, 'Pipeline: billing_cycle profile produces different volumes than no profile');

// trendProfileFactor should be present in result
assert(withProfileRes.forecast[0].trendProfileFactor !== undefined, 'Pipeline: trendProfileFactor is present in forecast results');
assert(withProfileRes.forecast[0].trendProfileFactor !== 1.0, 'Pipeline: trendProfileFactor is not 1.0 when profile is active');

// ============================================================
// [13] Phase 12 — Forecasting Enhancements II
// ============================================================
console.log('\n[13] Phase 12 — Forecasting Enhancements II (YoY, Backtesting, Accuracy Tracking, Ensemble)');

// 13a. Model Registry Verification (10 Models Total)
const all10Models = Object.keys(ErlanglyForecast.models);
assert(all10Models.includes('yoy_trend'), 'YoY Seasonal Trend model registered');
assert(all10Models.includes('ensemble'), 'Ensemble / Blended Forecast model registered');
assert(all10Models.length === 10, `All 10 forecasting models registered (found: ${all10Models.length})`);

// 13b. Forecast Accuracy Tracking Calculations (WAPE, MAPE, Signed Bias, MAE, RMSE, Tracking Signal)
const sampleActuals = [1000, 1200, 800, 1500, 2000];
const sampleForecasts = [1100, 1150, 850, 1600, 1900]; // Errors: +100, -50, +50, +100, -100 (Sum Abs = 400, Sum Signed = +100)
// Total Actual = 6500. Total Forecast = 6600.
// WAPE = 400 / 6500 * 100 = 6.1538%
// Bias % = +100 / 6500 * 100 = +1.5385%
// MAE = 400 / 5 = 80
const accMetrics = ErlanglyForecast.calculateAccuracyMetrics(sampleActuals, sampleForecasts);
assert(accMetrics.count === 5, 'Accuracy evaluation count is 5');
assert(accMetrics.mae === 80, `MAE is 80 (got: ${accMetrics.mae})`);
assertClose(accMetrics.wape, (400 / 6500) * 100, 0.01, 'WAPE ~ 6.15%');
assertClose(accMetrics.biasPct, (100 / 6500) * 100, 0.01, 'Signed Bias ~ +1.54% (over-forecast)');
assert(accMetrics.varianceTotal === 100, 'Total volume variance is +100 calls');
assert(accMetrics.details.length === 5, 'Detailed per-interval breakdown generated');

// 13c. Year-over-Year (YoY) Seasonal Trend Projection Model
// 1. Guard check on short history (< 12 months)
const shortHistory = ErlanglyForecast.SAMPLE_HISTORY; // 28 days
const yoyShortCheck = ErlanglyForecast.checkHistorySufficiency(shortHistory, 52);
assert(!yoyShortCheck.sufficient, 'History sufficiency check detects < 12 months for 28-day dataset');
const yoyShortRes = ErlanglyForecast.executeForecast(shortHistory, 'yoy_trend', {}, { horizon: 7 });
assert(yoyShortRes.fitResult.insufficientHistory === true, 'YoY model flags insufficient history on short dataset');
assert(yoyShortRes.forecast.length === 7, 'YoY model gracefully degrades to trend fallback on short dataset');

// 2. Full 2-Year Multi-Year History (730 days)
const multiYearHistory = ErlanglyForecast.SAMPLE_MULTI_YEAR_HISTORY;
assert(multiYearHistory.length === 730, `2-Year synthetic dataset generated with 730 periods (found: ${multiYearHistory.length})`);
const yoyLongCheck = ErlanglyForecast.checkHistorySufficiency(multiYearHistory, 52);
assert(yoyLongCheck.sufficient, 'History sufficiency check passes for 730-day dataset (≥ 12 months)');

const yoyFullRes = ErlanglyForecast.executeForecast(multiYearHistory, 'yoy_trend', { lookbackWeeks: 8 }, { horizon: 14 });
assert(yoyFullRes.forecast.length === 14, 'YoY model generates 14 future period projections on 2-year dataset');
assert(yoyFullRes.fitResult.insufficientHistory === false, 'YoY model successfully fits full seasonal trend without fallback');
assert(yoyFullRes.fitResult.yoyGrowthRate !== undefined, `YoY trailing growth rate computed (${(yoyFullRes.fitResult.yoyGrowthRate * 100).toFixed(1)}%)`);
assert(yoyFullRes.metrics.mape < 25, `YoY model achieves high fit quality on multi-year dataset (MAPE: ${yoyFullRes.metrics.mape.toFixed(1)}%)`);

// 13d. Walk-Forward Out-of-Sample Backtesting
const backtestHoldout = 7;
const holtBacktest = ErlanglyForecast.backtestModel(multiYearHistory, 'holt', {}, backtestHoldout, {});
assert(holtBacktest.holdoutCount === 7, 'Backtest held out exactly 7 periods');
assert(holtBacktest.trainCount === 730 - 7, `Backtest trained on remaining ${730 - 7} periods`);
assert(holtBacktest.outOfSampleMetrics.count === 7, 'Out-of-sample metrics evaluated across 7 holdout periods');
assert(holtBacktest.outOfSampleMetrics.mae > 0, `Out-of-sample MAE computed (${holtBacktest.outOfSampleMetrics.mae.toFixed(1)})`);
assert(holtBacktest.outOfSampleMetrics.wape > 0, `Out-of-sample WAPE computed (${holtBacktest.outOfSampleMetrics.wape.toFixed(1)}%)`);
assert(holtBacktest.outOfSampleMetrics.rmse > 0, `Out-of-sample RMSE computed (${holtBacktest.outOfSampleMetrics.rmse.toFixed(1)})`);
assert(typeof holtBacktest.overfitGap === 'number', `Overfit gap calculated (${holtBacktest.overfitGap.toFixed(1)}%)`);

const allBacktests = ErlanglyForecast.runBacktestAll(multiYearHistory, ['holt', 'decomp_mult', 'trend', 'yoy_trend'], {}, 7, {});
assert(allBacktests.length === 4, 'Ran walk-forward backtest across all 4 candidate models');
assert(allBacktests[0].outOfSampleMetrics.mape <= allBacktests[allBacktests.length - 1].outOfSampleMetrics.mape, 'Candidate models ranked by Out-of-Sample MAPE (ascending)');

// 13e. Ensemble / Blended Forecast Model
// 1. Auto-weighting strategy
const ensembleAutoRes = ErlanglyForecast.executeForecast(multiYearHistory, 'ensemble', {
  weightMode: 'auto',
  selectedModels: ['holt', 'decomp_mult', 'trend']
}, { horizon: 8 });

assert(ensembleAutoRes.forecast.length === 8, 'Ensemble model produces 8 projected periods');
assert(ensembleAutoRes.fitResult.weights !== undefined, 'Ensemble weights computed');
const autoWeightsSum = Object.values(ensembleAutoRes.fitResult.weights).reduce((a, b) => a + b, 0);
assertClose(autoWeightsSum, 1.0, 0.001, 'Auto ensemble weights sum to 1.0 (100%)');
assert(ensembleAutoRes.metrics.mape < 25, `Ensemble blended model achieves good in-sample MAPE (${ensembleAutoRes.metrics.mape.toFixed(1)}%)`);

// 2. Manual weighting strategy
const manualWeights = { holt: 50, decomp_mult: 30, trend: 20 };
const ensembleManualRes = ErlanglyForecast.executeForecast(multiYearHistory, 'ensemble', {
  weightMode: 'manual',
  selectedModels: ['holt', 'decomp_mult', 'trend'],
  manualWeights: manualWeights
}, { horizon: 8 });

assertClose(ensembleManualRes.fitResult.weights.holt, 0.50, 0.001, 'Manual weight for Holt normalized to 0.50');
assertClose(ensembleManualRes.fitResult.weights.decomp_mult, 0.30, 0.001, 'Manual weight for Decomp normalized to 0.30');
assertClose(ensembleManualRes.fitResult.weights.trend, 0.20, 0.001, 'Manual weight for Trend normalized to 0.20');

// 13f. Accuracy Tracking Edge Cases
const emptyAccuracy = ErlanglyForecast.calculateAccuracyMetrics([], []);
assert(emptyAccuracy.count === 0 && emptyAccuracy.wape === 0 && emptyAccuracy.biasPct === 0, 'Empty accuracy pairs handled gracefully with 0 metrics');

console.log('\n[14] Post-v2 Enhancement — Separate Forecast & Actuals Uploader & History Merge');

// 14a. Matching uploaded actuals against a locked baseline forecast
const sampleBaselineForecast = [
  { period: '2026-06-01', volume: 1500 },
  { period: '2026-06-02', volume: 1620 },
  { period: '2026-06-03', volume: 1480 }
];
const uploadedActuals = [
  { period: '2026-06-01', actual: 1520 },
  { period: '2026-06-02', actual: 1600 },
  { period: '2026-06-03', actual: 1510 }
];

const forecastMap = {};
sampleBaselineForecast.forEach(f => { forecastMap[f.period.toLowerCase()] = f.volume; });

const matchedPairs = uploadedActuals.map(act => ({
  period: act.period,
  forecast: forecastMap[act.period.toLowerCase()] || 0,
  actual: act.actual
}));

assert(matchedPairs.length === 3, 'Matched all 3 actual rows to baseline forecast');
assert(matchedPairs[0].forecast === 1500 && matchedPairs[0].actual === 1520, 'First matched pair correctly paired forecast (1500) and actual (1520)');
assert(matchedPairs[1].forecast === 1620 && matchedPairs[1].actual === 1600, 'Second matched pair correctly paired forecast (1620) and actual (1600)');

const matchAccuracy = ErlanglyForecast.calculateAccuracyMetrics(
  matchedPairs.map(p => p.actual),
  matchedPairs.map(p => p.forecast)
);
assert(matchAccuracy.count === 3, 'Evaluated accuracy across 3 matched periods');
assert(matchAccuracy.wape > 0 && matchAccuracy.wape < 5, `WAPE is low on close actuals (${matchAccuracy.wape.toFixed(2)}%)`);

// 14b. History Merging & Deduplication
const initialTrainingHistory = [
  { period: '2026-05-30', volume: 1400 },
  { period: '2026-05-31', volume: 1450 }
];
const historyMap = {};
initialTrainingHistory.forEach(h => { historyMap[h.period.toLowerCase()] = h; });

let updatedCount = 0;
let appendedCount = 0;

matchedPairs.forEach(pair => {
  const key = pair.period.toLowerCase();
  if (historyMap[key]) {
    historyMap[key].volume = pair.actual;
    updatedCount++;
  } else {
    const entry = { period: pair.period, volume: pair.actual };
    initialTrainingHistory.push(entry);
    historyMap[key] = entry;
    appendedCount++;
  }
});

assert(appendedCount === 3, 'Appended 3 new periods to historical training series');
assert(updatedCount === 0, 'No overlapping periods updated');
assert(initialTrainingHistory.length === 5, 'Total training history expanded from 2 to 5 periods');
assert(initialTrainingHistory[2].period === '2026-06-01' && initialTrainingHistory[2].volume === 1520, 'First merged period verified');
assert(initialTrainingHistory[4].period === '2026-06-03' && initialTrainingHistory[4].volume === 1510, 'Last merged period verified');

// Test overlapping update
const overlappingActuals = [{ period: '2026-06-01', actual: 1530 }];
overlappingActuals.forEach(pair => {
  const key = pair.period.toLowerCase();
  if (historyMap[key]) {
    historyMap[key].volume = pair.actual;
    updatedCount++;
  }
});
assert(updatedCount === 1, 'Correctly updated existing period on overlapping merge');
assert(historyMap['2026-06-01'].volume === 1530, 'Volume updated to 1530 without duplicating row');

// =========================================================================
// [15] Phase 13 — Forecast Holdout Sandbox (Strict Backtesting & Consistency)
// =========================================================================
console.log('\n[15] Phase 13 — Forecast Holdout Sandbox (Strict Backtesting & Consistency)');

const sandboxMultiYearHistory = ErlanglyForecast.SAMPLE_MULTI_YEAR_HISTORY;
assert(sandboxMultiYearHistory && sandboxMultiYearHistory.length === 730, 'Multi-year history available for sandbox testing (730 periods)');

// 1. Test extractHistoryMonths
const months = ErlanglyForecast.extractHistoryMonths(sandboxMultiYearHistory);
assert(months && months.length === 24, `Extracted all 24 calendar months from 2-year history (found: ${months.length})`);
assert(months[0].key === '2024-06', `First month is 2024-06 (found: ${months[0].key})`);
assert(months[0].isEligible === false, 'First month is not eligible as holdout (no preceding training data)');
assert(months[0].precedingCount === 0, 'First month preceding count is 0');
assert(months[1].key === '2024-07', `Second month is 2024-07 (found: ${months[1].key})`);
assert(months[1].isEligible === true, 'Second month is eligible as holdout');
assert(months[1].precedingCount === 30, `Second month has 30 preceding days (found: ${months[1].precedingCount})`);
assert(months[23].key === '2026-05', `Last month is 2026-05 (found: ${months[23].key})`);
assert(months[23].precedingCount === 699, `Last month has 699 preceding days (found: ${months[23].precedingCount})`);

// 2. Test single month holdout sandbox with strict before-only training
const sandboxModels = ['holt', 'decomp_mult', 'trend', 'regression', 'yoy_trend', 'ensemble'];
const defaultParams = {
  windowSize: 6,
  seasonLength: 7,
  alpha: 0.30,
  beta: 0.10,
  autoOptimize: true,
  includeDummies: true,
  lookbackWeeks: 8,
  selectedModels: ['holt', 'decomp_mult', 'trend']
};

const singleHoldout = ErlanglyForecast.runHoldoutSandbox(sandboxMultiYearHistory, '2025-10', sandboxModels, defaultParams, 'all', {});
assert(singleHoldout.monthEvaluations.length === 1, 'Single month holdout returned 1 evaluation');
const octEval = singleHoldout.monthEvaluations[0];
assert(octEval.isFeasible === true, 'October 2025 holdout evaluation is feasible');
assert(octEval.holdoutPeriodsCount === 31, `October holdout slice contains 31 days (found: ${octEval.holdoutPeriodsCount})`);
assert(octEval.trainPeriodsCount === 487, `All-lookback training slice contains exactly 487 preceding days (found: ${octEval.trainPeriodsCount})`);
assert(octEval.models.length === 6, `Evaluated all 6 candidate models on October holdout (found: ${octEval.models.length})`);

// Check top model holdout metrics
const topModel = octEval.models[0];
assert(topModel.holdoutMetrics !== undefined, 'Top model has holdout metrics');
assert(topModel.holdoutMetrics.wape >= 0 && topModel.holdoutMetrics.wape < 100, `Top model achieved realistic holdout WAPE (${topModel.holdoutMetrics.wape.toFixed(1)}%)`);
assert(topModel.holdoutMetrics.mape >= 0, `Top model calculated holdout MAPE (${topModel.holdoutMetrics.mape.toFixed(1)}%)`);
assert(typeof topModel.holdoutMetrics.biasPct === 'number', `Top model calculated holdout signed bias (${topModel.holdoutMetrics.biasPct.toFixed(1)}%)`);
assert(topModel.holdoutMetrics.mae > 0, `Top model calculated holdout MAE (${topModel.holdoutMetrics.mae.toFixed(1)})`);
assert(topModel.holdoutMetrics.rmse > 0, `Top model calculated holdout RMSE (${topModel.holdoutMetrics.rmse.toFixed(1)})`);

// 3. Test lookback window filtering (e.g. 3 months lookback)
const lookback3Holdout = ErlanglyForecast.runHoldoutSandbox(sandboxMultiYearHistory, '2025-10', sandboxModels, defaultParams, 3, {});
assert(lookback3Holdout.monthEvaluations[0].isFeasible === true, '3-Month lookback holdout evaluation is feasible');
assert(lookback3Holdout.monthEvaluations[0].trainPeriodsCount === 92, `3-Month lookback restricts training slice to 92 preceding days (found: ${lookback3Holdout.monthEvaluations[0].trainPeriodsCount})`);

const lookback1Holdout = ErlanglyForecast.runHoldoutSandbox(sandboxMultiYearHistory, '2025-10', sandboxModels, defaultParams, 1, {});
assert(lookback1Holdout.monthEvaluations[0].isFeasible === true, '1-Month lookback holdout evaluation is feasible');
assert(lookback1Holdout.monthEvaluations[0].trainPeriodsCount === 30, `1-Month lookback restricts training slice to 30 preceding days (found: ${lookback1Holdout.monthEvaluations[0].trainPeriodsCount})`);

// 4. Test multi-month consistency matrix
const targetMonths = ['2025-08', '2025-09', '2025-10'];
const consistencyRes = ErlanglyForecast.evaluateSandboxConsistency(sandboxMultiYearHistory, targetMonths, sandboxModels, defaultParams, 'all', {});
assert(consistencyRes.monthEvaluations.length === 3, `Evaluated across 3 target holdout months (found: ${consistencyRes.monthEvaluations.length})`);
assert(consistencyRes.modelSummaries.length === 6, `Summarized performance across all 6 candidate models (found: ${consistencyRes.modelSummaries.length})`);

const bestOverall = consistencyRes.winner;
assert(bestOverall !== null, 'Identified overall best model across multi-month holdouts');
assert(bestOverall.overallWape > 0 && bestOverall.overallWape < 100, `Best overall model (${bestOverall.modelName}) achieved ${bestOverall.overallWape.toFixed(1)}% volume-weighted WAPE`);
assert(typeof bestOverall.wapeStdDev === 'number' && bestOverall.wapeStdDev >= 0, `WAPE standard deviation computed (±${bestOverall.wapeStdDev.toFixed(2)}%)`);
assert(typeof bestOverall.wapeRange === 'number' && bestOverall.wapeRange >= 0, `WAPE range computed (${bestOverall.wapeRange.toFixed(1)}%)`);

const mostConsistent = consistencyRes.mostConsistent;
assert(mostConsistent !== null, `Identified most stable algorithm (${mostConsistent.modelName}) with lowest WAPE std-dev (±${mostConsistent.wapeStdDev.toFixed(2)}%)`);

// 5. Test 1-click model selection / carry-over logic
const chosenAlgorithm = bestOverall.modelId;
const futureOptions = { horizon: 14, growthModifier: 0.05, assumedAht: 180, holidays: [] };
const prodForecast = ErlanglyForecast.executeForecast(sandboxMultiYearHistory, chosenAlgorithm, defaultParams, futureOptions);
assert(prodForecast !== null, 'Successfully executed production forecast using sandbox winner algorithm');
assert(prodForecast.forecast.length === 14, `Generated 14 future projections using winner (${prodForecast.modelName})`);
assert(prodForecast.forecast[0].volume > 0, `First future projection volume is positive (${Math.round(prodForecast.forecast[0].volume)} calls)`);

console.log('\n[16] Chart Aggregation & Date Range Controls (Daily, Weekly, Monthly & Zoom)');

// 1. Test Daily aggregation (passthrough)
const rawSample = ErlanglyForecast.SAMPLE_MULTI_YEAR_HISTORY;
const dailyAgg = ErlanglyForecast.aggregateTimeSeries(rawSample, 'daily');
assert(dailyAgg.length === rawSample.length, `Daily aggregation preserves exact length (${dailyAgg.length} points)`);
assert(dailyAgg[0].volume === rawSample[0].volume, 'Daily aggregation preserves first point volume');

// 2. Test Weekly aggregation
const weeklyAgg = ErlanglyForecast.aggregateTimeSeries(rawSample, 'weekly');
assert(weeklyAgg.length > 0 && weeklyAgg.length < rawSample.length, `Weekly aggregation grouped 730 days into ${weeklyAgg.length} calendar weeks`);
const rawTotal = rawSample.reduce((a, b) => a + b.volume, 0);
const weeklyTotal = weeklyAgg.reduce((a, b) => a + b.volume, 0);
assert(Math.abs(rawTotal - weeklyTotal) < 0.001, `Weekly aggregation perfectly preserves total volume (${Math.round(weeklyTotal)} calls)`);
assert(weeklyAgg[0].label.startsWith('Wk'), `Weekly label formatted correctly (${weeklyAgg[0].label})`);

// 3. Test Monthly aggregation
const monthlyAgg = ErlanglyForecast.aggregateTimeSeries(rawSample, 'monthly');
assert(monthlyAgg.length === 24, `Monthly aggregation grouped 730 days into exactly 24 calendar months (found: ${monthlyAgg.length})`);
const monthlyTotal = monthlyAgg.reduce((a, b) => a + b.volume, 0);
assert(Math.abs(rawTotal - monthlyTotal) < 0.001, `Monthly aggregation perfectly preserves total volume (${Math.round(monthlyTotal)} calls)`);
assert(monthlyAgg[0].label.includes('2024'), `First monthly label is formatted with year (${monthlyAgg[0].label})`);

// 4. Test Date Filtering
const dateFiltered = ErlanglyForecast.filterTimeSeriesByDate(rawSample, '2025-01-01', '2025-03-31');
assert(dateFiltered.length === 90, `Date filter restricted series to Q1 2025 (90 days, found: ${dateFiltered.length})`);
assert(dateFiltered[0].period === '2025-01-01', 'First filtered date is 2025-01-01');
assert(dateFiltered[dateFiltered.length - 1].period === '2025-03-31', 'Last filtered date is 2025-03-31');

// 5. Test Range Bounds Computation
const allSampleDates = rawSample.map(r => r.period);
const boundsAll = ErlanglyForecast.computeRangeBounds(allSampleDates, 'all');
assert(boundsAll.startDate === '2024-06-01', `All preset start date is 2024-06-01 (found: ${boundsAll.startDate})`);
assert(boundsAll.endDate === '2026-05-31', `All preset end date is 2026-05-31 (found: ${boundsAll.endDate})`);

const bounds1Y = ErlanglyForecast.computeRangeBounds(allSampleDates, '1y');
assert(bounds1Y.startDate === '2025-05-31', `1Y preset start date is 2025-05-31 (found: ${bounds1Y.startDate})`);
assert(bounds1Y.endDate === '2026-05-31', '1Y preset end date is 2026-05-31');

const bounds3M = ErlanglyForecast.computeRangeBounds(allSampleDates, '3m');
assert(bounds3M.startDate === '2026-03-02', `3M preset start date is 2026-03-02 (found: ${bounds3M.startDate})`);
assert(bounds3M.endDate === '2026-05-31', '3M preset end date is 2026-05-31');

const fcSampleDates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'];
const boundsFc = ErlanglyForecast.computeRangeBounds(allSampleDates.concat(fcSampleDates), 'forecast', fcSampleDates);
assert(boundsFc.startDate === '2026-05-18', `Forecast preset pads 14 days before forecast start (found: ${boundsFc.startDate})`);
assert(boundsFc.endDate === '2026-06-04', `Forecast preset ends on last forecast date (${boundsFc.endDate})`);

console.log('\n[17] Multi-Skill Demand Forecasting & Standardized Templates');

// 1. Multi-Skill Sample Dataset Verification
const multiSkillData = ErlanglyForecast.SAMPLE_MULTI_SKILL_HISTORY;
assert(multiSkillData && multiSkillData.length === 84, `Multi-skill dataset has 84 records (28 days * 3 skills, got: ${multiSkillData ? multiSkillData.length : 0})`);

const distinctSkills = [...new Set(multiSkillData.map(r => r.skill))];
assert(distinctSkills.length === 3, `Identified 3 distinct queues/skills (${distinctSkills.join(', ')})`);
assert(distinctSkills.includes('Customer Care'), 'Contains "Customer Care" queue');
assert(distinctSkills.includes('Technical Support'), 'Contains "Technical Support" queue');
assert(distinctSkills.includes('Billing & Inquiries'), 'Contains "Billing & Inquiries" queue');

// Check skill-specific AHTs
const ccSample = multiSkillData.find(r => r.skill === 'Customer Care');
const tsSample = multiSkillData.find(r => r.skill === 'Technical Support');
const billSample = multiSkillData.find(r => r.skill === 'Billing & Inquiries');
assert(ccSample && ccSample.aht === 180, 'Customer Care has 180s AHT');
assert(tsSample && tsSample.aht === 300, 'Technical Support has 300s AHT');
assert(billSample && billSample.aht === 150, 'Billing & Inquiries has 150s AHT');

// 2. Multi-Skill Rollup & Blended AHT Math
const targetDate = '2026-05-01';
const dateSlice = multiSkillData.filter(r => r.period === targetDate);
const sumVol = dateSlice.reduce((acc, r) => acc + r.volume, 0);
const weightedAhtSum = dateSlice.reduce((acc, r) => acc + (r.volume * r.aht), 0);
const blendedAht = Math.round(weightedAhtSum / sumVol);

assert(sumVol > 0, `Combined volume for ${targetDate} is ${sumVol} calls`);
assert(blendedAht >= 150 && blendedAht <= 300, `Blended volume-weighted AHT is mathematically bounded (${blendedAht}s)`);

// 3. Per-Skill Independent Forecast Execution
const perSkillResults = {};
distinctSkills.forEach(sk => {
  const skHistory = multiSkillData.filter(r => r.skill === sk);
  const skAht = skHistory[0].aht;
  const res = ErlanglyForecast.executeForecast(skHistory, 'holt', { alpha: 0.3, beta: 0.1 }, { horizon: 7, assumedAht: skAht });
  assert(res.forecast.length === 7, `Generated 7-day forecast for queue "${sk}"`);
  assert(res.forecast[0].volume > 0, `Queue "${sk}" has positive forecasted volume (${Math.round(res.forecast[0].volume)})`);
  perSkillResults[sk] = res;
});

// 4. Combined Blended Forecast Execution
const combinedRollMap = {};
multiSkillData.forEach(r => {
  if (!combinedRollMap[r.period]) {
    combinedRollMap[r.period] = { period: r.period, skill: 'Combined', volume: 0, ahtSum: 0 };
  }
  combinedRollMap[r.period].volume += r.volume;
  combinedRollMap[r.period].ahtSum += r.volume * r.aht;
});

const combinedHistory = Object.values(combinedRollMap).map(item => ({
  period: item.period,
  skill: 'Combined',
  volume: Math.round(item.volume),
  aht: Math.round(item.ahtSum / item.volume)
}));

const totalCombVol = combinedHistory.reduce((acc, r) => acc + r.volume, 0);
const totalCombAht = Math.round(combinedHistory.reduce((acc, r) => acc + r.volume * r.aht, 0) / totalCombVol);

const combRes = ErlanglyForecast.executeForecast(combinedHistory, 'holt', { alpha: 0.3, beta: 0.1 }, { horizon: 7, assumedAht: totalCombAht });
assert(combRes.forecast.length === 7, 'Generated 7-day forecast for Combined series');

// Verify combined projected volume is consistent with the sum of per-skill forecasts
const sumPerSkillDay1 = distinctSkills.reduce((acc, sk) => acc + perSkillResults[sk].forecast[0].volume, 0);
const combDay1 = combRes.forecast[0].volume;
assertClose(combDay1, sumPerSkillDay1, sumPerSkillDay1 * 0.10, 'Combined day 1 forecast is within 10% of sum of independent queues');

// 5. Multi-Skill Actuals Matching & Evaluation by (Period, Skill)
const mockMultiSkillActuals = [
  { period: '2026-05-29', skill: 'Customer Care', forecast: 1400, actual: 1420 },
  { period: '2026-05-29', skill: 'Technical Support', forecast: 650, actual: 640 },
  { period: '2026-05-29', skill: 'Billing & Inquiries', forecast: 450, actual: 460 },
  { period: '2026-05-30', skill: 'Customer Care', forecast: 700, actual: 710 },
  { period: '2026-05-30', skill: 'Technical Support', forecast: 320, actual: 315 },
  { period: '2026-05-30', skill: 'Billing & Inquiries', forecast: 200, actual: 205 }
];

const actsList = mockMultiSkillActuals.map(p => p.actual);
const fcsList = mockMultiSkillActuals.map(p => p.forecast);
const multiAcc = ErlanglyForecast.calculateAccuracyMetrics(actsList, fcsList);

assert(multiAcc.count === 6, 'Evaluated accuracy across 6 multi-skill period pairs');
assert(multiAcc.wape < 5.0, `Multi-skill WAPE is < 5% (got: ${multiAcc.wape.toFixed(2)}%)`);
assert(Math.abs(multiAcc.biasPct) < 2.0, `Multi-skill bias is < 2% (got: ${multiAcc.biasPct.toFixed(2)}%)`);

// 6. Template Function Availability
assert(typeof ErlanglyForecast.downloadHistoricalTemplate === 'function', 'downloadHistoricalTemplate function is exported');
assert(typeof ErlanglyForecast.downloadActualsTemplate === 'function', 'downloadActualsTemplate function is exported');

// =========================================================================
// [18] Phase 9 — Scheduling Labor Rules & Constraints
// =========================================================================
console.log('\n[18] Phase 9 — Scheduling Labor Rules & Constraints');

const ErlanglyScheduling = require('../js/scheduling.js');
assert(ErlanglyScheduling !== undefined, 'ErlanglyScheduling module loaded');

// 18a. Variable-Length Shift Break Rules
console.log('\n  [18a] Variable-Length Break Rules:');
const break4h = ErlanglyScheduling.getBreakRulesForLength(4.0);
assert(break4h.mealMins === 0 && break4h.paidHours === 4.0, '4.0h shift: 0 min meal, 4.0h paid (100% paid)');

const break6h = ErlanglyScheduling.getBreakRulesForLength(6.0);
assert(break6h.mealMins === 15 && break6h.paidHours === 5.75, '6.0h shift: 15 min meal, 5.75h paid');

const break85h = ErlanglyScheduling.getBreakRulesForLength(8.5);
assert(break85h.mealMins === 30 && break85h.paidHours === 8.0, '8.5h shift: 30 min meal, 8.0h paid');

const break10h = ErlanglyScheduling.getBreakRulesForLength(10.0);
assert(break10h.mealMins === 60 && break10h.paidHours === 9.0, '10.0h shift: 60 min meal, 9.0h paid');

// 18b. Rest Period Calculation & Anti-Clopening Detection
console.log('\n  [18b] Rest Period & Anti-Clopening Math:');
// Prev shift: 13:30 to 22:00 (length 8.5h -> end 22:00 = 1320m)
// Next shift: 08:00 (start 08:00 next day = 1920m)
// Rest = (1920 - 1320) / 60 = 10.0h (< 11.0h min rest!)
const eveningShift = { id: 'S4', start: '13:30', lengthHours: 8.5, paidHours: 8.0 };
const morningShift = { id: 'S1', start: '08:00', lengthHours: 8.5, paidHours: 8.0 };
const clopeningRest = ErlanglyScheduling.computeRestPeriod(eveningShift, morningShift);
assertClose(clopeningRest, 10.0, 0.01, 'Evening close (22:00) to morning open (08:00) rest is exactly 10.0h');

// Prev shift: 08:00 to 16:30 (end 16:30 = 990m). Next shift: 08:00 (1920m).
// Rest = (1920 - 990) / 60 = 15.5h (>= 11.0h compliant)
const earlyShift = { id: 'S1', start: '08:00', lengthHours: 8.5, paidHours: 8.0 };
const compliantRest = ErlanglyScheduling.computeRestPeriod(earlyShift, morningShift);
assertClose(compliantRest, 15.5, 0.01, 'Early shift to next morning shift rest is 15.5h (compliant)');

// Rest from OFF day
const offRest = ErlanglyScheduling.computeRestPeriod(null, morningShift);
assert(offRest >= 24.0, 'Rest period from OFF day is >= 24.0h');

// 18c. Shift Compliance Check (Hard & Soft Constraints)
console.log('\n  [18c] Labor Rule Hard & Soft Constraint Checks:');
const testShifts = {
  'S1': { id: 'S1', name: 'Early', type: 'FT', start: '08:00', lengthHours: 8.5, paidHours: 8.0 },
  'S4': { id: 'S4', name: 'Close', type: 'FT', start: '13:30', lengthHours: 8.5, paidHours: 8.0 },
  'PT1': { id: 'PT1', name: 'PT Morn', type: 'PT', start: '08:00', lengthHours: 4.0, paidHours: 4.0 },
  'LONG': { id: 'LONG', name: 'Long', type: 'FT', start: '08:00', lengthHours: 12.0, paidHours: 11.0 }
};

const testAgent = {
  id: 'FT-01',
  name: 'Test Agent',
  contractType: 'FT',
  targetWeeklyHours: 40.0,
  maxDailyHours: 10.0,
  maxWeeklyHours: 40.0,
  minRestHours: 11.0,
  maxConsecutiveDays: 6,
  preferredShift: 'S1',
  availability: [
    { day: 0, available: true, start: '07:00', end: '21:00' },
    { day: 1, available: true, start: '07:00', end: '21:00' },
    { day: 2, available: true, start: '07:00', end: '21:00' },
    { day: 3, available: true, start: '07:00', end: '21:00' },
    { day: 4, available: true, start: '07:00', end: '21:00' },
    { day: 5, available: false, start: '', end: '' }, // Sat OFF
    { day: 6, available: false, start: '', end: '' }  // Sun OFF
  ]
};

// Test Daily Hours Limit
const longShiftCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 0, testShifts['LONG'], ['OFF','OFF','OFF','OFF','OFF','OFF','OFF'], null, testShifts);
assert(!longShiftCheck.isFeasible && longShiftCheck.hardViolations.some(v => v.indexOf('daily') !== -1), '11.0h paid shift violates 10.0h max daily limit');

// Test Clopening Hard Violation (Mon evening close S4, Tue morning open S1)
const monAssignments = ['S4', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const tueClopeningCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 1, testShifts['S1'], monAssignments, null, testShifts);
assert(!tueClopeningCheck.isFeasible && tueClopeningCheck.hardViolations.some(v => v.indexOf('Clopening') !== -1), '10.0h rest gap flags hard Clopening breach on Tue morning');

// Test Compliant Rest (Mon early S1, Tue early S1)
const monEarlyAssignments = ['S1', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const tueCompliantCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 1, testShifts['S1'], monEarlyAssignments, null, testShifts);
assert(tueCompliantCheck.isFeasible && tueCompliantCheck.hardViolations.length === 0, '15.5h rest gap is 100% compliant');

// Test Weekly Overtime Limit (Mon-Fri already 40.0h, trying to add 6th shift)
const fullWeekAssignments = ['S1', 'S1', 'S1', 'S1', 'S1', 'OFF', 'OFF'];
const satOvertimeCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 5, testShifts['PT1'], fullWeekAssignments, null, testShifts);
assert(!satOvertimeCheck.isFeasible && satOvertimeCheck.hardViolations.some(v => v.indexOf('Weekly') !== -1), 'Exceeding 40.0h weekly hours ceiling flags hard violation');

// Test Availability Window Block (Sat is unavailable)
const satAvailCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 5, testShifts['S1'], ['OFF','OFF','OFF','OFF','OFF','OFF','OFF'], null, testShifts);
assert(!satAvailCheck.isFeasible && satAvailCheck.hardViolations.some(v => v.indexOf('Unavailable') !== -1), 'Assigning shift on unavailable day flags hard violation');

// Test Soft Preference Bonus
assert(tueCompliantCheck.prefScore === 3.0, 'Assigning preferred shift (S1) returns +3.0 score bonus');
const nonPrefCheck = ErlanglyScheduling.checkShiftCompliance(testAgent, 1, testShifts['S4'], monEarlyAssignments, null, testShifts);
assert(nonPrefCheck.softWarnings.length > 0, 'Assigning non-preferred shift (S4) returns soft warning');

// 18d. Agent Roster Generation & Contract Mix
console.log('\n  [18d] Roster Generation:');
const generatedRoster = ErlanglyScheduling.generateRosterFromFte({
  totalBodies: 40,
  ptMix: 0.25,
  ftWeeklyHours: 40.0,
  ptWeeklyHours: 20.0
});
assert(generatedRoster.length === 40, 'Generated 40 agent profiles');
const ftCount = generatedRoster.filter(a => a.contractType === 'FT').length;
const ptCount = generatedRoster.filter(a => a.contractType === 'PT').length;
assert(ftCount === 30, 'Contains exactly 30 FT agents (75%)');
assert(ptCount === 10, 'Contains exactly 10 PT agents (25%)');
assert(generatedRoster[0].minRestHours === 11.0, 'FT agent has 11.0h min rest rule');
assert(generatedRoster[30].targetWeeklyHours === 20.0, 'PT agent has 20.0h target weekly hours');

// 18e. Constraint-Aware Heuristic Optimizer Execution
console.log('\n  [18e] Multi-Day Constraint-Aware Optimizer:');
const optResult = ErlanglyScheduling.optimizeRoster({
  intervals: ErlanglyScheduling.DEFAULT_INTERVALS,
  intervalLength: 1800,
  operatingDays: 7,
  shifts: ErlanglyScheduling.DEFAULT_SHIFTS,
  agents: generatedRoster
});

assert(optResult.dailyCoverage.length === 7, 'Generated 7-day daily coverage schedule');
assert(Object.keys(optResult.rosterAssignments).length === 40, 'Generated assignments for all 40 agents');

// Audit check on optimizer output
const auditOutput = optResult.auditResults;
assert(auditOutput.errorCount === 0, `Optimizer generated 100% compliant schedule with 0 hard labor rule errors (got: ${auditOutput.errorCount})`);
assert(auditOutput.compliantCount > 0, `Compliant agents count is positive (got: ${auditOutput.compliantCount})`);

const monCoverage = optResult.dailyCoverage[0];
assert(monCoverage.requiredHours > 0, 'Monday required hours is positive');
assert(monCoverage.scheduledHours > 0, 'Monday scheduled hours is positive');
assert(monCoverage.matchPct > 30.0, `Monday scheduled coverage accounts for all allocated agent supply (${monCoverage.matchPct.toFixed(1)}%)`);

// Test optimal roster with right-sized team (85 agents)
const fullRoster = ErlanglyScheduling.generateRosterFromFte({
  totalBodies: 85,
  ptMix: 0.20,
  ftWeeklyHours: 40.0,
  ptWeeklyHours: 20.0
});
const fullOptResult = ErlanglyScheduling.optimizeRoster({
  intervals: ErlanglyScheduling.DEFAULT_INTERVALS,
  operatingDays: 7,
  shifts: ErlanglyScheduling.DEFAULT_SHIFTS,
  agents: fullRoster
});
assert(fullOptResult.dailyCoverage[0].matchPct >= 70.0, `Full 85-agent roster covers peak Monday demand (${fullOptResult.dailyCoverage[0].matchPct.toFixed(1)}%)`);
assert(fullOptResult.dailyCoverage[3].matchPct >= 85.0, `Full 85-agent roster achieves optimal baseline Thursday alignment (${fullOptResult.dailyCoverage[3].matchPct.toFixed(1)}%)`);

// 18f. Bottleneck Diagnostics Detection under Severe Constraints
console.log('\n  [18f] Infeasibility & Bottleneck Diagnostics:');
const tinyRoster = [
  {
    id: 'FT-01',
    name: 'Solo Worker',
    contractType: 'FT',
    targetWeeklyHours: 40.0,
    maxDailyHours: 8.0,
    maxWeeklyHours: 8.0, // Only allowed 1 shift for the whole week!
    minRestHours: 11.0,
    maxConsecutiveDays: 1,
    availability: new Array(7).fill({ day: 0, available: true, start: '08:00', end: '18:00' })
  }
];

const bottleneckResult = ErlanglyScheduling.optimizeRoster({
  intervals: ErlanglyScheduling.DEFAULT_INTERVALS,
  operatingDays: 3,
  shifts: ErlanglyScheduling.DEFAULT_SHIFTS,
  agents: tinyRoster
});

assert(bottleneckResult.auditResults.bottlenecks.length > 0, 'Infeasibility diagnostics captured unmet demand under constrained roster');
assert(bottleneckResult.auditResults.bottlenecks[0].unmetDeficit > 0, 'Diagnostic identifies unmet deficit quantity');

// 18g. Schedule Audit Engine Detection on Dirty Manual Overrides
console.log('\n  [18g] Audit Engine on Manual Overrides:');
const dirtyAssignments = {
  'FT-01': ['S4', 'S1', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'] // Mon close (22:00) + Tue open (08:00) = clopening!
};
const dirtyAudit = ErlanglyScheduling.auditRoster(dirtyAssignments, [testAgent], testShifts, null);
assert(dirtyAudit.errorCount === 1, 'Audit engine detects 1 hard violation on manual clopening override');
assert(dirtyAudit.agentReports['FT-01'].status === 'ERROR', 'Agent FT-01 marked with ERROR status');
assert(dirtyAudit.agentReports['FT-01'].hardViolations.some(v => v.indexOf('Clopening') !== -1), 'Audit report details exact Clopening breach');

// 18h. CSV Exporter Verification
console.log('\n  [18h] CSV Exporters & Availability Templates:');
const csvRes = ErlanglyScheduling.exportAgentRosterCSV(optResult.rosterAssignments, generatedRoster, testShifts, auditOutput);
assert(csvRes.headers.length === 13, 'Roster CSV has 13 standard columns');
assert(csvRes.rows.length === 40, 'Roster CSV contains 40 agent rows');
assert(csvRes.headers[0] === 'Agent_ID' && csvRes.headers[10] === 'Total_Paid_Hours', 'Roster CSV headers correctly formatted');

const tmplRes = ErlanglyScheduling.downloadAgentAvailabilityTemplate();
assert(tmplRes.headers.indexOf('Min_Rest_Hours') !== -1, 'Availability template includes Min_Rest_Hours column');
assert(tmplRes.rows.length > 0, 'Availability template includes sample agent rows');

// ====================================================
// 19. SIMULATOR MONTE CARLO & REAL-TIME LIVE FEED (PHASE 10)
// ====================================================
console.log('\n====================================================');
console.log('19. PHASE 10 VERIFICATION (js/simulator.js & js/realtime.js)');
console.log('====================================================\n');

const ErlanglySimulator = require('../js/simulator.js');
const ErlanglyRealTime = require('../js/realtime.js');

// 19a. Random Sampling & Statistics
console.log('  [19a] Monte Carlo Sampling & Distribution Engine:');
const normalSamples = [];
for (let i = 0; i < 10000; i++) {
  normalSamples.push(ErlanglySimulator.sampleNormal(100, 10));
}
const normalStats = ErlanglySimulator.getStats(normalSamples);
assertClose(normalStats.mean, 100, 0.5, 'sampleNormal generates sample mean close to target mean 100');
assertClose(normalStats.stdDev, 10, 0.5, 'sampleNormal generates sample stdDev close to target stdDev 10');

const uniformSamples = [];
let uniformBounded = true;
for (let i = 0; i < 1000; i++) {
  const u = ErlanglySimulator.sampleUniform(50, 150);
  uniformSamples.push(u);
  if (u < 50 || u > 150) uniformBounded = false;
}
assert(uniformBounded, 'sampleUniform generates values strictly within specified min and max bounds');

// 19b. Percentiles & Monotonicity
console.log('\n  [19b] Percentiles & Monotonic Ordering:');
const sortedTestArray = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const p10 = ErlanglySimulator.getPercentile(sortedTestArray, 10);
const p25 = ErlanglySimulator.getPercentile(sortedTestArray, 25);
const p50 = ErlanglySimulator.getPercentile(sortedTestArray, 50);
const p75 = ErlanglySimulator.getPercentile(sortedTestArray, 75);
const p90 = ErlanglySimulator.getPercentile(sortedTestArray, 90);

assert(p10 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p90, `Percentile monotonicity holds: P10(${p10}) <= P25(${p25}) <= P50(${p50}) <= P75(${p75}) <= P90(${p90})`);
assertClose(p50, 55, 0.5, 'P50 (Median) interpolates correctly');

// 19c. Deterministic Simulation Execution
console.log('\n  [19c] Multi-Period Deterministic Simulation:');
const scDefault = ErlanglySimulator.DEFAULT_SCENARIOS[0];
const detResult = ErlanglySimulator.simulateScenario(scDefault, 12);
assert(detResult.periods.length === 12, 'Deterministic simulation produces 12 monthly periods');
assert(detResult.totalSpend > 0, 'Computes positive total horizon labor spend');
assert(detResult.avgSla >= 0 && detResult.avgSla <= 1.0, 'Computes valid average horizon SLA');
assert(detResult.periods[0].sla >= 0.80, 'Initial month meets baseline SLA');

// 19d. 500-Iteration Monte Carlo Simulation Engine
console.log('\n  [19d] Monte Carlo 500-Iteration Probabilistic Engine:');
const mcConfig = {
  volSigma: 5.0,
  ahtSigma: 4.0,
  attritionSigma: 1.0,
  hiresSigma: 1,
  distribution: 'normal',
  iterations: 500
};
const t0 = Date.now();
const mcResult = ErlanglySimulator.runMonteCarloSimulation(scDefault, 12, mcConfig);
const elapsedMs = Date.now() - t0;

assert(mcResult.iterations === 500, 'Monte Carlo executed 500 iterations');
assert(mcResult.periods.length === 12, 'Monte Carlo aggregated across 12 monthly periods');
assert(elapsedMs < 1500, `500 iterations completed rapidly client-side in ${elapsedMs}ms (< 1500ms)`);

// Check confidence bands monotonic properties
let bandsMonotonic = true;
mcResult.periods.forEach((p, idx) => {
  if (p.sla.p10 > p.sla.p25 || p.sla.p25 > p.sla.p50 || p.sla.p50 > p.sla.p75 || p.sla.p75 > p.sla.p90) {
    bandsMonotonic = false;
    console.error(`SLA percentile monotonicity failed at period ${idx + 1}`);
  }
  if (p.cost.p10 > p.cost.p25 || p.cost.p25 > p.cost.p50 || p.cost.p50 > p.cost.p75 || p.cost.p75 > p.cost.p90) {
    bandsMonotonic = false;
    console.error(`Cost percentile monotonicity failed at period ${idx + 1}`);
  }
});
assert(bandsMonotonic, 'All Monte Carlo period confidence bands satisfy P10 <= P25 <= P50 <= P75 <= P90');
assert(mcResult.slaBreachProbability >= 0 && mcResult.slaBreachProbability <= 1.0, 'Computes SLA breach probability between 0 and 100%');
assert(mcResult.budgetBreachProbability >= 0 && mcResult.budgetBreachProbability <= 1.0, 'Computes budget breach probability between 0 and 100%');

// 19e. Real-Time Queue Metrics & VTO Engine
console.log('\n  [19e] Real-Time Queue Engine & VTO Calculations:');
const sampleRow = ErlanglyRealTime.INTRADAY_DATA[0];
const rtMetrics = ErlanglyRealTime.calculateQueueMetrics(sampleRow, 1800, 0.80, 20);
assert(rtMetrics.erlangs > 0, 'Calculates active interval Erlangs');
assert(rtMetrics.serviceLevel >= 0.80, '08:00 interval meets baseline service level');
assert(rtMetrics.occupancy > 0 && rtMetrics.occupancy < 1.0, 'Calculates valid agent occupancy');

// 19f. Live Data Feed JSON & CSV Parsers
console.log('\n  [19f] Live Data Feed Payload Parsers:');
const mockJsonFeed = JSON.stringify([
  { interval: '08:00', fcstVol: 120, actVol: 130, fcstAht: 180, actAht: 185, schedStaff: 22, actStaff: 21 },
  { interval: '08:30', fcstVol: 170, actVol: 160, fcstAht: 180, actAht: 175, schedStaff: 30, actStaff: 30 }
]);
const parsedJson = ErlanglyRealTime.parseFeedPayload(mockJsonFeed, 'json');
assert(parsedJson.length === 2, 'JSON live feed parser extracts 2 interval rows');
assert(parsedJson[0].actVol === 130 && parsedJson[0].actStaff === 21, 'JSON live feed parses field values accurately');

const mockCsvFeed = `Interval,Fcst_Vol,Act_Vol,Fcst_AHT,Act_AHT,Sched_Staff,Act_Staff\n09:00,250,260,190,195,45,44\n09:30,320,330,200,205,60,58`;
const parsedCsv = ErlanglyRealTime.parseFeedPayload(mockCsvFeed, 'csv');
assert(parsedCsv.length === 2, 'CSV live feed parser extracts 2 interval rows');
assert(parsedCsv[1].interval === '09:30' && parsedCsv[1].actVol === 330, 'CSV live feed parses values correctly');

// 19g. Synthetic Demo Live Feed Generator
console.log('\n  [19g] Synthetic Live Demo Stream Generator:');
const demoFeed = ErlanglyRealTime.generateSyntheticDemoFeed(ErlanglyRealTime.INTRADAY_DATA);
assert(demoFeed.length === ErlanglyRealTime.INTRADAY_DATA.length, 'Synthetic demo feed maintains full 24-interval daytime span');
assert(demoFeed[0].actVol > 0 && demoFeed[0].actAht > 0, 'Synthetic demo feed produces positive volume and handle times');

// ============================================================================
// 20. PHASE 11: COLLABORATION, VERSIONING & MULTI-SKILL ROUTING
// ============================================================================
console.log('\n====================================================');
console.log('PHASE 11: MULTI-SKILL ROUTING & COLLABORATION VERIFICATION');
console.log('====================================================\n');

// 20a. Overflow Routing Math
console.log('  [20a] Multi-Queue Overflow Routing Math:');
const sampleQueues = [
  { id: 'q1', name: 'Inbound Support', volume: 400, aht: 240, targetSLA: 0.80, targetTime: 20 },
  { id: 'q2', name: 'Billing Inquiries', volume: 250, aht: 180, targetSLA: 0.80, targetTime: 20 },
  { id: 'q3', name: 'Escalations / Secondary', volume: 150, aht: 320, targetSLA: 0.80, targetTime: 20 }
];

const of30s = Erlangly.overflowRouting(sampleQueues, 30, 1800);
assert(of30s.totalAgents > 0, 'Computes positive total staffing for 3-queue overflow model');
assert(of30s.siloedAgents >= of30s.totalAgents, `Overflow routing achieves equal or fewer agents than siloed (${of30s.totalAgents} <= ${of30s.siloedAgents})`);
assert(of30s.primaryQueues.length === 2, 'Primary queues list contains first 2 queues');
assert(of30s.secondaryQueue !== null, 'Secondary queue receives aggregate direct + overflow workload');
assert(of30s.secondaryQueue.overflowVolumeReceived > 0, 'Secondary queue receives positive overflow volume');

// Monotonicity of threshold: longer wait before overflow -> less overflow volume
const of10s = Erlangly.overflowRouting(sampleQueues, 10, 1800);
const of60s = Erlangly.overflowRouting(sampleQueues, 60, 1800);
assert(of10s.secondaryQueue.overflowVolumeReceived >= of30s.secondaryQueue.overflowVolumeReceived, '10s threshold yields more or equal overflow volume than 30s threshold');
assert(of30s.secondaryQueue.overflowVolumeReceived >= of60s.secondaryQueue.overflowVolumeReceived, '30s threshold yields more or equal overflow volume than 60s threshold');

// Edge cases for overflow threshold
const ofZero = Erlangly.overflowRouting(sampleQueues, 0, 1800);
assert(ofZero.totalAgents > 0, 'Threshold 0s (instant overflow on delay) solves stably');
const ofInfinite = Erlangly.overflowRouting(sampleQueues, 999999, 1800);
assertClose(ofInfinite.secondaryQueue.overflowVolumeReceived, 0, 0.001, 'Threshold 999,999s yields zero overflow volume (pure siloed operation)');

// 20b. Skill-Based Routing & Agent Allocation Math
console.log('\n  [20b] Skill-Based Routing & Pooling Flex Tier:');
const sk70 = Erlangly.skillBasedRouting(sampleQueues, 0.70, 1800);
assert(sk70.specialistGroups.length === 3, 'Calculates 3 dedicated specialist tiers');
assert(sk70.flexGroup !== null, 'Calculates cross-trained multi-skilled flex tier');
assert(sk70.flexGroup.flexAgents > 0, 'Flex tier staffing is positive');
assert(sk70.siloedAgents >= sk70.totalAgents, `Skill-based flex pooling yields headcount savings (${sk70.totalAgents} <= ${sk70.siloedAgents})`);
assert(sk70.percentEfficiencyGain >= 0, 'Pooling efficiency gain is non-negative');

// Sizing split sensitivity: more flex pooling -> higher efficiency gain
const sk50 = Erlangly.skillBasedRouting(sampleQueues, 0.50, 1800);
const sk90 = Erlangly.skillBasedRouting(sampleQueues, 0.90, 1800);
assert(sk50.percentEfficiencyGain >= sk70.percentEfficiencyGain - 0.5, 'Higher flex share (50% dedicated) achieves higher/equal pooling efficiency');
assert(sk70.percentEfficiencyGain >= sk90.percentEfficiencyGain - 0.5, 'Moderate flex share (70% dedicated) achieves higher/equal pooling gain than 90% dedicated');

// 20c. Version Diffing & Snapshot Comparison Engine
console.log('\n  [20c] Plan Version Diffing Engine:');
// Mock global environment for plans.js
global.localStorage = {
  _store: {},
  getItem: function(k) { return this._store[k] || null; },
  setItem: function(k, v) { this._store[k] = String(v); },
  removeItem: function(k) { delete this._store[k]; },
  clear: function() { this._store = {}; }
};
global.ErlanglyAuth = {
  getUser: function() { return Promise.resolve({ id: 'usr_test', email: 'analyst@erlangly.com' }); }
};

const ErlanglySupabase = require('../js/supabaseClient.js');
global.ErlanglySupabase = ErlanglySupabase;
const ErlanglyPlans = require('../js/plans.js');
global.ErlanglyPlans = ErlanglyPlans;

const v1 = {
  version_number: 1,
  inputs: { volume: 300, aht: 180, targetSLA: 0.80, targetTime: 20 },
  outputs: { baseAgents: 35, staffedAgents: 50, serviceLevel: 0.84 }
};
const v2 = {
  version_number: 2,
  inputs: { volume: 450, aht: 180, targetSLA: 0.85, targetTime: 20, shrinkage: 0.35 },
  outputs: { baseAgents: 52, staffedAgents: 80, serviceLevel: 0.87 }
};

const diffResult = ErlanglyPlans.diffPlanVersions(v1, v2);
assert(diffResult.totalChanges > 0, 'Diff engine detects parameter modifications between v1 and v2');
const modVol = diffResult.inputDiffs.find(d => d.key === 'volume');
assert(modVol && modVol.type === 'modified' && modVol.oldVal === 300 && modVol.newVal === 450, 'Diff identifies modified volume parameter accurately');
const addedShrinkage = diffResult.inputDiffs.find(d => d.key === 'shrinkage');
assert(addedShrinkage && addedShrinkage.type === 'added' && addedShrinkage.newVal === 0.35, 'Diff identifies added parameter');

// 20d. Optimistic Concurrency & Role Permissions
console.log('\n  [20d] Optimistic Concurrency & Permission Model:');
// Test savePlan conflict detection
const mockExistingPlan = {
  id: 'pln_concurrent_test',
  user_id: 'usr_test',
  tool: 'capacity',
  name: 'Concurrent Plan',
  inputs: { volume: 300 },
  outputs: {},
  updated_at: '2026-08-21T10:00:00.000Z'
};
global.localStorage.setItem('erlangly_mock_plans', JSON.stringify([mockExistingPlan]));

// Client loaded plan at 09:00:00 (stale timestamp)
ErlanglyPlans.savePlan('capacity', 'Concurrent Plan', { volume: 350 }, {}, 'pln_concurrent_test', '2026-08-21T09:00:00.000Z')
  .then(res => {
    assert(res && res.conflict === true, 'Optimistic concurrency detects concurrent update and returns conflict flag');

    // 20e. Collaborator Invitation & Version Snapshot Storage
    console.log('\n  [20e] Collaborator Role Permissions & Version Snapshot History:');
    return ErlanglyPlans.addPlanCollaborator('pln_concurrent_test', 'teammate@erlangly.com', 'editor')
      .then(collab => {
        assert(collab && collab.role === 'editor', 'Invites collaborator with editor role');
        return ErlanglyPlans.getPlanCollaborators('pln_concurrent_test');
      })
      .then(collabs => {
        assert(collabs.length === 1 && collabs[0].user_email === 'teammate@erlangly.com', 'Collaborator retrieved from plan_collaborators store');
        return ErlanglyPlans.getPlanVersions('pln_concurrent_test');
      })
      .then(versions => {
        assert(Array.isArray(versions), 'Plan versions retrieved from plan_versions store');

        // ====================================================
        // [21] PHASE 14 VERIFICATION: QUICK WINS & POLISH
        // ====================================================
        console.log('\n====================================================');
        console.log('PHASE 14: QUICK WINS & POLISH VERIFICATION');
        console.log('====================================================\n');

        // 21a. Theme Switcher & Storage Management
        console.log('  [21a] Theme Switching & Persistence:');
        ErlanglyUtils.setTheme('dark');
        assert(ErlanglyUtils.getTheme() === 'dark', 'getTheme returns dark when set to dark');
        var toggled = ErlanglyUtils.toggleTheme();
        assert(toggled === 'light' && ErlanglyUtils.getTheme() === 'light', 'toggleTheme switches dark to light');
        var toggledBack = ErlanglyUtils.toggleTheme();
        assert(toggledBack === 'dark' && ErlanglyUtils.getTheme() === 'dark', 'toggleTheme switches light back to dark');

        // 21b. Forecast Confidence Interval Mathematics
        console.log('\n  [21b] Forecast Confidence Intervals & Horizon Expansion:');
        var testForecast = [
          { period: '2026-09-01', volume: 1000 },
          { period: '2026-09-02', volume: 1050 },
          { period: '2026-09-03', volume: 1100 },
          { period: '2026-09-04', volume: 1150 },
          { period: '2026-09-05', volume: 1200 }
        ];
        var testMetrics = { rmse: 45.0, mae: 35.0, mape: 4.2 };
        var histLength = 28;

        // Function replicating confidence interval bounds calculation
        function testCI(points, metrics, k, level) {
          var z = level === '95' ? 1.95996 : 1.28155;
          var rmse = metrics.rmse;
          var upper = [];
          var lower = [];
          points.forEach(function(p, idx) {
            var h = idx + 1;
            var se_h = rmse * Math.sqrt(1 + (h - 1) / k);
            var margin = z * se_h;
            upper.push(Math.round(p.volume + margin));
            lower.push(Math.max(0, Math.round(p.volume - margin)));
          });
          return { upper: upper, lower: lower, z: z };
        }

        var ci80 = testCI(testForecast, testMetrics, histLength, '80');
        var ci95 = testCI(testForecast, testMetrics, histLength, '95');

        assert(ci80.upper[0] > testForecast[0].volume, '80% CI upper bound is higher than point forecast (period 1)');
        assert(ci80.lower[0] < testForecast[0].volume, '80% CI lower bound is lower than point forecast (period 1)');
        assert(ci95.upper[0] > ci80.upper[0], '95% CI upper bound is wider than 80% CI upper bound');
        assert(ci95.lower[0] < ci80.lower[0], '95% CI lower bound is wider than 80% CI lower bound');

        // Horizon dispersion check (margin increases over forecast steps)
        var marginStep1 = ci95.upper[0] - testForecast[0].volume;
        var marginStep5 = ci95.upper[4] - testForecast[4].volume;
        assert(marginStep5 > marginStep1, `Forecast confidence margin expands monotonically over horizon (step 1: ${marginStep1}, step 5: ${marginStep5})`);

        // 21c. CSV Data Validation & Normalization Engine
        console.log('\n  [21c] Universal CSV Preview & Diagnostics Validation:');
        var sampleCSVText = 'Date,Volume,AHT\n2026-08-01,300,180\n2026-08-02,INVALID,180\n2026-08-03,450,200\n,,\n2026-08-04,-50,180';
        var parsedCSV = ErlanglyUtils.parseCSV(sampleCSVText);
        assert(parsedCSV.headers.length === 3, 'parseCSV accurately detects 3 headers');
        assert(parsedCSV.rows.length === 4, 'parseCSV ignores completely empty rows');

        // Test custom validator
        var validRows = [];
        var errorRows = [];
        parsedCSV.rows.forEach(function(row, idx) {
          var vol = parseFloat(row.volume);
          if (isNaN(vol) || vol < 0) {
            errorRows.push({ line: idx + 2, error: 'Invalid volume' });
          } else {
            validRows.push(row);
          }
        });

        assert(validRows.length === 2, 'Validation isolates exactly 2 clean rows');
        assert(errorRows.length === 2, 'Validation flags exactly 2 malformed/negative rows');
        assert(errorRows[0].line === 3, 'First error correctly pinpointed to line 3 (INVALID)');
        assert(errorRows[1].line === 5, 'Second error correctly pinpointed to line 5 (-50)');

        // ====================================================
        // [22] SUPABASE CLIENT, CONFIG RESOLUTION & RLS AUDIT
        // ====================================================
        console.log('\n====================================================');
        console.log('SUPABASE CLIENT, CONFIG & RLS VERIFICATION');
        console.log('====================================================\n');

        const fs = require('fs');
        const path = require('path');

        // 22a. Config File & Resolution
        console.log('  [22a] Config Resolution & Client Status:');
        assert(typeof global.ErlanglySupabaseConfig !== 'undefined', 'ErlanglySupabaseConfig is exported');
        const initialStatus = global.ErlanglySupabaseConfig.getConnectionStatus();
        assert(initialStatus && typeof initialStatus.isLive === 'boolean', 'getConnectionStatus returns valid status descriptor');
        assert(initialStatus.mode === 'mock' || initialStatus.mode === 'live', 'Status mode is either live or mock');

        // Test credentials update & retrieval
        global.ErlanglySupabaseConfig.setCredentials('https://testproject.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.testkey', false);
        assert(global.localStorage.getItem('erlangly_supabase_url') === 'https://testproject.supabase.co', 'setCredentials persists URL to localStorage');
        assert(global.localStorage.getItem('erlangly_supabase_anon_key') === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.testkey', 'setCredentials persists Anon Key to localStorage');

        global.ErlanglySupabaseConfig.clearCredentials(false);
        assert(global.localStorage.getItem('erlangly_supabase_url') === null, 'clearCredentials removes URL from localStorage');
        assert(global.localStorage.getItem('erlangly_supabase_anon_key') === null, 'clearCredentials removes Anon Key from localStorage');

        // 22b. testConnection Validation
        console.log('\n  [22b] testConnection Validation:');
        global.ErlanglySupabaseConfig.testConnection('', '').then(function(resBad) {
          assert(resBad.success === false, 'testConnection rejects empty credentials gracefully');
          assert(resBad.error.indexOf('valid Supabase Project URL') !== -1, 'testConnection returns actionable validation error');

          // 22c. Database Schema & RLS Non-Recursion Audit
          console.log('\n  [22c] SQL Schema & RLS Non-Recursion Audit:');
          const schemaSql = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
          assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.plans'), 'Schema creates public.plans table');
          assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.plan_collaborators'), 'Schema creates public.plan_collaborators table');
          assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.plan_versions'), 'Schema creates public.plan_versions table');
          assert(schemaSql.includes('SECURITY DEFINER'), 'Schema uses SECURITY DEFINER helper functions to prevent RLS recursion');
          assert(schemaSql.includes('is_plan_collaborator'), 'Schema defines is_plan_collaborator function');
          assert(schemaSql.includes('is_plan_owner'), 'Schema defines is_plan_owner function');

          // Check .gitignore does not ignore js/config.js
          const gitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
          const ignoresConfigJs = gitignore.split('\n').some(line => line.trim() === 'js/config.js');
          assert(!ignoresConfigJs, '.gitignore does NOT ignore js/config.js (prevents Vercel 404 error)');

          // Check default js/config.js exists
          const configJsExists = fs.existsSync(path.join(__dirname, '../js/config.js'));
          assert(configJsExists, 'Default js/config.js exists in repository');

          console.log('\n====================================================');
          console.log(`TEST RESULTS: ${passed} Passed, ${failed} Failed`);
          console.log('====================================================');

          if (failed > 0) {
            process.exit(1);
          }
        });
      });
  })
  .catch(err => {
    console.error('Async test error:', err);
    process.exit(1);
  });








