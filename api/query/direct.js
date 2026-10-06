// api/query/direct.js
// POST /api/query/direct — execute SQL using raw Postgres credentials, no AEP API calls
const { pgQuery, statementsFromBody } = require('../_helpers')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { host, port, dbName, user, password } = req.body
  const statements = statementsFromBody(req.body)
  if (!statements) {
    return res.status(400).json({ error: 'Query cannot be empty.' })
  }
  try {
    const result = await pgQuery(
      { host, port, database: dbName, user, password },
      statements
    )
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
