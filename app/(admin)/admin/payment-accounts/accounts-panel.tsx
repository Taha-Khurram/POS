"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconPlus } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import {
  ACCOUNT_METHODS,
  ACCOUNT_TITLE_MAX,
  BANK_NAME_MAX,
  checkAccount,
  isWallet,
  writeIban,
  writeWallet,
} from "@/lib/platform/admin";
import type { PaymentAccount } from "@/lib/platform/console";

import { deleteAccount, saveAccount, toggleAccount } from "./actions";
import { IDLE } from "../state";

/**
 * The accounts a buyer is told to send money to, one card each.
 *
 * What is typed here is printed, as is, in front of somebody about to send
 * Rs 5,000. `checkAccount` runs under every card as it is typed, and it is the
 * same function the Server Action refuses with.
 */
export function AccountsPanel({
  accounts,
  readOnly,
}: {
  accounts: PaymentAccount[];
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(accounts.length === 0 && !readOnly);
  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <AccountForm key={account.id} account={account} readOnly={readOnly} />
      ))}

      {readOnly ? null : adding ? (
        <AccountForm onDone={() => setAdding(false)} readOnly={false} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="pos-btn pos-btn-soft">
          <IconPlus className="h-4 w-4" />
          Add an account
        </button>
      )}
    </div>
  );
}

