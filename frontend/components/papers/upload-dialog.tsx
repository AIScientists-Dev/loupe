"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUploadPaper } from "@/lib/hooks/use-papers";

export function UploadDialog({
  trigger,
}: {
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const upload = useUploadPaper();

  const onDrop = React.useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const paper = await upload.mutateAsync(file);
        toast.success("Upload received", {
          description: `Loupe is analyzing ${paper.filename}. This takes ~1–2 min.`,
        });
        setOpen(false);
        router.push(`/papers/${paper.id}`);
      } catch (err) {
        toast.error("Upload failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [router, upload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    maxSize: 20 * 1024 * 1024,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Upload className="size-3.5" /> Upload paper
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a paper</DialogTitle>
          <DialogDescription>
            PDF only, up to 20 MB. Loupe will parse it, extract proofs, and
            surface suspicious steps.
          </DialogDescription>
        </DialogHeader>

        <div
          {...getRootProps()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-accent/30",
            upload.isPending && "pointer-events-none opacity-60"
          )}
        >
          <input {...getInputProps()} />
          <div className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
            {upload.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <FileUp className="size-5" />
            )}
          </div>
          <p className="text-sm font-medium">
            {upload.isPending
              ? "Uploading…"
              : isDragActive
                ? "Drop the PDF here"
                : "Drop a PDF here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">
            Works best with typeset math and statistics papers.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
