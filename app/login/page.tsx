import type { Metadata } from "next";
import Link from "next/link";

import { FloMark } from "@/components/site/flo-mark";
import { Starfield } from "@/components/site/starfield";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your Flo back office.",
};

const entrance = (delay: number) => ({
  animation: `fade-up 1s var(--ease-out-soft) ${delay}ms both`,
});

export default function LoginPage() {
  return (
    <section className="relative isolate flex min-h-[calc(100vh-4rem)] items-center overflow-hidden py-28 sm:py-32">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_0%,#12132b_0%,#08080f_50%,#04040a_100%)]" />
        <Starfield className="absolute inset-0 h-full w-full" />
        <div className="glow left-1/2 top-[12%] h-72 w-[34rem] -translate-x-1/2 animate-breathe bg-iris-600/22" />
      </div>

      <div className="shell">
        <div className="mx-auto w-full max-w-[26rem]">
          <div className="text-center" style={entrance(60)}>
            <FloMark className="mx-auto h-10 w-10" />
            <h1 className="mt-5 font-display text-[1.75rem] font-bold">
              Welcome back
            </h1>
            <p className="lede mt-2 text-[0.9375rem]">
              Sign in to your Flo back office.
            </p>
          </div>

          <div
            className="panel rim relative mt-8 overflow-hidden rounded-[24px] p-7 sm:p-8"
            style={entrance(200)}
          >
            <div
              aria-hidden
              className="glow -right-14 -top-20 h-52 w-52 bg-iris-600/18"
            />
            <div className="relative">
              <LoginForm />
            </div>
          </div>

          <p
            className="mt-6 text-center text-[0.8125rem] text-mist-400"
            style={entrance(320)}
          >
            No account yet?{" "}
            <Link
              href="/demo"
              className="font-medium text-iris-300 transition-colors duration-300 hover:text-iris-200"
            >
              Book a demo
            </Link>{" "}
            or{" "}
            <Link
              href="/pricing"
              className="font-medium text-iris-300 transition-colors duration-300 hover:text-iris-200"
            >
              compare the two plans
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
