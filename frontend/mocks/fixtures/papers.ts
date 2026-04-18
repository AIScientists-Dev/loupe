import type { Paper, PaperSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// The "5-planted-bug" paper — mirrors backend/tests/fixtures/sample_paper.tex.
// This is the money-shot fixture: realistic enough to sell the UX in demo.
// ---------------------------------------------------------------------------

const PLANTED_BUG_PAPER: Paper = {
  id: "pap_planted5",
  title: "Sharp Concentration for a Telescoped Estimator",
  filename: "sample_paper.pdf",
  status: "ready",
  created_at: "2026-04-17T09:04:00Z",
  findings: [
    {
      id: "f1",
      paper_id: "pap_planted5",
      proof_block_id: "b_lemma1",
      issue_type: "arithmetic",
      description:
        "The telescoping sum is simplified as $\\sum_{i=1}^n i = n^2/2$. The standard closed form is $n(n+1)/2$. The author appears to have dropped the linear term.",
      evidence_quote:
        "\\text{By telescoping, } \\sum_{i=1}^{n} i = \\tfrac{n^2}{2}, \\text{ hence } S_n \\le \\tfrac{n^2}{2}.",
      severity: "high",
      confidence: 0.94,
      bbox: { page: 2, x: 108, y: 388, width: 396, height: 44 },
      bbox_page: 2,
      visually_verified: true,
      localize_status: "done",
      exchanges: [],
    },
    {
      id: "f2",
      paper_id: "pap_planted5",
      proof_block_id: "b_thm1",
      issue_type: "logic",
      description:
        "The proof concludes $T_n \\le C\\sqrt{n}$ from premises that establish $T_n \\ge C\\sqrt{n}$. The inequality direction is flipped at the last step.",
      evidence_quote:
        "\\text{Since } T_n \\ge C\\sqrt{n}, \\text{ we conclude } T_n \\le C\\sqrt{n}.",
      severity: "high",
      confidence: 0.91,
      bbox: { page: 3, x: 108, y: 244, width: 396, height: 38 },
      bbox_page: 3,
      visually_verified: true,
      localize_status: "done",
      exchanges: [],
    },
    {
      id: "f3",
      paper_id: "pap_planted5",
      proof_block_id: "b_thm1_proof",
      issue_type: "unstated_assumption",
      description:
        "The proof invokes 'Assumption A3' to bound the martingale difference, but no Assumption A3 is stated in the paper. Only A1 (i.i.d. sampling) and A2 (bounded kernel) appear in Section 2.",
      evidence_quote:
        "\\text{By Assumption A3, the martingale difference sequence satisfies } |d_i| \\le \\sigma \\text{ almost surely.}",
      severity: "medium",
      confidence: 0.86,
      bbox: { page: 3, x: 108, y: 504, width: 396, height: 32 },
      bbox_page: 3,
      visually_verified: true,
      localize_status: "done",
      exchanges: [],
    },
    {
      id: "f4",
      paper_id: "pap_planted5",
      proof_block_id: "b_lemma2",
      issue_type: "wrong_constant",
      description:
        "The concentration bound is stated as $2\\exp(-n\\varepsilon)$. For a Hoeffding-style bound with bounded i.i.d. summands in $[0,1]$, the standard result is $2\\exp(-2n\\varepsilon^2)$. The constant and the exponent of $\\varepsilon$ are both off.",
      evidence_quote:
        "P\\!\\left(|\\bar X_n - \\mu| \\ge \\varepsilon\\right) \\le 2\\exp(-n\\varepsilon).",
      severity: "high",
      confidence: 0.97,
      bbox: { page: 4, x: 108, y: 362, width: 396, height: 44 },
      bbox_page: 4,
      visually_verified: true,
      localize_status: "done",
      exchanges: [],
    },
    {
      id: "f5",
      paper_id: "pap_planted5",
      proof_block_id: "b_cor1",
      issue_type: "quantifier_scope",
      description:
        "The corollary's conclusion swaps $\\forall$ and $\\exists$: it claims a single threshold $\\delta$ works for every tolerance $\\varepsilon$, but the proof only establishes that for each $\\varepsilon$ some $\\delta(\\varepsilon)$ exists.",
      evidence_quote:
        "\\exists\\, \\delta > 0 \\;\\text{ such that }\\; \\forall\\, \\varepsilon > 0,\\; P(|X_n - X| < \\delta) \\ge 1 - \\varepsilon.",
      severity: "medium",
      confidence: 0.82,
      bbox: { page: 5, x: 108, y: 212, width: 396, height: 38 },
      bbox_page: 5,
      visually_verified: true,
      localize_status: "done",
      exchanges: [],
    },
  ],
};

const ANALYZING_PAPER: Paper = {
  id: "pap_analyzing",
  title: "On the Convergence Rate of Gradient Descent under Anisotropic Noise",
  filename: "draft_anisotropic.pdf",
  status: "analyzing",
  created_at: "2026-04-17T13:22:00Z",
  findings: [],
};

const REVIEWED_PAPER: Paper = {
  id: "pap_reviewed",
  title: "Debiased Lasso for High-Dimensional Generalized Linear Models",
  filename: "debiased_glm.pdf",
  status: "ready",
  created_at: "2026-04-16T18:40:00Z",
  findings: [
    {
      id: "r1",
      paper_id: "pap_reviewed",
      proof_block_id: "b_r1",
      issue_type: "citation_required",
      description:
        "The author cites 'a well-known result' for the KKT conditions without reference. Standard practice would cite Bickel et al. (2009) or Tibshirani (1996).",
      evidence_quote:
        "\\text{By a well-known result, the KKT conditions imply } \\hat\\beta_S = (X_S^\\top X_S)^{-1} X_S^\\top y.",
      severity: "low",
      confidence: 0.68,
      bbox: { page: 6, x: 108, y: 330, width: 396, height: 30 },
      bbox_page: 6,
      visually_verified: true,
      localize_status: "done",
      decision: "agree",
      decision_note: "Agreed — author should add citation.",
      exchanges: [],
    },
  ],
};

export const FIXTURE_PAPERS: Paper[] = [
  ANALYZING_PAPER,
  PLANTED_BUG_PAPER,
  REVIEWED_PAPER,
];

export function toSummary(p: Paper): PaperSummary {
  return {
    id: p.id,
    title: p.title,
    filename: p.filename,
    status: p.status,
    created_at: p.created_at,
    finding_count: p.findings.length,
    decided_count: p.findings.filter((f) => !!f.decision).length,
  };
}
