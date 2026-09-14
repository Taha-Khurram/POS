"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

/**
 * The "keep me signed in" checkbox that used to live here has gone. Supabase
 * session cookies persist either way, so it decided nothing — and a control
 * that looks like a security choice but is wired to nothing is worse than no
 * control at all.
 *
 * There is no `next` field any more either: sign-in has exactly one
 * destination now, so there is nothing for the form to carry.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="grid gap-5">
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="field"
          autoComplete="email"
          placeholder="you@business.com"
          required
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">
            Password
          </label>
          <Link
            href="/demo"
            className="mb-1.5 text-[0.75rem] text-mist-400 transition-colors duration-300 hover:text-mist-50"
          >
            Forgot it?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
