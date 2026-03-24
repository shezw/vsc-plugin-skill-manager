import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const SKILL_FS_SCHEME = 'skillfs';
export const SKILL_FS_ROOT = vscode.Uri.from({ scheme: SKILL_FS_SCHEME, authority: 'skills', path: '/' });
export const SKILL_FS_FOLDER_NAME = 'SKILLS';
const LOCAL_LABEL = 'Local Skills';
const PROJECT_LABEL = 'Project Skills';

export class SkillFsProvider implements vscode.FileSystemProvider {
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  constructor(private readonly getProjectRoot: () => string | undefined) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const parts = splitPath(uri);
    if (parts.length === 0) {
      return dirStat();
    }

    const section = parts[0];
    if ((section === LOCAL_LABEL || section === PROJECT_LABEL) && parts.length === 1) {
      return dirStat();
    }

    const realPath = this.toRealPath(uri, false);
    if (!realPath || !fs.existsSync(realPath)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const stats = fs.statSync(realPath);
    return toStat(stats);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const parts = splitPath(uri);
    if (parts.length === 0) {
      return [
        [LOCAL_LABEL, vscode.FileType.Directory],
        [PROJECT_LABEL, vscode.FileType.Directory],
      ];
    }

    const realPath = this.toRealPath(uri, false);
    if (!realPath) {
      return [];
    }
    if (!fs.existsSync(realPath)) {
      return [];
    }

    return fs.readdirSync(realPath, { withFileTypes: true }).map((entry) => [
      entry.name,
      entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
    ]);
  }

  createDirectory(uri: vscode.Uri): void {
    const realPath = this.toRealPath(uri, true);
    if (!realPath) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    fs.mkdirSync(realPath, { recursive: true });
    this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const realPath = this.toRealPath(uri, false);
    if (!realPath || !fs.existsSync(realPath)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return fs.readFileSync(realPath);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean },
  ): void {
    const realPath = this.toRealPath(uri, true);
    if (!realPath) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    fs.mkdirSync(path.dirname(realPath), { recursive: true });
    fs.writeFileSync(realPath, content);
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean }): void {
    const realPath = this.toRealPath(uri, false);
    if (!realPath || !fs.existsSync(realPath)) {
      return;
    }
    fs.rmSync(realPath, { recursive: options.recursive, force: true });
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): void {
    const oldPath = this.toRealPath(oldUri, false);
    const newPath = this.toRealPath(newUri, true);
    if (!oldPath || !newPath || !fs.existsSync(oldPath)) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }
    if (!options.overwrite && fs.existsSync(newPath)) {
      throw vscode.FileSystemError.FileExists(newUri);
    }
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    this._emitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  private toRealPath(uri: vscode.Uri, ensureProjectRoot: boolean): string | undefined {
    const parts = splitPath(uri);
    if (parts.length === 0) {
      return undefined;
    }

    const [section, ...rest] = parts;
    if (section === LOCAL_LABEL) {
      return path.join(getLocalSkillsRoot(), ...rest);
    }

    if (section === PROJECT_LABEL) {
      const projectRoot = getProjectSkillsRoot(this.getProjectRoot(), ensureProjectRoot);
      return projectRoot ? path.join(projectRoot, ...rest) : undefined;
    }

    return undefined;
  }
}

function splitPath(uri: vscode.Uri): string[] {
  return uri.path.split('/').filter(Boolean).map(decodeURIComponent);
}

function getLocalSkillsRoot(): string {
  return path.join(os.homedir(), '.copilot', 'skills');
}

function getProjectSkillsRoot(
  workspaceRoot: string | undefined,
  ensureExists: boolean,
): string | undefined {
  if (!workspaceRoot) {
    return undefined;
  }

  const githubRoot = path.join(workspaceRoot, '.github', 'skills');
  const copilotRoot = path.join(workspaceRoot, '.copilot', 'skills');
  if (fs.existsSync(githubRoot)) {
    return githubRoot;
  }
  if (fs.existsSync(copilotRoot)) {
    return copilotRoot;
  }
  if (ensureExists) {
    fs.mkdirSync(githubRoot, { recursive: true });
    return githubRoot;
  }
  return githubRoot;
}

function dirStat(): vscode.FileStat {
  return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
}

function toStat(stats: fs.Stats): vscode.FileStat {
  return {
    type: stats.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
    ctime: stats.ctimeMs,
    mtime: stats.mtimeMs,
    size: stats.size,
  };
}