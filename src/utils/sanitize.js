/**
 * Sanitization Utilities
 */

/**
 * Sanitize text input to prevent injection/XSS
 * - Strips HTML tags
 * - Enforces max length
 */
export const sanitizeText = (str, maxLength = 20000) => {
    if (typeof str !== 'string') return '';

    // 1. Basic HTML Tag Strip (Prevents Stored XSS)
    // Replaces <...> with empty string
    const noTags = str.replace(/<[^>]*>?/gm, '');

    // 2. Length Guard
    return noTags.slice(0, maxLength);
};
