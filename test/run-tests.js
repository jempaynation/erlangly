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

console.log('\n====================================================');
console.log(`TEST RESULTS: ${passed} Passed, ${failed} Failed`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}


