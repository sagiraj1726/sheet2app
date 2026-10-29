'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { AppError } = require('../middleware/errors');
const excel = require('../services/excel.service');
const workspace = require('../services/workspace.service');
const samples = require('../services/samples');
const logger = require('../services/logger');
const { effectiveLimits, getPlan } = require('../config/plans');
const { overview } = require('./helpers');

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

function uploader() {
  const limits = effectiveLimits();
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxUploadMB * 1024 * 1024, files: 1, fields: 5, parts: 8 },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (ext === '.xls') return cb(new AppError(415, 'LEGACY_XLS', 'Old .xls files are not supported yet. In Excel choose File → Save As → "Excel Workbook (*.xlsx)" and upload that file.'));
      if (ext !== '.xlsx') return cb(new AppError(415, 'BAD_TYPE', 'Please upload an Excel workbook with the .xlsx extension.'));
      if (!ALLOWED_MIME.has((file.mimetype || '').toLowerCase())) return cb(new AppError(415, 'BAD_TYPE', 'That file type is not accepted.'));
      return cb(null, true);
    },
  }).single('file');
}

async function ensureCapacity(sid) {
  const limits = effectiveLimits();
  const count = await workspace.countOwned(sid);
  if (count >= limits.workspaces) {
    throw new AppError(402, 'PLAN_LIMIT', `You already have ${count} active workbooks, which is the limit of the ${getPlan().name} plan. Delete one to upload another.`, { upgrade: true, limit: 'workspaces', max: limits.workspaces });
  }
}

async function importBuffer(req, name, buffer) {
  await ensureCapacity(req.sid);
  const limits = effectiveLimits();
  const parsed = await excel.parseWorkbook(buffer, limits);
  const state = await workspace.create(req.sid, name, buffer, parsed, getPlan().id);
  logger.info('Workbook imported', { workspace: state.id, sheets: state.sheets.length });
  return state;
}

const router = express.Router();
const upload = uploader();

router.post('/upload', (req, res, next) => {
  upload(req, res, (err) => (err ? next(err) : next()));
}, async (req, res) => {
  if (!req.file) throw new AppError(400, 'NO_FILE', 'Choose an Excel file to upload.');
  const state = await importBuffer(req, req.file.originalname, req.file.buffer);
  res.status(201).json(overview(state));
});

const SAMPLE_LABELS = {
  demo: 'Sheet2App demo - small business pack',
  inventory: 'Sample inventory',
  expenses: 'Sample monthly expenses',
  employees: 'Sample employees',
  students: 'Sample student marks',
  leads: 'Sample property leads',
};

/** Open a fictional sample workbook (allow-listed names only). */
router.post('/sample', async (req, res) => {
  const name = req.body && req.body.name;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SAMPLE_LABELS, name)) {
    throw new AppError(422, 'VALIDATION', 'Unknown sample.');
  }
  const buffer = name === 'demo' ? await samples.demoWorkbook() : await samples.buildWorkbook([name]);
  const state = await importBuffer(req, `${SAMPLE_LABELS[name]}.xlsx`, buffer);
  res.status(201).json(overview(state));
});

module.exports = router;
