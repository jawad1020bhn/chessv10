#!/usr/bin/env node
'use strict';

// Verify a manually downloaded first-release Maia browser artifact against the
// exact package manifest. This is intentionally independent of the extension
// runtime so releases can be checked before installation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = require(path.join(root, 'engine/maia/maia-model-manifest.js'));
const modelId = process.argv[3] || manifest.DEFAULT_MODEL_ID;
const modelPath = process.argv[2];
const model = manifest.get(modelId);

if (!modelPath) {
  console.error(`Usage: node tools/verify-maia-artifact.js <path-to-model.onnx> [${manifest.DEFAULT_MODEL_ID}]`);
  process.exit(64);
}

const stat = fs.statSync(modelPath);
const hash = crypto.createHash('sha256');
const input = fs.createReadStream(modelPath);
input.on('error', error => { console.error(error.message); process.exitCode = 1; });
input.on('data', chunk => hash.update(chunk));
input.on('end', () => {
  const digest = hash.digest('hex');
  const sizeMatches = stat.size === model.expectedBytes;
  const digestMatches = digest === model.sha256;
  console.log(`Model: ${model.displayName} (${model.id})`);
  console.log(`Bytes: ${stat.size} ${sizeMatches ? 'OK' : `EXPECTED ${model.expectedBytes}`}`);
  console.log(`SHA-256: ${digest} ${digestMatches ? 'OK' : `EXPECTED ${model.sha256}`}`);
  if (!sizeMatches || !digestMatches) process.exitCode = 1;
});
