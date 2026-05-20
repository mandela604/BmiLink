// routes/authRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Store = require('../models/Store');
const Settings = require('../models/Settings');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { 
      name, email, password, waNumber, city, 
      storeName, storeEmoji, storeType, 
      plan = 'free'
    } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    
    if (!name || !email || !password || !storeName) {
      return res.status(400).json({ error: 'Name, email, password and store name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const isFirstUser = (await User.countDocuments()) === 0;
    const role = isFirstUser ? 'admin' : 'seller';
    const finalPlan = isFirstUser ? 'business' : plan;
    
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const userId = uuidv4();
    const user = await User.create({ 
      id: userId,
      name, 
      email, 
      password: hashedPassword, 
      waNumber, 
      city, 
      role, 
      plan: finalPlan 
    });
    
    const slug = storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const storeId = uuidv4();
    const store = await Store.create({ 
      id: storeId,
      ownerId: userId,
      name: storeName, 
      emoji: storeEmoji || '🛍️', 
      slug, 
      type: storeType || 'ecommerce', 
      waNumber, 
      status: 'live'
    });
    
    await Settings.create({ 
      id: uuidv4(),
      storeId: storeId, 
      storeName, 
      storeEmoji: storeEmoji || '🛍️', 
      city, 
      waNumber 
    });
    
    const token = signToken(user.id);
    
    // ✅ SET HTTP-ONLY COOKIE - NOT returned in JSON
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    // ✅ Return user data, NOT the token
    res.status(201).json({ 
      success: true, 
      user: user.toSafeJSON(), 
      store 
    });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
    
    if (user.status !== 'active') 
      return res.status(401).json({ error: 'Account suspended' });
    
    const token = signToken(user.id);
    
    // ✅ SET HTTP-ONLY COOKIE
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    
    // ✅ Return user data only, NO token
    res.json({ success: true, user: user.toSafeJSON() });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});





// POST /api/auth/logout
router.post('/logout', (req, res) => {
  // ✅ Clear the cookie
  res.clearCookie('token');
  res.json({ success: true });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link was sent' });

    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.SENDINBLUE_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_FROM_NAME || 'StoreLink',
          email: process.env.EMAIL_FROM_ADDRESS || 'noreply@storelink.ng',
        },
        to: [{ email: user.email, name: user.name || 'Seller' }],
        subject: 'Reset your StoreLink password',
        htmlContent: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9f9">
            <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
              <div style="font-size:22px;font-weight:800;color:#00e27a;margin-bottom:4px">StoreLink</div>
              <p style="font-size:14px;color:#111827">Hi ${user.name || 'there'},</p>
              <p style="font-size:14px;color:#374151;line-height:1.6">Click below to reset your password. Link expires in <strong>1 hour</strong>.</p>
              <a href="${resetLink}" style="display:inline-block;background:#00e27a;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px">Reset Password</a>
              <p style="font-size:12px;color:#9ca3af">If you didn't request this, ignore this email.</p>
            </div>
          </div>`,
      }),
    });

    if (!brevoRes.ok) {
      console.error('[forgot-password] Brevo error:', await brevoRes.text());
      return res.status(502).json({ error: 'Failed to send email — try again shortly' });
    }

    res.json({ success: true, message: 'If that email exists, a reset link was sent' });
  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});




// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ id: decoded.id });
    if (!user) return res.status(404).json({ error: 'Invalid token' });
    
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    res.json({ success: true });
  } catch (err) { 
    res.status(400).json({ error: 'Invalid or expired token' }); 
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  const user = await User.findOne({ id: req.user.id }).select('-password');
  res.json(user);
});


// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findOne({ id: decoded.id, status: 'active' });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const newToken = signToken(user.id);
    res.cookie('token', newToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user: user.toSafeJSON() });
  } catch (err) {
    res.clearCookie('token');
    res.status(401).json({ error: 'Token expired — please log in again' });
  }
});


module.exports = router;