const mongoose = require('mongoose');

/**
 * A fixed island×mainland bridge pair from the M2 manifest, served to annotators
 * through the normal compare UI until rated `targetCount` times.
 *
 * `aId`/`bId` are stored **sorted** (aId < bId as hex strings) so the unique
 * compound index dedupes each unordered pair — seeding is idempotent. `order`
 * preserves the manifest's core-first priority; `islandId` records which endpoint
 * is the island image (for the progress endpoint's connectivity count).
 */
const bridgePairSchema = new mongoose.Schema(
  {
    aId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Image', required: true },
    bId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Image', required: true },
    islandId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Image', default: null },
    band:        { type: String, default: null },
    targetCount: { type: Number, default: 2 },
    seed:        { type: Number, default: null },
    order:       { type: Number, default: 0 },
  },
  { timestamps: true }
);

bridgePairSchema.index({ aId: 1, bId: 1 }, { unique: true });

module.exports = mongoose.model('BridgePair', bridgePairSchema);
