import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <Link href="/" className="auth-brand">
        Teapot
      </Link>
      <div className="auth-card">{children}</div>
    </main>
  );
}
