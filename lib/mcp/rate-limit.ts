/**
 * In-process rate limiting for the MCP endpoint.
 *
 * A token is a long-lived credential sitting on the open internet, so two
 * things need bounding: how fast a valid token may be used, and how fast an
 * invalid one may be guessed. The second matters more. Guessing is hopeless
 * against 256 bits of entropy, but throttling failures means an attacker
 * cannot even use the endpoint as an oracle at speed, and it keeps a
 * misconfigured client from hammering the database.
 *
 * Deliberately in memory rather than in Postgres. A limiter that writes a row
 * per request turns cheap traffic into database load, which is the thing it is
 * meant to prevent. The cost is that limits are per instance: with several
 * instances the effective ceiling is higher. That is an acceptable trade for a
 * throttle, and a poor one for anything that must be exact, which this is not.
 */

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;

/** Requests a valid token may make in a window. Generous: this is a throttle. */
export const VALID_LIMIT = 120;

/**
 * Failures one address may cause in a window. Tight, which it can only afford
 * to be because it counts failures and nothing else: a client that keeps
 * presenting a token that works is never in this bucket at all.
 */
export const FAILURE_LIMIT = 20;

const buckets = new Map<string, Bucket>();

export function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    sweep(now);
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

export function allowToken(tokenId: string): boolean {
  return allow(`token:${tokenId}`, VALID_LIMIT);
}

/**
 * Whether this address has already spent its failures.
 *
 * Asked before the token is looked up and without counting anything, so a
 * flood of guesses cannot be turned into a flood of database round trips,
 * while a client whose token is good never touches this bucket.
 *
 * Counting every request here instead, which is what this used to do, meant
 * twenty requests a minute from one address and then refusals: enough for a
 * person clicking about, nowhere near enough for the thing this endpoint
 * exists to serve, which is a client filing a folder of documents.
 */
export function failuresSpent(address: string): boolean {
  const bucket = buckets.get(`fail:${address}`);
  return (
    bucket !== undefined &&
    bucket.resetAt > Date.now() &&
    bucket.count >= FAILURE_LIMIT
  );
}

/** Counts one. Called only where a token has actually been refused. */
export function recordFailure(address: string): void {
  allow(`fail:${address}`, FAILURE_LIMIT);
}

/**
 * Drops expired buckets.
 *
 * Without this the map grows once per distinct address forever, which is a slow
 * memory leak an attacker can drive. Swept on write rather than on a timer, so
 * an idle process does no work.
 */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** The caller's address, as well as it can be known behind a proxy. */
export function callerAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Test seam: the limiter is process-global, and a suite needs a clean slate. */
export function reset(): void {
  buckets.clear();
}
