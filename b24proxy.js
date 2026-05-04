'use strict';

const https = require('https');
const url   = require('url');

function proxyToBitrix(webhookBase, method, params) {
  return new Promise((resolve, reject) => {
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
        catch { reject(new Error('Invalid JSON: ' + raw.slice(0, 200))); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { webhook, method, params } = payload;

  if (!webhook || !webhook.startsWith('http') || !webhook.includes('/rest/')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid webhook' }) };
  }

  try {
    const data = await proxyToBitrix(webhook, method, params);
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
