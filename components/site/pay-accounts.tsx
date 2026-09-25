import { CopyButton } from "@/components/admin/copy-button";
import { isWallet, methodLabel, writeIban, writeWallet } from "@/lib/platform/admin";
import type { PaymentAccount } from "@/lib/platform/console";

/**
 * Where a buyer sends the money — Flo's own accounts off `payment_accounts`.
 *
 * Drawn on `/checkout`, where most buyers pay before they submit, and again on
 * `/order/[reference]` for the ones who come back later. One component so the
 * two cannot disagree about what an IBAN looks like.
 */

/** Site-styled, for the copy buttons beside every number a buyer has to type. */
export const COPY = "btn btn-ghost btn-sm flex-none gap-1.5 !px-3 !py-1.5 text-[0.8125rem]";

/** One of the figures a transfer is matched on, with a copy button. */
export function PayFact({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-iris-200 bg-iris-200/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[0.75rem] font-semibold tracking-wide text-iris-600 uppercase">{label}</p>
        <p className="mt-0.5 truncate font-display text-[1.125rem] font-bold text-mist-50">{value}</p>
      </div>
      <CopyButton value={copy} className={COPY} />
    </div>
  );
}

/** A labelled line inside an account card; `copy` puts a button beside it. */
function AccountLine({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-700 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[0.75rem] text-mist-400">{label}</dt>
        <dd className={`mt-0.5 break-all text-[0.9375rem] text-mist-50 ${copy ? "font-mono tracking-wide" : "font-medium"}`}>{value}</dd>
      </div>
      {copy ? <CopyButton value={copy} className={COPY} /> : null}
    </div>
  );
}

/**
 * One account, the way a banking app asks for it. Numbers are printed spaced
 * for reading and copied bare, because an app that refuses a pasted IBAN over
 * a space is a buyer who types it in by hand instead.
 */
function AccountCard({ account }: { account: PaymentAccount }) {
  const wallet = isWallet(account.method);

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-950 p-4 sm:p-5">
      <p className="text-[0.75rem] font-semibold tracking-wide text-iris-600 uppercase">
        {wallet ? methodLabel(account.method) : account.bankName}
      </p>
      <dl className="mt-3">
        <AccountLine label="Account title" value={account.accountTitle} />
        {wallet ? (
          <AccountLine label={`${methodLabel(account.method)} number`} value={writeWallet(account.accountNumber)} copy={account.accountNumber} />
        ) : (
          <>
            <AccountLine label="Account number" value={account.accountNumber} copy={account.accountNumber} />
            {account.iban ? <AccountLine label="IBAN" value={writeIban(account.iban)} copy={account.iban} /> : null}
          </>
        )}
      </dl>
    </div>
  );
}

/** Every active account, or the WhatsApp fallback when none is switched on. */
export function PayAccounts({ accounts }: { accounts: PaymentAccount[] }) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-2xl border border-ink-700 bg-ink-900 p-4 text-[0.875rem] text-mist-200">
        Bank details will be confirmed by Flo support on WhatsApp before you transfer.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} />
      ))}
    </div>
  );
}
