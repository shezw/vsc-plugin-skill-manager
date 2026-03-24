# Changelog

All notable changes to **Copilot Skill Browser** will be documented here.

## [0.1.0] - 2026-03-24

### Added
- Skills Explorer tree view in VS Code Explorer panel
  - Scans `~/.copilot/skills/` (personal) and `.copilot/skills/` per workspace
  - Vendor icons for GitHub, Copilot, Anthropic/Claude, OpenAI, Google, Microsoft, Cursor, Meta
  - Live file-system watcher – tree refreshes automatically on changes
- New Skill wizard (toolbar `+` button) with guided prompts
- `SKILL.md` / `*.skill.md` language with YAML frontmatter + Markdown syntax highlighting
- Diagnostics: errors for missing frontmatter, missing `name`/`description`; warnings for unknown fields
- Code snippets: full scaffold, section templates, individual frontmatter field prefixes
- Webview preview panel – renders frontmatter table + Markdown body
- Configuration: `personalSkillsPath`, `extraSkillPaths`, `showFileCount`
