# Erlangly — Workforce Management Engineering Suite

[![Architecture: Zero Build Step](https://img.shields.io/badge/Architecture-Zero%20Build%20Step-00d2d3?style=flat-square)](#architecture)
[![Math: Erlang C Numerical Engine](https://img.shields.io/badge/Math-Erlang%20C%20Engine-10b981?style=flat-square)](#the-queueing-theory-math-engine)
[![Tests: 29/29 Passed](https://img.shields.io/badge/Tests-29%2F29%20Passed-10b981?style=flat-square)](#automated-test-suite)
[![Persistence: Supabase RLS](https://img.shields.io/badge/Persistence-Supabase%20Postgres%20%2B%20RLS-38bdf8?style=flat-square)](#persistence--accounts)
[![UI: Dark Control Room](https://img.shields.io/badge/Theme-Dark%20Control%20Room-f59e0b?style=flat-square)](#design-system)

**Erlangly** is a high-performance, static workforce management (WFM) engineering toolkit and portfolio suite for contact centers and operations teams. It packages five specialized WFM modules — **Demand Forecasting**, **Capacity Planning**, **Shift Scheduling & FTE Conversion**, **Real-Time Intraday Queue Control & VTO**, and a **Strategic Workforce Planning Simulator** — powered by a single pure queueing math engine and persistent cloud accounts.

---

## 🌟 Key Features

### 1. ⚡ Capacity Planning (`capacity.html`)
- **Single-Interval Erlang C Solver**: Dynamic range sliders and precision numeric inputs with real-time recalculation of base headcount, shrinkage-adjusted staffed agents, SLA %, ASA (s), and agent occupancy %.
- **Headcount Sensitivity Table**: Interactive $\pm 3$ agents sensitivity analysis displaying queue metrics at adjacent staffing levels.
- **Bulk CSV Interval Upload**: Multi-interval day/week upload supporting custom delimiters, quotes, error tolerance, and downloadable sample templates.
- **Direct Scheduling Handoff**: 1-click export passing required interval staffing directly into the Scheduling module.

### 2. 📈 Demand Forecasting (`forecasting.html`)
- **Forecasting Algorithms**: Weighted Moving Average (WMA), Simple Moving Average (SMA), and Linear Trend Projection (OLS).
- **Day-of-Week Seasonality ($S_d$)**: Multiplicative seasonal indexing with customizable planning horizons and growth multipliers.
- **Large Dataset Streaming Web Worker (`js/workers/csv-parser.js`)**: Non-blocking chunked Web Worker parsing capable of aggregating 200,000+ interval rows in under 100ms.
- **Interactive Dual-Curve Chart**: Visualizes historical volume against projected forecasts with Chart.js.

### 3. 🗓️ Scheduling & FTE Converter (`scheduling.html`)
- **Forecast $\to$ Required FTE Converter**: Translates interval workload into net/gross staff-hours, calculates required FTE based on configurable standard work weeks (e.g. 40.0h or 37.5h), and accounts for part-time staffing mix % and shrinkage.
- **Daily Staffing Breakdown**: Day-of-week demand distributions with CSV export.
- **Shift Pattern Allocator**: Configurable shift lengths, unpaid meal break placement, and net paid hours.
- **Integer Greedy Coverage Optimizer**: Optimizes shift headcount allocation to eliminate understaffing gaps while minimizing surplus waste.
- **Coverage Visualizer**: Stepped demand curve vs. scheduled headcount area with gap analysis.

### 4. ⏱️ Real-Time / Intraday & VTO Calculator (`realtime.html`)
- **"Simulate the Day" Shift Stepper**: Step through 24 intraday intervals with Play/Pause auto-advance, step forward/back, and jump controls.
- **Live Queue Command Console**: Real-time tracking of actual SLA %, ASA wait times, occupancy %, volume variances, and staffing adherence %.
- **Day-to-Date Performance Scorecard**: Cumulative volume variance, weighted SLA %, average ASA, and adherence alerts.
- **Guarded VTO Calculator**: Identifies surplus intervals and computes maximum safe Voluntary Time Off allocations with configurable SLA protection buffers, occupancy ceilings, and per-interval caps.
- **Inline VTO Approval**: Interactive "+1 Approve" / "-1 Revoke" controls that live-recalculate projected SLA and track daily labor cost savings.

### 5. 🎯 Workforce Planning Simulator (`simulator.html`)
- **Multi-Period What-If Strategic Simulation**: 6, 12, and 24-month horizon simulations driven by the shared Erlang C engine.
- **Strategic Workforce Levers**: Volume growth %, AHT drift %, monthly attrition %, new-hire batch sizing, time-to-productivity nesting lag (0, 1, or 2 months), hourly loaded labor rate, and budget ceilings.
- **Multi-Scenario Comparative Visualizer**: Compares Scenario A (Status Quo), Scenario B (Aggressive Hiring), and Scenario C (Budget Capped) simultaneously.
- **Automated Breach Detection**: Pinpoints the exact month where a scenario drops below the 80% SLA threshold or exceeds monthly budget caps.
- **Executive Narrative Generator**: Automatically generates plain-language business-case prose for leadership presentations.

### 6. 💾 Accounts, Persistence & Sharing (`plans.html`, `login.html`)
- **Persistent Plans Dashboard**: Save, list, rename, delete, and re-open workforce models across all five tools.
- **1-Click Shareable Read-Only Links**: Generate standalone preview links (`?shared=1&data=...`) allowing stakeholders to view plans without logging in.
- **Row Level Security (RLS)**: Client-side Supabase authentication and database integration with strict per-user data isolation.

---

## 🧮 The Queueing Theory Math Engine

All calculations across Erlangly call into a single, pure mathematical engine in [`js/erlang.js`](js/erlang.js). No math is ever duplicated or hand-rolled in UI files.

### 1. Traffic Intensity (Erlangs)
$$A = \frac{\text{Volume} \times \text{AHT}}{\text{Interval Seconds}}$$

### 2. Numerically Stable Erlang B Loss Probability
Traditional Erlang formulas involve factorials ($m!$) which overflow standard 64-bit floating point numbers when $m > 170$. Erlangly utilizes the numerically stable continuous downward recursion:
$$B(0, A) = 1.0$$
$$B(k, A) = \frac{A \cdot B(k-1, A)}{k + A \cdot B(k-1, A)} \quad \text{for } k = 1, 2, \dots, m$$

### 3. Erlang C Delay Probability (Wait Probability)
$$P_w = C(m, A) = \frac{B(m, A)}{1 - \frac{A}{m}\left(1 - B(m, A)\right)} \quad \text{for } m > A$$

### 4. Service Level (Probability Wait Time $\le T$)
$$\text{SL}(m, A, \text{AHT}, T) = 1 - P_w \cdot e^{-(m - A) \cdot \frac{T}{\text{AHT}}}$$

### 5. Average Speed of Answer (ASA)
$$\text{ASA} = \frac{P_w \cdot \text{AHT}}{m - A}$$

### 6. Agent Occupancy
$$\text{Occ} = \frac{A}{m}$$

### 7. Shrinkage Scaling (Gross Headcount)
$$\text{Staffed Agents} = \left\lceil \frac{\text{Base Agents}}{1 - \text{Shrinkage Fraction}} \right\rceil$$

---

## 📁 Repository Structure

```
/index.html              Landing page with interactive Erlang C mini-calculator hero
/capacity.html           Capacity planning tool (single-interval + bulk CSV)
/forecasting.html        Demand forecasting tool (WMA, SMA, Trend, Seasonality)
/scheduling.html         Scheduling tool (FTE converter + shift coverage optimizer)
/realtime.html           Real-time intraday monitoring & guarded VTO calculator
/simulator.html          Workforce planning simulator (what-if scenarios & nesting lag)
/plans.html              "My Plans" saved data dashboard & shareable link creator
/login.html              Sign up / Sign in authentication page
/css/styles.css          Unified dark "control room" design system and CSS tokens
/js/erlang.js            Core queueing math engine (Erlang B/C, SLA, ASA, Multi-skill)
/js/main.js              Shared utilities (nav, RFC-4180 CSV, file drop, toasts, handoff)
/js/supabaseClient.js    Supabase client init with public anon key & mock sandbox
/js/auth.js              Client-side authentication & session helpers
/js/plans.js             Plan persistence (save, list, load, rename, delete, share modal)
/js/workers/csv-parser.js Web Worker for chunked streaming of 100k+ row CSVs
/sql/schema.sql          PostgreSQL schema & Row Level Security (RLS) policies
/test/run-tests.js       Automated math & queueing verification suite (29 tests)
/test/test-large-csv.js  Performance test verifying 200k-row Web Worker parser
/PROJECT_MAP.md          Project orientation & navigation guide
/FEATURES.md             Feature specifications
/ROADMAP.md              Roadmap status and phase tracker
/CHANGELOG.md            Append-only record of completed phases
```

---

## 🚀 Running Locally

Erlangly requires **no build step, no npm install, and no local compile process**.

You can run Erlangly using any static file server:

```bash
# Using Python 3
python3 -m http.server 8080

# Or using Node http-server (if installed)
npx http-server -p 8080
```

Then open your browser to `http://localhost:8080`.

---

## 🧪 Automated Test Suite

Run the automated mathematical and functional test suite with Node.js:

```bash
node test/run-tests.js
```

### Test Suite Coverage:
- **Traffic Intensity Calculations**: Accurate Erlangs conversion, zero volume, zero AHT, and negative edge cases.
- **Reference Table Point Verification**: $A=100, m=110, \text{AHT}=180\text{s}, T=20\text{s} \implies B=0.0275, P_w=0.2370, \text{ASA}=4.27\text{s}, \text{SL}=92.2\%$.
- **Strict Monotonicity**: Verifies that increasing server count strictly increases SLA %, strictly decreases ASA, and strictly decreases occupancy across all operational ranges.
- **Boundary & Overload States**: Graceful degradation under unstable queues ($m \le A$), zero volume, and extreme shrinkage ($\ge 100\%$).
- **Multi-Constraint Solver (`agentsRequired`)**: Multi-variable constraint solver meeting both SLA and Occupancy thresholds simultaneously.
- **Multi-Skill Pooling Efficiency**: Verifies Erlang staffing savings when consolidating siloed queues into unified multi-skilled pools.

---

## 🔒 Security & Persistence Architecture

- **Client-Side Only Supabase Integration**: Only the public Supabase `anon` key ever ships to the client. The administrative `service_role` key never exists in this repository.
- **Row Level Security (RLS)**: Enabled on all tables (`sql/schema.sql`). Policies enforce `auth.uid() = user_id` for SELECT, INSERT, UPDATE, and DELETE.
- **Guest / Sandbox Mode**: Erlangly provides a local sandbox fallback so that all calculator features, shift optimizers, and saved plan dashboards work offline and out-of-the-box even without a configured live Supabase project.

---

## 📄 License & Attribution

Built with queueing theory principles for workforce management practitioners. Released under the MIT License.
