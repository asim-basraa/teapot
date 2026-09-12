import { person } from "@/lib/people";

/**
 * Somebody's name, as short as it can be said.
 *
 * The badge is an <abbr> rather than a styled span because that is what it is:
 * two letters standing in for a name. It earns the tooltip for free.
 *
 * It is hidden from a screen reader, and the name is given alongside it in
 * every case, because "F A" read out is worse than nothing: initials are a
 * shorthand for the eye, and the ear has no trouble with the whole name.
 */
export function Who({ who, named = false }: { who: string; named?: boolean }) {
  const { label, initials, full } = person(who);

  if (!initials) return <>{label}</>;

  return (
    <>
      <abbr className="who-badge" title={`${label} · ${full}`} aria-hidden="true">
        {initials}
      </abbr>
      <span className={named ? "who-name" : "visually-hidden"}>{label}</span>
    </>
  );
}
