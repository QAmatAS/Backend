require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const FoodItemListing = require('./models/FoodItemListing');

// Fills in location.geo for listings stored before the field existed. Documents
// without it are invisible to $near / $geoWithin, so this is what makes older
// listings appear in the Explore radius queries.
//
// Safe to re-run: documents that already have a point are skipped.
async function migrate() {
  await connectDB();

  // Raw driver so Mongoose defaults cannot mask a missing stored field.
  const missing = await FoodItemListing.collection
    .find({ 'location.geo': { $exists: false } })
    .toArray();

  let updated = 0;

  for (const doc of missing) {
    const coordinates = doc.location && doc.location.coordinates;

    if (
      !coordinates ||
      typeof coordinates.latitude !== 'number' ||
      typeof coordinates.longitude !== 'number'
    ) {
      console.warn(`skipped ${doc.food_id}: no usable coordinates`);
      continue;
    }

    await FoodItemListing.collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          'location.geo': {
            type: 'Point',
            coordinates: [coordinates.longitude, coordinates.latitude],
          },
        },
      }
    );

    updated += 1;
  }

  // Create the 2dsphere index now that the points exist.
  await FoodItemListing.syncIndexes();

  console.log(`\nBackfilled geo for ${updated} of ${missing.length} listing(s). Indexes synced.`);
  await mongoose.disconnect();
}

migrate().catch(async (err) => {
  console.error('Geo migration failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
