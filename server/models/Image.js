const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    eloRating: { type: Number, default: 1500 },
    comparisons: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Image', imageSchema);
