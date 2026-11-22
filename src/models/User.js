const crypto = require('crypto');
const mongoose = require('mongoose');

const ROLES = ['contributor', 'admin'];

// Human readable id, e.g. "usr_9842a7f1". Food listings reference this value in
// contributor_id, so it is the real link between a listing and its owner. The
// Mongo _id remains the technical primary key.
function generateUserId() {
  return `usr_${crypto.randomBytes(4).toString('hex')}`;
}

const personalInfoSchema = new mongoose.Schema(
  {
    display_name: {
      type: String,
      trim: true,
      maxlength: [100, 'display_name must be at most 100 characters'],
      default: '',
    },
    avatar_url: { type: String, trim: true, default: '' },
    bio: {
      type: String,
      trim: true,
      maxlength: [500, 'bio must be at most 500 characters'],
      default: '',
    },
    // Rendered as the WhatsApp button on the listing detail screen.
    phone: {
      type: String,
      trim: true,
      maxlength: [32, 'phone must be at most 32 characters'],
      default: '',
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: [true, 'user_id is required'],
      unique: true,
      // Sparse so the unique index can be built before older documents without a
      // user_id have been backfilled (npm run migrate:user-ids).
      sparse: true,
      trim: true,
      maxlength: [64, 'user_id must be at most 64 characters'],
      default: generateUserId,
    },
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
      maxlength: [100, 'name must be at most 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'email is invalid'],
    },
    // Never selected by default, so it cannot leak through a normal query.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ROLES,
        message: `role must be ${ROLES.join(' or ')}`,
      },
      default: 'contributor',
    },
    personal_info: {
      type: personalInfoSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

userSchema.statics.generateUserId = generateUserId;

// Shape sent to API clients for the signed-in user: no password hash, no
// internal Mongo fields.
userSchema.methods.toPublic = function toPublic() {
  const info = this.personal_info || {};

  return {
    id: this._id.toString(),
    user_id: this.user_id,
    name: this.name,
    email: this.email,
    role: this.role,
    personal_info: {
      display_name: info.display_name || this.name,
      avatar_url: info.avatar_url || '',
      bio: info.bio || '',
      phone: info.phone || '',
    },
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// Shape safe to show to other users (listing detail): no email, no stats, no
// timestamps. Used from Phase 5 onwards.
userSchema.methods.toContributor = function toContributor() {
  const info = this.personal_info || {};

  return {
    user_id: this.user_id,
    display_name: info.display_name || this.name,
    avatar_url: info.avatar_url || '',
    phone: info.phone || '',
  };
};

module.exports = mongoose.model('User', userSchema);
