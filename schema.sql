CREATE TABLE IF NOT EXISTS app_state (
  state_id integer PRIMARY KEY DEFAULT 1,
  state_json jsonb NOT NULL DEFAULT '{"members":[],"dues":[],"paid":[],"remits":[],"globalDues":[],"deptLogos":{}}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_state(state_id) VALUES (1) ON CONFLICT (state_id) DO NOTHING;
