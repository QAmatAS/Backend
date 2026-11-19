require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const User = require('./models/User');

// Gives every user created before the user_id field existed a stable id, and
// fills in the defaults that Mongoose only applies at document level (which
// never reaches the stored document of an older record).
//
// Safe to re-run: documents that already look right are skipped.
async function migrate() {
  await connectDB();

  // Read through the raw driver so Mongoose's in-memory defaults cannot hide a
  // field that is actually missing from the database.
  const users = await User.collection.find({}).toArray();
  let updated = 0;

  for (const user of users) {
    const patch = {};

    if (!user.user_id) patch.user_id = User.generateUserId();
    if (!user.role) patch.role = 'contributor';
    if (!user.personal_info) patch.personal_info = { display_name: user.name || '' };
    if (!user.stats) {
      patch.stats = { total_shared_submitted: 0, total_shared_approved: 0, rating: 0 };
    }

    if (Object.keys(patch).length === 0) continue;

    await User.collection.updateOne({ _id: user._id }, { $set: patch });
    updated += 1;

    console.log(
      `updated ${user.email}${patch.user_id ? ` -> ${patch.user_id}` : ''}`
    );
  }

  // Build the new indexes now that no document is missing user_id.
  await User.syncIndexes();

  console.log(`\nBackfilled ${updated} of ${users.length} user(s). Indexes synced.`);
  await mongoose.disconnect();
}

migrate().catch(async (err) => {
  console.error('User migration failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
