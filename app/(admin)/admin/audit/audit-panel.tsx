"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { DateRangeModal } from "@/components/pos/date-range-modal";
import {
  IconCalendar,
  IconChevron,
  IconClose,
  IconSearch,
} from "@/components/pos/icons";
import { Select } from "@/components/pos/select-field";
import { writeWhen } from "@/lib/platform/admin";
import {
  AUDIT_ACTORS,
  AUDIT_AREAS,
  AUDIT_PAGE_SIZE,
  AUDIT_RANGES,
  NO_AUDIT_FILTERS,
  AUDIT_WHERE,
  auditSearch,
  describeEntry,
  describeRecord,
  isNarrowed,
  subjectLabel,
  type AuditRecord,
  type AuditActorId,
  type AuditAreaId,
  type AuditFilters,
} from "@/lib/platform/audit";
import type { AuditPage, AuditRow } from "@/lib/platform/console";

/** Long enough that a word is finished before the list moves under it. */
const TYPING_MS = 350;

const AREA_OPTIONS = [
  { id: "", label: "Every area" },
  ...AUDIT_AREAS.map((area) => ({ id: area.id, label: area.label })),
];

const ACTOR_OPTIONS = [
  { id: "", label: "Anybody" },
  ...AUDIT_ACTORS.map((actor) => ({
    id: actor.id,
    label: actor.label,
    description: actor.description,
  })),
];

/** The exact moment, in the operators' own clock. "3 days ago" is fine for a
 *  glance and useless for matching an entry against a WhatsApp message. */
const STAMP = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const stamp = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : STAMP.format(at);
};

