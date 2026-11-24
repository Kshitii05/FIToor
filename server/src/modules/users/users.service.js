import { AppError } from '../../lib/errors.js';

// Response shapes. Building them field by field (never spreading a database row)
// is what keeps password hashes and private contact details out of responses.

/** The signed-in user's own account. */
export function toPrivateUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    // Only decides which screens to show; the server checks the role on every admin request.
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    profile: toProfile(user.profile),
  };
}

function toProfile(profile) {
  return {
    displayName: profile.displayName,
    bio: profile.bio,
    photoUrl: profile.photoUrl,
    locality: profile.locality,
  };
}

/** What anyone may see about a user: no email, phone, address or coordinates. */
function toPublicUser(user) {
  return {
    id: user.id,
    displayName: user.profile.displayName,
    bio: user.profile.bio,
    photoUrl: user.profile.photoUrl,
    locality: user.profile.locality,
    memberSince: user.createdAt.toISOString(),
  };
}

export async function getOwnAccount({ db }, userId) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  return toPrivateUser(user);
}

export async function updateOwnProfile({ db }, userId, changes) {
  await db.userProfile.update({ where: { userId }, data: changes });
  return getOwnAccount({ db }, userId);
}

export async function getPublicProfile({ db }, userId) {
  const user = await db.user.findFirst({
    where: { id: userId, status: 'ACTIVE' },
    include: { profile: true },
  });
  if (!user) throw AppError.notFound('User not found');
  return toPublicUser(user);
}
