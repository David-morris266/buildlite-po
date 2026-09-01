const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
function enterAuthContext(auth) { storage.enterWith({ auth }); }
function currentAuth() { return storage.getStore()?.auth || null; }
module.exports = { enterAuthContext, currentAuth };
