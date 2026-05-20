// routes/productsRoutes.js
const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const crypto = require('crypto');

const Product = require('../models/Product');
const Store = require('../models/Store');
const Activity = require('../models/Activity');
const { getPlanLimits } = require('../utils/planLimits');
const { protect } = require('../middleware/authMiddleware');

// ====================== HELPERS ======================
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

const hashIP = (ip) => {
  if (!ip) return null;
  return crypto.createHash('sha256')
    .update(ip + (process.env.IP_SALT || 'default-salt'))
    .digest('hex')
    .slice(0, 16);
};

// ====================== PUBLIC ROUTES ======================

// GET /api/products - Public Store Products
router.get(
  '/',
  [
    query('storeSlug').notEmpty().withMessage('storeSlug is required'),
    query('category').optional().isString(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('search').optional().trim().escape(),
    validateRequest,
  ],
  async (req, res, next) => {
    try {
      const { storeSlug, category, page = 1, limit = 20, search } = req.query;

      const store = await Store.findOne({ slug: storeSlug, status: 'live' }).lean();
      if (!store) {
        return res.status(404).json({ success: false, message: 'Store not found or not live' });
      }

      const queryObj = { storeId: store.id, status: { $ne: 'hidden' } };   // ← using .id
      if (category && category !== 'all') queryObj.catId = category;
      if (search) queryObj.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

      const skip = (page - 1) * limit;

      const [products, total] = await Promise.all([
        Product.find(queryObj)
          .select('id name emoji price originalPrice images desc promo status isNew isHot stock catId clicks')
          .skip(skip)
          .limit(limit)
          .sort({ isHot: -1, isNew: -1, createdAt: -1 })
          .lean(),
        Product.countDocuments(queryObj),
      ]);

      res.json({
        success: true,
        data: products,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/products/:id → Record Visit
router.get(
  '/:id',
  [
    param('id').notEmpty(),
    query('storeSlug').notEmpty(),
    validateRequest,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { storeSlug } = req.query;

      const store = await Store.findOne({ slug: storeSlug, status: 'live' });
      if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

      const product = await Product.findOne({ id, storeId: store.id }).lean();   // ← using id
      if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

      // Record Visit
      Activity.create({
        storeId: store.id,
        type: 'visit',
        productId: id,
        productName: product.name,
        ipHash: hashIP(req.ip),
      }).catch(() => {});

      // Increment clicks
      Product.updateOne({ id }, { $inc: { clicks: 1 } }).catch(() => {});

      res.json({ success: true, data: product });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/products/:id/order-tap → Record WhatsApp Order Click
router.post(
  '/:id/order-tap',
  [
    param('id').notEmpty().withMessage('Product ID is required'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const product = await Product.findOne({ id }).select('storeId name').lean();

      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      // Record strong intent (Order on WhatsApp clicked)
      Promise.all([
        Product.updateOne({ id }, { $inc: { clicks: 1 } }),
        Activity.create({
          storeId: product.storeId,
          type: 'order_tap',
          productId: id,
          productName: product.name,
          ipHash: hashIP(req.ip),
        })
      ]).catch(() => {});

      res.json({ success: true, message: 'Order tap recorded' });
    } catch (error) {
      res.json({ success: true, message: 'Order tap recorded' });
    }
  }
);

module.exports = router;