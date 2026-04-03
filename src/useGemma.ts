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

// Detect if the page crashed during a previous download attempt.
// iOS Safari kills pages that use too much memory, causing an infinite
// reload → auto-download → crash loop.
const DOWNLOAD_FLAG = 'gemma_downloading'
const CRASH_COUNT_KEY = 'gemma_crash_count'
const MAX_AUTO_RETRIES = 1

function detectCrashLoop(): boolean {
  try {
    const wasDownloading = sessionStorage.getItem(DOWNLOAD_FLAG) === '1'
    if (!wasDownloading) return false
    const count = parseInt(sessionStorage.getItem(CRASH_COUNT_KEY) ?? '0', 10)
    sessionStorage.setItem(CRASH_COUNT_KEY, String(count + 1))
    sessionStorage.removeItem(DOWNLOAD_FLAG)
    return count + 1 > MAX_AUTO_RETRIES
  } catch {
    return false
  }
}

function markDownloadStarted() {
  try { sessionStorage.setItem(DOWNLOAD_FLAG, '1') } catch { /* noop */ }
}

function markDownloadFinished() {
  try {
    sessionStorage.removeItem(DOWNLOAD_FLAG)
    sessionStorage.removeItem(CRASH_COUNT_KEY)
  } catch { /* noop */ }
}

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
  const [needsManualLoad, setNeedsManualLoad] = useState(false)

  const addLog = useCallback((message: string, level: DebugLog['level'] = 'info') => {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
    setDebugLogs((prev) => [...prev, { id: logId++, time, message, level }])
  }, [])

  const startLoad = useCallback(() => {
    setNeedsManualLoad(false)
    setError(null)
    setStatus('loading')
    markDownloadStarted()
    workerRef.current?.postMessage({ type: 'load' })
    addLog('Sent load message to worker')
  }, [addLog])

  useEffect(() => {
    if (initRef.current) {
      addLog('useEffect skipped (already initialized)', 'warn')
      return
    }
    initRef.current = true
    addLog('Initializing worker...')

    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.addEventListener('message', (event) => {
      const data = event.data
      switch (data.type) {
        case 'loading':
          setStatus('loading')
          setLoadingMessage(data.message)
          setLoadingProgress(data.progress ?? null)
          addLog(`[worker] ${data.message}`)
          break
        case 'loaded':
          markDownloadFinished()
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
          markDownloadFinished()
          setError(data.message)
          setStatus('error')
          addLog(`[worker] Error: ${data.message}`, 'error')
          break
      }
    })

    worker.addEventListener('error', (event) => {
      addLog(`[worker] Uncaught error: ${event.message}`, 'error')
    })

    workerRef.current = worker

    // Check for crash loop before auto-loading
    const isCrashLoop = detectCrashLoop()
    if (isCrashLoop) {
      addLog('Crash loop detected — skipping auto-load. Tap "Load Model" to retry.', 'warn')
      setNeedsManualLoad(true)
      return
    }

    // Auto-load model on mount (cached models load instantly)
    setStatus('loading')
    markDownloadStarted()
    worker.postMessage({ type: 'load' })
    addLog('Sent load message to worker')
  }, [addLog])

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
    startLoad()
  }, [startLoad])

  return {
    status,
    loadingMessage,
    loadingProgress,
    messages,
    streamingContent,
    error,
    debugLogs,
    needsManualLoad,
    sendMessage,
    stopGenerating,
    retry,
    startLoad,
  }
}
