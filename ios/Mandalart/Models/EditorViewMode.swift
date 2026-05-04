import Foundation

/// EditorView の表示モード。3×3 (= 編集 / drill 可能) と 9×9 (= 全 81 セル俯瞰、view-only)。
///
/// 9×9 view では tap / longPress / drill / 編集が全て NOOP になり、観察専用となる
/// (= [`requirements.md`](../../docs/requirements.md) / desktop と同等)。
/// 編集には 3×3 へ切替が必須。toggle ボタンは EditorView 内 UI で出す。
enum EditorViewMode: Equatable {
    case grid3x3
    case grid9x9
}
