"""Paper endpoints — upload, status, SSE, findings, review."""
from __future__ import annotations

import asyncio
import json as _json
import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.models import (
    BatchAction,
    BatchRequest,
    BatchResponse,
    BatchResultItem,
    BatchResultSummary,
    CostReport,
    DecideRequest,
    Dimension,
    DimensionScore,
    Finding,
    FinalizeReviewResponse,
    FlagPatchRequest,
    FolderPatchRequest,
    InvestigateRequest,
    LocalizeStatus,
    Paper,
    PaperFlag,
    PaperStatusResponse,
    PaperSummary,
    PIPELINE_ORDER,
    PlaceRequest,
    ReviewDraft,
    ReviewDraftSummary,
    ReviewGenerateRequest,
    ReviewPatchRequest,
    ReviewStyleSnapshot,
    ScoresResponse,
    Severity,
    TriageReport,
    VenueType,
)
from app.services.events import bus, format_sse
from app.services.orchestrator import Orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/papers", tags=["papers"])


def _orch() -> Orchestrator:
    from app.main import get_orchestrator
    return get_orchestrator()


# Score adjustments applied per kept (agreed) finding, by severity. Mirrors
# the §3.3 formula in the v2 plan exactly. The frontend uses the same
# numbers client-side for live updates as the user agrees/dismisses.
_KEEP_PENALTY = {"high": -0.8, "medium": -0.4, "low": -0.2}
_DISMISS_BONUS = 0.1   # small "false alarm" credit


def _adjust_scores(
    base: List[DimensionScore],
    findings: List[Finding],
) -> List[DimensionScore]:
    """Return a copy of `base` with §3.3 adjustments applied per dimension.

    `base.score` is the LLM-emitted 0..10 reflecting the raw findings; we
    overlay the user's decisions on top. Dismissed → small credit, agreed →
    severity-weighted penalty. Clamped to [0, 10].
    """
    by_id = {f.finding_id: f for f in findings}
    out: List[DimensionScore] = []
    for ds in base:
        delta = 0.0
        for fid in ds.finding_ids:
            f = by_id.get(fid)
            if not f or not f.decision:
                continue
            if f.decision.value == "dismiss":
                delta += _DISMISS_BONUS
            elif f.decision.value == "agree":
                delta += _KEEP_PENALTY.get(f.severity.value, 0.0)
        out.append(DimensionScore(
            dimension=ds.dimension,
            score=round(max(0.0, min(10.0, ds.score + delta)), 2),
            rationale=ds.rationale,
            finding_ids=list(ds.finding_ids),
        ))
    return out


# -- CRUD ---------------------------------------------------------------------

@router.post("", response_model=Paper)
async def create_paper(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    venue_type: Optional[str] = Form(None),
    venue_name: Optional[str] = Form(None),
    folder: Optional[str] = Form(None),
    review_style: Optional[str] = Form(None),  # JSON-encoded ReviewStyleSnapshot
    orch: Orchestrator = Depends(_orch),
):
    if file.content_type not in ("application/pdf", "application/octet-stream", None):
        raise HTTPException(400, detail={"code": "pdf_unreadable", "message": "Only PDF uploads are supported"})
    raw = await file.read()
    if not raw:
        raise HTTPException(400, detail={"code": "pdf_unreadable", "message": "Uploaded PDF is empty"})

    # Parse v2 multipart fields. All optional; the orchestrator falls back to
    # journal/Inbox/None if missing so legacy upload flows keep working.
    vt = VenueType.journal
    if venue_type:
        try:
            vt = VenueType(venue_type)
        except ValueError:
            raise HTTPException(400, detail={
                "code": "invalid_venue_type",
                "message": f"venue_type must be one of {[v.value for v in VenueType]}",
            })

    style: Optional[ReviewStyleSnapshot] = None
    if review_style:
        try:
            style = ReviewStyleSnapshot(**_json.loads(review_style))
        except Exception as e:
            logger.warning("create_paper: ignoring malformed review_style: %s", e)
            style = None

    paper = orch.create_paper(
        file.filename or "paper.pdf",
        raw,
        venue_type=vt,
        venue_name=venue_name or None,
        folder=folder or "Inbox",
        review_style=style,
    )
    # v2: upload kicks the triage pass (~60s, ≤$0.05). The full deep dive
    # only fires on POST /dive-deep, after the user reviews the triage card.
    background.add_task(orch.triage_task, paper.paper_id)
    return paper


