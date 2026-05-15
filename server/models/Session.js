const mongoose = require('mongoose');

const comparisonEntrySchema = new mongoose.Schema(
  {
    winnerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Image', default: null },
    loserId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Image', default: null },
    skipped:        { type: Boolean, default: false },
    decidedAt:      { type: Date,    default: Date.now },
    isCalibration:  { type: Boolean, default: false },
    thinkingTime:   { type: Number,  default: null },
    winnerPosition: { type: String,  default: null },
    loserPosition:  { type: String,  default: null },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    username:    { type: String, required: true, trim: true, maxlength: 100 },
    source:      { type: String, default: null },
    startedAt:   { type: Date,   default: Date.now },
    completedAt: { type: Date,   default: null },
    durationMs:  { type: Number, default: null },
    comparisons: { type: [comparisonEntrySchema], default: [] },
  },
  { timestamps: false }
);

sessionSchema.virtual('pairsTotal').get(function () {
  return this.comparisons.length;
});

sessionSchema.virtual('pairsRated').get(function () {
  return this.comparisons.filter((c) => !c.skipped).length;
});

module.exports = mongoose.model('Session', sessionSchema);
