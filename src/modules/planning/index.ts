/**
 * Planning Module - Public API
 * Container module for shift planning features (bidding and swapping)
 */

// Re-export bidding sub-module
export * from './bidding';

// Re-export swapping sub-module
export * from './swapping';

// Note: Each sub-module manages its own domain and is autonomous
// The planning module serves as a logical grouping for related planning features
