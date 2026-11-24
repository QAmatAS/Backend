const mongoose = require("mongoose");

const STATUSES = ["available", "reserved", "picked_up", "expired", "cancelled"];
const VERIFICATION_STATUSES = ["pending", "approved", "rejected"];

// ---------------------------------------------------------------------------
// Nested schemas (_id: false keeps the JSON identical to the API contract)
// ---------------------------------------------------------------------------

// GeoJSON twin of `coordinates`, in [longitude, latitude] order. A 2dsphere
// index cannot be built on the { latitude, longitude } object, so this copy
// exists purely for geospatial queries and is never returned by toPublic().
const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: "geo coordinates must be [longitude, latitude]",
      },
    },
  },
  { _id: false },
);

const coordinatesSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: [true, "latitude is required"],
      min: [-90, "latitude must be between -90 and 90"],
      max: [90, "latitude must be between -90 and 90"],
    },
    longitude: {
      type: Number,
      required: [true, "longitude is required"],
      min: [-180, "longitude must be between -180 and 180"],
      max: [180, "longitude must be between -180 and 180"],
    },
  },
  { _id: false },
);

const verificationDetailsSchema = new mongoose.Schema(
  {
    verified_by_admin_id: { type: String, default: null, trim: true },
    verified_at: { type: Date, default: null },
    rejection_reason: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const foodDetailsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "title is required"],
      trim: true,
      maxlength: [150, "title must be at most 150 characters"],
    },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    category: {
      type: String,
      required: [true, "category is required"],
      trim: true,
      maxlength: [100, "category must be at most 100 characters"],
    },
    dietary_tags: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    quantity_portions: {
      type: Number,
      required: [true, "quantity_portions is required"],
      min: [1, "quantity_portions must be at least 1"],
    },
    // Free string on purpose: contributors use "porsi", "kotak", "bungkus", and
    // a closed enum would just block real cases. Never used for stock maths.
    quantity_unit: {
      type: String,
      trim: true,
      maxlength: [20, "quantity_unit must be at most 20 characters"],
      default: "porsi",
    },
    expiry_timestamp: {
      type: Date,
      required: [true, "expiry_timestamp is required"],
    },
    photo_urls: {
      type: [{ type: String, trim: true }],
      default: [],
    },
  },
  { _id: false },
);

