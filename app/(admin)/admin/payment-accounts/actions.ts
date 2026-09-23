"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireBilling } from "@/lib/platform/access";
import {
  checkAccount,
  isWallet,
  normaliseIban,
  normaliseWallet,
} from "@/lib/platform/admin";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Where a buyer sends the money, edited without a deploy.
 *
 * Billing-only, like everything that touches money: an account number printed
 * on `/order/[reference]` is an instruction to a stranger to send Rs 5,000
 * somewhere, and a support account that could change one could redirect every
 * self-serve payment Flo takes. Every action re-checks for itself.
 *
 * Every write is audited with the row before and after, because "which account
 * was showing on the 14th" is the first question when a buyer says they paid
 * and the statement says nobody did.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const revalidateAccounts = () => {
  revalidatePath("/admin/payment-accounts");
  revalidatePath("/order/[reference]", "page");
};

const COLUMNS = "method, account_title, bank_name, account_number, iban, is_active, sort_order";

/** Add one when `account_id` is empty, otherwise save over it. */
export async function saveAccount(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const accountId = text(formData.get("account_id"));
  const draft = {
    method: text(formData.get("method")),
    accountTitle: text(formData.get("account_title")),
    bankName: text(formData.get("bank_name")),
    accountNumber: text(formData.get("account_number")),
    iban: text(formData.get("iban")),
  };

  const complaint = checkAccount(draft);
  if (complaint) return fail(complaint);

  const sortOrder = Number(text(formData.get("sort_order")) || "0");
  if (!Number.isInteger(sortOrder)) return fail("The order has to be a whole number.");

  const wallet = isWallet(draft.method);

  // Stored the way it is printed, so the order page never re-formats a number
  // somebody is about to send money to. A wallet keeps no bank and no IBAN —
  // `0044` refuses an IBAN on one, and a stale bank name would print beside it.
  const row = {
    method: draft.method,
    account_title: draft.accountTitle,
    bank_name: wallet ? null : draft.bankName,
    account_number: wallet
      ? (normaliseWallet(draft.accountNumber) as string)
      : draft.accountNumber.replace(/\s+/g, ""),
    iban: wallet ? null : normaliseIban(draft.iban) || null,
    is_active: text(formData.get("is_active")) === "on",
    sort_order: sortOrder,
  };

  const supabase = createAdminClient();

  if (!accountId) {
    const { data: created, error } = await supabase
      .from("payment_accounts")
      .insert(row)
      .select("id")
      .single();

    if (error || !created) {
      console.error("[admin] payment account create failed", error);
      return fail("That account was not added. Please try again.");
    }

    await recordAudit(gate.session, {
      action: "payment_account.created",
      subjectType: "payment_account",
      subjectId: created.id,
      after: row,
    });

    revalidateAccounts();

    return {
      ...IDLE,
      savedAt: Date.now(),
      saved: {
        label: `${draft.accountTitle} added`,
        detail: row.is_active
          ? "It now shows on every order's payment page."
          : "It is off, so no buyer sees it yet.",
      },
    };
  }

  const { data: before } = await supabase
    .from("payment_accounts")
    .select(COLUMNS)
    .eq("id", accountId)
    .maybeSingle();

  if (!before) return fail("That account is not there any more.");

  const { error } = await supabase.from("payment_accounts").update(row).eq("id", accountId);

  if (error) {
    console.error("[admin] payment account save failed for %s", accountId, error);
    return fail("That account did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "payment_account.updated",
    subjectType: "payment_account",
    subjectId: accountId,
    before,
    after: row,
  });

  revalidateAccounts();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${draft.accountTitle} saved`,
      detail: row.is_active ? undefined : "It is off, so no buyer sees it.",
    },
  };
}

/**
 * Off, without losing the details — the move for a wallet that has hit its
 * monthly ceiling and will be back on the 1st.
 */
export async function toggleAccount(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const accountId = text(formData.get("account_id"));
  const on = text(formData.get("is_active")) === "on";
  if (!accountId) return fail("That account is not there any more.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("payment_accounts")
    .select("account_title, is_active")
    .eq("id", accountId)
    .maybeSingle();

  if (!before) return fail("That account is not there any more.");

  const { error } = await supabase
    .from("payment_accounts")
    .update({ is_active: on })
    .eq("id", accountId);

  if (error) {
    console.error("[admin] payment account toggle failed for %s", accountId, error);
    return fail("That did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: on ? "payment_account.enabled" : "payment_account.disabled",
    subjectType: "payment_account",
    subjectId: accountId,
    before,
    after: { is_active: on },
  });

  revalidateAccounts();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${before.account_title} is ${on ? "showing" : "hidden"}`,
      detail: on ? "Buyers see it on the payment page." : "Buyers no longer see it.",
    },
  };
}

/**
 * A real delete. Nothing points at an account — a payment records the method
 * and the reference, never which of Flo's accounts it landed in — so there is
 * no history to break, and the audit row keeps the details it held.
 */
export async function deleteAccount(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const accountId = text(formData.get("account_id"));
  if (!accountId) return fail("That account is not there any more.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("payment_accounts")
    .select(COLUMNS)
    .eq("id", accountId)
    .maybeSingle();

  if (!before) return fail("That account is not there any more.");

  const { error } = await supabase.from("payment_accounts").delete().eq("id", accountId);

  if (error) {
    console.error("[admin] payment account delete failed for %s", accountId, error);
    return fail("That account was not removed. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "payment_account.deleted",
    subjectType: "payment_account",
    subjectId: accountId,
    before,
  });

  revalidateAccounts();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: `${before.account_title} removed` },
  };
}
