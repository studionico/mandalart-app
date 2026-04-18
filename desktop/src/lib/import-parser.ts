import type { GridSnapshot } from '@/types'
import { TAB_ORDER } from '@/constants/tabOrder'

type ParsedNode = {
  text: string
  children: ParsedNode[]
}

/**
 * 行の先頭にある箇条書き記号を除去する。
 * 対応:
 *  - Unicode の bullet 系: ・ • ◦ ▪ ▫ ○ ● ◆ ◇ ■ □ ★ ☆
 *  - ASCII の list marker: `- `, `* `, `+ ` (Markdown 形式)
 *  - 番号リスト: `1. `, `1) ` など (半角数字 + . or ) + 空白)
 * 末尾の空白も合わせて削ぎ、後続のテキストだけを返す。
 */
function stripBulletMarker(text: string): string {
  return text.replace(
    /^([・•◦▪▫○●◆◇■□★☆]|[-*+](?=\s)|\d+[.)](?=\s))\s*/,
    '',
  )
}

/** インデントテキスト（スペース・タブ）をパース */
function parseIndentText(text: string): ParsedNode[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  const root: ParsedNode[] = []
  const stack: { node: ParsedNode; indent: number }[] = []

  for (const line of lines) {
    const indent = line.search(/\S/)
    const content = stripBulletMarker(line.trim())
    if (!content) continue  // 箇条書き記号だけの行はスキップ
    const node: ParsedNode = { text: content, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, indent })
  }

  return root
}

/** Markdown 見出し（# ## ###）をパース */
function parseMarkdown(text: string): ParsedNode[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  const root: ParsedNode[] = []
  const stack: { node: ParsedNode; level: number }[] = []

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (!match) continue

    const level = match[1].length
    const content = stripBulletMarker(match[2].trim())
    if (!content) continue
    const node: ParsedNode = { text: content, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, level })
  }

  return root
}

// インポート時の周辺セル配置順は Tab 移動順 (TAB_ORDER) から中心 (4) を除いたもの。
// 中心の次にフォーカスが当たるセルが最初に埋まるよう、ユーザーの編集動線と一致させる。
// 結果: [7, 6, 3, 0, 1, 2, 5, 8]
const PERIPHERAL_POSITIONS = TAB_ORDER.filter((p) => p !== 4)

/**
 * ParsedNode をマンダラート 1 グリッドに変換する。
 *  - node.text → 中心セル (position 4)
 *  - node.children[0..7] → 周辺セル (position 0,1,2,3,5,6,7,8)
 *  - 孫がいる周辺セルはその位置から subgrid を生やす (parentPosition=pos)
 *  - 9 個目以降の子は並列グリッドとして返り値の children に追加
 *    (parentPosition=undefined + sort_order 増分、呼び出し側で
 *     このグリッドと同じ center_cell_id に紐付けられる)
 */
function nodeToGrid(
  node: ParsedNode,
  sortOrder: number,
  parentPosition: number | undefined,
): GridSnapshot {
  const firstEight = node.children.slice(0, 8)
  const cells: GridSnapshot['cells'] = [
    { position: 4, text: node.text, image_path: null, color: null },
  ]
  for (let i = 0; i < firstEight.length; i++) {
    cells.push({
      position: PERIPHERAL_POSITIONS[i],
      text: firstEight[i].text,
      image_path: null,
      color: null,
    })
  }

  const children: GridSnapshot[] = []

  // 周辺セルに孫がいる場合は subgrid を生やす
  firstEight.forEach((child, idx) => {
    if (child.children.length > 0) {
      children.push(nodeToGrid(child, 0, PERIPHERAL_POSITIONS[idx]))
    }
  })

  // 9 個目以降: 並列グリッドとして展開
  // 擬似ノード (同じ text + オーバーフロー分の子) を再帰することで
  // それぞれが中心＋最大 8 周辺セルのフル構造を持てるようにする
  const overflow = node.children.slice(8)
  let parallelSort = sortOrder + 1
  for (let i = 0; i < overflow.length; i += 8) {
    const chunk = overflow.slice(i, i + 8)
    const pseudo: ParsedNode = { text: node.text, children: chunk }
    children.push(nodeToGrid(pseudo, parallelSort++, undefined))
  }

  return {
    grid: { sort_order: sortOrder, memo: null },
    parentPosition,
    cells,
    children,
  }
}

/**
 * テキストを GridSnapshot に変換する。
 * 先頭が `#` なら Markdown、そうでなければインデントテキストとして解釈。
 * トップレベルのノードが複数ある場合は最初のノードだけがルートとして扱われる。
 */
export function parseTextToSnapshot(text: string): GridSnapshot {
  const trimmed = text.trim()
  let nodes: ParsedNode[]

  if (trimmed.startsWith('#')) {
    nodes = parseMarkdown(trimmed)
  } else {
    nodes = parseIndentText(trimmed)
  }

  if (nodes.length === 0) {
    return { grid: { sort_order: 0, memo: null }, cells: [], children: [] }
  }

  const root = nodes[0]
  return nodeToGrid(root, 0, undefined)
}
