/**
 * Password length rule, the same for customers, delivery staff and the administrator.
 * At least 6 characters. The upper limit is bcrypt's: it only reads the first 72 bytes, so a
 * longer password would be silently cut short.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;
