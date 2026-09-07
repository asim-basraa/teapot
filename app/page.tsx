import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teapot",
  description: "A knowledge garden with real access control. Coming soon.",
};

export default function ComingSoon() {
  return (
    <main className="soon">
      <div className="mark" aria-hidden="true">
        <svg viewBox="0 0 64 44" width="72" height="50" fill="none">
          <path
            d="M12 18h28a10 10 0 0 1 10 10v2a10 10 0 0 1-10 10H20A12 12 0 0 1 8 28v-6a4 4 0 0 1 4-4Z"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M50 22h3a5 5 0 0 1 0 10h-2"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M8 22 2 16M26 18l6-8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M22 8c0-3 4-3 4-6M32 8c0-3 4-3 4-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.45"
          />
        </svg>
      </div>

      <h1>Teapot</h1>
      <p className="tagline">A knowledge garden with real access control.</p>
      <p className="soon-note">Coming soon.</p>
    </main>
  );
}
