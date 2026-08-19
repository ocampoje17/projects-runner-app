export function renamePathPrefix(paths: Iterable<string>, oldPath: string, newPath: string) {
  return new Set([...paths].map((path) => path === oldPath || path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path));
}

export function removePathPrefix(paths: Iterable<string>, removedPath: string) {
  return new Set([...paths].filter((path) => path !== removedPath && !path.startsWith(`${removedPath}/`)));
}

export function normalizeProjectRelativePath(inputPath: string, projectRoot?: string): string {
  let normalized = inputPath.trim().replace(/\\/g, "/");
  if (projectRoot) {
    let normalizedRoot = projectRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedRoot && normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
      normalized = normalized.slice(normalizedRoot.length);
    }
  }
  normalized = normalized.replace(/^(\.\/|\/)+/, "");
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}
