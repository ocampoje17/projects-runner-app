export function orderOpenedItems<T extends { id: number }>(items: T[], openIds: number[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return openIds.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

export function partitionTerminalIds(
  ids: number[],
  isRunning: (id: number) => boolean,
) {
  const runningIds: number[] = [];
  const idleIds: number[] = [];
  ids.forEach((id) => (isRunning(id) ? runningIds : idleIds).push(id));
  return { runningIds, idleIds };
}

export function terminalCloseAction(isRunning: boolean, isStopping: boolean) {
  if (isStopping) return "ignore" as const;
  return isRunning ? "confirm-stop" as const : "close" as const;
}
