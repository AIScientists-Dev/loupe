import { http, HttpResponse, delay } from "msw";

import type {
  Decision,
  Finding,
  Paper,
  PaperStatus,
  PaperStatusResponse,
  PipelineStep,
} from "@/lib/types";
import { FIXTURE_PAPERS, toSummary } from "./fixtures/papers";

// In-memory mutable state — mocking the backend JSON file store.
const papers = new Map<string, Paper>(FIXTURE_PAPERS.map((p) => [p.id, p]));

// Scripted pipeline: when a new paper is uploaded, we advance it through
// parse → extract_proofs → verify_proofs → ready over ~12 seconds so the
// live analysis view has something to animate against.
function scriptPipeline(id: string) {
  const schedule: Array<{ step: PipelineStep; stepIndex: number; delay: number; status: PaperStatus }> =
    [
      { step: "parse", stepIndex: 0, delay: 0, status: "analyzing" },
      { step: "extract_proofs", stepIndex: 1, delay: 4_000, status: "analyzing" },
      { step: "verify_proofs", stepIndex: 2, delay: 8_000, status: "analyzing" },
      { step: "ready", stepIndex: 3, delay: 12_000, status: "ready" },
    ];

  schedule.forEach(({ step, stepIndex, delay, status }) => {
    setTimeout(() => {
      const p = papers.get(id);
      if (!p) return;
      p.status = status;
      (p as unknown as { _step: PipelineStep })._step = step;
      (p as unknown as { _stepIndex: number })._stepIndex = stepIndex;
      // When ready, inject the 5-planted-bug findings as if the pipeline produced them.
      // Start findings as localize=pending (shimmer), then flip to done over ~3s
      // to show the "pinning → pinned" visual beat.
      if (status === "ready" && p.findings.length === 0) {
        const source = papers.get("pap_planted5");
        if (source) {
          p.findings = source.findings.map((f) => ({
            ...f,
            id: `${id}_${f.id}`,
            paper_id: id,
            localize_status: "pending",
          }));
          p.findings.forEach((f, i) => {
            setTimeout(
              () => {
                f.localize_status = "done";
              },
              800 + i * 500
            );
          });
        }
      }
    }, delay);
  });
}

function getStep(p: Paper): { step: PipelineStep; stepIndex: number } {
  const anyP = p as unknown as { _step?: PipelineStep; _stepIndex?: number };
  if (anyP._step && typeof anyP._stepIndex === "number")
    return { step: anyP._step, stepIndex: anyP._stepIndex };
  if (p.status === "ready") return { step: "ready", stepIndex: 3 };
  if (p.status === "analyzing") return { step: "extract_proofs", stepIndex: 1 };
  if (p.status === "failed") return { step: "failed", stepIndex: 0 };
  return { step: "parse", stepIndex: 0 };
}

export const handlers = [
  // GET /v1/papers — list
  http.get("/api/v1/papers", () => {
    const list = Array.from(papers.values())
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
      .map(toSummary);
    return HttpResponse.json(list);
  }),

  // POST /v1/papers — upload + kick pipeline
  http.post("/api/v1/papers", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const filename = file?.name ?? "untitled.pdf";
    const id = `pap_${Math.random().toString(36).slice(2, 9)}`;
    const paper: Paper = {
      id,
      title: filename.replace(/\.pdf$/i, ""),
      filename,
      status: "analyzing",
      created_at: new Date().toISOString(),
      findings: [],
    };
    papers.set(id, paper);
    scriptPipeline(id);
    await delay(400);
    return HttpResponse.json(paper);
  }),

  // GET /v1/papers/:id — detail
  http.get("/api/v1/papers/:id", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 }
      );
    return HttpResponse.json(p);
  }),

  // DELETE /v1/papers/:id
  http.delete("/api/v1/papers/:id", ({ params }) => {
    papers.delete(params.id as string);
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /v1/papers/:id/status — polling
  http.get("/api/v1/papers/:id/status", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 }
      );
    const { step, stepIndex } = getStep(p);
    const body: PaperStatusResponse = {
      status: p.status,
      step,
      step_index: stepIndex,
      total_steps: 3,
      finding_count: p.findings.length,
      localize_pending: p.findings.filter((f) => f.localize_status === "pending").length,
    };
    return HttpResponse.json(body);
  }),

  // POST /v1/papers/:id/findings/:fid/decide
  http.post("/api/v1/papers/:id/findings/:fid/decide", async ({ params, request }) => {
    const p = papers.get(params.id as string);
    const f = p?.findings.find((x) => x.id === params.fid);
    if (!p || !f)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    const body = (await request.json()) as { verdict: Decision; note?: string };
    f.decision = body.verdict;
    f.decision_note = body.note;
    await delay(200);
    return HttpResponse.json(f);
  }),

  // POST /v1/papers/:id/findings/:fid/investigate
  http.post(
    "/api/v1/papers/:id/findings/:fid/investigate",
    async ({ params, request }) => {
      const p = papers.get(params.id as string);
      const f = p?.findings.find((x) => x.id === params.fid);
      if (!p || !f)
        return HttpResponse.json(
          { error: { code: "not_found", message: "Not found" } },
          { status: 404 }
        );
      const body = (await request.json()) as { message: string };
      const now = new Date().toISOString();
      f.exchanges = [
        ...f.exchanges,
        { id: `x_${Date.now()}_u`, finding_id: f.id, role: "user", text: body.message, created_at: now },
      ];
      await delay(900);
      f.exchanges = [
        ...f.exchanges,
        {
          id: `x_${Date.now()}_a`,
          finding_id: f.id,
          role: "assistant",
          text: mockAssistantReply(body.message, f as Finding),
          created_at: new Date().toISOString(),
        },
      ];
      return HttpResponse.json(f);
    }
  ),
];

function mockAssistantReply(userMsg: string, f: Finding): string {
  const lower = userMsg.toLowerCase();
  if (lower.includes("re-derive") || lower.includes("derivation")) {
    return `Sure — let me re-derive the step carefully.\n\nThe quoted inequality claims:\n\n$$${f.evidence_quote}$$\n\nWorking from first principles, the correct derivation yields a different constant. I'll show the step-by-step in the next message.`;
  }
  if (lower.includes("counterexample")) {
    return `A concrete counterexample: take $n = 4$. The LHS evaluates to 10, while the claimed RHS gives 8. The gap grows with $n$, confirming the bound as stated is off.`;
  }
  if (lower.includes("citation") || lower.includes("reference")) {
    return `The standard reference here is Hoeffding (1963). The original paper gives the tight constant $-2n\\varepsilon^2$ in the exponent. A more modern treatment is Boucheron, Lugosi & Massart (2013), Ch. 2.`;
  }
  return `Good question. Looking at the quoted passage, the key issue is that the author relied on a step that does not follow from the stated assumptions. A cleaner version of this argument would first establish the required bound explicitly, then apply it.`;
}
