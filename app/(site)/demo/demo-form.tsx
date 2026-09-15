"use client";

import { useActionState } from "react";

import { submitLead, type LeadState } from "./actions";

const SIZES = [
  "1 branch, 1 register",
  "1 branch, 2–4 registers",
  "2–5 branches",
  "More than 5 branches",
];

const TYPES = [
  "Kiryana or general store",
  "Restaurant, café, or dhaba",
  "Bakery or mithai shop",
  "Pharmacy or medical store",
  "Clothing or fabric retail",
  "Multi-branch chain",
  "Something else",
];

const CITIES = [
  "Karachi",
  "Lahore",
  "Islamabad / Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Quetta",
  "Somewhere else in Pakistan",
];

/**
 * Front end only — nothing is sent anywhere yet. Wire `onSubmit` to a Server
 * Action (or a route handler) once there is somewhere for the lead to land.
 */
export function DemoForm() {
  const [state, formAction, pending] = useActionState<LeadState, FormData>(submitLead, {
    error: null,
    sent: false,
  });

  if (state.sent) {
    return (
      <div className="panel rim relative overflow-hidden rounded-[24px] p-8 text-center sm:p-12">
        <div aria-hidden className="stars absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="glow left-1/2 top-0 h-48 w-72 -translate-x-1/2 animate-breathe bg-iris-500/25"
        />

        <div className="relative">
          <span
            aria-hidden
            className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-iris-200/40 bg-gradient-to-br from-iris-400 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
              <path
                d="M5 12.5 10 17.5 19 7.5"
                fill="none"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>

          <h2 className="mt-6 font-display text-[1.5rem] font-bold">
            Shukriya — we have your details
          </h2>
          <p className="lede mx-auto mt-3 max-w-sm">
            Someone from the team will message you on WhatsApp within one
            working day to fix a time, and we will bring your own rate list to
            the call.
          </p>

          <button
            type="button"
            className="btn btn-ghost mt-8"
            onClick={() => window.location.reload()}
          >
            Send another request
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="panel relative overflow-hidden rounded-[24px] p-7 sm:p-10"
    >
      <div
        aria-hidden
        className="glow -right-16 -top-24 h-64 w-64 bg-iris-600/18"
      />

      <div className="relative grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            name="name"
            className="field"
            autoComplete="name"
            placeholder="Bilal Ahmed"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="business">
            Business name
          </label>
          <input
            id="business"
            name="business"
            className="field"
            autoComplete="organization"
            placeholder="Zaiqa Sweets & Bakers"
            required
          />
        </div>

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
            placeholder="you@shopname.pk"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Phone / WhatsApp
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            className="field"
            autoComplete="tel"
            placeholder="+92 300 1234567"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <select id="city" name="city" className="field" defaultValue={CITIES[1]}>
            {CITIES.map((city) => (
              <option key={city}>{city}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="size">
            How many branches and registers?
          </label>
          <select id="size" name="size" className="field" defaultValue={SIZES[0]}>
            {SIZES.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="type">
            What do you run?
          </label>
          <select id="type" name="type" className="field" defaultValue={TYPES[0]}>
            {TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            Anything we should know?{" "}
            <span className="font-normal text-mist-500">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            className="field resize-y"
            placeholder="What you bill on today — register, Excel, notebook — and what is not working about it."
          />
        </div>
      </div>

      <div className="relative mt-7 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        {state.error ? <p className="text-[0.75rem] text-flare-400">{state.error}</p> : null}
        <p className="text-[0.75rem] text-mist-500">
          No advance, no obligation. We reply within one working day.
        </p>
        <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto disabled:cursor-wait disabled:opacity-60">
          {pending ? "Sending..." : "Request a demo"}
        </button>
      </div>
    </form>
  );
}