const DAY_LABEL = new Intl.DateTimeFormat("en-PK", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A `YYYY-MM-DD` as "12 Sept 2026". Read as UTC on purpose: it is a label for
 *  a calendar day, and the device's own offset must not move it by one. */
const dayLabel = (value: string) =>
  value ? DAY_LABEL.format(new Date(`${value}T00:00:00Z`)) : "";

/**
 * Every change anybody made, newest first, a page at a time.
 *
 * Read-only by construction: `audit_log` has an append-only trigger rather than
 * a policy, because the service role has `bypassrls` and a policy would not
 * stop the console's own writes. The only controls on this screen move the
 * reader around the trail; none of them can touch it.
 *
 * Every filter is a URL change and the server does the filtering — the trail
 * grows for ever, so there is no window small enough to hold in the browser.
 * The search box is the one control that does not navigate on every keystroke.
 *
 * Opening a row shows the before and after in words — field by field, with
 * rupees, dates and names written out and the ids left out. Every value is
 * still the one stored: `describeRecord` formats, it never works anything out,
 * so what the sheet says is what the row holds.
 */
export function AuditPanel({
  filters,
  result,
}: {
  filters: AuditFilters;
  result: AuditPage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // The box follows the URL when something else changes it — Clear all, the
  // back button, a "by this person" jump from the sheet — without fighting the
  // reader while they type.
  const [query, setQuery] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    setQuery(filters.q);
  }

  const go = (patch: Partial<AuditFilters>, replace = false) => {
    // Any change of filter starts again from the newest entry; only the pager
    // itself keeps a page number.
    const next = { ...filters, page: 1, ...patch };
    const href = `/admin/audit${auditSearch(next)}`;
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };

  useEffect(() => {
    if (query.trim() === filters.q) return;
    const timer = window.setTimeout(() => go({ q: query.trim() }, true), TYPING_MS);
    return () => window.clearTimeout(timer);
    // `go` is rebuilt every render; the timer only cares what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.q]);

  // "/" jumps to the search box, the shortcut every log viewer has taught
  // people to expect.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || openId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const { rows, total, page, pages } = result;
  const openIndex = rows.findIndex((row) => row.id === openId);
  const open = openIndex === -1 ? null : rows[openIndex];
  const narrowed = isNarrowed(filters);

  const chips = activeChips(filters, result.shopName);

  const columns: Column<AuditRow>[] = [
    {
      key: "what",
      header: "What happened",
      cell: (row) => <Sentence row={row} />,
    },
    {
      key: "shop",
      header: "Shop",
      cell: (row) =>
        row.tenantId ? (
          <span className="text-graphite-900">{row.shopName || "Deleted shop"}</span>
        ) : (
          <span className="text-graphite-500">—</span>
        ),
    },
    {
      key: "when",
      header: "When",
      align: "end",
      cell: (row) => (
        <span className="whitespace-nowrap text-graphite-700">
          {stamp(row.createdAt)}
          <span className="block text-[0.6875rem] text-graphite-500">
            {writeWhen(row.createdAt)}
          </span>
        </span>
      ),
    },
  ];

  return (
    <>
      <ChartCard
        title="Every change, newest first"
        caption={caption(result, narrowed)}
        footer={
          total > 0 ? (
            <Pager
              page={page}
              pages={pages}
              total={total}
              pending={pending}
              onGo={(next) => go({ page: next })}
            />
          ) : undefined
        }
        bleed
      >
        <div className="space-y-3 px-4 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* A div and not a label, because of the × inside it — see the
                sales history's search box for why that matters. */}
            <div className="relative min-w-[14rem] flex-1">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter searches now rather than after the pause.
                  if (event.key === "Enter") go({ q: query.trim() }, true);
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
                className="pos-field pr-9 pl-9"
                placeholder="Search a shop, an email, or what happened — “sign in failed”"
                aria-label="Search the audit trail"
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="pos-filter-tag-x absolute top-1/2 right-2.5 -translate-y-1/2"
                  aria-label="Clear the search"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-orchid-100 px-1.5 text-[0.6875rem] text-graphite-500 sm:block">
                  /
                </kbd>
              )}
            </div>

            <div className="w-[12rem] flex-none">
              <Select
                value={filters.area}
                onChange={(next) => go({ area: next as AuditAreaId | "" })}
                options={AREA_OPTIONS}
                label="Narrow to one area of the console"
              />
            </div>

            <div className="w-[12rem] flex-none">
              <Select
                value={filters.who}
                onChange={(next) => go({ who: next as AuditActorId | "" })}
                options={ACTOR_OPTIONS}
                label="Narrow by who did it"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="pos-tabs" role="tablist" aria-label="When">
              {AUDIT_RANGES.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  role="tab"
                  aria-selected={filters.range === range.id}
                  onClick={() =>
                    range.id === "custom" ? setPicking(true) : go({ range: range.id })
                  }
                  className="pos-tab"
                >
                  {range.label}
                </button>
              ))}
            </div>

            {filters.range === "custom" ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="pos-btn pos-btn-soft pos-btn-sm"
              >
                <IconCalendar className="h-4 w-4" />
                {rangeLabel(filters)}
              </button>
            ) : null}
          </div>

          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <span key={chip.key} className="pos-filter-tag">
                  <span className="pos-filter-tag-key">{chip.name}</span>
                  {chip.value}
                  <button
                    type="button"
                    onClick={() => go(chip.clear)}
                    className="pos-filter-tag-x"
                    aria-label={`Remove ${chip.name.toLowerCase()} ${chip.value}`}
                  >
                    <IconClose className="h-3 w-3" />
                  </button>
                </span>
              ))}

              <button
                type="button"
                onClick={() => go(NO_AUDIT_FILTERS)}
                className="pos-btn pos-btn-quiet pos-btn-sm"
              >
                Clear all
              </button>
            </div>
          ) : null}
        </div>

        <div
          aria-busy={pending}
          className={`transition-opacity duration-200 ${pending ? "opacity-50" : ""}`}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => setOpenId(row.id)}
            rowLabel={(row) => {
              const line = describeEntry(row);
              return `Open: ${line.actor} ${line.did}`;
            }}
            isCurrent={(row) => row.id === openId}
            empty={
              narrowed
                ? "Nothing matches these filters. Try fewer words, or a wider date range."
                : "Nothing recorded yet."
            }
          />
        </div>
      </ChartCard>

      {picking ? (
        <DateRangeModal
          initial={
            filters.range === "custom" && filters.from
              ? { from: filters.from, to: filters.to || filters.from }
              : undefined
          }
          daysOnly
          title="Which days"
          cta="Show these entries"
          onClose={() => setPicking(false)}
          onApply={(from, to) => {
            setPicking(false);
            go({ range: "custom", from, to });
          }}
        />
      ) : null}

      {open ? (
        <EntrySheet
          row={open}
          position={openIndex}
          count={rows.length}
          onWalk={(delta) => {
            const next = rows[openIndex + delta];
            if (next) setOpenId(next.id);
          }}
          onClose={() => setOpenId(null)}
          onFilter={(patch) => {
            setOpenId(null);
            go(patch);
          }}
        />
      ) : null}
    </>
  );
}

/** "**Taha Khurram** suspended Muhammad Ibrahim's console login", with the
 *  detail under it. The stored action code lives in the sheet, not here. */
function Sentence({ row }: { row: AuditRow }) {
  const line = describeEntry(row);
  return (
    <span className="block max-w-[38rem] whitespace-normal">
      <span className="text-graphite-900">
        <span className="font-semibold">{line.actor}</span> {line.did}
      </span>
      {line.detail ? (
        <span className="mt-0.5 block text-[0.75rem] text-graphite-500">{line.detail}</span>
      ) : null}
    </span>
  );
}

/** "12 Sept 2026 → 25 Sept 2026", or one day when both ends are the same. */
function rangeLabel(filters: AuditFilters): string {
  const from = dayLabel(filters.from);
  const to = dayLabel(filters.to);
  if (!from && !to) return "Pick dates";
  if (!to || from === to) return from || to;
  return `${from || "The start"} → ${to}`;
}

