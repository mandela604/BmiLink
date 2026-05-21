// utils/planLimits.js
const PLAN_LIMITS = {
  free: {
    maxProducts: 10,
    maxImagesPerProduct: 2,
    maxSpecsPerProduct: 6,
    maxOrderLogs: 25,
    maxCategories: 5,
    maxContacts: 25,
    maxStores: 1,
    maxTeamMembers: 0,
    canExportCSV: false,
    canBroadcast: false,
    canActivity: false,
    canCartTracker: false,
    canCreateStore: false,
    canCustomDomain: false,
    canPromoBanner: false,
    canWAGroupCTA: false,
    canTrackingPixels: false,
    allowedPixels: [],  // none
  },

  pro: {
    maxProducts: 120,
    maxImagesPerProduct: 5,
    maxSpecsPerProduct: 12,
    maxOrderLogs: 150,
    maxCategories: 15,
    maxContacts: 150,
    maxStores: 1,
    maxTeamMembers: 1,
    canExportCSV: false,
    canBroadcast: false,
    canActivity: true,
    canCartTracker: true,
    canCreateStore: false,
    canCustomDomain: true,
    canPromoBanner: true,
    canWAGroupCTA: true,
    canTrackingPixels: true,
    allowedPixels: ['meta'],  // only Meta Pixel
  },


  business: {
    maxProducts: 400,
    maxImagesPerProduct: 5,
    maxSpecsPerProduct: 30,
    maxOrderLogs: 800,
    maxCategories: 30,
    maxContacts: 800,
    maxStores: 2,
    maxTeamMembers: 3,
    canExportCSV: true,
    canBroadcast: false,
    canActivity: true,
    canCartTracker: true,
    canCreateStore: true,
    canCustomDomain: true,
    canPromoBanner: true,
    canWAGroupCTA: true,
    canTrackingPixels: true,
    allowedPixels: ['meta', 'tiktok', 'ga'],  // all
  },
};

// Plan rank for comparisons
const PLAN_RANK = { free: 0, pro: 1, business: 2 };

function canAccess(plan, requiredPlan) {
  return PLAN_RANK[plan] >= PLAN_RANK[requiredPlan];
}

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

module.exports = { PLAN_LIMITS, PLAN_RANK, canAccess, getPlanLimits };