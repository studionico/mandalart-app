CREATE TABLE cells (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id     uuid        NOT NULL REFERENCES grids ON DELETE CASCADE,
  position    integer     NOT NULL CHECK (position BETWEEN 0 AND 8),
  text        text        NOT NULL DEFAULT '',
  image_path  text,
  color       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (grid_id, position)
);

ALTER TABLE cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON cells FOR ALL USING (
    EXISTS (
      SELECT 1 FROM grids
      JOIN mandalarts ON mandalarts.id = grids.mandalart_id
      WHERE grids.id = cells.grid_id
        AND mandalarts.user_id = auth.uid()
    )
  );

ALTER TABLE cells REPLICA IDENTITY FULL;
