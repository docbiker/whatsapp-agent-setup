// listener.js — WhatsApp Agent Listener (v1.1.0)
// CUSTOMIZE: Replace all <agentname> placeholders below.
//
// Channel security (v1.1.0+) — all driven by env vars (typically /run/openclaw-env):
//   ALLOW_GROUPS       "true" to accept group messages (@g.us). Default: false (blocked).
//   ALLOWED_CONTACTS   CSV of allowed JIDs (e.g. "5548999999999@c.us,5511988888888@c.us").
//                      Empty/unset = accept all 1:1 contacts. Recommended for production.
//   READ_ONLY          "true" to log inbound but never trigger LLM nor send. Default: false.
//                      Useful for fase-1 deployment (capture + classify, no auto-reply).

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// CUSTOMIZE: adjust these paths
const QUEUE_DIR = '/root/<agentname>/queue';
const INBOUND_FILE = path.join(QUEUE_DIR, 'inbound.json');
const OUTBOUND_FILE = path.join(QUEUE_DIR, 'outbound.json');
const PROCESSED_IDS_FILE = path.join(QUEUE_DIR, 'processed-message-ids.json');
const READ_ONLY_LOG = path.join(QUEUE_DIR, 'read-only-log.json');
const PROCESSOR_SCRIPT = path.join(__dirname, 'processor.js');
const AUTH_DATA_PATH = '/root/.openclaw/data/whatsapp-auth-<agentname>';  // CUSTOMIZE
const AUTH_CLIENT_ID = '<agentname>-listener';  // CUSTOMIZE

// --- Channel security flags (read once at boot) ---
const ALLOW_GROUPS = String(process.env.ALLOW_GROUPS || 'false').toLowerCase() === 'true';
const READ_ONLY = String(process.env.READ_ONLY || 'false').toLowerCase() === 'true';
const ALLOWED_CONTACTS = (process.env.ALLOWED_CONTACTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWLIST_ACTIVE = ALLOWED_CONTACTS.length > 0;

console.log(`[BOOT] ALLOW_GROUPS=${ALLOW_GROUPS} READ_ONLY=${READ_ONLY} ALLOWLIST=${ALLOWLIST_ACTIVE ? ALLOWED_CONTACTS.length + ' contacts' : 'inactive (accept all 1:1)'}`);

fs.mkdirSync(QUEUE_DIR, { recursive: true });

let processorRunning = false; // concurrency guard

// --- Atomic file writes (write-tmp + rename, prevents corruption on crash) ---
function atomicWriteFile(targetPath, data) {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, targetPath);
}

function loadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function loadProcessedIds() {
  return loadJSON(PROCESSED_IDS_FILE, []);
}

function saveProcessedIds(ids) {
  atomicWriteFile(PROCESSED_IDS_FILE, JSON.stringify(ids.slice(-500)));
}

function enqueueMessage(msg) {
  const queue = loadJSON(INBOUND_FILE, []);
  queue.push({
    id: msg.id._serialized,
    from: msg.from,
    body: msg.body,
    timestamp: Date.now(),
  });
  atomicWriteFile(INBOUND_FILE, JSON.stringify(queue, null, 2));
}

function logReadOnly(msg) {
  const log = loadJSON(READ_ONLY_LOG, []);
  log.push({
    id: msg.id._serialized,
    from: msg.from,
    body: msg.body,
    timestamp: Date.now(),
  });
  atomicWriteFile(READ_ONLY_LOG, JSON.stringify(log.slice(-1000), null, 2));
}

function triggerProcessor() {
  if (processorRunning) return;
  processorRunning = true;
  execFile('node', [PROCESSOR_SCRIPT], { env: process.env }, (err) => {
    processorRunning = false;
    if (err) console.error('[PROCESSOR ERROR]', err.message);
  });
}

// --- Filter chain: returns null to accept, or a string reason to drop ---
function filterMessage(msg) {
  if (msg.fromMe) return 'self';
  // Group filter — @g.us is WhatsApp's group JID suffix
  if (msg.from.endsWith('@g.us') && !ALLOW_GROUPS) return 'group';
  // Broadcast/status JID
  if (msg.from === 'status@broadcast') return 'broadcast';
  // Allowlist filter
  if (ALLOWLIST_ACTIVE && !ALLOWED_CONTACTS.includes(msg.from)) return 'not-in-allowlist';
  return null;
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: AUTH_DATA_PATH,
    clientId: AUTH_CLIENT_ID,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
});

client.on('qr', (qr) => {
  console.log('[QR] Scan with the dedicated WhatsApp number:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('[OK] WhatsApp connected and ready!'));

client.on('message', async (msg) => {
  const dropReason = filterMessage(msg);
  if (dropReason) {
    if (dropReason !== 'self') console.log(`[BLOCK] from=${msg.from} reason=${dropReason}`);
    return;
  }

  const processedIds = loadProcessedIds();
  const msgId = msg.id._serialized;
  if (processedIds.includes(msgId)) return; // dedup
  processedIds.push(msgId);
  saveProcessedIds(processedIds);

  // READ_ONLY: capture and stop. No typing indicator, no LLM call, no reply.
  if (READ_ONLY) {
    logReadOnly(msg);
    console.log(`[READ_ONLY] logged from=${msg.from}`);
    return;
  }

  // Immediate typing indicator (UX feedback)
  try {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
  } catch {}

  enqueueMessage(msg);
  triggerProcessor(); // direct trigger — do not rely solely on timer
  console.log(`[ACCEPT] from=${msg.from}`);
});

// Send outbound responses (every 5s) — disabled in READ_ONLY mode
if (!READ_ONLY) {
  setInterval(async () => {
    const outbound = loadJSON(OUTBOUND_FILE, []);
    if (outbound.length === 0) return;

    const [next, ...rest] = outbound;
    atomicWriteFile(OUTBOUND_FILE, JSON.stringify(rest, null, 2));

    try {
      await client.sendMessage(next.to, next.body);
      console.log(`[SENT] → ${next.to}`);
    } catch (e) {
      console.error('[SEND ERROR]', e.message);
    }
  }, 5000);
} else {
  console.log('[READ_ONLY] outbound loop disabled — no messages will be sent');
}

client.initialize();
