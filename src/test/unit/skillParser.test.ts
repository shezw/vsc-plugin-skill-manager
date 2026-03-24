import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillContent, parseSkillFile, scanSkillsDir } from '../../skillParser';

// ── parseSkillContent ────────────────────────────────────────────────────────

suite('parseSkillContent', () => {
  test('parses valid frontmatter with all required fields', () => {
    const raw = `---
name: my-skill
description: 'A test skill'
user-invocable: true
---

# My Skill

Body text.
`;
    const result = parseSkillContent(raw);
    assert.strictEqual(result.frontmatter.name, 'my-skill');
    assert.strictEqual(result.frontmatter.description, 'A test skill');
    assert.strictEqual(result.frontmatter['user-invocable'], true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.body.includes('Body text.'));
  });

  test('returns error when frontmatter is missing', () => {
    const result = parseSkillContent('# No frontmatter\n\nJust a heading.');
    assert.ok(result.errors.some((e) => /frontmatter/i.test(e)));
  });

  test('returns error for missing required field: name', () => {
    const raw = `---
description: 'desc only'
---
body
`;
    const result = parseSkillContent(raw);
    assert.ok(result.errors.some((e) => /name/i.test(e)));
  });

  test('returns error for missing required field: description', () => {
    const raw = `---
name: skill-x
---
body
`;
    const result = parseSkillContent(raw);
    assert.ok(result.errors.some((e) => /description/i.test(e)));
  });

  test('parses double-quoted string values', () => {
    const raw = `---
name: "quoted-skill"
description: "Has double quotes"
---
`;
    const result = parseSkillContent(raw);
    assert.strictEqual(result.frontmatter.name, 'quoted-skill');
    assert.strictEqual(result.frontmatter.description, 'Has double quotes');
    assert.strictEqual(result.errors.length, 0);
  });

  test('parses boolean false', () => {
    const raw = `---
name: skill-y
description: 'desc'
user-invocable: false
disable-model-invocation: true
---
`;
    const result = parseSkillContent(raw);
    assert.strictEqual(result.frontmatter['user-invocable'], false);
    assert.strictEqual(result.frontmatter['disable-model-invocation'], true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('preserves body text unchanged after frontmatter', () => {
    const raw = `---
name: skill-z
description: 'desc'
---
# Title

Some body here.
`;
    const result = parseSkillContent(raw);
    assert.ok(result.body.includes('# Title'));
    assert.ok(result.body.includes('Some body here.'));
  });
});

// ── parseSkillFile ───────────────────────────────────────────────────────────

suite('parseSkillFile', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads and parses a SKILL.md file from disk', () => {
    const content = `---\nname: file-skill\ndescription: 'From file'\n---\n# File Skill\n`;
    const filePath = path.join(tmpDir, 'SKILL.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = parseSkillFile(filePath);
    assert.strictEqual(result.frontmatter.name, 'file-skill');
    assert.strictEqual(result.errors.length, 0);
  });
});

// ── scanSkillsDir ────────────────────────────────────────────────────────────

suite('scanSkillsDir', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scan-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty array for non-existent directory', () => {
    const result = scanSkillsDir(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array for empty directory', () => {
    const result = scanSkillsDir(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('finds skill directory with SKILL.md', () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: 'desc'\n---\nbody\n`,
      'utf-8',
    );

    const entries = scanSkillsDir(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, 'my-skill');
    assert.ok(entries[0].skillFilePath?.endsWith('SKILL.md'));
    assert.strictEqual(entries[0].parsed?.frontmatter.name, 'my-skill');
    assert.strictEqual(entries[0].parsed?.errors.length, 0);
  });

  test('finds multiple skill directories', () => {
    for (const s of ['skill-a', 'skill-b', 'skill-c']) {
      const dir = path.join(tmpDir, s);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${s}\ndescription: 'desc'\n---\n`,
        'utf-8',
      );
    }

    const entries = scanSkillsDir(tmpDir);
    assert.strictEqual(entries.length, 3);
    const names = entries.map((e) => e.name).sort();
    assert.deepStrictEqual(names, ['skill-a', 'skill-b', 'skill-c']);
  });

  test('skill without SKILL.md has undefined skillFilePath', () => {
    const skillDir = path.join(tmpDir, 'bare-dir');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'notes.txt'), 'hello');

    const entries = scanSkillsDir(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].skillFilePath, undefined);
  });

  test('lists files recursively inside skill directory', () => {
    const skillDir = path.join(tmpDir, 'nested-skill');
    fs.mkdirSync(path.join(skillDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: nested\ndescription: 'd'\n---\n`);
    fs.writeFileSync(path.join(skillDir, 'docs', 'guide.md'), '# Guide');

    const entries = scanSkillsDir(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].files.includes('SKILL.md'));
    assert.ok(entries[0].files.includes('docs/guide.md'));
  });

  test('collects errors for skills with invalid frontmatter', () => {
    const skillDir = path.join(tmpDir, 'bad-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# No frontmatter\n');

    const entries = scanSkillsDir(tmpDir);
    assert.strictEqual(entries.length, 1);
    assert.ok((entries[0].parsed?.errors.length ?? 0) > 0);
  });
});
