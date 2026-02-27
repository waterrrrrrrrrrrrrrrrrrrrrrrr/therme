# Step 7 — VPS Hardening

Secure your server before going live. These steps protect against brute-force attacks, unauthorized access, and automatic exploitation.

---

## 1. Fail2Ban — Protect SSH

Fail2Ban monitors log files and automatically bans IPs that show malicious behaviour (repeated failed SSH logins).

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

Create a jail config:

```bash
sudo nano /etc/fail2ban/jail.local
```

Paste:

```ini
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3
```

Restart and verify:

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
```

You should see `Currently banned: 0` (unless someone is already trying).

---

## 2. SSH Key-Only Authentication

> ⚠️ **Set up your SSH key FIRST before disabling password auth.**
> If you lock yourself out, you'll need console access to recover.

### 2a. Add your SSH public key

On your LOCAL machine:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
```

On the VPS, add the key:

```bash
mkdir -p ~/.ssh
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 2b. Test key login BEFORE disabling passwords

Open a NEW terminal and test:

```bash
ssh -i ~/.ssh/id_ed25519 user@yourdomain.com
```

If it works, proceed.

### 2c. Disable password authentication

```bash
sudo nano /etc/ssh/sshd_config
```

Find and set:

```
PasswordAuthentication no
PermitRootLogin no
```

Restart SSH:

```bash
sudo systemctl restart ssh
```

> ⚠️ Keep your current session open until you verify the new session works.

---

## 3. Change Default SSH Port (Optional but Recommended)

Changing the SSH port reduces automated scanning noise.

```bash
sudo nano /etc/ssh/sshd_config
```

Change:

```
Port 2222
```

Update UFW to allow the new port FIRST:

```bash
sudo ufw allow 2222/tcp
sudo ufw delete allow ssh   # Removes default port 22
```

Restart SSH:

```bash
sudo systemctl restart ssh
```

> ⚠️ Open a new connection on port 2222 before closing your current session:
> `ssh -p 2222 user@yourdomain.com`

Update your SSH config on your local machine:

```
# ~/.ssh/config
Host thermio-vps
  HostName yourdomain.com
  Port 2222
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
```

---

## 4. Automatic Security Updates

Automatically install security patches:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades
```

Select **Yes** when prompted.

Verify config:

```bash
cat /etc/apt/apt.conf.d/20auto-upgrades
```

Should contain:

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

To customise what gets updated:

```bash
sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
```

---

## 5. PostgreSQL Hardening

PostgreSQL should only accept local connections unless you specifically need remote access.

### Verify pg_hba.conf

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

Ensure:

```
# TYPE  DATABASE  USER      ADDRESS    METHOD
local   all       all                  peer
host    all       all       127.0.0.1  scram-sha-256
```

No `0.0.0.0/0` or external IP ranges should be present unless needed.

### Restrict listen_addresses

```bash
sudo nano /etc/postgresql/*/main/postgresql.conf
```

Ensure:

```
listen_addresses = 'localhost'
```

Restart:

```bash
sudo systemctl restart postgresql
```

---

## 6. UFW Final Firewall Rules

After configuring your custom SSH port (e.g. 2222):

```bash
sudo ufw status verbose
```

Should show only:

```
22/tcp or 2222/tcp   ALLOW IN  Anywhere
80/tcp               ALLOW IN  Anywhere
443/tcp              ALLOW IN  Anywhere
```

If port 22 is still open after you changed to 2222:

```bash
sudo ufw delete allow 22/tcp
sudo ufw reload
sudo ufw status
```

---

## 7. PM2 Startup on Boot

Ensure the app auto-starts after a server reboot:

```bash
pm2 startup
# Run the command it outputs (starts with: sudo env PATH=...)
pm2 save
```

Test: reboot the server, then verify `pm2 status` shows the app running.

---

## Hardening Checklist

- [ ] Fail2Ban installed and monitoring SSH
- [ ] SSH key authentication working
- [ ] Password authentication disabled
- [ ] Root SSH login disabled
- [ ] Default SSH port changed (optional)
- [ ] UFW only allows SSH port, 80, 443
- [ ] Unattended-upgrades enabled
- [ ] PostgreSQL only listens on localhost
- [ ] PM2 startup configured

---

**Next:** [Step 8 — Common Errors](./8-common-errors.md)
