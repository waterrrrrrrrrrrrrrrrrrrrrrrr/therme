# Thermio Production Setup Guide

## Overview

This guide walks you through setting up Thermio for production deployment. Complete these steps **in order** after setting up nginx.

---

## Prerequisites

- ✅ Ubuntu Server 20.04+ or similar Linux distribution
- ✅ Node.js 16+ installed
- ✅ nginx configured and running
- ✅ Domain name pointed to your server
- ✅ SSL certificate (Let's Encrypt recommended)

---

## Setup Order

### 1. **Basic Application Setup**

```bash
# Clone/upload the application
cd /var/www
# Extract thermio_production folder here

# Install dependencies
cd /var/www/thermio_production
npm install --production

# Set file permissions
chown -R www-data:www-data /var/www/thermio_production
chmod -R 755 /var/www/thermio_production
```

### 2. **Environment Configuration**

```bash
# Copy example env file
cp .env.example .env

# Edit environment variables
nano .env
```

**Critical variables to set:**
```
NODE_ENV=production
PORT=3000
BASE_URL=https://yourdomain.com
SESSION_SECRET=your-strong-random-secret-here-minimum-32-chars
CSRF_SECRET=another-strong-random-secret-minimum-32-chars
```

Generate secrets:
```bash
# Generate session secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate CSRF secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. **Email Setup** ⭐ CRITICAL

See [setup_email.md](./setup_email.md) for detailed email configuration.

**Quick summary:**
- Configure SMTP settings in `.env`
- Test email sending
- Verify invite emails work

---

## 4. **PostgreSQL Migration** ⭐ RECOMMENDED

See [setup_postgres.md](./setup_postgres.md) for migrating from JSON to PostgreSQL.

**Why migrate:**
- Better performance
- Data integrity
- Concurrent access
- Backup/restore capabilities

---

## 5. **Session Store** ⭐ RECOMMENDED

See [setup_sessions.md](./setup_sessions.md) for Redis/database session storage.

**Why upgrade:**
- Multi-device session invalidation works reliably
- Sessions persist across app restarts
- Better scalability

---

## 6. **Security Hardening** ⭐ CRITICAL

See [setup_security.md](./setup_security.md) for production security setup.

**Must implement:**
- Rate limiting
- Helmet.js security headers
- CORS configuration
- Firewall rules

---

## 7. **Process Manager (PM2)**

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start application
cd /var/www/thermio_production
pm2 start app.js --name thermio

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command it outputs

# Monitor application
pm2 status
pm2 logs thermio
pm2 monit
```

---

## 8. **Verify Setup**

### Check Application
```bash
# Verify app is running
pm2 status

# Check logs for errors
pm2 logs thermio --lines 50

# Test local connection
curl http://localhost:3000
```

### Check nginx
```bash
# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### Test From Browser
1. Visit `https://yourdomain.com`
2. Create a workspace
3. Login
4. Test password change (should log out all devices)
5. Test email invites
6. Upload workspace branding
7. Test QR scanner on mobile

---

## 9. **Monitoring & Maintenance**

### View Logs
```bash
# Application logs
pm2 logs thermio

# nginx access logs
sudo tail -f /var/log/nginx/access.log

# nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Restart Application
```bash
pm2 restart thermio
```

### Update Application
```bash
# Stop application
pm2 stop thermio

# Pull updates
cd /var/www/thermio_production
git pull  # or upload new files

# Install dependencies
npm install --production

# Restart
pm2 restart thermio
```

---

## 10. **Backup Strategy**

### Data Backup
```bash
# Backup data directory (JSON files)
tar -czf thermio-data-$(date +%Y%m%d).tar.gz /var/www/thermio_production/data/

# Backup uploads
tar -czf thermio-uploads-$(date +%Y%m%d).tar.gz /var/www/thermio_production/uploads/
```

### Database Backup (if using PostgreSQL)
```bash
pg_dump thermio_db > thermio-db-$(date +%Y%m%d).sql
```

### Automated Backup (cron)
```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/backup-script.sh
```

---

## Troubleshooting

### Application won't start
```bash
# Check PM2 logs
pm2 logs thermio --err

# Check port is available
sudo lsof -i :3000

# Verify .env file exists
ls -la /var/www/thermio_production/.env
```

### 502 Bad Gateway
- Check if app is running: `pm2 status`
- Check nginx is proxying to correct port
- Check firewall allows port 3000 locally

### Sessions not persisting
- Verify SESSION_SECRET is set
- Check session store configuration
- See [setup_sessions.md](./setup_sessions.md)

### Emails not sending
- Check SMTP credentials in .env
- Check firewall allows outbound port 587
- See [setup_email.md](./setup_email.md)

---

## Performance Tuning

### Enable gzip (nginx)
Already configured in `nginx/thermio.conf`

### Increase PM2 instances
```bash
# Start in cluster mode (4 instances)
pm2 start app.js -i 4 --name thermio
```

### Database Connection Pooling
See [setup_postgres.md](./setup_postgres.md)

---

## Next Steps

1. ✅ Complete email setup → [setup_email.md](./setup_email.md)
2. ✅ Migrate to PostgreSQL → [setup_postgres.md](./setup_postgres.md)
3. ✅ Setup Redis sessions → [setup_sessions.md](./setup_sessions.md)
4. ✅ Harden security → [setup_security.md](./setup_security.md)

---

## Support

For issues or questions:
- Check logs: `pm2 logs thermio`
- Review nginx logs: `/var/log/nginx/`
- Verify environment variables
- Check file permissions
