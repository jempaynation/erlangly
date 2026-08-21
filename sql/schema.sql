-- ============================================================================
-- ERLANGLY DATABASE SCHEMA & ROW LEVEL SECURITY (RLS)
-- File: sql/schema.sql
-- ============================================================================

-- 1. Create the `plans` table for cross-tool persistence
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

-- 2. Indexes for efficient lookup on `plans`
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans (user_id);
CREATE INDEX IF NOT EXISTS idx_plans_tool ON public.plans (tool);
CREATE INDEX IF NOT EXISTS idx_plans_created_at ON public.plans (created_at DESC);

-- 3. Enable Row Level Security (RLS) on `plans`
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- 4. Create `plan_collaborators` table (Phase 11)
CREATE TABLE IF NOT EXISTS public.plan_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_plan_collaborator UNIQUE (plan_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_collab_plan_id ON public.plan_collaborators (plan_id);
CREATE INDEX IF NOT EXISTS idx_collab_user_id ON public.plan_collaborators (user_id);
CREATE INDEX IF NOT EXISTS idx_collab_user_email ON public.plan_collaborators (user_email);

ALTER TABLE public.plan_collaborators ENABLE ROW LEVEL SECURITY;

-- 5. Create `plan_versions` table for immutable version history (Phase 11)
CREATE TABLE IF NOT EXISTS public.plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_plan_version UNIQUE (plan_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_versions_plan_id ON public.plan_versions (plan_id);
CREATE INDEX IF NOT EXISTS idx_versions_created_at ON public.plan_versions (created_at DESC);

ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Policies for `plans`
DROP POLICY IF EXISTS "Users can view their own plans" ON public.plans;
CREATE POLICY "Users can view owned or shared plans"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_collaborators.plan_id = plans.id
        AND (plan_collaborators.user_id = auth.uid() OR plan_collaborators.user_email = auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Users can create their own plans" ON public.plans;
CREATE POLICY "Users can create their own plans"
  ON public.plans
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own plans" ON public.plans;
CREATE POLICY "Users and editors can update plans"
  ON public.plans
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_collaborators.plan_id = plans.id
        AND (plan_collaborators.user_id = auth.uid() OR plan_collaborators.user_email = auth.jwt() ->> 'email')
        AND plan_collaborators.role = 'editor'
    )
  )
  WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.plan_collaborators
      WHERE plan_collaborators.plan_id = plans.id
        AND (plan_collaborators.user_id = auth.uid() OR plan_collaborators.user_email = auth.jwt() ->> 'email')
        AND plan_collaborators.role = 'editor'
    )
  );

DROP POLICY IF EXISTS "Users can delete their own plans" ON public.plans;
CREATE POLICY "Only plan owners can delete plans"
  ON public.plans
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policies for `plan_collaborators`
CREATE POLICY "Users can view collaborators for plans they can access"
  ON public.plan_collaborators
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_collaborators.plan_id
        AND (
          plans.user_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM public.plan_collaborators pc
            WHERE pc.plan_id = plans.id
              AND (pc.user_id = auth.uid() OR pc.user_email = auth.jwt() ->> 'email')
          )
        )
    )
  );

CREATE POLICY "Only plan owners can insert collaborators"
  ON public.plan_collaborators
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_collaborators.plan_id AND plans.user_id = auth.uid()
    )
  );

CREATE POLICY "Only plan owners can update collaborators"
  ON public.plan_collaborators
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_collaborators.plan_id AND plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_collaborators.plan_id AND plans.user_id = auth.uid()
    )
  );

CREATE POLICY "Only plan owners can delete collaborators"
  ON public.plan_collaborators
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_collaborators.plan_id AND plans.user_id = auth.uid()
    )
  );

-- Policies for `plan_versions`
CREATE POLICY "Users can view versions for plans they can access"
  ON public.plan_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_versions.plan_id
        AND (
          plans.user_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM public.plan_collaborators pc
            WHERE pc.plan_id = plans.id
              AND (pc.user_id = auth.uid() OR pc.user_email = auth.jwt() ->> 'email')
          )
        )
    )
  );

CREATE POLICY "Owners and editors can insert plan versions"
  ON public.plan_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_versions.plan_id
        AND (
          plans.user_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM public.plan_collaborators pc
            WHERE pc.plan_id = plans.id
              AND (pc.user_id = auth.uid() OR pc.user_email = auth.jwt() ->> 'email')
              AND pc.role = 'editor'
          )
        )
    )
  );

-- 6. Auto-update `updated_at` timestamp trigger
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
