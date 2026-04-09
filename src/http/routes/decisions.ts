import { Router } from 'express'
import { getDecisionsPaginated, getDecisionById } from '../../analytics/journal.js'

const router = Router()

// GET /api/decisions?page=1&limit=20
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
  const { data, total } = getDecisionsPaginated(page, limit)
  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
})

// GET /api/decisions/:id
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
  const decision = getDecisionById(id)
  if (!decision) return res.status(404).json({ error: 'Decision not found' })

  // Parse embedded JSON blobs for the client
  res.json({
    ...decision,
    signals: (() => { try { return JSON.parse(decision.signalsJson) } catch { return [] } })(),
    portfolio: (() => { try { return JSON.parse(decision.portfolioJson) } catch { return null } })(),
  })
})

export default router
