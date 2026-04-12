CREATE TABLE mandalarts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mandalarts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON mandalarts FOR ALL USING (auth.uid() = user_id);
