CREATE TABLE stock_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  snapshot    jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON stock_items FOR ALL USING (auth.uid() = user_id);
