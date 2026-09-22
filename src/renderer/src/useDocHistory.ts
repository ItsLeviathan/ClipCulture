import { useCallback, useRef, useState } from 'react'
import type { ClipDoc } from '@shared/types'

/**
 * Edit state with undo/redo. Edits that share a `key` within a short window (a drag, typing in a
 * field) collapse into one undo step, so Ctrl+Z reverts a whole gesture.
 */
export function useDocHistory(initial: ClipDoc): {
  doc: ClipDoc
  docRef: React.MutableRefObject<ClipDoc>
  edit: (fn: (d: ClipDoc) => void, key?: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  markSaved: () => void
  reset: (d: ClipDoc, dirty?: boolean) => void
} {
  const [doc, setDoc] = useState(initial)
  const docRef = useRef(initial)
  const past = useRef<ClipDoc[]>([])
  const future = useRef<ClipDoc[]>([])
  const last = useRef<{ key: string; at: number } | null>(null)
  const [, bump] = useState(0)
  const [version, setVersion] = useState(0)
  const savedVersion = useRef(0)
  const versionRef = useRef(0)

  const commit = (next: ClipDoc): void => {
    docRef.current = next
    setDoc(next)
    versionRef.current++
    setVersion(versionRef.current)
  }

  const edit = useCallback((fn: (d: ClipDoc) => void, key?: string) => {
    const cur = docRef.current
    const next = structuredClone(cur)
    fn(next)
    const now = Date.now()
    const merge = key && last.current && last.current.key === key && now - last.current.at < 1200
    if (!merge) {
      past.current.push(cur)
      if (past.current.length > 200) past.current.shift()
    }
    last.current = key ? { key, at: now } : null
    future.current = []
    commit(next)
    bump((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(docRef.current)
    last.current = null
    commit(prev)
    bump((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const nxt = future.current.pop()
    if (!nxt) return
    past.current.push(docRef.current)
    last.current = null
    commit(nxt)
    bump((n) => n + 1)
  }, [])

  return {
    doc,
    docRef,
    edit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    dirty: version !== savedVersion.current,
    markSaved: () => {
      savedVersion.current = versionRef.current
      bump((n) => n + 1)
    },
    reset: (d, dirty = false) => {
      past.current = []
      future.current = []
      last.current = null
      docRef.current = d
      setDoc(d)
      versionRef.current++
      setVersion(versionRef.current)
      savedVersion.current = dirty ? -1 : versionRef.current
      bump((n) => n + 1)
    }
  }
}
