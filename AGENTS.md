# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Single-page UI shell and layout.
- `styles.css`: Visual design, layout, and component styling.
- `app.js`: Front-end behavior (upload, preview, OCR requests, streaming output).
- `ocr_to_md.py`: CLI utility for OCR via Ollama/OpenAI-compatible endpoints.
- `.codex/`: Local agent skills and tooling metadata.

## Build, Test, and Development Commands
- `python3 -m http.server 8000`: Serve the UI locally, then open `http://localhost:8000/index.html`.
- `python3 ocr_to_md.py /path/to/image.jpg --api http://host:port --model deepseek-ocr`: Run the OCR CLI against a single image.
- `python3 ocr_to_md.py /path/to/folder --out output.md`: Batch OCR a folder and combine results.

## Coding Style & Naming Conventions
- Indentation: 2 spaces in HTML/CSS/JS; 4 spaces in Python.
- JavaScript: `const`/`let`, camelCase for variables/functions, double quotes for strings (see `app.js`).
- CSS: class selectors use kebab-case (e.g., `.status-pill`), keep variables in `:root`.
- Python: snake_case for functions/variables, standard library only.
- Avoid introducing new dependencies unless necessary for the OCR flow.

## Testing Guidelines
- No automated test framework is configured yet.
- For changes, verify manually:
  - UI flow: upload image, preview render, run OCR, copy/download output.
  - CLI flow: single image and folder batch modes.

## Commit & Pull Request Guidelines
- Commit messages are concise, imperative sentence case (e.g., “Add OCR UI frontend”).
- PRs should include:
  - A short summary and testing notes.
  - Screenshots/GIFs for UI changes.
  - Any API endpoint or model changes (e.g., default URL/model in `ocr_to_md.py`).

## Configuration & Security Notes
- The UI posts to `/api/generate` or `/v1/chat/completions` on the configured endpoint; double-check host/port before sharing builds.
- Avoid committing real API endpoints or credentials; keep sensitive URLs out of source.
