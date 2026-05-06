// processor.js — WhatsApp Agent Processor (oneshot)
// CUSTOMIZE: adjust QUEUE_DIR and HANDLER paths below.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const QUEUE_DIR = '/root/<agentname>/queue';  // CUSTOMIZE
const INBOUND_FILE = path.join(QUEUE_DIR, 'inbound.json');
const OUTBOUND_FILE = path.join(QUEUE_DIR, 'outbound.json');
const PROCESSED_FILE = path.join(QUEUE_DIR, 'processed.json');
const HANDLER = path.join(__dirname, 'api-handler.py');  // CUSTOMIZE if different dir

const FALLBACK_MSG = 'Technical difficulties at the moment. Please try again in a few minutes.';

async function main() {
  let inbound = [];
  try { inbound = JSON.parse(fs.readFileSync(INBOUND_FILE, 'utf8')); } catch { return; }
  if (inbound.length === 0) return;

  const [msg, ...rest] = inbound;
  fs.writeFileSync(INBOUND_FILE, JSON.stringify(rest, null, 2));

  return new Promise((resolve) => {
    const proc = execFile('python3', [HANDLER], { timeout: 35000, env: process.env }, (err, stdout) => {
      let outbound = [];
      try { outbound = JSON.parse(fs.readFileSync(OUTBOUND_FILE, 'utf8')); } catch {}

      if (err) {
        console.error('[HANDLER ERROR]', err.message);
        outbound.push({ to: msg.from, body: FALLBACK_MSG });
      } else {
        try {
          const result = JSON.parse(stdout.trim());
          outbound.push({ to: msg.from, body: result.response });
        } catch {
          outbound.push({ to: msg.from, body: FALLBACK_MSG });
        }
      }

      fs.writeFileSync(OUTBOUND_FILE, JSON.stringify(outbound, null, 2));

      // Archive to processed history
      let processed = [];
      try { processed = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8')); } catch {}
      processed.push({ ...msg, processedAt: Date.now() });
      fs.writeFileSync(PROCESSED_FILE, JSON.stringify(processed.slice(-200), null, 2));

      resolve();
    });

    proc.stdin.write(JSON.stringify(msg));
    proc.stdin.end();
  });
}

main().catch(console.error);
