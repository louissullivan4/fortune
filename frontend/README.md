# Fortune Trading Dashboard - Frontend

A modern React application for analyzing trading strategy performance.

## Features

- **Historical Analysis**: Analyze trading performance with customizable initial capital
- **Real-time Charts**: Interactive charts showing profit/loss distribution and trading activity
- **Performance Metrics**: Key metrics including total profit, return percentage, win rate, and more
- **Detailed Statistics**: Comprehensive breakdown of trading activities
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

- **React 19**: Modern React with hooks and functional components
- **Vite**: Fast build tool and development server
- **React Router**: Client-side routing
- **Chart.js**: Interactive charts and data visualization
- **Axios**: HTTP client for API communication
- **CSS Modules**: Component-scoped styling

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Layout/         # Main layout and navigation
│   ├── CapitalInput/   # Initial capital input form
│   ├── MetricsGrid/    # Performance metrics display
│   ├── ChartsSection/  # Chart containers
│   ├── PnLChart/       # Profit/Loss distribution chart
│   ├── ActivityChart/  # Trading activity chart
│   ├── DetailedStats/  # Detailed statistics table
│   ├── LoadingSpinner/ # Loading indicator
│   └── ErrorMessage/   # Error display component
├── pages/              # Page components
│   └── HistoricalPage/ # Main historical analysis page
├── services/           # API and external services
│   └── api.js         # Backend API communication
├── utils/              # Utility functions
│   └── formatters.js  # Data formatting utilities
└── main.jsx           # Application entry point
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000`

## Development

- **Build for production**: `npm run build`
- **Preview production build**: `npm run preview`
- **Lint code**: `npm run lint`

## API Integration

The frontend communicates with the FastAPI backend through the `/api` proxy configured in `vite.config.js`. Make sure the backend server is running on `http://localhost:8000`.

## Component Architecture

The application follows a clean component architecture:

- **Layout**: Handles navigation and overall page structure
- **Pages**: Container components that manage state and data flow
- **Components**: Reusable UI components with specific responsibilities
- **Services**: Handle external API communication
- **Utils**: Pure utility functions for data formatting and manipulation

Each component has its own CSS file for scoped styling, making the codebase maintainable and modular.
