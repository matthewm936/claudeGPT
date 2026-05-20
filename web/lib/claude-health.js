/**
 * Claude CLI health check — detect installation and auth status.
 */

import { execFile } from 'child_process';

function run(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Check if Claude CLI is installed and authenticated.
 * Returns { installed, version, authenticated, email, subscription }.
 */
export async function checkHealth() {
  const result = { installed: false, version: null, authenticated: false, email: null, subscription: null };

  // Check if claude exists
  const which = await run('which', ['claude'], 3000);
  if (!which) return result;
  result.installed = true;

  // Get version
  const version = await run('claude', ['--version'], 5000);
  if (version) result.version = version;

  // Check auth status
  const status = await run('claude', ['auth', 'status'], 5000);
  if (status) {
    try {
      const parsed = JSON.parse(status);
      result.authenticated = !!parsed.loggedIn;
      result.email = parsed.email || null;
      result.subscription = parsed.subscriptionType || null;
    } catch {}
  }

  return result;
}

/**
 * Trigger Claude OAuth login — opens browser automatically.
 * Non-blocking, returns immediately.
 */
export function triggerLogin() {
  const proc = execFile('claude', ['auth', 'login', '--claudeai'], { timeout: 120000 }, () => {});
  proc.unref();
}
