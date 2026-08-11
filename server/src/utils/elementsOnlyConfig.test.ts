import { describe, expect, it } from 'vitest';

/**
 * Mirrors PUT /automations/:id/config elementsOnly merge rules used by the API.
 */
function applyElementsOnly(
  prevSaas: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const next = { ...prevSaas };
  if (Object.prototype.hasOwnProperty.call(incoming, 'listExtraction')) {
    next.listExtraction = incoming.listExtraction;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'previewRows')) {
    next.previewRows = incoming.previewRows;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'previewUrl')) {
    next.previewUrl = incoming.previewUrl;
  }
  return next;
}

describe('elementsOnly config merge', () => {
  it('replaces listExtraction and keeps schedule/rowContext/name-side fields', () => {
    const prev = {
      listExtraction: { itemSelector: '.old', fields: { title: 'h1' } },
      schedule: { enabled: true, cron: '*/30 * * * *', timezone: 'UTC' },
      rowContext: { sectorIndustry: 'Tech', f500: 'yes' },
      webhookUrl: 'https://hooks.example/x',
      previewRows: [{ title: 'a' }],
    };
    const next = applyElementsOnly(prev, {
      listExtraction: { itemSelector: '.new', fields: { title: 'h2' } },
      schedule: { enabled: false, cron: null, timezone: 'UTC' },
      rowContext: { sectorIndustry: 'Other', f500: 'no' },
      webhookUrl: 'https://hooks.example/y',
    });

    expect(next.listExtraction).toEqual({ itemSelector: '.new', fields: { title: 'h2' } });
    expect(next.schedule).toEqual(prev.schedule);
    expect(next.rowContext).toEqual(prev.rowContext);
    expect(next.webhookUrl).toBe('https://hooks.example/x');
  });
});
