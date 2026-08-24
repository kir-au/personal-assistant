import { createHash } from 'node:crypto';
import { PersonalVaultClient } from './personal-vault-client.mjs';

const CONTRACT_VERSION = 'personal-vault/v1';
const ACTOR = { kind: 'application', id: 'personal-assistant', displayName: 'Personal Assistant' };
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MIME_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;.*)?$/;
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function hash(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function idempotencyKey(prefix, value) {
  return `assistant.${prefix}.${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function mutationId(key) {
  const bytes = createHash('sha256').update(key).digest();
  let suffix = '';
  for (let index = 0; index < 26; index += 1) suffix += ID_ALPHABET[bytes[index % bytes.length] & 31];
  return `pvm_${suffix}`;
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function approval(requestedAt, key) {
  return {
    kind: 'user',
    approvedAt: requestedAt,
    approvedBy: ACTOR,
    evidenceRef: `assistant:${key}`,
  };
}

function directProvenance(capturedAt = now()) {
  return { origin: 'direct', capturedAt, capturedBy: ACTOR };
}

function buildMutation(operation, key, requestedAt = now(), provenance = directProvenance(requestedAt)) {
  return {
    contractVersion: CONTRACT_VERSION,
    mutationId: mutationId(key),
    requestedAt,
    requestedBy: ACTOR,
    idempotencyKey: key,
    approval: approval(requestedAt, key),
    operation,
    provenance,
  };
}

function captureMarkdown({ input, title, source, intent, projectId, createdAt }) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `created: ${JSON.stringify(createdAt)}`,
    `source: ${JSON.stringify(source)}`,
    `capture_intent: ${JSON.stringify(intent)}`,
    projectId ? `project: ${JSON.stringify(projectId)}` : '',
    'privacy: private',
    '---',
    '',
    `# ${title}`,
    '',
    input,
    '',
  ].filter(Boolean).join('\n');
}

function normalizeAttachment(attachment, index) {
  let mimeType = String(attachment?.mimeType || '').trim().toLowerCase();
  let base64 = String(attachment?.dataBase64 || '').replace(/\s+/g, '');
  if (attachment?.dataUrl) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(attachment.dataUrl));
    if (!match) throw new Error('Attachment dataUrl must be a base64 data URL.');
    mimeType ||= match[1].toLowerCase();
    base64 ||= match[2].replace(/\s+/g, '');
  }
  if (!MIME_TYPE.test(mimeType)) throw new Error('Attachment must include a valid MIME type.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || !base64) throw new Error('Attachment must include valid non-empty base64 bytes.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== base64) throw new Error('Attachment base64 bytes are invalid.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment is ${bytes.length} bytes; limit is ${MAX_ATTACHMENT_BYTES} bytes.`);
  return {
    bytes,
    mimeType,
    originalName: String(attachment?.name || `attachment-${index + 1}`).slice(0, 1024),
    alt: String(attachment?.alt || attachment?.name || `attachment ${index + 1}`).slice(0, 4096),
    caption: attachment?.caption ? String(attachment.caption).slice(0, 4096) : undefined,
  };
}

function proposalForCapture(capture) {
  const project = capture.metadata['assistant.project-id'] || 'inbox';
  return {
    id: 'review-capture',
    label: `Review capture for ${project}`,
    preview: 'Keep this source record and review it before any Assistant-owned projection is changed.',
    action: { kind: 'assistant.review', captureRecordId: capture.recordId, project },
  };
}

function proposalMarkdown(capture, proposal) {
  return [
    `# Capture review: ${capture.title || capture.recordId}`,
    '',
    `Source record: ${capture.recordId}`,
    '',
    '## Proposal',
    '',
    `- ${proposal.id}: ${proposal.label}`,
    `- ${proposal.preview}`,
    '',
  ].join('\n');
}

async function findOne(client, metadata) {
  const page = await client.list({ state: 'active', metadata, limit: 2 });
  return page.records[0] || null;
}

async function existingAsset(client, record, asset) {
  const contentHash = hash(asset.bytes);
  for (const reference of record.assetRefs || []) {
    const result = await client.getAsset(reference.assetId);
    if (result.asset.contentHash === contentHash && result.asset.byteLength === asset.bytes.length && result.asset.mediaType === asset.mimeType) {
      return { assetId: result.asset.assetId, mime: asset.mimeType, sizeBytes: asset.bytes.length, originalName: result.asset.originalName || asset.originalName, alt: asset.alt, ...(asset.caption ? { caption: asset.caption } : {}) };
    }
  }
  return null;
}

