import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';
import { getInstallationAccessToken } from '../../../utils/githubApp';

export const prerender = false;

// Safe cookie extraction helper
function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const parts = cookie.split('=');
    const key = parts[0];
    const value = parts.slice(1).join('=');
    if (key === name) return value;
  }
  return null;
}

// BlockNote JSON structure converter to Markdown
function blockToMarkdown(block: any): string {
  let md = '';
  const blockType = block.type;
  const content = block.content;

  // Helper to extract text with style formatting
  const getText = (contentArr: any[]): string => {
    if (!contentArr || !Array.isArray(contentArr)) return '';
    return contentArr
      .map((item: any) => {
        if (item.type === 'text') {
          let text = item.text || '';
          if (item.styles) {
            if (item.styles.bold) text = `**${text}**`;
            if (item.styles.italic) text = `*${text}*`;
            if (item.styles.underline) text = `<u>${text}</u>`;
            if (item.styles.strike) text = `~~${text}~~`;
            if (item.styles.code) text = `\`${text}\``;
          }
          return text;
        } else if (item.type === 'link') {
          const linkText = item.content ? getText(item.content) : item.href;
          return `[${linkText}](${item.href})`;
        }
        return '';
      })
      .join('');
  };

  const textVal = getText(content);

  switch (blockType) {
    case 'heading': {
      const level = block.props?.level || 1;
      md += `${'#'.repeat(level)} ${textVal}\n\n`;
      break;
    }
    case 'paragraph': {
      md += `${textVal}\n\n`;
      break;
    }
    case 'bulletListItem': {
      md += `- ${textVal}\n`;
      break;
    }
    case 'numberedListItem': {
      md += `1. ${textVal}\n`;
      break;
    }
    case 'checkListItem': {
      const checked = block.props?.checked ? 'x' : ' ';
      md += `- [${checked}] ${textVal}\n`;
      break;
    }
    case 'blockQuote': {
      md += `> ${textVal}\n\n`;
      break;
    }
    case 'codeBlock': {
      const lang = block.props?.language || '';
      md += `\`\`\`${lang}\n${textVal}\n\`\`\`\n\n`;
      break;
    }
    case 'image': {
      const url = block.props?.url || '';
      const altText = block.props?.name || block.props?.caption || 'Image';
      md += `![${altText}](${url})\n\n`;
      break;
    }
    default: {
      md += `${textVal}\n\n`;
      break;
    }
  }

  // Handle nested lists recursively
  if (block.children && Array.isArray(block.children) && block.children.length > 0) {
    const childMd = block.children
      .map((child: any) => {
        const childStr = blockToMarkdown(child);
        if (['bulletListItem', 'numberedListItem', 'checkListItem'].includes(blockType)) {
          return childStr
            .split('\n')
            .map((line) => (line ? `  ${line}` : ''))
            .join('\n');
        }
        return childStr;
      })
      .join('');
    md += childMd;
  }

  return md;
}

