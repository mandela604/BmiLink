const express = require('express');
const router = express.Router();

const authRoutes      = require('./authRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const adminRoutes     = require('./adminRoutes');
const storeRoutes     = require('./storeRoutes');
// Auth routes

// Raw body needed for webhook signature verification
router.post('/webhook/payment', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const crypto = require('crypto');
    const User = require('../models/User');

    // Paystack signature verification
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString());

if (event.event === 'charge.success') {
  const { metadata } = event.data;
  const ref     = event.data.reference;
  const userId  = metadata?.userId;
  const newPlan = metadata?.plan;

  if (!userId || !newPlan) {
    console.warn('[Webhook] Missing metadata on charge.success ref:', ref);
    return res.sendStatus(200);
  }

 if (!['pro', 'business'].includes(newPlan)) {
    console.warn('[Webhook] Invalid plan value in metadata:', newPlan);
    return res.sendStatus(200);
  }

  const already = await User.findOne({ id: userId, lastPaystackRef: ref });
  if (already) return res.sendStatus(200);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await User.findOneAndUpdate(
    { id: userId },
    { plan: newPlan, planExpiresAt: expiresAt, pendingPlan: null, lastPaystackRef: ref }
  );
}

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});



// Public stats
router.get('/public/stats', async (req, res) => {
  try {
    const User = require('../models/User');
    const totalUsers = await User.countDocuments({ status: 'active' });
    res.json({ totalUsers });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// All dashboard routes mounted at /dashboard
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);
router.use('/stores', storeRoutes);

module.exports = router;