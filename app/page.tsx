import Link from "next/link";
import type { Metadata } from "next";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = {
  title: "Post-it",
  description: "A knowledge garden with real access control.",
};

export default function Landing() {
  return (
    <main className="soon">
      <div className="mark">
        <Mark size={72} />
      </div>

      <h1>Post-it</h1>
      <p className="tagline">A knowledge garden with real access control.</p>
      <p className="soon-signin">
        <Link href="/docs">Read the documentation</Link>
        <span aria-hidden="true">·</span>
        <Link href="/login">Sign in</Link>
      </p>

    </main>
  );
}
