import type { GridSnapshot } from '@/types'

type ParsedNode = {
  text: string
  children: ParsedNode[]
}

/** インデントテキスト（スペース・タブ）をパース */
function parseIndentText(text: string): ParsedNode[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  const root: ParsedNode[] = []
  const stack: { node: ParsedNode; indent: number }[] = []

  for (const line of lines) {
    const indent = line.search(/\S/)
    const content = line.trim()
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
    const content = match[2].trim()
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

/** ParsedNode ツリーを GridSnapshot に変換 */
function nodesToGridSnapshot(nodes: ParsedNode[]): GridSnapshot[] {
  if (nodes.length === 0) return []

  const PERIPHERAL_POSITIONS = [0, 1, 2, 3, 5, 6, 7, 8] // 中心(4)を除く8つ

  const results: GridSnapshot[] = []

  // 8個ずつ分割して並列グリッドへ
  for (let i = 0; i < nodes.length; i += 8) {
    const chunk = nodes.slice(i, i + 8)
    const cells = chunk.map((node, idx) => ({
      position: PERIPHERAL_POSITIONS[idx],
      text: node.text,
      image_path: null as string | null,
      color: null as string | null,
    }))

    const children: GridSnapshot[] = []
    for (const [idx, node] of chunk.entries()) {
      if (node.children.length > 0) {
        const subSnapshots = nodesToGridSnapshot(node.children)
        // 各セルの子グリッドを再帰的に構築
        children.push(...subSnapshots)
      }
    }

    results.push({
      grid: { sort_order: i / 8, memo: null },
      cells,
      children,
    })
  }

  return results
}

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

  // 最初のノードをルートとして扱う
  const root = nodes[0]
  const gridSnapshots = nodesToGridSnapshot(root.children)

  return {
    grid: { sort_order: 0, memo: null },
    cells: [{ position: 4, text: root.text, image_path: null, color: null }],
    children: gridSnapshots,
  }
}
