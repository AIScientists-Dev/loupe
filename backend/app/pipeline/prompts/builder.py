"""Programmatic prompt assembly — no static text files."""
from __future__ import annotations

from typing import List, Optional

from app.models import Finding, LearnedRule, ParsedBlock


class PromptBuilder:
    """Compose prompts from modular sections."""

    def __init__(self) -> None:
        self._sections: List[tuple] = []  # (heading, content)

    def add(self, heading: str, content: str) -> "PromptBuilder":
        self._sections.append((heading, content))
        return self

    def add_role(self, description: str) -> "PromptBuilder":
        return self.add("Role", description)

    def add_paper_content(self, blocks: List[ParsedBlock], include_full: bool = True) -> "PromptBuilder":
        lines = []
        for b in blocks:
            prefix = f"[{b.block_type.upper()} | page {b.page} | id:{b.block_id}]"
            if include_full:
                lines.append(f"{prefix}\n{b.content}\n")
            else:
                lines.append(f"{prefix} {b.content[:120]}...")
        return self.add("Paper Content", "\n".join(lines))

    def add_survey_context(self, summary: str) -> "PromptBuilder":
        return self.add("Paper Analysis Context", summary)

    def add_focus_areas(self, areas: List[str]) -> "PromptBuilder":
        if not areas:
            return self
        items = "\n".join(f"- {a}" for a in areas)
        return self.add(
            "Priority Focus Areas",
            f"The reviewer especially cares about the following. "
            f"Examine these with extra rigor, but do not force findings.\n{items}",
        )

    def add_learned_rules(self, rules: List[LearnedRule]) -> "PromptBuilder":
        if not rules:
            return self
        items = "\n".join(f"- {r.rule_text}" for r in rules)
        return self.add(
            "Learned Reviewer Preferences",
            f"From past reviews, this reviewer has established these preferences:\n{items}",
        )

    def add_findings(self, findings: List[Finding]) -> "PromptBuilder":
        if not findings:
            return self
        lines = []
        for f in findings:
            lines.append(
                f"[{f.finding_id}] {f.label}: {f.reasoning[:200]}"
            )
        return self.add("Existing Findings", "\n".join(lines))

    def add_output_schema(self, description: str, example: str) -> "PromptBuilder":
        return self.add(
            "Output Format",
            f"{description}\n\nExample:\n```json\n{example}\n```",
        )

    def build(self) -> str:
        parts = []
        for heading, content in self._sections:
            parts.append(f"## {heading}\n\n{content}")
        return "\n\n".join(parts)
