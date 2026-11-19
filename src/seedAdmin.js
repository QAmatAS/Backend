require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const User = require('./models/User');

// Promotes a single account so the in-app admin mode can approve listings.
// Safe to re-run; change the target with ADMIN_EMAIL in .env.
const targetEmail = String(process.env.ADMIN_EMAIL || 'alice@example.com')
  .trim()
  .toLowerCase();

async function promote() {
  await connectDB();

  const user = await User.findOne({ email: targetEmail });

  if (!user) {
    console.error(
      `No user with email ${targetEmail}. Run "npm run seed" first, or set ADMIN_EMAIL.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
  }

  console.log(`${user.email} is an admin (user_id: ${user.user_id}).`);
  await mongoose.disconnect();
}

promote().catch(async (err) => {
  console.error('Admin seeding failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
