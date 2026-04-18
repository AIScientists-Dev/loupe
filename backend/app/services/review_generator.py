"""Generate structured draft reviews + PDF export."""
from __future__ import annotations

import io
import logging
from typing import Any, Dict, List, Optional

import markdown

from app.models import (
    DraftReviewRequest,
    DraftReviewResponse,
    Exchange,
    Finding,
    Paper,
    UserProfile,
    VenueType,
)
from app.pipeline.prompts.sections import build_review_prompt
from app.pipeline.prompts.templates import REVIEW_TEMPLATES, STYLE_PROMPTS, TONE_PROMPTS
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


class ReviewGenerator:
    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def generate(
        self,
        paper: Paper,
        profile: UserProfile,
        req: DraftReviewRequest,
    ) -> DraftReviewResponse:
        # Classify findings by verdict status
        classified = self._classify_findings(paper.findings, paper.exchanges)

        # Resolve template
        template_sections = self._get_template(req.venue, profile, req.template_override)

        # Resolve style and tone prompts
        style_prompt = (
            req.custom_style_prompt
            or profile.custom_style_prompts.get(req.style.value)
            or STYLE_PROMPTS.get(req.style.value, STYLE_PROMPTS["normal"])
        )
        tone_prompt = (
            req.custom_tone_prompt
            or profile.custom_tone_prompts.get(req.tone.value)
            or TONE_PROMPTS.get(req.tone.value, TONE_PROMPTS["formal"])
        )

        prompt = build_review_prompt(
            paper.survey_summary or "",
            classified,
            template_sections,
            style_prompt,
            tone_prompt,
        )

        review_md = await self._llm.complete(
            model=paper.model.value,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=8192,
            temperature=0.3,
        )

        # Parse sections from markdown
        sections = self._parse_sections(review_md)

        return DraftReviewResponse(
            review_markdown=review_md,
            review_sections=sections,
            venue=req.venue,
        )

    def render_pdf(self, review_md: str) -> bytes:
        """Convert markdown review to PDF bytes via weasyprint."""
        html = markdown.markdown(review_md, extensions=["tables", "fenced_code"])
        styled = (
            "<!DOCTYPE html><html><head>"
            '<meta charset="utf-8">'
            "<style>"
            "body { font-family: 'Georgia', serif; max-width: 700px; margin: 40px auto; "
            "padding: 0 20px; font-size: 11pt; line-height: 1.6; color: #1a1a1a; }"
            "h1, h2, h3 { font-family: 'Helvetica Neue', sans-serif; }"
            "h2 { border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }"
            "ul, ol { margin-left: 20px; }"
            "blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12px; "
            "color: #555; }"
            "</style></head><body>"
            f"{html}</body></html>"
        )
        try:
            from weasyprint import HTML
            pdf_bytes = HTML(string=styled).write_pdf()
            return pdf_bytes
        except Exception as exc:
            logger.error("PDF generation failed: %s", exc)
            return styled.encode("utf-8")

    def _get_template(
        self,
        venue: VenueType,
        profile: UserProfile,
        override: Optional[dict],
    ) -> Dict[str, str]:
        if override:
            return override
        custom = profile.custom_review_templates.get(venue.value)
        if custom:
            return custom
        return REVIEW_TEMPLATES.get(venue.value, REVIEW_TEMPLATES["other"])

    @staticmethod
    def _classify_findings(
        findings: List[Finding], exchanges: List[Exchange]
    ) -> Dict[str, List[Dict[str, Any]]]:
        result: Dict[str, List[Dict[str, Any]]] = {
            "agreed": [],
            "dismissed": [],
            "investigating": [],
            "open": [],
        }
        exchange_finding_ids = {e.finding_id for e in exchanges}
        for f in findings:
            entry = {"label": f.label, "reasoning": f.reasoning}
            if f.decision is None:
                if f.finding_id in exchange_finding_ids:
                    result["investigating"].append(entry)
                else:
                    result["open"].append(entry)
            elif f.decision.value == "agree":
                result["agreed"].append(entry)
            elif f.decision.value == "dismiss":
                pass  # excluded
            elif f.decision.value == "investigate":
                result["investigating"].append(entry)
        return result

    @staticmethod
    def _parse_sections(md: str) -> Dict[str, str]:
        """Parse markdown into sections by ## headings."""
        sections: Dict[str, str] = {}
        current_heading = ""
        current_lines: List[str] = []

        for line in md.split("\n"):
            if line.startswith("## "):
                if current_heading:
                    sections[current_heading] = "\n".join(current_lines).strip()
                current_heading = line[3:].strip()
                current_lines = []
            else:
                current_lines.append(line)

        if current_heading:
            sections[current_heading] = "\n".join(current_lines).strip()

        return sections
