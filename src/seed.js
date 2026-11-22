require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const User = require('./models/User');

// Demo accounts, created once and never overwritten on later runs.
const demoUsers = [
  { name: 'Alice', email: 'alice@example.com', password: 'password123' },
  { name: 'Bob', email: 'bob@example.com', password: 'password123' },
  // These two user_ids are the contributor_id values used by
  // dummy/food-listings.json, so the listings must have a real owner for the
  // detail screen's contributor block (and its WhatsApp button) to resolve.
  {
    name: 'Maya Lin',
    email: 'maya@example.com',
    password: 'password123',
    user_id: 'usr_9842a7f1',
    personal_info: {
      display_name: 'Maya Lin',
      bio: 'Gemar berbagi masakan rumah dan hasil kebun sendiri.',
      phone: '+6281234567890',
    },
  },
  {
    name: 'Budi Santoso',
    email: 'budi@example.com',
    password: 'password123',
    user_id: 'usr_3c1d9e2b',
    personal_info: {
      display_name: 'Budi Santoso',
      bio: 'Penjaga warung makan sisa acara, siap berbagi tiap sore.',
      phone: '+6281255500011',
    },
  },
];

async function seed() {
  await connectDB();

  // Wait for the unique email index before upserting.
  await User.init();

  for (const demo of demoUsers) {
    // $setOnInsert keeps re-runs from resetting passwords or profile edits.
    const result = await User.updateOne(
      { email: demo.email },
      {
        $setOnInsert: {
          name: demo.name,
          email: demo.email,
          passwordHash: bcrypt.hashSync(demo.password, 10),
          user_id: demo.user_id || User.generateUserId(),
          role: 'contributor',
          personal_info: { display_name: demo.name, ...(demo.personal_info || {}) },
        },
      },
      { upsert: true }
    );

    console.log(
      `${result.upsertedCount ? 'created' : 'already exists'}: ${demo.email}`
    );
  }

  await mongoose.disconnect();
  console.log('Seeding finished.');
}

seed().catch(async (err) => {
  console.error('Seeding failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
