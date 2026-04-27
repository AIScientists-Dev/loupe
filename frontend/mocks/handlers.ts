import { http, HttpResponse, delay } from "msw";

import type {
  CostReport,
  Decision,
  Dimension,
  DimensionScore,
  FinalizeReviewResponse,
  Finding,
  Paper,
  PaperStatusResponse,
  PipelineStep,
  ScoresResponse,
  TriageReport,
  TriageVerdict,
} from "@/lib/types";
import { FIXTURE_PAPERS, toSummary } from "./fixtures/papers";
import { buildSegments, MOCK_OUTLINE, PLANTED_OUTLINE } from "./fixtures/segments";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const papers = new Map<string, Paper>(FIXTURE_PAPERS.map((p) => [p.id, p]));
const costs = new Map<string, CostReport>();
const runFlags = new Map<string, { stopped: boolean; timers: number[] }>();
const triages = new Map<string, TriageReport>();
const scores = new Map<string, ScoresResponse>();

// Pre-populated folder list. User-renamed labels are stored in this same array.
const folders: string[] = ["Inbox", "Journal", "Conference", "Grant", "Thesis"];

const DIMENSIONS: Dimension[] = [
  "proof",
  "literature",
  "clarity",
  "numerical",
  "relevance",
  "novelty",
];

function mockTriage(p: Paper): TriageReport {
  const findingCount = p.findings.length;
  // Weak heuristic — gives the demo something believable to show. Real
  // backend will use an LLM pass; the shape is what matters here.
  const verdict: TriageVerdict =
    findingCount >= 8 ? "high" : findingCount >= 3 ? "medium" : "low";
  return {
    scope: `This paper studies ${p.title.toLowerCase()} in a ${p.venue_type ?? "journal"} context.`,
    novelty:
      "Builds on the line of work in heavy-tailed concentration; the contribution is incremental but cleanly stated. The differentiation from prior work is plausible but under-argued in §2.",
    venue_match: `Fit to ${p.venue_name ?? "the declared venue"} appears reasonable; methodology aligns with the venue's typical scope.`,
    summary:
      "The proofs are technically dense and depend on a few unstated regularity assumptions. Numerical study is brief but supports the asymptotic claims. Worth a deep dive if the editor cares about the heavy-tailed regime.",
    verdict,
    confidence: 0.78,
    cost_usd: 0.04,
    generated_at: new Date().toISOString(),
  };
}

function mockScores(p: Paper): ScoresResponse {
  const dims: DimensionScore[] = DIMENSIONS.map((d) => ({
    dimension: d,
    score: 6 + Math.random() * 3, // 6..9
    rationale: `Mock score for ${d} — replace with backend pass output.`,
    finding_ids: p.findings
      .filter((f) => (f.dimension ?? "proof") === d)
      .map((f) => f.id),
  }));
  const aggregate = dims.reduce((a, d) => a + d.score, 0) / dims.length;
  return { dimensions: dims, aggregate, frozen: false };
}

// ---------------------------------------------------------------------------
// Cost accounting (declared early — the seed IIFE below uses buildCostReport)
// ---------------------------------------------------------------------------
const MARKUP = 1.35;

function round(n: number): number {
  return Number(n.toFixed(4));
}

function emptyCost(): CostReport {
  return {
    running_raw_usd: 0,
    running_billed_usd: 0,
    markup_factor: MARKUP,
    estimate_remaining_raw_usd: 0.7,
    estimate_total_raw_usd: 0.7,
    estimate_total_billed_usd: round(0.7 * MARKUP),
    by_stage: { outline: 0, mineru_gpu: 0, extract: 0, verify: 0, localize: 0 },
    by_segment: [],
    llm_tokens: { input: 0, cache_read: 0, cache_write: 0, output: 0 },
  };
}

function buildCostReport(p: Paper): CostReport {
  const done = (p.segments ?? []).filter((s) => s.status === "done");
  const raw = 0.03 + done.reduce((a, s) => a + (s.cost_subtotal_usd ?? 0), 0);
  return {
    running_raw_usd: round(raw),
    running_billed_usd: round(raw * MARKUP),
    markup_factor: MARKUP,
    estimate_remaining_raw_usd: 0,
    estimate_total_raw_usd: round(raw),
    estimate_total_billed_usd: round(raw * MARKUP),
    by_stage: {
      outline: 0.03,
      mineru_gpu: round(done.length * 0.03),
      extract: round(done.length * 0.012),
      verify: round(done.length * 0.022),
      localize: round(done.length * 0.008),
    },
    by_segment: [],
    llm_tokens: {
      input: done.length * 2000,
      cache_read: done.length * 6000,
      cache_write: done.length * 1200,
      output: done.length * 500,
    },
  };
}

