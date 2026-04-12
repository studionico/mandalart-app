# データモデル設計

## テーブル構成

並列展開に対応するため、「グリッド」と「セル」を分離した 2 層構造を採用する。

```
mandalarts（ボード）
  └── grids（3×3 ユニット）
        └── cells（1 マス）
              └── grids（子グリッド ← parent_cell_id で紐付け）
                    └── cells ...
```

---

## テーブル定義

### mandalarts

マンダラート全体を表すボード。

```sql
CREATE TABLE mandalarts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE mandalarts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON mandalarts FOR ALL USING (auth.uid() = user_id);
```

### grids

3×3 の 1 ユニット。ルート階層は `parent_cell_id = NULL`、掘り下げ時は親セルの ID を指す。

```sql
CREATE TABLE grids (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mandalart_id   uuid        NOT NULL REFERENCES mandalarts ON DELETE CASCADE,
  parent_cell_id uuid        REFERENCES cells ON DELETE CASCADE,  -- NULL = ルート
  sort_order     integer     NOT NULL DEFAULT 0,  -- 並列順序（← → の表示順）
  memo           text,                             -- Markdown メモ
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 同一 parent_cell_id 内での並列順序
CREATE INDEX idx_grids_parent_cell ON grids (parent_cell_id, sort_order);

-- RLS（mandalarts 経由でユーザー確認）
ALTER TABLE grids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON grids FOR ALL USING (
    EXISTS (
      SELECT 1 FROM mandalarts
      WHERE mandalarts.id = grids.mandalart_id
        AND mandalarts.user_id = auth.uid()
    )
  );
```

### cells

グリッド内の 1 マス（0〜8 の position で位置を管理）。

```sql
CREATE TABLE cells (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id     uuid        NOT NULL REFERENCES grids ON DELETE CASCADE,
  position    integer     NOT NULL CHECK (position BETWEEN 0 AND 8),
  text        text        NOT NULL DEFAULT '',
  image_path  text,       -- Supabase Storage のパス（NULL = 画像なし）
  color       text,       -- プリセットカラーのキー（NULL = デフォルト）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (grid_id, position)
);

-- RLS（grids → mandalarts 経由でユーザー確認）
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
```

### stock_items

ストックエリアのアイテム。セル＋サブツリーの JSON スナップショットを永続保存。

```sql
CREATE TABLE stock_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  snapshot    jsonb       NOT NULL,  -- セル + サブツリー全体の JSON
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可"
  ON stock_items FOR ALL USING (auth.uid() = user_id);
```

---

## position の定義

```
position の対応:
┌───┬───┬───┐
│ 0 │ 1 │ 2 │
├───┼───┼───┤
│ 3 │ 4 │ 5 │   4 = 中心セル
├───┼───┼───┤
│ 6 │ 7 │ 8 │
└───┴───┴───┘
```

---

## snapshot の JSON 構造（stock_items）

```json
{
  "cell": {
    "text": "健康",
    "image_path": null,
    "color": "blue-100"
  },
  "children": [
    {
      "grid": {
        "sort_order": 0,
        "memo": "## メモ\n- ポイント1"
      },
      "cells": [
        { "position": 4, "text": "食事", "image_path": null, "color": null },
        { "position": 0, "text": "野菜", "image_path": null, "color": null }
      ],
      "children": []
    }
  ]
}
```

---

## Supabase Storage

### バケット構成

| バケット名 | 公開設定 | 用途 |
|-----------|---------|------|
| `cell-images` | 非公開（認証必須） | セルの画像ファイル |

### パス設計

```
cell-images/{user_id}/{mandalart_id}/{cell_id}/{filename}
```

- `user_id`: RLS と同じユーザー分離
- `mandalart_id`: マンダラート削除時に一括削除しやすくする
- `cell_id`: セル削除時に対応ファイルを特定しやすくする

### Storage ポリシー

```sql
-- アップロード: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみアップロード可"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 読み取り: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみ読み取り可"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 削除: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみ削除可"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'cell-images' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## Realtime 設定

`cells` テーブルと `grids` テーブルの変更を Supabase Realtime でサブスクライブし、複数デバイス間のリアルタイム同期を実現する。

```sql
-- Replication を有効化
ALTER TABLE grids  REPLICA IDENTITY FULL;
ALTER TABLE cells  REPLICA IDENTITY FULL;
```

---

## updated_at の自動更新

```sql
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
```

---

## 将来的な拡張カラム（今回は追加しない）

```sql
-- 共有機能（将来）
ALTER TABLE mandalarts ADD COLUMN is_public boolean DEFAULT false;
ALTER TABLE mandalarts ADD COLUMN share_token text UNIQUE;
```
