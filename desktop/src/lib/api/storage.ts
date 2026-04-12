// デスクトップ版: 画像はローカルファイルシステムに保存
// image_path はアプリデータディレクトリ内の相対パスとして保存

export async function uploadCellImage(
  _userId: string,
  _mandalartId: string,
  cellId: string,
  file: File
): Promise<string> {
  // TODO: Tauri fs プラグインでローカル保存を実装
  // 現在は DataURL をパスとして使用（暫定）
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(`local:${cellId}:${file.name}`)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function getCellImageUrl(path: string): Promise<string> {
  return path
}

export async function deleteCellImage(_path: string): Promise<void> {
  // TODO: ローカルファイル削除
}
