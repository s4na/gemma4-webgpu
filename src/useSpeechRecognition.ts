import { useCallback, useRef, useState } from 'react'

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList
  resultIndex: number
}

type SpeechRecognitionErrorEvent = Event & {
  error: string
}

type SpeechRecognitionInstance = EventTarget & {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

export function useSpeechRecognition(onResult: (transcript: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const start = useCallback(() => {
    if (!supported) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = navigator.language || 'ja-JP'
    recognition.interimResults = false
    recognition.continuous = false

    recognition.addEventListener('result', (e: Event) => {
      const event = e as SpeechRecognitionEvent
      const transcript = event.results[event.resultIndex][0].transcript
      onResult(transcript)
    })

    recognition.addEventListener('end', () => {
      setIsListening(false)
      recognitionRef.current = null
    })

    recognition.addEventListener('error', (e: Event) => {
      const event = e as SpeechRecognitionErrorEvent
      if (event.error !== 'aborted') {
        console.error('Speech recognition error:', event.error)
      }
      setIsListening(false)
      recognitionRef.current = null
    })

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [supported, onResult])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const toggle = useCallback(() => {
    if (isListening) {
      stop()
    } else {
      start()
    }
  }, [isListening, start, stop])

  return { isListening, supported, toggle }
}
