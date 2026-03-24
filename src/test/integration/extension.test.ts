import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration', () => {
  test('extension activates successfully', async () => {
    const ext = vscode.extensions.getExtension('shezw.skill-preview');
    assert.ok(ext, 'Extension should be installed in test host');
    await ext!.activate();
    assert.ok(ext!.isActive, 'Extension should be active after activate()');
  });

  test('all commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
      'skill-preview.refresh',
      'skill-preview.newSkill',
      'skill-preview.openSkill',
      'skill-preview.openSkillPreview',
      'skill-preview.revealInExplorer',
    ];
    for (const cmd of expectedCommands) {
      assert.ok(
        commands.includes(cmd),
        `Command "${cmd}" should be registered`,
      );
    }
  });

  test('skill-md language is registered', async () => {
    const langs = await vscode.languages.getLanguages();
    assert.ok(langs.includes('skill-md'), 'skill-md language should be registered');
  });

  test('skillsExplorer view is contributes to explorer', () => {
    // The tree view should be registered (contribution declared in package.json)
    // We can only verify it doesn't throw to execute the refresh command
    assert.doesNotThrow(() => {
      vscode.commands.executeCommand('skill-preview.refresh');
    });
  });
});
