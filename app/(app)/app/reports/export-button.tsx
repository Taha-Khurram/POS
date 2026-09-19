"use client";

import { useTransition } from "react";

import { IconDownload } from "@/components/pos/icons";
import { useToast } from "@/components/pos/toaster";

import { exportReport, type ExportKind } from "./actions";

/**
 * "Export" on a report card.
 *
 * The only interactive thing on most of this screen, and it is deliberately
 * thin: the file is built by the Server Action, so what crosses to the browser
 * is one string at the moment somebody asks for it rather than a second copy of
 * every figure sitting in the page payload waiting for a click that may never
 * come. See `actions.ts` for why that trade goes this way here and the other
 * way on the sales history.
 *
 * It sends the period from the URL rather than the resolved dates. The action
 * turns it into trading days with the same function the page used, against the
 * shop's own current business day — so the file and the table on screen cannot
 * describe two different windows.
 */
export function ExportButton({
  kind,
  params,
  what,
}: {
  kind: ExportKind;
  /** The period as the URL carries it. `stock` ignores it — that report is not
   *  windowed, and the action knows so. */
  params: { range?: string; from?: string; to?: string };
  /** What is in the file, for the toast: "items", "trading days". */
  what: string;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const run = () =>
    startTransition(async () => {
      const result = await exportReport(kind, params);

      if (!result.ok) {
        toast({ title: "Could not export that", detail: result.error, tone: "bad" });
        return;
      }

      if (result.rows === 0) {
        toast({
          title: "Nothing to export",
          detail: "There are no rows in this period yet.",
          tone: "info",
        });
        return;
      }

      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);

      toast({
        title: `${result.rows.toLocaleString("en-PK")} ${what} exported`,
        detail: result.filename,
        tone: "good",
      });
    });

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="pos-btn pos-btn-quiet pos-btn-sm"
    >
      {pending ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orchid-200 border-t-orchid-700"
          aria-hidden
        />
      ) : (
        <IconDownload className="h-3.5 w-3.5" />
      )}
      Export
      <span aria-live="polite" className="sr-only">
        {pending ? "Building the file" : ""}
      </span>
    </button>
  );
}
