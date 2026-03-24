import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, 'integration/index');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions',  // isolate our extension only
        '--no-sandbox',
      ],
    });
  } catch (err) {
    console.error('Integration test run failed:', err);
    process.exit(1);
  }
}

main();
