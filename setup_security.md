# Security Hardening Guide

## Overview

Production security configuration for Thermio including rate limiting, security headers, CORS, firewall rules, and best practices.

---

## Step 1: Rate Limiting

### Install express-rate-limit

```bash
cd /var/www/thermio_production
npm install express-rate-limit
```

### Configure Rate Limiters

Add to `app.js` (before routes):

```javascript
const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Strict limiter for authentication
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true
});

// Password reset limiter
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password changes per hour
  message: 'Too many password reset attempts, please try again later.'
});

// Apply to routes
app.use('/api/', apiLimiter);
app.use('/login', authLimiter);
app.use('/w/:slug/login', authLimiter);
app.post('/change-password', passwordResetLimiter);
```

---

## Step 2: Security Headers (Helmet.js)

### Install Helmet

```bash
npm install helmet
```

### Configure Helmet

Add to `app.js` (early in middleware stack):

```javascript
const helmet = require('helmet');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    xssFilter: true,
    hidePoweredBy: true
  })
);
```

---

## Step 3: CORS Configuration

### Install CORS

```bash
npm install cors
```

### Configure CORS

Add to `app.js`:

```javascript
const cors = require('cors');

const corsOptions = {
  origin: process.env.BASE_URL || 'https://yourdomain.com',
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

---

## Step 4: Firewall Rules (UFW)

### Basic Firewall Setup

```bash
# Reset firewall (if needed)
sudo ufw --force reset

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (IMPORTANT - don't lock yourself out!)
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status verbose
```

### Expected Output

```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

### Block Common Attack Ports

```bash
# Block common malicious ports
sudo ufw deny 23/tcp   # Telnet
sudo ufw deny 135/tcp  # Windows RPC
sudo ufw deny 139/tcp  # NetBIOS
sudo ufw deny 445/tcp  # SMB
```

---

## Step 5: SSL/TLS Configuration

### Let's Encrypt (Recommended)

**Already configured in nginx** - see nginx setup guide

### Force HTTPS Redirect

**In nginx config** (`/etc/nginx/sites-available/thermio`):

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Test SSL Configuration

Visit: https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com

**Target:** A+ rating

---

## Step 6: Input Validation & Sanitization

### Install validator

```bash
npm install validator
```

### Example Usage

```javascript
const validator = require('validator');

app.post('/w/:slug/login', (req, res) => {
  const { username, password } = req.body;

  // Sanitize inputs
  const cleanUsername = validator.trim(username);
  const cleanPassword = validator.trim(password);

  // Validate
  if (!validator.isLength(cleanUsername, { min: 1, max: 50 })) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  // Continue with authentication
});
```

### Prevent SQL Injection

**Use parameterized queries** (already implemented in PostgreSQL migration):

```javascript
// ✅ SAFE - Parameterized
await pool.query('SELECT * FROM users WHERE username = $1', [username]);

// ❌ DANGEROUS - String concatenation
await pool.query(`SELECT * FROM users WHERE username = '${username}'`);
```

---

## Step 7: Session Security

### Secure Cookie Configuration

**Already implemented in app.js:**

```javascript
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,        // Prevents XSS access to cookies
      secure: true,          // HTTPS only
      sameSite: 'strict',    // CSRF protection
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
  })
);
```

### Regenerate Session on Login

```javascript
// In login routes
app.post('/w/:slug/login', (req, res) => {
  // Authenticate user...

  // Regenerate session ID
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Login failed');

    req.session.user = user;
    req.session.createdAt = new Date().toISOString();
    res.redirect('/app');
  });
});
```

---

## Step 8: CSRF Protection

### CSRF Token Validation

**Already implemented** - using `csurf` middleware:

```javascript
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: false });

app.use(csrfProtection);

// In forms:
<input type="hidden" name="_csrf" value="<%= csrfToken %>">
```

### Verify CSRF on State-Changing Requests

All POST/PUT/DELETE routes should include CSRF validation.

---

## Step 9: File Upload Security

### Configure Multer Safely

```javascript
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow images
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});
```

### Prevent Path Traversal

```javascript
// Sanitize filenames
const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
};
```

---

## Step 10: Logging & Monitoring

### Install Winston Logger

```bash
npm install winston
```

### Configure Logging

Create `utils/logger.js`:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

### Log Security Events

```javascript
const logger = require('./utils/logger');

// Failed login attempt
logger.warn('Failed login attempt', {
  username,
  ip: req.ip,
  timestamp: new Date()
});

// Successful login
logger.info('User logged in', {
  userId: user.id,
  ip: req.ip
});

// Password change
logger.info('Password changed', {
  userId: user.id,
  ip: req.ip
});
```

---

## Step 11: Environment Variables Protection

### Secure .env File

```bash
# Set proper permissions
chmod 600 /var/www/thermio_production/.env

# Verify
ls -la /var/www/thermio_production/.env
# Should show: -rw------- (owner read/write only)
```

### Never Commit Secrets

**Add to .gitignore:**

```
.env
.env.local
.env.production
*.log
node_modules/
```

---

## Step 12: Database Security

### PostgreSQL Security

**Create read-only user for analytics:**

```sql
CREATE USER thermio_readonly WITH PASSWORD 'readonly-password';
GRANT CONNECT ON DATABASE thermio_db TO thermio_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO thermio_readonly;
```

**Restrict connections:**

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf

# Only allow localhost
host    thermio_db    thermio_user    127.0.0.1/32    md5
```

**Restart PostgreSQL:**

```bash
sudo systemctl restart postgresql
```

---

## Step 13: Backup Security

### Encrypt Backups

```bash
# Backup with encryption
pg_dump thermio_db | gpg --encrypt --recipient your-email@example.com > backup.sql.gpg

# Decrypt
gpg --decrypt backup.sql.gpg > backup.sql
```

### Secure Backup Storage

```bash
# Create backup directory
sudo mkdir -p /backups/thermio
sudo chown root:root /backups/thermio
sudo chmod 700 /backups/thermio
```

---

## Step 14: Fail2Ban (Brute Force Protection)

### Install Fail2Ban

```bash
sudo apt install fail2ban
```

### Configure Fail2Ban for nginx

Create `/etc/fail2ban/jail.local`:

```ini
[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600

[nginx-noscript]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 6
bantime = 3600
```

### Start Fail2Ban

```bash
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

# Check status
sudo fail2ban-client status
```

---

## Security Checklist

### Pre-Production

- ✅ Rate limiting configured
- ✅ Helmet.js security headers enabled
- ✅ CORS properly configured
- ✅ Firewall (UFW) enabled with minimal open ports
- ✅ SSL/TLS certificate installed (A+ rating)
- ✅ Session cookies secure (httpOnly, secure, sameSite)
- ✅ CSRF protection enabled
- ✅ File upload validation
- ✅ Input sanitization
- ✅ SQL injection prevention (parameterized queries)
- ✅ .env file permissions (600)
- ✅ Logging configured
- ✅ Database user permissions restricted
- ✅ Backup encryption
- ✅ Fail2Ban configured

### Post-Production

- ✅ Monitor logs daily
- ✅ Review failed login attempts
- ✅ Check SSL expiration (auto-renew with certbot)
- ✅ Update dependencies monthly (`npm audit`)
- ✅ Review firewall rules
- ✅ Test backups quarterly
- ✅ Security scan (SSLLabs, Observatory)

---

## Monitoring & Alerts

### Monitor Failed Logins

```bash
# Check logs
grep "Failed login" /var/www/thermio_production/logs/combined.log

# Count failed attempts
grep "Failed login" logs/combined.log | wc -l
```

### Monitor Rate Limit Hits

```bash
grep "Too many requests" logs/combined.log
```

### Setup Email Alerts

**Install postfix:**

```bash
sudo apt install postfix mailutils
```

**Create alert script** (`/usr/local/bin/security-check.sh`):

```bash
#!/bin/bash
FAILED=$(grep "Failed login" /var/www/thermio_production/logs/combined.log | tail -20)
if [ ! -z "$FAILED" ]; then
  echo "$FAILED" | mail -s "Thermio: Failed Login Attempts" admin@yourdomain.com
fi
```

**Schedule with cron:**

```bash
crontab -e

# Daily security check at 9 AM
0 9 * * * /usr/local/bin/security-check.sh
```

---

## Security Testing

### Test Rate Limiting

```bash
# Rapid requests
for i in {1..10}; do curl https://yourdomain.com/login; done
# Should get rate limited
```

### Test CSRF Protection

```bash
# POST without CSRF token
curl -X POST https://yourdomain.com/w/test/login \
  -d "username=test&password=test"
# Should return 403 Forbidden
```

### Test SSL

```bash
# Check SSL certificate
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

---

## Common Security Vulnerabilities - Prevention

### XSS (Cross-Site Scripting)

**Prevent:**
- ✅ Helmet.js XSS filter enabled
- ✅ EJS auto-escapes output (`<%= %>`)
- ✅ Never use `<%- %>` for user input

### SQL Injection

**Prevent:**
- ✅ Use parameterized queries (`$1, $2`)
- ✅ Never concatenate user input into queries

### CSRF (Cross-Site Request Forgery)

**Prevent:**
- ✅ csurf middleware enabled
- ✅ CSRF tokens in all forms
- ✅ SameSite cookies

### Session Hijacking

**Prevent:**
- ✅ httpOnly cookies
- ✅ Secure cookies (HTTPS only)
- ✅ Session regeneration on login
- ✅ Session invalidation on password change

---

## Emergency Response

### Compromised Server

1. **Isolate server** - block incoming traffic
2. **Review logs** - identify attack vector
3. **Change all passwords** - database, SSH, admin accounts
4. **Restore from backup** - if data compromised
5. **Update all dependencies** - `npm audit fix`
6. **Scan for malware** - `sudo apt install clamav && clamscan -r /var/www`

### Data Breach

1. **Identify scope** - which data was accessed
2. **Notify users** - if personal data compromised
3. **Reset passwords** - force all users to change passwords
4. **Review access logs** - find unauthorized access
5. **Patch vulnerability** - fix security hole
6. **Document incident** - for compliance/audit

---

## Compliance & Best Practices

### GDPR Compliance

- ✅ User consent tracking (implemented)
- ✅ Data export capability (add if needed)
- ✅ Right to deletion (add if needed)
- ✅ Encrypted data at rest
- ✅ Secure data in transit (HTTPS)

### Password Best Practices

- ✅ Minimum 8 characters
- ✅ Require uppercase, number, special character
- ✅ Password history (last 3)
- ✅ Bcrypt with cost factor 14
- ✅ No password hints
- ✅ Rate limiting on login

---

## Resources

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Mozilla Observatory: https://observatory.mozilla.org/
- SSL Labs Test: https://www.ssllabs.com/ssltest/
- Security Headers: https://securityheaders.com/

---

## Next Steps

✅ Security hardened → Production ready! 🎉
