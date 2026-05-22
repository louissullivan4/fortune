-- First-class deterministic decision mode. Lets users opt out of Claude
-- entirely ('deterministic') or fall back to the shared picker when the AI
-- errors or the monthly cost budget is hit ('ai_with_fallback'). Default
-- 'ai' preserves current behaviour for every existing user.

ALTER TABLE user_configs
  ADD COLUMN decision_mode TEXT NOT NULL DEFAULT 'ai'
    CHECK (decision_mode IN ('ai', 'deterministic', 'ai_with_fallback')),
  ADD COLUMN ai_cost_budget_monthly_usd NUMERIC(8,4) NOT NULL DEFAULT 5.0000;
