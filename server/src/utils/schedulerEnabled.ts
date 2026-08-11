/** Default true when unset so lone `npm run worker` still schedules. */
export function isSchedulerEnabled(): boolean {
  const flag = String(process.env.SCHEDULER_ENABLED ?? 'true').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no');
}
