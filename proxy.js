'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Rate-limit queue: 2 req/sec to Bitrix24
const INTERVAL_MS = 520;
let lastCallAt = 0;
let queueTimer = null;
const pendingQ = [];

function scheduleNext() {
  if (queueTimer || pendingQ.length === 0) return;
  const now  = Date.now();
  const wait = Math.max(0, lastCallAt + INTERVAL_MS - now);
  queueTimer = setTimeout(() => {
    queueTimer = null;
    if (pendingQ.length === 0) return;
    const { fn } = pendingQ.shift();
    lastCallAt = Date.now();
    fn();
    scheduleNext();
  }, wait);
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    pendingQ.push({
      fn: () => {
        const result = fn();
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          resolve(result);
        }
      }
    });
    scheduleNext();
  });
}

function proxyToBitrix(webhookBase, method, params) {
  return enqueue(() => new Promise((resolve, reject) => {
    const targetUrl = webhookBase.replace(/\/$/, '') + '/' + method + '.json';
    const body      = JSON.stringify(params || {});
    const parsed    = new url.URL(targetUrl);

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Invalid JSON from Bitrix24: ' + raw.slice(0, 200))); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  }));
}

function isValidWebhook(w) {
  if (typeof w !== 'string') return false;
  if (!w.startsWith('http'))  return false;
  if (!w.includes('/rest/'))  return false;
  return true;
}

function serveStatic(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext    = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, time: new Date().toISOString(), queue: pendingQ.length }));
    return;
  }

  if (req.method === 'POST' && parsed.pathname === '/b24proxy') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const { webhook, method, params } = payload;

      if (!isValidWebhook(webhook)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid webhook URL' }));
        return;
      }
      if (!method || typeof method !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'method required' }));
        return;
      }

      console.log(`[${new Date().toISOString()}] ${method} | queue: ${pendingQ.length}`);

      try {
        const data = await proxyToBitrix(webhook, method, params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET') { serveStatic(req, res); return; }

  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`DupeHunter proxy → http://localhost:${PORT}`);
  console.log(`Health check    → http://localhost:${PORT}/health`);
});