@router.get("", response_model=List[PaperSummary])
def list_papers(orch: Orchestrator = Depends(_orch)):
    return orch.list_papers()


@router.get("/{paper_id}", response_model=Paper)
def get_paper(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return paper


@router.delete("/{paper_id}", status_code=204)
def delete_paper(paper_id: str, orch: Orchestrator = Depends(_orch)):
    if not orch.delete_paper(paper_id):
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return Response(status_code=204)


# -- v2 triage / dive-deep ---------------------------------------------------

@router.get("/{paper_id}/triage", response_model=TriageReport)
def get_triage(paper_id: str, orch: Orchestrator = Depends(_orch)):
    """Returns the triage report once it's been computed. 404 until the
    triage task lands. Frontend polls or relies on `triage.completed` SSE."""
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    if not paper.triage:
        raise HTTPException(404, detail={
            "code": "triage_pending",
            "message": "Triage has not completed yet",
        })
    return paper.triage


@router.post("/{paper_id}/dive-deep", response_model=Paper, status_code=202)
def dive_deep_run(
    paper_id: str,
    background: BackgroundTasks,
    orch: Orchestrator = Depends(_orch),
):
    """Kick the deep-dive pipeline (parse + extract + verify + dimension
    passes). Idempotent: re-calling while diving/dived is a no-op."""
    paper, scheduled = orch.dive_deep(paper_id)
    if paper is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    if scheduled:
        background.add_task(orch.run_pipeline_task, paper_id)
    return paper


@router.get("/{paper_id}/scores", response_model=ScoresResponse)
def get_scores(paper_id: str, orch: Orchestrator = Depends(_orch)):
    """Snapshot of per-dimension scores adjusted by current decisions.

    The frontend computes the same adjustment client-side for live updates;
    this endpoint exists so a fresh page load (or share view) starts from
    the right number without recomputing in the browser. `frozen=true` once
    finalize-review has been called.

    Base scores are re-derived from `_compute_base_scores(paper)` on every
    call rather than read from the persisted snapshot. This keeps /scores
    robust to formula changes (the prior formula penalized findings into
    the base, which double-counted once `_adjust_scores` overlaid the
    decisions). Once `final_score` is frozen we still return the persisted
    snapshot so the freeze stays exactly where the user left it.
    """
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})

    if paper.final_score is not None:
        # Frozen — return persisted scores verbatim so the radar doesn't shift.
        dims = list(paper.dimension_scores)
        aggregate = paper.final_score
    else:
        # Live — recompute base, overlay current decisions.
        base = Orchestrator._compute_base_scores(paper)
        dims = _adjust_scores(base, paper.findings)
        aggregate = round(sum(d.score for d in dims) / len(dims), 2) if dims else 0.0
    return ScoresResponse(
        dimensions=dims,
        aggregate=aggregate,
        frozen=paper.final_score is not None,
    )


@router.patch("/{paper_id}/folder", response_model=Paper)
def patch_folder(
    paper_id: str,
    req: FolderPatchRequest,
    orch: Orchestrator = Depends(_orch),
):
    paper = orch.set_folder(paper_id, req.folder)
    if paper is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return paper


@router.post("/{paper_id}/flag", response_model=Paper)
def post_flag(
    paper_id: str,
    req: FlagPatchRequest,
    orch: Orchestrator = Depends(_orch),
):
    """v3 — set/clear the user flag (Promising / Rejected). Idempotent set,
    not toggle: passing the same flag twice is a no-op; passing the
    opposite flag overwrites; passing null clears."""
    paper = orch.set_flag(paper_id, req.flag)
    if paper is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return paper


# -- v3 batch ----------------------------------------------------------------

