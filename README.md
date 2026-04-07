# Gemma 4 WebGPU Chat

Run Google's Gemma model directly in the browser using WebGPU. No server required — all inference happens on your device.

Built from scratch with Vite + React + [Transformers.js](https://github.com/huggingface/transformers.js).

## Features

- Browser-native AI inference via WebGPU
- Streaming text generation
- Markdown rendering in responses
- Web Worker for non-blocking inference
- Offline-capable after initial model download

## Model

Uses [onnx-community/gemma-3-1b-it-ONNX](https://huggingface.co/onnx-community/gemma-3-1b-it-ONNX) (quantized q4f16).

## Requirements

- A browser with WebGPU support (Chrome or Edge)
- ~1-2 GB for model download on first visit

## Development

```bash
npm install
npm run dev
```

## Deployment

Deployed via GitHub Pages with GitHub Actions. Push to `main` triggers automatic deployment.

## License

MIT
