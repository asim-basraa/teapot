/**
 * What a page looks like while it is being fetched.
 *
 * Deliberately not a skeleton of the eventual layout. A skeleton promises a
 * shape, and these pages do not have one until the answer comes back: a space
 * might be a wall of prose or a single line. This says the true thing, which is
 * that something is on its way.
 */
export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <div className="loading" role="status">
      <span className="link-spinner" aria-hidden="true" />
      <span>{what}…</span>
    </div>
  );
}
