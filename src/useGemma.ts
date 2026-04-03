import { useCallback, useEffect, useRef, useState } from 'react'

let nextId = 0

export type Message = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

type ModelStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error'

export function useGemma() {
  const workerRef = useRef<Worker | null>(null)
  const messagesRef = useRef<Message[]>([])
  const [status, setStatus] = useState<ModelStatus>('idle')
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
          break
        case 'loaded':
          setStatus('ready')
          setLoadingMessage('')
          setLoadingProgress(null)
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
          break
        case 'error':
          setError(data.message)
          setStatus('error')
          break
      }
    })

    workerRef.current = worker

    // Auto-load model on mount (cached models load instantly)
    setStatus('loading')
    worker.postMessage({ type: 'load' })

    return () => worker.terminate()
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
    sendMessage,
    stopGenerating,
    retry,
  }
}
