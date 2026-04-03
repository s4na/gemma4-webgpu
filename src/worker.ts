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

// Timeout (ms) for the initial model load phase. If no progress callback
// fires at all within this window, the WebGPU pipeline is likely stuck
// (common on iPhone Safari 17). Once the first progress callback arrives,
// the watchdog is disarmed — slow downloads are fine.
const INITIAL_PROGRESS_TIMEOUT = 90_000

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

  // Stall watchdog: only guards the *initial* phase before the first
  // progress callback arrives (WebGPU pipeline creation, shader compilation,
  // etc.). Once downloading starts the watchdog is disarmed — a slow network
  // is not a stall.
  let progressReceived = false
  let stallTimer: ReturnType<typeof setTimeout> | null = null

  const stallPromise = new Promise<never>((_resolve, reject) => {
    stallTimer = setTimeout(() => {
      if (!progressReceived) {
        reject(
          new Error(
            'Model loading stalled — WebGPU initialization did not complete within 90 seconds.',
          ),
        )
      }
    }, INITIAL_PROGRESS_TIMEOUT)
  })

  const modelPromise = AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
      if (!progressReceived) {
        progressReceived = true
        // First progress arrived — disarm the watchdog
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      }
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
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
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
