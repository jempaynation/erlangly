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

console.log('\n====================================================');
console.log(`TEST RESULTS: ${passed} Passed, ${failed} Failed`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}