@router.post("/batch", response_model=BatchResponse)
def batch_action(
    req: BatchRequest,
    background: BackgroundTasks,
    orch: Orchestrator = Depends(_orch),
):
    """Apply one action to N papers. Per-paper success/failure rolls up in
    `results`; `summary` gives counts. Idempotent operations (dive_deep on
    a diving/dived paper, flag matching the current value) report
    `ok=true skipped=true` rather than failing.

    Dive-deep schedules the runner via FastAPI BackgroundTasks (same path
    as POST /dive-deep), so this returns quickly with the umbrella result;
    per-paper progress flows over the existing SSE channels.
    """
    bus.emit("_global", "dive.batch.started" if req.action == BatchAction.dive_deep else f"batch.{req.action.value}.started", {
        "paper_ids": req.ids, "total": len(req.ids),
    })

    results: list[BatchResultItem] = []

    for pid in req.ids:
        try:
            if req.action == BatchAction.dive_deep:
                paper, scheduled = orch.dive_deep(pid)
                if paper is None:
                    results.append(BatchResultItem(paper_id=pid, ok=False, error="not_found"))
                    continue
                if scheduled:
                    background.add_task(orch.run_pipeline_task, pid)
                    results.append(BatchResultItem(paper_id=pid, ok=True))
                else:
                    # Already diving/dived — silent skip per spec.
                    results.append(BatchResultItem(paper_id=pid, ok=True, skipped=True))

            elif req.action == BatchAction.flag:
                raw_flag = (req.payload or {}).get("flag")
                flag_value: PaperFlag | None = None
                if raw_flag is not None:
                    try:
                        flag_value = PaperFlag(raw_flag)
                    except ValueError:
                        results.append(BatchResultItem(paper_id=pid, ok=False, error=f"invalid flag: {raw_flag!r}"))
                        continue
                paper = orch.set_flag(pid, flag_value)
                if paper is None:
                    results.append(BatchResultItem(paper_id=pid, ok=False, error="not_found"))
                else:
                    results.append(BatchResultItem(paper_id=pid, ok=True))

            elif req.action == BatchAction.set_folder:
                folder = (req.payload or {}).get("folder")
                # Validate against the folder store: explicit name must exist.
                if folder is not None:
                    cleaned = str(folder).strip() or None
                    if cleaned is not None and orch.folder_store.get(cleaned) is None:
                        results.append(BatchResultItem(paper_id=pid, ok=False, error=f"folder not found: {cleaned!r}"))
                        continue
                    folder = cleaned
                paper = orch.set_folder(pid, folder)
                if paper is None:
                    results.append(BatchResultItem(paper_id=pid, ok=False, error="not_found"))
                else:
                    results.append(BatchResultItem(paper_id=pid, ok=True))

            elif req.action == BatchAction.delete:
                if orch.delete_paper(pid):
                    results.append(BatchResultItem(paper_id=pid, ok=True))
                else:
                    results.append(BatchResultItem(paper_id=pid, ok=False, error="not_found"))

            else:
                results.append(BatchResultItem(paper_id=pid, ok=False, error=f"unknown action: {req.action}"))

            # Per-paper progress for live UI feedback in dive_deep batches.
            if req.action == BatchAction.dive_deep:
                last = results[-1]
                bus.emit("_global", "dive.batch.progress", {
                    "paper_id": pid,
                    "ok": last.ok,
                    "skipped": last.skipped,
                    "error": last.error,
                })

        except Exception as e:
            logger.exception("batch action %s failed for %s", req.action, pid)
            results.append(BatchResultItem(paper_id=pid, ok=False, error=str(e)))

    summary = BatchResultSummary(
        ok=sum(1 for r in results if r.ok),
        failed=sum(1 for r in results if not r.ok),
    )
    if req.action == BatchAction.dive_deep:
        bus.emit("_global", "dive.batch.completed", {
            "ok": summary.ok, "failed": summary.failed,
        })

    return BatchResponse(results=results, summary=summary)


@router.post("/{paper_id}/finalize-review", response_model=FinalizeReviewResponse)
async def finalize_review(
    paper_id: str,
    req: ReviewGenerateRequest,
    orch: Orchestrator = Depends(_orch),
):
    """Freeze the aggregate score (§3.3) and generate the final draft."""
    config = {k: v for k, v in req.model_dump().items() if v is not None}
    result = await orch.finalize_review(paper_id, config)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    aggregate, draft_id = result
    return FinalizeReviewResponse(aggregate=aggregate, draft_id=draft_id)


