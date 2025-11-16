// puppeteer.config.cjs
const { join } = require('path');

/**
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  // Store Chrome in a directory that gets baked into the Render image
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