// Seed the planted-bug fixture with a completed segment run so the workspace
// demo ships with full cost + segment data populated.
(() => {
  const p = papers.get("pap_planted5");
  if (p) {
    p.total_pages = 5;
    p.run_state = "completed";
    p.segments = buildSegments(PLANTED_OUTLINE, "pap_planted5").map((s) => ({
      ...s,
      status: "done",
      finding_ids: p.findings
        .filter((f) => f.bbox_page === s.page_start)
        .map((f) => f.id),
      cost_subtotal_usd: 0.08,
    }));
    costs.set(p.id, buildCostReport(p));
  }
  const q = papers.get("pap_reviewed");
  if (q) {
    q.total_pages = 6;
    q.run_state = "completed";
    q.segments = buildSegments(PLANTED_OUTLINE, "pap_reviewed").map((s) => ({
      ...s,
      status: "done",
    }));
    costs.set(q.id, buildCostReport(q));
  }
})();

// ---------------------------------------------------------------------------
// SSE pub-sub
// ---------------------------------------------------------------------------
type BusEvent = { event: string; data: unknown };
type BusListener = (e: BusEvent) => void;
const buses = new Map<string, Set<BusListener>>();

function publish(paperId: string, event: string, data: unknown) {
  buses.get(paperId)?.forEach((cb) => {
    try {
      cb({ event, data });
    } catch {}
  });
}

function subscribe(paperId: string, cb: BusListener): () => void {
  let set = buses.get(paperId);
  if (!set) {
    set = new Set();
    buses.set(paperId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) buses.delete(paperId);
  };
}

// ---------------------------------------------------------------------------
// Cost accounting (more)
// ---------------------------------------------------------------------------
function bumpCost(
  paperId: string,
  stage: string,
  rawAmount: number,
  tokenDelta: Partial<CostReport["llm_tokens"]> = {}
) {
  const c = costs.get(paperId) ?? emptyCost();
  c.by_stage[stage] = round((c.by_stage[stage] ?? 0) + rawAmount);
  (Object.keys(tokenDelta) as Array<keyof typeof tokenDelta>).forEach((k) => {
    c.llm_tokens[k] += tokenDelta[k] ?? 0;
  });
  c.running_raw_usd = round(
    Object.values(c.by_stage).reduce((a, b) => a + b, 0)
  );
  c.running_billed_usd = round(c.running_raw_usd * MARKUP);
  costs.set(paperId, c);
  publish(paperId, "cost.updated", {
    running_raw_usd: c.running_raw_usd,
    running_billed_usd: c.running_billed_usd,
  });
}

// ---------------------------------------------------------------------------
// Scripted segment pipeline
// ---------------------------------------------------------------------------
function scheduleTimeout(paperId: string, fn: () => void, ms: number) {
  const flags = runFlags.get(paperId) ?? { stopped: false, timers: [] };
  runFlags.set(paperId, flags);
  const t = window.setTimeout(() => {
    if (flags.stopped) return;
    fn();
  }, ms);
  flags.timers.push(t);
}

function scriptPipeline(id: string) {
  const paper = papers.get(id);
  if (!paper) return;
  runFlags.set(id, { stopped: false, timers: [] });
  costs.set(id, emptyCost());

  // Outline (~2s)
  scheduleTimeout(
    id,
    () => {
      const title = paper.title.toLowerCase();
      const outline =
        title.includes("telescoped") || title.includes("sample")
          ? PLANTED_OUTLINE
          : MOCK_OUTLINE;
      paper.total_pages = outline[outline.length - 1].page_end;
      paper.segments = buildSegments(outline, id);
      paper.run_state = "running";
      bumpCost(id, "outline", 0.03, { input: 1200, output: 300 });
      publish(id, "outline.ready", {
        segments: paper.segments,
        total_pages: paper.total_pages,
        estimated_cost_usd: 0.7,
      });
      runSegments(id);
    },
    2000
  );
}