# -- status -------------------------------------------------------------------

@router.get("/{paper_id}/status", response_model=PaperStatusResponse)
def get_status(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    active = [f for f in paper.findings if not f.soft_deleted]
    localize_pending = sum(1 for f in active if f.localize_status == LocalizeStatus.pending)
    return PaperStatusResponse(
        status=paper.status,
        step=paper.step,
        step_index=paper.step_index,
        total_steps=len(PIPELINE_ORDER),
        error_code=paper.error_code,
        error_message=paper.error_message,
        finding_count=len(active),
        localize_pending=localize_pending,
    )


# -- PDF binary ---------------------------------------------------------------

@router.get("/{paper_id}/pdf")
def serve_pdf(paper_id: str, orch: Orchestrator = Depends(_orch)):
    pdf_bytes = orch.store.load_pdf(paper_id)
    if not pdf_bytes:
        raise HTTPException(404, detail={"code": "not_found", "message": "PDF not found"})
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.get("/{paper_id}/pdf-annotated")
def serve_pdf_annotated(paper_id: str, orch: Orchestrator = Depends(_orch)):
    """Original PDF + PDF annotations (red rectangles + popup notes) for every
    KEPT finding. Uses native PDF annotation objects so the paper's own
    existing annotations (if any) are preserved, and the new ones are
    toggleable/interactive in any reader."""
    pdf_bytes = orch.store.load_pdf(paper_id)
    paper = orch.get_paper(paper_id)
    if not pdf_bytes or not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "PDF not found"})

    import io
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        added = 0
        for f in paper.findings:
            if f.soft_deleted:
                continue
            bbox = f.bbox
            if bbox is None:
                continue
            page_idx = bbox.page - 1
            if page_idx < 0 or page_idx >= doc.page_count:
                continue
            page = doc.load_page(page_idx)
            rect = fitz.Rect(
                bbox.x, bbox.y,
                bbox.x + bbox.width, bbox.y + bbox.height,
            )
            annot = page.add_rect_annot(rect)
            # red stroke, no fill, thicker border
            annot.set_colors(stroke=(0.86, 0.15, 0.15))
            annot.set_border(width=1.6)
            annot.set_opacity(0.9)
            # popup/title shows in-reader on hover/click
            annot.set_info(
                title=f"Loupe — {f.issue_type} ({f.severity})",
                content=f"{f.description}\n\nEvidence: {f.evidence_quote[:400]}",
            )
            annot.update()
            added += 1

        buf = io.BytesIO()
        # incremental=False so we get a fresh PDF with the annotation tree included
        doc.save(buf, garbage=4, deflate=True)
        return Response(
            content=buf.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{paper.filename or "paper"}_annotated.pdf"',
                "X-Loupe-Annotations-Added": str(added),
            },
        )
    finally:
        doc.close()


# -- page thumbnail (for the top thumbnail strip) ----------------------------

@router.get("/{paper_id}/pages/{page_number}/thumb.png")
def page_thumbnail(
    paper_id: str,
    page_number: int,
    orch: Orchestrator = Depends(_orch),
):
    png_bytes = _render_thumb(orch.store, paper_id, page_number)
    if png_bytes is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Thumbnail not available"})
    return Response(content=png_bytes, media_type="image/png", headers={
        "Cache-Control": "public, max-age=3600",
    })


_THUMB_DPI = 72  # low-DPI is plenty for a sidebar thumb


def _render_thumb(store, paper_id: str, page_number: int) -> bytes | None:
    """Lazy-render + cache a per-page thumbnail. Fallback if cache missing."""
    from pathlib import Path
    import fitz
    cache_dir = Path(store.base) / "thumbs" / paper_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{page_number:04d}.png"
    if cache_path.exists():
        return cache_path.read_bytes()
    pdf_bytes = store.load_pdf(paper_id)
    if not pdf_bytes:
        return None
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            if page_number < 1 or page_number > doc.page_count:
                return None
            page = doc.load_page(page_number - 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(_THUMB_DPI / 72.0, _THUMB_DPI / 72.0), alpha=False)
            png = pix.tobytes("png")
        cache_path.write_bytes(png)
        return png
    except Exception:
        return None


