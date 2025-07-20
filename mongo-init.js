// MongoDB initialization script for Fortune Trading Platform
// This script runs when the MongoDB container starts for the first time

// Switch to the fortune database
db = db.getSiblingDB('fortune');

// Create application user with appropriate permissions
db.createUser({
  user: process.env.MONGO_APP_USERNAME || 'fortune_user',
  pwd: process.env.MONGO_APP_PASSWORD || 'fortune_password',
  roles: [
    {
      role: 'readWrite',
      db: 'fortune'
    }
  ]
});

// Create collections with proper indexes
db.createCollection('strategies');
db.createCollection('backtest_results');
db.createCollection('trades');
db.createCollection('signals');
db.createCollection('positions');

// Create indexes for better performance
db.strategies.createIndex({ "name": 1 }, { unique: true });
db.strategies.createIndex({ "status": 1 });
db.strategies.createIndex({ "created_at": -1 });

db.backtest_results.createIndex({ "strategy_id": 1 });
db.backtest_results.createIndex({ "timestamp": -1 });
db.backtest_results.createIndex({ "strategy_id": 1, "timestamp": -1 });

db.trades.createIndex({ "strategy_id": 1 });
db.trades.createIndex({ "status": 1 });
db.trades.createIndex({ "created_at": -1 });
db.trades.createIndex({ "strategy_id": 1, "status": 1 });

db.signals.createIndex({ "strategy": 1 });
db.signals.createIndex({ "timestamp": -1 });
db.signals.createIndex({ "signal_type": 1 });

db.positions.createIndex({ "strategy_id": 1 });
db.positions.createIndex({ "symbol": 1 });
db.positions.createIndex({ "status": 1 });

// Insert sample data for development (optional)
if (process.env.NODE_ENV === 'development') {
  // Sample strategy
  db.strategies.insertOne({
    name: "Sample Pair Trading Strategy",
    description: "A sample pair trading strategy for demonstration",
    status: "draft",
    config: {
      "entry_condition": "z_score > 2",
      "exit_condition": "z_score < 0.5",
      "position_size": 0.1,
      "max_positions": 5
    },
    created_at: new Date(),
    updated_at: new Date(),
    test_history: []
  });

  print('Fortune database initialized successfully with sample data');
} else {
  print('Fortune database initialized successfully');
} 