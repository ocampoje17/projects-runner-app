export function renamePathPrefix(paths: Iterable<string>, oldPath: string, newPath: string) {
  return new Set([...paths].map((path) => path === oldPath || path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path));
}

export function removePathPrefix(paths: Iterable<string>, removedPath: string) {
  return new Set([...paths].filter((path) => path !== removedPath && !path.startsWith(`${removedPath}/`)));
}
