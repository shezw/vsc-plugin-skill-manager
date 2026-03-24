import * as fs from 'fs';
import * as path from 'path';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'user-invocable'?: boolean;
  'disable-model-invocation'?: boolean;
  [key: string]: unknown;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
  errors: string[];
}

export interface SkillDirEntry {
  name: string;
  dirPath: string;
  skillFilePath: string | undefined;
  files: string[];
  parsed?: ParsedSkill;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse a SKILL.md file, returning frontmatter and body. */
export function parseSkillFile(filePath: string): ParsedSkill {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseSkillContent(raw);
}

export function parseSkillContent(raw: string): ParsedSkill {
  const errors: string[] = [];
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    errors.push('Missing YAML frontmatter. File must start with --- delimiters.');
    return { frontmatter: {}, body: raw, raw, errors };
  }

  const [, yamlStr, body] = match;
  let frontmatter: SkillFrontmatter = {};

  try {
    // Simple inline YAML parser for basic key: value pairs and quoted strings
    frontmatter = parseSimpleYaml(yamlStr);
  } catch (e) {
    errors.push(`YAML parse error: ${(e as Error).message}`);
  }

  // Validate required fields
  if (!frontmatter.name) {
    errors.push('Missing required frontmatter field: name');
  }
  if (!frontmatter.description) {
    errors.push('Missing required frontmatter field: description');
  }

  return { frontmatter, body, raw, errors };
}

/**
 * Lightweight YAML parser that handles the subset used in SKILL.md frontmatter.
 * Supports: key: value, key: 'quoted', key: "quoted", key: true/false
 */
function parseSimpleYaml(text: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) { continue; }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { continue; }

    const key = line.slice(0, colonIdx).trim();
    let value: string | boolean = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    } else if (value === 'true') {
      (result as Record<string, unknown>)[key] = true;
      continue;
    } else if (value === 'false') {
      (result as Record<string, unknown>)[key] = false;
      continue;
    }

    (result as Record<string, unknown>)[key] = value;
  }

  return result;
}

/** Scan a skills root directory, returning one entry per skill subdirectory. */
export function scanSkillsDir(rootPath: string): SkillDirEntry[] {
  if (!fs.existsSync(rootPath)) { return []; }

  const entries: SkillDirEntry[] = [];

  try {
    const items = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory()) { continue; }
      const dirPath = path.join(rootPath, item.name);
      const files = listFilesRecursive(dirPath);
      const skillFilePath = findSkillFile(dirPath);

      const entry: SkillDirEntry = {
        name: item.name,
        dirPath,
        skillFilePath,
        files,
      };

      if (skillFilePath && fs.existsSync(skillFilePath)) {
        try {
          entry.parsed = parseSkillFile(skillFilePath);
        } catch {
          // ignore parse errors here; they will surface in diagnostics
        }
      }

      entries.push(entry);
    }
  } catch {
    // permission errors etc.
  }

  return entries;
}

function findSkillFile(dirPath: string): string | undefined {
  const candidates = ['SKILL.md', 'skill.md'];
  for (const c of candidates) {
    const p = path.join(dirPath, c);
    if (fs.existsSync(p)) { return p; }
  }
  return undefined;
}

function listFilesRecursive(dirPath: string, rel = ''): string[] {
  const result: string[] = [];
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const relPath = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        result.push(...listFilesRecursive(path.join(dirPath, item.name), relPath));
      } else {
        result.push(relPath);
      }
    }
  } catch {
    // ignore
  }
  return result;
}
