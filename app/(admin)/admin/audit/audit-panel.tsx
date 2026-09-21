"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconSearch } from "@/components/pos/icons";
import { writeWhen } from "@/lib/platform/admin";
import type { AuditRow } from "@/lib/platform/console";

/**
 * Every change anybody made, newest first.
 *
 * Read-only by construction: `audit_log` has an append-only trigger rather than
 * a policy, because the service role has `bypassrls` and a policy would not
 * stop the console's own writes. There is no control on this screen and there
 * never will be one.
 *
 * Opening a row shows the before and after as stored. It is raw JSON and stays
 * raw — the point of this screen is what was actually written, and a friendly
 * rendering of it is a second interpretation to be wrong.
 */
export function AuditPanel({ rows, capped }: { rows: AuditRow[]; capped: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter(
      (row) =>
        row.action.toLowerCase().includes(needle) ||
        row.actorEmail.toLowerCase().includes(needle) ||
        row.shopName.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const columns: Column<AuditRow>[] = [
    {
      key: "what",
      header: "What",
      cell: (row) => (
        <span className="font-mono text-[0.75rem] text-graphite-900">{row.action}</span>
      ),
    },
    {
      key: "shop",
      header: "Shop",
      cell: (row) =>
        row.tenantId ? (
          <Link
            href={`/admin/clients/${row.tenantId}`}
            onClick={(event) => event.stopPropagation()}
            className="text-graphite-900 underline-offset-2 hover:underline"
          >
            {row.shopName || "—"}
          </Link>
        ) : (
          <span className="text-graphite-500">—</span>
        ),
    },
    {
      key: "who",
      header: "Who",
      hideBelow: "sm",
      cell: (row) => (
        <span className="text-graphite-700">
          {row.actorEmail}
          <span className="block text-[0.6875rem] text-graphite-500">{row.actorKind}</span>
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      align: "end",
      cell: (row) => <span className="text-graphite-500">{writeWhen(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <ChartCard
        title="Audit trail"
        caption={
          capped
            ? "The most recent 500 entries. Older ones are in the table, not on this screen."
            : `${found.length} ${found.length === 1 ? "entry" : "entries"}.`
        }
        actions={
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pos-field w-44 pl-9 sm:w-56"
              placeholder="Action, operator, shop"
              aria-label="Search the audit trail"
            />
          </div>
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={found}
          rowKey={(row) => row.id}
          onRowClick={(row) => setOpen(row)}
          rowLabel={(row) => `Open ${row.action}`}
          isCurrent={(row) => row.id === open?.id}
          empty="Nothing recorded yet."
        />
      </ChartCard>

      {open ? (
        <div
          className="pos-modal"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open.action}
            className="pos-sheet outline-none"
          >
            <header className="border-b border-orchid-100 px-4 py-3.5 sm:px-5">
              <h2 className="font-mono text-[0.875rem] font-semibold">{open.action}</h2>
              <p className="mt-0.5 text-[0.75rem] text-graphite-500">
                {open.actorEmail} · {writeWhen(open.createdAt)}
                {open.shopName ? ` · ${open.shopName}` : ""}
                {open.subjectType ? ` · ${open.subjectType} ${open.subjectId}` : ""}
              </p>
            </header>

            <div className="space-y-4 px-4 py-5 sm:px-5">
              <Json label="Before" value={open.before} />
              <Json label="After" value={open.after} />

              <button
                type="button"
                onClick={() => setOpen(null)}
                className="pos-btn pos-btn-soft"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="pos-label">{label}</p>
        <p className="text-[0.8125rem] text-graphite-500">Nothing recorded.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="pos-label">{label}</p>
      <pre className="overflow-x-auto rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2 font-mono text-[0.75rem] text-graphite-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
