const mongoose = require('mongoose');

// Local MongoDB by default. Override with MONGODB_URI in .env for Atlas or another host.
const DEFAULT_URI = 'mongodb://localhost:27017/backend';

async function connectDB(uri = process.env.MONGODB_URI || DEFAULT_URI) {
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  console.log(
    `MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`
  );

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
