import { describe, expect, it } from 'vitest';
import {
  clusterAliasRedirectTarget,
  clusterDetailPath,
  clusterNewPath,
  isClusterStudioPath,
} from './clusterStudioRoutes';

describe('clusterStudioRoutes', () => {
  it('treats list and detail under /clusters as studio paths', () => {
    expect(isClusterStudioPath('/clusters')).toBe(true);
    expect(isClusterStudioPath('/clusters/new')).toBe(true);
    expect(isClusterStudioPath('/clusters/abc123')).toBe(true);
    expect(isClusterStudioPath('/cluster/abc')).toBe(false);
    expect(isClusterStudioPath('/dashboard')).toBe(false);
  });

  it('builds detail and new paths', () => {
    expect(clusterDetailPath('abc')).toBe('/clusters/abc');
    expect(clusterNewPath()).toBe('/clusters/new');
    expect(clusterAliasRedirectTarget('x')).toBe('/clusters/x');
  });
});
