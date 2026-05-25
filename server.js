// server.js
require('dotenv').config();
const express      = require('express');
const mongoose     = require('mongoose');
const cors         = require('cors');
const path         = require('path');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const compression  = require('compression');

const app = express();

app.set('trust proxy', 1);


app.get('/debug-host', (req, res) => {
  res.json({
    hostname: req.hostname,
    originalUrl: req.originalUrl,
    subdomains: req.subdomains,
    fullUrl: req.protocol + '://' + req.get('host')
  });
});
// ─── CORS ────────────────────────────────────────────────────────────────────
// Support multiple allowed origins (dev + prod) via comma-separated env var
// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
origin(origin, cb) {
  if (!origin) return cb(null, true);
  const allowed = allowedOrigins.some(o => {
    if (o === origin) return true;
    if (o.startsWith('https://*.')) {
      const base = o.replace('https://*.', '');
      return origin.endsWith('.' + base) || origin === 'https://' + base;
    }
    return false;
  });
  if (allowed) return cb(null, true);
  cb(new Error(`CORS: origin ${origin} not allowed`));
},
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── BODY / COOKIES ──────────────────────────────────────────────────────────
// Keep JSON limit tight; multipart (images) is handled by multer in routes
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook/payment') return next();
  express.json({ limit: '50kb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook/payment') return next();
  express.urlencoded({ extended: true, limit: '50kb' })(req, res, next);
});
app.use(cookieParser());

// ─── COMPRESSION ─────────────────────────────────────────────────────────────
app.use(compression());

// ─── HELMET  — custom CSP so Cloudinary images & Google Fonts work ────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc: [
                    "'self'", "'unsafe-inline'",
                    'https://connect.facebook.net',
                    'https://analytics.tiktok.com',
                    'https://www.googletagmanager.com',
                    'https://www.google-analytics.com',
                          ],
         scriptSrcAttr: ["'unsafe-inline'"],                
        styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:      ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://*.cloudinary.com'],
        connectSrc: [
                "'self'",
                'http://localhost:5000',
                 'https://bmilink-1.onrender.com',
                  'https://bmilink.com',               
                'https://www.bmilink.com',
                'https://www.facebook.com',
                'https://analytics.tiktok.com',
                'https://www.google-analytics.com',
                'https://www.googletagmanager.com',
                          ],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    // Let the catch-all serve HTML without breaking navigation
    crossOriginEmbedderPolicy: false,
  })
);

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
// Strict limiter for auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      20,               // 20 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many attempts — please try again in 15 minutes' },
});


app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max:      5,
  message:  { error: 'Too many password reset requests — please try again in 1 hour' },
}));

// General API limiter — generous enough for a dashboard that fires many parallel requests
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      600,              // ~40 req/min average, plenty for dashboard
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please slow down' },
  // Skip Cloudflare/proxy health checks
  skip: (req) => req.path === '/health',
});
app.use('/api/', apiLimiter);


app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin  = req.headers.origin;
  const referer = req.headers.referer;
  const source  = origin || (referer ? new URL(referer).origin : null);
  if (!source) return next();

  const baseDomain = process.env.BASE_DOMAIN || 'bmilink.com';
  const isAllowed = allowedOrigins.includes(source) || 
                    source.endsWith('.' + baseDomain);
  
  if (isAllowed) return next();
  return res.status(403).json({ error: 'CSRF check failed: origin not allowed' });
});



// Public tracking endpoint gets its own strict limiter to prevent abuse
const trackLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 min
  max:      30,          // 30 track events per minute per IP
  message:  { error: 'Tracking rate limit exceeded' },
});
app.use('/api/dashboard/track/', trackLimiter);

// ─── STATIC FILES ────────────────────────────────────────────────────────────
// ─── STATIC FILES (move this BEFORE the SPA fallback) ───
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  index: false, // Don't automatically serve index.html
}));

// ─── API ROUTES ───
app.use('/api', require('./routes'));

// ─── HEALTH CHECK ───
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', uptime: process.uptime() });
});

// ─── SPECIFIC HTML FILES FIRST ───
app.get('/seller-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'seller-dashboard.html'));
});

app.get('/auth-user.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth-user.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ====================== SUBDOMAIN HANDLING ======================
//
// ====================== SUBDOMAIN HANDLING ======================
app.use((req, res, next) => {
  const hostname = req.hostname.toLowerCase();
  const baseDomain = process.env.BASE_DOMAIN || 'bmilink.com';

  if (req.path.startsWith('/api') || req.path.includes('.')) {
    return next();
  }

  if (hostname.endsWith(`.${baseDomain}`)) {
    const slug = hostname.replace(`.${baseDomain}`, '');  // Better than split('.')[0]

    if (slug && slug.length > 2 && !['www', 'bmilink', 'admin'].includes(slug)) {
      console.log(`[Subdomain] Serving store for: ${slug}`);
      return res.sendFile(path.join(__dirname, 'public', 'store.html'));
    }
  }

  next();
});


// ─── SPA FALLBACK - ONLY for non-file routes ───
app.get('*', (req, res) => {
  // Only send index.html for routes that don't match a real file
  if (req.path.includes('.')) {
    return res.status(404).send('File not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ─── DATABASE ────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('FATAL: MONGODB_URI not set');
  process.exit(1);
}

let mongoRetries = 0;
const MAX_RETRIES = 5;

function connectMongo() {
  mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS:          45000,
    })
    .then(() => {
      console.log('[DB] MongoDB connected');
      mongoRetries = 0;
    })
    .catch(err => {
      mongoRetries += 1;
      const delay = Math.min(1000 * 2 ** mongoRetries, 30000); // exponential back-off, cap 30s
      console.error(`[DB] Connection failed (attempt ${mongoRetries}/${MAX_RETRIES}): ${err.message}`);
      if (mongoRetries >= MAX_RETRIES) {
        console.error('[DB] Max retries reached — exiting');
        process.exit(1);
      }
      console.log(`[DB] Retrying in ${delay / 1000}s…`);
      setTimeout(connectMongo, delay);
    });
}

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] Disconnected — reconnecting…');
  connectMongo();
});

connectMongo();



// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // CORS errors come through here
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 5000;
const server = app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received — shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  });
});




module.exports = app; 