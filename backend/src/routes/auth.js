const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const prisma = require('../lib/prisma');

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email, otp) {
  if (process.env.SENDGRID_API_KEY) {
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@warehouse-audit.com',
      to: email,
      subject: 'Your Warehouse Audit OTP',
      text: `Your OTP is: ${otp}\n\nValid for 5 minutes.`,
      html: `<h2>Warehouse Audit Login</h2><p>Your OTP is: <strong style="font-size:24px">${otp}</strong></p><p>Valid for 5 minutes.</p>`,
    });
  } else if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Your Warehouse Audit OTP',
      text: `Your OTP is: ${otp}\n\nValid for 5 minutes.`,
    });
  } else {
    // Dev fallback — print to console
    console.log(`\n[OTP] Email: ${email} | OTP: ${otp}\n`);
  }
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
    await sendOtpEmail(email, otp);

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
