#!/usr/bin/env python3
"""
Local embedding server using sentence_transformers with CodeSage.

Exposes a simple HTTP API for generating embeddings from code/text,
compatible with the ai-code-knowledge TypeScript embedding providers.

Usage:
    python scripts/embedding-server.py [--model MODEL] [--port PORT] [--device DEVICE]

Defaults:
    --model   codesage/codesage-base
    --port    8484
    --device  cpu   (also: cuda, mps)

Endpoints:
    POST /embed   — {"texts": ["..."]} → {"embeddings": [[...]]}
    GET  /health  — {"status": "ok", "model": "...", "dimensions": 768}
"""

import argparse
import json
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Lazy-loaded after arg parsing so --help is instant
model_instance = None
model_name_global = ""
dimensions_global = 0


def load_model(model_name: str, device: str):
    global model_instance, model_name_global, dimensions_global
    from sentence_transformers import SentenceTransformer

    print(f"Loading model '{model_name}' on device '{device}'...")
    t0 = time.time()
    model_instance = SentenceTransformer(model_name, trust_remote_code=True, device=device)
    dimensions_global = model_instance.get_sentence_embedding_dimension()
    model_name_global = model_name
    print(f"Model loaded in {time.time() - t0:.1f}s  (dimensions={dimensions_global})")


class EmbeddingHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                "model": model_name_global,
                "dimensions": dimensions_global,
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._send_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length)

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"invalid JSON: {e}"})
            return

        texts = payload.get("texts")
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            self._send_json(400, {"error": "'texts' must be an array of strings"})
            return

        if len(texts) == 0:
            self._send_json(200, {"embeddings": []})
            return

        embeddings = model_instance.encode(texts, show_progress_bar=False)
        # numpy array → list of lists
        self._send_json(200, {
            "embeddings": embeddings.tolist(),
        })

    def log_message(self, format, *args):
        # Quieter logging: only show method + path
        sys.stderr.write(f"{args[0]}\n")


def main():
    parser = argparse.ArgumentParser(description="Local CodeSage embedding server")
    parser.add_argument("--model", default="codesage/codesage-base", help="Model ID (default: codesage/codesage-base)")
    parser.add_argument("--port", type=int, default=8484, help="Port to listen on (default: 8484)")
    parser.add_argument("--device", default=None, choices=["cpu", "cuda", "mps"],
                        help="Device (auto-detected: mps on Apple Silicon, cuda if available, else cpu)")
    args = parser.parse_args()

    device = args.device
    if device is None:
        import torch
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"

    load_model(args.model, device)

    server = HTTPServer(("0.0.0.0", args.port), EmbeddingHandler)
    print(f"Embedding server listening on http://0.0.0.0:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
