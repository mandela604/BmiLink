// routes/dashboardRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// All IDs are uuidv4 strings (field name: `id`), NOT MongoDB ObjectId (_id).
// Every schema must have:  id: { type: String, default: () => uuidv4() }
// and queries use { id: value } not { _id: value }.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const express    = require('express');
const router     = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { requireAuth: protect, requirePlan, checkFeature } = require('../middleware/authMiddleware');
const { getPlanLimits, PLAN_LIMITS }          = require('../utils/planLimits');

const Store       = require('../models/Store');
const { hashIP } = require('../utils/helpers');
const Product     = require('../models/Product');
const Category    = require('../models/Category');
const OrderLog    = require('../models/OrderLog');
const Contact     = require('../models/Contact');
const Activity    = require('../models/Activity');
const CartSession = require('../models/CartSession');
const TeamMember  = require('../models/TeamMember');
const Settings    = require('../models/Settings');
const Broadcast   = require('../models/Broadcast');
const User        = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');

const multer      = require('multer');
const cloudinary  = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'storelink/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB hard cap
  fileFilter(req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
    cb(null, true);
  },
});


// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate request and return 422 if there are errors.
 * Call at the top of each handler after your validation chain.
 */
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: 'Validation failed', details: errors.array() });
    return false;
  }
  return true;
}

/** Find the currently active store for the authenticated user. Throws if none found. */
async function activeStore(userId) {
  const store = await Store.findOne({ ownerId: userId, status: 'live' });
  if (!store) throw Object.assign(new Error('No active store found'), { status: 404 });
  return store;
}

/** Strip characters that could cause NoSQL injection in string fields */
function sanitizeStr(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/[$]/g, '');          // remove leading $ from keys/values
}

/** Safely parse pagination params */
function parsePagination(req, defaultLimit = 50) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || defaultLimit));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

