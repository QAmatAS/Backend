require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const { connectDB } = require('./config/db');
const User = require('./models/User');
const Volunteer = require('./models/Volunteer');
const { ktpDir, isKtpFilename, removeKtpFile } = require('./middleware/uploadKtp');

// Demo data for the NGO / volunteer feature.
//
//   npm run seed:volunteers            adds Budi's pending application if he has none
//   npm run seed:volunteers -- --reset removes EVERY application (and its KTP file)
//                                      and recreates Budi's, so the demo starts clean
//
// Budi (usr_3c1d9e2b) is the account the demo rejects and then lets re-apply.
// Maya (usr_9842a7f1) gets no application: she applies live from the app.
// The KTP image is a dummy placeholder (dummy/ktp-sample.png), never a real ID.
const SAMPLE_KTP = path.join(__dirname, '..', 'dummy', 'ktp-sample.png');
const DEMO_APPLICANT_ID = 'usr_3c1d9e2b';

/**
 * Builds the application document for a demo account. Pure, so it is easy to test.
 * `user` supplies the contact details, with fallbacks for accounts that have none.
 */
function buildDemoApplication(user, ktpFile, now = new Date()) {
  const info = (user && user.personal_info) || {};

  return {
    volunteer_id: Volunteer.generateVolunteerId(),
    user_id: user.user_id,
    full_name: user.name || 'Budi Santoso',
    whatsapp: info.phone || '+6281255500011',
    email: user.email || 'budi@example.com',
    ktp_file: ktpFile,
    status: 'pending',
    submitted_at: now,
  };
}

/** Copies the dummy KTP into the private folder under a freshly generated name. */
async function copySampleKtp(userId) {
  await fs.mkdir(ktpDir, { recursive: true });

  const owner = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const name = `ktp_${owner}_${crypto.randomBytes(4).toString('hex')}.png`;

  await fs.copyFile(SAMPLE_KTP, path.join(ktpDir, name));
  return name;
}

/** Deletes every application, its KTP file and any leftover generated file. */
async function resetApplications() {
  const rows = await Volunteer.find({});

  for (const row of rows) {
    await removeKtpFile(row.ktp_file);
  }

  const removed = await Volunteer.deleteMany({});

  // Orphans from failed uploads: only files with a name this server generates.
  let leftovers = [];
  try {
    leftovers = (await fs.readdir(ktpDir)).filter(isKtpFilename);
  } catch {
    // The folder does not exist yet: nothing to clean.
  }
  for (const name of leftovers) {
    await removeKtpFile(name);
  }

  return { applications: removed.deletedCount || 0, files: leftovers.length };
}

async function seedVolunteers({ reset = false } = {}) {
  await connectDB();

  // Wait for the unique indexes before writing.
  await Volunteer.init();

  const applicant = await User.findOne({ user_id: DEMO_APPLICANT_ID });

  if (!applicant) {
    console.error(
      `No account with user_id ${DEMO_APPLICANT_ID} (Budi). Run "npm run seed" first.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (reset) {
    const removed = await resetApplications();
    console.log(
      `reset: removed ${removed.applications} application(s) and ${removed.files} KTP file(s)`
    );
  }

  const existing = await Volunteer.findOne({ user_id: DEMO_APPLICANT_ID });

  if (existing) {
    console.log(
      `already exists: ${existing.volunteer_id} (${applicant.email}, ${existing.status}). ` +
        'Use "npm run seed:volunteers -- --reset" to start over.'
    );
  } else {
    const ktpFile = await copySampleKtp(applicant.user_id);

    try {
      const created = await Volunteer.create(buildDemoApplication(applicant, ktpFile));
      console.log(`created: ${created.volunteer_id} (${applicant.email}, pending)`);
    } catch (err) {
      await removeKtpFile(ktpFile).catch(() => {});
      throw err;
    }
  }

  const pending = await Volunteer.countDocuments({ status: 'pending' });
  console.log(`\nVolunteer seeding finished. Pending applications: ${pending}.`);

  await mongoose.disconnect();
}

module.exports = { buildDemoApplication, copySampleKtp, resetApplications, seedVolunteers };

if (require.main === module) {
  seedVolunteers({ reset: process.argv.includes('--reset') }).catch(async (err) => {
    console.error('Volunteer seeding failed:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  });
}
