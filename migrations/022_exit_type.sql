-- 022_exit_type.sql — Structured exit classification
--
-- Records HOW a position was closed so the Performance page can surface
-- an exit-type breakdown. Prior positions used free-text reasoning; the
-- UPDATE below classifies them from the existing text where possible.
-- Going forward the engine writes the tag explicitly on every close.

ALTER TABLE ai_positions
  ADD COLUMN IF NOT EXISTS exit_type TEXT;

-- Backfill from the reasoning column on existing closed positions.
-- Order matters: more specific patterns first.
UPDATE ai_positions
  SET exit_type = CASE
    WHEN exit_type IS NOT NULL          THEN exit_type
    WHEN reasoning_src ILIKE '%partial take-profit%' THEN 'partial'
    WHEN reasoning_src ILIKE '%breakeven stop%'      THEN 'breakeven'
    WHEN reasoning_src ILIKE '%trailing stop%'       THEN 'trailing'
    WHEN reasoning_src ILIKE '%stop-loss%'           THEN 'stop_loss'
    WHEN reasoning_src ILIKE '%take-profit%'         THEN 'take_profit'
    WHEN reasoning_src ILIKE '%soft stop%'           THEN 'soft_stop'
    WHEN reasoning_src ILIKE '%stagnant%'            THEN 'stagnant'
    ELSE 'unknown'
  END
FROM (
  SELECT ap.id AS pos_id, d.reasoning AS reasoning_src
  FROM ai_positions ap
  LEFT JOIN decisions d
    ON  d.ticker    = ap.ticker
    AND d.action    = 'sell'
    AND d.timestamp = ap.closed_at
    AND d.user_id   = ap.user_id
  WHERE ap.status = 'closed' AND ap.exit_type IS NULL
) sub
WHERE ai_positions.id = sub.pos_id;
