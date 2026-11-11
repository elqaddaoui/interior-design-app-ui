module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Multi-tenant: the URL base (/slug) is decided when the page loads, not at build time (see scripts/babel-tenant-base.js).
    plugins: [require('./scripts/babel-tenant-base')],
  };
};
