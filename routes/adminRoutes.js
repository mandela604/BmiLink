// routes/adminRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const router = express.Router();

const { protectAdmin, requireAdminRole } = require('../middleware/authMiddleware');
const { logAction } = require('../utils/adminAudit');

const User = require('../models/User');
const Store = require('../models/Store');
const Ticket = require('../models/Ticket');
const Verification = require('../models/Verification');
const PromoBanner = require('../models/PromoBanner');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const PlatformSettings = require('../models/PlatformSettings');
const Plan = require('../models/Plan');
const Coupon = require('../models/Coupon');
const Admin = require('../models/Admin');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Settings = require('../models/Settings');
const OrderLog = require('../models/OrderLog');
const Contact = require('../models/Contact');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');


function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



// ====================== DASHBOARD ======================
router.get('/dashboard', protectAdmin, async (req, res, next) => {
  try {
    const [users, stores, tickets, verifications] = await Promise.all([
      User.find().select('id name email plan status createdAt').lean(),
      Store.find().select('id name ownerId status isLive verified visits products').lean(),
      Ticket.find().lean(),
      Verification.find().lean(),
    ]);

    const mrr = users
      .filter(u => u.status === 'active')
      .reduce((sum, u) => sum + (u.plan === 'pro' ? 5000 : u.plan === 'business' ? 12000 : 0), 0);

    res.json({
      success: true,
      summary: {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.status === 'active').length,
        liveStores: stores.filter(s => s.isLive).length,
        openTickets: tickets.filter(t => t.status !== 'resolved').length,
        pendingVerifications: verifications.filter(v => v.status === 'pending').length,
        mrr,
      },
      users: users.slice(0, 8),
      stores: stores.slice(0, 8),
      tickets: tickets.slice(0, 10),
      verifications: verifications.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ====================== USERS ======================
router.get('/users', protectAdmin, async (req, res, next) => {
  try {
    const { plan, status, search, page = 1, limit = 100 } = req.query;
    const query = {};
    if (plan) query.plan = plan;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('id name email waNumber plan status city createdAt planExpiresAt')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),
      User.countDocuments(query),
    ]);

    res.json({ success: true, users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

router.post('/users', protectAdmin, async (req, res, next) => {
  try {
    const { name, email, wa, password, plan, role, status, city, planExpiry, notes } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Name required' });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }

const user = new User({
  id:       uuidv4(),
  name,
  email:    email || null,
  password, // plain — pre('save') hook hashes it
  waNumber: wa,
  plan:     plan     || 'free',
  role:     role     || 'seller',
  status:   status   || 'active',
  city,
  planExpiresAt: planExpiry ? new Date(planExpiry) : null,
  notes,
});
await user.save(); // triggers pre('save') hook — hashes password, sets initials

    // Generate token just like normal registration
 /*   const token = signToken(user.id);

    // Set HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    }); */

    logAction(req.admin, 'User Added', user.name, '', req.ip);
  const safeUser = user.toObject();
delete safeUser.password;
res.status(201).json({ 
  success: true, 
  user: safeUser
});
  } catch (err) {
    next(err);
  }
});


router.get('/users/:id', protectAdmin, async (req, res, next) => {
  try {
    const user = await User.findOne({ id: req.params.id }).select('-password').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});



router.put('/users/:id', protectAdmin, async (req, res, next) => {
  try {
    // Never allow overwriting these via bulk update
    const { password, id, ...safeFields } = req.body;

// Only super_admin can change roles
if (safeFields.role && req.admin.role !== 'super_admin') {
  delete safeFields.role;
}

    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { $set: safeFields },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    logAction(req.admin, 'User Updated', user.name, 'Admin edited details', req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id/plan', protectAdmin, async (req, res, next) => {
  try {
    const { plan, planExpiry } = req.body;
    if (!['free', 'pro', 'business'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.params.id },
      { plan, planExpiresAt: planExpiry ? new Date(planExpiry) : null },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    logAction(req.admin, 'Plan Changed', user.name, `Changed to ${plan}`, req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id/suspend', protectAdmin, async (req, res, next) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const wasActive = user.status === 'active';
    user.status = wasActive ? 'suspended' : 'active';
    await user.save();

    await Store.updateMany(
      { ownerId: user.id },
      { status: wasActive ? 'suspended' : 'live' }
    );

    logAction(req.admin, wasActive ? 'User Suspended' : 'User Reactivated', user.name, req.body.reason || '', req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', protectAdmin, requireAdminRole('super_admin'), async (req, res, next) => {
  try {
   const user = await User.findOneAndDelete({ id: req.params.id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Get all store IDs belonging to this user before deleting
    const userStores = await Store.find({ ownerId: user.id }).select('id').lean();
    const storeIds = userStores.map(s => s.id);

    await Promise.all([
      Store.deleteMany({ ownerId: user.id }),
      Product.deleteMany({ storeId: { $in: storeIds } }),
      Category.deleteMany({ storeId: { $in: storeIds } }),
      Settings.deleteMany({ storeId: { $in: storeIds } }),
      OrderLog.deleteMany({ storeId: { $in: storeIds } }),
      Contact.deleteMany({ storeId: { $in: storeIds } }),
      Verification.deleteMany({ storeId: { $in: storeIds } }),
      Ticket.deleteMany({ userId: user.id }),
    ]);

    logAction(req.admin, 'User Deleted', user.name, 'Account permanently removed', req.ip);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    next(err);
  }
});


// ====================== SINGLE STORE ======================
router.get('/stores/:id', protectAdmin, async (req, res, next) => {
  try {
    const store = await Store.findOne({ id: req.params.id }).lean();
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    res.json({ success: true, data: store });
  } catch (err) {
    next(err);
  }
});



// ====================== STORES ======================
router.get('/stores', protectAdmin, async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 100 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { ownerName: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [stores, total] = await Promise.all([
      Store.find(query)
        .select('id name emoji ownerId ownerName status isLive verified visits products createdAt')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),
      Store.countDocuments(query),
    ]);

    res.json({ success: true, stores, total });
  } catch (err) {
    next(err);
  }
});

router.put('/stores/:id', protectAdmin, async (req, res, next) => {
  try {
    const { id, _id, ownerId, slug, ...safeFields } = req.body; // never overwrite ownership or slug
    // Keep isLive and status in sync
    if (safeFields.isLive !== undefined) {
      safeFields.status = safeFields.isLive ? 'live' : 'suspended';
    }

    const store = await Store.findOneAndUpdate(
      { id: req.params.id },
      { $set: safeFields },
      { new: true, runValidators: true }
    );
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    logAction(req.admin, 'Store Updated', store.name, 'Admin override', req.ip);
    res.json({ success: true, data: store });
  } catch (err) {
    next(err);
  }
});



router.put('/stores/:id/status', protectAdmin, async (req, res, next) => {
  try {
    const store = await Store.findOne({ id: req.params.id });
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });

    store.status = store.status === 'live' ? 'suspended' : 'live';
    store.isLive = store.status === 'live';
    await store.save();

    logAction(req.admin, store.isLive ? 'Store Reactivated' : 'Store Suspended', store.name, '', req.ip);
    res.json({ success: true, data: store });
  } catch (err) {
    next(err);
  }
});



router.delete('/stores/:id', protectAdmin, requireAdminRole('super_admin'), async (req, res, next) => {
  const store = await Store.findOneAndDelete({ id: req.params.id });
  if (!store) return res.status(404).json({ success: false });
  logAction(req.admin, 'Store Deleted', store.name, '', req.ip);
  res.json({ success: true });
});


// ====================== PLANS ======================
router.get('/plans', protectAdmin, async (req, res, next) => {
  try {
    const plans = await Plan.find().sort({ price: 1 }).lean();
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
});

router.put('/plans', protectAdmin, requireAdminRole('super_admin'), async (req, res, next) => {
  try {
    const plans = Array.isArray(req.body) ? req.body : [req.body];
    const updated = await Promise.all(
      plans.map(p => Plan.findOneAndUpdate({ id: p.id }, { $set: p }, { new: true, upsert: true }))
    );
    logAction(req.admin, 'Plans Updated', 'All Plans', 'Pricing & features changed', req.ip);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ====================== PROMO BANNERS ======================
router.get('/promo-banners', protectAdmin, async (req, res, next) => {
  try {
    const banners = await PromoBanner.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: banners });
  } catch (err) {
    next(err);
  }
});

router.post('/promo-banners', protectAdmin, async (req, res, next) => {
  try {
    const banner = await PromoBanner.create({
      ...req.body,
      pushedBy: req.admin.id,
      status: 'active'
    });
    logAction(req.admin, 'Promo Banner Created', banner.title || 'New Banner', `Target: ${banner.target}`, req.ip);
    res.status(201).json({ success: true, data: banner });
  } catch (err) {
    next(err);
  }
});

router.delete('/promo-banners/:id', protectAdmin, async (req, res, next) => {
  try {
    await PromoBanner.findOneAndUpdate({ id: req.params.id }, { status: 'removed' });
    logAction(req.admin, 'Promo Banner Removed', `Banner ${req.params.id}`, '', req.ip);
    res.json({ success: true, message: 'Banner removed' });
  } catch (err) {
    next(err);
  }
});

// ====================== VERIFICATIONS ======================
// ====================== VERIFICATIONS (with pagination) ======================

router.get('/verifications/:id', protectAdmin, async (req, res, next) => {
  try {
    const verif = await Verification.findOne({ id: req.params.id }).lean();
    if (!verif) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: verif });
  } catch (err) { next(err); }
});


router.get('/verifications', protectAdmin, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const query = status && status !== 'all' ? { status } : {};

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [verifs, total] = await Promise.all([
      Verification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Verification.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: verifs,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});



router.put('/verifications/:id', protectAdmin, async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const verif = await Verification.findOneAndUpdate(
      { id: req.params.id },
      { status, reason, reviewedBy: req.admin.id, reviewedAt: new Date() },
      { new: true }
    );

    if (!verif) return res.status(404).json({ success: false, message: 'Verification not found' });

    await Store.findOneAndUpdate({ id: verif.storeId }, { verified: status === 'approved' });

    logAction(req.admin, status === 'approved' ? 'Verification Approved' : 'Verification Rejected', verif.storeName, reason || '', req.ip);
    res.json({ success: true, data: verif });
  } catch (err) {
    next(err);
  }
});

router.put('/verifications/:id/revoke', protectAdmin, async (req, res, next) => {
  try {
    const verif = await Verification.findOneAndUpdate(
      { id: req.params.id },
      { status: 'pending', reason: '', reviewedBy: req.admin.id, reviewedAt: new Date() },
      { new: true }
    );
    if (!verif) return res.status(404).json({ success: false, message: 'Verification not found' });

    await Store.findOneAndUpdate({ id: verif.storeId }, { verified: false });
    logAction(req.admin, 'Verification Revoked', verif.storeName, '', req.ip);
    res.json({ success: true, data: verif });
  } catch (err) {
    next(err);
  }
});

// ====================== TICKETS ======================
// ====================== TICKETS (with pagination) ======================
router.get('/tickets/:id', protectAdmin, async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ id: req.params.id }).lean();
    if (!ticket) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
});


router.get('/tickets', protectAdmin, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const query = status && status !== 'all' ? { status } : {};

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Ticket.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: tickets,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});


router.put('/tickets/:id', protectAdmin, async (req, res, next) => {
  try {
    const { status, priority, reply, note } = req.body;
    const allowed = {};
    if (status)   allowed.status   = status;
    if (priority) allowed.priority = priority;
    if (reply)    allowed.reply    = reply;
    if (note)     allowed.note     = note;

    const ticket = await Ticket.findOneAndUpdate(
      { id: req.params.id },
      { $set: allowed },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    logAction(req.admin, 'Ticket Updated', `Ticket #${ticket.id}`, req.body.status || '', req.ip);
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
});


// ====================== SUBSCRIPTIONS ======================
// GET /api/admin/subscriptions
router.get('/subscriptions', protectAdmin, async (req, res, next) => {
  try {
    const { plan, status, page = 1, limit = 50 } = req.query;

    const query = { plan: { $ne: 'free' } }; // Only paid plans

    if (plan) query.plan = plan;
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [subscriptions, total] = await Promise.all([
      User.find(query)
        .select('id name email plan status planExpiresAt createdAt')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ planExpiresAt: -1, createdAt: -1 })
        .lean(),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: subscriptions,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});



// ====================== ANNOUNCEMENTS ======================

// GET /api/admin/announcements
router.get('/announcements', protectAdmin, async (req, res, next) => {
  try {
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .lean();
    
    res.json({ 
      success: true, 
      data: announcements 
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/announcements
router.post('/announcements', protectAdmin, async (req, res, next) => {
  try {
    const { title, msg, type = 'info', target = 'all', sendWA = false, showBanner = true } = req.body;

    if (!title || !msg) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and message are required' 
      });
    }

    // Calculate reach (approximate)
    let reach = 0;
    if (target === 'all') {
      reach = await User.countDocuments({ status: 'active' });
    } else if (['free', 'pro', 'business'].includes(target)) {
      reach = await User.countDocuments({ status: 'active', plan: target });
    }

    const announcement = await Announcement.create({
      title,
      msg,
      type,
      target,
      sendWA,
      showBanner,
      reach,
      sentBy: req.admin.id,
    });

    logAction(req.admin, 'Announcement Sent', title, `Target: ${target}`, req.ip);

    res.status(201).json({ 
      success: true, 
      data: announcement,
      message: 'Announcement sent successfully' 
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', protectAdmin, async (req, res, next) => {
  try {
    const announcement = await Announcement.findOneAndDelete({ 
      id: req.params.id 
    });

    if (!announcement) {
      return res.status(404).json({ 
        success: false, 
        message: 'Announcement not found' 
      });
    }

    logAction(req.admin, 'Announcement Deleted', announcement.title, '', req.ip);

    res.json({ 
      success: true, 
      message: 'Announcement deleted successfully' 
    });
  } catch (err) {
    next(err);
  }
});



// ====================== ANALYTICS ======================
// GET /api/admin/analytics
router.get('/analytics', protectAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const thirtyEightDaysAgo = new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000);

    const [users, stores, signupData, topStores, prevMonthUsers, heatmapData] = await Promise.all([
      User.find().select('plan status createdAt').lean(),
      Store.find().select('visits products isLive verified').lean(),

      // Daily signups - last 30 days
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Top 10 Stores
      Store.find()
        .select('id name emoji visits products')
        .sort({ visits: -1 })
        .limit(10)
        .lean(),

     // Previous period users for growth
      User.find({
        createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
      }).select('plan status').lean(),

      // Daily signups last 35 days for heatmap
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyEightDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Current MRR
    const activePro = users.filter(u => u.plan === 'pro' && u.status === 'active').length;
    const activeBusiness = users.filter(u => u.plan === 'business' && u.status === 'active').length;
    const currentMRR = (activePro * 5000) + (activeBusiness * 12000);

    // Previous MRR (for growth)
    const prevActivePro = prevMonthUsers.filter(u => u.plan === 'pro' && u.status === 'active').length;
    const prevActiveBusiness = prevMonthUsers.filter(u => u.plan === 'business' && u.status === 'active').length;
    const previousMRR = (prevActivePro * 5000) + (prevActiveBusiness * 12000);

    // Growth Rate
    let growthRate = 0;
    if (previousMRR > 0) {
      growthRate = Math.round(((currentMRR - previousMRR) / previousMRR) * 100);
    }

    // Monthly signups (last 6 months) - No MRR estimation
    const monthlySignups = await User.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          signups: { $sum: 1 },
          activePro: {
            $sum: { $cond: [{ $and: [{ $eq: ["$plan", "pro"] }, { $eq: ["$status", "active"] }] }, 1, 0] }
          },
          activeBusiness: {
            $sum: { $cond: [{ $and: [{ $eq: ["$plan", "business"] }, { $eq: ["$status", "active"] }] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 6 }
    ]);

    res.json({
      success: true,
      summary: {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.status === 'active').length,
        activePro: activePro,
        activeBusiness: activeBusiness,
        totalStores: stores.length,
        liveStores: stores.filter(s => s.status === 'live').length,
        verifiedStores: stores.filter(s => s.verified).length,
        totalVisits: stores.reduce((sum, s) => sum + (s.visits || 0), 0),
        currentMRR,
        growthRate
      },
      signupData,
      monthlySignups,
      topStores,
      heatmapData
    });
  } catch (err) {
    next(err);
  }
});




// ====================== SETTINGS ======================
router.get('/settings', protectAdmin, async (req, res, next) => {
  try {
    let settings = await PlatformSettings.findOne({ singleton: true });
    if (!settings) {
      settings = await PlatformSettings.create({ singleton: true });
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', protectAdmin, requireAdminRole('super_admin'), async (req, res, next) => {
  try {
    // Whitelist what admin can actually change
    const allowed = ['platformName', 'baseDomain', 'maintenanceMode', 'allowRegistrations', 'featureFlags', 'supportEmail', 'supportWA'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Validate baseDomain if provided
    if (updates.baseDomain && !/^[a-z0-9][a-z0-9\-.]{1,61}[a-z0-9]\.[a-z]{2,}$/.test(updates.baseDomain)) {
      return res.status(400).json({ success: false, message: 'Invalid base domain format' });
    }

    const settings = await PlatformSettings.findOneAndUpdate(
      { singleton: true },
      { $set: updates },
      { new: true, upsert: true }
    );
    logAction(req.admin, 'Platform Settings Updated', 'Global', Object.keys(updates).join(', '), req.ip);
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
});

router.put('/settings/feature-flag/:flagId', protectAdmin, requireAdminRole('super_admin'), async (req, res, next) => {
  try {
    const { flagId } = req.params;
    const { enabled } = req.body;

    let settings = await PlatformSettings.findOne({ singleton: true });
    if (!settings) settings = await PlatformSettings.create({ singleton: true });

    const flag = settings.featureFlags.find(f => f.id === flagId);
    if (flag) flag.enabled = !!enabled;
    else settings.featureFlags.push({ id: flagId, enabled: !!enabled });

    await settings.save();
    logAction(req.admin, 'Feature Flag Toggled', flagId, enabled ? 'Enabled' : 'Disabled', req.ip);
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
});

// ====================== AUDIT LOGS ======================
// ====================== AUDIT LOGS (with pagination) ======================
router.get('/audit-logs', protectAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 100 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      AuditLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AuditLog.countDocuments()
    ]);

    res.json({
      success: true,
      data: logs,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});

// ====================== PUBLIC COUPON VALIDATE ======================
// POST /api/admin/coupons/validate  ← called by payment.html at checkout
router.post('/coupons/validate', async (req, res, next) => {
  try {
    const { code, plan } = req.body;
    if (!code) return res.status(400).json({ valid: false, message: 'No code provided' });

    const now = new Date();
    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });

    if (!coupon || !coupon.active)
      return res.json({ valid: false, message: 'Invalid or inactive coupon' });

    if (coupon.expiry && new Date(coupon.expiry) < now)
      return res.json({ valid: false, message: 'Coupon has expired' });

    if (coupon.start && new Date(coupon.start) > now)
      return res.json({ valid: false, message: 'Coupon is not active yet' });

    if (coupon.maxUses && coupon.used >= coupon.maxUses)
      return res.json({ valid: false, message: 'Coupon usage limit reached' });

    if (coupon.plan !== 'all' && !coupon.plan.split(',').includes(plan))
      return res.json({ valid: false, message: `Coupon only valid for: ${coupon.plan}` });

    const PLAN_PRICES = { pro: 5000, business: 12000 };
    const basePrice = PLAN_PRICES[plan] || 0;
    let discount = 0;

    if (coupon.type === 'percent')  discount = Math.round(basePrice * coupon.value / 100);
    if (coupon.type === 'fixed')    discount = Math.min(coupon.value, basePrice);
    if (coupon.type === 'months')   discount = basePrice * coupon.value;

    res.json({
      valid: true,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      newPrice: Math.max(0, basePrice - discount),
      message: `✅ ${coupon.type === 'percent' ? coupon.value + '% off' : coupon.type === 'fixed' ? '₦' + coupon.value.toLocaleString() + ' off' : coupon.value + ' month(s) free'}`,
    });
  } catch (err) {
    next(err);
  }
});



// ====================== COUPONS ======================


// GET /api/admin/coupons/:id
router.get('/coupons/:id', protectAdmin, async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({ id: req.params.id }).lean();
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
});



// GET /api/admin/coupons
router.get('/coupons', protectAdmin, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    
   const now = new Date();
const query = {};
if (status === 'active') {
  query.active = true;
  query.$or = [{ expiry: null }, { expiry: { $gt: now } }];
}
if (status === 'expired') {
  query.$or = [{ active: false }, { expiry: { $lte: now } }];
}
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [coupons, total] = await Promise.all([
      Coupon.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Coupon.countDocuments(query),
    ]);
    
    // Add computed status
    const couponsWithStatus = coupons.map(c => ({
      ...c,
      computedStatus: c.active && (!c.expiry || new Date(c.expiry) > now) && (!c.maxUses || (c.used || 0) < c.maxUses) 
        ? 'active' 
        : 'expired'
    }));
    
    res.json({ 
      success: true, 
      data: couponsWithStatus,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/coupons
router.post('/coupons', protectAdmin, async (req, res, next) => {
  try {
    const { code, type, value, plan, eligible, maxUses, perUser, start, expiry, desc, active, firstTime } = req.body;
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code required' });
    }
    
    if (!value || value <= 0) {
      return res.status(400).json({ success: false, message: 'Valid discount value required' });
    }
    
    // Check for duplicate code
    const existing = await Coupon.findOne({ code: code.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }
    
    const coupon = await Coupon.create({
      id: uuidv4(),
      code: code.toUpperCase(),
      type: type || 'percent',
      value,
      plan: plan || 'all',
      eligible: eligible || 'all',
      maxUses: maxUses || null,
      used: 0,
      perUser: perUser || '1',
      start: start || null,
      expiry: expiry || null,
      desc: desc || '',
      active: active !== false,
      firstTime: firstTime || false,
      createdBy: req.admin.id,
    });
    
    logAction(req.admin, 'Coupon Created', coupon.code, `${coupon.value}${coupon.type === 'percent' ? '%' : '₦'} off`, req.ip);
    res.status(201).json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/coupons/:id
router.put('/coupons/:id', protectAdmin, async (req, res, next) => {
  try {
    const { code, type, value, plan, eligible, maxUses, perUser, start, expiry, desc, active, firstTime } = req.body;
    
    const coupon = await Coupon.findOne({ id: req.params.id });
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    
    // Check for duplicate code if code changed
    if (code && code.toUpperCase() !== coupon.code) {
      const existing = await Coupon.findOne({ code: code.toUpperCase(), id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Coupon code already exists' });
      }
      coupon.code = code.toUpperCase();
    }
    
    if (type) coupon.type = type;
    if (value) coupon.value = value;
    if (plan) coupon.plan = plan;
    if (eligible) coupon.eligible = eligible;
    if (maxUses !== undefined) coupon.maxUses = maxUses || null;
    if (perUser) coupon.perUser = perUser;
    if (start !== undefined) coupon.start = start || null;
    if (expiry !== undefined) coupon.expiry = expiry || null;
    if (desc !== undefined) coupon.desc = desc;
    if (active !== undefined) coupon.active = active;
    if (firstTime !== undefined) coupon.firstTime = firstTime;
    
    await coupon.save();
    
    logAction(req.admin, 'Coupon Updated', coupon.code, '', req.ip);
    res.json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/coupons/:id
router.delete('/coupons/:id', protectAdmin, async (req, res, next) => {
  try {
    const coupon = await Coupon.findOneAndDelete({ id: req.params.id });
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    
    logAction(req.admin, 'Coupon Deleted', coupon.code, '', req.ip);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/coupons/:id/toggle (alternative to PUT)
router.post('/coupons/:id/toggle', protectAdmin, async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({ id: req.params.id });
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    
    coupon.active = !coupon.active;
    await coupon.save();
    
    logAction(req.admin, coupon.active ? 'Coupon Enabled' : 'Coupon Disabled', coupon.code, '', req.ip);
    res.json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
});



// ====================== ADMIN AUTH ======================

// POST /api/admin/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!admin)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: admin.id }, process.env.JWT_ADMIN_SECRET, { expiresIn: '7d' });

    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    admin.lastLogin = new Date();
    await admin.save();

    res.json({
      success: true,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true });
});

// GET /api/admin/auth/me
router.get('/auth/me', protectAdmin, async (req, res) => {
  res.json({ success: true, admin: req.admin });
});




// TEMPORARY — delete after first use
/*router.get('/setup-first-admin', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const existing = await Admin.findOne({ role: 'super_admin' });
  if (existing) return res.json({ error: 'Admin already exists' });
  const admin = await Admin.create({
    id: uuidv4(),
    name: 'Super Admin',
    email: 'your@email.com',
    password: await bcrypt.hash('YourStrongPassword123!', 12),
    role: 'super_admin',
    status: 'active',
  });
  res.json({ success: true, id: admin.id });
}); */


module.exports = router;