type Chip = { key: string; name: string; value: string; clear: Partial<AuditFilters> };

function activeChips(filters: AuditFilters, shopName: string): Chip[] {
  const chips: Chip[] = [];

  if (filters.q) chips.push({ key: "q", name: "Search", value: `“${filters.q}”`, clear: { q: "" } });

  if (filters.shop) {
    chips.push({
      key: "shop",
      name: "Shop",
      value: shopName || "Deleted shop",
      clear: { shop: "" },
    });
  }

  const area = AUDIT_AREAS.find((entry) => entry.id === filters.area);
  if (area) chips.push({ key: "area", name: "Area", value: area.label, clear: { area: "" } });

  const actor = AUDIT_ACTORS.find((entry) => entry.id === filters.who);
  if (actor) chips.push({ key: "who", name: "Who", value: actor.label, clear: { who: "" } });

  if (filters.range !== "all") {
    const range = AUDIT_RANGES.find((entry) => entry.id === filters.range);
    const value =
      filters.range === "custom"
        ? rangeLabel(filters)
        : (range?.label ?? "");
    chips.push({
      key: "range",
      name: "When",
      value,
      clear: { range: "all", from: "", to: "" },
    });
  }

  return chips;
}

function caption(result: AuditPage, narrowed: boolean): string {
  const { total, page, rows } = result;
  const count = (value: number) => value.toLocaleString("en-PK");
  const noun = total === 1 ? "entry" : "entries";

  if (total === 0) return narrowed ? "No entries match." : "Nothing recorded yet.";

  const from = (page - 1) * AUDIT_PAGE_SIZE + 1;
  const to = from + rows.length - 1;
  const which = narrowed ? `${count(total)} ${noun} match` : `${count(total)} ${noun} in all`;

  return total > rows.length ? `${which} — showing ${count(from)}–${count(to)}` : which;
}

/**
 * Which page numbers to draw: always the first and the last, the current one
 * with a neighbour either side, and a gap wherever that skips something —
 * `1 … 4 5 6 … 20`. A gap of exactly one page is drawn as the page instead,
 * because "…" standing in for a single number is a button hidden for nothing.
 */
function pageList(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const shown = [...wanted].filter((n) => n >= 1 && n <= pages).sort((x, y) => x - y);

  const out: (number | "gap")[] = [];
  for (const n of shown) {
    const last = out[out.length - 1];
    if (typeof last === "number" && n - last === 2) out.push(last + 1);
    else if (typeof last === "number" && n - last > 2) out.push("gap");
    out.push(n);
  }
  return out;
}

/** Numbered pages with Previous and Next either side. Page 1 is the newest
 *  entries, the last page is where the trail starts. Drawn even when there is
 *  only one page, so the footer always says how many entries there are. */
function Pager({
  page,
  pages,
  total,
  pending,
  onGo,
}: {
  page: number;
  pages: number;
  total: number;
  pending: boolean;
  onGo: (page: number) => void;
}) {
  const step =
    "pos-btn pos-btn-soft pos-btn-sm disabled:pointer-events-none disabled:opacity-40";
  const from = (page - 1) * AUDIT_PAGE_SIZE + 1;
  const to = Math.min(total, page * AUDIT_PAGE_SIZE);

  return (
    <>
      <p className="me-auto text-[0.75rem] tabular-nums text-graphite-500">
        Showing {from.toLocaleString("en-PK")}–{to.toLocaleString("en-PK")} of{" "}
        {total.toLocaleString("en-PK")}
      </p>

      <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onGo(page - 1)}
          disabled={page === 1 || pending}
          className={step}
          aria-label="Previous page"
        >
          <IconChevron className="h-4 w-4 rotate-90" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        {pageList(page, pages).map((entry, index) =>
          entry === "gap" ? (
            <span
              key={`gap-${index}`}
              className="px-1 text-[0.75rem] text-graphite-500"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onGo(entry)}
              disabled={pending && entry !== page}
              aria-current={entry === page ? "page" : undefined}
              aria-label={`Page ${entry}`}
              className={`pos-btn pos-btn-sm min-w-8 justify-center tabular-nums ${
                entry === page ? "pos-btn-primary pointer-events-none" : "pos-btn-soft"
              }`}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onGo(page + 1)}
          disabled={page >= pages || pending}
          className={step}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <IconChevron className="h-4 w-4 -rotate-90" />
        </button>
      </nav>
    </>
  );
}

