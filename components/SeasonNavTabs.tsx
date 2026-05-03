// "SCORES | SCHEDULE" tab nav, used at the top of both pages.
// Active tab gets an underline.

import Link from "next/link";

export function SeasonNavTabs({ active }: { active: "scores" | "schedule" }) {
  return (
    <nav className="mb-6 flex gap-8 border-b border-slate-200">
      <Tab href="/scores" label="Scores" active={active === "scores"} />
      <Tab href="/schedule" label="Schedule" active={active === "schedule"} />
    </nav>
  );
}

function Tab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "font-display border-b-2 pb-2 text-2xl tracking-wide " +
        (active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-400 hover:text-slate-700")
      }
    >
      {label}
    </Link>
  );
}