# -- SSE events ---------------------------------------------------------------

@router.get("/{paper_id}/events")
async def stream_events(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})

    async def event_generator():
        queue = bus.subscribe(paper_id)
        try:
            yield format_sse("hello", {
                "paper_id": paper_id,
                "status": paper.status.value,
                "step": paper.step.value,
                "step_index": paper.step_index,
            })
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield b": ping\n\n"
                    continue
                yield format_sse(payload["event"], payload["data"])
                if payload["event"] in ("pipeline.done", "step.failed"):
                    # Drain any late events for 1s, then close.
                    try:
                        late = await asyncio.wait_for(queue.get(), timeout=1.0)
                        yield format_sse(late["event"], late["data"])
                    except asyncio.TimeoutError:
                        break
        finally:
            bus.unsubscribe(paper_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# -- stop / resume / skip / cost --------------------------------------------

@router.post("/{paper_id}/stop", response_model=Paper)
def stop_run(paper_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.stop(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return result


@router.post("/{paper_id}/resume", response_model=Paper)
def resume_run(
    paper_id: str,
    background: BackgroundTasks,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.resume(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    # Let the next segment through even if the billed cost is already
    # past settings.max_budget_usd — user explicitly asked to continue.
    from app.pipeline.runner import enable_budget_bypass
    enable_budget_bypass(paper_id)
    # Kick the scheduler off the ASGI event loop.
    background.add_task(orch.run_pipeline_task, paper_id)
    return result


@router.post("/{paper_id}/reanalyze", response_model=Paper)
def reanalyze_run(
    paper_id: str,
    background: BackgroundTasks,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.reanalyze(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    # Skip budget cap for an explicit re-analyze — the user knows what they
    # asked for and accepted the cost estimate in the confirm dialog.
    from app.pipeline.runner import enable_budget_bypass
    enable_budget_bypass(paper_id)
    background.add_task(orch.reanalyze_task, paper_id)
    return result


@router.post("/{paper_id}/segments/{segment_id}/skip", response_model=Paper)
def skip_segment(paper_id: str, segment_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.skip_segment(paper_id, segment_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or segment not found"})
    return result


@router.post("/{paper_id}/segments/{segment_id}/include", response_model=Paper)
def include_segment(paper_id: str, segment_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.include_segment(paper_id, segment_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or segment not found"})
    return result


@router.get("/{paper_id}/cost", response_model=CostReport)
def get_cost(paper_id: str, orch: Orchestrator = Depends(_orch)):
    report = orch.build_cost_report(paper_id)
    if report is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return report


# -- localize -----------------------------------------------------------------

@router.post("/{paper_id}/findings/{finding_id}/localize", response_model=Finding)
async def localize_finding_route(
    paper_id: str,
    finding_id: str,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.localize_one(paper_id, finding_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


@router.post("/{paper_id}/findings/{finding_id}/place", response_model=Finding)
async def place_finding_route(
    paper_id: str,
    finding_id: str,
    req: PlaceRequest,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.place_finding(paper_id, finding_id, req.page, req.bbox)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


@router.post("/{paper_id}/findings/{finding_id}/verify", response_model=Finding)
async def verify_finding_route(
    paper_id: str,
    finding_id: str,
    orch: Orchestrator = Depends(_orch),
):
    """Tier-4 on-demand vision presence check."""
    result = await orch.verify_finding(paper_id, finding_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


# -- decide / investigate -----------------------------------------------------

@router.post("/{paper_id}/findings/{finding_id}/decide", response_model=Finding)
async def decide_finding_route(
    paper_id: str,
    finding_id: str,
    req: DecideRequest,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.decide_finding(paper_id, finding_id, req.decision, req.note)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


@router.post("/{paper_id}/findings/{finding_id}/investigate", response_model=Finding)
async def investigate_finding_route(
    paper_id: str,
    finding_id: str,
    req: InvestigateRequest,
    orch: Orchestrator = Depends(_orch),
):
    if not (req.message or "").strip():
        raise HTTPException(400, detail={"code": "validation_error", "message": "message is required"})
    result = await orch.investigate_finding(paper_id, finding_id, req.message)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


# -- review draft -------------------------------------------------------------

@router.post("/{paper_id}/review/generate", response_model=ReviewDraft)
async def generate_review_route(
    paper_id: str,
    req: ReviewGenerateRequest | None = None,
    orch: Orchestrator = Depends(_orch),
):
    config = req.model_dump(exclude_none=True) if req else {}
    result = await orch.generate_review(paper_id, config=config)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return result


@router.get("/{paper_id}/reviews", response_model=List[ReviewDraftSummary])
def list_reviews_route(
    paper_id: str,
    orch: Orchestrator = Depends(_orch),
):
    drafts = orch.list_reviews(paper_id)
    if drafts is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return [_summarize_draft(d) for d in drafts]


def _summarize_draft(d: ReviewDraft) -> ReviewDraftSummary:
    import re
    body = d.markdown or ""
    # Strip markdown headings, list markers, blockquotes for a clean preview.
    cleaned = re.sub(r"^#{1,6}\s+", "", body, flags=re.MULTILINE)
    cleaned = re.sub(r"^[>\-\*]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    preview = cleaned[:140] + ("…" if len(cleaned) > 140 else "")
    words = len(re.findall(r"\w+", body))
    return ReviewDraftSummary(
        draft_id=d.draft_id,
        created_at=d.created_at,
        updated_at=d.updated_at,
        word_count=words,
        preview=preview,
    )


@router.get("/{paper_id}/review/{draft_id}", response_model=ReviewDraft)
def get_review_route(
    paper_id: str,
    draft_id: str,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.get_review(paper_id, draft_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})
    return result


@router.patch("/{paper_id}/review/{draft_id}", response_model=ReviewDraft)
async def patch_review_route(
    paper_id: str,
    draft_id: str,
    req: ReviewPatchRequest,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.patch_review(paper_id, draft_id, req.markdown)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})
    return result


@router.get("/{paper_id}/review/{draft_id}/export")
def export_review_route(
    paper_id: str,
    draft_id: str,
    format: str = "md",
    orch: Orchestrator = Depends(_orch),
):
    draft = orch.get_review(paper_id, draft_id)
    if draft is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})

    if format == "md":
        return Response(
            content=draft.markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="review-{draft_id[:8]}.md"'},
        )
    if format == "pdf":
        pdf_bytes = _render_markdown_pdf(draft.markdown)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="review-{draft_id[:8]}.pdf"'},
        )
    raise HTTPException(400, detail={"code": "validation_error", "message": "format must be 'md' or 'pdf'"})


def _render_markdown_pdf(md: str) -> bytes:
    """Render markdown → HTML → PDF using PyMuPDF Story + DocumentWriter.

    Stays inside the existing PyMuPDF dep so the backend installs cleanly via
    pip alone (no brew/apt-get for pango/cairo/weasyprint).
    """
    import io
    import fitz  # PyMuPDF
    import markdown as md_lib

    html_body = md_lib.markdown(md, extensions=["fenced_code", "tables"])
    html = "<body>" + html_body + "</body>"
    css = (
        "body { font-family: serif; font-size: 11pt; line-height: 1.45; color: #111; }"
        "h1,h2,h3 { font-family: sans-serif; margin: 1.2em 0 0.4em; color: #000; }"
        "h1 { font-size: 18pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }"
        "p { margin: 0.35em 0; }"
        "code { font-family: monospace; background: #f0f0f0; padding: 1px 3px; }"
        "pre { font-family: monospace; background: #f6f6f6; padding: 8px; }"
        "blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 10pt; color: #555; }"
        "ul, ol { margin: 0.35em 0 0.35em 1.5em; }"
    )

    page_rect = fitz.paper_rect("letter")
    content_rect = page_rect + (54, 54, -54, -54)  # 0.75" margins

    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)

    def where(_req_rect, _filled):
        return content_rect

    # PyMuPDF Story: render HTML across paginated output.
    story = fitz.Story(html=html, user_css=css)
    more = 1
    while more:
        dev = writer.begin_page(page_rect)
        more, _ = story.place(content_rect)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()
