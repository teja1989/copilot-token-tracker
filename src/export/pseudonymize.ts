import { createHmac, randomBytes } from 'node:crypto';

/**
 * Pseudonymizes a real identity (git user.email, OS username, whatever the caller
 * decides to feed in — this module has no opinion on that) into a stable, non-reversible
 * id, per the identity model documented in docs/mongo-team-rollup.md.
 *
 * This is a KEYED hash (HMAC), not a bare SHA-256 of the identity. A bare hash of an
 * email address is trivially reversible by dictionary attack — anyone with a list of
 * the org's email addresses (which is to say, anyone) could recompute the hash for every
 * candidate and match it straight back to a person. HMAC with a secret salt closes that:
 * without the salt, the output can't be matched against candidate inputs at all.
 *
 * For the pseudonym to mean anything across machines (so the same person's usage trends
 * together rather than fragmenting per-install), every machine in the org must use the
 * SAME salt — an org-wide secret, not a per-install one. See resolveSalt() below for what
 * happens when no such salt has been configured yet.
 */
export function pseudonymizeIdentity(rawIdentity: string, salt: string): string {
  const digest = createHmac('sha256', salt).update(rawIdentity).digest('hex');
  return `u_${digest.slice(0, 16)}`;
}

export interface SaltResolution {
  salt: string;
  /**
   * false when an org-wide salt was actually configured (`orgSalt` was non-empty).
   * true means we fell back to a random, install-local salt — pseudonyms will be
   * STABLE for this person on THIS machine, but a different random salt on another
   * machine means the same person looks like two different people across machines.
   * Cross-machine trend/leaderboard queries need this to be false org-wide.
   */
  isInstallLocalFallback: boolean;
}

/**
 * Resolves the salt to use: the org-configured one if present, else a random one that
 * the caller is responsible for persisting (e.g. in extension globalState) so it's at
 * least STABLE for this one installation across restarts, even though it won't match
 * other machines. Generating a fresh salt every call would make even single-machine
 * trends impossible, which is strictly worse than the already-degraded cross-machine
 * case, so callers must persist whatever fallback salt this returns.
 */
export function resolveSalt(orgSalt: string | undefined | null): SaltResolution {
  if (orgSalt && orgSalt.trim() !== '') {
    return { salt: orgSalt, isInstallLocalFallback: false };
  }
  return { salt: randomBytes(32).toString('hex'), isInstallLocalFallback: true };
}
