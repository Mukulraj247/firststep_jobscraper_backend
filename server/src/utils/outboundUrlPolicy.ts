import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export const MAX_OUTBOUND_REDIRECTS = 5;

export class UnsafeOutboundUrlError extends Error {
  readonly code = 'UNSAFE_OUTBOUND_URL';

  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

export interface SafeOutboundTarget {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
}

const blockedHostnames = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data',
  'instance-data.ec2.internal',
]);

const unsafe = (message: string): never => {
  throw new UnsafeOutboundUrlError(message);
};

const parseIpv4 = (address: string): number[] | null => {
  if (isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : null;
};

const ipv4InCidr = (octets: number[], base: number[], prefix: number): boolean => {
  const value =
    (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  const network =
    (((base[0] << 24) >>> 0) + (base[1] << 16) + (base[2] << 8) + base[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
};

const blockedIpv4Ranges: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const isUnsafeIpv4 = (address: string): boolean => {
  const octets = parseIpv4(address);
  return !!octets && blockedIpv4Ranges.some(([base, prefix]) => ipv4InCidr(octets, base, prefix));
};

const parseIpv6 = (address: string): number[] | null => {
  let value = address.toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  if (isIP(value) !== 6) return null;

  const ipv4Match = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const octets = parseIpv4(ipv4Match[1]);
    if (!octets) return null;
    value = value.replace(
      ipv4Match[1],
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
    );
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right].map((part) => parseInt(part, 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isFinite(group) || group < 0 || group > 0xffff)) {
    return null;
  }
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
};

const ipv6PrefixMatches = (bytes: number[], base: number[], prefix: number): boolean => {
  const wholeBytes = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== base[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (base[wholeBytes] & mask);
};

const ipv6Base = (address: string): number[] => parseIpv6(address) as number[];

const blockedIpv6Ranges: Array<[number[], number]> = [
  [ipv6Base('::'), 8],
  [ipv6Base('64:ff9b::'), 96],
  [ipv6Base('64:ff9b:1::'), 48],
  [ipv6Base('100::'), 64],
  [ipv6Base('2001::'), 23],
  [ipv6Base('2001:2::'), 48],
  [ipv6Base('2001:10::'), 28],
  [ipv6Base('2001:20::'), 28],
  [ipv6Base('2001:db8::'), 32],
  [ipv6Base('2002::'), 16],
  [ipv6Base('3fff::'), 20],
  [ipv6Base('5f00::'), 16],
  [ipv6Base('fc00::'), 7],
  [ipv6Base('fe80::'), 10],
  [ipv6Base('fec0::'), 10],
  [ipv6Base('ff00::'), 8],
];

const isUnsafeIpv6 = (address: string): boolean => {
  const bytes = parseIpv6(address);
  if (!bytes) return false;

  const mappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (mappedIpv4) {
    return isUnsafeIpv4(bytes.slice(12).join('.'));
  }

  return blockedIpv6Ranges.some(([base, prefix]) => ipv6PrefixMatches(bytes, base, prefix));
};

const isUnsafeIp = (address: string): boolean => {
  const version = isIP(address.replace(/^\[|\]$/g, ''));
  if (version === 4) return isUnsafeIpv4(address);
  if (version === 6) return isUnsafeIpv6(address);
  return true;
};

const normalizeHostname = (hostname: string): string =>
  hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

const assertSafeHostname = (hostname: string): void => {
  const normalized = normalizeHostname(hostname);
  if (
    blockedHostnames.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    unsafe('Outbound URL uses a blocked hostname');
  }
  if (isIP(normalized) && isUnsafeIp(normalized)) {
    unsafe('Outbound URL points to a blocked network address');
  }
};

export async function resolveSafeOutboundUrl(
  rawUrl: string,
  options?: { resolveDns?: boolean }
): Promise<SafeOutboundTarget> {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return unsafe('Outbound URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return unsafe('Outbound URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    return unsafe('Outbound URL must not contain embedded credentials');
  }
  if (!parsed.hostname) {
    return unsafe('Outbound URL must include a hostname');
  }

  assertSafeHostname(parsed.hostname);

  const hostname = normalizeHostname(parsed.hostname);
  let addresses: Array<{ address: string; family: number }> = [];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  } else if (options?.resolveDns !== false) {
    let answers: Array<{ address: string; family: number }>;
    try {
      answers = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      return unsafe('Outbound URL hostname could not be resolved');
    }
    if (answers.length === 0) {
      return unsafe('Outbound URL hostname could not be resolved');
    }
    if (answers.some((record) => isUnsafeIp(record.address))) {
      return unsafe('Outbound URL resolves to a blocked network address');
    }
    addresses = answers;
  }

  return { url: parsed, addresses };
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options?: { resolveDns?: boolean }
): Promise<URL> {
  return (await resolveSafeOutboundUrl(rawUrl, options)).url;
}

export function createUnsafeOutboundUrlResponse(
  field: string,
  error: UnsafeOutboundUrlError
): {
  status: 400;
  body: { code: 'UNSAFE_OUTBOUND_URL'; field: string; error: string };
} {
  return {
    status: 400,
    body: {
      code: 'UNSAFE_OUTBOUND_URL',
      field,
      error: error.message,
    },
  };
}

export const isUnsafeOutboundUrlError = (error: unknown): error is UnsafeOutboundUrlError =>
  error instanceof UnsafeOutboundUrlError ||
  (error instanceof Error && (error as UnsafeOutboundUrlError).code === 'UNSAFE_OUTBOUND_URL');

export const safeOutboundUrlLogLabel = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'invalid outbound URL';
  }
};
