import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "@/components/Mark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <Link href="/" className="auth-brand">
        <Mark size={24} />
        Post-it
      </Link>
      <div className="auth-card">{children}</div>
    </main>
  );
}
