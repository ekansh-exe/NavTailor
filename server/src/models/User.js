import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    // Google's stable account id (the "sub" claim of the ID token).
    // unique: true creates a unique index, so it is indexed too.
    googleId: { type: String, required: true, unique: true },

    // From Google. Normalised so "A@x.com" and "a@x.com" are stored the same.
    email: { type: String, required: true, trim: true, lowercase: true },

    name: { type: String, trim: true },

    // Google avatar URL.
    picture: { type: String },
  },
  {
    // Mongoose sets createdAt automatically on insert.
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Model name "User" -> collection "users".
export const User = mongoose.model('User', userSchema);
