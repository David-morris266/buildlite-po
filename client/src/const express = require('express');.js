const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_PATH = path.join(__dirname, '../data/po-data.json');

// Ensure the data file exists
if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, JSON.stringify([]));
}

// POST: Save new PO
router.post('/', (req, res) => {
  const newPO = req.body;

  const raw = fs.readFileSync(DATA_PATH);
  const data = JSON.parse(raw);

  data.push(newPO);

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  res.status(201).json({ message: 'PO saved successfully' });
});

// GET: View all POs
router.get('/', (req, res) => {
  const raw = fs.readFileSync(DATA_PATH);
  const data = JSON.parse(raw);
  res.json(data);
});

module.exports = router;