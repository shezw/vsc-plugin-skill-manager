import * as vscode from 'vscode';
import { parseSkillContent } from './skillParser';

const SKILL_LANG_ID = 'skill-md';

export class SkillDiagnosticsProvider implements vscode.Disposable {
  private readonly _collection: vscode.DiagnosticCollection;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor() {
    this._collection = vscode.languages.createDiagnosticCollection('skill-md');

    // Validate on open
    this._disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this._validate(doc)),
    );

    // Validate on change
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this._validate(e.document)),
    );

    // Clear on close
    this._disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this._collection.delete(doc.uri);
      }),
    );

    // Validate already-open documents
    for (const doc of vscode.workspace.textDocuments) {
      this._validate(doc);
    }
  }

  dispose(): void {
    this._collection.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }

  private _validate(doc: vscode.TextDocument): void {
    if (doc.languageId !== SKILL_LANG_ID && !doc.fileName.endsWith('SKILL.md')) {
      return;
    }

    const text = doc.getText();
    const parsed = parseSkillContent(text);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const err of parsed.errors) {
      // Report errors on line 0 by default; enhance with specific positions where possible
      const range = this._locateError(doc, err);
      const d = new vscode.Diagnostic(
        range,
        err,
        vscode.DiagnosticSeverity.Error,
      );
      d.source = 'skill-preview';
      diagnostics.push(d);
    }

    // Warn about unknown frontmatter keys
    const knownKeys = new Set([
      'name', 'description', 'argument-hint', 'user-invocable',
      'disable-model-invocation',
    ]);
    for (const key of Object.keys(parsed.frontmatter)) {
      if (!knownKeys.has(key)) {
        const range = this._findKeyRange(doc, key);
        const d = new vscode.Diagnostic(
          range,
          `Unknown frontmatter field: "${key}"`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'skill-preview';
        diagnostics.push(d);
      }
    }

    this._collection.set(doc.uri, diagnostics);
  }

  private _locateError(doc: vscode.TextDocument, err: string): vscode.Range {
    // Try to find the specific field mentioned in the error
    const fieldMatch = err.match(/field:\s*(\S+)/);
    if (fieldMatch) {
      return this._findKeyRange(doc, fieldMatch[1]);
    }

    // Default to the first line of the file
    return new vscode.Range(0, 0, 0, doc.lineAt(0).text.length);
  }

  private _findKeyRange(doc: vscode.TextDocument, key: string): vscode.Range {
    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    // Find the key inside the frontmatter block
    let inFrontmatter = false;
    let fmCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        fmCount++;
        inFrontmatter = fmCount === 1;
        if (fmCount === 2) { break; }
        continue;
      }
      if (inFrontmatter) {
        const colonIdx = lines[i].indexOf(':');
        if (colonIdx !== -1) {
          const lineKey = lines[i].slice(0, colonIdx).trim();
          if (lineKey === key) {
            return new vscode.Range(i, 0, i, lines[i].length);
          }
        }
      }
    }

    return new vscode.Range(0, 0, 0, doc.lineAt(0).text.length);
  }
}
