// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { getPlanLimits } = require('../utils/planLimits');
const User = require('../models/User');
const Admin = require('../models/Admin');

// ==================== FOR SELLER DASHBOARD (HTTP-Only Cookie) ====================
const requireAuth = async (req, res, next) => {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findOne({ id: decoded.id }).select('-password');
    
    if (!req.user || req.user.status !== 'active') {
      return res.status(401).json({ error: 'User inactive' });
    }

    if (req.user.planExpiresAt && new Date() > new Date(req.user.planExpiresAt)) {
      req.user.plan          = req.user.pendingPlan || 'free';
      req.user.planExpiresAt = null;
      req.user.pendingPlan   = null;
      await req.user.save();
    }
    
    next();
  } catch (err) { 
    res.status(401).json({ error: 'Invalid token' }); 
  }
};

// ==================== FOR PUBLIC STORE (Bearer token from URL hash) ====================
const protect = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findOne({ id: decoded.id }).select('-password');

    if (!req.user || req.user.status !== 'active') {
      return res.status(401).json({ error: 'User inactive' });
    }

    if (req.user.planExpiresAt && new Date() > new Date(req.user.planExpiresAt)) {
      req.user.plan          = req.user.pendingPlan || 'free';
      req.user.planExpiresAt = null;
      req.user.pendingPlan   = null;
      await req.user.save();
    }

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== PLAN GATING ====================
const PLAN_RANK = { free: 0, pro: 1, business: 2 };

const requirePlan = (minPlan) => {
  return (req, res, next) => {
    const userPlan = req.user.plan;
    if (PLAN_RANK[userPlan] >= PLAN_RANK[minPlan]) {
      next();
    } else {
      res.status(403).json({ 
        error: `Upgrade to ${minPlan} plan to access this feature`,
        requiredPlan: minPlan,
        currentPlan: userPlan,
      });
    }
  };
};


const checkFeature = (featureName) => {
  return (req, res, next) => {
    const limits = getPlanLimits(req.user.plan);
    if (limits[featureName] === true) {
      next();
    } else if (typeof limits[featureName] === 'number' && limits[featureName] > 0) {
      next();
    } else {
      res.status(403).json({ 
        error: `This feature is not available on your ${req.user.plan} plan`,
        upgradeRequired: true,
      });
    }
  };
};

// ==================== FOR ADMIN DASHBOARD ====================
const protectAdmin = async (req, res, next) => {
  const token = req.cookies.adminToken;
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    req.admin = await Admin.findOne({ id: decoded.id }).select('-password');
    
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

const requireAdminRole = (...roles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

module.exports = { 
  requireAuth,      // For seller dashboard (cookie)
  protect,          // For public store API (Bearer token from URL)
  requirePlan,      // Plan gating
  checkFeature,     // Feature gating
  protectAdmin,     // For admin dashboard (cookie)
  requireAdminRole  // Admin role checking
};