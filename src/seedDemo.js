require('dotenv').config();

const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const FoodItemListing = require('./models/FoodItemListing');
const User = require('./models/User');

// Short-lived listings for the live demo. Each one is approved, available and
// expires a few minutes after the script runs, so the countdown timer, the
// "expired" state and the archive can all be shown in one sitting. Run it right
// before the demo and again whenever the three listings have run out.
//
// Owners are the Maya and Budi accounts from `npm run seed`.
const MINUTE = 60 * 1000;

const DEMO_LISTINGS = [
  {
    food_id: 'food_live01',
    contributor_id: 'usr_9842a7f1',
    minutes: 2,
    title: 'Nasi Kotak Ayam Geprek (demo 2 menit)',
    description: 'Listing demo: kedaluwarsa 2 menit setelah skrip dijalankan.',
    category: 'Makanan Berat',
    dietary_tags: ['Halal'],
    quantity_portions: 4,
    location_name: 'Kantin Pusat Universitas Brawijaya',
    address_text: 'Jl. Veteran, Lowokwaru, Malang',
    latitude: -7.9526,
    longitude: 112.6144,
    pickup_notes: 'Datang ke kantin lantai 1.',
  },
  {
    food_id: 'food_live02',
    contributor_id: 'usr_3c1d9e2b',
    minutes: 3,
    title: 'Roti Tawar & Pastry (demo 3 menit)',
    description: 'Listing demo: kedaluwarsa 3 menit setelah skrip dijalankan.',
    category: 'Roti & Kue',
    dietary_tags: ['Halal', 'Vegetarian'],
    quantity_portions: 6,
    location_name: 'Toko Roti Dinoyo',
    address_text: 'Jl. MT. Haryono, Lowokwaru, Malang',
    latitude: -7.9407,
    longitude: 112.6062,
    pickup_notes: 'Tanya kasir, bilang ingin mengambil sisa roti.',
  },
  {
    food_id: 'food_live03',
    contributor_id: 'usr_9842a7f1',
    minutes: 5,
    title: 'Sayur Sop & Tempe Goreng (demo 5 menit)',
    description: 'Listing demo: kedaluwarsa 5 menit setelah skrip dijalankan.',
    category: 'Makanan Berat',
    dietary_tags: ['Halal', 'Vegetarian'],
    quantity_portions: 3,
    location_name: 'Warung Bu Sari',
    address_text: 'Jl. Sumbersari, Lowokwaru, Malang',
    latitude: -7.9452,
    longitude: 112.6186,
    pickup_notes: 'Ambil di meja depan warung.',
  },
];

/**
 * Turns the compact definitions above into full documents (same shape as the
 * stored listings). Dates are relative to `now`: created and approved right now,
 * expiring `minutes` later.
 */
function buildDemoListings(now = new Date()) {
  return DEMO_LISTINGS.map((def) => ({
    food_id: def.food_id,
    contributor_id: def.contributor_id,
    created_at: now,
    updated_at: now,

    verification_status: 'approved',
    verification_details: {
      verified_by_admin_id: 'demo_seed',
      verified_at: now,
      rejection_reason: null,
    },

    food_details: {
      title: def.title,
      description: def.description,
      category: def.category,
      dietary_tags: def.dietary_tags,
      quantity_portions: def.quantity_portions,
      quantity_unit: 'porsi',
      expiry_timestamp: new Date(now.getTime() + def.minutes * MINUTE),
      photo_urls: [],
    },

    location: {
      location_name: def.location_name,
      address_text: def.address_text,
      coordinates: { latitude: def.latitude, longitude: def.longitude },
      pickup_notes: def.pickup_notes,
      external_map_url: `https://maps.google.com/?q=${def.latitude},${def.longitude}`,
    },

    status: 'available',
  }));
}

function clock(date) {
  return date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });
}

async function seedDemo() {
  await connectDB();

  // Wait for the unique food_id index before inserting.
  await FoodItemListing.init();

  const ownerIds = [...new Set(DEMO_LISTINGS.map((def) => def.contributor_id))];
  const owners = await User.find({ user_id: { $in: ownerIds } }).select('user_id');
  const missing = ownerIds.filter((id) => !owners.some((owner) => owner.user_id === id));

  if (missing.length > 0) {
    console.warn(
      `WARNING: no account for ${missing.join(', ')}. Run "npm run seed" first, ` +
        'otherwise the detail screen has no contact number to show.'
    );
  }

  const now = new Date();
  const listings = buildDemoListings(now);

  for (const listing of listings) {
    // A previous run may already have been archived once it expired. Remove that
    // copy (and any renamed "food_live01~<id>" leftovers) so the demo id is free.
    await FoodItemListing.Expired.deleteMany({
      food_id: new RegExp(`^${listing.food_id}(~.*)?$`),
    });

    const existing = await FoodItemListing.findOne({ food_id: listing.food_id });

    if (existing) {
      // Same food_id: refresh it instead of duplicating it.
      existing.set(listing);
      await existing.save();
    } else {
      await FoodItemListing.create(listing);
    }

    const expiry = listing.food_details.expiry_timestamp;
    const minutes = Math.round((expiry.getTime() - now.getTime()) / MINUTE);
    console.log(
      `${listing.food_id}: expires ${clock(expiry)} WIB (in ${minutes} min) - ${listing.food_details.title}`
    );
  }

  console.log(`\nSeeded ${listings.length} demo listings at ${clock(now)} WIB.`);

  await mongoose.disconnect();
}

module.exports = { DEMO_LISTINGS, buildDemoListings };

if (require.main === module) {
  seedDemo().catch(async (err) => {
    console.error('Demo seeding failed:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  });
}
