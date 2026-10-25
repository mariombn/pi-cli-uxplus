import { readdir, realpath, lstat, open, rename, rm } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, sep, isAbsolute } from 'node:path';

export const sanitize = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
export type FileItem = { path: string; name: string; directory: boolean; link: boolean; depth: number };
const ignored = new Set(['.git', 'node_modules', '.venv', '__pycache__']);
export function sortFiles(items: FileItem[]) {
  return items.sort((a, b) => Number(b.directory) - Number(a.directory)
    || (!a.directory && !b.directory ? extname(a.name).localeCompare(extname(b.name)) : 0)
    || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
export function inside(root: string, path: string) {
  const rel = relative(root, resolve(path));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
// Validate parents by real path too: never traverse a symlink outside the workspace.
// The final symlink itself may be renamed/deleted, without touching its target.
export async function safePath(root: string, path: string) {
  root = await realpath(root);
  path = resolve(path);
  if (!inside(root, path) || path === root) throw new Error('Operação fora da raiz ou na própria raiz não permitida.');
  if (!inside(root, await realpath(dirname(path)))) throw new Error('Diretório pai fora da raiz.');
  return path;
}
export async function children(root: string, path: string, hidden: boolean, depth = 0): Promise<FileItem[]> {
  const actual = await realpath(path);
  if (!inside(root, actual)) throw new Error('Pasta fora da raiz.');
  const entries = await readdir(path, { withFileTypes: true });
  return sortFiles(entries.filter(e => !ignored.has(e.name) && (hidden || !e.name.startsWith('.'))).map(e => ({
    path: resolve(path, e.name), name: e.name, directory: e.isDirectory(), link: e.isSymbolicLink(), depth,
  })));
}
export async function tree(root: string, expanded: Set<string>, hidden: boolean, query = '') {
  const results: FileItem[] = [];
  let visited = 0;
  let limited = false;
  async function walk(path: string, depth: number) {
    if (++visited > 1500 || results.length >= 3000 || depth > 24) { limited = true; return; }
    for (const item of await children(root, path, hidden, depth)) {
      if (results.length >= 3000) { limited = true; break; }
      if (!query || relative(root, item.path).toLocaleLowerCase().includes(query.toLocaleLowerCase())) results.push(item);
      if (item.directory && (query || expanded.has(item.path))) {
        try { await walk(item.path, depth + 1); } catch { /* inaccessible subtree */ }
      }
    }
  }
  await walk(root, 0);
  return { items: results, limited };
}
export async function preview(root: string, path: string) {
  await safePath(root, path);
  const actual = await realpath(path);
  if (!inside(root, actual)) throw new Error('Prévia de link externo bloqueada.');
  const stat = await lstat(actual);
  if (!stat.isFile()) return ['Prévia disponível apenas para arquivos regulares.'];
  const file = await open(actual, 'r');
  try {
    const buf = Buffer.alloc(Math.min(stat.size, 128 * 1024));
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    const content = buf.subarray(0, bytesRead);
    if (content.includes(0)) return [`Arquivo binário · ${stat.size} bytes`];
    const lines = content.toString('utf8').split(/\r?\n/).slice(0, 2000).map((s, i) => `${String(i + 1).padStart(5)}  ${sanitize(s.replace(/\t/g, '    '))}`);
    if (stat.size > bytesRead || lines.length >= 2000) lines.push('… Prévia limitada a 128 KiB / 2000 linhas.');
    return lines;
  } finally { await file.close(); }
}
export async function renameItem(root: string, path: string, name: string) {
  await safePath(root, path);
  if (!name || name === '.' || name === '..' || basename(name) !== name || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error('Use somente um nome, sem caminho.');
  const target = resolve(dirname(path), name);
  if (target === path) return target;
  try { await lstat(target); throw new Error('Já existe um item com esse nome.'); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  // Check then rename; avoid running external filesystem writers concurrently.
  await rename(path, target);
  return target;
}
export async function deleteItem(root: string, path: string) {
  await safePath(root, path);
  await rm(path, { recursive: true, force: false });
}
