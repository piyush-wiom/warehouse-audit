const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const https = require('https');
const prisma = require('../lib/prisma');

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function slackApiCall(method, body, useForm = false) {
  return new Promise((resolve, reject) => {
    let payload, contentType;
    if (useForm) {
      // Form-encoded (required for users.lookupByEmail)
      payload = Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      contentType = 'application/x-www-form-urlencoded';
    } else {
      payload = JSON.stringify(body);
      contentType = 'application/json';
    }
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendOtp(email, otp) {
  // Priority 1: Slack DM by email
  if (process.env.SLACK_BOT_TOKEN) {
    try {
      const lookup = await slackApiCall('users.lookupByEmail', { email }, true);
      if (lookup.ok) {
        const slackUserId = lookup.user.id;
        // Open DM channel
        const dm = await slackApiCall('conversations.open', { users: slackUserId });
        if (dm.ok) {
          await slackApiCall('chat.postMessage', {
            channel: dm.channel.id,
            text: `🔐 *Warehouse Audit Login OTP*\n\nYour OTP is: *${otp}*\n\nValid for 5 minutes. Do not share this with anyone.`,
          });
          console.log(`[OTP] Sent via Slack DM to ${email}`);
          return;
        }
      }
      console.warn(`[OTP] Slack lookup failed for ${email}:`, lookup.error, '— falling back to console');
    } catch (err) {
      console.warn('[OTP] Slack error:', err.message, '— falling back to console');
    }
  }

  // Fallback — print to console (dev / no Slack configured)
  console.log(`\n[OTP] Email: ${email} | OTP: ${otp}\n`);
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(404).json({ error: 'No active account found for this email' });
    }

    // Invalidate old OTPs
    await prisma.otpToken.updateMany({
      where: { email, used: false },
      data: { used: true },
    });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpToken.create({ data: { email, otp, expiresAt } });
    await sendOtp(email, otp);

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const record = await prisma.otpToken.findFirst({
      where: { email, otp, used: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) return res.status(400).json({ error: 'Invalid OTP' });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: 'OTP expired' });

    // Check attempt limit — max 3 failed not tracked here but OTP invalidated on success
    await prisma.otpToken.update({ where: { id: record.id }, data: { used: true } });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return res.status(403).json({ error: 'Account inactive' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/logout  (stateless — client discards token)
router.post('/logout', (req, res) => res.json({ message: 'Logged out' }));

module.exports = router;
