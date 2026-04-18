"use client";

import * as React from "react";
import { toast } from "sonner";

import { PdfViewer } from "./pdf-viewer";
import { FindingPanel } from "./finding-panel";
import { DraftReviewDialog } from "../review/draft-review-dialog";
import {
  useDecideFinding,
  useInvestigateFinding,
} from "@/lib/hooks/use-papers";
import type { Paper } from "@/lib/types";

export function Workspace({ paper }: { paper: Paper }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    paper.findings[0]?.id ?? null
  );
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const decide = useDecideFinding(paper.id);
  const investigate = useInvestigateFinding(paper.id);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(420px,460px)]">
      <PdfViewer
        paperTitle={paper.title}
        findings={paper.findings}
        selectedFindingId={selectedId}
      />
      <FindingPanel
        findings={paper.findings}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
        onDecide={async (id, verdict, note) => {
          try {
            await decide.mutateAsync({ findingId: id, decision: verdict, note });
            toast.success(verdict === "agree" ? "Agreed" : "Dismissed", {
              description: note ? `Note: ${note}` : undefined,
            });
          } catch (err) {
            toast.error("Could not save decision", {
              description: err instanceof Error ? err.message : undefined,
            });
          }
        }}
        onInvestigate={async (id, msg) => {
          try {
            await investigate.mutateAsync({ findingId: id, message: msg });
          } catch (err) {
            toast.error("Investigation failed", {
              description: err instanceof Error ? err.message : undefined,
            });
          }
        }}
        onGenerateReview={() => setReviewOpen(true)}
      />

      <DraftReviewDialog
        paper={paper}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />
    </div>
  );
}
