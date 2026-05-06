// listener.js — WhatsApp Agent Listener
// CUSTOMIZE: Replace all <agentname>, <AGENT_NAME>, and paths below.

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
const PROCESSOR_SCRIPT = path.join(__dirname, 'processor.js');
const AUTH_DATA_PATH = '/root/.openclaw/data/whatsapp-auth-<agentname>';  // CUSTOMIZE
const AUTH_CLIENT_ID = '<agentname>-listener';  // CUSTOMIZE

fs.mkdirSync(QUEUE_DIR, { recursive: true });

let processorRunning = false; // concurrency guard

function loadProcessedIds() {
  try { return JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8')); }
  catch { return []; }
}

function saveProcessedIds(ids) {
  fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(ids.slice(-500)));
}

function enqueueMessage(msg) {
  let queue = [];
  try { queue = JSON.parse(fs.readFileSync(INBOUND_FILE, 'utf8')); } catch {}
  queue.push({
    id: msg.id._serialized,
    from: msg.from,
    body: msg.body,
    timestamp: Date.now(),
  });
  fs.writeFileSync(INBOUND_FILE, JSON.stringify(queue, null, 2));
}

function triggerProcessor() {
  if (processorRunning) return;
  processorRunning = true;
  execFile('node', [PROCESSOR_SCRIPT], { env: process.env }, (err) => {
    processorRunning = false;
    if (err) console.error('[PROCESSOR ERROR]', err.message);
  });
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
  if (msg.fromMe) return;

  const processedIds = loadProcessedIds();
  const msgId = msg.id._serialized;
  if (processedIds.includes(msgId)) return; // dedup

  processedIds.push(msgId);
  saveProcessedIds(processedIds);

  // Immediate typing indicator (UX feedback)
  try {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
  } catch {}

  enqueueMessage(msg);
  triggerProcessor(); // direct trigger — do not rely solely on timer
});

// Send outbound responses (every 5s)
setInterval(async () => {
  let outbound = [];
  try { outbound = JSON.parse(fs.readFileSync(OUTBOUND_FILE, 'utf8')); } catch { return; }
  if (outbound.length === 0) return;

  const [next, ...rest] = outbound;
  fs.writeFileSync(OUTBOUND_FILE, JSON.stringify(rest, null, 2));

  try {
    await client.sendMessage(next.to, next.body);
    console.log(`[SENT] → ${next.to}`);
  } catch (e) {
    console.error('[SEND ERROR]', e.message);
  }
}, 5000);

client.initialize();
