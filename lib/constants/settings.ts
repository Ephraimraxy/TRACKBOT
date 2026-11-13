// General limits and constants for the application
export const MAX_ID_LENGTH = 25;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 1000;
export const MAX_VENDOR_DESCRIPTION_LENGTH = 1000;

// Pagination Defaults
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 12;
export const DEFAULT_SHOP_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 100;

// Storage folder names
export const ALLOWED_FOLDERS = ["products", "avatars"];

// File Upload Limits
export const MAX_UPLOAD_SIZE_MB = 5;
export const ALLOWED_IMAGE_FORMATS = ["image/jpeg", "image/png", "image/webp"];

// Error Messages
export const ERROR_MESSAGES = {
  // 400
  BAD_REQUEST:
    "The request is invalid. Please check the submitted data.",
  BAD_REQUEST_ID:
    "Failed to create the product: one or more IDs provided are invalid.",
  // 401
  UNAUTHORIZED: "You must be logged in to access this resource.",
  // 403
  FORBIDDEN: "You do not have permission to access this resource.",
  // 404
  NOT_FOUND: "The requested resource was not found.",
  // 500
  INTERNAL_ERROR: "An error occurred. Please try again later.",
};
