import seedData from './boxmadnessWorldCup2026.json';

export const TEAM = seedData.team;

const createdAt = Date.parse('2026-06-02T08:00:00Z');
const createdBy = 'system@boxmadness.com';

export function buildSeedTasks() {
  return seedData.tasks.map((task) => ({
    ...task,
    done: false,
    calEventId: null,
    createdAt,
    createdBy,
  }));
}
