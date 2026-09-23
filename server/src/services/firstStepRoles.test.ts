import { describe, expect, it } from 'vitest';
import {
  displayFirstStepRole,
  isFirstStepStaffRole,
  staffRoleDisplayOverride,
} from './firstStepRoles';

describe('displayFirstStepRole', () => {
  it('maps Auth0 underscore roles to display labels', () => {
    expect(displayFirstStepRole('Application_Incharge')).toBe('Application Incharge');
    expect(displayFirstStepRole('Job_Collector')).toBe('Job Collector');
    expect(displayFirstStepRole('Super_Admin')).toBe('Super Admin');
    expect(displayFirstStepRole('user')).toBe('User');
  });

  it('accepts already-display forms', () => {
    expect(displayFirstStepRole('Application Incharge')).toBe('Application Incharge');
    expect(displayFirstStepRole('Job Collector')).toBe('Job Collector');
  });
});

describe('isFirstStepStaffRole', () => {
  it('detects AIC / JC / Super Admin', () => {
    expect(isFirstStepStaffRole('Application_Incharge')).toBe(true);
    expect(isFirstStepStaffRole('Job_Collector')).toBe(true);
    expect(isFirstStepStaffRole('Super_Admin')).toBe(true);
    expect(isFirstStepStaffRole('user')).toBe(false);
    expect(isFirstStepStaffRole(null)).toBe(false);
  });
});

describe('staffRoleDisplayOverride', () => {
  it('shows staff role instead of unknown plan', () => {
    expect(staffRoleDisplayOverride('unknown', 'Application_Incharge')).toBe(
      'Application Incharge'
    );
    expect(staffRoleDisplayOverride('Normal Plan', 'Job_Collector')).toBe('Job Collector');
    expect(staffRoleDisplayOverride(null, 'Super_Admin')).toBe('Super Admin');
  });

  it('does not override real customer plans for User role', () => {
    expect(staffRoleDisplayOverride('PremiumPlus', 'user')).toBeNull();
    expect(staffRoleDisplayOverride('unknown', 'user')).toBeNull();
  });
});
