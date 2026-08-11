import { describe, expect, it } from 'vitest';
import { parseDnsServers } from './dnsConfig';

describe('parseDnsServers', () => {
  it('returns empty for undefined or blank', () => {
    expect(parseDnsServers(undefined)).toEqual([]);
    expect(parseDnsServers(null)).toEqual([]);
    expect(parseDnsServers('')).toEqual([]);
    expect(parseDnsServers('   ')).toEqual([]);
  });

  it('splits comma-separated IPs and trims', () => {
    expect(parseDnsServers('8.8.8.8, 1.1.1.1')).toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('drops empty segments from trailing commas', () => {
    expect(parseDnsServers('8.8.8.8,,1.1.1.1,')).toEqual(['8.8.8.8', '1.1.1.1']);
  });
});
