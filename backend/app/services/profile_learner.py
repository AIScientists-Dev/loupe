"""Extract learned rules from user verdicts on findings."""
from __future__ import annotations

import logging
from typing import Optional

from app.models import Finding, FindingDecision, LearnedRule
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


class ProfileLearner:
    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def maybe_learn_rule(
        self,
        finding: Finding,
        decision: FindingDecision,
        comment: Optional[str],
        model: str,
    ) -> Optional[LearnedRule]:
        """Given a user's verdict, ask LLM to generalize a reusable rule."""
        if decision == FindingDecision.investigate:
            return None  # only learn from agree/dismiss

        context = (
            f"Finding: {finding.label}\n"
            f"AI reasoning: {finding.reasoning}\n"
            f"User decision: {decision.value}\n"
        )
        if comment:
            context += f"User comment: {comment}\n"

        if decision == FindingDecision.dismiss:
            instruction = (
                "The user dismissed this finding (said it was NOT suspicious). "
                "Generalize a short rule that the AI should remember for future "
                "papers to avoid similar false positives. One sentence."
            )
        else:
            instruction = (
                "The user agreed this finding IS suspicious. "
                "Generalize a short rule that the AI should remember for future "
                "papers to catch similar issues. One sentence."
            )

        try:
            rule_text = await self._llm.complete(
                model=model,
                messages=[{"role": "user", "content": f"{context}\n{instruction}"}],
                max_tokens=256,
                temperature=0.2,
            )
            rule_text = rule_text.strip().strip('"')
            if rule_text:
                return LearnedRule(
                    rule_text=rule_text,
                    source_finding_id=finding.finding_id,
                    source_decision=decision,
                )
        except Exception as exc:
            logger.warning("Failed to learn rule: %s", exc)

        return None
