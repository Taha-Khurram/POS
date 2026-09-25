"use client";

import { useActionState, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { CredentialsCard } from "@/components/pos/credentials-card";
import {
  IconCheck,
  IconKey,
  IconMore,
  IconPause,
  IconPencil,
  IconTrash,
  IconUser,
} from "@/components/pos/icons";
import { placeMenu, useDismiss } from "@/components/pos/use-dismiss";
import { useActionToast } from "@/components/pos/toaster";
import {
  OWNER_ONLY,
  PLATFORM_SCREENS,
  writeDay,
  type PlatformScreen,
} from "@/lib/platform/admin";
import type { Operator } from "@/lib/platform/console";
import { STAFF_NAME_MAX } from "@/lib/pos/staff-options";

import {
  addOperator,
  removeOperator,
  resetOperatorPassword,
  revealOperatorLogin,
  setOperatorActive,
  setOperatorScreens,
} from "./actions";
import { IDLE, type AdminState } from "../state";

/**
 * Who may work this console, and which screens each of them gets.
 *
 * Two questions and one button: a name, the screens to tick, Create. Flo mints
 * the username and the password and shows them straight away; Show login on
 * the row brings them back whenever the owner needs to send them again. Every
 * action checks the owner for itself, and every one of them — Show login
 * included — is a line in the audit trail.
 */
export function TeamPanel({
  operators,
  selfId,
}: {
  operators: Operator[];
  selfId: string;
}) {
  const [state, action, pending] = useActionState(addOperator, IDLE);
  const [dismissed, setDismissed] = useState<number | null>(null);
  // A new form after every success, so the name box and the ticks clear.
  const [formKey, setFormKey] = useState(0);
  const [seen, setSeen] = useState<number | null>(null);

  if (state.savedAt !== seen) {
    setSeen(state.savedAt);
    if (state.savedAt && !state.error) setFormKey((key) => key + 1);
  }

  useActionToast(state, {
    saved: state.saved?.label ?? "Login created",
    failed: "That login was not created",
  });

  const members = operators.filter((operator) => operator.platformRole !== "super_admin");
  const off = members.filter((operator) => !operator.isActive).length;

  return (
    <div className="space-y-4">
      <form action={action} key={formKey}>
        <ChartCard
          title="Add a team member"
          caption="Type their name and tick what they may open. Flo makes the username and password."
          footer={
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create login"}
            </button>
          }
        >
          <fieldset disabled={pending} className="space-y-4">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            <label className="block max-w-sm">
              <span className="pos-label">Their name</span>
              <input
                name="full_name"
                required
                maxLength={STAFF_NAME_MAX}
                className="pos-field"
                autoComplete="off"
                placeholder="Ali Raza"
              />
            </label>

            <ScreenPicker />
          </fieldset>
        </ChartCard>
      </form>

      {state.credentials && state.savedAt !== dismissed ? (
        <Credentials
          credentials={state.credentials}
          onHide={() => setDismissed(state.savedAt)}
        />
      ) : null}

      <ChartCard
        title="Your team"
        caption={
          members.length === 0
            ? "Nobody yet — just you."
            : `${members.length} ${members.length === 1 ? "person" : "people"}${
                off ? `, ${off} switched off` : ""
              }.`
        }
      >
        <ul className="space-y-2">
          {operators.map((operator) =>
            operator.platformRole === "super_admin" ? (
              <OwnerRow
                key={operator.userId}
                operator={operator}
                self={operator.userId === selfId}
              />
            ) : (
              <MemberRow key={operator.userId} operator={operator} />
            ),
          )}
        </ul>
      </ChartCard>
    </div>
  );
}

/**
 * The screens as tiles to tick, and the list nobody but the owner gets —
 * printed under them so nobody goes looking for an Audit trail box.
 */
function ScreenPicker({ ticked = [] }: { ticked?: readonly PlatformScreen[] }) {
  return (
    <div>
      <p className="pos-label">What they may open</p>

      <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORM_SCREENS.map((screen) => (
          <label
            key={screen.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-orchid-100 bg-paper-50 px-3 py-2.5 transition-colors hover:border-orchid-300 has-[:checked]:border-orchid-400 has-[:checked]:bg-orchid-50"
          >
            <input
              type="checkbox"
              name="screens"
              value={screen.id}
              defaultChecked={ticked.includes(screen.id)}
              className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-semibold text-graphite-900">
                {screen.label}
              </span>
              <span className="block text-[0.6875rem] leading-snug text-graphite-500">
                {screen.description}
              </span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2 text-[0.6875rem] text-graphite-500">
        Only you, always: {OWNER_ONLY.join(", ")}.
      </p>
    </div>
  );
}

function Credentials({
  credentials,
  onHide,
}: {
  credentials: NonNullable<AdminState["credentials"]>;
  onHide: () => void;
}) {
  return (
    <div className="space-y-2">
      <CredentialsCard {...credentials} emailLabel="Username" kept />
      <button type="button" className="pos-btn pos-btn-quiet pos-btn-sm" onClick={onHide}>
        Hide
      </button>
    </div>
  );
}

function OwnerRow({ operator, self }: { operator: Operator; self: boolean }) {
  return (
    <li className="rounded-xl border border-orchid-100 px-3 py-2">
      <span className="text-[0.8125rem] text-graphite-900">
        {operator.fullName}
        <span className="pos-badge pos-badge-info ml-2">Flo owner</span>
        {self ? <span className="pos-badge ml-2">You</span> : null}
      </span>
      <span className="block truncate text-[0.6875rem] text-graphite-500">
        {operator.email ? `${operator.email} · ` : ""}Every screen
      </span>
    </li>
  );
}

/**
 * One member: which screens they have, and the five things that can happen to
 * them, behind one "⋯" menu rather than five buttons across the row. Show login
 * is first because it is the one pressed most — a member who lost the WhatsApp
 * message. Switching off comes before deleting on purpose: it is undoable and
 * keeps their name on the trail, and Delete sits alone under a rule, in red.
 *
 * Every item still dispatches the same Server Action its old form did, with the
 * same fields — built here rather than in a `<form>`, because a form inside a
 * menu that closes on the click is unmounted before its submit lands.
 */
function MemberRow({ operator }: { operator: Operator }) {
  const [screensState, screensAction, screensPending] = useActionState(setOperatorScreens, IDLE);
  const [standing, standingAction, standingPending] = useActionState(setOperatorActive, IDLE);
  const [reveal, revealAction, revealPending] = useActionState(revealOperatorLogin, IDLE);
  const [reset, resetAction, resetPending] = useActionState(resetOperatorPassword, IDLE);
  const [removal, removeAction, removePending] = useActionState(removeOperator, IDLE);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [hidden, setHidden] = useState<number | null>(null);
  const { ref: menuRef, open: menuOpen, setOpen: setMenuOpen } = useDismiss<HTMLDivElement>();
  const [, startTransition] = useTransition();
  const busy = revealPending || standingPending || resetPending || removePending;

  const run = (dispatch: (body: FormData) => void, fields: Record<string, string> = {}) => {
    const body = new FormData();
    body.set("user_id", operator.userId);
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
    setMenuOpen(false);
    startTransition(() => dispatch(body));
  };
  const [seen, setSeen] = useState<number | null>(null);

  // Close the editor once its save lands — during render, React's own answer
  // for state that follows an action's result.
  if (screensState.savedAt !== seen) {
    setSeen(screensState.savedAt);
    if (screensState.savedAt && !screensState.error) setEditing(false);
  }

  useActionToast(screensState, {
    saved: screensState.saved?.label ?? "Access saved",
    failed: "That did not save",
  });
  useActionToast(standing, {
    saved: standing.saved?.label ?? "Saved",
    failed: "That did not save",
  });
  useActionToast(reveal, {
    saved: reveal.saved?.label ?? "Login shown",
    failed: "No login to show",
  });
  useActionToast(reset, {
    saved: reset.saved?.label ?? "New password made",
    failed: "No new password",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Removed",
    failed: "That account was not removed",
  });

  // Whichever of the two was pressed last is the one on screen.
  const shown = (reset.savedAt ?? 0) > (reveal.savedAt ?? 0) ? reset : reveal;
  const labels = PLATFORM_SCREENS.filter((screen) => operator.screens.includes(screen.id));

  return (
    <li
      className={`rounded-xl border border-orchid-100 px-3 py-2 ${
        operator.isActive ? "" : "bg-paper-200/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[0.8125rem] text-graphite-900">
          <span className={operator.isActive ? "" : "text-graphite-500"}>
            {operator.fullName}
          </span>
          {operator.isActive ? null : (
            <span className="pos-badge pos-badge-warn ml-2">Switched off</span>
          )}
          {operator.hasShop ? (
            <span
              className="pos-badge ml-2"
              title="This login also runs a shop. Its password and its till are left alone."
            >
              Runs a shop
            </span>
          ) : null}
          <span className="block truncate text-[0.6875rem] text-graphite-500">
            {operator.email ? `${operator.email} · ` : ""}Since {writeDay(operator.createdAt)}
          </span>
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="pos-icon-btn h-8 w-8"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Actions for ${operator.fullName}`}
            disabled={busy}
          >
            {busy ? (
              <span className="text-[0.75rem] leading-none text-graphite-500">…</span>
            ) : (
              <IconMore className="h-4 w-4" />
            )}
          </button>

          {menuOpen ? (
            <div ref={placeMenu} className="pos-menu min-w-[13rem]" role="menu" aria-label={operator.fullName}>
              {operator.hasShop ? null : (
                <button
                  type="button"
                  role="menuitem"
                  className="pos-menu-item"
                  onClick={() => run(revealAction)}
                >
                  <IconUser className="h-4 w-4" />
                  Show login
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                className="pos-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirming(false);
                  setEditing(true);
                }}
              >
                <IconPencil className="h-4 w-4" />
                Edit access
              </button>

              {operator.hasShop ? null : (
                <button
                  type="button"
                  role="menuitem"
                  className="pos-menu-item"
                  onClick={() => run(resetAction)}
                >
                  <IconKey className="h-4 w-4" />
                  New password
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                className="pos-menu-item"
                onClick={() =>
                  run(standingAction, { is_active: operator.isActive ? "false" : "true" })
                }
              >
                {operator.isActive ? (
                  <IconPause className="h-4 w-4" />
                ) : (
                  <IconCheck className="h-4 w-4" />
                )}
                {operator.isActive ? "Switch off" : "Switch on"}
              </button>

              <div className="my-1 border-t border-orchid-100" role="separator" />

              <button
                type="button"
                role="menuitem"
                className="pos-menu-item text-signal-bad"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing(false);
                  setConfirming(true);
                }}
              >
                <IconTrash className="h-4 w-4" />
                {operator.hasShop ? "Remove from the team" : "Delete"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {editing ? null : (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {labels.length ? (
            labels.map((screen) => (
              <span key={screen.id} className="pos-badge">
                {screen.label}
              </span>
            ))
          ) : (
            <span className="text-[0.6875rem] text-graphite-500">No screens</span>
          )}
        </div>
      )}

      {editing ? (
        <form action={screensAction} className="mt-2 space-y-3 border-t border-orchid-100 pt-3">
          <input type="hidden" name="user_id" value={operator.userId} />
          {screensState.error ? (
            <p className="pos-note pos-note-bad">{screensState.error}</p>
          ) : null}
          <fieldset disabled={screensPending}>
            <ScreenPicker ticked={operator.screens} />
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="pos-btn pos-btn-primary pos-btn-sm" disabled={screensPending}>
              {screensPending ? "Saving…" : "Save access"}
            </button>
            <button
              type="button"
              className="pos-btn pos-btn-quiet pos-btn-sm"
              onClick={() => setEditing(false)}
              disabled={screensPending}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {confirming ? (
        <form
          action={removeAction}
          className="mt-2 flex flex-wrap items-center gap-2 border-t border-orchid-100 pt-2"
        >
          <input type="hidden" name="user_id" value={operator.userId} />
          <p className="min-w-0 flex-1 text-[0.75rem] leading-relaxed text-graphite-700">
            {operator.hasShop
              ? "Their console access goes. Their login and their shop are left exactly as they are."
              : "The login is deleted for good. What they did stays in the audit trail. If they might be back, switch them off instead."}
          </p>
          <button
            type="submit"
            className="pos-btn pos-btn-soft pos-btn-sm text-signal-bad"
            disabled={removePending}
          >
            {removePending ? "Deleting…" : operator.hasShop ? "Yes, remove access" : "Yes, delete"}
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-quiet pos-btn-sm"
            onClick={() => setConfirming(false)}
          >
            Keep them
          </button>
        </form>
      ) : null}

      {shown.credentials && shown.savedAt !== hidden ? (
        <div className="mt-2">
          <Credentials credentials={shown.credentials} onHide={() => setHidden(shown.savedAt)} />
        </div>
      ) : null}
    </li>
  );
}
