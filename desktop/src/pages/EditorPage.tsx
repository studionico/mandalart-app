import { useParams } from 'react-router-dom'
import EditorLayout from '@/components/editor/EditorLayout'

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <EditorLayout mandalartId={id} userId="local" />
}
