const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, resolvePath } = require('../services/costCodeHierarchyAuthority');

const structure = {
  heads: [
    { id: 'h1', name: 'Plot Works', active: true, version: 1 },
    { id: 'h2', name: 'House Build', active: true, version: 1 },
    { id: 'ha', name: 'Archived', active: false, version: 1 },
  ],
  families: [
    { id: 'f1', headId: 'h1', name: 'Groundworks', active: true, version: 1 },
    { id: 'f2', headId: 'h2', name: 'Superstructure', active: true, version: 1 },
    { id: 'fa', headId: 'h1', name: 'Archived family', active: false, version: 1 },
  ],
  reportingGroups: [
    { id: 'g1', headId: 'h1', familyId: null, name: 'Foundations', active: true, version: 1 },
    { id: 'g2', headId: 'h1', familyId: 'f1', name: 'Substructure', active: true, version: 1 },
    { id: 'g3', headId: 'h2', familyId: null, name: 'Brickwork', active: true, version: 1 },
    { id: 'ga', headId: 'h1', familyId: null, name: 'Archived group', active: false, version: 1 },
  ],
};

test('Head is required while Family and Reporting Group are independently optional', () => {
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works' }).state, STATES.MATCHED);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', commercialFamily: 'Groundworks' }).state, STATES.MATCHED);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', reportingGroup: 'Foundations' }).state, STATES.MATCHED);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', commercialFamily: 'Groundworks', reportingGroup: 'Substructure' }).state, STATES.MATCHED);
  assert.equal(resolvePath(structure, {}).state, STATES.UNALLOCATED);
});

test('incoherent, missing and archived hierarchy identities fail closed', () => {
  assert.equal(resolvePath(structure, { commercialFamily: 'Groundworks' }).state, STATES.INVALID);
  assert.equal(resolvePath(structure, { reportingGroup: 'Foundations' }).state, STATES.INVALID);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', commercialFamily: 'Superstructure' }).state, STATES.NEW);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', reportingGroup: 'Brickwork' }).state, STATES.NEW);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', commercialFamily: 'Groundworks', reportingGroup: 'Foundations' }).state, STATES.NEW);
  assert.equal(resolvePath(structure, { commercialHead: 'Archived' }).state, STATES.ARCHIVED);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', commercialFamily: 'Archived family' }).state, STATES.ARCHIVED);
  assert.equal(resolvePath(structure, { commercialHead: 'Plot Works', reportingGroup: 'Archived group' }).state, STATES.ARCHIVED);
});
