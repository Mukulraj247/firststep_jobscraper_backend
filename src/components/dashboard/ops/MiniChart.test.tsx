import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MiniChart } from './MiniChart';

const samplePoints = [
  { t: Date.parse('2026-08-18T09:00:00.000Z'), v: 2 },
  { t: Date.parse('2026-08-18T09:15:00.000Z'), v: 5 },
  { t: Date.parse('2026-08-18T09:30:00.000Z'), v: 3 },
  { t: Date.parse('2026-08-18T09:45:00.000Z'), v: 8 },
];

describe('MiniChart', () => {
  it('renders axis labels and tick captions for chart data', () => {
    const { container } = render(
      <MiniChart
        title="Failed"
        valueLabel="3"
        points={samplePoints}
        yAxisLabel="Failed runs"
        xAxisLabel="Time bucket"
      />,
    );

    expect(screen.getByText('Failed runs · Time bucket')).toBeVisible();
    expect(screen.getByLabelText(/Failed runs from 0 to/i)).toBeInTheDocument();
    expect(container.querySelectorAll('svg text[font-size="8"]').length).toBeGreaterThanOrEqual(2);
  });

  it('shows waiting state copy when there are no points', () => {
    render(
      <MiniChart
        title="CPU %"
        valueLabel="—"
        points={[]}
        yAxisLabel="CPU %"
        xAxisLabel="Time"
      />,
    );

    expect(screen.getByText('Waiting for data…')).toBeVisible();
    expect(screen.getByText('CPU % · Time')).toBeVisible();
  });
});
