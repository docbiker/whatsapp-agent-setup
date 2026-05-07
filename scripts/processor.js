// processor.js — WhatsApp Agent Processor (oneshot, v1.1.0)
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

async function main() {
  const inbound = loadJSON(INBOUND_FILE, []);
  if (inbound.length === 0) return;

  const [msg, ...rest] = inbound;
  atomicWriteFile(INBOUND_FILE, JSON.stringify(rest, null, 2));

  return new Promise((resolve) => {
    const proc = execFile('python3', [HANDLER], { timeout: 35000, env: process.env }, (err, stdout) => {
      const outbound = loadJSON(OUTBOUND_FILE, []);

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

      atomicWriteFile(OUTBOUND_FILE, JSON.stringify(outbound, null, 2));

      // Archive to processed history
      const processed = loadJSON(PROCESSED_FILE, []);
      processed.push({ ...msg, processedAt: Date.now() });
      atomicWriteFile(PROCESSED_FILE, JSON.stringify(processed.slice(-200), null, 2));

      resolve();
    });

    proc.stdin.write(JSON.stringify(msg));
    proc.stdin.end();
  });
}

main().catch(console.error);
