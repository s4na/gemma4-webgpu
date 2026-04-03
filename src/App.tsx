import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { useGemma, type Message } from './useGemma'
import { useSpeechRecognition } from './useSpeechRecognition'
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
    sendMessage,
    stopGenerating,
    retry,
  } = useGemma()

  const [showDebugLog, setShowDebugLog] = useState(false)
  const debugLogEndRef = useRef<HTMLDivElement>(null)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const handleSpeechResult = useCallback((transcript: string) => {
    setInput((prev) => (prev ? prev + ' ' + transcript : transcript))
  }, [])
  const { isListening, supported: speechSupported, start: startSpeech, stop: stopSpeech } =
    useSpeechRecognition(handleSpeechResult)

  const webgpuSupported = useMemo(
    () => typeof navigator !== 'undefined' && 'gpu' in navigator,
    [],
  )

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

  return (
    <div className="app">
      <header className="header">
        <h1>Gemma 3 WebGPU</h1>
        <p className="subtitle">
          AI running entirely in your browser — no server, no data leaves your device
        </p>
      </header>

      {!webgpuSupported && (
        <div className="error-banner">
          Your browser does not support WebGPU. Please use Chrome or Edge.
        </div>
      )}

      {(status === 'idle' || status === 'loading') && webgpuSupported && (
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
  )
}

export default App