function AccountForm({
  account,
  readOnly,
  onDone,
}: {
  /** Absent for the "add" card. */
  account?: PaymentAccount;
  readOnly: boolean;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: typeof IDLE, formData: FormData) => {
      const next = await saveAccount(previous, formData);
      if (!account && next.savedAt) onDone?.();
      return next;
    },
    IDLE,
  );
  const [toggleState, toggleAction] = useActionState(toggleAccount, IDLE);
  const [deleteState, deleteAction, deleting] = useActionState(deleteAccount, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Account saved",
    failed: "That account did not save",
  });
  useActionToast(toggleState, {
    saved: toggleState.saved?.label ?? "Saved",
    failed: "That did not save",
  });
  useActionToast(deleteState, {
    saved: deleteState.saved?.label ?? "Removed",
    failed: "That account was not removed",
  });

  const [method, setMethod] = useState<string>(account?.method ?? "bank_transfer");
  const [accountTitle, setAccountTitle] = useState(account?.accountTitle ?? "");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? "");
  const [iban, setIban] = useState(account?.iban ?? "");
  const [confirming, setConfirming] = useState(false);

  const wallet = isWallet(method);
  const complaint = checkAccount({ method, accountTitle, bankName, accountNumber, iban });
  const formId = account ? `account-${account.id}` : "account-new";
  const methodLabel = ACCOUNT_METHODS.find((entry) => entry.id === method)?.label ?? method;

  const caption = account
    ? `${methodLabel} · ${
        wallet ? writeWallet(account.accountNumber) : account.iban ? writeIban(account.iban) : account.accountNumber
      }${account.isActive ? "" : " · hidden from buyers"}`
    : "Where a buyer sends the money. It shows on every order's payment page once it is on.";

  return (
    <>
      {/* Siblings, never children: a form inside a form is dropped by the
          browser, so the buttons below reach these by id. */}
      {account && !readOnly ? (
        <>
          <form action={toggleAction} id={`${formId}-toggle`} className="hidden">
            <input type="hidden" name="account_id" value={account.id} />
            {account.isActive ? null : <input type="hidden" name="is_active" value="on" />}
          </form>
          <form action={deleteAction} id={`${formId}-delete`} className="hidden">
            <input type="hidden" name="account_id" value={account.id} />
          </form>
        </>
      ) : null}

      <form action={action}>
        <input type="hidden" name="account_id" value={account?.id ?? ""} />
        <input type="hidden" name="method" value={method} />

        <ChartCard
          title={account ? account.accountTitle || methodLabel : "New account"}
          caption={caption}
          actions={
            account && !readOnly ? (
              <button type="submit" form={`${formId}-toggle`} className="pos-btn pos-btn-quiet pos-btn-sm">
                {account.isActive ? "Hide from buyers" : "Show to buyers"}
              </button>
            ) : null
          }
          footer={
            readOnly ? (
              <p className="text-[0.75rem] text-graphite-500">
                A support account can read this and change nothing on it.
              </p>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <p className="text-[0.75rem]">
                  {complaint ? (
                    <span className="flex items-center gap-1.5 text-signal-bad">
                      <IconAlert className="h-3.5 w-3.5" />
                      {complaint}
                    </span>
                  ) : null}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {account ? (
                    confirming ? (
                      <>
                        <button type="button" onClick={() => setConfirming(false)} className="pos-btn pos-btn-quiet pos-btn-sm">
                          Keep it
                        </button>
                        <button
                          type="submit"
                          form={`${formId}-delete`}
                          className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
                          disabled={deleting}
                        >
                          {deleting ? "Removing…" : "Remove for good"}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirming(true)} className="pos-btn pos-btn-quiet pos-btn-sm">
                        Remove
                      </button>
                    )
                  ) : (
                    <button type="button" onClick={onDone} className="pos-btn pos-btn-quiet">
                      Cancel
                    </button>
                  )}

                  <button type="submit" className="pos-btn pos-btn-primary" disabled={pending || Boolean(complaint)}>
                    {pending ? "Saving…" : account ? "Save" : "Add the account"}
                  </button>
                </div>
              </div>
            )
          }
        >
          <fieldset disabled={readOnly || pending} className="space-y-5">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectRow
                label="Sent by"
                value={method}
                onChange={setMethod}
                disabled={readOnly || pending}
                options={ACCOUNT_METHODS.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  description: entry.description,
                }))}
              />

              <label className="block">
                <span className="pos-label">Account title</span>
                <input
                  name="account_title"
                  className="pos-field"
                  value={accountTitle}
                  maxLength={ACCOUNT_TITLE_MAX}
                  autoComplete="off"
                  placeholder="Flo Technologies"
                  onChange={(event) => setAccountTitle(event.target.value)}
                />
                <span className="pos-hint">The name the buyer&rsquo;s app shows before they send.</span>
              </label>

              {wallet ? null : (
                <label className="block">
                  <span className="pos-label">Bank</span>
                  <input
                    name="bank_name"
                    className="pos-field"
                    value={bankName}
                    maxLength={BANK_NAME_MAX}
                    autoComplete="off"
                    placeholder="Meezan Bank"
                    onChange={(event) => setBankName(event.target.value)}
                  />
                </label>
              )}

              <label className="block">
                <span className="pos-label">{wallet ? "Mobile number" : "Account number"}</span>
                <input
                  name="account_number"
                  className="pos-field font-mono"
                  value={accountNumber}
                  inputMode={wallet ? "tel" : "text"}
                  autoComplete="off"
                  placeholder={wallet ? "0300 1234567" : "0101 0123456789"}
                  onChange={(event) => setAccountNumber(event.target.value)}
                />
              </label>

              {wallet ? null : (
                <label className="block sm:col-span-2">
                  <span className="pos-label">IBAN — optional</span>
                  <input
                    name="iban"
                    className="pos-field font-mono"
                    value={iban}
                    autoComplete="off"
                    placeholder="PK36 MEZN 0001 0101 2345 6789"
                    onChange={(event) => setIban(event.target.value)}
                  />
                  <span className="pos-hint">
                    Most banking apps ask for this rather than the account number.
                  </span>
                </label>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <label className="block">
                <span className="pos-label">Order</span>
                <input
                  name="sort_order"
                  className="pos-field"
                  defaultValue={account?.sortOrder ?? 0}
                  inputMode="numeric"
                />
                <span className="pos-hint">Lowest shows first.</span>
              </label>

              <label className="flex items-center gap-2 self-center">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={account?.isActive ?? true}
                  className="h-4 w-4 accent-orchid-700"
                />
                <span className="text-[0.8125rem] text-graphite-900">Show to buyers</span>
              </label>
            </div>
          </fieldset>
        </ChartCard>
      </form>
    </>
  );
}
