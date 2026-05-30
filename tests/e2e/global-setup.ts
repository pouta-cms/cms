import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalSetup() {
  // Temporarily strip "ai" binding from wrangler.jsonc to force fully local/offline dev server
  const wranglerConfigPath = path.resolve(__dirname, '../../wrangler.jsonc');
  if (fs.existsSync(wranglerConfigPath)) {
    const content = fs.readFileSync(wranglerConfigPath, 'utf8');
    if (content.includes('"ai"')) {
      // Backup original config content
      fs.writeFileSync(wranglerConfigPath + '.backup', content, 'utf8');
      
      // Strip AI binding (including preceding comma and closing brace)
      const updated = content.replace(/,\s*"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"\s*\}\s*/g, '');
      fs.writeFileSync(wranglerConfigPath, updated, 'utf8');
      console.log('Successfully backed up and stripped "ai" binding from wrangler.jsonc to force offline local dev mode.');
    }
  }
}

export default globalSetup;
