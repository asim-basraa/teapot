/**
 * The Post-it mark: a note with its corner turned down.
 *
 * Drawn rather than shipped as an image so it inherits the colour it sits in
 * and stays crisp at any size. One copy, because the landing page and the
 * header had no reason to hold two drawings of the same thing.
 *
 * Decorative everywhere it is used: the word "Post-it" is always beside it, so
 * announcing the drawing as well would say the name twice.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size * (44 / 48)}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 7h32v22L29 40H8Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* The turned corner, drawn as the two edges that face you. */}
      <path
        d="M40 29H29v11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M15.5 16.5h17M15.5 23.5h11"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
