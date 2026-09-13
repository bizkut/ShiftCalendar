const exactKeys = new Set([
  'calendars_list', 'active_calendar', 'all_shifts_v2', 'custom_shifts',
  'theme_mode', 'week_start', 'base_rate', 'overtime_rate', 'notif_enabled',
  'notif_hour', 'currency_code', 'onboarding_complete', 'schema_version',
  'pre_shift_alarm',
]);
const calendarPrefixes = [
  'shift_data_', 'shift_notes_', 'shift_overtime_', 'shift_swaps_',
  'leave_data_', 'leave_balances_',
];

// Both device backups and local resets must preserve all authentication/cloud state.
export function isAllowedLocalKey(key: string): boolean {
  return exactKeys.has(key) || calendarPrefixes.some(prefix => key.startsWith(prefix));
}
