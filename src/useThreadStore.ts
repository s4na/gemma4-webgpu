import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from './useGemma'

export type Thread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

const DB_NAME = 'gemma-chat'
const DB_VERSION = 1
const STORE_NAME = 'threads'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getAllThreads(): Promise<Thread[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      const threads = request.result as Thread[]
      threads.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(threads)
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function putThread(thread: Thread): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(thread)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
}

async function deleteThreadById(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
}

function createThread(): Thread {
  return {
    id: crypto.randomUUID(),
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
}

function generateTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return 'New Chat'
  const text = first.content.slice(0, 40)
  return text.length < first.content.length ? text + '...' : text
}

export function useThreadStore() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    getAllThreads().then((stored) => {
      if (stored.length === 0) {
        const t = createThread()
        putThread(t).then(() => {
          setThreads([t])
          setActiveThreadId(t.id)
          setLoaded(true)
        })
      } else {
        setThreads(stored)
        const lastId = localStorage.getItem('activeThreadId')
        const found = stored.find((t) => t.id === lastId)
        setActiveThreadId(found ? found.id : stored[0].id)
        setLoaded(true)
      }
    })
  }, [])

  useEffect(() => {
    if (activeThreadId) {
      localStorage.setItem('activeThreadId', activeThreadId)
    }
  }, [activeThreadId])

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null

  const saveMessages = useCallback(
    async (messages: Message[]) => {
      if (!activeThreadId || savingRef.current) return
      savingRef.current = true
      try {
        setThreads((prev) => {
          const updated = prev.map((t) => {
            if (t.id !== activeThreadId) return t
            const title = messages.length > 0 ? generateTitle(messages) : t.title
            return { ...t, messages, title, updatedAt: Date.now() }
          })
          updated.sort((a, b) => b.updatedAt - a.updatedAt)
          const thread = updated.find((t) => t.id === activeThreadId)
          if (thread) putThread(thread)
          return updated
        })
      } finally {
        savingRef.current = false
      }
    },
    [activeThreadId],
  )

  const newThread = useCallback(async () => {
    const t = createThread()
    await putThread(t)
    setThreads((prev) => [t, ...prev])
    setActiveThreadId(t.id)
    return t
  }, [])

  const switchThread = useCallback((id: string) => {
    setActiveThreadId(id)
  }, [])

  const removeThread = useCallback(
    async (id: string) => {
      await deleteThreadById(id)
      setThreads((prev) => {
        const remaining = prev.filter((t) => t.id !== id)
        if (remaining.length === 0) {
          const t = createThread()
          putThread(t)
          setActiveThreadId(t.id)
          return [t]
        }
        if (activeThreadId === id) {
          setActiveThreadId(remaining[0].id)
        }
        return remaining
      })
    },
    [activeThreadId],
  )

  return {
    threads,
    activeThread,
    activeThreadId,
    loaded,
    saveMessages,
    newThread,
    switchThread,
    removeThread,
  }
}
