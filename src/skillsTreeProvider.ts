import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { scanSkillsDir, SkillDirEntry } from './skillParser';

// ─── Vendor icon registry ────────────────────────────────────────────────────

/**
 * Each entry maps a set of keyword patterns (matched against skill dir name)
 * to a vendor icon filename. The icon files live at icons/vendors/<file>.svg
 * relative to the extension root (resolved at runtime via extensionUri).
 */
const VENDOR_ICON_MAP: Array<{ patterns: RegExp; file: string }> = [
  { patterns: /github/i,              file: 'github.svg' },
  { patterns: /copilot/i,             file: 'copilot.svg' },
  { patterns: /anthropic|claude/i,    file: 'anthropic.svg' },
  { patterns: /openai|chatgpt/i,      file: 'openai.svg' },
  { patterns: /google|gemini|bard/i,  file: 'google.svg' },
  { patterns: /microsoft|azure|ms-/i, file: 'microsoft.svg' },
  { patterns: /cursor/i,              file: 'cursor.svg' },
  { patterns: /meta|llama/i,          file: 'meta.svg' },
];

/** Resolve extension-relative vendor icon URIs given the extension context. */
function vendorIconUri(
  name: string,
  extensionUri: vscode.Uri,
): { light: vscode.Uri; dark: vscode.Uri } | undefined {
  for (const { patterns, file } of VENDOR_ICON_MAP) {
    if (patterns.test(name)) {
      const uri = vscode.Uri.joinPath(extensionUri, 'icons', 'vendors', file);
      return { light: uri, dark: uri };
    }
  }
  return undefined;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type SourceKind = 'personal' | 'workspace' | 'custom';

export interface SkillSource {
  kind: SourceKind;
  label: string;
  rootPath: string;
  /** Relative path from rootPath shown in the tree ('' means rootPath itself) */
  subPath: string;
}

// ─── Tree item classes ───────────────────────────────────────────────────────

/** Top-level source node (Personal / Workspace / …) */
export class SourceItem extends vscode.TreeItem {
  constructor(
    public readonly source: SkillSource,
    public readonly children: SkillFolderItem[],
  ) {
    super(source.label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'skillSource';
    this.description = '(' + path.join(source.rootPath, source.subPath).replace(os.homedir(), '~') + ')';
    this.tooltip = path.join(source.rootPath, source.subPath);
    this.iconPath = sourceIcon(source.kind);
  }
}

/** A skill sub-directory (one skill) */
export class SkillFolderItem extends vscode.TreeItem {
  public readonly skillFilePath: string | undefined;

  constructor(
    public readonly entry: SkillDirEntry,
    public readonly sourceKind: SourceKind,
    extensionUri: vscode.Uri,
  ) {
    const displayName = entry.parsed?.frontmatter?.name ?? entry.name;
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);

    this.skillFilePath = entry.skillFilePath;
    this.contextValue = 'skillFolder';
    this.tooltip = entry.parsed?.frontmatter?.description ?? entry.dirPath;
    this.description = entry.name !== displayName ? entry.name : undefined;
    this.iconPath = skillFolderIcon(entry, sourceKind, extensionUri);

    if (entry.parsed?.errors?.length) {
      this.iconPath = new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('problemsWarningIcon.foreground'),
      );
    }
  }
}

/** A file inside a skill folder */
export class SkillFileItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly label: string,
    private readonly extensionUri: vscode.Uri,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'skillFile';
    this.resourceUri = vscode.Uri.file(filePath);
    // Single-click → open webview preview
    this.command = {
      command: 'skill-preview.previewSkill',
      title: 'Preview',
      arguments: [filePath],
    };
    this.iconPath = fileIcon(label, extensionUri);
  }
}

export type SkillTreeItem = SourceItem | SkillFolderItem | SkillFileItem;

// ─── Tree data provider ──────────────────────────────────────────────────────

