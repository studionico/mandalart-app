use tauri::{Emitter, WindowEvent};
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};

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
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        // アプリ終了時にウインドウサイズ・位置・最大化状態を自動保存し、
        // 次回起動時に復元する。保存先は OS の AppConfig (macOS なら
        // ~/Library/Application Support/jp.mandalart.app/window-state.json)。
        // 初回起動時はこの state が無いので tauri.conf.json の width/height が使われる。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // メニューバーに「ヘルプ」 submenu を追加 (使い方モーダルの手動再表示エントリ)。
        // macOS は system menu bar、Windows / Linux はウィンドウメニューに自動配置される。
        // OS 標準の App / Edit / Window 等は `Menu::default(handle)` をベースに保持する。
        .setup(|app| {
            let handle = app.handle();
            let help_show = MenuItem::with_id(handle, "help.show", "使い方を見る", true, None::<&str>)?;
            let help_menu = SubmenuBuilder::new(handle, "ヘルプ")
                .item(&help_show)
                .build()?;
            let menu = Menu::default(handle)?;
            menu.append(&help_menu)?;
            app.set_menu(menu)?;
            Ok(())
        })
        // 「使い方を見る」クリックで JS 側に通知 (App.tsx が listen して HelpDialog を開く)。
        .on_menu_event(|app, event| {
            if event.id() == "help.show" {
                let _ = app.emit("menu:help.show", ());
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
