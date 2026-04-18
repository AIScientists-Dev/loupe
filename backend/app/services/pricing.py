"""Cost formula — open, auditable, user-visible.

Every number in this file can be read by a user to understand what they're
billed. Not buried in docs. The /source/pricing endpoint serves it raw.

Three cost components:

  1. LLM API cost      — Anthropic public rates (per 1M tokens).
  2. GPU amortization  — MinerU runs on one EC2 g6.xlarge. Hourly rate
                         divided by elapsed seconds. See GPU_RATE_USD_PER_SECOND.
  3. Service markup    — flat multiplier applied ONLY if you host this
                         as a paid service. Self-hosters set SERVICE_MARKUP=1.0
                         in .env to see raw cost.

Run the pricing helpers directly:
    from app.services.pricing import bill_user, llm_cost, gpu_cost
"""
from __future__ import annotations

import os
from typing import Dict


# ── LLM rates, USD per 1 million tokens (Anthropic public prices, Apr 2026) ──
LLM_PRICES: Dict[str, Dict[str, float]] = {
    "claude-sonnet-4-6": {"input": 3.00,  "cache_write": 3.75,  "cache_read": 0.30,  "output": 15.00},
    "claude-opus-4-6":   {"input": 15.00, "cache_write": 18.75, "cache_read": 1.50,  "output": 75.00},
    "claude-opus-4-7":   {"input": 15.00, "cache_write": 18.75, "cache_read": 1.50,  "output": 75.00},
}


# ── GPU rate — MinerU host ────────────────────────────────────────────────
# AWS g6.xlarge on-demand (us-east-1, Apr 2026): $1.007 / hr
# 1-year reserved no-upfront:                    $0.586 / hr
# We default to the on-demand figure. Self-hosters can lower this.
GPU_INSTANCE_USD_PER_HOUR = float(os.getenv("GPU_INSTANCE_USD_PER_HOUR", "1.007"))
GPU_RATE_USD_PER_SECOND = GPU_INSTANCE_USD_PER_HOUR / 3600.0


# ── Service markup ────────────────────────────────────────────────────────
#   Self-hosters:    SERVICE_MARKUP=1.0  → passthrough at raw cost
#   Hosted service:  SERVICE_MARKUP=1.35 (default) → covers idle GPU hours,
#                    storage, bandwidth, monitoring, margin
SERVICE_MARKUP = float(os.getenv("SERVICE_MARKUP", "1.35"))


def llm_cost(
    model: str,
    input_tokens: int = 0,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
    output_tokens: int = 0,
) -> float:
    """USD cost for one LLM call. Zero for unknown models (logged via caller)."""
    p = LLM_PRICES.get(model)
    if not p:
        return 0.0
    return (
        input_tokens * p["input"]
        + cache_write_tokens * p["cache_write"]
        + cache_read_tokens * p["cache_read"]
        + output_tokens * p["output"]
    ) / 1_000_000.0


def gpu_cost(seconds: float) -> float:
    """USD cost of `seconds` of GPU time at the amortized rate."""
    return max(0.0, seconds) * GPU_RATE_USD_PER_SECOND


def bill_user(raw_cost_usd: float) -> float:
    """Apply service markup. Rounded to 4 decimals."""
    return round(max(0.0, raw_cost_usd) * SERVICE_MARKUP, 4)


def pricing_snapshot() -> Dict:
    """Captured at the start of a paper's run so the user sees rates frozen."""
    return {
        "llm_prices_per_mtok": LLM_PRICES,
        "gpu_instance_usd_per_hour": GPU_INSTANCE_USD_PER_HOUR,
        "gpu_rate_usd_per_second": round(GPU_RATE_USD_PER_SECOND, 8),
        "service_markup": SERVICE_MARKUP,
    }
