require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const FoodItemListing = require('./models/FoodItemListing');
const User = require('./models/User');

// Demo donations around the Universitas Brawijaya campus (Jl. Veteran, Malang), so the app's
// map opens on realistic, active listings. Every listing is approved and available, and stays
// active for 30+ hours after the script runs (so it still lasts through the demo day). Re-running refreshes the dates (same food_id),
// it never duplicates.
//
//   npm run seed:ub               add / refresh the 12 listings
//   npm run seed:ub -- --clean    also remove the older demo listings (food_demo*, food_live*)
//
// Owners are the Maya and Budi accounts from `npm run seed` (run that first, otherwise the
// detail screen has no contact number for the WhatsApp button).
//
// Coordinates are approximate points around the faculties, not surveyed locations.
// Photos are illustrations in dummy/photos; they are copied to uploads/foods/ so they are
// served at /uploads/foods/<file> like any real upload.

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const MAYA = 'usr_9842a7f1';
const BUDI = 'usr_3c1d9e2b';

const UB_LISTINGS = [
  {
    food_id: 'food_ub01', photo: 'nasi_ayam', contributor_id: MAYA, hours: 33,
    title: 'Nasi Kotak Ayam Bakar',
    description: 'Sisa nasi kotak acara seminar, ayam bakar bumbu kecap dengan lalapan. Masih hangat dan dikemas rapi.',
    category: 'Makanan Berat', dietary_tags: ['Halal'], quantity_portions: 10, quantity_unit: 'kotak',
    location_name: 'Kantin FILKOM UB', address_text: 'Jl. Veteran No. 8, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95195, longitude: 112.61365, pickup_notes: 'Ambil di meja depan kantin, sebutkan "donasi SpoonShare".',
  },
  {
    food_id: 'food_ub02', photo: 'es_teh_jus', contributor_id: BUDI, hours: 36,
    title: 'Es Teh Manis & Jus Jeruk',
    description: 'Minuman sisa acara himpunan, dikemas gelas plastik tertutup. Disimpan di cooler box berisi es.',
    category: 'Minuman', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 20, quantity_unit: 'botol',
    location_name: 'Selasar Gedung Rektorat UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95255, longitude: 112.6129, pickup_notes: 'Cooler box biru di dekat tangga selasar.',
  },
  {
    food_id: 'food_ub03', photo: 'roti_bakar', contributor_id: MAYA, hours: 38,
    title: 'Roti Bakar Cokelat Keju',
    description: 'Roti bakar tebal dengan topping cokelat dan keju, dibuat pagi ini oleh kantin. Terbungkus per porsi.',
    category: 'Bakery', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 8, quantity_unit: 'bungkus',
    location_name: 'Kantin Fakultas Teknik UB', address_text: 'Jl. Mayjen Haryono, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9549, longitude: 112.6133, pickup_notes: 'Tanyakan ke penjaga kantin, bilang mengambil donasi roti.',
  },
  {
    food_id: 'food_ub04', photo: 'pecel', contributor_id: BUDI, hours: 32,
    title: 'Nasi Pecel Tumpang Malang',
    description: 'Nasi pecel dengan sayuran rebus, sambal pecel, tempe, dan rempeyek. Cocok untuk makan siang.',
    category: 'Makanan Berat', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 6, quantity_unit: 'porsi',
    location_name: 'Kantin FEB UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9543, longitude: 112.6118, pickup_notes: 'Ambil di warung pojok kiri, atas nama donasi.',
  },
  {
    food_id: 'food_ub05', photo: 'buah_potong', contributor_id: MAYA, hours: 34,
    title: 'Buah Potong Segar',
    description: 'Semangka, melon, dan anggur dalam wadah tertutup. Dipotong siang ini, simpan di tempat sejuk.',
    category: 'Buah & Sayur', dietary_tags: ['Halal', 'Vegetarian', 'Vegan'], quantity_portions: 12, quantity_unit: 'bungkus',
    location_name: 'Taman Fakultas Pertanian UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9516, longitude: 112.61215, pickup_notes: 'Ada di meja kayu dekat taman, dalam tas pendingin.',
  },
  {
    food_id: 'food_ub06', photo: 'donat', contributor_id: BUDI, hours: 40,
    title: 'Donat Kampung Aneka Rasa',
    description: 'Donat gula, cokelat, dan stroberi dari toko kue langganan. Satu kotak berisi 12 buah.',
    category: 'Bakery', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 24, quantity_unit: 'buah',
    location_name: 'Kantin FISIP UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9533, longitude: 112.615, pickup_notes: 'Kotak donat di meja informasi kantin.',
  },
  {
    food_id: 'food_ub07', photo: 'kopi_susu', contributor_id: MAYA, hours: 35,
    title: 'Kopi Susu Gula Aren',
    description: 'Kopi susu gula aren dingin dalam cup tertutup, sisa pesanan acara. Tanpa sedotan plastik tambahan.',
    category: 'Minuman', dietary_tags: ['Halal'], quantity_portions: 14, quantity_unit: 'botol',
    location_name: 'Lobi Perpustakaan Pusat UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95285, longitude: 112.61415, pickup_notes: 'Di meja lobi sebelah kiri pintu masuk.',
  },
  {
    food_id: 'food_ub08', photo: 'mie_goreng', contributor_id: BUDI, hours: 31,
    title: 'Mie Goreng Telur Pedas',
    description: 'Mie goreng dengan telur mata sapi dan sayuran, level pedas sedang. Dikemas kotak kertas.',
    category: 'Makanan Berat', dietary_tags: ['Halal', 'Pedas'], quantity_portions: 9, quantity_unit: 'kotak',
    location_name: 'Depan Gerbang Utama UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95365, longitude: 112.61385, pickup_notes: 'Tunggu di pos satpam gerbang, saya bawa ke depan.',
  },
  {
    food_id: 'food_ub09', photo: 'bakso', contributor_id: MAYA, hours: 30,
    title: 'Bakso Kuah Hangat',
    description: 'Bakso sapi dengan mie, bihun, dan kuah kaldu. Dibungkus terpisah antara kuah dan isian.',
    category: 'Makanan Berat', dietary_tags: ['Halal'], quantity_portions: 7, quantity_unit: 'bungkus',
    location_name: 'Kantin Fakultas Hukum UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95225, longitude: 112.61185, pickup_notes: 'Ambil di gerobak bakso, bilang donasi SpoonShare.',
  },
  {
    food_id: 'food_ub10', photo: 'pisang_tahu', contributor_id: BUDI, hours: 37,
    title: 'Pisang Goreng & Tahu Isi',
    description: 'Gorengan sore: pisang goreng crispy dan tahu isi sayur. Disertai cabai rawit.',
    category: 'Makanan Ringan', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 15, quantity_unit: 'bungkus',
    location_name: 'Kantin FIA UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9531, longitude: 112.61255, pickup_notes: 'Di meja kasir kantin dalam kantong plastik cokelat.',
  },
  {
    food_id: 'food_ub11', photo: 'susu_yogurt', contributor_id: MAYA, hours: 44,
    title: 'Susu Kotak & Yogurt Cup',
    description: 'Susu UHT dan yogurt cup yang masih lama masa kedaluwarsanya, kelebihan stok koperasi.',
    category: 'Minuman', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 18, quantity_unit: 'buah',
    location_name: 'Koperasi Mahasiswa UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95395, longitude: 112.6148, pickup_notes: 'Tanyakan ke kasir koperasi, tersedia selama jam buka.',
  },
  {
    food_id: 'food_ub12', photo: 'sandwich_salad', contributor_id: BUDI, hours: 33,
    title: 'Sandwich & Salad Sayur',
    description: 'Sandwich isi telur, sayuran, dan keju, dengan semangkuk salad segar. Dikemas rapi dalam kotak.',
    category: 'Makanan Ringan', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 8, quantity_unit: 'kotak',
    location_name: 'Kantin Sekolah Vokasi UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.95125, longitude: 112.6133, pickup_notes: 'Di meja depan kantin, dalam tas kertas putih.',
  },
  // ---- Contoh status lain, supaya setiap layar punya isi saat demo. Tidak muncul di peta. ----
  // Antrean verifikasi admin (belum disetujui).
  {
    food_id: 'food_ub21', photo: 'pecel', contributor_id: MAYA, hours: 30, verification: 'pending',
    title: 'Lontong Sayur Pagi',
    description: 'Lontong sayur dengan kuah santan dan telur, sisa dagangan pagi. Dikemas per bungkus.',
    category: 'Makanan Berat', dietary_tags: ['Halal'], quantity_portions: 8, quantity_unit: 'bungkus',
    location_name: 'Taman Kampus UB', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9541, longitude: 112.6151, pickup_notes: 'Ambil di bangku taman dekat pos satpam.',
  },
  {
    food_id: 'food_ub22', photo: 'roti_bakar', contributor_id: BUDI, hours: 31, verification: 'pending',
    title: 'Roti Isi Cokelat',
    description: 'Roti lembut isi cokelat dari acara bazar, kemasan masih tersegel.',
    category: 'Bakery', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 12, quantity_unit: 'buah',
    location_name: 'Gedung Samantha Krida', address_text: 'Jl. Veteran, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9505, longitude: 112.6143, pickup_notes: 'Ambil di lobi depan.',
  },
  {
    food_id: 'food_ub23', photo: 'es_teh_jus', contributor_id: MAYA, hours: 32, verification: 'pending',
    title: 'Air Mineral & Teh Kotak',
    description: 'Minuman kemasan sisa rapat, belum dibuka.',
    category: 'Minuman', dietary_tags: ['Halal', 'Vegan'], quantity_portions: 24, quantity_unit: 'botol',
    location_name: 'Gedung F FILKOM', address_text: 'Jl. Veteran No. 8, Ketawanggede, Lowokwaru, Malang',
    latitude: -7.9527, longitude: 112.6149, pickup_notes: 'Tanya resepsionis lantai 1.',
  },
  // Ditolak admin, lengkap dengan alasan.
  {
    food_id: 'food_ub24', photo: 'donat', contributor_id: MAYA, hours: 30, verification: 'rejected',
    rejection_reason: 'Foto makanan tidak jelas, mohon unggah ulang.',
    title: 'Kue Basah Aneka Ragam',
    description: 'Kue basah campur dari toko kue langganan.',
    category: 'Bakery', dietary_tags: ['Halal'], quantity_portions: 20, quantity_unit: 'buah',
    location_name: 'Toko Kue Merjosari', address_text: 'Jl. Raya Mulyorejo, Malang',
    latitude: -7.9486, longitude: 112.6020, pickup_notes: 'Ambil di kasir.',
  },
  // Sudah disetujui tetapi tidak lagi tersedia di Jelajah.
  {
    food_id: 'food_ub25', photo: 'mie_goreng', contributor_id: BUDI, hours: 33, status: 'reserved',
    title: 'Nasi Goreng Kampung',
    description: 'Nasi goreng kampung dengan telur ceplok. Sudah ada yang menyatakan akan mengambil.',
    category: 'Makanan Berat', dietary_tags: ['Halal'], quantity_portions: 5, quantity_unit: 'porsi',
    location_name: 'Warung Bu Tini', address_text: 'Jl. Tlogomas, Malang',
    latitude: -7.9602, longitude: 112.6078, pickup_notes: 'Sebutkan nama saat mengambil.',
  },
  {
    food_id: 'food_ub26', photo: 'nasi_ayam', contributor_id: MAYA, hours: 34, status: 'picked_up',
    title: 'Bubur Ayam Hangat',
    description: 'Bubur ayam lengkap dengan cakwe. Sudah diambil.',
    category: 'Makanan Berat', dietary_tags: ['Halal'], quantity_portions: 6, quantity_unit: 'porsi',
    location_name: 'Depan Gedung G FILKOM', address_text: 'Jl. Veteran, Malang',
    latitude: -7.9541, longitude: 112.6153, pickup_notes: 'Ambil di lobi satpam.',
  },
  {
    food_id: 'food_ub27', photo: 'donat', contributor_id: BUDI, hours: 35, status: 'cancelled',
    title: 'Martabak Mini Manis',
    description: 'Martabak mini cokelat keju. Dibatalkan karena tidak jadi dibagikan.',
    category: 'Bakery', dietary_tags: ['Halal', 'Vegetarian'], quantity_portions: 10, quantity_unit: 'kotak',
    location_name: 'Pasar Dinoyo', address_text: 'Jl. MT Haryono, Dinoyo, Malang',
    latitude: -7.9439, longitude: 112.6120, pickup_notes: 'Ambil di lapak depan.',
  },
];

