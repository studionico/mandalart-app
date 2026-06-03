use tauri::{Emitter, LogicalSize, Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:mandalart.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "initial schema",
                            sql: include_str!("../migrations/001_initial.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "add deleted_at columns for soft delete",
                            sql: include_str!("../migrations/002_soft_delete.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "add done column to cells (checkbox feature)",
                            sql: include_str!("../migrations/003_cell_done.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "unify X and C: replace grids.parent_cell_id with grids.center_cell_id",
                            sql: include_str!("../migrations/004_unify_center.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "drop empty cells (lazy cell creation design)",
                            sql: include_str!("../migrations/005_drop_empty_cells.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "add grids.parent_cell_id for independent parallel centers",
                            sql: include_str!("../migrations/006_parent_cell_id.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 7,
                            description: "add mandalarts.show_checkbox (per-mandalart UI preference, cloud-synced)",
                            sql: include_str!("../migrations/007_mandalart_show_checkbox.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 8,
                            description: "add mandalarts.last_grid_id (last opened sub-grid for restore)",
                            sql: include_str!("../migrations/008_mandalart_last_grid_id.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 9,
                            description: "add mandalarts.sort_order + pinned (Phase A: manual reorder + pin)",
                            sql: include_str!("../migrations/009_mandalart_sort_pin.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 10,
                            description: "add folders table + mandalarts.folder_id (Phase B: folder tabs + Inbox bootstrap)",
                            sql: include_str!("../migrations/010_folders.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 11,
                            description: "add mandalarts.locked (per-mandalart read-only flag, cloud-synced)",
                            sql: include_str!("../migrations/011_mandalart_locked.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        // vault フォルダ選択ダイアログ用 (Phase 2 productize P1)。フォルダ選択のみ使用。
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        // アプリ終了時にウインドウサイズ・位置・最大化状態を自動保存し、
        // 次回起動時に復元する。保存先は OS の AppConfig (macOS なら
        // ~/Library/Application Support/jp.mandalart.app/window-state.json)。
        // 初回起動時はこの state が無いので tauri.conf.json の width/height が使われる。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // メニューバーの OS 標準 Window / Help submenu に独自項目を追加する。
        // 旧実装では独立した「ウィンドウサイズ」「ヘルプ」 submenu を `Menu::default` に
        // append していたが、OS 標準と二重表示になったため (= [Window][Help][ウィンドウサイズ][ヘルプ])、
        // 標準 submenu の **内部** に append する形に変更した。
        // `Menu::default` は OS 言語に関わらず固定で英語名 ("Window" / "Help") の submenu を作るので、
        // text() 比較で確実に拾える。
        .setup(|app| {
            let handle = app.handle();

            // 追加する MenuItem を構築
            let help_show = MenuItem::with_id(handle, "help.show",
                "使い方を見る", true, None::<&str>)?;
            // ウィンドウサイズプリセット (= プリセット 2 種から初期サイズを切替える)。
            // 値の方針: 16:9 完全一致で揃える (1280×720 = HD / 1600×900 = HD+)。
            // - welcome モーダルの `FeatureSlide` 枠 (aspect-video = 16:9) と寸法整合
            // - スクショ撮影時にウィンドウ全体をそのまま撮るだけで切り抜き不要
            // - 9×9 表示でサイドパネル w-72 を引いてもセル ~70px (ふつう) / ~88px (広め) が確保される
            // tauri-plugin-window-state により resize 結果は次回起動に自動引継ぎされる。
            let size_normal = MenuItem::with_id(handle, "window-size-normal",
                "ふつう (1280 × 720)", true, None::<&str>)?;
            let size_wide = MenuItem::with_id(handle, "window-size-wide",
                "広め (1600 × 900)", true, None::<&str>)?;

            let menu = Menu::default(handle)?;
            for item_kind in menu.items()? {
                if let Some(submenu) = item_kind.as_submenu() {
                    let text = submenu.text().unwrap_or_default();
                    match text.as_str() {
                        "Window" => {
                            // OS 標準 Window submenu (Minimize / Zoom / Show All /
                            // Bring All to Front) の下に separator + サイズプリセットを追加
                            let separator = PredefinedMenuItem::separator(handle)?;
                            let _ = submenu.append(&separator);
                            let _ = submenu.append(&size_normal);
                            let _ = submenu.append(&size_wide);
                        }
                        "Help" => {
                            // OS 標準 Help submenu (Search 等) の下に「使い方を見る」を追加
                            let _ = submenu.append(&help_show);
                        }
                        _ => {}
                    }
                }
            }
            app.set_menu(menu)?;
            Ok(())
        })
        // メニュー click のハンドラ。MenuItem の id を `event.id().as_ref()` (= &str) で
        // 比較して dispatch する。
        // NOTE: Tauri v2 の event 名 (= app.emit / listen の channel) は英数字 / `-` / `/` /
        // `:` / `_` のみ許可、`.` 不可 (落とし穴 #20)。MenuItem の id 自体には文字制約は
        // 無いが、安全側として新規 id はハイフン区切り (`window-size-*`) で揃える。
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "help.show" => {
                    // 「使い方を見る」クリックで JS 側に通知 (App.tsx が listen して HelpDialog を開く)。
                    let _ = app.emit("menu:help-show", ());
                }
                "window-size-normal" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_size(LogicalSize::new(1280.0, 720.0));
                    }
                }
                "window-size-wide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_size(LogicalSize::new(1600.0, 900.0));
                    }
                }
                _ => {}
            }
        })
        // ⌘Q / ウィンドウ close 時にフロントエンドへ "before-quit" を発火する。
        // フロント側の useBeforeQuit が Supabase realtime channel を proactively 解除する。
        // React の unmount cleanup が間に合わずに webview が落ちるケースに対する保険。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = window.emit("before-quit", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
