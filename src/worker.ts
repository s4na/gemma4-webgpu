import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  env,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from '@huggingface/transformers'

// Enable browser Cache API for model caching
env.useBrowserCache = true
env.useFS = false
env.useFSCache = false

const MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX'

let tokenizer: PreTrainedTokenizer | null = null
let model: PreTrainedModel | null = null
let isLoading = false

type WorkerMessage =
  | { type: 'load' }
  | { type: 'generate'; messages: { role: string; content: string }[] }
  | { type: 'abort' }

let abortController: AbortController | null = null

// Timeout (ms) for the entire model load. If no progress is reported for
// this duration, we assume the load has stalled (common on iPhone Safari 17
// where WebGPU device creation can hang).
const LOAD_STALL_TIMEOUT = 60_000

async function loadModel() {
  if (isLoading || (tokenizer && model)) {
    if (tokenizer && model) {
      self.postMessage({ type: 'loaded' })
    }
    return
  }
  isLoading = true

  // --- Validate WebGPU adapter availability ---
  // Safari 17 on iPhone exposes navigator.gpu but requestAdapter() may
  // return null or hang. Check before handing off to transformers.js.
  self.postMessage({ type: 'loading', message: 'Checking WebGPU support...' })
  const gpu = (navigator as unknown as { gpu?: GPU }).gpu
  if (!gpu) {
    throw new Error('WebGPU is not supported in this browser.')
  }

  let adapter: GPUAdapter | null = null
  try {
    adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('WebGPU adapter request timed out')), 10_000),
      ),
    ])
  } catch (e) {
    throw new Error(
      `WebGPU adapter request failed: ${e instanceof Error ? e.message : 'unknown error'}`,
    )
  }
  if (!adapter) {
    throw new Error(
      'WebGPU adapter is not available. Your device may not support WebGPU for this model.',
    )
  }

  self.postMessage({ type: 'loading', message: 'Loading tokenizer...' })

  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)

  self.postMessage({ type: 'loading', message: 'Loading model (this may take a few minutes)...' })

  // Stall watchdog: if we receive no progress callback for LOAD_STALL_TIMEOUT ms,
  // reject the load so the user isn't stuck forever.
  let lastProgressTime = Date.now()
  let stallTimer: ReturnType<typeof setInterval> | null = null
  let rejectStall: ((reason: Error) => void) | null = null

  const stallPromise = new Promise<never>((_resolve, reject) => {
    rejectStall = reject
    stallTimer = setInterval(() => {
      if (Date.now() - lastProgressTime > LOAD_STALL_TIMEOUT) {
        reject(new Error('Model loading stalled — no progress for 60 seconds.'))
      }
    }, 5_000)
  })

  const modelPromise = AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
      lastProgressTime = Date.now()
      if (progress.status === 'progress' && progress.progress !== undefined) {
        self.postMessage({
          type: 'loading',
          message: `Downloading ${progress.file ?? 'model'}... ${Math.round(progress.progress)}%`,
          progress: progress.progress,
        })
      }
    },
  })

  try {
    model = await Promise.race([modelPromise, stallPromise])
  } finally {
    if (stallTimer) clearInterval(stallTimer)
    rejectStall = null
  }

  isLoading = false
  self.postMessage({ type: 'loaded' })
}

async function generate(messages: { role: string; content: string }[]) {
  if (!tokenizer || !model) {
    self.postMessage({ type: 'error', message: 'Model not loaded' })
    return
  }

  abortController = new AbortController()

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  }) as Record<string, unknown>

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    callback_function: (text: string) => {
      self.postMessage({ type: 'token', token: text })
    },
  })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (model.generate as any)({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      streamer,
      signal: abortController.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      // generation was aborted
    } else {
      throw e
    }
  }

  self.postMessage({ type: 'done' })
  abortController = null
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data

  try {
    switch (type) {
      case 'load':
        await loadModel()
        break
      case 'generate':
        await generate(event.data.messages)
        break
      case 'abort':
        abortController?.abort()
        break
    }
  } catch (e) {
    isLoading = false
    self.postMessage({
      type: 'error',
      message: e instanceof Error ? e.message : 'Unknown error',
    })
  }
})
