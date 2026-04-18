"""Central orchestrator — paper lifecycle, findings, investigations, reviews."""
from __future__ import annotations

import logging
from typing import List, Optional

from app.models import (
    DraftReviewRequest,
    DraftReviewResponse,
    Exchange,
    ExchangeDecisionRequest,
    Finding,
    FindingDecision,
    FindingDecisionRequest,
    InvestigateRequest,
    LLMModel,
    Paper,
    PaperDetailResponse,
    PaperStatus,
    PaperSummaryResponse,
    PipelineState,
    UserProfile,
    utc_now_iso,
)
from app.pipeline.prompts.sections import build_investigate_prompt
from app.pipeline.runner import run_pipeline
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.profile_learner import ProfileLearner
from app.services.review_generator import ReviewGenerator
from app.services.storage import FileStore

logger = logging.getLogger(__name__)


class PaperOrchestrator:
    def __init__(
        self,
        store: FileStore,
        llm: LLMClient,
        mineru: MinerUClient,
        learner: ProfileLearner,
        review_gen: ReviewGenerator,
    ) -> None:
        self.store = store
        self.llm = llm
        self.mineru = mineru
        self.learner = learner
        self.review_gen = review_gen

    # -- paper CRUD ------------------------------------------------------------

    def create_paper(
        self, user_id: str, filename: str, pdf_bytes: bytes, model: LLMModel
    ) -> Paper:
        """Create paper record and store PDF. Caller launches pipeline separately."""
        paper = Paper(user_id=user_id, filename=filename, model=model)
        self.store.save_pdf(paper.paper_id, pdf_bytes)
        self.store.save_paper(paper)
        return paper

    def get_paper(self, paper_id: str) -> Optional[Paper]:
        return self.store.load_paper(paper_id)

    def get_paper_detail(self, paper_id: str) -> Optional[PaperDetailResponse]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        return PaperDetailResponse(
            paper_id=paper.paper_id,
            user_id=paper.user_id,
            filename=paper.filename,
            title=paper.title,
            status=paper.status,
            model=paper.model,
            pipeline_state=paper.pipeline_state,
            findings=paper.findings,
            exchanges=paper.exchanges,
            survey_summary=paper.survey_summary,
            created_at=paper.created_at,
            updated_at=paper.updated_at,
        )

    def list_papers(self, user_id: str) -> List[PaperSummaryResponse]:
        return self.store.list_papers(user_id)

    def delete_paper(self, paper_id: str) -> bool:
        return self.store.delete_paper(paper_id)

    # -- pipeline --------------------------------------------------------------

    async def run_analysis(self, paper_id: str, user_id: str) -> None:
        """Run the full 5-step pipeline. Called as a background task."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return
        profile = self.store.load_profile(user_id) or UserProfile(user_id=user_id)
        try:
            await run_pipeline(paper, profile, self.llm, self.mineru, self.store)
        except Exception:
            logger.exception("Pipeline failed for paper %s", paper_id)

    async def rerun_analysis(
        self,
        paper_id: str,
        user_id: str,
        new_focus_areas: Optional[List[str]] = None,
    ) -> Optional[PaperDetailResponse]:
        """Rerun: keep decided findings, overwrite open, add new."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        profile = self.store.load_profile(user_id) or UserProfile(user_id=user_id)
        if new_focus_areas is not None:
            profile.focus_areas = new_focus_areas
            self.store.save_profile(profile)

        # Partition findings
        decided = [f for f in paper.findings if f.decision is not None]
        # Keep exchanges for decided findings
        decided_ids = {f.finding_id for f in decided}
        kept_exchanges = [e for e in paper.exchanges if e.finding_id in decided_ids]

        paper.findings = decided
        paper.exchanges = kept_exchanges
        paper.status = PaperStatus.analyzing
        paper.pipeline_state = PipelineState()

        try:
            await run_pipeline(
                paper, profile, self.llm, self.mineru, self.store, skip_parse=True
            )
        except Exception:
            logger.exception("Rerun failed for paper %s", paper_id)

        return self.get_paper_detail(paper_id)

    # -- finding verdicts ------------------------------------------------------

    async def decide_finding(
        self,
        paper_id: str,
        finding_id: str,
        req: FindingDecisionRequest,
        user_id: str,
    ) -> Optional[Finding]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        for f in paper.findings:
            if f.finding_id == finding_id:
                f.decision = req.decision
                f.decision_comment = req.comment
                f.soft_deleted = req.decision != FindingDecision.investigate and not req.comment

                paper.updated_at = utc_now_iso()
                self.store.save_paper(paper)

                # Learn rule in background (fire and forget)
                profile = self.store.load_profile(user_id)
                if profile:
                    rule = await self.learner.maybe_learn_rule(
                        f, req.decision, req.comment, paper.model.value
                    )
                    if rule:
                        profile.learned_rules.append(rule)
                        self.store.save_profile(profile)

                return f
        return None

    # -- investigations --------------------------------------------------------

    async def investigate_finding(
        self,
        paper_id: str,
        finding_id: str,
        req: InvestigateRequest,
        user_id: str,
    ) -> Optional[Exchange]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        finding = next((f for f in paper.findings if f.finding_id == finding_id), None)
        if not finding:
            return None

        # Mark finding as investigate if not already
        if finding.decision != FindingDecision.investigate:
            finding.decision = FindingDecision.investigate

        prior_exchanges = [e for e in paper.exchanges if e.finding_id == finding_id]

        prompt = build_investigate_prompt(
            finding, req.direction, paper.parsed_blocks,
            paper.survey_summary or "", prior_exchanges,
        )
        ai_response = await self.llm.complete(
            model=paper.model.value,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
        )

        exchange = Exchange(
            finding_id=finding_id,
            user_direction=req.direction,
            ai_response=ai_response.strip(),
        )
        paper.exchanges.append(exchange)
        paper.updated_at = utc_now_iso()
        self.store.save_paper(paper)
        return exchange

    async def decide_exchange(
        self,
        paper_id: str,
        exchange_id: str,
        req: ExchangeDecisionRequest,
        user_id: str,
    ) -> Optional[Exchange]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        for e in paper.exchanges:
            if e.exchange_id == exchange_id:
                e.decision = req.decision
                e.decision_comment = req.comment
                paper.updated_at = utc_now_iso()
                self.store.save_paper(paper)
                return e
        return None

    async def investigate_exchange(
        self,
        paper_id: str,
        exchange_id: str,
        req: InvestigateRequest,
        user_id: str,
    ) -> Optional[Exchange]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        source_exchange = next(
            (e for e in paper.exchanges if e.exchange_id == exchange_id), None
        )
        if not source_exchange:
            return None

        finding = next(
            (f for f in paper.findings if f.finding_id == source_exchange.finding_id),
            None,
        )
        if not finding:
            return None

        prior_exchanges = [
            e for e in paper.exchanges if e.finding_id == finding.finding_id
        ]

        prompt = build_investigate_prompt(
            finding, req.direction, paper.parsed_blocks,
            paper.survey_summary or "", prior_exchanges,
        )
        ai_response = await self.llm.complete(
            model=paper.model.value,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
        )

        exchange = Exchange(
            finding_id=finding.finding_id,
            user_direction=req.direction,
            ai_response=ai_response.strip(),
        )
        paper.exchanges.append(exchange)
        paper.updated_at = utc_now_iso()
        self.store.save_paper(paper)
        return exchange

    # -- draft review ----------------------------------------------------------

    async def generate_draft_review(
        self, paper_id: str, req: DraftReviewRequest, user_id: str
    ) -> Optional[DraftReviewResponse]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        profile = self.store.load_profile(user_id) or UserProfile(user_id=user_id)
        return await self.review_gen.generate(paper, profile, req)

    def render_review_pdf(self, review_md: str) -> bytes:
        return self.review_gen.render_pdf(review_md)
