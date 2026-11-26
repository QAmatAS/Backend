const crypto = require('crypto');
const mongoose = require('mongoose');

const STATUSES = ['pending', 'approved', 'rejected'];

// Human readable id, e.g. "vol_a1b2c3d4" (same style as food_id / user_id).
function generateVolunteerId() {
  return `vol_${crypto.randomBytes(4).toString('hex')}`;
}

const reviewSchema = new mongoose.Schema(
  {
    reviewed_by: { type: String, default: null },
    reviewed_at: { type: Date, default: null },
    rejection_reason: {
      type: String,
      default: null,
      maxlength: [500, 'rejection reason must be at most 500 characters'],
    },
  },
  { _id: false }
);

// One document per account (unique user_id). A rejected applicant who applies
// again updates the same document back to "pending" instead of adding a second
// one, so the unique index also settles double submits.
const volunteerSchema = new mongoose.Schema(
  {
    volunteer_id: {
      type: String,
      required: [true, 'volunteer_id is required'],
      unique: true,
      trim: true,
      default: generateVolunteerId,
    },
    user_id: {
      type: String,
      required: [true, 'user_id is required'],
      unique: true,
      trim: true,
      maxlength: [64, 'user_id must be at most 64 characters'],
    },
    full_name: {
      type: String,
      required: [true, 'full_name is required'],
      trim: true,
      minlength: [2, 'full_name must be at least 2 characters'],
      maxlength: [100, 'full_name must be at most 100 characters'],
    },
    // Stored normalised (+62...), see normalizeWhatsapp in routes/volunteers.js.
    whatsapp: {
      type: String,
      required: [true, 'whatsapp is required'],
      trim: true,
      match: [/^\+[1-9][0-9]{7,14}$/, 'whatsapp must be a valid phone number'],
    },
    email: {
      type: String,
      required: [true, 'email is required'],
      trim: true,
      lowercase: true,
      maxlength: [254, 'email must be at most 254 characters'],
      match: [/^\S+@\S+\.\S+$/, 'email is invalid'],
    },
    // File name only (inside private_uploads/ktp). Never sent to clients.
    ktp_file: {
      type: String,
      required: [true, 'ktp_file is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: `status must be one of: ${STATUSES.join(', ')}`,
      },
      default: 'pending',
    },
    review: {
      type: reviewSchema,
      default: () => ({}),
    },
    submitted_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// Admin queue: filter by status, newest first.
volunteerSchema.index({ status: 1, submitted_at: -1 });

volunteerSchema.statics.STATUSES = STATUSES;
volunteerSchema.statics.generateVolunteerId = generateVolunteerId;

// Shape sent to API clients. The stored file name stays on the server; clients
// get a flag and the (authenticated) URL to fetch the image.
volunteerSchema.methods.toPublic = function toPublic() {
  const review = this.review || {};

  return {
    volunteer_id: this.volunteer_id,
    user_id: this.user_id,
    full_name: this.full_name,
    whatsapp: this.whatsapp,
    email: this.email,
    status: this.status,
    has_ktp: Boolean(this.ktp_file),
    ktp_url: this.ktp_file ? `/api/volunteers/${this.volunteer_id}/ktp` : null,
    review: {
      reviewed_by: review.reviewed_by || null,
      reviewed_at: review.reviewed_at || null,
      rejection_reason: review.rejection_reason || null,
    },
    submitted_at: this.submitted_at,
    created_at: this.created_at,
    updated_at: this.updated_at,
  };
};

module.exports = mongoose.model('Volunteer', volunteerSchema);
