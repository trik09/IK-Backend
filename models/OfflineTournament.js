const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please add a tournament title'],
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: [true, 'Please add a description']
    },
    organizer: {
        name: String,
        academy: String,
        phone: String,
        whatsapp: String,
        email: String
    },
    location: {
        city: { type: String, required: true },
        state: { type: String, required: true },
        venue: { type: String, required: true },
        googleMapsLink: String
    },
    tournamentType: {
        type: String,
        enum: ['Rapid', 'Blitz', 'Classical', 'Bullet'],
        default: 'Rapid'
    },
    category: {
        type: String,
        required: true // e.g. Open, U-15, Women, etc.
    },
    timeControl: String, // e.g. 15+10
    rounds: Number,
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    reportingTime: String,
    registrationDeadline: Date,
    entryFee: {
        type: Number,
        required: true
    },
    prizePool: {
        type: Number,
        default: 0
    },
    prizeStructure: String,
    ratingRestrictions: String,
    ageCategory: String,
    bannerImage: {
        type: String,
        default: '/default-tournament.jpg'
    },
    posterImage: String,
    registrationUrl: String,
    chessResultsLink: String,
    isFeatured: {
        type: Boolean,
        default: false
    },
    isPublished: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for search optimization
TournamentSchema.index({ 'location.city': 1, 'location.state': 1, tournamentType: 1, isPublished: 1 });
TournamentSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('OfflineTournament', TournamentSchema);
