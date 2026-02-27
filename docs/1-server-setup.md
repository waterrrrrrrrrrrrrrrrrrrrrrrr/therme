# Step 1 — Server Setup

Fresh Ubuntu 24.04 VPS. Assumes nothing is installed.

---

## 1. Update System

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

---

## 2. Install Node.js via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

nvm install --lts
nvm use --lts
node --version  # should show v22.x or v24.x
npm --version
```

---

## 3. Install PM2

```bash
npm install -g pm2
pm2 --version
```

---

## 4. Clone the Repository

```bash
cd /home/$(whoami)
git clone https://github.com/YOUR_ORG/thermio-tms.git therme
cd therme
npm install
```

---

## 5. Test App on Port 3000

Before configuring Nginx, verify the app can start (you'll need a `.env` first — see Step 4):

```bash
node app.js
# Should print: Thermio listening on port 3000
# Ctrl+C to stop
```

---

## 6. UFW Firewall (Basic)

```bash
sudo apt install -y ufw
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

> Full firewall hardening (including custom SSH port) is in [Step 7 — VPS Hardening](./7-vps-hardening.md).

---

## 7. PM2 Startup

Once everything is working:

```bash
pm2 start app.js --name thermio
pm2 startup
# Copy and run the command it outputs
pm2 save
```

---

## Common Errors

| Error | Fix |
|-------|-----|
| `nvm: command not found` | Run `source ~/.bashrc` and retry |
| `npm ERR! EACCES` | Don't use sudo with npm; use nvm |
| `node: command not found` | Run `nvm use --lts` |
| PM2 won't restart after reboot | Run `pm2 startup` and follow instructions |

---

**Next:** [Step 2 — Database Setup](./2-database.md)