const PHOTO_SOURCE_DIR = path.join(__dirname, '..', 'dummy', 'photos');
const PHOTO_TARGET_DIR = path.join(__dirname, '..', 'uploads', 'foods');
const PHOTO_URL_PREFIX = '/uploads/foods';

/** Copies the listing's illustration into uploads/foods and returns its public URL path. */
function publishPhoto(name) {
  const fileName = `seed_${name}.jpg`;
  fs.mkdirSync(PHOTO_TARGET_DIR, { recursive: true });
  fs.copyFileSync(path.join(PHOTO_SOURCE_DIR, `${name}.jpg`), path.join(PHOTO_TARGET_DIR, fileName));
  return `${PHOTO_URL_PREFIX}/${fileName}`;
}

/**
 * Turns the compact definitions into full documents. Dates are relative to `now`: created a
 * little while ago (newest first), approved a few minutes later, expiring `hours` from now.
 */
function buildUbListings(now = new Date(), photoUrlFor = (name) => `${PHOTO_URL_PREFIX}/seed_${name}.jpg`) {
  return UB_LISTINGS.map((def, index) => {
    const createdAt = new Date(now.getTime() - (index * 9 + 5) * MINUTE);
    const verifiedAt = new Date(createdAt.getTime() + 3 * MINUTE);
    const verification = def.verification || 'approved';
    const reviewed = verification !== 'pending';

    return {
      food_id: def.food_id,
      contributor_id: def.contributor_id,
      created_at: createdAt,
      updated_at: now,

      verification_status: verification,
      verification_details: {
        verified_by_admin_id: reviewed ? 'adm_001' : null,
        verified_at: reviewed ? verifiedAt : null,
        rejection_reason: verification === 'rejected' ? def.rejection_reason : null,
      },

      food_details: {
        title: def.title,
        description: def.description,
        category: def.category,
        dietary_tags: def.dietary_tags,
        quantity_portions: def.quantity_portions,
        quantity_unit: def.quantity_unit,
        expiry_timestamp: new Date(now.getTime() + def.hours * HOUR),
        photo_urls: [photoUrlFor(def.photo)],
      },

      location: {
        location_name: def.location_name,
        address_text: def.address_text,
        coordinates: { latitude: def.latitude, longitude: def.longitude },
        pickup_notes: def.pickup_notes,
        external_map_url: `https://maps.google.com/?q=${def.latitude},${def.longitude}`,
      },

      status: def.status || 'available',
    };
  });
}

