'use strict';

/**
 * Plan + feature-limit configuration.
 *
 * IMPORTANT: Prices are PRICING HYPOTHESES to be validated with real customers.
 * No payment is processed anywhere in this codebase. The active plan is chosen by the
 * PLAN environment variable (local/dev) until real identity + billing + entitlement
 * checks exist. Only features that are actually implemented are listed as "available".
 */
const config = require('./index');

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '₹0',
    period: 'forever',
    tagline: 'Try it on a real workbook.',
    limits: {
      maxUploadMB: 5,
      maxSheets: 3,
      maxRowsPerSheet: 500,
      maxColumns: 25,
      workspaces: 3,
      autoCharts: 6,
      customCharts: 2,
      templates: false,
      branding: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceLabel: '₹299–₹499',
    period: 'per month (hypothesis)',
    tagline: 'For people who use Excel every week.',
    limits: {
      maxUploadMB: 25,
      maxSheets: 20,
      maxRowsPerSheet: 50000,
      maxColumns: 200,
      workspaces: 10,
      autoCharts: 16,
      customCharts: 20,
      templates: true,
      branding: false,
    },
  },
  business: {
    id: 'business',
    name: 'Business',
    priceLabel: '₹999–₹2,499',
    period: 'per month (hypothesis)',
    tagline: 'For teams that want a branded workspace.',
    limits: {
      maxUploadMB: 50,
      maxSheets: 50,
      maxRowsPerSheet: 50000,
      maxColumns: 300,
      workspaces: 25,
      autoCharts: 24,
      customCharts: 50,
      templates: true,
      branding: true,
    },
  },
};

/** Features that are advertised but NOT built yet. Shown as "Planned" - never as available. */
const PLANNED = ['Team accounts & sharing', 'Multiple saved workspaces per user', 'Scheduled refresh from cloud storage'];

function getPlan(id = config.plan) {
  return PLANS[id] || PLANS.free;
}

/** Effective limits = plan limits, capped by deployment-wide hard caps from the environment. */
function effectiveLimits(id = config.plan) {
  const p = getPlan(id);
  return {
    ...p.limits,
    maxUploadMB: Math.min(p.limits.maxUploadMB, config.maxUploadMB),
    maxSheets: Math.min(p.limits.maxSheets, config.maxSheets),
    maxRowsPerSheet: Math.min(p.limits.maxRowsPerSheet, config.maxRowsPerSheet),
  };
}

function publicPlans() {
  return {
    activePlan: getPlan().id,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      priceLabel: p.priceLabel,
      period: p.period,
      tagline: p.tagline,
      limits: { ...p.limits },
    })),
    planned: PLANNED,
    billing: {
      configured: Boolean(config.billing.provider && config.billing.checkoutUrl),
      provider: config.billing.provider || null,
    },
    disclaimer:
      'Prices are hypotheses we are testing with customers. No payments are processed yet. Join the waitlist and we will tell you before anything is charged.',
  };
}

module.exports = { PLANS, PLANNED, getPlan, effectiveLimits, publicPlans };
