import { describe, expect, it } from 'vitest';
import Cluster from './Cluster';
import ClusterSubscription from './ClusterSubscription';
import SavedJob from './SavedJob';
import ClusterRequest from './ClusterRequest';

describe('cluster engine models', () => {
  it('registers Cluster collection and required paths', () => {
    expect(Cluster.collection.name).toBe('scoutx_clusters');
    const paths = Cluster.schema.paths;
    expect(paths.slug).toBeTruthy();
    expect(paths.filter).toBeTruthy();
    expect(paths.sourceBinding).toBeTruthy();
    expect(paths.status).toBeTruthy();
  });

  it('registers unique auth0Sub+clusterId on subscriptions', () => {
    expect(ClusterSubscription.collection.name).toBe('scoutx_cluster_subscriptions');
    const indexes = ClusterSubscription.schema.indexes();
    const hasUnique = indexes.some(
      ([fields, opts]) =>
        (fields as Record<string, number>).auth0Sub === 1 &&
        (fields as Record<string, number>).clusterId === 1 &&
        (opts as { unique?: boolean })?.unique === true
    );
    expect(hasUnique).toBe(true);
  });

  it('registers unique auth0Sub+jobUrlKey on saved jobs', () => {
    expect(SavedJob.collection.name).toBe('scoutx_saved_jobs');
    const indexes = SavedJob.schema.indexes();
    const hasUnique = indexes.some(
      ([fields, opts]) =>
        (fields as Record<string, number>).auth0Sub === 1 &&
        (fields as Record<string, number>).jobUrlKey === 1 &&
        (opts as { unique?: boolean })?.unique === true
    );
    expect(hasUnique).toBe(true);
  });

  it('registers ClusterRequest with type and status enums', () => {
    expect(ClusterRequest.collection.name).toBe('scoutx_cluster_requests');
    const typeEnum = (ClusterRequest.schema.path('type') as any).enumValues;
    const statusEnum = (ClusterRequest.schema.path('status') as any).enumValues;
    expect(typeEnum).toContain('predefined');
    expect(typeEnum).toContain('custom_urls');
    expect(statusEnum).toContain('submitted');
    expect(statusEnum).toContain('published');
  });
});
