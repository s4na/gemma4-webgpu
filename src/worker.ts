import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX'

let tokenizer: PreTrainedTokenizer | null = null
let model: PreTrainedModel | null = null

type WorkerMessage =
  | { type: 'load' }
  | { type: 'generate'; messages: { role: string; content: string }[] }
  | { type: 'abort' }

let abortController: AbortController | null = null

async function loadModel() {
  self.postMessage({ type: 'loading', message: 'Loading tokenizer...' })

  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)

  self.postMessage({ type: 'loading', message: 'Loading model (this may take a few minutes)...' })

  model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
      if (progress.status === 'progress' && progress.progress !== undefined) {
        self.postMessage({
          type: 'loading',
          message: `Downloading ${progress.file ?? 'model'}... ${Math.round(progress.progress)}%`,
          progress: progress.progress,
        })
      }
    },
  })

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
    self.postMessage({
      type: 'error',
      message: e instanceof Error ? e.message : 'Unknown error',
    })
  }
})