function blocksToMarkdown(blocks: any[]): string {
  if (!blocks || !Array.isArray(blocks)) return '';
  return blocks.map(blockToMarkdown).join('');
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing document id parameter.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Authenticate user via secure stateless session cookie
    const sealedCookie = getCookie(request, 'pouta_session');
    if (!sealedCookie) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized login session.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = env.DB;
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';
    const appId = env.GITHUB_APP_ID;
    const privateKeyB64 = env.GITHUB_APP_PRIVATE_KEY_B64;

    if (!db) {
      return new Response(
        JSON.stringify({ success: false, error: 'Cloudflare D1 Database binding "DB" not found.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let userToken = '';
    try {
      userToken = await verifySession(request, sessionSecret);
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Session cookie expired or corrupted.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch the isolated document from D1
    const doc = await db
      .prepare('SELECT * FROM documents WHERE id = ? LIMIT 1')
      .bind(id)
      .first();

    if (!doc) {
      return new Response(
        JSON.stringify({ success: false, error: `Document with ID "${id}" was not found in D1 edge cache.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if repository scope is set
    if (!doc.repo_owner || !doc.repo_name || !doc.github_installation_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Document lacks proper repository scope mapping. Please save again.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const repoOwner = doc.repo_owner;
    const repoName = doc.repo_name;
    const repoBranch = doc.repo_branch || 'main';
    const installationId = doc.github_installation_id;

    // 3. Dynamic Tenancy collaborator push check
    const isCollaborator = await verifyCollaborator(userToken, repoOwner, repoName);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unauthorized: You do not have collaborator push permissions to "${repoOwner}/${repoName}".`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!appId || !privateKeyB64 || appId === 'placeholder_github_app_id') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'GitHub App credentials are not configured in edge variables.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Exchange App JWT for repository Installation Access Token
    let instToken = '';
    try {
      instToken = await getInstallationAccessToken(appId, privateKeyB64, installationId);
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to exchange App JWT for Installation token: ${e.message || e}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Fetch pouta.config.json dynamically from target repository root
    const configUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/pouta.config.json?ref=${repoBranch}`;
    const configResponse = await fetch(configUrl, {
      method: 'GET',
      headers: {
        Authorization: `token ${instToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!configResponse.ok) {
      const errText = await configResponse.text();
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to read pouta.config.json from target repository root: ${errText}`,
        }),
        { status: configResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const configFileData: any = await configResponse.json();
    let schemaConfig: any = {};
    try {
      const decodedString = atob(configFileData.content.replace(/\s+/g, ''));
      schemaConfig = JSON.parse(decodedString);
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to parse pouta.config.json from Git repository: ${e.message || e}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Find schema profile matching active document type
    const typeConfig = schemaConfig.contentTypes?.find((t: any) => t.type === doc.type);
    if (!typeConfig) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Content type "${doc.type}" is not defined in the Connected Repository's pouta.config.json file.`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Replace {slug} token in writePath
    const resolvedPath = typeConfig.writePath.replace('{slug}', doc.slug);

    // 6. Parse content blocks
    let blocks = [];
    try {
      blocks = JSON.parse(doc.content_json);
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to parse JSON content blocks.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const markdownBody = blocksToMarkdown(blocks);

    // 7. Parse custom metadata properties and assemble dynamic YAML Frontmatter
    let metadata: Record<string, any> = {};
    try {
      metadata = JSON.parse(doc.metadata_json);
    } catch (e) {
      console.warn('Metadata JSON parsing failed, using empty object.');
    }

    // Escape frontmatter strings safely
    const escapeYaml = (val: any) => {
      if (val === undefined || val === null) return '';
      return String(val).replace(/"/g, '\\"');
    };

    let frontmatterRows = [
      `id: "${doc.id}"`,
      `type: "${doc.type}"`,
      `title: "${escapeYaml(doc.title)}"`,
    ];

    // dynamically loop over user-configured fields
    typeConfig.fields.forEach((field: any) => {
      let value = metadata[field.name];
      if ((field.type === 'slug' || field.name === 'slug') && (value === undefined || value === null || value === '')) {
        value = doc.slug;
      }
      if ((field.type === 'slug' || field.name === 'slug') && value) {
        value = String(value).toLowerCase().replace(/\s+/g, '-');
      }
      if (field.type === 'number') {
        frontmatterRows.push(`${field.name}: ${Number(value) || 0}`);
      } else if (field.type === 'list' || field.type === 'array' || field.type === 'tags') {
        let arr: string[] = [];
        if (Array.isArray(value)) {
          arr = value;
        } else if (typeof value === 'string') {
          arr = value.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        const escapedItems = arr.map(item => `"${escapeYaml(item)}"`);
        frontmatterRows.push(`${field.name}: [${escapedItems.join(', ')}]`);
      } else {
        frontmatterRows.push(`${field.name}: "${escapeYaml(value)}"`);
      }
    });

    const now = new Date().toISOString();
    frontmatterRows.push(`status: "published"`);
    frontmatterRows.push(`created_at: "${doc.created_at || now}"`);
    frontmatterRows.push(`published_at: "${now}"`);
    frontmatterRows.push(`updated_at: "${now}"`);

    const frontmatterString = `---
${frontmatterRows.join('\n')}
---

${markdownBody}`;

    // 8. Push commit to GitHub via REST APIs using the App Installation Access Token
    const gitUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${resolvedPath}?ref=${repoBranch}`;

    let sha: string | null = null;
    try {
      const getResponse = await fetch(gitUrl, {
        method: 'GET',
        headers: {
          Authorization: `token ${instToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Astro-PoutaCMS',
        },
      });

      if (getResponse.ok) {
        const fileData: any = await getResponse.json();
        sha = fileData.sha;
      }
    } catch (err) {
      console.error('Error fetching file SHA from GitHub:', err);
    }

    // Safe UTF-8 Base64 conversion
    const utf8Bytes = new TextEncoder().encode(frontmatterString);
    let base64Content = '';
    if (typeof Buffer !== 'undefined') {
      base64Content = Buffer.from(utf8Bytes).toString('base64');
    } else {
      const binaryString = Array.from(utf8Bytes)
        .map((b) => String.fromCharCode(b))
        .join('');
      base64Content = btoa(binaryString);
    }

    const putResponse = await fetch(gitUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${instToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Astro-PoutaCMS',
      },
      body: JSON.stringify({
        message: `docs(${doc.type}): publish "${doc.title}"`,
        content: base64Content,
        branch: repoBranch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putResponse.ok) {
      const gitError = await putResponse.text();
      return new Response(JSON.stringify({ success: false, error: `GitHub API error: ${gitError}` }), {
        status: putResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 9. Update document status inside database cache to 'published'
    await db
      .prepare('UPDATE documents SET status = "published", updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(id)
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully published to ${repoOwner}/${repoName} (${repoBranch}) at path ${resolvedPath}!`,
        path: resolvedPath,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An internal server error occurred while publishing to Git.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
