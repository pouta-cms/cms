import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalTeardown() {
  // Restore wrangler.jsonc
  const wranglerConfigPath = path.resolve(__dirname, '../../wrangler.jsonc');
  const backupPath = wranglerConfigPath + '.backup';
  if (fs.existsSync(backupPath)) {
    const backupContent = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(wranglerConfigPath, backupContent, 'utf8');
    fs.unlinkSync(backupPath);
    console.log('Successfully restored original wrangler.jsonc from backup.');
  }
}

export default globalTeardown;
