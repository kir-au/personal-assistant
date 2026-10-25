#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(arg, next);
      i += 1;
    } else {
      args.set(arg, true);
    }
  }
}

function usage() {
  console.log(`Usage:
  node scripts/import-chatgpt-export.mjs --source <chatgpt-export-dir> [--vault <personal-vault-dir>] [--timezone <iana-zone>] [--dry-run|--write] [--limit N] [--overwrite]

Examples:
  node scripts/import-chatgpt-export.mjs --source ~/Downloads/chatgpt-export --vault ~/personal-vault --dry-run
  node scripts/import-chatgpt-export.mjs --source ~/Downloads/chatgpt-export --vault ~/personal-vault --write

Output layout:
  raw/YYYY/MM/YYYY-MM-DD-conversation-title.md
  raw/YYYY/MM/YYYY-MM-DD-conversation-title.assets/file-id--original-name.ext

Notes:
  - Dry-run is the default unless --write is passed.
  - ChatGPT is stored as frontmatter/index metadata, not as a separate raw/chatgpt folder.
  - Assets stay in a sibling .assets directory next to their discussion Markdown file.
`);
}

const sourceDir = args.get('--source');
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const vaultDir = args.get('--vault') || process.env.PERSONAL_VAULT_DIR || path.join(homeDir, 'personal-vault');
const timezone = args.get('--timezone') || 'Australia/Sydney';
const dryRun = args.has('--dry-run') || !args.has('--write');
const overwrite = args.has('--overwrite');
const limit = args.has('--limit') ? Number(args.get('--limit')) : null;

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

if (!sourceDir || !fs.existsSync(sourceDir)) {
  usage();
  console.error(sourceDir ? `\nSource directory not found: ${sourceDir}` : '\nMissing required --source <chatgpt-export-dir>');
  process.exit(1);
}

if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
  console.error('--limit must be a positive number');
  process.exit(1);
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(value, fallback = 'untitled') {
  const slug = String(value || fallback)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

function yamlString(value) {
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(String(value));
}

function formatDateParts(unixSeconds) {
  const date = new Date((unixSeconds || 0) * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: parts.year || 'unknown',
    month: parts.month || 'unknown',
    day: parts.day || 'unknown',
    date: parts.year ? `${parts.year}-${parts.month}-${parts.day}` : 'unknown-date',
  };
}

function isoTime(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function cleanOriginalName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function mimeFor(filePath) {
  try {
    return execFileSync('file', ['--mime-type', '-b', filePath], { encoding: 'utf8' }).trim();
  } catch {
    return 'application/octet-stream';
  }
}

function extForMime(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
    'audio/wav': '.wav',
    'audio/mpeg': '.mp3',
    'video/mp4': '.mp4',
  };
  return map[mime] || '';
}

function normalizeAssetId(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/(?:file-service:\/\/|sediment:\/\/)?(file[-_][A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function scanAssetIds(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const id = normalizeAssetId(value);
    if (id) out.push(id);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanAssetIds(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) scanAssetIds(item, out);
  }
  return out;
}

function orderedMessages(conversation) {
  const mapping = conversation.mapping || {};
  const chain = [];
  const seen = new Set();
  let id = conversation.current_node;
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    chain.push(mapping[id]);
    id = mapping[id].parent;
  }
  return chain
    .reverse()
    .filter((node) => node.message && ['user', 'assistant', 'tool'].includes(node.message.author?.role));
}

function contentToMarkdown(message, assetById, usedAssetIds) {
  const content = message.content || {};
  const parts = content.parts || [];
  const blocks = [];

  if (content.content_type === 'reasoning_recap' && content.content) {
    blocks.push(`> ${content.content}`);
  }

  if (content.content_type === 'thoughts' && Array.isArray(content.thoughts)) {
    for (const thought of content.thoughts) {
      if (thought.summary) blocks.push(`> Reasoning summary: ${thought.summary}`);
      if (thought.content) blocks.push(`> ${thought.content}`);
    }
  }

  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.trim()) blocks.push(part.trim());
      continue;
    }
    if (!part || typeof part !== 'object') continue;

    if (part.content_type === 'audio_transcription' && part.text) {
      blocks.push(`_Audio transcription:_ ${part.text}`);
      continue;
    }

    const assetId = normalizeAssetId(part.asset_pointer || part.audio_asset_pointer?.asset_pointer || part.video_container_asset_pointer?.asset_pointer);
    if (assetId && assetById.has(assetId)) {
      const asset = assetById.get(assetId);
      usedAssetIds.add(assetId);
      if (asset.mime.startsWith('image/')) {
        blocks.push(`![${asset.originalName}](./${asset.assetsDirName}/${asset.targetName})`);
      } else {
        blocks.push(`[${asset.originalName}](./${asset.assetsDirName}/${asset.targetName})`);
      }
      continue;
    }

    if (part.text) {
      blocks.push(String(part.text).trim());
    } else if (part.content_type) {
      blocks.push(`_Unsupported ${part.content_type} content omitted from readable export._`);
    }
  }

  return blocks.join('\n\n').trim();
}

