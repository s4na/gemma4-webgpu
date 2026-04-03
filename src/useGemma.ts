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
    })

    worker.addEventListener('error', (event) => {
      addLog(`[worker] Uncaught error: ${event.message}`, 'error')
    })

    workerRef.current = worker

    // Auto-load model on mount (cached models load instantly)
    setStatus('loading')
    worker.postMessage({ type: 'load' })
    addLog('Sent load message to worker')
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
