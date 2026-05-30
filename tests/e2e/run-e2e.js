import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wranglerConfigPath = path.resolve(__dirname, '../../wrangler.jsonc');
const backupPath = wranglerConfigPath + '.backup';

console.log('--- E2E Test Wrapper Started ---');

try {
  // 1. Strip AI binding from wrangler.jsonc
  if (fs.existsSync(wranglerConfigPath)) {
    const content = fs.readFileSync(wranglerConfigPath, 'utf8');
    if (content.includes('"ai"')) {
      // Backup original config
      fs.writeFileSync(backupPath, content, 'utf8');
      
      // Strip AI binding (including preceding comma and closing brace)
      const updated = content.replace(/,\s*"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"\s*\}\s*/g, '');
      fs.writeFileSync(wranglerConfigPath, updated, 'utf8');
      console.log('SUCCESS: Successfully backed up and stripped "ai" binding from wrangler.jsonc.');
    } else {
      console.log('NOTE: "ai" binding not found in wrangler.jsonc, skipping strip.');
    }
  } else {
    console.log('WARNING: wrangler.jsonc not found!');
  }

  // 2. Extract SESSION_SECRET from .dev.vars to align cookie sealing keys
  let sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';
  const devVarsPath = path.resolve(__dirname, '../../.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const varsContent = fs.readFileSync(devVarsPath, 'utf8');
    const match = varsContent.match(/SESSION_SECRET\s*=\s*(.+)/);
    if (match && match[1]) {
      let val = match[1].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      } else if (val.startsWith("'") && val.endsWith("'")) {
        val = val.substring(1, val.length - 1);
      }
      sessionSecret = val;
      console.log('SUCCESS: Extracted full SESSION_SECRET from .dev.vars for E2E cookie sealing.');
    }
  }

  // 3. Spawn Playwright E2E tests with forwarded arguments
  console.log('Spawning Playwright E2E tests...');
  const args = ['playwright', 'test', ...process.argv.slice(2)];
  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PUBLIC_E2E_MOCK_MODE: 'true',
      SESSION_SECRET: sessionSecret,
    }
  });

  // Exit with Playwright's exit code
  process.exitCode = result.status ?? 0;
  console.log(`Playwright tests exited with code ${result.status}`);

} catch (error) {
  console.error('An unexpected error occurred in E2E runner:', error);
  process.exitCode = 1;
} finally {
  // 3. Always restore original wrangler.jsonc from backup
  if (fs.existsSync(backupPath)) {
    const backupContent = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(wranglerConfigPath, backupContent, 'utf8');
    fs.unlinkSync(backupPath);
    console.log('SUCCESS: Successfully restored original wrangler.jsonc from backup.');
  }
}