function EntrySheet({
  row,
  position,
  count,
  onWalk,
  onClose,
  onFilter,
}: {
  row: AuditRow;
  position: number;
  count: number;
  onWalk: (delta: number) => void;
  onClose: () => void;
  onFilter: (patch: Partial<AuditFilters>) => void;
}) {
  const line = describeEntry(row);
  const record = describeRecord(row);
  const about = subjectLabel(row);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown" || event.key === "ArrowRight") onWalk(1);
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") onWalk(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onWalk]);

  const facts: [string, React.ReactNode][] = [
    ["When", `${stamp(row.createdAt)} · ${writeWhen(row.createdAt)}`],
    [
      "Who",
      row.actorKind === "system" || row.actorEmail === "system" ? (
        "Flo, automatically"
      ) : (
        <>
          {row.actorName || row.actorEmail}
          {row.actorName ? (
            <span className="block text-[0.75rem] text-graphite-500">{row.actorEmail}</span>
          ) : null}
        </>
      ),
    ],
    ["Where", AUDIT_WHERE[row.actorKind] ?? "—"],
    [
      "Shop",
      row.tenantId ? (
        <Link
          href={`/admin/clients/${row.tenantId}`}
          className="text-orchid-700 underline-offset-2 hover:underline"
        >
          {row.shopName || "Deleted shop"}
        </Link>
      ) : (
        "—"
      ),
    ],
    ...(about ? ([["About", about]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${line.actor} ${line.did}`}
        className="pos-sheet outline-none"
      >
        <header className="border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <h2 className="font-display text-[1rem] leading-snug font-semibold">
            {line.actor} <span className="font-medium">{line.did}</span>
          </h2>
          {line.detail ? (
            <p className="mt-1 text-[0.8125rem] text-graphite-700">{line.detail}</p>
          ) : null}
        </header>

        <div className="space-y-5 px-4 py-5 sm:px-5">
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-[0.8125rem]">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-graphite-500">{label}</dt>
                <dd className="min-w-0 break-words text-graphite-900">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            {row.tenantId ? (
              <button
                type="button"
                onClick={() => onFilter({ shop: row.tenantId ?? "" })}
                className="pos-btn pos-btn-soft pos-btn-sm"
              >
                Everything for this shop
              </button>
            ) : null}
            {row.actorEmail !== "system" ? (
              <button
                type="button"
                onClick={() => onFilter({ q: row.actorEmail })}
                className="pos-btn pos-btn-soft pos-btn-sm"
              >
                Everything by {row.actorName || row.actorEmail}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onFilter({ q: row.action })}
              className="pos-btn pos-btn-soft pos-btn-sm"
            >
              Every entry like this
            </button>
          </div>

          <RecordView record={record} />
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => onWalk(-1)}
            disabled={position <= 0}
            className="pos-btn pos-btn-soft pos-btn-sm disabled:pointer-events-none disabled:opacity-40"
            aria-label="Newer entry"
          >
            <IconChevron className="h-4 w-4 rotate-90" />
          </button>
          <span className="text-[0.75rem] tabular-nums text-graphite-500">
            {position + 1} of {count} on this page
          </span>
          <button
            type="button"
            onClick={() => onWalk(1)}
            disabled={position >= count - 1}
            className="pos-btn pos-btn-soft pos-btn-sm disabled:pointer-events-none disabled:opacity-40"
            aria-label="Older entry"
          >
            <IconChevron className="h-4 w-4 -rotate-90" />
          </button>

          <button type="button" onClick={onClose} className="pos-btn pos-btn-soft ms-auto">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

const RECORD_HEADINGS: Record<Exclude<AuditRecord["kind"], "none" | "unchanged">, string> = {
  changed: "What changed",
  saved: "What was saved",
  removed: "What it was when it was removed",
};

/** The stored before-and-after as sentences a person can check, never JSON. */
function RecordView({ record }: { record: AuditRecord }) {
  if (record.kind === "none") return null;
  if (record.kind !== "unchanged" && record.fields.length === 0) return null;

  if (record.kind === "unchanged") {
    return (
      <div>
        <p className="pos-label">What changed</p>
        <p className="text-[0.8125rem] text-graphite-500">
          Nothing — it was saved exactly as it already was.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="pos-label">{RECORD_HEADINGS[record.kind]}</p>
      <dl className="divide-y divide-orchid-100 overflow-hidden rounded-xl border border-orchid-100">
        {record.fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-x-3 px-3 py-2 text-[0.8125rem]"
          >
            <dt className="text-graphite-500">{field.label}</dt>
            <dd className="min-w-0 break-words text-graphite-900">
              {record.kind === "changed" ? (
                <>
                  <span className="text-graphite-500 line-through decoration-graphite-500/50">
                    {field.before}
                  </span>
                  <span className="mx-1.5 text-graphite-500" aria-label="changed to">
                    →
                  </span>
                  <span className="font-medium">{field.after}</span>
                </>
              ) : record.kind === "saved" ? (
                field.after
              ) : (
                field.before
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