function makeAssetRecords(conversation, assetIds, assetsDirName, assetFileNames) {
  const records = [];
  for (const assetId of assetIds) {
    const datName = `${assetId}.dat`;
    const sourcePath = path.join(sourceDir, datName);
    if (!fs.existsSync(sourcePath)) continue;

    const mime = mimeFor(sourcePath);
    const mappedName = cleanOriginalName(assetFileNames[datName] || datName);
    const originalExt = path.extname(mappedName);
    const ext = originalExt || extForMime(mime) || '.bin';
    const baseName = path.basename(mappedName, originalExt || path.extname(mappedName));
    const targetName = `${assetId}--${slugify(baseName, 'asset')}${ext.toLowerCase()}`;
    records.push({
      conversationId: conversation.id,
      sourceDat: datName,
      sourcePath,
      originalName: mappedName,
      targetName,
      mime,
      sizeBytes: fs.statSync(sourcePath).size,
      assetsDirName,
    });
  }
  return records;
}

function resolveUniqueMarkdownPath(relativeDir, fileBase, conversationId, usedPaths) {
  let candidateBase = fileBase;
  let relativeMd = path.join(relativeDir, `${candidateBase}.md`);
  const idSuffix = String(conversationId || '').slice(0, 8);
  let counter = 2;

  while (
    usedPaths.has(relativeMd) ||
    (!overwrite && fs.existsSync(path.join(vaultDir, relativeMd)))
  ) {
    candidateBase = idSuffix && counter === 2
      ? `${fileBase}-${idSuffix}`
      : `${fileBase}-${counter}`;
    relativeMd = path.join(relativeDir, `${candidateBase}.md`);
    counter += 1;
  }

  usedPaths.add(relativeMd);
  return { fileBase: candidateBase, relativeMd };
}

