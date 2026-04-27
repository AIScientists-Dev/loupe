<p align="center">
  <img src="frontend/public/brand/social/readme-banner-1280x320.png" alt="Loupe — a loupe for your proofs" width="100%">
</p>

<div align="center">

# Loupe

**A loupe for your proofs.**
An open-source AI proof reviewer for math and statistics papers.

[![Demo](https://img.shields.io/badge/Demo-→-065F46?style=for-the-badge)](https://loupe.morphmind.ai)

[![Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)](./LICENSE) [![Hosted](https://img.shields.io/badge/Hosted-loupe.morphmind.ai-065F46?style=flat-square)](https://loupe.morphmind.ai) [![MorphMind](https://img.shields.io/badge/by-MorphMind-124442?style=flat-square)](https://morphmind.ai) [![Privacy](https://img.shields.io/badge/local%20LLM-supported-2D6A4F?style=flat-square)](#privacy-by-design)

[**What it does**](#what-loupe-does) · [**Quick start**](#quick-start) · [**Privacy**](#privacy-by-design) · [**Model providers**](#model-providers) · [**Architecture**](#architecture)

</div>

> The hosted demo at **[loupe.morphmind.ai](https://loupe.morphmind.ai)** runs the latest release. Registration is gated by single-use invitation codes — request one at [morphmind.ai/loupe](https://morphmind.ai) — but everything you see there you can self-host with the steps below.

---

## What Loupe does

Loupe is an AI review tool for statistics and CS-theory journal editors. Upload a paper; in 1–2 minutes, Loupe surfaces the handful of proof steps that deserve a second look — arithmetic slips, flipped inequalities, unstated assumptions, wrong constants, quantifier confusion — then lets you agree, dismiss, or push back on each one before generating a draft review you can edit and send.

It's the opinionated take of a journal reviewer's first pass, compressed from two hours into twenty minutes.

**Loupe is not** a proof solver, a plagiarism checker, or a replacement for human judgment. It's a magnifier — you decide what matters.

## Key features

- **Two-stage review** — a 60-second triage produces an H/M/L verdict; a deep dive then scores the paper across six dimensions (proof, literature, clarity, numerical, relevance, novelty).
- **Visual localization** — every finding is pinned to a bounding box on the PDF, verified by a vision pass. Parser-mismatched findings are dropped, never faked.
- **Issue types grounded in the domain** — arithmetic, logic, unstated assumption, wrong constant, quantifier scope, citation required, definition mismatch, missing step.
- **Investigate, don't trust blindly** — any finding opens into a back-and-forth thread. Quick actions: re-derive, find a counterexample, check the citation, propose a fix.
- **Severity + confidence on every finding** — triage in seconds; sort by severity, page, or confidence.
- **Draft review generator** — produces structured markdown grouped by your verdicts. Edit live; copy or download as `.md` / `.pdf`.
- **Model-agnostic** — Anthropic, OpenAI, DeepSeek, Moonshot, MiniMax — or your own local Ollama / vLLM / LM Studio server. Pick from the settings panel.
- **Local-first by default** — your laptop is enough. Bring your own key, or skip the cloud entirely with the local-LLM path.

---

## Privacy by design

Peer review hands you the most sensitive document an academic produces — an unpublished manuscript under embargo. Loupe is built so you can do the work without that document ever leaving your hardware.

- **Run end-to-end on a local LLM.** Point Loupe at [Ollama](https://ollama.com), [vLLM](https://github.com/vllm-project/vllm), [LM Studio](https://lmstudio.ai), `llama.cpp`'s server, or any OpenAI-compatible endpoint. Configure two env vars and the model selector picks it up automatically.
- **Self-host the PDF parser.** [MinerU](https://github.com/opendatalab/MinerU) is open-source. Run it on your own GPU and Loupe will use it.
- **No telemetry.** Self-hosted Loupe does not phone home. The only outbound HTTP is to the LLM and parser endpoints **you** configure.
- **Hosted is opt-in.** [`loupe.morphmind.ai`](https://loupe.morphmind.ai) is a separate convenience deployment by MorphMind for users who don't want to run infra. Self-hosters never touch it.

The settings panel labels each provider with its privacy posture so you can see at a glance whether your paper text leaves the machine.

## Model providers

| Group | Models | Privacy posture | Key |
|---|---|---|---|
| **Anthropic** | Claude Opus 4.7 (highest quality), Claude Sonnet 4.6 (default) | Sends paper text to Anthropic | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-4.1 | Sends paper text to OpenAI | `OPENAI_API_KEY` |
| **China** | DeepSeek V3, Moonshot Kimi K2.5, MiniMax M2.7 | Sends paper text to the chosen provider | `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` / `MINIMAX_API_KEY` |
| **Ollama (local)** | any model in your `OLLAMA_MODELS` list | **Your paper never leaves your machine** | `OLLAMA_BASE_URL`, `OLLAMA_MODELS` |
| **Custom OpenAI-compatible (local)** | any model your endpoint serves | Goes only to the endpoint you configured | `LOCAL_OPENAI_BASE_URL`, `LOCAL_OPENAI_API_KEY`, `LOCAL_OPENAI_MODELS` |

Configure as many as you like — Loupe queries `GET /v1/providers` at runtime and the settings panel shows only the ones that are reachable. Visual localization currently requires a vision-capable cloud model (Claude or GPT-4.1); local-only mode keeps text analysis private and skips visual verification.

---

## Quick start

### Frontend-only (mock mode — no backend, no keys)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3009>. The frontend ships with a 5-bug fixture; you can walk the full upload → analyze → review flow without any backend. Set `NEXT_PUBLIC_USE_MOCK=0` in `frontend/.env.local` later to switch to the real backend.

### Full local stack (backend + frontend + your choice of LLM)

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env
# Edit ../.env — fill in at least ONE of the provider blocks below.
uvicorn app.main:app --reload --port 8009

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev   # http://localhost:3009
```

#### Cloud setup (one example)

```bash
# in .env
ANTHROPIC_API_KEY=sk-ant-...
DEFAULT_MODEL=claude-sonnet-4-6
```

#### Local setup with Ollama (private path)

```bash
# in .env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODELS=qwen2.5:32b,llama3.1:70b
DEFAULT_MODEL=ollama:qwen2.5:32b
```

```bash
# host
ollama pull qwen2.5:32b
ollama serve   # runs on :11434 by default
```

That's it — Loupe will route every analysis call to Ollama. Your paper text never leaves localhost.

---

## Architecture

```
                 ┌──────────────────────┐
                 │  Next.js 14 frontend │
                 │   /papers · workspace │
                 └──────────┬───────────┘
                       /api │  mock-able via MSW
                            ▼
                 ┌──────────────────────┐
                 │    FastAPI backend    │
                 │   JSON-file storage   │
                 └──────────┬───────────┘
        ┌───────────────────┼──────────────────────┐
        ▼                   ▼                      ▼
 ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐
 │   MinerU    │   │  LLM providers   │   │  Vision model    │
 │  (parse →   │   │  Anthropic /     │   │ (localize bbox + │
 │   markdown) │   │  OpenAI / China /│   │  verify evidence)│
 │  self-host  │   │  Ollama / local  │   │   cloud vision   │
 │  optional   │   │  OpenAI-compat   │   │   model required │
 └─────────────┘   └──────────────────┘   └──────────────────┘
```

Everything is **raw HTTP** — no SDK dependencies for LLM providers, easy to fork and swap. Storage is flat JSON files in `data/` for clone-and-inspect friendliness.

## Project structure

```
loupe/
├── backend/
│   └── app/
│       ├── main.py               # FastAPI app, singletons
│       ├── config.py             # env-driven settings
│       ├── models.py             # Pydantic shapes (mirror frontend/lib/types.ts)
│       ├── routes/               # /papers, findings, review, providers, folders
│       ├── services/             # orchestrator, llm_client, storage, mineru_client
│       └── pipeline/             # 3 steps: parse → extract_proofs → verify_proofs
│           └── prompts/          # composable prompt builders
├── frontend/
│   ├── app/                      # Next.js App Router
│   │   └── papers/[id]/          # workspace (PDF + findings panel)
│   ├── components/
│   │   ├── brand/                # Loupe mark + lockup
│   │   ├── shell/                # sidebar, theme toggle, MSW boot
│   │   ├── papers/               # list, card, upload dialog
│   │   ├── workspace/            # PDF viewer, finding card, progress strip
│   │   ├── review/               # report card + draft modal
│   │   └── ui/                   # shadcn primitives
│   ├── lib/
│   │   ├── api.ts                # typed fetch wrappers (the API contract)
│   │   ├── types.ts              # mirrors backend models
│   │   └── hooks/                # TanStack Query hooks
│   ├── mocks/                    # MSW handlers + fixtures (5-planted-bug fixture)
│   └── public/
│       ├── brand/                # Loupe mark, lockup, decor, social
│       └── icons/issue-types/    # 9 finding glyphs
├── LICENSE                       # Apache 2.0
├── NOTICE                        # required Apache attribution
└── README.md
```

## API contract

Fully documented in `frontend/lib/api.ts`. Core surface:

```
GET    /v1/papers                           list papers
POST   /v1/papers                           upload (multipart) + kick pipeline
GET    /v1/papers/{id}                      full paper + findings + exchanges
DELETE /v1/papers/{id}
GET    /v1/papers/{id}/status               poll pipeline state
GET    /v1/papers/{id}/events               SSE stream (optional)
GET    /v1/papers/{id}/pdf                  binary PDF

POST   /v1/papers/{id}/findings/{fid}/decide        agree | dismiss
POST   /v1/papers/{id}/findings/{fid}/investigate   back-and-forth
POST   /v1/papers/{id}/findings/{fid}/localize      on-demand vision-verify

POST   /v1/papers/{id}/review/generate      → {draft_id, markdown}
PATCH  /v1/papers/{id}/review/{draft_id}    save editor changes
GET    /v1/papers/{id}/review/{draft_id}/export?format=pdf|md

GET    /v1/providers                        configured LLM providers + reachability
```

Error envelope is uniform: `{ error: { code, message, detail? } }`.

## Design system

Loupe is a sibling product in the MorphMind design family:

- **Primary:** emerald `#065F46` (`oklch(0.432 0.095 166.913)`)
- **Type:** Noto Sans (UI + wordmark) · Geist Mono (code + formulae)
- **Mark:** lens + reticle (precision, optical). Distinct from sister projects' marks.
- **Tokens:** live in `frontend/app/globals.css` as CSS variables.

## Hosted vs self-hosted

| | Hosted (loupe.morphmind.ai) | Self-hosted |
|---|---|---|
| Setup | None — sign in with an invitation code | Clone, install, fill in `.env` |
| LLM key | MorphMind's | Yours |
| PDF parsing | MorphMind's MinerU | Yours (or skip) |
| Privacy | Paper text reaches MorphMind + the chosen LLM | Stays on your hardware (Ollama path) |
| Cost | Per-paper fee — see pricing page | Provider cost only |
| Updates | Latest release, automatically | When you `git pull` |

## Contributing

Loupe is in active development. The most useful contributions right now:

1. **Try it on a real paper** and open an issue with a screenshot + the paper's arXiv link. The hardest thing to improve is the verifier prompt; real cases drive that.
2. **File false-positive and false-negative examples** with the quoted evidence — we use these to tune `verify_proofs`.
3. **New LLM provider routes** — extend `_ROUTING` in `backend/app/services/llm_client.py` and the matching entry in `backend/app/routes/providers.py`.
4. **Frontend polish** — empty states, a11y, keyboard shortcuts, dark-mode audit.

Loupe is licensed under Apache 2.0; by submitting a PR you agree your contribution is licensed under the same terms (no separate CLA required — the Apache 2.0 patent grant in §3 of `LICENSE` covers your contribution automatically). Please open an issue before sending a PR for anything larger than a bug fix.

## Roadmap (not promises)

- SSE streaming for the analysis view
- Token streaming on investigation replies
- Local vision model adapter (so the localize step works without a cloud key)
- Batch mode (queue up 10 papers, walk through them in sequence)
- Learned-rules personalization (what the editor flagged last time, de-duplicated this time)
- Venue templates (JASA, Biometrika, NeurIPS, ICML) for the draft review
- Docker compose one-liner

## License

Apache 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Copyright © 2026 AIScientists, Inc. (dba MorphMind).

---

<p align="center">
  <sub>
    Loupe is an open-source agent by <a href="https://morphmind.ai"><strong>MorphMind</strong></a>.<br>
    Hosted at <a href="https://loupe.morphmind.ai">loupe.morphmind.ai</a> · Engineering lead: Jay (jie@morphmind.ai).
  </sub>
</p>
