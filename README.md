# Erlangly — Workforce Management Engineering Suite

[![Architecture: Zero Build Step](https://img.shields.io/badge/Architecture-Zero%20Build%20Step-00d2d3?style=flat-square)](#architecture)
[![Math: Erlang C Numerical Engine](https://img.shields.io/badge/Math-Erlang%20C%20Engine-10b981?style=flat-square)](#the-queueing-theory-math-engine)
[![Tests: 322/322 Passed](https://img.shields.io/badge/Tests-322%2F322%20Passed-10b981?style=flat-square)](#automated-test-suite)
[![Persistence: Supabase RLS](https://img.shields.io/badge/Persistence-Supabase%20Postgres%20%2B%20RLS-38bdf8?style=flat-square)](#persistence--accounts)
[![UI: Dark Control Room](https://img.shields.io/badge/Theme-Dark%20Control%20Room-f59e0b?style=flat-square)](#design-system)

**Erlangly** is a high-performance, static workforce management (WFM) engineering toolkit and portfolio suite for contact centers and operations teams. It packages five specialized WFM modules — **Demand Forecasting**, **Capacity Planning**, **Shift Scheduling & FTE Conversion**, **Real-Time Intraday Queue Control & VTO**, and a **Strategic Workforce Planning Simulator** — powered by a single pure queueing math engine, persistent cloud accounts, multi-user collaboration, and probabilistic simulation.

---

## 🌟 Key Features

### 1. ⚡ Capacity Planning (`capacity.html`)
- **Single-Interval Erlang C Solver**: Dynamic range sliders and precision numeric inputs with real-time recalculation of base headcount, shrinkage-adjusted staffed agents, SLA %, ASA (s), and agent occupancy %.
- **Multi-Queue & Skill Routing Engine**: Four routing strategies (`Siloed Dedicated`, `⚡ Overflow Routing`, `🎯 Skill-Based Flex Tier`, and `🌐 Full Blended Pool`) with wait overflow thresholds, specialist split levers, and pooling efficiency gain analysis.
- **Headcount Sensitivity Table**: Interactive $\pm 3$ agents sensitivity analysis displaying queue metrics at adjacent staffing levels.
- **Bulk CSV Interval Upload**: Multi-interval day/week upload supporting custom delimiters, quotes, error tolerance, and downloadable sample templates.
- **Direct Scheduling Handoff**: 1-click export passing required interval staffing directly into the Scheduling module.

### 2. 📈 Demand Forecasting (`forecasting.html`)
- **Statistical Model Zoo**: Simple Exponential Smoothing (SES), Holt's Double Exponential Smoothing, Additive & Multiplicative Seasonal Decomposition, Linear Regression with detrending, and Year-over-Year (YoY) Seasonal Trend Projection.
- **Out-of-Sample Backtesting & Accuracy Tracking**: Walk-forward holdout validation computing MAPE, volume-weighted WAPE %, and signed bias % across multiple forecast runs.
- **Interactive Holdout Sandbox**: Test algorithms against specific historical months with strict before-only training windows (no future data leakage) and 1-click winning model carryover.
- **Holiday & Event Flagging**: Multiplicative demand adjustments for known calendar spikes and events.
- **Large Dataset Streaming Web Worker (`js/workers/csv-parser.js`)**: Non-blocking chunked Web Worker parsing capable of aggregating 200,000+ interval rows in under 100ms.

### 3. 🗓️ Scheduling & FTE Converter (`scheduling.html`)
- **Forecast $\to$ Required FTE Converter**: Translates interval workload into net/gross staff-hours, calculates required FTE based on configurable standard work weeks (e.g. 40.0h or 37.5h), and accounts for part-time staffing mix % and shrinkage.
- **Labor Rules & Constraint Engine**: Max daily hours (10h), max weekly hours (40h), minimum rest period between shifts ($\ge 11$h anti-clopening guard), and variable-length break schedules (4h, 6h, 8.5h, 10h).
- **Multi-Day Constraint-Aware Shift Optimizer**: Integer greedy coverage optimizer balancing coverage requirements against hard labor rules and agent availability preferences.
- **Schedule Audit & Infeasibility Diagnostics**: Live audit engine highlighting rule breaches on manual overrides and pinpointing staffing bottlenecks.

### 4. ⏱️ Real-Time / Intraday & VTO Calculator (`realtime.html`)
- **Mobile-Optimized Command Center**: Responsive single-column layout with touch swipe gesture navigation and collapsible day-to-date scorecard.
- **Client-Side Live Data Feed Connector**: Automatic polling of external JSON/CSV feeds with stale-data detection, connection diagnostics, and built-in synthetic demo streams.
- **"Simulate the Day" Shift Stepper**: Step through 24 intraday intervals with Play/Pause auto-advance, step forward/back, and jump controls.
- **Guarded VTO Calculator**: Identifies surplus intervals and computes maximum safe Voluntary Time Off allocations with configurable SLA protection buffers, occupancy ceilings, and per-interval caps.
- **Inline VTO Approval**: Interactive "+1 Approve" / "-1 Revoke" controls that live-recalculate projected SLA and track daily labor cost savings.

### 5. 🎯 Workforce Planning Simulator (`simulator.html`)
- **Monte Carlo Probabilistic Simulation**: 500-iteration stochastic engine executing client-side in $<30$ms using Box-Muller Normal and Uniform distributions across volume, AHT, attrition, and hiring variability.
- **Confidence Band Visualizer**: Shaded $P10\text{–}P90$ and $P25\text{–}P75$ confidence intervals with $P50$ median trajectory and worst-case SLA breach markers.
- **Queue Architecture & Pooling Gain Levers**: Incorporates multi-skill flex gains directly into multi-year strategic hiring and budget models.
- **Strategic Workforce Levers**: Volume growth %, AHT drift %, monthly attrition %, new-hire batch sizing, time-to-productivity nesting lag (0, 1, or 2 months), hourly loaded labor rate, and budget ceilings.
- **Executive Narrative Generator**: Automatically generates plain-language business-case prose for leadership presentations.

### 6. 💾 Accounts, Persistence & Collaboration (`plans.html`, `login.html`)
- **Three-Tier Role Permission Model**: **Owner** (full control, share, delete), **Editor** (modify and save), and **Viewer** (read-only inspect/export) backed by Supabase Postgres Row Level Security (RLS).
- **Optimistic Concurrency Conflict Resolution**: Detects concurrent teammate saves via `updated_at` timestamps with interactive conflict resolution (*Overwrite*, *Discard & Reload*, *Save as New*).
- **Immutable Version History & Visual Diffing**: Automatic version snapshots on save (`v1, v2, v3...`) with side-by-side color-coded parameter diffing and 1-click rollback.
- **Team Invitations & Quick Share Links**: Invite collaborators by email or generate instant preview URLs.

---

## 🧮 The Queueing Theory Math Engine

All calculations across Erlangly call into a single, pure mathematical engine in [`js/erlang.js`](js/erlang.js). No math is ever duplicated or hand-rolled in UI files.

### 1. Traffic Intensity (Erlangs)
$$A = \frac{\text{Volume} \times \text{AHT}}{\text{Interval Seconds}}$$

### 2. Numerically Stable Erlang B Loss Probability
$$B(0, A) = 1.0$$
$$B(k, A) = \frac{A \cdot B(k-1, A)}{k + A \cdot B(k-1, A)} \quad \text{for } k = 1, 2, \dots, m$$

### 3. Erlang C Delay Probability (Wait Probability)
$$P_w = C(m, A) = \frac{B(m, A)}{1 - \frac{A}{m}\left(1 - B(m, A)\right)} \quad \text{for } m > A$$

### 4. Service Level (Probability Wait Time $\le T$)
$$\text{SL}(m, A, \text{AHT}, T) = 1 - P_w \cdot e^{-(m - A) \cdot \frac{T}{\text{AHT}}}$$

### 5. Average Speed of Answer (ASA)
$$\text{ASA} = \frac{P_w \cdot \text{AHT}}{m - A}$$

### 6. Multi-Queue Overflow & Skill-Based Routing
- **Overflow Tail Probability**: $P(W > t) = P_C \cdot e^{-(c\mu - \lambda)t}$
- **Pooling Monotonicity**: $N_{\text{pooled}} \le N_{\text{multi-queue}} \le N_{\text{siloed}}$

---

## 📁 Repository Structure

```
/index.html              Landing page with interactive Erlang C mini-calculator hero
/forecasting.html         Forecasting tool (statistical models, backtesting, accuracy, sandbox)
/capacity.html            Capacity planning tool (single/bulk Erlang C, multi-queue & skill routing)
/scheduling.html          Scheduling tool (FTE converter + labor rules & shift optimizer)
/realtime.html            Real-time / Intraday tool (mobile swipe, live data feeds, VTO calculator)
/simulator.html           Workforce Planning Simulator (Monte Carlo, confidence bands, pooling levers)
/plans.html               "My Plans" dashboard (role permissions, version history, visual diffs)
/login.html               Sign up / log in
/css/styles.css           shared design tokens + all styling
/js/erlang.js             shared Erlang C math engine (pure numerical library, overflow & skill routing)
/js/main.js               shared nav/CSV/file-drop helpers
/js/supabaseClient.js     Supabase client init (with offline localStorage mock engine)
/js/auth.js               auth helpers
/js/plans.js              persistence, collaboration, version snapshotting, and visual diffing
/js/<tool>.js             one per tool page (capacity.js, forecasting.js, scheduling.js, realtime.js, simulator.js)
/js/workers/csv-parser.js large-CSV Web Worker
/sql/schema.sql           Postgres schema + RLS policies (plans, plan_collaborators, plan_versions)
/test/run-tests.js        automated math and functional verification suite (322 tests)
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

### Test Suite Coverage (322 Tests Passing):
- **Traffic Intensity Calculations**: Accurate Erlangs conversion, zero volume, zero AHT, and negative edge cases.
- **Reference Table Point Verification**: $A=100, m=110, \text{AHT}=180\text{s}, T=20\text{s} \implies B=0.0275, P_w=0.2370, \text{ASA}=4.27\text{s}, \text{SL}=92.2\%$.
- **Strict Monotonicity & Robustness**: Monotonicity of SLA, ASA, and Occupancy across all staffing counts and boundary conditions.
- **Advanced Forecasting Models**: SES, Holt's, Additive/Multiplicative decomposition, regression, YoY projection, out-of-sample backtesting, and accuracy metrics (MAPE, WAPE, bias).
- **Scheduling Labor Rules**: Break schedules, anti-clopening 11h rest checks, max hours, and constraint optimizer.
- **Monte Carlo Probability Engine**: Sampling distributions, 500-iteration benchmark ($<30$ms), and monotonic confidence bands ($P10 \le P25 \le P50 \le P75 \le P90$).
- **Multi-Queue Routing**: Overflow routing math, threshold monotonicity, skill-based flex pooling gain, and parameter diffing.
- **Collaboration & Security**: 3-tier role permissions, optimistic locking conflict detection, and immutable version snapshots.

---

## 🔒 Security & Persistence Architecture

- **Client-Side Only Supabase Integration**: Only the public Supabase `anon` key ever ships to the client. The administrative `service_role` key never exists in this repository.
- **Row Level Security (RLS)**: Enabled on all tables (`sql/schema.sql`). Policies enforce `auth.uid() = user_id` for personal plans and join-table checks for shared collaborators.
- **Guest / Sandbox Mode**: Erlangly provides a local sandbox fallback so that all calculator features, shift optimizers, and saved plan dashboards work offline and out-of-the-box even without a configured live Supabase project.

---

## 🗺️ Roadmap Status (v1 & v2 Complete)

Both **v1 (Phases 0–7)** and **v2 (Phases 8–13)** are 100% complete and signed off:

| Phase | Name | Status | Highlights |
|---|---|---|---|
| **0–7** | **v1 Core WFM Suite** | ✅ Complete | 5 core tools, shared Erlang C engine, Supabase accounts, portfolio polish |
| **8** | Advanced Forecasting Models | ✅ Complete | Pluggable model architecture, seasonal decomposition, SES, Holt's, holiday flags |
| **9** | Scheduling Labor Rules | ✅ Complete | Max hours, rest periods, anti-clopening, variable breaks, constraint optimizer |
| **10** | Enhanced Simulation & Real-Time | ✅ Complete | Monte Carlo 500 iterations, confidence bands, mobile real-time view, live data feed |
| **11** | Collaboration & Multi-Skill Routing | ✅ Complete | Shared plans with roles, optimistic locking, version diffing, overflow & skill routing |
| **12** | Forecasting Enhancements II | ✅ Complete | YoY seasonal trend model, walk-forward backtesting, forecast accuracy tracker |
| **13** | Forecast Holdout Sandbox | ✅ Complete | Target month picker, before-only training window, winning model carry-over |

**Upcoming Tracks (v3–v6 Product Strategy)**:
- **Phase 14**: Quick Wins & Polish (Dark/light theme toggle, inline tooltips, validation preview)
- **Phases 15–16 (v3)**: AI Forecasting & Insights, Advanced Visualizations & Performance
- **Phase 17 (v4)**: Team Collaboration & Workspaces
- **Phase 18 (v5)**: Enterprise Readiness (API, SSO, Multi-tenancy)
- **Phase 19 (v6)**: Ecosystem & Integrations (Third-party connectors, BI export, PWA)

---

## 📄 License & Attribution

Built with queueing theory principles for workforce management practitioners. Released under the MIT License.
