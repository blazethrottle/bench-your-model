// The full task bank and the two measurement depths.
import { CATEGORIES, BASE_TASKS } from './tasks.mjs';
import { HARD_TASKS } from './tasks-hard.mjs';
import { LONG_TASKS } from './tasks-long.mjs';
import { PROJECT_TASKS } from './tasks-project.mjs';

export { CATEGORIES };
export const TASKS = [...BASE_TASKS, ...HARD_TASKS, ...LONG_TASKS, ...PROJECT_TASKS].sort((a, b) => CATEGORIES.findIndex((c) => c.id === a.cat) - CATEGORIES.findIndex((c) => c.id === b.cat));

// Quick = one advanced task per category; full = every short task; long = the demanding tier only
// (multi-step work, hidden large inputs), which takes minutes per task and is kept out of the other two.
const QUICK_IDS = ['coding-4', 'debug-4', 'research-4', 'planning-4', 'repeat-4', 'reasoning-4', 'product-1', 'creative-3', 'visual-3'];
export function tasksFor(depth) {
  if (depth === 'long') return TASKS.filter((t) => t.long);
  if (depth === 'full') return TASKS.filter((t) => !t.long && !t.retired);
  return QUICK_IDS.map((id) => TASKS.find((t) => t.id === id));
}
