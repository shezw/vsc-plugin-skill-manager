import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const SKILL_FS_SCHEME = 'skillfs';

/**
 * Root URI for the virtual skills workspace folder.
 * skillfs://skills/
 */
export const SKILL_FS_ROOT = vscode.Uri.from({
  scheme: SKILL_FS_SCHEME,
  authority: 'skills',
  path: '/',
});

/**
 * Workspace folder name shown in Explorer.
 * 📖 renders as a golden/tan open book on macOS.
 */
export const SKILL_FS_FOLDER_NAME = '📖 SKILLS';

/**
 * Virtual FileSystemProvider that surfaces real skill directories under a
 * single virtual workspace root (skillfs://skills/).
 *
 * Path structure:
 *   skillfs://skills/                              → virtual root (directory)
 *   skillfs://skills/Personal Skills/              → ~/.copilot/skills/
 *   skillfs://skills/Workspace: <name>/            → <wf>/.github/skills/ or .copilot/skills/
 *   skillfs://skills/<source>/<skill-dir>/SKILL.md → corresponding real file (rw)
 */
export class SkillFsProvider implements vscode.FileSystemProvider {
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  /** Virtual source label → real absolute directory path */
  private _roots = new Map<string, string>();
  private _watchers: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this._buildRoots();
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this._buildRoots();
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: SKILL_FS_ROOT }]);
      }),
    );
  }

  // ── Root discovery ──────────────────────────────────────────────────────

  private _buildRoots(): void {
    this._roots.clear();
    for (const w of this._watchers) { w.dispose(); }
    this._watchers = [];

    // 1. Personal skills (~/.copilot/skills/)
    const personal = path.join(os.homedir(), '.copilot', 'skills');
    this._roots.set('Personal Skills', personal);
    this._watchReal(personal);

    // 2. One entry per workspace folder (first matching sub-path wins)
    for (const wf of vscode.workspace.workspaceFolders ?? []) {
      if (wf.uri.scheme === SKILL_FS_SCHEME) { continue; } // skip ourselves
      for (const sub of [path.join('.github', 'skills'), path.join('.copilot', 'skills')]) {
        const full = path.join(wf.uri.fsPath, sub);
        if (fs.existsSync(full)) {
          this._roots.set(`Workspace: ${wf.name}`, full);
          this._watchReal(full);
          break;
        }
      }
    }
  }

  private _watchReal(realPath: string): void {
    if (!fs.existsSync(realPath)) { return; }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(realPath, '**/*'),
    );
    const fire = (uri: vscode.Uri) => {
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    };
    watcher.onDidCreate(fire);
    watcher.onDidChange(fire);
    watcher.onDidDelete(fire);
    this._watchers.push(watcher);
  }

  // ── Path mapping ────────────────────────────────────────────────────────

  /**
   * Map skillfs://skills/Source%20Name/a/b.md  →  /real/path/a/b.md
   */
  private _toReal(uri: vscode.Uri): string {
    const parts = uri.path.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length === 0) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const [source, ...rest] = parts;
    const realRoot = this._roots.get(source);
    if (!realRoot) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return rest.length === 0 ? realRoot : path.join(realRoot, ...rest);
  }

  // ── FileSystemProvider interface ─────────────────────────────────────────

  watch(
    _uri: vscode.Uri,
    _opts: { readonly recursive: boolean; readonly excludes: readonly string[] },
  ): vscode.Disposable {
    // Global watchers are set up in _buildRoots(); per-URI watch is a no-op.
    return { dispose: () => { /* no-op */ } };
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const parts = uri.path.split('/').filter(Boolean);
    if (parts.length === 0) {
      // Virtual root always exists
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    const realPath = this._toReal(uri);
    try {
      const s = fs.statSync(realPath);
      return {
        type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: s.ctimeMs,
        mtime: s.mtimeMs,
        size: s.size,
      };
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const parts = uri.path.split('/').filter(Boolean);
    if (parts.length === 0) {
      // Virtual root: list configured sources that exist on disk
      return Array.from(this._roots.entries())
        .filter(([, p]) => fs.existsSync(p))
        .map(([name]) => [name, vscode.FileType.Directory]);
    }
    const realPath = this._toReal(uri);
    try {
      return fs.readdirSync(realPath, { withFileTypes: true }).map((e) => [
        e.name,
        e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
      ] as [string, vscode.FileType]);
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  readFile(uri: vscode.Uri): Uint8Array {
    try {
      return fs.readFileSync(this._toReal(uri));
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _opts: { readonly create: boolean; readonly overwrite: boolean },
  ): void {
    const realPath = this._toReal(uri);
    try {
      fs.mkdirSync(path.dirname(realPath), { recursive: true });
      fs.writeFileSync(realPath, content);
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, _opts: { readonly overwrite: boolean }): void {
    try {
      fs.renameSync(this._toReal(oldUri), this._toReal(newUri));
    } catch {
      throw vscode.FileSystemError.NoPermissions(oldUri);
    }
  }

  delete(uri: vscode.Uri, _opts: { readonly recursive: boolean }): void {
    try {
      fs.rmSync(this._toReal(uri), { recursive: true, force: true });
    } catch {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
  }

  createDirectory(uri: vscode.Uri): void {
    try {
      fs.mkdirSync(this._toReal(uri), { recursive: true });
    } catch {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
  }
}
