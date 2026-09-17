import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function defaultGitEmailReader(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['config', '--global', 'user.email']);
  return stdout;
}

/**
 * The raw (pre-pseudonymization — see pseudonymize.ts) identity fed into the hash.
 * Prefers git's configured user.email since that's the identity most likely to be
 * stable and meaningful across a person's machines; falls back to the OS username when
 * git isn't installed or has no global email configured, which is still enough to keep
 * a single machine's trends consistent even if it won't match across machines.
 *
 * `gitEmailReader` is injectable for testing without actually shelling out to git.
 */
export async function resolveRawIdentity(gitEmailReader: () => Promise<string> = defaultGitEmailReader): Promise<string> {
  try {
    const email = (await gitEmailReader()).trim();
    if (email) return email;
  } catch {
    // git not installed, or no global user.email configured — fall through to OS username.
  }
  return userInfo().username;
}
