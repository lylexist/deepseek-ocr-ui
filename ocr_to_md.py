#!/usr/bin/env python3
"""OCR images via Ollama and convert to Markdown.

Usage:
  python3 ocr_to_md.py /path/to/file_or_dir [--api http://host:port] [--model deepseek-ocr] [--out output.md]
"""
import argparse
import base64
import json
import os
import re
import sys
from urllib import request

DEFAULT_API = "http://10.1.1.192"
DEFAULT_MODEL = "deepseek-ocr"
PROMPT = "Convert the document to markdown."
GROUNDING_PREFIX = "<|grounding|>"
GROUNDING_REF_RE = re.compile(r"<\|ref\|.*?<\|/ref\|>?", re.DOTALL)
GROUNDING_DET_RE = re.compile(r"<\|det\|.*?<\|/det\|>?", re.DOTALL)
GROUNDING_TAG_RE = re.compile(r"<\|/?(ref|det)\|>?")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def iter_images(path: str):
    if os.path.isfile(path):
        yield path
        return
    for root, _, files in os.walk(path):
        for name in sorted(files):
            ext = os.path.splitext(name)[1].lower()
            if ext in IMAGE_EXTS:
                yield os.path.join(root, name)


def call_ollama_native(api_base: str, model: str, image_path: str, prompt: str) -> str:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    payload = {
        "model": model,
        "prompt": prompt,
        "images": [b64],
        "stream": False,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{api_base.rstrip('/')}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with request.urlopen(req, timeout=300) as resp:
        resp_json = json.load(resp)
    return resp_json.get("response", "").strip()


def call_ollama_openai(api_base: str, model: str, image_path: str, prompt: str) -> str:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": f"data:image/{guess_image_type(image_path)};base64,{b64}"},
                ],
            }
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{api_base.rstrip('/')}/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with request.urlopen(req, timeout=300) as resp:
        resp_json = json.load(resp)
    return resp_json["choices"][0]["message"]["content"].strip()


def guess_image_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext == "jpg":
        return "jpeg"
    return ext or "jpeg"


def write_combined(out_path: str, items):
    with open(out_path, "w", encoding="utf-8") as out:
        for img_path, text in items:
            out.write(f"## {os.path.basename(img_path)}\n\n")
            out.write(text + "\n\n")
            out.write("---\n\n")


def write_single(out_path: str, text: str):
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(text + "\n")


def main():
    parser = argparse.ArgumentParser(description="Convert images to Markdown via Ollama OCR")
    parser.add_argument("paths", nargs="+", help="Image file or directory")
    parser.add_argument("--api", default=DEFAULT_API, help=f"Ollama API base URL (default: {DEFAULT_API})")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    parser.add_argument("--prompt", help="Override the default prompt")
    parser.add_argument(
        "--no-grounding",
        action="store_true",
        help="Disable <|grounding|> prefix",
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Disable cleanup of grounding tags in output",
    )
    parser.add_argument(
        "--openai",
        action="store_true",
        help="Use /v1/chat/completions (OpenAI-compatible) instead of /api/generate",
    )
    parser.add_argument("--out", help="Output markdown file (combine all inputs)")
    args = parser.parse_args()

    images = []
    for p in args.paths:
        if not os.path.exists(p):
            print(f"Path not found: {p}", file=sys.stderr)
            sys.exit(2)
        images.extend(list(iter_images(p)))

    if not images:
        print("No images found.", file=sys.stderr)
        sys.exit(1)

    results = []
    for img in images:
        try:
            prompt = args.prompt or PROMPT
            if not args.no_grounding:
                prompt = f"{GROUNDING_PREFIX}{prompt}"
            if args.openai:
                text = call_ollama_openai(args.api, args.model, img, prompt)
            else:
                text = call_ollama_native(args.api, args.model, img, prompt)
            if not args.no_clean:
                text = GROUNDING_REF_RE.sub("", text)
                text = GROUNDING_DET_RE.sub("", text)
                text = GROUNDING_TAG_RE.sub("", text)
                text = re.sub(r"[ \\t]+\\n", "\\n", text).strip()
        except Exception as e:
            text = f"<解析失败: {e}>"
        results.append((img, text))

    if args.out:
        write_combined(args.out, results)
        print(f"Wrote {args.out}")
        return

    if len(args.paths) == 1 and os.path.isdir(args.paths[0]):
        out_path = os.path.join(args.paths[0], "ocr.md")
        write_combined(out_path, results)
        print(f"Wrote {out_path}")
        return

    for img, text in results:
        out_path = img + ".md"
        write_single(out_path, text)
        print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
