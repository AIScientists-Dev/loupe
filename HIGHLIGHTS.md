# What's interesting about Loupe

Four design choices that make Loupe different from "ask a chatbot to review my paper". Each one is a few hundred lines of code in this repo, not a marketing claim.

## 1. Two-stage review, not one giant prompt

Triage runs in ~15s for ~$0.03 regardless of paper length — front matter + TOC-located formulation pages + references, capped at 16K input chars. Deep dive is opt-in, segment-by-segment, with a per-paper budget cap and a 100-page hard cap. A 200-page manuscript triages for the same cost as a 20-page note; the user only spends the deep-dive budget on papers the triage flagged worth it.

→ [`backend/app/pipeline/steps/triage.py`](backend/app/pipeline/steps/triage.py),
[`backend/app/pipeline/runner.py`](backend/app/pipeline/runner.py)

## 2. Tiered localization (free → cheap → vision)

Findings are pinned to PDF coordinates by trying three locators in cost order:

1. **Text-layer search** in the rendered PDF. Free, exact when the quote tokenizes cleanly.
2. **Deterministic markdown anchor** over the parsed `paper.markdown`, ranked against the finding's parent proof block. Free, picks the right occurrence when the quote appears more than once.
3. **Vision tiebreaker** — fires only when the parent-block constraint yields multiple candidates or none. Vision picks an index, never coordinates.

No fabricated boxes. Findings the locator can't place are surfaced as "approximate" rather than silently dropped.

→ [`backend/app/pipeline/text_anchor.py`](backend/app/pipeline/text_anchor.py),
[`backend/app/services/vision_client.py`](backend/app/services/vision_client.py)

## 3. Cacheable digest cuts long-paper cost ~70%

`build_digest` constructs one stable context block per paper (parsed markdown digest + paper-level facts) and reuses it via prompt caching across every segment of the deep-dive pass. A 50-page paper that would cost ~$1.20 with naive re-prompting runs ~$0.40 because the verifier prompt's prefix is cache-hit on every segment after the first.

→ [`backend/app/pipeline/steps/build_digest.py`](backend/app/pipeline/steps/build_digest.py),
[`backend/app/pipeline/steps/verify_proofs.py`](backend/app/pipeline/steps/verify_proofs.py)

## 4. Expert-in-the-loop by default

Every finding can be agreed, dismissed, re-derived, or investigated in a thread. Quick actions on the investigation modal — *re-derive*, *find a counterexample*, *check the citation*, *propose a fix* — open a focused conversation on that one finding, not the whole paper. The final review draft groups by your decisions, not the model's. Reviewers stay accountable; the AI assists rather than replaces.

→ [`backend/app/routes/papers.py`](backend/app/routes/papers.py) (decide / investigate endpoints),
[`frontend/components/workspace/finding-card.tsx`](frontend/components/workspace/finding-card.tsx)

---

## Roadmap themes (not promises)

- Local vision adapter so the localize step works with self-hosted vision models on the same `VISION_MODEL` knob.
- Streaming token deltas on investigate replies (currently arrive as a single chunk).
- Learned-rules personalization — what the editor flagged last time, de-duplicated this time.
- Venue-specific draft templates (JASA, Biometrika, NeurIPS, ICML).
