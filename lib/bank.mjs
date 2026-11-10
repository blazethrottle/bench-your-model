// The full task bank and the two measurement depths.
import { CATEGORIES, BASE_TASKS } from './tasks.mjs';
import { HARD_TASKS } from './tasks-hard.mjs';

export { CATEGORIES };
export const TASKS = [...BASE_TASKS, ...HARD_TASKS].sort((a, b) => CATEGORIES.findIndex((c) => c.id === a.cat) - CATEGORIES.findIndex((c) => c.id === b.cat));

// Quick = the most demanding task of each category (so scores do not pile up at 100); full = everything.
const QUICK_IDS = ['coding-4', 'debug-4', 'research-4', 'planning-4', 'repeat-4', 'reasoning-4', 'product-1', 'creative-3', 'visual-3'];
export function tasksFor(depth) {
  return depth === 'full' ? TASKS : QUICK_IDS.map((id) => TASKS.find((t) => t.id === id));
}
