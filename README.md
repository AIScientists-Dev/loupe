# ProofAgent

AI-powered paper validation and review assistant. Upload a research paper, get detailed findings on suspicious proof steps, questionable claims, and novelty gaps — then generate venue-specific review drafts.

## What It Does

1. **Upload** a paper PDF
2. **AI analyzes** the paper in 5 steps: parse, survey, examine, compare, verdict
3. **Findings** appear as red bounding boxes on the PDF with detailed reasoning
4. **You decide**: Agree, Dismiss, or Investigate each finding
5. **AI learns** from your feedback to improve future analyses
6. **Generate** structured draft reviews for ICLR, NeurIPS, JASA, NSF proposals, and more

## Quick Start

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Configuration

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Required: at least one LLM API key (Anthropic, OpenAI, DeepSeek, Moonshot, or MiniMax).

## Supported Models

| Model | Provider |
|-------|----------|
| Claude Opus | Anthropic |
| Claude Sonnet | Anthropic |
| GPT-4.1 | OpenAI |
| DeepSeek V3 | DeepSeek |
| Kimi K2.5 | Moonshot |
| MiniMax M2.7 | MiniMax |

## Key Features

- **Multi-step agentic analysis** — not a single LLM call, but a 5-step pipeline that reads, surveys, examines, compares, and filters
- **Binary findings** — no vague confidence scores, just YES with detailed reasoning
- **Investigation threads** — drill down into any finding with back-and-forth exchanges
- **User teaches AI** — your Agree/Dismiss decisions become learned rules for future papers
- **Focus areas** — tell the AI what you care about (proofs, statistics, novelty, etc.)
- **Draft review generation** — venue-specific templates (ICLR, NeurIPS, JASA, NSF, etc.) with configurable style and tone
- **Rerun preserves work** — change focus areas and rerun without losing your existing verdicts

## Architecture

```
Frontend (Next.js)          Backend (FastAPI)
  Upload PDF ──────────────► POST /v1/papers
  Poll status ◄──────────── GET  /v1/papers/{id}/status
  View findings ◄────────── GET  /v1/papers/{id}
  Agree/Dismiss ───────────► POST /v1/papers/{id}/findings/{fid}/decide
  Investigate ─────────────► POST /v1/papers/{id}/findings/{fid}/investigate
  Generate review ─────────► POST /v1/papers/{id}/draft-review
```

The backend uses **raw HTTP API calls** to LLM providers — no SDK dependencies. PDF parsing is delegated to MinerU (AWS GPU) with a local mock fallback for development.

## Project Structure

```
backend/
  app/
    main.py              # FastAPI app
    config.py            # Environment settings
    models.py            # All data models
    routes/              # API endpoints (papers, users)
    services/            # Orchestrator, LLM client, storage
    pipeline/            # 5-step analysis pipeline
      steps/             # parse, survey, examine, compare, verdict
      prompts/           # Programmatic prompt builder

frontend/
  app/                   # Next.js pages
    papers/              # Paper management + review workspace
    onboarding/          # First-time user survey
  components/
    workspace/           # PDF viewer, findings, exchanges
    review/              # Draft review generation
    papers/              # Paper cards and grid
    profile/             # Focus areas, onboarding
    ui/                  # Shared primitives
```

## License

MIT License - Copyright (c) 2026 AIScientists, Inc. (dba MorphMind)
