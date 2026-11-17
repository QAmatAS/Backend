require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const FoodItemListing = require('./models/FoodItemListing');

// Full API payloads (same shape as POST /api/foods) for 10 listings around
// Kecamatan Lowokwaru, Kota Malang. Edit the JSON file to change the data.
const demoListings = require('../dummy/food-listings.json');

async function seed() {
  await connectDB();

  // Wait for the unique food_id index before inserting.
  await FoodItemListing.init();

  let created = 0;
  let updated = 0;

  for (const listing of demoListings) {
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
    `\nSeeded ${demoListings.length} food listings (${created} created, ${updated} updated).`
  );
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Food seeding failed:', err.message);
  await mongoose.disconnect();
  process.exit(1);
});
