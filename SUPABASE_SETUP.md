# Supabase Setup & Online Collaboration Guide

This guide walks you through connecting your live **Supabase** backend to **Erlangly** on **Vercel** to enable cloud persistence, user accounts, and real-time team collaboration across all five WFM tools.

---

## 1. Architecture & Security Rules

- **Zero-Build-Step**: Erlangly runs entirely in the browser (Vanilla JS + HTML5). The browser communicates directly with Supabase Postgres & Auth using the official CDN build.
- **Client-Side Keys**: Only your **Supabase Project URL** and **Public Anon Key** are used client-side. Supabase is designed for this architecture.
- **Service Role Key**: The `service_role` key must **NEVER** be committed or used in client-side code.
- **Row Level Security (RLS)**: Access control is enforced at the database level inside PostgreSQL via `sql/schema.sql`.

---

## 2. Step-by-Step Supabase Setup

### Step 1: Create a Supabase Project
1. Go to [https://supabase.com](https://supabase.com) and sign in.
2. Click **"New Project"**.
3. Enter a Project Name (e.g. `erlangly-wfm`), choose a secure database password, and select your nearest region.
4. Click **"Create new project"** and wait ~1 minute for provisioning.

---

### Step 2: Run the Database Schema in SQL Editor
1. In your Supabase Dashboard, navigate to the **SQL Editor** tab (icon on the left sidebar).
2. Click **"New query"**.
3. Copy the entire contents of [`sql/schema.sql`](file:///home/jdz/Projects/erlangly/sql/schema.sql) from this repository.
4. Paste it into the SQL Editor and click **"Run"** (or `Ctrl+Enter` / `Cmd+Enter`).
5. Verify output shows `Success. No rows returned`.

> [!NOTE]
> `sql/schema.sql` sets up:
> - `plans` table (workforce plans across all 5 tools)
> - `plan_collaborators` table (team roles: Owner, Editor, Viewer)
> - `plan_versions` table (immutable version snapshots and diffs)
> - Security Definer helper functions to prevent PostgreSQL RLS circular recursion
> - Row Level Security policies restricting rows to authorized users

---

### Step 3: Configure Supabase Authentication & Redirect URLs
To ensure email verification links and Magic Links redirect properly back to your Vercel deployment:

1. In Supabase Dashboard, navigate to **Authentication** > **URL Configuration**.
2. **Site URL**: Set to your Vercel production URL, e.g.:
   ```text
   https://erlangly.vercel.app
   ```
3. **Redirect URLs**: Add your production and local URLs to the allowed list:
   ```text
   https://erlangly.vercel.app/*
   https://*.vercel.app/*
   http://localhost:8000/*
   http://localhost:3000/*
   http://127.0.0.1:8000/*
   ```
4. Click **"Save"**.

*(Optional)* **Email Confirmation Setting**:
- In **Authentication** > **Providers** > **Email**, you can choose whether "Confirm email" is required.
- If enabled, new signups will receive an activation email before their first login.

---

### Step 4: Retrieve Project API Credentials
1. In Supabase Dashboard, navigate to **Project Settings** (gear icon) > **API**.
2. Copy your **Project URL** (e.g., `https://abcdefghijklm.supabase.co`).
3. Copy your **Project API Keys** > `anon` / `public` key (starts with `eyJ...`).

---

## 3. Connecting Credentials to Erlangly

You have two convenient ways to connect your Supabase instance:

### Option A: In-App UI (Recommended for Instant Setup)
1. Open your deployed Erlangly website on Vercel (or locally).
2. Go to **"Sign In"** (`login.html`) or **"My Plans"** (`plans.html`).
3. Click the **"⚙️ Settings"** button next to the connection status badge.
4. Paste your **Supabase Project URL** and **Public Anon Key**.
5. Click **"🔍 Test Connection"** to verify that your database tables are reachable.
6. Click **"💾 Save & Connect"**. The app will reload and display **"🟢 Live Supabase Connected"**.

### Option B: Code-Level Configuration in `js/config.js`
If you want every visitor of your Vercel deployment to automatically use your Supabase instance without manual UI configuration:

1. Open [`js/config.js`](file:///home/jdz/Projects/erlangly/js/config.js).
2. Update the values:
   ```javascript
   window.ERLANGLY_CONFIG = {
     SUPABASE_URL: 'https://your-project-ref.supabase.co',
     SUPABASE_ANON_KEY: 'your-public-anon-key-here'
   };
   ```
3. Commit and push to your repository. Vercel will automatically redeploy with the live backend enabled.

---

## 4. Verifying Online Saving & Collaboration

Once connected:

1. **Sign Up / Log In**:
   - Go to `login.html`, toggle to **"Sign Up"**, enter your email and password.
   - Once signed in, your navigation bar will show your profile: `👤 <your-username>`.

2. **Save Plans across Tools**:
   - Open **Capacity Planning** (`capacity.html`), run an Erlang C model, and click **"Save to Plans"**.
   - Open **Forecasting** (`forecasting.html`), generate a projection, and click **"💾 Save Plan"**.
   - Open **Shift Scheduling** (`scheduling.html`), optimize a shift roster, and click **"💾 Save Plan"**.
   - Open **Real-Time** (`realtime.html`), step through intraday intervals, and click **"💾 Save Plan"**.
   - Open **Simulator** (`simulator.html`), run a Monte Carlo simulation, and click **"💾 Save Scenario"**.

3. **Manage & Open Saved Plans**:
   - Open **"My Plans"** (`plans.html`) to view, search, filter, rename, or restore your plans.

4. **Multi-User Collaboration & Roles**:
   - On any plan card in `plans.html`, click **"👥 Team"**.
   - Enter a colleague's email and assign them as **Editor** (can edit and save) or **Viewer** (read-only).
   - When your colleague signs in, the plan will appear under their **"👥 Shared with Me"** tab.
   - If two teammates edit at the same time, Erlangly's **Optimistic Concurrency** engine will detect the conflict and offer options to merge, overwrite, or save as an independent copy.

5. **Version Snapshots & Visual Diffs**:
   - Click **"📜 History"** on any plan card to view previous versions.
   - Click **"🔍 Diff"** to see an exact visual diff of parameters that changed between versions.
   - Click **"↺ Restore"** to roll back to any past version.
