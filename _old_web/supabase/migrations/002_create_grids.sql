CREATE TABLE grids (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandalart_id   uuid        NOT NULL REFERENCES mandalarts ON DELETE CASCADE,
  parent_cell_id uuid        REFERENCES cells ON DELETE CASCADE,
  sort_order     integer     NOT NULL DEFAULT 0,
  memo           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_grids_parent_cell ON grids (parent_cell_id, sort_order);

ALTER TABLE grids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON grids FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mandalarts
      WHERE mandalarts.id = grids.mandalart_id
        AND mandalarts.user_id = auth.uid()
    )
  );

ALTER TABLE grids REPLICA IDENTITY FULL;
