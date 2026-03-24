# Copilot Skill Browser

A VS Code extension for browsing, previewing and authoring **GitHub Copilot SKILL.md** files.

## Features

### 1. Skills Explorer (Tree View)

A dedicated panel in the VS Code Explorer sidebar that automatically scans all available skill directories:

| Source | Path | Icon |
|--------|------|------|
| Personal | `~/.copilot/skills/` | $(account) |
| Workspace | `.copilot/skills/` | $(root-folder) |
| Custom | configurable | $(folder-library) |

- Each skill folder is displayed with its display `name` from frontmatter (falls back to directory name)
- Tooltip shows the skill `description`
- Warning icon on skills with missing required frontmatter
- Context-aware icons for well-known skill types (version, milestone, github, etc.)
- File system watcher — the tree refreshes automatically when skills are added/removed/modified

### 2. New Skill Wizard

Use the **+** button in the Skills panel toolbar (or `Skill Preview: New Skill`) to launch a guided wizard:

1. Choose location: **Personal** (`~/.copilot/skills/`) or **Workspace** (`.copilot/skills/`)
2. Enter a kebab-case skill directory name
3. Enter a display name and description
4. A ready-to-edit `SKILL.md` is created from the built-in template

### 3. SKILL.md Syntax Highlighting

Files named `SKILL.md` or ending in `.skill.md` receive:

- **YAML frontmatter** highlighting with distinct colours for required fields (`name`, `description`), optional fields (`argument-hint`, `user-invocable`, `disable-model-invocation`), and unknown fields
- Full **Markdown** highlighting for the body (headings, bold/italic, code blocks, lists, blockquotes)

### 4. Diagnostics (Error Checking)

Red/orange squiggles and Problems panel entries for:

| Severity | Rule |
|----------|------|
| Error | Missing `---` frontmatter delimiters |
| Error | Missing required field `name` |
| Error | Missing required field `description` |
| Warning | Unknown / non-standard frontmatter field |

### 5. Code Snippets

Trigger in any `SKILL.md` or `.skill.md` file:

| Prefix | Inserts |
|--------|---------|
| `skill` | Full frontmatter + scaffold |
| `skill-min` | Minimal frontmatter |
| `## when` | "When To Use" section |
| `## produces` | "What This Skill Produces" section |
| `## steps` | Numbered "Steps" section |
| `## policy` | "Default Policy" section |
| `name:` `description:` … | Individual frontmatter fields |

### 6. Skill Preview Webview

Right-click any `SKILL.md` in the tree and choose **Open Preview** to see a rendered HTML preview of the frontmatter and markdown body directly in VS Code.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `skill-preview.personalSkillsPath` | `""` | Override personal skills root (defaults to `~/.copilot/skills/`) |
| `skill-preview.extraSkillPaths` | `[]` | Additional skill root directories to scan |
| `skill-preview.showFileCount` | `true` | Show file count badge on skill folder items |

## SKILL.md Format

```markdown
---
name: my-skill
description: 'Short description shown in the skill picker'
argument-hint: 'What context to provide when invoking'
user-invocable: true
disable-model-invocation: false
---

# My Skill

## When To Use

…

## What This Skill Produces

- …
```

## Development

```bash
npm install
npm run build          # one-off build
npm run build:watch    # rebuild on save
```

Press **F5** in VS Code to launch the Extension Development Host.
