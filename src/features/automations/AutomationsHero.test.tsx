import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { AutomationsHero } from './AutomationsHero';

const defaultProps = {
  totalCount: 12,
  dataUpdatedAt: Date.parse('2026-08-18T10:00:00.000Z'),
  nowMs: Date.parse('2026-08-18T10:02:00.000Z'),
  isRefreshing: false,
  isLoading: false,
  hasBackgroundUpdates: false,
  activeScheduledCount: 0,
  pausedScheduleCount: 0,
  onRefresh: vi.fn(),
  onPauseAll: vi.fn(),
  onResumeAll: vi.fn(),
  onNewAutomation: vi.fn(),
};

describe('AutomationsHero', () => {
  it('renders the hero title and primary actions', () => {
    render(<AutomationsHero {...defaultProps} />);

    expect(screen.getByText('Automations')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'New automation' })).toBeVisible();
    expect(screen.getByText(/12 automations · updated 2m ago/i)).toBeVisible();
  });

  it('invokes refresh and new-automation handlers from accessible controls', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onNewAutomation = vi.fn();

    render(
      <AutomationsHero
        {...defaultProps}
        onRefresh={onRefresh}
        onNewAutomation={onNewAutomation}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'New automation' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onNewAutomation).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations in the static hero layout', async () => {
    const { container } = render(<AutomationsHero {...defaultProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
