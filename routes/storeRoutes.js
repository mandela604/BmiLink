// routes/storeRoutes.js
const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const Category = require('../models/Category');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Activity = require('../models/Activity');
const Order = require('../models/Order'); 
const CartSession = require('../models/CartSession');
const Settings = require('../models/Settings');
const { hashIP } = require('../utils/helpers');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ====================== PUBLIC STORE ROUTES ======================

// 1. GET /api/stores/:slug
// 1. GET /api/stores/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, status: 'live' }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    const settings = await Settings.findOne({ storeId: store.id }).lean();

    Store.updateOne({ slug: req.params.slug }, { $inc: { visits: 1 } }).catch(() => {});

    res.json({
      success: true,
      id:    store.id,
      name:  store.name,
      emoji: store.emoji,
      slug:  store.slug,
      plan:  store.effectivePlan || store.plan || 'free',
      waNumber: settings?.waNumber || store.waNumber || '',
      description: settings?.heroSub || store.description || '',
      settings: {
        storeName:   settings?.storeName   || store.name,
        storeEmoji:  settings?.storeEmoji  || store.emoji,
        waNumber:    settings?.waNumber    || store.waNumber || '',
        heroTitle:   settings?.heroTitle   || '',
        heroSub:     settings?.heroSub     || '',
        city:        settings?.city        || store.city || '',
        orderMsg:    settings?.orderMsg    || '',
        promo:       settings?.promo       || {},
        waGroup:     settings?.waGroup     || {},
        metaPixelId:  settings?.metaPixId   || '',
        tiktokPixelId: settings?.tiktokPixId || '',
        gaId:         settings?.gaId        || '',
        prefPrices:  settings?.prefPrices  !== false,
        prefCart:    settings?.prefCart    !== false,
      },
      verified: store.isVerified || false,
    });
  } catch (err) {
    next(err);
  }
});


// 2. GET /api/stores/:slug/settings
/* router.get('/:slug/settings', async (req, res, next) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, isLive: true }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    res.json({
      success: true,
      data: {
        storeName: store.name,
        storeEmoji: store.emoji,
        waNumber: store.waNumber,
        city: store.city,
        tagline: store.tagline,
        description: store.description,
        plan: store.plan || 'free'
      }
    });
  } catch (err) {
    next(err);
  }
}); */

// 3. GET /api/stores/:slug/products (with pagination)
router.get('/:slug/products', [
  param('slug').notEmpty(),
  query('category').optional(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('search').optional().trim(),
  validateRequest
], async (req, res, next) => {
  try {
    const { category, page = 1, limit = 20, search } = req.query;
    const store = await Store.findOne({ slug: req.params.slug, status: 'live' });
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    const query = { storeId: store.id, status: { $ne: 'hidden' } };
    if (category) query.catId = category;
    if (search) {
      query.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .select('id name emoji images price originalPrice desc promo status isNew isHot stock')
        .skip(skip)
        .limit(limit)
        .sort({ isHot: -1, createdAt: -1 })
        .lean(),
      Product.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    next(err);
  }
});

// 4. GET /api/stores/:slug/products/:id
router.get('/:slug/products/:id', async (req, res, next) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, status: 'live' });
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    const product = await Product.findOne({
      id: req.params.id,
      storeId: store.id,
      status: { $ne: 'hidden' } 
    }).lean();

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

// 5. GET /api/stores/:slug/related/:productId
router.get('/:slug/related/:productId', async (req, res, next) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, status: 'live' });
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    const related = await Product.find({
      storeId: store.id,
      status: { $ne: 'hidden' },
      id: { $ne: req.params.productId }
    })
      .select('id name emoji images price')
      .limit(6)
      .lean();

    res.json({ success: true, data: related });
  } catch (err) {
    next(err);
  }
});

// 6. GET /api/stores/:slug/categories
// 6. GET /api/stores/:slug/categories
router.get('/:slug/categories', async (req, res, next) => {
  try {
     const store = await Store.findOne({ slug: req.params.slug, status: 'live' });
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    // Get distinct category IDs from products
    const categoryIds = await Product.distinct('catId', { 
      storeId: store.id, 
      status: { $ne: 'hidden' },
      catId: { $nin: [null, '', undefined] }
    });

    // Fetch full category objects from Category model
    const categories = await Category.find({ 
      id: { $in: categoryIds },
      storeId: store.id
    }).select('id name emoji').lean();

    // Add "All" category at the beginning
    const allCategory = { id: 'all', name: 'All', emoji: '✨' };
    
    res.json({ success: true, data: [allCategory, ...categories] });
  } catch (err) {
    next(err);
  }
});



// 7. POST /api/analytics/view  (Product View / Visit)
// 7. POST /api/analytics/view  (Product View / Visit + Store Visit)
router.post('/analytics/view', [
  body('productId').notEmpty(),
  body('storeSlug').optional(),
  validateRequest
], async (req, res) => {
  try {
    const { productId, storeSlug } = req.body;

    let storeId = null;

    if (storeSlug) {
      const store = await Store.findOne({ slug: storeSlug });
      if (store) storeId = store.id;
    }

    const product = await Product.findOne({ id: productId }).select('storeId');
    if (!product && !storeId) return res.status(404).json({ success: false, message: 'Not found' });

    const finalStoreId = storeId || product?.storeId;

    Promise.all([
      product ? Product.updateOne({ id: productId }, { $inc: { clicks: 1 } }) : null,
      Activity.create({
        storeId: finalStoreId,
        type: productId === 'store_visit' ? 'store_visit' : 'visit',
        productId: productId !== 'store_visit' ? productId : null,
        ipHash: hashIP(req.ip)
      })
    ]).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// 8. POST /api/analytics/order-tap
// 8. POST /api/analytics/order-tap
router.post('/analytics/order-tap', [
  body('productId').notEmpty(),
  body('storeSlug').optional(),
  validateRequest
], async (req, res) => {
  try {
    const { productId, storeSlug } = req.body;
    const product = await Product.findOne({ id: productId }).select('storeId name');
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    Promise.all([
      Product.updateOne({ id: productId }, { $inc: { clicks: 1 } }),
      Activity.create({
        storeId: product.storeId,
        type: 'order_tap',
        productId,
        productName: product.name,
        ipHash: hashIP(req.ip)
      })
    ]).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});


// 9. POST /api/orders
router.post('/orders', async (req, res, next) => {
  try {
    const order = await Order.create({
      ...req.body,
      orderId: 'ORD-' + Date.now().toString(36).toUpperCase(),
      status: 'pending'
    });

    // Log activity
    Activity.create({
      storeId: req.body.storeId,
      type: 'order',
      productId: req.body.productId,
      ipHash: hashIP(req.ip)
    }).catch(() => {});

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// 10. GET /api/orders/track/:orderId
router.get('/orders/track/:orderId', async (req, res, next) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// 11. POST /api/cart/session (Optional - for cart persistence)
// 11. POST /api/cart/session — Track Cart Usage
router.post('/cart/session', async (req, res) => {
  try {
    const { storeSlug, action, itemCount } = req.body;

    const store = await Store.findOne({ slug: storeSlug });
    if (!store) return res.json({ success: true });

    // Save cart session
    await CartSession.create({
      storeId: store.id,
      action: action || 'cart_used',
      itemCount: itemCount || 0,
      ipHash: hashIP(req.ip),
      sessionId: 'cart_' + Date.now()
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: true });
  }
});

module.exports = router;