import { describe, it, expect } from 'vitest';
import { findConflicts, hasBlockingConflict } from '@/lib/gameslate/schedule-conflicts';

// The audit found that gutting findConflicts to return nothing still left the
// suite green: the only assertion checked that the error list was empty, which
// is trivially true when the detector reports nothing at all. These tests
// assert the detector actually FINDS things, so a regression that silently
// disables it cannot pass.
const g = (o: Partial<any>) => ({
  date: '2026-04-07', time: '17:30', field: 'Field 1',
  away_team_id: 'Alpha', home_team_id: 'Bravo', division: '10U', ...o
});
const kinds = (c: any[]) => c.map((x) => x.kind).sort();

describe('the conflict detector actually detects', () => {
  it('catches one team booked twice at the same time', () => {
    const c = findConflicts([g({}), g({ field: 'Field 2', away_team_id: 'Alpha', home_team_id: 'Charlie' })], { gameMinutes: 90 });
    expect(kinds(c)).toContain('team_double_booked');
    expect(hasBlockingConflict(c)).toBe(true);
  });

  it('catches two games on one field at the same time', () => {
    const c = findConflicts([g({}), g({ away_team_id: 'Charlie', home_team_id: 'Delta' })], { gameMinutes: 90 });
    expect(kinds(c)).toContain('field_double_booked');
    expect(hasBlockingConflict(c)).toBe(true);
  });

  it('catches games that overlap rather than start together', () => {
    const c = findConflicts([g({ time: '17:30' }), g({ time: '18:00', away_team_id: 'Charlie', home_team_id: 'Delta' })], { gameMinutes: 90 });
    expect(kinds(c)).toContain('field_double_booked');
  });

  it('lets a clean schedule through', () => {
    const c = findConflicts([g({}), g({ time: '19:30', away_team_id: 'Charlie', home_team_id: 'Delta' })], { gameMinutes: 90 });
    expect(c.filter((x) => x.severity === 'error')).toEqual([]);
    expect(hasBlockingConflict(c)).toBe(false);
  });

  // Documented as: shares a field and date with another game but has no start
  // time, so an overlap can be neither confirmed nor ruled out.
  it('flags a game with no time that shares a field with another', () => {
    const c = findConflicts([g({ time: '' }), g({ away_team_id: 'Charlie', home_team_id: 'Delta' })], { gameMinutes: 90 });
    expect(kinds(c)).toContain('missing_time');
  });

  it('does not invent a conflict for a lone game with no time', () => {
    expect(findConflicts([g({ time: '' })], { gameMinutes: 90 })).toEqual([]);
  });

  it('names the teams and the slot it is complaining about', () => {
    const c = findConflicts([g({}), g({ field: 'Field 2', home_team_id: 'Charlie' })], { gameMinutes: 90 });
    const hit = c.find((x) => x.kind === 'team_double_booked');
    expect(hit).toBeTruthy();
    expect(hit!.teamIds).toContain('Alpha');
    expect(hit!.date).toBe('2026-04-07');
    expect(hit!.gameIndexes.length).toBeGreaterThan(1);
  });
});
