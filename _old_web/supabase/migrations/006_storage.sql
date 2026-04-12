-- cell-images バケット（非公開）
INSERT INTO storage.buckets (id, name, public)
VALUES ('cell-images', 'cell-images', false)
ON CONFLICT (id) DO NOTHING;

-- アップロード: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみアップロード可"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'cell-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 読み取り: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみ読み取り可"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'cell-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 削除: 自分の user_id パス以下のみ
CREATE POLICY "自分のファイルのみ削除可"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'cell-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
