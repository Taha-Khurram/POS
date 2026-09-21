"use client";

import { useActionState, useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconClose, IconSearch } from "@/components/pos/icons";
import { Select, SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { LEAD_STATUSES, leadStatusOf, waLink, writeWhen } from "@/lib/platform/admin";
import type { Lead } from "@/lib/platform/console";

import { updateLead } from "./actions";
import { IDLE } from "../state";

/**
 * The demo form's submissions.
 *
 * The only control that matters on the list is the WhatsApp button: somebody
 * left their number twenty minutes ago and the difference between a sale and a
 * dead lead is whether you message them today. Everything else — which state
 * they are in, what they said on the call — is behind opening the row.
 */
export function LeadsPanel({ leads }: { leads: Lead[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<Lead | null>(null);

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: leads.length };
    for (const lead of leads) tally[lead.status] = (tally[lead.status] ?? 0) + 1;
    return tally;
  }, [leads]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return leads.filter((lead) => {
      if (status !== "all" && lead.status !== status) return false;
      if (!needle) return true;

      return (
        lead.contactName.toLowerCase().includes(needle) ||
        lead.businessName.toLowerCase().includes(needle) ||
        lead.city.toLowerCase().includes(needle) ||
        lead.phone.replace(/\D/g, "").includes(needle.replace(/\D/g, "")) ||
        lead.message.toLowerCase().includes(needle)
      );
    });
  }, [leads, query, status]);

  const columns: Column<Lead>[] = [
    {
      key: "who",
      header: "Who",
      cell: (lead) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-graphite-900">
            {lead.contactName}
          </span>
          <span className="block truncate text-[0.6875rem] text-graphite-500">
            {lead.businessName || "No business named"}
            {lead.city ? ` · ${lead.city}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      hideBelow: "sm",
      cell: (lead) => (
        <span className="font-mono text-[0.8125rem] text-graphite-700">{lead.phone}</span>
      ),
    },
    {
      key: "status",
      header: "Where it is",
      cell: (lead) => {
        const state = leadStatusOf(lead.status);
        return <span className={`pos-badge pos-badge-${state.tone}`}>{state.label}</span>;
      },
    },
    {
      key: "when",
      header: "Came in",
      align: "end",
      cell: (lead) => (
        <span className="text-graphite-500">{writeWhen(lead.createdAt)}</span>
      ),
    },
    {
      key: "wa",
      header: "",
      align: "end",
      cell: (lead) => (
        <a
          href={waLink(
            lead.phone,
            `Assalam-o-Alaikum ${lead.contactName}! Flo ke baare mein aap ne demo maanga tha. Aaj baat ho sakti hai?`,
          )}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="pos-btn pos-btn-soft pos-btn-sm"
        >
          WhatsApp
        </a>
      ),
    },
  ];

  return (
    <>
      <ChartCard
        title="Leads"
        caption={
          rows.length === leads.length
            ? `${leads.length} in total.`
            : `${rows.length} of ${leads.length}.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pos-field w-44 pl-9 sm:w-56"
                placeholder="Name, shop, city, phone"
                aria-label="Search the leads"
              />
            </div>

            <Select
              value={status}
              onChange={setStatus}
              label="Which leads"
              className="w-40"
              options={[
                { id: "all", label: "All", meta: counts.all },
                ...LEAD_STATUSES.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  meta: counts[entry.id] ?? 0,
                })),
              ]}
            />
          </div>
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(lead) => lead.id}
          onRowClick={(lead) => setOpen(lead)}
          rowLabel={(lead) => `Open ${lead.contactName}`}
          isCurrent={(lead) => lead.id === open?.id}
          empty={
            leads.length === 0
              ? "Nobody has asked for a demo yet. The form on /demo lands here."
              : "No lead matches that."
          }
        />
      </ChartCard>

      {open ? <LeadSheet lead={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function LeadSheet({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateLead, IDLE);
  const [status, setStatus] = useState(lead.status);

  useActionToast(state, {
    saved: state.saved?.label ?? "Lead saved",
    failed: "That lead did not save",
  });

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={lead.contactName}
        className="pos-sheet outline-none"
      >
        <form action={action}>
          <input type="hidden" name="lead_id" value={lead.id} />

          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1rem] leading-tight font-bold">
                {lead.contactName}
              </h2>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                {lead.businessName || "No business named"} · {lead.phone} ·{" "}
                {writeWhen(lead.createdAt)}
              </p>
            </div>

            <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
              <IconClose />
            </button>
          </header>

          <fieldset disabled={pending} className="space-y-5 px-4 py-5 sm:px-5">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            {lead.message ? (
              <p className="rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2 text-[0.8125rem] leading-relaxed whitespace-pre-line text-graphite-700">
                {lead.message}
              </p>
            ) : null}

            <dl className="grid gap-x-6 gap-y-1.5 text-[0.8125rem] sm:grid-cols-2">
              <Row label="City" value={lead.city} />
              <Row label="Shop type" value={lead.shopType} />
              <Row label="Counters" value={lead.registers} />
              <Row label="Email" value={lead.email} />
              <Row label="Came from" value={lead.source} />
            </dl>

            <SelectRow
              label="Where it is"
              value={status}
              onChange={setStatus}
              options={LEAD_STATUSES.map((entry) => ({
                id: entry.id,
                label: entry.label,
              }))}
            />
            <input type="hidden" name="status" value={status} />

            <label className="block">
              <span className="pos-label">What they said</span>
              <textarea
                name="notes"
                className="pos-field min-h-24"
                defaultValue={lead.notes}
                placeholder="Rang Tuesday. Two counters, wants to see stock working first."
              />
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={waLink(
                  lead.phone,
                  `Assalam-o-Alaikum ${lead.contactName}! Flo ke baare mein baat karni thi.`,
                )}
                target="_blank"
                rel="noreferrer"
                className="pos-btn pos-btn-soft"
              >
                WhatsApp them
              </a>

              <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none text-graphite-500">{label}</dt>
      <dd className="min-w-0 truncate text-graphite-900">
        {value || <span className="text-graphite-500">—</span>}
      </dd>
    </div>
  );
}
