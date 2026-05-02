/**
 * Welcome モーダル (新規ユーザー導入用) のコンテンツ世代。
 *
 * `bump` (= 数値を 1 上げる) すると、`STORAGE_KEYS.welcomeSeenVersion` に保存された
 * 値が古くなるので、全 user に対して **次回起動時に 1 回だけ再表示** される。
 *
 * 「次回以降表示しない」をチェックして閉じた user は現行 `WELCOME_VERSION` が保存され、
 * 再 bump されるまで表示されなくなる。新機能告知や welcome 内容の刷新時に bump する想定。
 */
export const WELCOME_VERSION = 1
