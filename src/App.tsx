import { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { useGemma, type Message } from './useGemma'
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
    loadModel,
    sendMessage,
    stopGenerating,
    retry,
  } = useGemma()

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const webgpuSupported = useMemo(
    () => typeof navigator !== 'undefined' && 'gpu' in navigator,
    [],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

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

      {status === 'idle' && webgpuSupported && (
        <div className="load-section">
          <p>Click to download and load the model. First time may take a few minutes.</p>
          <button className="btn btn-primary" onClick={loadModel}>
            Load Model
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="load-section">
          <p>{loadingMessage}</p>
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
    </div>
  )
}

export default App
