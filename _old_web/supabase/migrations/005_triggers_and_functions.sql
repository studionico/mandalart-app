-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_mandalarts
  BEFORE UPDATE ON mandalarts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_grids
  BEFORE UPDATE ON grids
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_cells
  BEFORE UPDATE ON cells
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 全文検索インデックス（セル検索用）
CREATE INDEX idx_cells_text ON cells USING gin(to_tsvector('simple', text));