/** Consistent error responder */
function errRes(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('[Dashboard]', err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Validate a Nigerian/international WhatsApp number — digits only, 7–15 chars */
function isValidWA(val) {
  if (!val) return true;           // optional
  return /^\d{7,15}$/.test(val.replace(/[\s\-\+]/g, ''));
}


// ─────────────────────────────────────────────────────────────────────────────
//  USER / PROFILE
// ─────────────────────────────────────────────────────────────────────────────


// GET /api/dashboard/store/dashboard  — combined init endpoint
router.get('/store/dashboard', protect, async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const limits   = getPlanLimits(req.user.plan);
    const settings = await Settings.findOne({ storeId: store.id });
    const stores   = await Store.find({ ownerId: req.user.id });

    const [products, categories, orderLog, contacts, team] = await Promise.all([
      Product.find({ storeId: store.id }).limit(50).sort({ createdAt: -1 }),
      Category.find({ storeId: store.id }),
      OrderLog.find({ storeId: store.id }).sort({ createdAt: -1 }).limit(100),
      Contact.find({ storeId: store.id }).sort({ createdAt: -1 }).limit(200),
      TeamMember.find({ storeId: store.id }).select('-passHash'),
    ]);

   const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
sevenDaysAgo.setHours(0, 0, 0, 0);

const actAgg = await Activity.aggregate([
  { $match: { storeId: store.id, createdAt: { $gte: sevenDaysAgo }, type: { $in: ['visit', 'order_tap'] } } },
  { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, type: '$type' }, count: { $sum: 1 } } }
]);

const visits7 = Array(7).fill(0);
const orders7 = Array(7).fill(0);
for (let i = 0; i < 7; i++) {
  const day = new Date(sevenDaysAgo); day.setDate(day.getDate() + i);
  const key = day.toISOString().slice(0, 10);
  const v = actAgg.find(a => a._id.day === key && a._id.type === 'visit');
  const o = actAgg.find(a => a._id.day === key && a._id.type === 'order_tap');
  visits7[i] = v?.count || 0;
  orders7[i] = o?.count || 0;
}

    const revenueAgg = await OrderLog.aggregate([
      { $match: { storeId: store.id } },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]);

    const user = await User.findOne({ id: req.user.id })
      .select('name email waNumber plan planExpiresAt pendingPlan');

    res.json({
      plan:         user.plan,
      user: { email: user.email, name: user.name },
      expiryDate:   user.planExpiresAt ? user.planExpiresAt.toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : null,
      expiryDays:   user.planExpiresAt ? Math.max(0, Math.ceil((new Date(user.planExpiresAt) - Date.now()) / 86400000)) : null,
      activeStoreId: store.id,
      settings:     settings || {},
      stores,
      categories,
      products,
      orderLog,
      contacts,
      team,
      recentActivity: await Activity.find({ storeId: store.id }).sort({ createdAt: -1 }).limit(10),
      analytics: {
        visits7,
        orders7,
        totalVisits:  visits7.reduce((a,b) => a+b, 0),
        totalOrders:  orders7.reduce((a,b) => a+b, 0),
        totalRevenue: revenueAgg[0]?.sum || 0,
      },
      planLimits: limits,
      features: {
        canExportCSV:      limits.canExportCSV,
        canBroadcast:      limits.canBroadcast,
        canActivity:       limits.canActivity,
        canCartTracker:    limits.canCartTracker,
        canCreateStore:    limits.canCreateStore,
        canCustomDomain:   limits.canCustomDomain,
        canPromoBanner:    limits.canPromoBanner,
        canWAGroupCTA:     limits.canWAGroupCTA,
        canTrackingPixels: limits.canTrackingPixels,
        allowedPixels:     limits.allowedPixels,
      },
    });
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/me
router.get('/me', protect, async (req, res) => {
  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const [productCount, orderCount, storeCount, teamCount] = await Promise.all([
      Product.countDocuments({ storeId: store.id }),
      OrderLog.countDocuments({ storeId: store.id }),
      Store.countDocuments({ ownerId: req.user.id }),
      TeamMember.countDocuments({ storeId: store.id }),
    ]);

    res.json({
      user: {
        id:       req.user.id,
        name:     req.user.name,
        email:    req.user.email,
        waNumber: req.user.waNumber,
        plan:     req.user.plan,
        status:   req.user.status,
        role:     req.user.role,
      },
      activeStore: {
        id:    store.id,
        name:  store.name,
        slug:  store.slug,
        emoji: store.emoji,
        type:  store.type,
      },
      planLimits: limits,
      usage: {
        products:    { current: productCount, max: limits.maxProducts },
        orderLogs:   { current: orderCount,   max: limits.maxOrderLogs },
        stores:      { current: storeCount,   max: limits.maxStores },
        teamMembers: { current: teamCount,    max: limits.maxTeamMembers },
      },
      features: {
        canExportCSV:      limits.canExportCSV,
        canBroadcast:      limits.canBroadcast,
        canActivity:       limits.canActivity,
        canCartTracker:    limits.canCartTracker,
        canCreateStore:    limits.canCreateStore,
        canCustomDomain:   limits.canCustomDomain,
        canPromoBanner:    limits.canPromoBanner,
        canWAGroupCTA:     limits.canWAGroupCTA,
        canTrackingPixels: limits.canTrackingPixels,
        allowedPixels:     limits.allowedPixels,
      },
    });
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/profile
router.put(
  '/profile',
  protect,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 1, max: 80 })
      .withMessage('Name must be 1–80 characters'),
    body('waNumber')
      .optional()
      .trim()
      .customSanitizer(v => v.replace(/[\s\-\+]/g, ''))
      .isLength({ min: 7, max: 15 })
      .isNumeric()
      .withMessage('WhatsApp number must be 7–15 digits'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { name, waNumber } = req.body;
      if (name)     req.user.name     = name;
      if (waNumber) req.user.waNumber = waNumber;
      await req.user.save();
      res.json({
        message: 'Profile updated',
        user: { name: req.user.name, waNumber: req.user.waNumber },
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/overview/stats
router.get('/overview/stats', protect, async (req, res) => {
  try {
    const store = await activeStore(req.user.id);

    const [productCount, cartCount] = await Promise.all([
      Product.countDocuments({ storeId: store.id, status: 'active' }),
      CartSession.countDocuments({ storeId: store.id }),
    ]);

    // 7-day visit & order-tap arrays
    const visits7 = [];
    const orders7 = [];

    for (let i = 6; i >= 0; i--) {
      const from = new Date();
      from.setDate(from.getDate() - i);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(from.getDate() + 1);

      const [v, o] = await Promise.all([
        Activity.countDocuments({ storeId: store.id, type: 'visit',     createdAt: { $gte: from, $lt: to } }),
        Activity.countDocuments({ storeId: store.id, type: 'order_tap', createdAt: { $gte: from, $lt: to } }),
      ]);
      visits7.push(v);
      orders7.push(o);
    }

    res.json({
      storeVisits7d:  visits7.reduce((a, b) => a + b, 0),
      orderTaps7d:    orders7.reduce((a, b) => a + b, 0),
      activeProducts: productCount,
      cartSessions:   cartCount,
      chartData:      { visits: visits7, orders: orders7 },
    });
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/overview/top-products
router.get('/overview/top-products', protect, async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const products = await Product
      .find({ storeId: store.id })
      .sort({ clicks: -1 })
      .limit(5)
      .select('id name emoji price clicks');
    res.json(products);
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/overview/recent-activity
router.get('/overview/recent-activity', protect, async (req, res) => {
  try {
    const store      = await activeStore(req.user.id);
    const activities = await Activity
      .find({ storeId: store.id })
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(activities);
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

const productValidators = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 150 })
    .withMessage('Product name must be 1–150 characters'),
  body('price')
    .isInt({ min: 0 })
    .withMessage('Price must be a non-negative integer'),
  body('originalPrice')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Original price must be a non-negative integer'),
  body('status')
    .optional()
    .isIn(['active', 'soldout', 'hidden'])
    .withMessage('Status must be active, soldout, or hidden'),
  body('emoji')
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage('Emoji too long'),
  body('desc')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be under 2000 characters'),
  body('promo')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Promo text must be under 200 characters'),
  body('stock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  body('images.*')
    .optional()
    .isString()
    .isLength({ max: 2048 })
    .withMessage('Each image must be a string URL/base64 under 2048 chars'),
  body('specs')
    .optional()
    .isArray()
    .withMessage('Specs must be an array'),
  body('specs.*.k')
    .optional()
    .trim()
    .isLength({ max: 80 })
    .withMessage('Spec key must be under 80 characters'),
  body('specs.*.v')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Spec value must be under 200 characters'),
  body('isNew')
    .optional()
    .isBoolean()
    .withMessage('isNew must be boolean'),
  body('isHot')
    .optional()
    .isBoolean()
    .withMessage('isHot must be boolean'),
];


// GET /api/dashboard/products
router.get(
  '/products',
  protect,
  [
    query('category').optional().isString().trim(),
    query('status').optional().isIn(['active', 'soldout', 'hidden', 'all']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const limits = getPlanLimits(req.user.plan);
      const { page, limit, skip } = parsePagination(req, 50);
      const filter = { storeId: store.id };

      const { category, status } = req.query;
      if (category && category !== 'all') filter.catId  = category;
      if (status   && status   !== 'all') filter.status = status;

      const [products, total] = await Promise.all([
        Product.find(filter).skip(skip).limit(limit),
        Product.countDocuments(filter),
      ]);

      res.json({
        products,
        total,
        page,
        limit,
        maxAllowed: limits.maxProducts,
        canAddMore: limits.maxProducts === Infinity
          ? true
          : total < limits.maxProducts,
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// GET /api/dashboard/products/:id
router.get(
  '/products/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const product = await Product.findOne({ id: req.params.id, storeId: store.id });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json(product);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// POST /api/dashboard/products
router.post('/products', protect, productValidators, async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const currentCount = await Product.countDocuments({ storeId: store.id });
    if (limits.maxProducts !== Infinity && currentCount >= limits.maxProducts) {
      return res.status(403).json({
        error:           `Product limit reached (${limits.maxProducts} max on ${req.user.plan} plan)`,
        upgradeRequired: true,
      });
    }

    const images = (req.body.images || []).slice(0, limits.maxImagesPerProduct);
    const specs  = (req.body.specs  || [])
      .filter(s => s && s.k && s.v)
      .slice(0, limits.maxSpecsPerProduct === Infinity ? 9999 : limits.maxSpecsPerProduct);

    if ((req.body.images || []).length > limits.maxImagesPerProduct) {
      return res.status(403).json({
        error: `Maximum ${limits.maxImagesPerProduct} images per product on ${req.user.plan} plan`,
      });
    }
    if (limits.maxSpecsPerProduct !== Infinity && (req.body.specs || []).length > limits.maxSpecsPerProduct) {
      return res.status(403).json({
        error: `Maximum ${limits.maxSpecsPerProduct} specifications on ${req.user.plan} plan`,
      });
    }

    // Ensure originalPrice only set when greater than price
    const price         = parseInt(req.body.price, 10);
    const originalPrice = req.body.originalPrice
      ? parseInt(req.body.originalPrice, 10)
      : null;

    const product = await Product.create({
      ...req.body,
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
      images,
      specs,
      storeId: store.id,
      ownerId: req.user.id,
      clicks:  0,
    });

    res.status(201).json(product);
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/products/:id
router.put(
  '/products/:id',
  protect,
  [param('id').isString().trim().notEmpty(), ...productValidators.map(v => v.optional())],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const product = await Product.findOne({ id: req.params.id, storeId: store.id });
      if (!product) return res.status(404).json({ error: 'Product not found' });

      const limits = getPlanLimits(req.user.plan);

      if (req.body.images && req.body.images.length > limits.maxImagesPerProduct) {
        return res.status(403).json({
          error: `Maximum ${limits.maxImagesPerProduct} images allowed on ${req.user.plan} plan`,
        });
      }
      if (
        limits.maxSpecsPerProduct !== Infinity &&
        req.body.specs &&
        req.body.specs.length > limits.maxSpecsPerProduct
      ) {
        return res.status(403).json({
          error: `Maximum ${limits.maxSpecsPerProduct} specifications allowed on ${req.user.plan} plan`,
        });
      }

      // Prevent overwriting protected fields
      const { storeId, ownerId, clicks, ...safe } = req.body;

      if (safe.price !== undefined)         safe.price = parseInt(safe.price, 10);
      if (safe.originalPrice !== undefined) {
        const op = parseInt(safe.originalPrice, 10);
        safe.originalPrice = op && op > (safe.price ?? product.price) ? op : null;
      }
      if (safe.specs) {
        safe.specs = safe.specs
          .filter(s => s && s.k && s.v)
          .slice(0, limits.maxSpecsPerProduct === Infinity ? 9999 : limits.maxSpecsPerProduct);
      }

      Object.assign(product, safe);
      await product.save();
      res.json(product);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/products/:id
router.delete(
  '/products/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const deleted = await Product.findOneAndDelete({ id: req.params.id, storeId: store.id });
      if (!deleted) return res.status(404).json({ error: 'Product not found' });
      res.json({ message: 'Product deleted' });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

const categoryValidators = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Category name must be 1–80 characters'),
  body('emoji')
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage('Emoji too long'),
];


// GET /api/dashboard/categories
router.get('/categories', protect, async (req, res) => {
  try {
    const store      = await activeStore(req.user.id);
    const limits     = getPlanLimits(req.user.plan);
    const categories = await Category.find({ storeId: store.id });
    res.json({
      categories,
      total:      categories.length,
      maxAllowed: limits.maxCategories,
    });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/categories
router.post('/categories', protect, categoryValidators, async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const currentCount = await Category.countDocuments({ storeId: store.id });
    if (limits.maxCategories !== Infinity && currentCount >= limits.maxCategories) {
      return res.status(403).json({
        error:           `Category limit reached (${limits.maxCategories} max on ${req.user.plan} plan)`,
        upgradeRequired: true,
      });
    }

    // Prevent duplicate category name within the same store
    const existing = await Category.findOne({
      storeId: store.id,
      name:    { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
    });
    if (existing) return res.status(409).json({ error: 'Category name already exists' });

    const category = await Category.create({ ...req.body, storeId: store.id });
    res.status(201).json(category);
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/categories/:id
router.put(
  '/categories/:id',
  protect,
  [param('id').isString().trim().notEmpty(), ...categoryValidators.map(v => v.optional())],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store    = await activeStore(req.user.id);
      const category = await Category.findOne({ id: req.params.id, storeId: store.id });
      if (!category) return res.status(404).json({ error: 'Category not found' });

      // Prevent duplicate name conflict (exclude self)
      if (req.body.name) {
        const conflict = await Category.findOne({
          storeId: store.id,
          name:    { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') },
          id:      { $ne: req.params.id },
        });
        if (conflict) return res.status(409).json({ error: 'Category name already exists' });
        category.name = req.body.name.trim();
      }
      if (req.body.emoji !== undefined) category.emoji = req.body.emoji;
      await category.save();
      res.json(category);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/categories/:id
router.delete(
  '/categories/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store = await activeStore(req.user.id);

      const hasProducts = await Product.exists({ storeId: store.id, catId: req.params.id });
      if (hasProducts) {
        return res.status(400).json({
          error: 'Cannot delete a category that still has products. Move or delete products first.',
        });
      }

      const deleted = await Category.findOneAndDelete({ id: req.params.id, storeId: store.id });
      if (!deleted) return res.status(404).json({ error: 'Category not found' });
      res.json({ message: 'Category deleted' });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  ORDER LOG
// ─────────────────────────────────────────────────────────────────────────────

const orderValidators = [
  body('prodId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Product ID is required'),
  body('qty')
    .isInt({ min: 1, max: 10000 })
    .withMessage('Quantity must be between 1 and 10,000'),
  body('amount')
    .isInt({ min: 0 })
    .withMessage('Amount must be a non-negative integer'),
  body('buyerWa')
    .optional({ nullable: true })
    .trim()
    .customSanitizer(v => v ? v.replace(/[\s\-\+]/g, '') : v)
    .custom(v => !v || /^\d{7,15}$/.test(v))
    .withMessage('WhatsApp number must be 7–15 digits'),
  body('buyerName')
    .optional()
    .trim()
    .isLength({ max: 80 })
    .withMessage('Buyer name must be under 80 characters'),
  body('note')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Note must be under 300 characters'),
];


// GET /api/dashboard/orders/export  — Business only, streams CSV
router.get('/orders/export', protect, requirePlan('business'), async (req, res) => {
  try {
    const store  = await activeStore(req.user.id);
    const orders = await OrderLog.find({ storeId: store.id }).sort({ createdAt: -1 });

    const rows = [['Product', 'Qty', 'Amount (NGN)', 'Buyer Name', 'Buyer WA', 'Note', 'Date']];
    orders.forEach(o => {
      rows.push([
        o.prodName  || '',
        o.qty,
        o.amount,
        o.buyerName || '',
        o.buyerWa   || '',
        o.note      || '',
        o.createdAt ? o.createdAt.toISOString() : '',
      ]);
    });

    const csv = rows
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv);   // BOM for Excel UTF-8 compatibility
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/orders
router.get(
  '/orders',
  protect,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const limits = getPlanLimits(req.user.plan);
      const { page, limit, skip } = parsePagination(req, 50);

      const [orders, total] = await Promise.all([
        OrderLog.find({ storeId: store.id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
        OrderLog.countDocuments({ storeId: store.id }),
      ]);

      const totalRevenue = await OrderLog.aggregate([
        { $match: { storeId: store.id } },
        { $group: { _id: null, sum: { $sum: '$amount' } } },
      ]);

      res.json({
        orders: orders.map(o => {
          const obj = o.toObject();
          obj.prodEmoji = obj.productEmoji;
          obj.prodName  = obj.productName;
          return obj;
        }),
        total,
        page,
        limit,
        totalRevenue:  totalRevenue[0]?.sum || 0,
        maxAllowed:    limits.maxOrderLogs,
        canExport:     limits.canExportCSV,
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// POST /api/dashboard/orders
// POST /api/dashboard/orders
router.post('/orders', protect, orderValidators, async (req, res) => {
  if (!validate(req, res)) return;

  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const currentCount = await OrderLog.countDocuments({ storeId: store.id });
    if (limits.maxOrderLogs !== Infinity && currentCount >= limits.maxOrderLogs) {
      return res.status(403).json({
        error:           `Order log limit reached (${limits.maxOrderLogs} max on ${req.user.plan} plan)`,
        upgradeRequired: true,
      });
    }

    // Verify the product belongs to this store
    const product = await Product.findOne({ id: req.body.prodId, storeId: store.id });
    if (!product) return res.status(404).json({ error: 'Product not found in this store' });

    // ====================== SANITIZATION ======================
    const qty    = parseInt(req.body.qty, 10);
    const amount = parseInt(req.body.amount, 10);
    let note     = req.body.note ? String(req.body.note).trim() : null;

    // Safety checks
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Sanitize note
    if (note) {
      if (note.length > 500) note = note.substring(0, 500); // Limit length
      //  Remove any HTML/script tags for extra safety
      note = note.replace(/<[^>]*>/g, '').trim();
    }

    const order = await OrderLog.create({
      storeId:   store.id,
      ownerId:   req.user.id,
      productId:    product.id,
      productName:  product.name,
      productEmoji: product.emoji,
      qty:       qty,
      amount:    amount,
      buyerWa:   req.body.buyerWa   || null,
      buyerName: req.body.buyerName || null,
      note:      note,
    });

    // Auto-save contact (unchanged)
    const buyerWa = req.body.buyerWa;
    if (buyerWa) {
      const existingContact = await Contact.findOne({ storeId: store.id, wa: buyerWa });
      if (!existingContact) {
        const contactCount = await Contact.countDocuments({ storeId: store.id });
        if (limits.maxContacts === Infinity || contactCount < limits.maxContacts) {
          const catName = (await Category.findOne({ id: product.catId, storeId: store.id }))?.name;
          const tag = catName
            ? catName.toLowerCase().replace(/\s+/g, '-') + '-buyer'
            : 'buyer';

          await Contact.create({
            storeId: store.id,
            name:    req.body.buyerName || 'Customer',
            wa:      buyerWa,
            tags:    [tag],
          });
        }
      }
    }

    res.status(201).json(order);
  } catch (err) {
    errRes(res, err);
  }
});

// DELETE /api/dashboard/orders/:id
router.delete(
  '/orders/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const deleted = await OrderLog.findOneAndDelete({ id: req.params.id, storeId: store.id });
      if (!deleted) return res.status(404).json({ error: 'Order not found' });
      res.json({ message: 'Order deleted' });
    } catch (err) {
      errRes(res, err);
    }
  }
);




// ─────────────────────────────────────────────────────────────────────────────
//  CONTACTS
// ─────────────────────────────────────────────────────────────────────────────

const contactValidators = [
  body('wa')
    .trim()
    .customSanitizer(v => v.replace(/[\s\-\+]/g, ''))
    .isLength({ min: 7, max: 15 })
    .isNumeric()
    .withMessage('WhatsApp number must be 7–15 digits'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 80 })
    .withMessage('Name must be under 80 characters'),
  body('tags')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Tags must be an array of up to 20 items'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Each tag must be under 50 characters'),
];


// GET /api/dashboard/contacts
router.get(
  '/contacts',
  protect,
  [
    query('tag').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const limits = getPlanLimits(req.user.plan);
      const { page, limit, skip } = parsePagination(req, 50);
      const filter = { storeId: store.id };
      if (req.query.tag) filter.tags = req.query.tag;

      const [contacts, total] = await Promise.all([
        Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Contact.countDocuments(filter),
      ]);

      res.json({ contacts, total, page, limit, maxAllowed: limits.maxContacts });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// GET /api/dashboard/contacts/tags
// NOTE: must be defined BEFORE /contacts/:id to avoid Express treating "tags" as an :id param
router.get('/contacts/tags', protect, async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const contacts = await Contact.find({ storeId: store.id }).select('tags');
    const allTags  = [...new Set(contacts.flatMap(c => c.tags || []))].sort();
    res.json({ tags: allTags });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/contacts
router.post('/contacts', protect, contactValidators, async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const currentCount = await Contact.countDocuments({ storeId: store.id });
    if (limits.maxContacts !== Infinity && currentCount >= limits.maxContacts) {
      return res.status(403).json({
        error:           `Contact limit reached (${limits.maxContacts} max on ${req.user.plan} plan)`,
        upgradeRequired: true,
      });
    }

    const wa = req.body.wa.replace(/[\s\-\+]/g, '');

    // Prevent duplicate WA number in same store
    const existing = await Contact.findOne({ storeId: store.id, wa });
    if (existing) return res.status(409).json({ error: 'This WhatsApp number is already saved' });

    const contact = await Contact.create({
      storeId: store.id,
      name:    req.body.name || 'Customer',
      wa,
      tags:    (req.body.tags || []).map(t => String(t).trim()).filter(Boolean),
    });
    res.status(201).json(contact);
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/contacts/:id
router.put(
  '/contacts/:id',
  protect,
  [
    param('id').isString().trim().notEmpty(),
    body('name').optional().trim().isLength({ max: 80 }),
    body('tags').optional().isArray({ max: 20 }),
    body('tags.*').optional().trim().isLength({ max: 50 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const contact = await Contact.findOne({ id: req.params.id, storeId: store.id });
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      // Only allow updating name and tags — WA is the unique identifier
      if (req.body.name !== undefined) contact.name = req.body.name.trim();
      if (req.body.tags !== undefined) contact.tags = req.body.tags.map(t => String(t).trim()).filter(Boolean);
      await contact.save();
      res.json(contact);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/contacts/:id
router.delete(
  '/contacts/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const deleted = await Contact.findOneAndDelete({ id: req.params.id, storeId: store.id });
      if (!deleted) return res.status(404).json({ error: 'Contact not found' });
      res.json({ message: 'Contact deleted' });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  BROADCAST  — Business only
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/broadcast
router.get('/broadcast', protect, requirePlan('business'), async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const contacts = await Contact.find({ storeId: store.id }).sort({ createdAt: -1 });
    const allTags  = [...new Set(contacts.flatMap(c => c.tags || []))];
    res.json({ contacts, tags: allTags });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/broadcast/send
router.post(
  '/broadcast/send',
  protect,
  requirePlan('business'),
  [
    body('contactIds')
      .isArray({ min: 1, max: 500 })
      .withMessage('contactIds must be an array of 1–500 IDs'),
    body('contactIds.*')
      .isString()
      .trim()
      .notEmpty(),
    body('message')
      .trim()
      .isLength({ min: 1, max: 4096 })
      .withMessage('Message must be 1–4096 characters'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store              = await activeStore(req.user.id);
      const { contactIds, message } = req.body;

      // Only return contacts that belong to this store
      const contacts = await Contact.find({
        id:      { $in: contactIds },
        storeId: store.id,
      }).select('id name wa');

      if (!contacts.length) {
        return res.status(400).json({ error: 'No valid contacts found' });
      }

      await Broadcast.create({
        storeId:        store.id,
        recipientCount: contacts.length,
        messagePreview: message.substring(0, 100),
      });

      res.json({
        message:  `Broadcast prepared for ${contacts.length} contacts`,
        contacts: contacts.map(c => ({ name: c.name, wa: c.wa })),
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS  — Pro+
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/analytics
router.get('/analytics', protect, requirePlan('pro'), async (req, res) => {
  try {
    const store  = await activeStore(req.user.id);
    const limits = getPlanLimits(req.user.plan);

    const [totalVisits, totalOrders, cartSent, cartTotal] = await Promise.all([
      Activity.countDocuments({ storeId: store.id, type: 'visit' }),
      Activity.countDocuments({ storeId: store.id, type: 'order_tap' }),
      CartSession.countDocuments({ storeId: store.id, sent: true }),
      CartSession.countDocuments({ storeId: store.id }),
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trend = await Activity.aggregate([
      { $match: { storeId: store.id, createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const revenueAgg = await OrderLog.aggregate([
      { $match: { storeId: store.id } },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]);

    const topProduct = await Product.findOne({ storeId: store.id }).sort({ clicks: -1 }).select('name');

    res.json({
      totalVisits,
      totalOrders,
      conversionRate: totalVisits
        ? Number(((totalOrders / totalVisits) * 100).toFixed(1))
        : 0,
      cartConversionRate: cartTotal
        ? Number(((cartSent / cartTotal) * 100).toFixed(1))
        : 0,
      totalRevenue:   revenueAgg[0]?.sum || 0,
      topProductName: topProduct?.name   || null,
      trend,
      canExport: limits.canExportCSV,
    });
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/analytics/export  — Business only
router.get('/analytics/export', protect, requirePlan('business'), async (req, res) => {
  try {
    const store      = await activeStore(req.user.id);
    const activities = await Activity.find({ storeId: store.id }).sort({ createdAt: -1 });

    const rows = [['Date', 'Type', 'Product ID', 'Hashed IP']];
    activities.forEach(a => {
      rows.push([
        a.createdAt ? a.createdAt.toISOString() : '',
        a.type,
        a.productId || '',
        a.ipHash    || '',
      ]);
    });

    const csv = rows.map(row => row.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  ACTIVITY  — Pro+
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/activity
router.get(
  '/activity',
  protect,
  checkFeature('canActivity'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store = await activeStore(req.user.id);
      const { page, limit, skip } = parsePagination(req, 30);

      const [activities, total] = await Promise.all([
        Activity.find({ storeId: store.id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Activity.countDocuments({ storeId: store.id }),
      ]);

      res.json({ activities, total, page, limit });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// POST /api/dashboard/activity/simulate  (dev/demo only)
router.post('/activity/simulate', protect, checkFeature('canActivity'), async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Simulation not available in production' });
  }
  try {
    const store      = await activeStore(req.user.id);
    const types      = ['visit', 'order_tap', 'cart'];
    const randomType = types[Math.floor(Math.random() * types.length)];

    const activity = await Activity.create({
      storeId: store.id,
      type:    randomType,
      ipHash:  'simulated',
    });

    res.json({ message: 'Activity simulated', type: randomType, activity });
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  CART TRACKER  — Pro+
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/cart-tracker
router.get(
  '/cart-tracker',
  protect,
  checkFeature('canCartTracker'),
  [
    query('filter').optional().isIn(['all', 'sent', 'abandoned']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const { page, limit, skip } = parsePagination(req, 30);
      const filter = { storeId: store.id };

      const cartFilter = req.query.filter;
      if (cartFilter === 'sent')      filter.sent = true;
      if (cartFilter === 'abandoned') filter.sent = false;

      const [sessions, total, sent, abandoned] = await Promise.all([
        CartSession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        CartSession.countDocuments({ storeId: store.id }),
        CartSession.countDocuments({ storeId: store.id, sent: true }),
        CartSession.countDocuments({ storeId: store.id, sent: false }),
      ]);

      // Compute averages from all sessions (not paged)
      const allSessions = await CartSession.find({ storeId: store.id }).select('items total');
      const avgItems = allSessions.length
        ? (allSessions.reduce((s, e) => s + (e.items?.length || 0), 0) / allSessions.length).toFixed(1)
        : 0;
      const avgValue = allSessions.length
        ? Math.round(allSessions.reduce((s, e) => s + (e.total || 0), 0) / allSessions.length)
        : 0;

      res.json({
        sessions,
        total,
        page,
        limit,
        stats: {
          total,
          sent,
          abandoned,
          avgItems:    Number(avgItems),
          avgValue,
          conversion:  total ? Number(((sent / total) * 100).toFixed(1)) : 0,
        },
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// POST /api/dashboard/cart-tracker/simulate
router.post('/cart-tracker/simulate', protect, checkFeature('canCartTracker'), async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Simulation not available in production' });
  }
  try {
    const store          = await activeStore(req.user.id);
    const randomProducts = await Product.aggregate([
      { $match: { storeId: store.id, status: 'active' } },
      { $sample: { size: 2 } },
    ]);

    if (!randomProducts.length) {
      return res.status(400).json({ error: 'Add active products first before simulating' });
    }

    const session = await CartSession.create({
      storeId: store.id,
      items:   randomProducts.map(p => ({ id: p.id, name: p.name, price: p.price, emoji: p.emoji })),
      total:   randomProducts.reduce((sum, p) => sum + p.price, 0),
      sent:    Math.random() > 0.5,
    });

    res.json({ message: 'Cart session simulated', session });
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  STORES
// ─────────────────────────────────────────────────────────────────────────────

const storeCreateValidators = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Store name must be 1–80 characters'),
  body('emoji')
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage('Emoji too long'),
  body('type')
    .trim()
    .isLength({ min: 1, max: 60 })
    .withMessage('Store type is required'),
  body('waNumber')
    .optional()
    .trim()
    .customSanitizer(v => v ? v.replace(/[\s\-\+]/g, '') : v)
    .custom(v => !v || /^\d{7,15}$/.test(v))
    .withMessage('WhatsApp number must be 7–15 digits'),
];


// GET /api/dashboard/stores
router.get('/stores', protect, async (req, res) => {
  try {
    const stores = await Store.find({ ownerId: req.user.id });
    const limits = getPlanLimits(req.user.plan);
    res.json({
      stores,
      total:      stores.length,
      maxAllowed: limits.maxStores,
      canCreate:  limits.canCreateStore,
    });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/stores  — Business only
router.post('/stores', protect, requirePlan('business'), storeCreateValidators, async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const limits       = getPlanLimits(req.user.plan);
    const currentCount = await Store.countDocuments({ ownerId: req.user.id });

    if (currentCount >= limits.maxStores) {
      return res.status(403).json({
        error:           `Maximum ${limits.maxStores} stores on ${req.user.plan} plan`,
        upgradeRequired: false,
      });
    }

    // Generate a URL-safe slug from the name
    const slug = req.body.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 60);

    // Ensure slug uniqueness
    const slugExists = await Store.exists({ slug });
    const finalSlug  = slugExists ? `${slug}-${Date.now()}` : slug;

    const store = await Store.create({
      name:      req.body.name.trim(),
      emoji:     req.body.emoji?.trim() || '🏪',
      type:      req.body.type.trim(),
      waNumber:  req.body.waNumber || null,
      slug:      finalSlug,
      ownerId:   req.user.id,
      isActive:  false,
    });

    res.status(201).json(store);
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/stores/:id/switch
router.put(
  '/stores/:id/switch',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      // Confirm store belongs to user before switching
      const target = await Store.findOne({ id: req.params.id, ownerId: req.user.id });
      if (!target) return res.status(404).json({ error: 'Store not found' });

    await Store.updateMany({ ownerId: req.user.id }, { status: 'draft' });
      target.status = 'live';;
      await target.save();

      res.json({ message: 'Store switched', store: target });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/stores/:id
router.delete(
  '/stores/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const count = await Store.countDocuments({ ownerId: req.user.id });
      if (count <= 1) {
        return res.status(400).json({ error: 'Cannot delete your only store' });
      }

      const store = await Store.findOne({ id: req.params.id, ownerId: req.user.id });
      if (!store) return res.status(404).json({ error: 'Store not found' });

      if (store.status === 'live') {
        // Auto-activate another store before deletion
        const another = await Store.findOne({ ownerId: req.user.id, id: { $ne: store.id } });
        if (another) { another.status = 'live'; await another.save(); }
      }

      await store.deleteOne();
      res.json({ message: 'Store deleted' });
    } catch (err) {
      errRes(res, err);
    }
  }
);



// GET /api/dashboard/store/types  — available store types
router.get('/store/types', protect, async (req, res) => {
  try {
    const types = [
      { id: 'ecommerce', label: '🛍️ E-Commerce — sell physical products' },
      { id: 'services',  label: '🛠️ Services — plumber, designer, VA' },
      { id: 'health',    label: '🏥 Health / Medical — doctor, nurse, clinic' },
      { id: 'coach',     label: '🎯 Coach / Tutor — courses, training' },
      { id: 'portfolio', label: '💼 Portfolio — showcase your work' },
      { id: 'books',     label: '📚 Books / Info — author or affiliate' },
      { id: 'food',      label: '🍽️ Food & Drinks — restaurant or caterer' },
      { id: 'fashion',   label: '👗 Fashion — clothing & accessories' },
      { id: 'beauty',    label: '💄 Beauty & Cosmetics — skincare, makeup' },
      { id: 'auto',      label: '🚗 Auto & Parts — cars, bikes, spare parts' },
    ];
    res.json(types);
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  TEAM  — Pro+ (1 member) / Business (3 members)
// ─────────────────────────────────────────────────────────────────────────────

const teamValidators = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('Name must be 1–80 characters'),
  body('wa')
    .trim()
    .customSanitizer(v => v.replace(/[\s\-\+]/g, ''))
    .isLength({ min: 7, max: 15 })
    .isNumeric()
    .withMessage('WhatsApp number must be 7–15 digits'),
  body('role')
    .isIn(['full', 'limited'])
    .withMessage('Role must be "full" or "limited"'),
  body('storeId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('storeId is required'),
];


// GET /api/dashboard/team
router.get('/team', protect, async (req, res) => {
  try {
    const limits = getPlanLimits(req.user.plan);
    if (limits.maxTeamMembers === 0) {
      return res.status(403).json({
        error:           'Team accounts are not available on the Free plan',
        upgradeRequired: true,
      });
    }

    const store  = await activeStore(req.user.id);
    const team   = await TeamMember.find({ storeId: store.id }).select('-passHash');
    res.json({ team, maxAllowed: limits.maxTeamMembers });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/team
router.post(
  '/team',
  protect,
  [
    ...teamValidators,
    body('password')
      .isLength({ min: 6, max: 128 })
      .withMessage('Password must be 6–128 characters'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const limits = getPlanLimits(req.user.plan);
      if (limits.maxTeamMembers === 0) {
        return res.status(403).json({
          error:           'Team accounts are not available on the Free plan',
          upgradeRequired: true,
        });
      }

      const store        = await activeStore(req.user.id);
      const currentCount = await TeamMember.countDocuments({ storeId: store.id });
      if (currentCount >= limits.maxTeamMembers) {
        return res.status(403).json({
          error: `Maximum ${limits.maxTeamMembers} team member${limits.maxTeamMembers !== 1 ? 's' : ''} on ${req.user.plan} plan`,
        });
      }

      // Verify the target store belongs to this user
      const targetStore = await Store.findOne({ id: req.body.storeId, ownerId: req.user.id });
      if (!targetStore) return res.status(404).json({ error: 'Target store not found' });

      // Check WA not already a team member on this store
      const waExists = await TeamMember.findOne({ storeId: store.id, wa: req.body.wa });
      if (waExists) return res.status(409).json({ error: 'This WhatsApp number is already a team member' });

      const bcrypt = require('bcryptjs');
      const passHash = await bcrypt.hash(req.body.password, 12);

      const member = await TeamMember.create({
        name:     req.body.name.trim(),
        wa:       req.body.wa,
        passHash,
        role:     req.body.role,
        storeId:  req.body.storeId,
        ownerId:  req.user.id,
      });

      const { passHash: _, ...safe } = member.toObject();
      res.status(201).json(safe);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/team/:id
router.put(
  '/team/:id',
  protect,
  [
    param('id').isString().trim().notEmpty(),
    body('name').optional().trim().isLength({ min: 1, max: 80 }),
    body('wa')
      .optional()
      .trim()
      .customSanitizer(v => v.replace(/[\s\-\+]/g, ''))
      .isLength({ min: 7, max: 15 })
      .isNumeric(),
    body('role').optional().isIn(['full', 'limited']),
    body('storeId').optional().isString().trim().notEmpty(),
    body('password').optional().isLength({ min: 6, max: 128 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const member = await TeamMember.findOne({ id: req.params.id, storeId: store.id });
      if (!member) return res.status(404).json({ error: 'Team member not found' });

      if (req.body.name    !== undefined) member.name    = req.body.name.trim();
      if (req.body.role    !== undefined) member.role    = req.body.role;
      if (req.body.storeId !== undefined) {
        const targetStore = await Store.findOne({ id: req.body.storeId, ownerId: req.user.id });
        if (!targetStore) return res.status(404).json({ error: 'Target store not found' });
        member.storeId = req.body.storeId;
      }
      if (req.body.wa !== undefined) {
        const conflict = await TeamMember.findOne({
          storeId: store.id,
          wa:      req.body.wa,
          id:      { $ne: req.params.id },
        });
        if (conflict) return res.status(409).json({ error: 'This WhatsApp number is already a team member' });
        member.wa = req.body.wa;
      }
      if (req.body.password) {
        const bcrypt  = require('bcryptjs');
        member.passHash = await bcrypt.hash(req.body.password, 12);
      }

      await member.save();
      const { passHash: _, ...safe } = member.toObject();
      res.json(safe);
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/team/:id
router.delete(
  '/team/:id',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const deleted = await TeamMember.findOneAndDelete({ id: req.params.id, storeId: store.id });
      if (!deleted) return res.status(404).json({ error: 'Team member not found' });
      res.json({ message: 'Team member removed' });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/settings
router.get('/settings', protect, async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const settings = await Settings.findOne({ storeId: store.id });
    const limits   = getPlanLimits(req.user.plan);

    res.json({
      settings,
      features: {
        canStoreIdentity:  true,
        canPromoBanner:    limits.canPromoBanner,
        canWAGroupCTA:     limits.canWAGroupCTA,
        canCustomDomain:   limits.canCustomDomain,
        canTrackingPixels: limits.canTrackingPixels,
        allowedPixels:     limits.allowedPixels,
        canPreferences:    true,
      },
    });
  } catch (err) {
    errRes(res, err);
  }
});


// PUT /api/dashboard/settings/store-identity
router.put(
  '/settings/store-identity',
  protect,
  [
    body('storeName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 80 })
      .withMessage('Store name must be 1–80 characters'),
    body('storeEmoji')
      .optional()
      .trim()
      .isLength({ max: 8 }),
    body('heroTitle')
      .optional()
      .trim()
      .isLength({ max: 120 }),
    body('heroSub')
      .optional()
      .trim()
      .isLength({ max: 300 }),
    body('waNumber')
      .optional()
      .trim()
      .customSanitizer(v => v.replace(/[\s\-\+]/g, ''))
      .custom(v => !v || /^\d{7,15}$/.test(v))
      .withMessage('WhatsApp number must be 7–15 digits'),
    body('city')
      .optional()
      .trim()
      .isLength({ max: 80 }),
    body('orderMsg')
      .optional()
      .trim()
      .isLength({ max: 1000 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const allowed = ['storeName', 'storeEmoji', 'heroTitle', 'heroSub', 'waNumber', 'city', 'orderMsg'];
      const updates = {};
      allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: updates },
        { upsert: true, new: true }
      );
      res.json({ message: 'Store identity updated', settings });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/settings/promo-banner  — Pro+
router.put(
  '/settings/promo-banner',
  protect,
  requirePlan('pro'),
  [
    body('ic').optional().trim().isLength({ max: 8 }),
    body('label').optional().trim().isLength({ max: 40 }),
    body('title').optional().trim().isLength({ max: 120 }),
    body('sub').optional().trim().isLength({ max: 200 }),
    body('cta').optional().trim().isLength({ max: 40 }),
    body('visible').optional().isBoolean(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store    = await activeStore(req.user.id);
      const allowed  = ['ic', 'label', 'title', 'sub', 'cta', 'visible'];
      const promoUpd = {};
      allowed.forEach(f => { if (req.body[f] !== undefined) promoUpd[`promo.${f}`] = req.body[f]; });

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: promoUpd },
        { upsert: true, new: true }
      );
      res.json({ message: 'Promo banner updated', settings });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/settings/wa-group  — Business only
router.put(
  '/settings/wa-group',
  protect,
  requirePlan('pro'),
  [
    body('link')
      .optional()
      .trim()
      .custom(v => !v || v.startsWith('https://chat.whatsapp.com/'))
      .withMessage('Must be a valid WhatsApp group invite link'),
    body('title').optional().trim().isLength({ max: 120 }),
    body('sub').optional().trim().isLength({ max: 300 }),
    body('count').optional().trim().isLength({ max: 80 }),
    body('visible').optional().isBoolean(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const allowed = ['link', 'title', 'sub', 'count', 'visible'];
      const waUpd   = {};
      allowed.forEach(f => { if (req.body[f] !== undefined) waUpd[`waGroup.${f}`] = req.body[f]; });

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: waUpd },
        { upsert: true, new: true }
      );
      res.json({ message: 'WhatsApp Group CTA updated', settings });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/settings/custom-domain  — Pro+
router.put(
  '/settings/custom-domain',
  protect,
  requirePlan('pro'),
  [
    body('domain')
      .trim()
      .customSanitizer(v => v.replace(/^https?:\/\//i, '').toLowerCase())
      .matches(/^[a-z0-9][a-z0-9\-.]{1,61}[a-z0-9]\.[a-z]{2,}$/)
      .withMessage('Enter a valid domain name (e.g. shop.yourbrand.com)'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store    = await activeStore(req.user.id);
      const domain   = req.body.domain.replace(/^https?:\/\//i, '').toLowerCase();

      // Prevent domain hijacking — a domain can only be linked to one store globally
      const domainInUse = await Settings.findOne({ domain, storeId: { $ne: store.id } });
      if (domainInUse) {
        return res.status(409).json({ error: 'This domain is already linked to another store' });
      }

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: { domain } },
        { upsert: true, new: true }
      );
      res.json({
        message:  'Custom domain saved. Point your CNAME to stores.storelink.ng',
        domain,
        settings,
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/settings/tracking-pixels  — Pro+, filtered by plan
router.put(
  '/settings/tracking-pixels',
  protect,
  requirePlan('pro'),
  [
    body('metaPixId').optional().trim().isLength({ max: 20 }).withMessage('Invalid Meta Pixel ID'),
    body('tiktokPixId').optional().trim().isLength({ max: 30 }).withMessage('Invalid TikTok Pixel ID'),
    body('gaId')
      .optional()
      .trim()
      .matches(/^G-[A-Z0-9]+$|^$/)
      .withMessage('GA4 ID must start with G-'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store  = await activeStore(req.user.id);
      const limits = getPlanLimits(req.user.plan);
      const updates = {};

      if (limits.allowedPixels.includes('meta')   && req.body.metaPixId   !== undefined) updates.metaPixId   = req.body.metaPixId.trim();
      if (limits.allowedPixels.includes('tiktok') && req.body.tiktokPixId !== undefined) updates.tiktokPixId = req.body.tiktokPixId.trim();
      if (limits.allowedPixels.includes('ga')     && req.body.gaId        !== undefined) updates.gaId        = req.body.gaId.trim();

      if (!Object.keys(updates).length) {
        return res.status(403).json({
          error:         'No allowed pixel fields for your plan',
          allowedPixels: limits.allowedPixels,
        });
      }

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: updates },
        { upsert: true, new: true }
      );
      res.json({ message: 'Tracking pixels updated', allowedPixels: limits.allowedPixels, settings });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// PUT /api/dashboard/settings/preferences
router.put(
  '/settings/preferences',
  protect,
  [
    body('prefPrices').optional().isBoolean(),
    body('prefCart').optional().isBoolean(),
    body('prefSoldout').optional().isBoolean(),
    body('prefLive').optional().isBoolean(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store   = await activeStore(req.user.id);
      const allowed = ['prefPrices', 'prefCart', 'prefSoldout', 'prefLive'];
      const updates = {};
      allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

      const settings = await Settings.findOneAndUpdate(
        { storeId: store.id },
        { $set: updates },
        { upsert: true, new: true }
      );
      res.json({ message: 'Preferences updated', settings });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// GET /api/dashboard/pixels/verify
router.get('/pixels/verify', protect, async (req, res) => {
  try {
    const store    = await activeStore(req.user.id);
    const settings = await Settings.findOne({ storeId: store.id }).select('metaPixId tiktokPixId gaId');
    res.json({
      meta:   !!(settings?.metaPixId),
      tiktok: !!(settings?.tiktokPixId),
      ga:     !!(settings?.gaId),
    });
  } catch (err) {
    errRes(res, err);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
//  PLANS
// ─────────────────────────────────────────────────────────────────────────────


// GET /api/dashboard/plans/current
router.get('/plans/current', protect, async (req, res) => {
  try {
    const limits = getPlanLimits(req.user.plan);
    const user   = await User.findOne({ id: req.user.id }).select('plan pendingPlan planExpiresAt');

    res.json({
      currentPlan:  user.plan,
      pendingPlan:  user.pendingPlan  || null,
      expiresAt:    user.planExpiresAt || null,
      limits,
    });
  } catch (err) {
    errRes(res, err);
  }
});


// GET /api/dashboard/plans
router.get('/plans', protect, async (req, res) => {
  try {
    const allPlans = ['free', 'pro', 'business'].map(id => ({
      id,
      name:     id.charAt(0).toUpperCase() + id.slice(1),
      price:    id === 'free' ? 0 : id === 'pro' ? 5000 : 12000,
      features: PLAN_LIMITS[id],
      current:  req.user.plan === id,
    }));
    res.json({ plans: allPlans, currentPlan: req.user.plan });
  } catch (err) {
    errRes(res, err);
  }
});


// POST /api/dashboard/plans/upgrade
router.post(
  '/plans/upgrade',
  protect,
  [
    body('targetPlan')
      .isIn(['pro', 'business'])
      .withMessage('Target plan must be "pro" or "business"'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { targetPlan } = req.body;

      if (req.user.plan === targetPlan) {
        return res.status(400).json({ error: 'You are already on this plan' });
      }

      const PLAN_RANK = { free: 0, pro: 1, business: 2 };
      if (PLAN_RANK[targetPlan] <= PLAN_RANK[req.user.plan]) {
        return res.status(400).json({
          error: 'Use the downgrade endpoint to move to a lower plan',
        });
      }

      const amount = targetPlan === 'pro' ? 5000 : 12000;
      res.json({
        message:             `Initiate upgrade to ${targetPlan} plan`,
        targetPlan,
        amount,
        currency:            'NGN',
        paymentInstructions: `Proceed to payment to activate your ${targetPlan} plan.`,
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// POST /api/dashboard/plans/downgrade
router.post(
  '/plans/downgrade',
  protect,
  [
    body('targetPlan')
      .isIn(['free', 'pro'])
      .withMessage('Target plan must be "free" or "pro"'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { targetPlan } = req.body;

      if (req.user.plan === targetPlan) {
        return res.status(400).json({ error: 'You are already on this plan' });
      }

      const PLAN_RANK = { free: 0, pro: 1, business: 2 };
      if (PLAN_RANK[targetPlan] >= PLAN_RANK[req.user.plan]) {
        return res.status(400).json({
          error: 'Use the upgrade endpoint to move to a higher plan',
        });
      }

      // Schedule downgrade at end of billing cycle — never downgrade immediately
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() + 30);

      const user          = await User.findOne({ id: req.user.id });
      user.pendingPlan    = targetPlan;
      user.planExpiresAt  = effectiveDate;
      await user.save();

      res.json({
        success:       true,
        message:       `Downgrade to ${targetPlan} plan scheduled`,
        note:          'Your plan will be downgraded at the end of your current billing period. All features remain active until then.',
        currentPlan:   req.user.plan,
        pendingPlan:   targetPlan,
        effectiveDate: effectiveDate.toISOString(),
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);



// GET /api/dashboard/stores/:id/link
router.get(
  '/stores/:id/link',
  protect,
  [param('id').isString().trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const store = await Store.findOne({ id: req.params.id, ownerId: req.user.id });
      if (!store) return res.status(404).json({ error: 'Store not found' });

      // Get store-level custom domain (set by seller)
      const storeSettings = await Settings.findOne({ storeId: store.id }).select('domain');

      // Get platform base domain set by admin (e.g. "bmilink.com")
      const platform = await PlatformSettings.findOne({ singleton: true }).select('baseDomain platformName');
      const baseDomain = platform?.baseDomain || 'bmilink.com'; // fallback

      // Priority: seller custom domain > subdomain on platform domain
      const publicLink = storeSettings?.domain
        ? `https://${storeSettings.domain}`
        : `https://${store.slug}.${baseDomain}`;

      res.json({
        storeId:      store.id,
        slug:         store.slug,
        publicLink,
        customDomain: storeSettings?.domain || null,
        subdomain:    `${store.slug}.${baseDomain}`,
        baseDomain,
        platformName: platform?.platformName || 'StoreLink',
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);



// POST /api/dashboard/uploads/image
router.post(
  '/uploads/image',
  protect,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 5MB)' : err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file provided' });

      res.status(201).json({
        url:       req.file.path,          // Cloudinary secure URL
        publicId:  req.file.filename,      // Cloudinary public_id
        width:     req.file.width  || null,
        height:    req.file.height || null,
      });
    } catch (err) {
      errRes(res, err);
    }
  }
);


// DELETE /api/dashboard/uploads/image
router.delete(
  '/uploads/image',
  protect,
  [
    body('publicId')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('publicId is required')
      .matches(/^[a-zA-Z0-9_\-\/]+$/)
      .withMessage('Invalid publicId format'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { publicId } = req.body;

      // Security: ensure publicId belongs to storelink/products folder only
      if (!publicId.startsWith('storelink/products/')) {
        return res.status(403).json({ error: 'Cannot delete files outside storelink/products' });
      }

      const result = await cloudinary.uploader.destroy(publicId);

      if (result.result !== 'ok' && result.result !== 'not found') {
        return res.status(500).json({ error: 'Failed to delete image from storage' });
      }

      res.json({ message: 'Image deleted', publicId });
    } catch (err) {
      errRes(res, err);
    }
  }
);



// GET /api/platform/settings  — public platform branding info
router.get('/platform/settings', async (req, res) => {
  try {
    const platform   = await PlatformSettings.findOne({ singleton: true })
      .select('baseDomain platformName supportEmail logoUrl');
    res.json({
      baseDomain:   platform?.baseDomain   || 'storelink.ng',
      platformName: platform?.platformName || 'StoreLink',
      supportEmail: platform?.supportEmail || 'support@storelink.ng',
      logoUrl:      platform?.logoUrl      || null,
    });
  } catch (err) {
    errRes(res, err);
  }
});



// ====================== ACTIVITY TRACKING (Public store) ======================
// POST /api/dashboard/track/activity
router.post(
  '/track/activity',
  [
    body('storeId').isString().trim().notEmpty().withMessage('storeId required'),
    body('type').isIn(['visit', 'order_tap', 'cart']).withMessage('Invalid activity type'),
    body('productId').optional().isString().trim(),
    body('items').optional().isArray(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { storeId, type, productId, items } = req.body;

      // Verify store exists
      const store = await Store.findOne({ id: storeId });
      if (!store) return res.status(404).json({ error: 'Store not found' });

      // Create activity record
      const activity = await Activity.create({
        storeId,
        type,
        productId: productId || null,
        items: items || null,
        ipHash: hashIP(req.ip || req.socket.remoteAddress),
        userAgent: req.headers['user-agent'] || null,
      });

      // If order_tap, increment product click count
      if (type === 'order_tap' && productId) {
        await Product.findOneAndUpdate(
          { id: productId, storeId },
          { $inc: { clicks: 1 } }
        );
      }

      res.status(201).json({ success: true, activity });
    } catch (err) {
      errRes(res, err);
    }
  }
);


module.exports = router;