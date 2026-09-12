/**
 * Turning an address into something you would rather look at.
 *
 * The inbox knows people by the only thing it has: the address they signed up
 * with. That is the right key and the wrong label. A list of full addresses is
 * a wall of maqsoodlabs.com repeated down the page, with the part that actually
 * distinguishes one row from another buried in the middle of it.
 *
 * So an address is shown as initials, with the name it implies underneath the
 * pointer and read out to a screen reader. Nothing is invented: both are read
 * off the local part, so this is the same fact, shorter.
 */

export type Person = {
  /** A name to read: "Faryal Awais", or the original if it is not an address. */
  label: string;
  /** Two letters for a badge, or null when there is no address to shorten. */
  initials: string | null;
  /** What was actually stored, kept for the tooltip. */
  full: string;
};

/** Deliberately strict: "Post-it" and "Anonymous" are labels, not addresses. */
const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The part of an address before the @.
 *
 * For your own address in the header, where the domain is the same for
 * everybody who works here and so distinguishes nothing, while taking the room
 * that the part which does distinguish you needs. The whole address stays on
 * the link's tooltip, because "which account am I signed in as" is a question
 * this product's users ask constantly and it must stay answerable.
 */
export function handle(who: string): string {
  const trimmed = who.trim();
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

export function person(who: string): Person {
  const trimmed = who.trim();

  if (!ADDRESS.test(trimmed)) {
    return { label: trimmed, initials: null, full: trimmed };
  }

  // Everything after + is a tag the person added to route their own mail, and
  // everything after @ is where they work. Neither is their name.
  const local = trimmed.split("@")[0].split("+")[0];
  const words = local.split(/[^a-z]+/i).filter(Boolean);

  // An address with no letters in it at all. Rare, and better shown whole than
  // shown as an empty circle.
  if (words.length === 0) {
    return { label: trimmed, initials: null, full: trimmed };
  }

  const first = words[0];
  const last = words[words.length - 1];

  return {
    label: words.map(capitalise).join(" "),
    // One word gives up its first two letters rather than one, so every badge
    // is the same width and "A" never has to stand for somebody on its own.
    initials: (
      words.length > 1 ? first[0] + last[0] : first.slice(0, 2)
    ).toUpperCase(),
    full: trimmed,
  };
}

function capitalise(word: string): string {
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}