function markdownForConversation(conversation, messages, assetRecords, paths) {
  const assetById = new Map(assetRecords.map((asset) => [asset.sourceDat.replace(/\.dat$/, ''), asset]));
  const usedAssetIds = new Set();
  const lines = [
    '---',
    'source: chatgpt-export',
    `conversation_id: ${yamlString(conversation.id)}`,
    `title: ${yamlString(conversation.title || 'Untitled')}`,
    `created: ${yamlString(isoTime(conversation.create_time))}`,
    `updated: ${yamlString(isoTime(conversation.update_time))}`,
    `vault_date: ${yamlString(paths.date)}`,
    `vault_timezone: ${yamlString(paths.timezone)}`,
    `model: ${yamlString(conversation.default_model_slug || '')}`,
    `conversation_template_id: ${yamlString(conversation.conversation_template_id || '')}`,
    `memory_scope: ${yamlString(conversation.memory_scope || '')}`,
    `message_count: ${messages.length}`,
    `mapping_node_count: ${Object.keys(conversation.mapping || {}).length}`,
    `asset_count: ${assetRecords.length}`,
    `import_batch: ${yamlString(paths.batchId)}`,
    '---',
    '',
    `# ${conversation.title || 'Untitled'}`,
    '',
    `- ChatGPT conversation id: \`${conversation.id}\``,
    `- Created: ${isoTime(conversation.create_time) || 'unknown'}`,
    `- Updated: ${isoTime(conversation.update_time) || 'unknown'}`,
    `- Source chunk: \`${conversation.__chunk}\``,
    '',
  ];

  for (const node of messages) {
    const message = node.message;
    const role = message.author?.role || 'unknown';
    const roleTitle = role === 'assistant' ? 'Assistant' : role === 'user' ? 'User' : role;
    const timestamp = isoTime(message.create_time);
    const body = contentToMarkdown(message, assetById, usedAssetIds);
    if (!body) continue;
    lines.push(`## ${roleTitle}${timestamp ? ` (${timestamp})` : ''}`);
    lines.push('');
    lines.push(body);
    lines.push('');
  }

  const metadataAssetIds = new Set(scanAssetIds(messages.map((node) => node.message?.metadata || {})));
  for (const id of metadataAssetIds) {
    if (assetById.has(id)) usedAssetIds.add(id);
  }

  if (assetRecords.length) {
    lines.push('## Assets');
    lines.push('');
    for (const asset of assetRecords) {
      const prefix = asset.mime.startsWith('image/') ? '!' : '';
      const label = asset.originalName;
      lines.push(`- ${prefix}[${label}](./${asset.assetsDirName}/${asset.targetName})`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

const assetFileNames = readJson(path.join(sourceDir, 'conversation_asset_file_names.json'), {});
const conversationFiles = fs.readdirSync(sourceDir).filter((file) => /^conversations(?:-\d+)?\.json$/.test(file)).sort();
const batchId = `${path.basename(sourceDir).match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'unknown-date'}-chatgpt-export`;
const usedPaths = new Set();
const conversationIndex = [];
const assetIndex = [];
const errors = [];
let imported = 0;

if (conversationFiles.length === 0) {
  console.error(`No conversations JSON files found in ${sourceDir}`);
  process.exit(1);
}

for (const file of conversationFiles) {
  const conversations = readJson(path.join(sourceDir, file), []);
  for (const conversation of conversations) {
    if (limit && imported >= limit) break;
    conversation.__chunk = file;
    const dateParts = formatDateParts(conversation.create_time);
    const baseSlug = slugify(conversation.title || 'untitled');
    const relativeDir = path.join('raw', dateParts.year, dateParts.month);
    const { fileBase, relativeMd } = resolveUniqueMarkdownPath(
      relativeDir,
      `${dateParts.date}-${baseSlug}`,
      conversation.id,
      usedPaths
    );

    const assetsDirName = `${fileBase}.assets`;
    const messages = orderedMessages(conversation);
    const assetIds = [...new Set([
      ...scanAssetIds(messages.map((node) => node.message?.content || {})),
      ...scanAssetIds(messages.map((node) => node.message?.metadata || {})),
    ])];
    const assetRecords = makeAssetRecords(conversation, assetIds, assetsDirName, assetFileNames);
      const paths = {
        batchId,
        date: dateParts.date,
        timezone,
        mdAbs: path.join(vaultDir, relativeMd),
      assetDirAbs: path.join(vaultDir, relativeDir, assetsDirName),
      relativeMd,
      relativeDir,
      assetsDirName,
    };

    try {
      const md = markdownForConversation(conversation, messages, assetRecords, paths);
      conversationIndex.push({
        id: conversation.id,
        title: conversation.title || 'Untitled',
        created: isoTime(conversation.create_time),
        updated: isoTime(conversation.update_time),
        vaultDate: dateParts.date,
        vaultTimezone: timezone,
        conversationTemplateId: conversation.conversation_template_id || null,
        memoryScope: conversation.memory_scope || null,
        rawPath: relativeMd.split(path.sep).join('/'),
        messageCount: messages.length,
        mappingNodeCount: Object.keys(conversation.mapping || {}).length,
        assetCount: assetRecords.length,
        sourceChunk: file,
        importBatch: batchId,
      });

      for (const asset of assetRecords) {
        const relativeAssetPath = path.join(relativeDir, assetsDirName, asset.targetName).split(path.sep).join('/');
        assetIndex.push({
          conversationId: conversation.id,
          title: conversation.title || 'Untitled',
          sourceDat: asset.sourceDat,
          originalName: asset.originalName,
          mime: asset.mime,
          sizeBytes: asset.sizeBytes,
          vaultPath: relativeAssetPath,
          rawPath: relativeMd.split(path.sep).join('/'),
          importBatch: batchId,
        });
      }

      if (!dryRun) {
        fs.mkdirSync(path.dirname(paths.mdAbs), { recursive: true });
        fs.writeFileSync(paths.mdAbs, md, 'utf8');
        if (assetRecords.length) fs.mkdirSync(paths.assetDirAbs, { recursive: true });
        for (const asset of assetRecords) {
          fs.copyFileSync(asset.sourcePath, path.join(paths.assetDirAbs, asset.targetName));
        }
      }
      imported += 1;
    } catch (error) {
      errors.push({ id: conversation.id, title: conversation.title, error: error.message });
    }
  }
}

const indexDir = path.join(vaultDir, 'indexes');
const conversationsIndexPath = path.join(indexDir, 'chatgpt-conversations.jsonl');
const assetsIndexPath = path.join(indexDir, 'chatgpt-assets.jsonl');
const manifestPath = path.join(indexDir, 'chatgpt-import-manifest.md');

const manifest = [
  '---',
  'source: chatgpt-export',
  `import_batch: ${yamlString(batchId)}`,
  `source_dir: ${yamlString(sourceDir)}`,
  `created_at: ${yamlString(new Date().toISOString())}`,
  `dry_run: ${dryRun}`,
  `timezone: ${yamlString(timezone)}`,
  `overwrite: ${overwrite}`,
  '---',
  '',
  '# ChatGPT Import Manifest',
  '',
  `- Source directory: \`${sourceDir}\``,
  `- Vault directory: \`${vaultDir}\``,
  `- Timezone: \`${timezone}\``,
  `- Conversations imported: ${conversationIndex.length}`,
  `- Assets copied: ${assetIndex.length}`,
  `- Errors: ${errors.length}`,
  `- Conversation index: \`indexes/chatgpt-conversations.jsonl\``,
  `- Asset index: \`indexes/chatgpt-assets.jsonl\``,
  '',
  '## Layout',
  '',
  '```text',
  'raw/YYYY/MM/',
  '  YYYY-MM-DD-conversation-title.md',
  '  YYYY-MM-DD-conversation-title.assets/',
  '    file-id--original-name.ext',
  '```',
  '',
  '## Notes',
  '',
  '- `user.json` and `user_settings.json` were not imported into readable vault content.',
  '- ChatGPT origin is stored in frontmatter/index metadata, not as a separate top-level raw folder.',
  '- Markdown files use relative links to adjacent `.assets/` directories.',
  '- Index files are generated for dashboard/search/review workflows and can be rebuilt from raw files.',
  '',
];

if (errors.length) {
  manifest.push('## Errors', '');
  for (const error of errors) {
    manifest.push(`- \`${error.id}\` ${error.title || ''}: ${error.error}`);
  }
  manifest.push('');
}

if (!dryRun) {
  fs.mkdirSync(indexDir, { recursive: true });
  fs.writeFileSync(conversationsIndexPath, `${conversationIndex.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(assetsIndexPath, `${assetIndex.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(manifestPath, manifest.join('\n'), 'utf8');
}

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'write',
  sourceDir,
  vaultDir,
  timezone,
  overwrite,
  conversations: conversationIndex.length,
  assets: assetIndex.length,
  errors: errors.length,
  firstConversations: conversationIndex.slice(0, 5),
  firstAssets: assetIndex.slice(0, 5),
  wouldWrite: {
    conversationsIndexPath,
    assetsIndexPath,
    manifestPath,
  },
}, null, 2));
