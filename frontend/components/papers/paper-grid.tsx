import { PaperCard } from "./paper-card";
import type { PaperSummary } from "@/lib/types";

export function PaperGrid({ papers }: { papers: PaperSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {papers.map((p) => (
        <PaperCard key={p.id} paper={p} />
      ))}
    </div>
  );
}
