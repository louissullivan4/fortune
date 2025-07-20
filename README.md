# Fortune Trading Platform

A comprehensive algorithmic trading platform with real-time market data, strategy backtesting, and live trading capabilities. Built with FastAPI backend and React frontend.

## Overview

Fortune is a full-stack trading platform that enables users to create, test, and deploy algorithmic trading strategies. The platform provides real-time market data, comprehensive backtesting capabilities, and live trading execution.

## Features

- **Strategy Management**: Create, edit, and manage trading strategies
- **Backtesting Engine**: Test strategies against historical data with detailed performance metrics
- **Live Trading**: Execute strategies in real-time with live market data
- **Real-time Monitoring**: Track positions, P&L, and strategy performance
- **Market Data Feed**: Real-time price feeds and market information
- **Position Management**: Monitor and manage open positions
- **Emergency Controls**: Emergency stop and position management tools

## Technology Stack

### Backend
- **FastAPI**: High-performance web framework for building APIs
- **Python**: Core programming language
- **MongoDB**: Document database for strategy and trade data storage
- **Uvicorn**: ASGI server for running the FastAPI application

### Frontend
- **React**: User interface library
- **Vite**: Build tool and development server
- **Tailwind CSS**: Utility-first CSS framework
- **Chart.js**: Data visualization library
- **React Router**: Client-side routing
- **Axios**: HTTP client for API communication

## Project Structure

```
fortune/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API service layer
│   │   └── utils/          # Utility functions
│   └── package.json
├── src/                     # Python backend application
│   ├── routes/             # API route handlers
│   ├── strategies/         # Trading strategy implementations
│   ├── utils/              # Utility modules
│   └── main.py            # FastAPI application entry point
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

## Getting Started

### Prerequisites

- Python 3.8+
- Node.js 16+
- MongoDB instance
- Trading account with market data access

### Backend Setup

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start the backend server:
   ```bash
   cd src
   uvicorn main:app --reload
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173`

## API Documentation

The backend API is built with FastAPI and includes automatic documentation. Once the backend is running, visit:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

## Key API Endpoints

- `GET /strategies` - List all strategies
- `POST /strategies` - Create a new strategy
- `GET /strategies/{id}` - Get strategy details
- `PUT /strategies/{id}` - Update strategy
- `POST /strategies/{id}/backtest` - Run backtest
- `GET /live-trading/status` - Get live trading status
- `POST /live-trading/start` - Start live trading
- `POST /live-trading/stop` - Stop live trading

## Development

### Code Style

- **Backend**: Follow PEP 8 guidelines, use type hints
- **Frontend**: Use ESLint configuration, follow React best practices

### Testing

Run backend tests:
```bash
python -m pytest
```

Run frontend tests:
```bash
cd frontend
npm test
```

### Building for Production

Build the frontend:
```bash
cd frontend
npm run build
```

The built files will be in `frontend/dist/` and can be served by the FastAPI backend.

## Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
MONGODB_URI=mongodb://localhost:27017/fortune
API_KEY=your_api_key
SECRET_KEY=your_secret_key
MARKET_DATA_URL=your_market_data_url
```

### Strategy Configuration

Strategies are configured using JSON configuration objects that define:
- Entry and exit conditions
- Position sizing rules
- Risk management parameters
- Market data requirements

## Deployment

### Docker Deployment

1. Build the Docker image:
   ```bash
   docker build -t fortune .
   ```

2. Run the container:
   ```bash
   docker run -p 8000:8000 fortune
   ```

### Production Considerations

- Use a production ASGI server like Gunicorn
- Set up proper logging and monitoring
- Configure CORS for production domains
- Use environment-specific configuration
- Set up database backups and monitoring

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository or contact the development team.

## Disclaimer

This software is for educational and research purposes. Trading involves substantial risk of loss and is not suitable for all investors. Past performance does not guarantee future results. 