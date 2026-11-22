require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const FoodItemListing = require('./models/FoodItemListing');

// Full API payloads (same shape as POST /api/foods) for 10 listings around
// Kecamatan Lowokwaru, Kota Malang. Edit the JSON file to change the data.
const demoListings = require('../dummy/food-listings.json');

function shiftDate(value, offsetMs) {
  if (!value) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Date(date.getTime() + offsetMs);
}

// Demo data should look current whenever it is seeded. Every date is moved by
// one offset so the newest listing becomes "now" and the gaps between
// created_at, expiry_timestamp and verified_at are preserved. Without this the
// hard-coded dates go stale and every listing is already expired.
function withFreshDates(listing, offsetMs) {
  return {
    ...listing,
    created_at: shiftDate(listing.created_at, offsetMs),
    food_details: {
      ...listing.food_details,
      expiry_timestamp: shiftDate(listing.food_details.expiry_timestamp, offsetMs),
    },
    verification_details: {
      ...listing.verification_details,
      verified_at: shiftDate(listing.verification_details?.verified_at, offsetMs),
    },
  };
}

async function seed() {
  await connectDB();

  // Wait for the unique food_id index before inserting.
  await FoodItemListing.init();

  const newestCreatedAt = Math.max(
    ...demoListings.map((listing) => new Date(listing.created_at).getTime())
  );
  const offsetMs = Date.now() - newestCreatedAt;
  const listings = demoListings.map((listing) => withFreshDates(listing, offsetMs));

  let created = 0;
  let updated = 0;

  for (const listing of listings) {
    const existing = await FoodItemListing.findOne({ food_id: listing.food_id });

    if (existing) {
      // Same food_id: refresh the document instead of duplicating it.
      existing.set(listing);
      await existing.save();
      updated += 1;
      console.log(`updated: ${listing.food_id} - ${listing.food_details.title}`);
    } else {
      await FoodItemListing.create(listing);
      created += 1;
      console.log(`created: ${listing.food_id} - ${listing.food_details.title}`);
    }
  }

  console.log(
    `\nSeeded ${listings.length} food listings (${created} created, ${updated} updated).`
  );
  console.log(
    `Dates shifted by ${Math.round(offsetMs / 3600000)}h so the newest listing is now.`
  );

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Food seeding failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
