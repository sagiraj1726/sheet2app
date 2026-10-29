'use strict';

const express = require('express');
const config = require('../config');
const { publicPlans, effectiveLimits, getPlan } = require('../config/plans');
const workspace = require('../services/workspace.service');
const { AppError } = require('../middleware/errors');

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true }));

/** Downloadable fictional sample workbooks so visitors can try the product with their own eyes. */
const SAMPLE_FILES = {
  'inventory.xlsx': ['inventory'],
  'expenses.xlsx': ['expenses'],
  'employees.xlsx': ['employees'],
  'students.xlsx': ['students'],
  'leads.xlsx': ['leads'],
  'demo.xlsx': ['inventory', 'expenses', 'employees'],
};
router.get('/samples/:file', async (req, res) => {
  const names = Object.prototype.hasOwnProperty.call(SAMPLE_FILES, req.params.file) ? SAMPLE_FILES[req.params.file] : null;
  if (!names) throw new AppError(404, 'NOT_FOUND', 'Sample not found.');
  const buffer = await require('../services/samples').buildWorkbook(names);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="sheet2app-sample-${req.params.file}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
});

router.get('/config', async (req, res) => {
  res.json({
    ...publicPlans(),
    limits: effectiveLimits(),
    plan: getPlan().id,
    workspaceTtlHours: config.workspaceTtlHours,
    currency: config.currency,
    usage: { workbooks: await workspace.countOwned(req.sid) },
  });
});

/**
 * Honest upgrade flow: no payments are taken. We only hand over a configured checkout URL if one
 * exists (https only); otherwise we say plainly that paid plans are not open yet.
 */
router.post('/upgrade-interest', (req, res) => {
  const plan = req.body && req.body.plan;
  if (!['pro', 'business'].includes(plan)) throw new AppError(422, 'VALIDATION', 'Choose a plan.');
  const { provider, checkoutUrl } = config.billing;
  let url = null;
  try {
    const u = new URL(checkoutUrl);
    if (provider && u.protocol === 'https:') url = u.toString();
  } catch { /* not configured */ }
  if (!url) {
    return res.json({
      available: false,
      message: 'Paid plans are not open yet and nothing has been charged. Thank you for your interest — this is how we decide what to build first.',
    });
  }
  return res.json({ available: true, checkoutUrl: url, message: 'Continue to secure checkout.' });
});

module.exports = router;
