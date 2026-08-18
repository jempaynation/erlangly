-- ============================================================================
-- ERLANGLY DATABASE SCHEMA & ROW LEVEL SECURITY (RLS)
-- File: sql/schema.sql
-- ============================================================================

-- 1. Create the single `plans` table for cross-tool persistence
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL, -- 'capacity' | 'forecasting' | 'scheduling' | 'realtime' | 'simulation'
  name TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans (user_id);
CREATE INDEX IF NOT EXISTS idx_plans_tool ON public.plans (tool);
CREATE INDEX IF NOT EXISTS idx_plans_created_at ON public.plans (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies: Restrict every operation to the authenticated owning user

-- Policy: Select (Users can only view their own plans)
CREATE POLICY "Users can view their own plans"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Insert (Users can only insert plans owned by themselves)
CREATE POLICY "Users can create their own plans"
  ON public.plans
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Update (Users can only update their own plans)
CREATE POLICY "Users can update their own plans"
  ON public.plans
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Delete (Users can only delete their own plans)
CREATE POLICY "Users can delete their own plans"
  ON public.plans
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Auto-update `updated_at` timestamp trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_plans_updated_at ON public.plans;
CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
