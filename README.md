# Deepseek OCR UI

A lightweight, browser-based UI for running DeepSeek OCR via an Ollama-compatible endpoint. Upload an image, run OCR, and inspect grounding boxes with a visual overlay.

## Quick Start

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000/index.html`.

## Ollama Server (brief)

Start Ollama and ensure the model is available:

```bash
ollama serve
ollama run deepseek-ocr
```

Then set the endpoint in the UI (e.g. `http://127.0.0.1:11434`).

## Notes

- Grounding overlay supports 0~999 bins coordinates (DeepSeek OCR standard).
- Use “转 Markdown” prompt to include `<|ref|>` and `<|det|>` tags.