export class SkillsTreeProvider
  implements vscode.TreeDataProvider<SkillTreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<SkillTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _sources: SkillSource[] = [];
  private _cache = new Map<string, SkillFolderItem[]>();

  // File system watchers
  private _watchers: vscode.FileSystemWatcher[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this._buildSources();
    this._registerWatchers();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  refresh(): void {
    this._cache.clear();
    this._buildSources();
    this._disposeWatchers();
    this._registerWatchers();
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._disposeWatchers();
  }

  // ── TreeDataProvider ───────────────────────────────────────────────────────

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SkillTreeItem): SkillTreeItem[] {
    if (!element) {
      return this._getRootItems();
    }

    if (element instanceof SourceItem) {
      return element.children;
    }

    if (element instanceof SkillFolderItem) {
      return this._getSkillFiles(element);
    }

    return [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _buildSources(): void {
    const config = vscode.workspace.getConfiguration('skill-preview');
    const personalOverride: string = config.get('personalSkillsPath', '');
    const extraPaths: string[] = config.get('extraSkillPaths', []);

    this._sources = [];

    // 1. Personal skills
    const personalRoot = personalOverride
      ? personalOverride
      : path.join(os.homedir(), '.copilot', 'skills');
    this._sources.push({
      kind: 'personal',
      label: 'Personal Skills',
      rootPath: personalRoot,
      subPath: '',
    });

    // 2. Workspace skills – one entry per workspace folder
    // GitHub Copilot skills can live in .github/skills/ or .copilot/skills/
    const WORKSPACE_SKILL_SUBDIRS = [
      path.join('.github', 'skills'),
      path.join('.copilot', 'skills'),
    ];
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    for (const wf of workspaceFolders) {
      for (const subdir of WORKSPACE_SKILL_SUBDIRS) {
        const fullPath = path.join(wf.uri.fsPath, subdir);
        // _getRootItems will filter out non-existent paths
        this._sources.push({
          kind: 'workspace',
          label: `Workspace: ${wf.name}`,
          rootPath: fullPath,
          subPath: '',
        });
      }
    }

    // 3. Extra configured paths
    for (const p of extraPaths) {
      this._sources.push({
        kind: 'custom',
        label: path.basename(p),
        rootPath: p,
        subPath: '',
      });
    }
  }

  private _getRootItems(): SourceItem[] {
    return this._sources
      .map((src) => {
        const scanPath = path.join(src.rootPath, src.subPath);

        let kids = this._cache.get(scanPath);
        if (!kids) {
          const entries = scanSkillsDir(scanPath);
          kids = entries.map((e) => new SkillFolderItem(e, src.kind, this.context.extensionUri));
          this._cache.set(scanPath, kids);
        }

        return new SourceItem(src, kids);
      })
      .filter((item) => {
        // Always show personal skills (even if empty — dir is auto-created by Copilot)
        if (item.source.kind === 'personal') { return true; }
        // Only show workspace/custom sources when their directory actually exists
        const scanPath = path.join(item.source.rootPath, item.source.subPath);
        return fs.existsSync(scanPath);
      });
  }

  private _getSkillFiles(folder: SkillFolderItem): SkillFileItem[] {
    const { dirPath, files } = folder.entry;
    return files.map((rel) => {
      const abs = path.join(dirPath, rel);
      return new SkillFileItem(abs, rel, this.context.extensionUri);
    });
  }

  private _registerWatchers(): void {
    for (const src of this._sources) {
      const scanPath = path.join(src.rootPath, src.subPath);
      if (!fs.existsSync(scanPath)) { continue; }

      const pattern = new vscode.RelativePattern(scanPath, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const refresh = () => this.refresh();
      watcher.onDidCreate(refresh);
      watcher.onDidChange(refresh);
      watcher.onDidDelete(refresh);
      this._watchers.push(watcher);
    }
  }

  private _disposeWatchers(): void {
    for (const w of this._watchers) { w.dispose(); }
    this._watchers = [];
  }
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

type IconInput = vscode.Uri | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri };

function sourceIcon(kind: SourceKind): IconInput {
  switch (kind) {
    case 'personal':
      return new vscode.ThemeIcon('account');
    case 'workspace':
      return new vscode.ThemeIcon('root-folder');
    case 'custom':
      return new vscode.ThemeIcon('folder-library');
  }
}

function skillFolderIcon(
  entry: SkillDirEntry,
  kind: SourceKind,
  extensionUri: vscode.Uri,
): IconInput {
  // 1. Try a real vendor SVG icon
  const vendor = vendorIconUri(entry.name, extensionUri);
  if (vendor) { return vendor; }

  // 2. Fall back to theme icon by source kind
  if (kind === 'personal') {
    return new vscode.ThemeIcon('sparkle');
  }
  return new vscode.ThemeIcon('book');
}

/** Map well-known skill names to fallback theme icons (no vendor match) */
function _themeIconByCategory(name: string): vscode.ThemeIcon | undefined {
  const lower = name.toLowerCase();
  if (lower.includes('version')) { return new vscode.ThemeIcon('tag'); }
  if (lower.includes('milestone') || lower.includes('delivery')) {
    return new vscode.ThemeIcon('milestone');
  }
  if (lower.includes('agent') || lower.includes('custom')) {
    return new vscode.ThemeIcon('robot');
  }
  if (lower.includes('test')) { return new vscode.ThemeIcon('beaker'); }
  if (lower.includes('release') || lower.includes('publish')) {
    return new vscode.ThemeIcon('rocket');
  }
  return undefined;
}

function fileIcon(name: string, extensionUri: vscode.Uri): IconInput {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) {
    return {
      light: vscode.Uri.joinPath(extensionUri, 'icons', 'skill-file-light.svg'),
      dark:  vscode.Uri.joinPath(extensionUri, 'icons', 'skill-file-dark.svg'),
    };
  }
  if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return new vscode.ThemeIcon('json');
  }
  return new vscode.ThemeIcon('file');
}
