"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Front end only. Supabase is already wired for session cookies in
 * `utils/supabase`, so this form is the place to call
 * `supabase.auth.signInWithPassword` once accounts exist.
 */
export function LoginForm() {
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        // No auth backend yet — release the button so the page is not stuck.
        window.setTimeout(() => setPending(false), 900);
      }}
      className="grid gap-5"
    >
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

      <label className="flex items-center gap-2.5 text-[0.8125rem] text-mist-400">
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="h-4 w-4 rounded border-white/15 bg-white/5 accent-iris-500"
        />
        Keep me signed in on this device
      </label>

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
