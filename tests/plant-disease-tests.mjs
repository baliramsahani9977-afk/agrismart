import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../plant-disease-engine.js', import.meta.url), 'utf8');
const browserWindow = {};
runInNewContext(source, { window: browserWindow });
const engine = browserWindow.AgriPlantDiseaseEngine;

test('validates supported image MIME types and the 5 MB upload limit', () => {
  assert.equal(engine.validateImageFile({ type: 'image/jpeg', size: 100 }), null);
  assert.equal(engine.validateImageFile({ type: 'image/webp', size: 100 }), null);
  assert.match(engine.validateImageFile({ type: 'application/pdf', size: 100 }), /JPG, PNG, GIF, or WebP/);
  assert.match(engine.validateImageFile({ type: 'image/png', size: engine.MAX_IMAGE_BYTES + 1 }), /larger than 5 MB/);
  assert.match(engine.validateImageFile({ type: 'image/png', size: 0 }), /empty or unreadable/);
  assert.match(engine.validateImageFile(undefined), /Choose a leaf image/);
});

test('requires a supported crop selection and refuses other crops', () => {
  assert.equal(engine.validateCrop('maize'), null);
  assert.equal(engine.validateCrop('cassava'), null);
  assert.equal(engine.validateCrop('bean'), null);
  assert.match(engine.validateCrop(''), /Choose which crop/);
  assert.match(engine.validateCrop('other'), /supports only maize, cassava, and bean/);
});

test('prepares RGB pixels as normalized NCHW Float32 input', () => {
  const data = engine.makeInputTensorData({ data: new Uint8ClampedArray([255, 0, 0, 255]) }, 1, 1);
  assert.equal(data.length, 3);
  assert.ok(Math.abs(data[0] - ((1 - 0.485) / 0.229)) < 1e-6);
  assert.ok(Math.abs(data[1] - ((0 - 0.456) / 0.224)) < 1e-6);
  assert.ok(Math.abs(data[2] - ((0 - 0.406) / 0.225)) < 1e-6);
  assert.throws(() => engine.makeInputTensorData({ data: [] }, 1, 1), /unexpected size/);
});

test('returns top model class and score for a compatible crop', () => {
  const result = engine.interpretLogits([0, 0, 0, 0, 8], 'maize');
  assert.equal(result.kind, 'prediction');
  assert.equal(result.id, 'maize_rust');
  assert.equal(result.crop, 'maize');
  assert.ok(result.score > 0.99);
});

test('does not present a cross-crop top class as a diagnosis', () => {
  const result = engine.interpretLogits([0, 0, 0, 0, 8], 'cassava');
  assert.equal(result.kind, 'mismatch');
  assert.match(result.message, /does not match the crop you selected/);
});

test('marks low-scoring supported classes as inconclusive', () => {
  const result = engine.interpretLogits([0.1, 0, 0, 0, 0], 'bean');
  assert.equal(result.kind, 'uncertain');
  assert.ok(result.score < engine.MIN_SCREENING_SCORE);
  assert.equal(result.candidate.id, 'bean_spot');
});

test('rejects malformed or non-finite model outputs safely', () => {
  assert.equal(engine.interpretLogits([1, 2], 'maize').kind, 'invalid');
  assert.equal(engine.interpretLogits([1, 2, 3, 4, Number.NaN], 'maize').kind, 'invalid');
});
