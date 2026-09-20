"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getTillAccess } from "@/lib/pos/access";
import { CASH_MAX, SHIFT_NOTE_MAX } from "@/lib/pos/shift";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Opening and closing a drawer.
 *
 * In its own module rather than beside `recordSale`, for the reason
 * `hold-actions.ts` and `choose-counter.ts` are: a `"use server"` file exports
 * an endpoint per function, and the sale path has no business being pulled in
 * by the paperwork around it.
 *
 * **Opening is open to anybody at the till.** That is deliberate and is not an
 * oversight about `can_close_shift`: a shift is somebody saying "this is my
 * drawer and this is what was in it", and a cashier who has to fetch a manager
 * to make that statement is a cashier who does not make it. The float is the
 * one figure that is true at the start and unknowable by 11 pm.
 *
 * **Closing is open to anybody too, and the variance is not.** The cashier
 * counts the drawer and types what is in it; only somebody with
 * `can_close_shift` is handed back the over-or-short. That is exactly what the
 * switch's own label on Settings has always promised — "Also shows the
 * over-or-short" — and it is the whole of the accountability: a cashier who can
 * see the expected figure before they count is a cashier who can count to it.
 *
 * Both writes go through security-definer functions, so the arithmetic that
 * decides what should have been in the drawer happens once, in SQL, under a
 * lock, from the shift's own sales — never from anything the browser sent.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShiftResult = { ok: true } | { ok: false; error: string };

export async function openShift(input: {
  counterId: string;
  float: number;
  note: string;
}): Promise<ShiftResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  if (!UUID.test(input.counterId)) {
    return { ok: false, error: "That counter is not one we can open." };
  }

  const float = Number(input.float);

  if (!Number.isFinite(float) || float < 0 || float > CASH_MAX) {
    return { ok: false, error: "That opening float is not an amount we can record." };
  }

  const { data, error } = await createAdminClient().rpc("open_shift", {
    p_tenant: session.tenantId,
    p_counter: input.counterId,
    p_by: session.userId,
    p_float: Math.round(float * 100) / 100,
    p_note: (input.note ?? "").slice(0, SHIFT_NOTE_MAX),
  });

  if (error) {
    console.error("[register] open_shift failed", error);
    return {
      ok: false,
      error:
        "We could not open the drawer. Check the connection and try again — the till still works, the takings just will not belong to a shift.",
    };
  }

  // The function returns the shift already open rather than raising, because
  // two tablets on one counter both opening at 9 am is not an error. Only a
  // genuinely new one is audited, or the log would claim the float went in
  // twice.
  const opened =
    data && typeof data === "object" && "opened" in data
      ? Boolean((data as { opened: unknown }).opened)
      : false;

  if (opened) {
    await recordAudit(session, {
      action: "shift.opened",
      subjectType: "shift",
      subjectId:
        data && typeof data === "object" && "shift_id" in data
          ? String((data as { shift_id: unknown }).shift_id)
          : null,
      after: { counter_id: input.counterId, opening_float: float },
    });
  }

  revalidatePath("/app/register");
  revalidatePath("/app/sales");

  return { ok: true };
}

export type CloseResult =
  | {
      ok: true;
      counted: number;
      /** Null for a cashier without `can_close_shift`. The drawer is still
       *  counted and the variance is still recorded — they are simply not the
       *  person who is shown it. */
      expected: number | null;
      overShort: number | null;
      card: number;
      bills: number;
    }
  | { ok: false; error: string };

export async function closeShift(input: {
  shiftId: string;
  counted: number;
  note: string;
}): Promise<CloseResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  if (!UUID.test(input.shiftId)) {
    return { ok: false, error: "That is not a shift we can close." };
  }

  const counted = Number(input.counted);

  if (!Number.isFinite(counted) || counted < 0 || counted > CASH_MAX) {
    return { ok: false, error: "That count is not an amount we can record." };
  }

  const till = await getTillAccess(session);

  const { data, error } = await createAdminClient().rpc("close_shift", {
    p_tenant: session.tenantId,
    p_shift: input.shiftId,
    p_by: session.userId,
    p_counted: Math.round(counted * 100) / 100,
    p_note: (input.note ?? "").slice(0, SHIFT_NOTE_MAX),
  });

  if (error) {
    console.error("[register] close_shift failed", error);
    return {
      ok: false,
      error:
        "We could not close the drawer. Check the connection and try again — nothing has been recorded, so count again if you have already put the notes away.",
    };
  }

  const read = (key: string) =>
    data && typeof data === "object" && key in data
      ? Number((data as Record<string, unknown>)[key]) || 0
      : 0;

  const expected = read("expected");
  const overShort = read("over_short");

  // Audited in full whoever closed it. What the cashier is *shown* is a
  // question about this screen; what the shop can go back and read is not, and
  // a variance that is only in the log of the person who was allowed to see it
  // is a variance nobody can investigate later.
  await recordAudit(session, {
    action: "shift.closed",
    subjectType: "shift",
    subjectId: input.shiftId,
    after: {
      counted: Math.round(counted * 100) / 100,
      expected,
      over_short: overShort,
      card: read("card"),
      bills: read("bills"),
    },
  });

  revalidatePath("/app/register");
  revalidatePath("/app/sales");

  return {
    ok: true,
    counted: read("counted"),
    // Withheld, not un-recorded. The row on `shifts` carries both figures
    // whoever pressed the button; this is only about whose screen they reach.
    expected: till.canCloseShift ? expected : null,
    overShort: till.canCloseShift ? overShort : null,
    card: read("card"),
    bills: read("bills"),
  };
}
