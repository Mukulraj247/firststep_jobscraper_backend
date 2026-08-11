import { setServers as setDnsServers } from 'dns';

let appliedLogged = false;

/** Parse comma-separated DNS_SERVERS into a clean IP list. */
export function parseDnsServers(raw: string | undefined | null): string[] {
  if (raw == null || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply optional DNS_SERVERS override. Unset/empty → keep OS resolver (no setServers).
 * Returns the list applied, or null when using system DNS.
 */
export function applyConfiguredDnsServers(
  env: NodeJS.ProcessEnv = process.env
): string[] | null {
  const servers = parseDnsServers(env.DNS_SERVERS);
  if (servers.length === 0) {
    return null;
  }
  setDnsServers(servers);
  if (!appliedLogged) {
    appliedLogged = true;
    // Avoid importing Winston logger here (db.ts loads early); console is fine at boot.
    console.log(`DNS: using configured servers ${servers.join(', ')}`);
  }
  return servers;
}

/** Test-only: reset one-shot log guard. */
export function resetDnsConfigLogForTests(): void {
  appliedLogged = false;
}
