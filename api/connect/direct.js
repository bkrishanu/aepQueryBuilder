// api/connect/direct.js
// POST /api/connect/direct — verify raw Postgres credentials, no AEP API calls
const { pgConnect } = require('../_helpers')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { host, port, dbName, user, password } = req.body
  if (!host || !dbName || !user) {
    return res.status(400).json({ error: 'host, dbName and user are required.' })
  }
  try {
    await pgConnect({ host, port, database: dbName, user, password })
    res.json({ host, port, dbName, user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
