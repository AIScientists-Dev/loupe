import * as React from "react";
import { CheckCircle2, Loader2, XCircle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PaperStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: PaperStatus }) {
  if (status === "ready") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" /> Failed
      </Badge>
    );
  }
  if (status === "analyzing" || status === "parsed" || status === "proofs_extracted") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" /> Analyzing
      </Badge>
    );
  }
  return (
    <Badge variant="muted">
      <Clock className="size-3" /> Queued
    </Badge>
  );
}