const locationSchema = new mongoose.Schema(
  {
    location_name: {
      type: String,
      required: [true, "location_name is required"],
      trim: true,
      maxlength: [150, "location_name must be at most 150 characters"],
    },
    address_text: { type: String, default: "", trim: true, maxlength: 500 },
    coordinates: {
      type: coordinatesSchema,
      required: [true, "coordinates are required"],
    },
    geo: {
      type: geoPointSchema,
      // Internal: excluded from every normal query and from toPublic().
      select: false,
    },
    pickup_notes: { type: String, default: "", trim: true, maxlength: 1000 },
    external_map_url: { type: String, default: "", trim: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

const foodItemListingSchema = new mongoose.Schema(
  {
    // Human readable business id, e.g. "food_8821". The Mongo _id is separate.
    food_id: {
      type: String,
      required: [true, "food_id is required"],
      unique: true,
      trim: true,
      maxlength: [64, "food_id must be at most 64 characters"],
    },
    contributor_id: {
      type: String,
      required: [true, "contributor_id is required"],
      trim: true,
      index: true,
      maxlength: [64, "contributor_id must be at most 64 characters"],
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },

    verification_status: {
      type: String,
      enum: {
        values: VERIFICATION_STATUSES,
        message: `verification_status must be ${VERIFICATION_STATUSES.join(", ")}`,
      },
      default: "pending",
      index: true,
    },
    verification_details: {
      type: verificationDetailsSchema,
      default: () => ({}),
    },

    food_details: {
      type: foodDetailsSchema,
      required: [true, "food_details is required"],
    },
    location: {
      type: locationSchema,
      required: [true, "location is required"],
    },

    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: `status must be ${STATUSES.join(", ")}`,
      },
      default: "available",
      index: true,
    },
  },
  { collection: "food_items" },
);

foodItemListingSchema.index({ status: 1, created_at: -1 });
// Lets the expiry sweep (run on most reads) find overdue listings without
// scanning the whole collection.
foodItemListingSchema.index({ status: 1, "food_details.expiry_timestamp": 1 });
foodItemListingSchema.index({ "location.geo": "2dsphere" });

foodItemListingSchema.statics.STATUSES = STATUSES;
foodItemListingSchema.statics.VERIFICATION_STATUSES = VERIFICATION_STATUSES;

// True when `err` is a MongoDB duplicate-key error (code 11000) raised by the
// unique index on `field`. Telling the indexes apart matters: a clash on _id
// means "this exact listing is already archived", while a clash on food_id
// means a *different* archived listing owns the same business id.
function isDuplicateKeyOn(err, field) {
  if (!err || err.code !== 11000) return false;

  if (err.keyPattern) {
    return Object.prototype.hasOwnProperty.call(err.keyPattern, field);
  }

  // Fallback for errors that only describe the index in their message.
  const message = String(err.message || "");
  return field === "_id"
    ? message.includes("index: _id_")
    : message.includes(`index: ${field}_`);
}

// Raw insert into the archive: an archived record must be preserved exactly as
// stored, even if an older document would not pass today's schema validation.
// A duplicate _id is not an error here, it only means a previous sweep already
// wrote this document before it stopped.
async function insertArchived(doc) {
  try {
    await ExpiredListing.collection.insertOne(doc);
  } catch (err) {
    if (!isDuplicateKeyOn(err, "_id")) throw err;
  }
}

// Copies one overdue listing into the archive, then removes it from the source
// collection. Returns true when this call completed the move.
async function archiveListing(Source, listing, staleFilter, now) {
  const archived = listing.toObject();
  archived.status = "expired";
  archived.updated_at = now;

  try {
    await insertArchived(archived);
  } catch (err) {
    if (!isDuplicateKeyOn(err, "food_id")) throw err;

    // A different archived listing already uses this food_id (for example a
    // client reused it). Keep both instead of losing this one: the suffix is
    // what lets the unique index accept the copy.
    archived.food_id = `${listing.food_id}~${listing._id}`;
    await insertArchived(archived);
  }

  // Delete only if the listing is still overdue. A concurrent edit (status
  // changed, expiry extended) must win over the sweep.
  const removed = await Source.deleteOne({
    _id: listing._id,
    $or: staleFilter.$or,
  });

  if (removed.deletedCount === 1) return true;

  // Nothing was deleted: either another sweep already finished this listing
  // (keep the archive copy), or the listing changed and is no longer overdue
  // (the archive copy must go, otherwise it exists in both collections).
  if (await Source.exists({ _id: listing._id })) {
    await ExpiredListing.deleteOne({ _id: listing._id });
  }

  return false;
}

// Moves listings whose consumption deadline has passed into the "Expired"
// archive collection, so `food_items` only ever holds food that is still
// actionable. Called on read, which keeps the database truthful even when no
// background job is running.
//
// Safe to run at any time and from many requests at once: the copy is written
// to the archive BEFORE the source is deleted, so a crash in between leaves a
// duplicate (cleaned up by the next sweep) and never a missing listing.
//
// This function never throws. A failure is logged and the listing simply
// stays where it is until the next sweep, so a read endpoint is never turned
// into a 500 by the housekeeping that runs in front of it.
foodItemListingSchema.statics.expireStale = async function expireStale(
  now = new Date(),
) {
  // The archive model shares this schema, and therefore this static. Sweeping
  // the archive into itself would make no sense.
  if (this.modelName === "ExpiredListing") return 0;

  // Anything already marked expired, plus anything whose deadline has passed
  // while still available or reserved.
  const staleFilter = {
    $or: [
      { status: "expired" },
      {
        status: { $in: ["available", "reserved"] },
        "food_details.expiry_timestamp": { $lt: now },
      },
    ],
  };

  let moved = 0;

  try {
    // No limit on purpose: a read must finish the sweep before it answers,
    // otherwise the very response that triggered the sweep could still contain
    // expired food (and the correction would only land on the next request).
    const stale = await this.find(staleFilter).select("+location.geo");

    for (const listing of stale) {
      try {
        if (await archiveListing(this, listing, staleFilter, now)) moved += 1;
      } catch (err) {
        console.error(
          `expireStale: could not archive ${listing.food_id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("expireStale: sweep failed:", err.message);
  }

  return moved;
};

// Keeps location.geo in step with location.coordinates for every write path
// (API create/patch, seeds, future imports). Runs before validation so the
// index never sees a half-written point.
foodItemListingSchema.pre("validate", function syncGeoPoint() {
  const coordinates = this.location && this.location.coordinates;

  if (
    !coordinates ||
    typeof coordinates.latitude !== "number" ||
    typeof coordinates.longitude !== "number"
  ) {
    return;
  }

  this.location.geo = {
    type: "Point",
    coordinates: [coordinates.longitude, coordinates.latitude],
  };
});

function toIsoString(value) {
  return value ? new Date(value).toISOString() : null;
}

// Shape sent to API clients: exactly the documented snake_case JSON, with the
// internal Mongo fields (_id, __v) hidden.
foodItemListingSchema.methods.toPublic = function toPublic() {
  const details = this.food_details || {};
  const location = this.location || {};
  const coordinates = location.coordinates || {};
  const verification = this.verification_details || {};

  return {
    food_id: this.food_id,
    contributor_id: this.contributor_id,
    created_at: toIsoString(this.created_at),
    updated_at: toIsoString(this.updated_at),
    verification_status: this.verification_status,
    verification_details: {
      verified_by_admin_id: verification.verified_by_admin_id || null,
      verified_at: toIsoString(verification.verified_at),
      rejection_reason: verification.rejection_reason || null,
    },
    food_details: {
      title: details.title,
      description: details.description || "",
      category: details.category,
      dietary_tags: details.dietary_tags || [],
      quantity_portions: details.quantity_portions,
      quantity_unit: details.quantity_unit || "porsi",
      expiry_timestamp: toIsoString(details.expiry_timestamp),
      photo_urls: details.photo_urls || [],
    },
    location: {
      location_name: location.location_name,
      address_text: location.address_text || "",
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
      pickup_notes: location.pickup_notes || "",
      external_map_url: location.external_map_url || "",
    },
    status: this.status,
  };
};

const FoodItemListing = mongoose.model(
  "FoodItemListing",
  foodItemListingSchema,
);

// Archive for listings that passed their consumption deadline. Same schema, so
// the stored shape is identical; the explicit collection name keeps the
// capitalised "Expired" the API consumers expect.
const ExpiredListing = mongoose.model(
  "ExpiredListing",
  foodItemListingSchema,
  "Expired",
);

module.exports = FoodItemListing;
module.exports.Expired = ExpiredListing;
