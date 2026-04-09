import { Router } from 'express'
import { engineService } from '../../engine/EngineService.js'

const router = Router()

// GET /api/engine/status
router.get('/status', (_req, res) => {
  res.json(engineService.status)
})

// POST /api/engine/start
router.post('/start', async (_req, res, next) => {
  try {
    const status = await engineService.start()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/stop
router.post('/stop', (_req, res) => {
  const status = engineService.stop()
  res.json(status)
})

// POST /api/engine/cycle — trigger a single cycle immediately
router.post('/cycle', async (_req, res, next) => {
  try {
    const status = await engineService.triggerCycle()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

export default router