function runSegments(id: string) {
  const paper = papers.get(id);
  if (!paper || !paper.segments) return;
  const queue = [...paper.segments]
    .filter((s) => s.status === "pending")
    .sort((a, b) => b.priority - a.priority);

  let segDelay = 0;
  for (const seg of queue) {
    const parseMs = Math.min(
      3500,
      seg.mineru_eta_seconds ? seg.mineru_eta_seconds * 90 : 1500
    );
    const extractMs = 900;
    const verifyMs = 1100;

    scheduleTimeout(
      id,
      () => {
        if (paper.run_state !== "running") return;
        seg.status = "parsing";
        seg.started_at = new Date().toISOString();
        publish(id, "segment.started", {
          segment_id: seg.segment_id,
          label: seg.label,
          page_start: seg.page_start,
          page_end: seg.page_end,
          classification: seg.classification,
          priority: seg.priority,
          mineru_eta_seconds: seg.mineru_eta_seconds,
          mineru_seconds_per_page_estimate: seg.mineru_seconds_per_page_estimate,
        });
      },
      segDelay
    );
    segDelay += parseMs;

    scheduleTimeout(
      id,
      () => {
        if (paper.run_state !== "running") return;
        seg.status = "extracting";
        bumpCost(id, "mineru_gpu", 0.03);
        publish(id, "segment.extracted", {
          segment_id: seg.segment_id,
          proof_blocks_count: seg.classification === "proof" ? 2 : 0,
        });
      },
      segDelay
    );
    segDelay += extractMs;

    scheduleTimeout(
      id,
      () => {
        if (paper.run_state !== "running") return;
        seg.status = "verifying";
        bumpCost(id, "extract", 0.012, {
          input: 1500,
          cache_read: 3000,
          output: 400,
        });
        // Emit findings whose page lands in this segment's page range.
        const pageRange = new Set<number>();
        for (let p = seg.page_start; p <= seg.page_end; p++) pageRange.add(p);
        const ours = paper.findings.filter(
          (f) => f.bbox_page && pageRange.has(f.bbox_page)
        );
        ours.forEach((f, i) => {
          scheduleTimeout(
            id,
            () => {
              publish(id, "finding.created", {
                segment_id: seg.segment_id,
                finding: f,
              });
              bumpCost(id, "verify", 0.022, {
                input: 400,
                cache_read: 1200,
                output: 150,
              });
            },
            i * 250
          );
        });
      },
      segDelay
    );
    segDelay += verifyMs;

    scheduleTimeout(
      id,
      () => {
        if (paper.run_state !== "running") return;
        seg.status = "done";
        seg.finished_at = new Date().toISOString();
        seg.cost_subtotal_usd = 0.08;
        bumpCost(id, "localize", 0.008);
        publish(id, "segment.completed", {
          segment_id: seg.segment_id,
          cost_subtotal_usd: seg.cost_subtotal_usd,
        });
      },
      segDelay
    );
    segDelay += 200;
  }

  scheduleTimeout(
    id,
    () => {
      if (paper.run_state !== "running") return;
      paper.run_state = "completed";
      paper.status = "ready";
      const c = costs.get(id);
      publish(id, "run.completed", {
        total_billed_usd: c?.running_billed_usd ?? 0,
      });
    },
    segDelay
  );
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
export const handlers = [
  http.get("/api/v1/papers", () => {
    const list = Array.from(papers.values())
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
      .map(toSummary);
    return HttpResponse.json(list);
  }),

  http.post("/api/v1/papers", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const filename = file?.name ?? "untitled.pdf";
    const id = `pap_${Math.random().toString(36).slice(2, 9)}`;
    // v2 upload fields — all optional. Falling back to sensible defaults
    // means legacy callers (file-only) still work.
    const venue_type = (form.get("venue_type") as string | null) ?? "journal";
    const venue_name = (form.get("venue_name") as string | null) ?? undefined;
    const folder = (form.get("folder") as string | null) ?? "Inbox";
    let review_style: Paper["review_style"];
    const styleRaw = form.get("review_style");
    if (typeof styleRaw === "string") {
      try {
        review_style = JSON.parse(styleRaw) as Paper["review_style"];
      } catch {
        // ignore — fall back to undefined
      }
    }
    const paper: Paper = {
      id,
      title: filename.replace(/\.pdf$/i, ""),
      filename,
      status: "analyzing",
      created_at: new Date().toISOString(),
      findings: [],
      run_state: "idle",
      segments: [],
      venue_type: venue_type as Paper["venue_type"],
      venue_name,
      folder,
      review_style,
      stage: "triaging",
    };
    papers.set(id, paper);
    if (folder && !folders.includes(folder)) folders.push(folder);
    // Seed findings from planted fixture so the end-state has something to inspect.
    const source = papers.get("pap_planted5");
    if (source) {
      paper.findings = source.findings.map((f) => ({
        ...f,
        id: `${id}_${f.id}`,
        paper_id: id,
        localize_status: "pending",
      }));
    }
    // Don't auto-run the deep pipeline — v2 flow is triage-first. Triage
    // gets generated lazily on first GET /triage. The deep pipeline kicks
    // when the user clicks Dive Deep (POST /dive-deep).
    await delay(400);
    return HttpResponse.json(paper);
  }),

  http.get("/api/v1/papers/:id", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 }
      );
    return HttpResponse.json(p);
  }),

  http.delete("/api/v1/papers/:id", ({ params }) => {
    const id = params.id as string;
    papers.delete(id);
    costs.delete(id);
    runFlags.get(id)?.timers.forEach((t) => window.clearTimeout(t));
    runFlags.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("/api/v1/papers/:id/status", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    const active = (p.segments ?? []).find((s) =>
      ["parsing", "extracting", "verifying"].includes(s.status)
    );
    const step: PipelineStep = active
      ? active.status === "parsing"
        ? "parse"
        : active.status === "extracting"
          ? "extract_proofs"
          : "verify_proofs"
      : p.run_state === "completed"
        ? "ready"
        : "parse";
    const body: PaperStatusResponse = {
      status: p.status,
      step,
      step_index:
        step === "ready"
          ? 3
          : ["parse", "extract_proofs", "verify_proofs"].indexOf(step),
      total_steps: 3,
      finding_count: p.findings.length,
      localize_pending: p.findings.filter((f) => f.localize_status === "pending").length,
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/v1/papers/:id/cost", ({ params }) => {
    const c = costs.get(params.id as string) ?? emptyCost();
    return HttpResponse.json(c);
  }),

  http.post("/api/v1/papers/:id/stop", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    p.run_state = "stopped";
    const flags = runFlags.get(p.id);
    if (flags) {
      flags.stopped = true;
      flags.timers.forEach((t) => window.clearTimeout(t));
      flags.timers = [];
    }
    publish(p.id, "run.stopped", { reason: "user" });
    return HttpResponse.json(p);
  }),

  http.post("/api/v1/papers/:id/resume", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    p.run_state = "running";
    const flags = runFlags.get(p.id);
    if (flags) flags.stopped = false;
    publish(p.id, "run.resumed", { segment_id_starting: null });
    runSegments(p.id);
    return HttpResponse.json(p);
  }),

  http.post("/api/v1/papers/:id/segments/:sid/skip", ({ params }) => {
    const p = papers.get(params.id as string);
    const seg = p?.segments?.find((s) => s.segment_id === params.sid);
    if (!p || !seg)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    seg.status = "skipped";
    publish(p.id, "segment.completed", {
      segment_id: seg.segment_id,
      cost_subtotal_usd: 0,
      skipped: true,
    });
    return HttpResponse.json(p);
  }),

  http.get("/api/v1/papers/:id/pages/:n/thumb.png", ({ params }) => {
    const n = Number(params.n);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="156" viewBox="0 0 120 156"><rect width="120" height="156" fill="white" stroke="#e5e7eb"/><text x="60" y="82" font-family="ui-sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle">${n}</text></svg>`;
    return new HttpResponse(svg, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  }),

  http.get("/api/v1/papers/:id/events", ({ params }) => {
    const id = params.id as string;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: string, data: unknown) => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {}
        };

        const p = papers.get(id);
        if (p?.run_state === "completed" || p?.status === "ready") {
          enqueue("run.completed", {
            total_billed_usd: costs.get(id)?.running_billed_usd ?? 0,
          });
          try {
            controller.close();
          } catch {}
          return;
        }
        if (p?.segments) {
          enqueue("outline.ready", {
            segments: p.segments,
            total_pages: p.total_pages,
            estimated_cost_usd: 0.7,
          });
        }

        const unsub = subscribe(id, ({ event, data }) => {
          enqueue(event, data);
          if (event === "run.completed") {
            unsub();
            try {
              controller.close();
            } catch {}
          }
        });
      },
    });

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }),

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

  http.post("/api/v1/papers/:id/findings/:fid/place", async ({ params, request }) => {
    const p = papers.get(params.id as string);
    const f = p?.findings.find((x) => x.id === params.fid);
    if (!p || !f)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Not found" } },
        { status: 404 }
      );
    const body = (await request.json()) as {
      page: number;
      bbox: { x: number; y: number; width: number; height: number };
    };
    (f as Finding).bbox = { ...body.bbox, page: body.page };
    (f as Finding).page = body.page;
    (f as Finding).localize_status = "user_placed";
    (f as Finding).bbox_source = "user_placed";
    (f as Finding).location_confidence = 100;
    await delay(120);
    return HttpResponse.json(f);
  }),

  // -------------------------------------------------------------------------
  // v2: Triage / Deep Dive / Scores / Finalize / Folders
  // -------------------------------------------------------------------------

  http.get("/api/v1/folders", () => HttpResponse.json(folders)),

  http.get("/api/v1/papers/:id/triage", async ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 },
      );
    let t = triages.get(p.id);
    if (!t) {
      // Lazy-generate so freshly-uploaded papers eventually flip to triaged.
      // 600ms simulates the pre-LLM stage — quick enough that the dev loop
      // doesn't drag.
      await delay(600);
      t = mockTriage(p);
      triages.set(p.id, t);
      p.triage = t;
      p.stage = "triaged";
    }
    return HttpResponse.json(t);
  }),

  http.post("/api/v1/papers/:id/dive-deep", async ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 },
      );
    p.stage = "diving";
    p.run_state = "running";
    // Simulate dive completion 1.5s later: populate dimension_scores +
    // tag existing findings with mock dimensions so the UI has data.
    setTimeout(() => {
      const s = mockScores(p);
      scores.set(p.id, s);
      p.dimension_scores = s.dimensions;
      p.stage = "dived";
      p.run_state = "completed";
      p.status = "ready";
      // Round-robin dimension tag onto existing findings (mock only).
      p.findings = p.findings.map((f, i) => ({
        ...f,
        dimension: f.dimension ?? DIMENSIONS[i % DIMENSIONS.length],
      }));
    }, 1500);
    await delay(200);
    return HttpResponse.json(p);
  }),

  http.get("/api/v1/papers/:id/scores", ({ params }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 },
      );
    let s = scores.get(p.id);
    if (!s) {
      s = mockScores(p);
      scores.set(p.id, s);
    }
    return HttpResponse.json(s);
  }),

  http.post(
    "/api/v1/papers/:id/finalize-review",
    async ({ params }) => {
      const p = papers.get(params.id as string);
      if (!p)
        return HttpResponse.json(
          { error: { code: "not_found", message: "Paper not found" } },
          { status: 404 },
        );
      const s = scores.get(p.id) ?? mockScores(p);
      s.frozen = true;
      scores.set(p.id, s);
      p.final_score = s.aggregate;
      const draft_id = `draft_${Math.random().toString(36).slice(2, 9)}`;
      const resp: FinalizeReviewResponse = {
        aggregate: s.aggregate,
        draft_id,
      };
      await delay(400);
      return HttpResponse.json(resp);
    },
  ),

  http.patch("/api/v1/papers/:id/folder", async ({ params, request }) => {
    const p = papers.get(params.id as string);
    if (!p)
      return HttpResponse.json(
        { error: { code: "not_found", message: "Paper not found" } },
        { status: 404 },
      );
    const body = (await request.json()) as { folder: string };
    p.folder = body.folder;
    if (!folders.includes(body.folder)) folders.push(body.folder);
    return HttpResponse.json(p);
  }),

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
        {
          id: `x_${Date.now()}_u`,
          finding_id: f.id,
          role: "user",
          text: body.message,
          created_at: now,
        },
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
    return `The standard reference here is Hoeffding (1963). The original paper gives the tight constant $-2n\\varepsilon^2$ in the exponent.`;
  }
  return `Good question. Looking at the quoted passage, the key issue is that the author relied on a step that does not follow from the stated assumptions.`;
}
