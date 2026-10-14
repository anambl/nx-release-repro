/**
 * Trivial example used to test the global-components wrapper
 * pattern.
 *
 * @param title - Banner title.
 * @param badgeLabel - Optional badge label appended to the title.
 * @returns {string} The composed banner text.
 */
export function createBanner(title, badgeLabel) {
  return badgeLabel ? `${title} ${badgeLabel}` : title;
}
