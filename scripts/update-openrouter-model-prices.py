#!/usr/bin/env python3
"""
Fetch OpenRouter model pricing and update the vendored file used by the UI.

Output: public/model-prices/openrouter.json
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import urllib.request
from typing import Any


OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
OUT_PATH = os.path.join("public", "model-prices", "openrouter.json")


def to_per_million(value: Any) -> float:
    try:
        return float(value) * 1_000_000.0
    except Exception:
        return 0.0


def main() -> int:
    with urllib.request.urlopen(OPENROUTER_MODELS_URL) as res:
        raw = res.read()
    payload = json.loads(raw)

    prices: dict[str, dict[str, float]] = {}
    for model in payload.get("data", []):
        model_id = model.get("id")
        pricing = model.get("pricing") or {}
        if not model_id or not isinstance(pricing, dict):
            continue

        prompt = to_per_million(pricing.get("prompt", 0))
        completion = to_per_million(pricing.get("completion", 0))
        cache = to_per_million(pricing.get("input_cache_read", 0)) or prompt
        prices[model_id] = {
            "prompt": round(prompt, 10),
            "completion": round(completion, 10),
            "cache": round(cache, 10),
        }

    out = {
        "version": 1,
        "source": "openrouter",
        "fetchedAt": datetime.datetime.now(datetime.UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "tokenUnit": "USD_per_1M_tokens",
        "prices": dict(sorted(prices.items())),
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    print(f"updated {OUT_PATH} ({len(prices)} models)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
