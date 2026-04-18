"""Review templates, style prompts, and tone prompts."""
from __future__ import annotations

from typing import Dict

REVIEW_TEMPLATES: Dict[str, Dict[str, str]] = {
    "iclr": {
        "Summary": "Summarize the paper's main contributions in 3-5 sentences.",
        "Strengths": "List the paper's key strengths with specific evidence.",
        "Weaknesses": "List weaknesses grounded in confirmed findings.",
        "Questions": "List specific questions for the authors based on your analysis.",
        "Score": "Rate the paper 1-10 with justification.",
    },
    "neurips": {
        "Summary": "Summarize the paper's main contributions in 3-5 sentences.",
        "Strengths": "List the paper's key strengths with specific evidence.",
        "Weaknesses": "List weaknesses grounded in confirmed findings.",
        "Questions": "List specific questions for the authors.",
        "Score": "Rate the paper 1-10 with justification.",
    },
    "jasa": {
        "Summary": "Provide a concise summary of the paper's statistical contributions.",
        "Strengths": "Discuss methodological strengths and theoretical contributions.",
        "Major Comments": "Major issues that must be addressed. Ground in confirmed findings.",
        "Minor Comments": "Minor issues, typos, and suggestions for improvement.",
        "Recommendation": "Accept / Minor Revision / Major Revision / Reject with justification.",
    },
    "nsf_proposal": {
        "Rating": "Overall rating: Excellent / Very Good / Good / Fair / Poor",
        "Synopsis": (
            "This proposal addresses [specific problem] by developing [core method/framework]. "
            "The project aims to [objective and intended impact]."
        ),
        "Intellectual Merit - Strengths": (
            "Evaluate the intellectual merit. Address: importance of the problem, "
            "quality of the approach, team qualifications, preliminary results."
        ),
        "Intellectual Merit - Weaknesses": (
            "Address: novelty definition, theoretical rigor, evaluation specificity, "
            "scope concerns."
        ),
        "Broader Impacts - Strengths": (
            "Evaluate broader impacts: health benefits, community engagement, "
            "education, open-source dissemination, workforce development."
        ),
        "Broader Impacts - Weaknesses": (
            "Address: aspirational claims, prioritization, mechanisms for "
            "assessing long-term impact."
        ),
        "Evaluation Plan": (
            "Assess the evaluation plan: benchmarks, simulations, user studies, "
            "pilot data. Note any alignment concerns."
        ),
        "Collaboration and Management": (
            "Assess the team structure, role matching, and coordination mechanisms."
        ),
        "Data Management Plan": (
            "Assess attention to privacy, code release, benchmark sharing, "
            "reproducibility, metadata."
        ),
        "Summary Statement": (
            "Concise summary: strongest features, central weakness, responsiveness "
            "to solicitation."
        ),
    },
    "technical_report": {
        "Summary": "Summarize the report's key findings and methodology.",
        "Key Findings": "Highlight the most important results and their implications.",
        "Issues": "List issues identified during analysis, grounded in findings.",
        "Suggestions": "Specific actionable suggestions for improvement.",
    },
    "other": {
        "Summary": "Summarize the paper's main contributions.",
        "Strengths": "List the paper's key strengths.",
        "Concerns": "List concerns grounded in your analysis findings.",
    },
}

STYLE_PROMPTS: Dict[str, str] = {
    "concise": (
        "Keep each section to 2-4 sentences. One bullet per point. No redundancy. "
        "Skip filler words and unnecessary elaboration."
    ),
    "normal": (
        "Write in complete paragraphs with moderate detail. Each section should be "
        "2-4 paragraphs. Provide specific evidence and reasoning for each point."
    ),
}

TONE_PROMPTS: Dict[str, str] = {
    "casual": (
        "Write as a knowledgeable peer reviewer in a relaxed register. "
        "Sentence fragments are fine. Skip unnecessary articles and filler words. "
        "Use direct language like 'this doesn't hold' instead of 'it is unclear "
        "whether this holds.' Incomplete punctuation is acceptable when meaning is clear."
    ),
    "formal": (
        "Use formal academic language appropriate for a peer review. "
        "Maintain objectivity and use third-person perspective where possible. "
        "Use hedged language where appropriate (e.g., 'it appears that' rather than "
        "'this is wrong')."
    ),
}
