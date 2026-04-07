import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { useGemma, type Message } from './useGemma'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useThreadStore } from './useThreadStore'
import './App.css'

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-label">{isUser ? 'You' : 'Gemma'}</div>
      <div className="message-content">
        {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
      </div>
    </div>
  )
}

function App() {
  const {
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
    loadMessages,
  } = useGemma()

  const {
    threads,
    activeThread,
    activeThreadId,
    loaded: threadsLoaded,
    saveMessages,
    newThread,
    switchThread,
    removeThread,
  } = useThreadStore()

  const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed'
  const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (isDesktop()) {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'true'
    }
    return false
  })

  // Sync sidebar state with viewport changes
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setSidebarOpen(localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'true')
      } else {
        setSidebarOpen(false)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      if (isDesktop()) {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'false' : 'true')
      }
      return next
    })
  }
  const [showDebugLog, setShowDebugLog] = useState(false)
  const debugLogEndRef = useRef<HTMLDivElement>(null)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevThreadIdRef = useRef<string | null>(null)

  const handleSpeechResult = useCallback((transcript: string) => {
    setInput((prev) => (prev ? prev + ' ' + transcript : transcript))
  }, [])
  const { isListening, supported: speechSupported, start: startSpeech, stop: stopSpeech } =
    useSpeechRecognition(handleSpeechResult)

  const webgpuSupported = useMemo(
    () => typeof navigator !== 'undefined' && 'gpu' in navigator,
    [],
  )

  // Load messages when switching threads
  useEffect(() => {
    if (!activeThread || activeThreadId === prevThreadIdRef.current) return
    prevThreadIdRef.current = activeThreadId
    loadMessages(activeThread.messages)
  }, [activeThreadId, activeThread, loadMessages])

  // Persist messages to IndexedDB when they change
  useEffect(() => {
    if (!threadsLoaded || !activeThreadId) return
    if (prevThreadIdRef.current !== activeThreadId) return
    saveMessages(messages)
  }, [messages, activeThreadId, threadsLoaded, saveMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    debugLogEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [debugLogs])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || status !== 'ready') return
    sendMessage(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleNewChat = async () => {
    await newThread()
    if (!isDesktop()) setSidebarOpen(false)
  }

  const handleSwitchThread = (id: string) => {
    if (id === activeThreadId) {
      if (!isDesktop()) setSidebarOpen(false)
      return
    }
    switchThread(id)
    setInput('')
    if (!isDesktop()) setSidebarOpen(false)
  }

  const handleDeleteThread = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    removeThread(id)
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <>
      {/* Sidebar overlay (mobile only) */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <h2>Chats</h2>
          <div className="sidebar-header-actions">
            <button className="btn-new-chat" onClick={handleNewChat}>+ New</button>
            <button className="btn-close-sidebar" onClick={toggleSidebar} title="Close sidebar">
              &times;
            </button>
          </div>
        </div>
        <div className="sidebar-threads">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={`thread-item ${thread.id === activeThreadId ? 'thread-active' : ''}`}
              onClick={() => handleSwitchThread(thread.id)}
            >
              <div className="thread-info">
                <div className="thread-title">{thread.title}</div>
                <div className="thread-meta">
                  {thread.messages.length} msgs &middot; {formatDate(thread.updatedAt)}
                </div>
              </div>
              {threads.length > 1 && (
                <button
                  className="btn-delete-thread"
                  onClick={(e) => handleDeleteThread(e, thread.id)}
                  title="Delete"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className={`app ${sidebarOpen ? 'app-sidebar-open' : ''}`}>
        <header className="header">
          <button className="btn-hamburger" onClick={toggleSidebar}>
            <span /><span /><span />
          </button>
          <div className="header-text">
            <h1>Gemma 4 WebGPU</h1>
            <p className="subtitle">
              AI running entirely in your browser — no server, no data leaves your device
            </p>
          </div>
        </header>

        {!webgpuSupported && (
          <div className="error-banner">
            Your browser does not support WebGPU. Please use Chrome or Edge.
          </div>
        )}

        {needsManualLoad && webgpuSupported && (
          <div className="load-section">
            <p>Model loading was interrupted. Tap below to try again.</p>
            <button className="btn btn-primary" onClick={startLoad} style={{ marginTop: 8 }}>
              Load Model
            </button>
          </div>
        )}

        {!needsManualLoad && (status === 'idle' || status === 'loading') && webgpuSupported && (
          <div className="load-section">
            <p>{loadingMessage || 'Loading model...'}</p>
            {loadingProgress !== null && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="error-banner">
            <p>{error}</p>
            <button className="btn btn-primary" onClick={retry} style={{ marginTop: 8 }}>
              Retry
            </button>
          </div>
        )}

        {(status === 'ready' || status === 'generating') && (
          <>
            <div className="chat-area">
              {messages.length === 0 && !streamingContent && (
                <div className="empty-state">Start a conversation with Gemma</div>
              )}
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {streamingContent && (
                <div className="message message-assistant">
                  <div className="message-label">Gemma</div>
                  <div className="message-content">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="input-area" onSubmit={handleSubmit}>
              <textarea
                className="input-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Shift+Enter for new line)"
                rows={1}
                disabled={status === 'generating'}
              />
              {speechSupported && status !== 'generating' && !isListening && (
                <button
                  className="btn btn-mic"
                  type="button"
                  onClick={startSpeech}
                  title="Voice input"
                >
                  {'\uD83C\uDF99'}
                </button>
              )}
              {speechSupported && isListening && (
                <button
                  className="btn btn-voice-stop"
                  type="button"
                  onClick={stopSpeech}
                  title="Stop voice input"
                >
                  停止
                </button>
              )}
              {status === 'generating' ? (
                <button className="btn btn-stop" type="button" onClick={stopGenerating}>
                  Stop
                </button>
              ) : (
                <button className="btn btn-send" type="submit" disabled={!input.trim()}>
                  Send
                </button>
              )}
            </form>
          </>
        )}
        <div className="debug-toggle">
          <button
            className="btn-debug-toggle"
            onClick={() => setShowDebugLog((prev) => !prev)}
          >
            {showDebugLog ? 'Hide' : 'Show'} Debug Log ({debugLogs.length})
          </button>
        </div>

        {showDebugLog && (
          <div className="debug-panel">
            {debugLogs.map((log) => (
              <div key={log.id} className={`debug-line debug-${log.level}`}>
                <span className="debug-time">{log.time}</span>
                <span className="debug-msg">{log.message}</span>
              </div>
            ))}
            <div ref={debugLogEndRef} />
          </div>
        )}
      </div>
    </>
  )
}

export default App
