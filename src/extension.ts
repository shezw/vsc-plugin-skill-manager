import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  SkillsTreeProvider,
  SkillFolderItem,
  SkillFileItem,
  SourceItem,
} from './skillsTreeProvider';
import { SkillDiagnosticsProvider } from './skillDiagnostics';

export function activate(context: vscode.ExtensionContext): void {
  // ── Tree view ──────────────────────────────────────────────────────────────
  const treeProvider = new SkillsTreeProvider(context);
  const treeView = vscode.window.createTreeView('skillsExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView, treeProvider);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  const diagnostics = new SkillDiagnosticsProvider();
  context.subscriptions.push(diagnostics);

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('skill-preview.refresh', () => {
      treeProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'skill-preview.openSkill',
      async (uriOrItem?: vscode.Uri | SkillFileItem | string) => {
        let uri: vscode.Uri | undefined;

        if (uriOrItem instanceof vscode.Uri) {
          uri = uriOrItem;
        } else if (uriOrItem instanceof SkillFileItem) {
          uri = vscode.Uri.file(uriOrItem.filePath);
        } else if (typeof uriOrItem === 'string') {
          uri = vscode.Uri.file(uriOrItem);
        }

        if (!uri) { return; }

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      },
    ),
  );

  // Single-click preview command (triggered by SkillFileItem.command)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'skill-preview.previewSkill',
      async (filePath?: string) => {
        if (!filePath) { return; }
        await openSkillWebview(context, filePath);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'skill-preview.revealInExplorer',
      async (item?: SkillFolderItem | SkillFileItem | SourceItem) => {
        let targetPath: string | undefined;

        if (item instanceof SkillFolderItem) {
          targetPath = item.entry.dirPath;
        } else if (item instanceof SkillFileItem) {
          targetPath = item.filePath;
        }

        if (!targetPath) { return; }

        await vscode.commands.executeCommand(
          'revealFileInOS',
          vscode.Uri.file(targetPath),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'skill-preview.newSkill',
      async () => {
        await createNewSkill(context, treeProvider);
      },
    ),
  );

  // ── Watch active editor to reveal in tree ──────────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor) { return; }
      const fileName = path.basename(editor.document.fileName);
      if (fileName !== 'SKILL.md' && !editor.document.fileName.endsWith('.skill.md')) {
        return;
      }
      // The tree view does not support findItem, so just refresh to keep in sync
    }),
  );
}

export function deactivate(): void {
  // nothing
}

// ─── New skill wizard ─────────────────────────────────────────────────────────