export async function createCapture(input, { title, projectId, intent = 'note', attachments = [], source = 'chatgpt-mobile', client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  const preparedAssets = attachments.map(normalizeAttachment);
  const createdAt = now();
  const titleText = title || `Capture - ${today()}`;
  const fingerprint = { input, title: titleText, projectId: projectId || null, intent, source };
  const captureKey = idempotencyKey('capture', fingerprint);
  const fingerprintHash = hash(stableJson(fingerprint));
  const markdown = captureMarkdown({ input, title: titleText, source, intent, projectId, createdAt });
  try {
    let record = await findOne(ownedClient, { 'assistant.capture-fingerprint': fingerprintHash });
    if (!record) {
      const result = await ownedClient.create(buildMutation({
        type: 'record.create',
        record: {
          privacy: 'private',
          title: titleText,
          content: { format: 'markdown', text: markdown, hash: hash(markdown), language: 'en' },
          provenance: directProvenance(createdAt),
          assetRefs: [],
          metadata: {
            'assistant.record-kind': 'capture',
            'assistant.capture-source': source,
            'assistant.capture-intent': intent,
            'assistant.capture-fingerprint': fingerprintHash,
            ...(projectId ? { 'assistant.project-id': projectId } : {}),
          },
        },
      }, captureKey, createdAt));
      record = result.record;
    }

    const assets = [];
    for (const [index, asset] of preparedAssets.entries()) {
      const existing = await existingAsset(ownedClient, record, asset);
      if (existing) {
        assets.push(existing);
        continue;
      }
      const contentHash = hash(asset.bytes);
      const assetKey = idempotencyKey('capture-asset', { recordId: record.recordId, contentHash, index, originalName: asset.originalName });
      const result = await ownedClient.attachAsset(buildMutation({
        type: 'asset.attach',
        recordId: record.recordId,
        baseRevision: record.revision,
        asset: {
          privacy: 'private',
          mediaType: asset.mimeType,
          byteLength: asset.bytes.length,
          contentHash,
          originalName: asset.originalName,
          provenance: directProvenance(createdAt),
          metadata: { 'assistant.capture-record-id': record.recordId, 'assistant.capture-asset-index': index },
        },
        reference: { role: 'attachment', ...(asset.caption ? { caption: asset.caption } : {}) },
        payload: { encoding: 'base64', dataBase64: asset.bytes.toString('base64') },
      }, assetKey, createdAt));
      record = result.record;
      assets.push({
        assetId: result.asset.assetId,
        mime: asset.mimeType,
        sizeBytes: asset.bytes.length,
        originalName: asset.originalName,
        alt: asset.alt,
        ...(asset.caption ? { caption: asset.caption } : {}),
      });
    }

    return {
      recordId: record.recordId,
      capturePath: record.recordId,
      path: record.recordId,
      title: record.title || titleText,
      created: record.createdAt,
      assetCount: assets.length,
      assets,
      storage: 'personal-vault-api',
      markdown: record.content.text,
      record,
    };
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function attachAssets(recordId, attachments, { client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  const preparedAssets = attachments.map(normalizeAttachment);
  const createdAt = now();
  try {
    let record = await ownedClient.get(recordId);
    const assets = [];
    for (const [index, asset] of preparedAssets.entries()) {
      const existing = await existingAsset(ownedClient, record, asset);
      if (existing) {
        assets.push(existing);
        continue;
      }
      const contentHash = hash(asset.bytes);
      const assetKey = idempotencyKey('capture-asset', { recordId: record.recordId, contentHash, index, originalName: asset.originalName });
      const result = await ownedClient.attachAsset(buildMutation({
        type: 'asset.attach',
        recordId: record.recordId,
        baseRevision: record.revision,
        asset: {
          privacy: 'private',
          mediaType: asset.mimeType,
          byteLength: asset.bytes.length,
          contentHash,
          originalName: asset.originalName,
          provenance: directProvenance(createdAt),
          metadata: { 'assistant.capture-record-id': record.recordId, 'assistant.capture-asset-index': index },
        },
        reference: { role: 'attachment', ...(asset.caption ? { caption: asset.caption } : {}) },
        payload: { encoding: 'base64', dataBase64: asset.bytes.toString('base64') },
      }, assetKey, createdAt));
      record = result.record;
      assets.push({ assetId: result.asset.assetId, mime: asset.mimeType, sizeBytes: asset.bytes.length, originalName: asset.originalName, alt: asset.alt, ...(asset.caption ? { caption: asset.caption } : {}) });
    }
    return { record, assets };
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function createProposal(capture, { client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  const proposal = proposalForCapture(capture);
  const createdAt = now();
  const proposalSet = { captureRecordId: capture.recordId, created: createdAt, status: 'proposed', proposals: [proposal], questions: [] };
  const key = idempotencyKey('capture-proposal', { captureRecordId: capture.recordId, proposal });
  try {
    let record = await findOne(ownedClient, { 'assistant.record-kind': 'capture-proposal', 'assistant.capture-record-id': capture.recordId });
    if (!record) {
      const markdown = proposalMarkdown(capture, proposal);
      const result = await ownedClient.create(buildMutation({
        type: 'record.create',
        record: {
          privacy: 'private',
          title: `Capture review: ${capture.title || capture.recordId}`,
          content: { format: 'markdown', text: markdown, hash: hash(markdown), language: 'en' },
          provenance: { origin: 'derivation', capturedAt: createdAt, capturedBy: ACTOR, sourceRecordIds: [capture.recordId], processor: { id: 'personal-assistant.capture-review', version: '1.0.0' } },
          assetRefs: [],
          metadata: { 'assistant.record-kind': 'capture-proposal', 'assistant.capture-record-id': capture.recordId, 'assistant.proposal-set': proposalSet },
        },
      }, key, createdAt, { origin: 'derivation', capturedAt: createdAt, capturedBy: ACTOR, sourceRecordIds: [capture.recordId], processor: { id: 'personal-assistant.capture-review', version: '1.0.0' } }));
      record = result.record;
    }
    return { ...record.metadata['assistant.proposal-set'], proposalRecordId: record.recordId };
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function getProposal(captureRecordId, { client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  try {
    const record = await findOne(ownedClient, { 'assistant.record-kind': 'capture-proposal', 'assistant.capture-record-id': captureRecordId });
    return record ? { ...record.metadata['assistant.proposal-set'], proposalRecordId: record.recordId } : null;
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function approveProposal(captureRecordId, proposalId, { client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  try {
    const proposalSet = await getProposal(captureRecordId, { client: ownedClient });
    const proposal = proposalSet?.proposals?.find((item) => item.id === proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} was not found for ${captureRecordId}.`);
    const createdAt = now();
    const key = idempotencyKey('approved-action', { captureRecordId, proposalId, proposal });
    const markdown = [
      '# Approved Assistant action',
      '',
      `Capture record: ${captureRecordId}`,
      `Proposal: ${proposalId}`,
      '',
      'This is an Assistant-owned action record. A separate Assistant processor may project it into application-specific state.',
      '',
    ].join('\n');
    const result = await ownedClient.create(buildMutation({
      type: 'record.create',
      record: {
        privacy: 'private',
        title: `Approved action: ${proposal.label}`,
        content: { format: 'markdown', text: markdown, hash: hash(markdown), language: 'en' },
        provenance: { origin: 'derivation', capturedAt: createdAt, capturedBy: ACTOR, sourceRecordIds: [captureRecordId], processor: { id: 'personal-assistant.approved-action', version: '1.0.0' } },
        assetRefs: [],
        metadata: { 'assistant.record-kind': 'approved-action', 'assistant.capture-record-id': captureRecordId, 'assistant.proposal-id': proposalId, 'assistant.action': proposal.action },
      },
    }, key, createdAt, { origin: 'derivation', capturedAt: createdAt, capturedBy: ACTOR, sourceRecordIds: [captureRecordId], processor: { id: 'personal-assistant.approved-action', version: '1.0.0' } }));
    return { proposal, actionRecordId: result.record.recordId, replayed: result.replayed };
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function readTodayProjection(date = today(), { client } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  try {
    const record = await findOne(ownedClient, { 'assistant.record-kind': 'today-projection', 'assistant.projection-date': date });
    return record ? record.metadata['assistant.projection'] || { date, tasks: [] } : { date, generatedAt: null, tasks: [] };
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}

export async function saveTodayProjection(projection, { client, migration = false } = {}) {
  const ownedClient = client || new PersonalVaultClient();
  const date = projection.date || today();
  const createdAt = now();
  const key = idempotencyKey('today-projection', { date, projection });
  const markdown = [`# Today projection: ${date}`, '', ...(projection.tasks || []).map((task) => `- ${task.title || 'Untitled task'}`), ''].join('\n');
  try {
    const existing = await findOne(ownedClient, { 'assistant.record-kind': 'today-projection', 'assistant.projection-date': date });
    if (existing) return existing;
    const provenance = migration
      ? { origin: 'migration', capturedAt: createdAt, capturedBy: { kind: 'migration', id: 'personal-assistant-projection-migration', displayName: 'Personal Assistant migration' }, sourceLocator: 'legacy:structured/plans/daily-projection.json' }
      : directProvenance(createdAt);
    const result = await ownedClient.create(buildMutation({
      type: 'record.create',
      record: {
        privacy: 'private',
        title: `Today projection: ${date}`,
        content: { format: 'markdown', text: markdown, hash: hash(markdown), language: 'en' },
        provenance,
        assetRefs: [],
        metadata: { 'assistant.record-kind': 'today-projection', 'assistant.projection-date': date, 'assistant.projection': { ...projection, date } },
      },
    }, key, createdAt, provenance));
    return result.record;
  } finally {
    if (!client) await ownedClient.close().catch(() => {});
  }
}