async function removeOldDemoListings() {
  const oldIds = /^food_(demo|live)\d+(~.*)?$/;
  const active = await FoodItemListing.deleteMany({ food_id: oldIds });
  const archived = await FoodItemListing.Expired.deleteMany({ food_id: oldIds });
  console.log(`Removed old demo listings: ${active.deletedCount} active, ${archived.deletedCount} archived.`);
}

/**
 * Removes listings the team created while testing ("test", "test 2", "test 3 minuman",
 * "Notification Reboot Test 2", ...). Only runs with --clean-tests and only matches titles that
 * START with "test" or "notification reboot test", so the seeded demo data is never touched.
 */
const TEST_TITLE = /^(test\b|notification reboot test)/i;

async function removeTestListings() {
  for (const [label, model] of [['active', FoodItemListing], ['archived', FoodItemListing.Expired]]) {
    const rows = await model.find({ 'food_details.title': TEST_TITLE }).select('food_id food_details.title');

    for (const row of rows) {
      console.log(`Removing test listing (${label}): ${row.food_id} "${row.food_details.title}"`);
      await model.deleteOne({ _id: row._id });
    }
  }
}

async function seedUb({ clean, cleanTests }) {
  await connectDB();

  // Wait for the unique food_id index before inserting.
  await FoodItemListing.init();

  const ownerIds = [...new Set(UB_LISTINGS.map((def) => def.contributor_id))];
  const owners = await User.find({ user_id: { $in: ownerIds } }).select('user_id');
  const missing = ownerIds.filter((id) => !owners.some((owner) => owner.user_id === id));

  if (missing.length > 0) {
    console.warn(
      `WARNING: no account for ${missing.join(', ')}. Run "npm run seed" first, ` +
        'otherwise the detail screen has no contact number to show.'
    );
  }

  if (clean) {
    await removeOldDemoListings();
  }

  if (cleanTests) {
    await removeTestListings();
  }

  const now = new Date();
  const listings = buildUbListings(now, publishPhoto);

  let created = 0;
  let updated = 0;

  for (const listing of listings) {
    // A previous run may already have been archived once it expired. Remove that copy (and any
    // renamed "food_ub01~<id>" leftovers) so the id is free again.
    await FoodItemListing.Expired.deleteMany({
      food_id: new RegExp(`^${listing.food_id}(~.*)?$`),
    });

    const existing = await FoodItemListing.findOne({ food_id: listing.food_id });

    if (existing) {
      existing.set(listing);
      await existing.save();
      updated += 1;
    } else {
      await FoodItemListing.create(listing);
      created += 1;
    }

    console.log(`${listing.food_id}: ${listing.food_details.title} @ ${listing.location.location_name}`);
  }

  console.log(`\nSeeded ${listings.length} listings around UB (${created} created, ${updated} updated).`);
  console.log('food_ub01-12: approved + available (pins on the map). food_ub21-23: pending (admin queue).');
  console.log('food_ub24: rejected. food_ub25: reserved. food_ub26: picked up. food_ub27: cancelled.');
  console.log(`Each stays active for 30-44 hours from now (${now.toISOString()}). Re-run to refresh.`);

  await mongoose.disconnect();
}

module.exports = { UB_LISTINGS, buildUbListings };

if (require.main === module) {
  seedUb({
    clean: process.argv.includes('--clean'),
    cleanTests: process.argv.includes('--clean-tests'),
  }).catch(async (err) => {
    console.error('UB demo seeding failed:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  });
}