async function createNewSkill(
  context: vscode.ExtensionContext,
  treeProvider: SkillsTreeProvider,
): Promise<void> {
  const personalRoot = path.join(os.homedir(), '.copilot', 'skills');
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const workspaceRoot =
    workspaceFolders.length > 0
      ? path.join(workspaceFolders[0].uri.fsPath, '.copilot', 'skills')
      : undefined;

  const choices: vscode.QuickPickItem[] = [
    {
      label: '$(account) Personal',
      description: personalRoot.replace(os.homedir(), '~'),
      detail: 'Stored in ~/.copilot/skills/ – available across all workspaces',
    },
  ];
  if (workspaceRoot) {
    choices.push({
      label: '$(root-folder) Workspace',
      description: workspaceRoot
        .replace(workspaceFolders[0].uri.fsPath, workspaceFolders[0].name),
      detail: 'Stored in .copilot/skills/ – workspace-specific',
    });
  }

  const pick = await vscode.window.showQuickPick(choices, {
    placeHolder: 'Where should the new skill be created?',
  });
  if (!pick) { return; }

  const isPersonal = pick.label.includes('Personal');
  const targetRoot = isPersonal ? personalRoot : workspaceRoot!;

  const skillName = await vscode.window.showInputBox({
    prompt: 'Skill directory name (kebab-case)',
    placeHolder: 'my-new-skill',
    validateInput: (v) =>
      /^[a-z0-9-]+$/.test(v) ? null : 'Use lowercase letters, numbers and hyphens only',
  });
  if (!skillName) { return; }

  const skillDir = path.join(targetRoot, skillName);
  if (fs.existsSync(skillDir)) {
    vscode.window.showErrorMessage(`Skill directory already exists: ${skillDir}`);
    return;
  }

  const displayName = await vscode.window.showInputBox({
    prompt: 'Skill display name',
    placeHolder: 'My New Skill',
    value: toTitleCase(skillName),
  });
  if (!displayName) { return; }

  const description = await vscode.window.showInputBox({
    prompt: 'Short description (shown in skill picker)',
    placeHolder: 'Describe what this skill does and when to use it',
  });
  if (!description) { return; }

  // Create directory and SKILL.md
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFilePath = path.join(skillDir, 'SKILL.md');
  const template = buildSkillTemplate(skillName, displayName, description);
  fs.writeFileSync(skillFilePath, template, 'utf-8');

  treeProvider.refresh();

  const doc = await vscode.workspace.openTextDocument(skillFilePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

function buildSkillTemplate(id: string, name: string, description: string): string {
  return `---
name: ${id}
description: '${description.replace(/'/g, "''")}'
argument-hint: 'Describe the context or task'
user-invocable: true
disable-model-invocation: false
---

# ${name}

## When To Use

${description}

## What This Skill Produces

- (describe the outputs or actions this skill takes)

## Steps

1. Step one
2. Step two
3. Step three
`;
}

function toTitleCase(s: string): string {
  return s.replace(/-./g, (m) => ' ' + m[1].toUpperCase()).replace(/^./, (m) => m.toUpperCase());
}

// ─── Skill Webview preview ────────────────────────────────────────────────────

async function openSkillWebview(
  context: vscode.ExtensionContext,
  filePath: string,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'skillPreview',
    `Preview: ${path.basename(path.dirname(filePath))}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  const content = fs.readFileSync(filePath, 'utf-8');
  panel.webview.html = renderSkillHtml(content, filePath);
}

function renderSkillHtml(raw: string, filePath: string): string {
  // Parse frontmatter
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let fmHtml = '';
  let body = raw;

  if (fmMatch) {
    const [, yamlStr, rest] = fmMatch;
    body = rest;
    const fields: { key: string; value: string }[] = [];
    for (const line of yamlStr.split(/\r?\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) { continue; }
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      fields.push({ key, value });
    }
    fmHtml = `
      <table class="fm">
        ${fields.map((f) => `<tr><td class="fm-key">${escHtml(f.key)}</td><td class="fm-val">${escHtml(f.value)}</td></tr>`).join('\n')}
      </table>`;
  }

  // Very basic markdown → HTML (headings, bold, italic, lists, code blocks)
  const bodyHtml = markdownToHtml(body);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Preview</title>
<style>
  body { font-family: var(--vscode-editor-font-family, 'Segoe UI', sans-serif);
         font-size: 14px; color: var(--vscode-editor-foreground);
         background: var(--vscode-editor-background); padding: 1.5rem 2rem; max-width: 800px; }
  h1 { color: var(--vscode-textLink-activeForeground); border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .4em; }
  h2 { color: var(--vscode-textPreformat-foreground); margin-top: 1.4em; }
  h3 { margin-top: 1.2em; }
  code, pre { background: var(--vscode-textCodeBlock-background); border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
  code  { padding: 0.1em 0.4em; }
  pre   { padding: 0.8em 1em; overflow-x: auto; }
  .fm   { border-collapse: collapse; margin-bottom: 1.5rem; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; overflow: hidden; }
  .fm td { padding: 4px 12px; vertical-align: top; }
  .fm-key { font-weight: 600; color: var(--vscode-symbolIcon-fieldForeground); white-space: nowrap; }
  .fm-val { color: var(--vscode-textLink-foreground); }
  .fm-section { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .08em; color: var(--vscode-descriptionForeground); padding: 6px 12px 2px; }
  ul, ol { padding-left: 1.4em; }
  li { margin: .2em 0; }
  blockquote { border-left: 3px solid var(--vscode-textLink-foreground); margin-left: 0; padding-left: 1em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="fm-section">Frontmatter</div>
${fmHtml}
${bodyHtml}
</body>
</html>`;
}

/** Minimal markdown → HTML converter for preview purposes */
function markdownToHtml(md: string): string {
  let html = escHtml(md);

  // Code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Unordered list items
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`);
  // Paragraph breaks (two newlines)
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*(<(?:h[1-4]|ul|ol|pre|blockquote))/g, '$1');
  html = html.replace(/(<\/(?:h[1-4]|ul|ol|pre|blockquote)>)\s*<\/p>/g, '$1');

  return html;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
