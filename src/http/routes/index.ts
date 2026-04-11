import { Router } from 'express'
import authRouter from './auth.js'
import usersRouter from './users.js'
import engineRouter from './engine.js'
import portfolioRouter from './portfolio.js'
import signalsRouter from './signals.js'
import decisionsRouter from './decisions.js'
import ordersRouter from './orders.js'
import analyticsRouter from './analytics.js'
import configRouter from './config.js'
import instrumentsRouter from './instruments.js'

const api = Router()

// Public auth routes (no JWT required)
api.use('/auth', authRouter)

// Protected routes (each router applies requireAuth internally)
api.use('/users', usersRouter)
api.use('/engine', engineRouter)
api.use('/portfolio', portfolioRouter)
api.use('/signals', signalsRouter)
api.use('/decisions', decisionsRouter)
api.use('/orders', ordersRouter)
api.use('/analytics', analyticsRouter)
api.use('/config', configRouter)
api.use('/instruments', instrumentsRouter)

export default api
