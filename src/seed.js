require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const User = require('./models/User');

// Demo accounts, created once and never overwritten on later runs.
const demoUsers = [
  { name: 'Alice', email: 'alice@example.com', password: 'password123' },
  { name: 'Bob', email: 'bob@example.com', password: 'password123' },
];

async function seed() {
  await connectDB();

  // Wait for the unique email index before upserting.
  await User.init();

  for (const demo of demoUsers) {
    const result = await User.updateOne(
      { email: demo.email },
      {
        $setOnInsert: {
          name: demo.name,
          email: demo.email,
          passwordHash: bcrypt.hashSync(demo.password, 10),
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
