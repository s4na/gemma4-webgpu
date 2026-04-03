import { useCallback, useEffect, useRef, useState } from 'react'

let nextId = 0

export type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

type ModelStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error'

type DebugLog = {
  id: number
  time: string
  message: string
  level: 'info' | 'warn' | 'error'
}

let logId = 0

// Module-level singleton: survives React component remounts (StrictMode,
// Safari page-restore, memory-pressure re-renders, etc.)
let globalWorker: Worker | null = null
let globalWorkerReady = false
let currentMessageHandler: ((event: MessageEvent) => void) | null = null
let currentErrorHandler: ((event: ErrorEvent) => void) | null = null

export function useGemma() {
  const workerRef = useRef<Worker | null>(null)
  const initRef = useRef(false)
  const messagesRef = useRef<Message[]>([])
  const [status, setStatus] = useState<ModelStatus>('idle')
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([])

  const addLog = useCallback((message: string, level: DebugLog['level'] = 'info') => {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
    setDebugLogs((prev) => [...prev, { id: logId++, time, message, level }])
  }, [])

  const addLogRef = useRef(addLog)
  addLogRef.current = addLog

  useEffect(() => {
    const log = addLogRef.current
    if (initRef.current) {
      log('useEffect skipped (already initialized)', 'warn')
      return
    }
    initRef.current = true

    // If a Worker already exists at module level (component remounted after
    // Safari page-restore / StrictMode / memory-pressure), reuse it.
    if (globalWorker) {
      log('Reusing existing worker (component remounted)', 'warn')
      workerRef.current = globalWorker

      // Re-attach message listeners so that the new component instance
      // receives state updates from the existing Worker.
      attachWorkerListeners(globalWorker, setStatus, setLoadingMessage, setLoadingProgress, setStreamingContent, setMessages, setError, messagesRef, log)

      if (globalWorkerReady) {
        setStatus('ready')
        log('Worker already ready — skipping model load')
      } else {
        setStatus('loading')
        log('Worker exists but model still loading — waiting...')
      }
      return
    }

    log('Initializing worker...')

    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })

    globalWorker = worker
    workerRef.current = worker

    attachWorkerListeners(worker, setStatus, setLoadingMessage, setLoadingProgress, setStreamingContent, setMessages, setError, messagesRef, log)

    // Auto-load model on mount (cached models load instantly)
    setStatus('loading')
    worker.postMessage({ type: 'load' })
    log('Sent load message to worker')
  }, [])

  // Listen for Safari page lifecycle events that indicate the page was
  // restored from BFCache or resumed after being suspended.
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        addLog(`pageshow: restored from BFCache`, 'warn')
      }
    }
    const handleVisibilityChange = () => {
      addLog(`visibilitychange: ${document.visibilityState}`, 'info')
    }

    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [addLog])

  const loadMessages = useCallback((msgs: Message[]) => {
    messagesRef.current = msgs
    setMessages(msgs)
    setStreamingContent('')
    if (msgs.length > 0) {
      nextId = Math.max(...msgs.map((m) => m.id)) + 1
    }
  }, [])

  const sendMessage = useCallback((content: string) => {
    const userMessage: Message = { id: nextId++, role: 'user', content }
    messagesRef.current = [...messagesRef.current, userMessage]
    setMessages(messagesRef.current)
    setStreamingContent('')
    setError(null)
    setStatus('generating')
    workerRef.current?.postMessage({
      type: 'generate',
      messages: messagesRef.current.map(({ role, content }) => ({ role, content })),
    })
  }, [])

  const stopGenerating = useCallback(() => {
    workerRef.current?.postMessage({ type: 'abort' })
  }, [])

  const retry = useCallback(() => {
    setError(null)
    setStatus('loading')
    workerRef.current?.postMessage({ type: 'load' })
  }, [])

  return {
    status,
    loadingMessage,
    loadingProgress,
    messages,
    streamingContent,
    error,
    debugLogs,
    sendMessage,
    stopGenerating,
    retry,
    loadMessages,
  }
}

/**
 * Attach message/error listeners to the Worker. Replaces any previous
 * listeners by using a named wrapper so we can call this again after a
 * component remount without stacking duplicate handlers.
 */
function attachWorkerListeners(
  worker: Worker,
  setStatus: React.Dispatch<React.SetStateAction<ModelStatus>>,
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>,
  setLoadingProgress: React.Dispatch<React.SetStateAction<number | null>>,
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  messagesRef: React.MutableRefObject<Message[]>,
  addLog: (message: string, level?: DebugLog['level']) => void,
) {
  // Remove previous listeners if any (prevents stacking on remount)
  if (currentMessageHandler) {
    worker.removeEventListener('message', currentMessageHandler)
  }
  if (currentErrorHandler) {
    worker.removeEventListener('error', currentErrorHandler)
  }

  const messageHandler = (event: MessageEvent) => {
    const data = event.data
    switch (data.type) {
      case 'loading':
        setStatus('loading')
        setLoadingMessage(data.message)
        setLoadingProgress(data.progress ?? null)
        addLog(`[worker] ${data.message}`)
        break
      case 'loaded':
        globalWorkerReady = true
        setStatus('ready')
        setLoadingMessage('')
        setLoadingProgress(null)
        addLog('[worker] Model loaded successfully')
        break
      case 'token':
        setStreamingContent((prev) => prev + data.token)
        break
      case 'done':
        setStreamingContent((prev) => {
          if (prev) {
            const assistantMsg: Message = { id: nextId++, role: 'assistant', content: prev }
            messagesRef.current = [...messagesRef.current, assistantMsg]
            setMessages(messagesRef.current)
          }
          return ''
        })
        setStatus('ready')
        addLog('[worker] Generation done')
        break
      case 'error':
        setError(data.message)
        setStatus('error')
        addLog(`[worker] Error: ${data.message}`, 'error')
        break
    }
  }

  const errorHandler = (event: ErrorEvent) => {
    addLog(`[worker] Uncaught error: ${event.message}`, 'error')
  }

  currentMessageHandler = messageHandler
  currentErrorHandler = errorHandler

  worker.addEventListener('message', messageHandler)
  worker.addEventListener('error', errorHandler)
}
