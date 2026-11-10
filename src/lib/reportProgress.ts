/**
 * Sparar checklistans avbockningar per rapport i localStorage.
 *
 * Lagringen är avsiktligt förlåtande: den får aldrig krascha rapporten. Saknas
 * localStorage (privat läge, äldre webbläsare, blockerad lagring) fungerar
 * rapporten precis som vanligt, men utan att komma ihåg läget mellan besök.
 */

const keyPrefix = "bilkopsrapport:checklista:";

function storage(): Storage | null {
  try {
    const candidate = window.localStorage;
    if (!candidate) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function loadCheckedItems(reportId: string): string[] {
  try {
    const raw = storage()?.getItem(keyPrefix + reportId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function saveCheckedItems(reportId: string, checkedIds: readonly string[]) {
  try {
    storage()?.setItem(keyPrefix + reportId, JSON.stringify(checkedIds));
  } catch {
    /* Full eller blockerad lagring: avbockningarna gäller bara den här sessionen. */
  }
}
