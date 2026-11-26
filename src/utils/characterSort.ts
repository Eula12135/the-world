import type { Character } from '../types';

export type SortableCharacterFields = Pick<Character, 'pinned' | 'sortOrder' | 'updatedAt'>;

/**
 * 角色卡统一排序规则：
 * 1. 置顶角色（`pinned === true`）始终排在非置顶角色之前；
 * 2. 同一置顶分组内，若设置了有限数值 `sortOrder`，按 `sortOrder` 升序排列（已排过序的优先于未设置 `sortOrder` 的新卡？
 *    注：新创建的卡片若未手动拖拽排序，排在已有手动排序卡片之前还是之后？
 *    为了让用户手动排好的队形不被改了资料的旧卡打乱，有 `sortOrder` 的按顺序排，无 `sortOrder` 的排在同组末尾并按 `updatedAt` 降序）；
 * 3. 都未设置 `sortOrder`（或相等）时，按 `updatedAt` 降序。
 */
export function compareCharacters<T extends SortableCharacterFields>(a: T, b: T): number {
  const aPinned = Boolean(a.pinned);
  const bPinned = Boolean(b.pinned);
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  const aOrder =
    typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder) ? a.sortOrder : null;
  const bOrder =
    typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder) ? b.sortOrder : null;

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  if (aOrder !== null && bOrder === null) return -1;
  if (aOrder === null && bOrder !== null) return 1;

  return b.updatedAt - a.updatedAt;
}

export function sortCharacters<T extends SortableCharacterFields>(list: readonly T[]): T[] {
  return [...list].sort(compareCharacters);
}

/**
 * 在同一置顶分组（同为置顶，或同为未置顶）内移动角色卡片顺序。
 * 跨置顶分组拖拽返回 null，避免拖拽意外改变置顶状态。
 */
export function reorderWithinPinGroup<T extends { id: string; pinned?: boolean }>(
  list: readonly T[],
  draggedId: string,
  overId: string
): T[] | null {
  if (draggedId === overId) return null;
  const fromIdx = list.findIndex((item) => item.id === draggedId);
  const toIdx = list.findIndex((item) => item.id === overId);
  if (fromIdx === -1 || toIdx === -1) return null;
  if (Boolean(list[fromIdx].pinned) !== Boolean(list[toIdx].pinned)) return null;

  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}
