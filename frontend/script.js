// Global variables for charts
let pnlChart = null;
let activityChart = null;

// API base URL - adjust this to match your FastAPI server
const API_BASE_URL = 'http://localhost:8000';

// DOM elements
const initialCapitalInput = document.getElementById('initialCapital');
const analyzeBtn = document.getElementById('analyzeBtn');
const resultsSection = document.getElementById('resultsSection');
const loading = document.getElementById('loading');
const error = document.getElementById('error');

// Event listeners
analyzeBtn.addEventListener('click', analyzePerformance);
initialCapitalInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        analyzePerformance();
    }
});

// Main function to analyze performance
async function analyzePerformance() {
    const initialCapital = parseFloat(initialCapitalInput.value);
    
    if (!initialCapital || initialCapital <= 0) {
        showError('Please enter a valid initial capital amount');
        return;
    }

    showLoading();
    hideError();
    hideResults();

    try {
        // Fetch analysis data from the API
        const response = await fetch(`${API_BASE_URL}/analysis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                initial_capital: initialCapital
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displayResults(data);
        
    } catch (err) {
        console.error('Error fetching data:', err);
        showError('Failed to fetch analysis data. Make sure the backend server is running.');
    } finally {
        hideLoading();
    }
}

// Display results in the UI
function displayResults(data) {
    // Update metric cards
    updateMetric('totalProfit', formatCurrency(data.total_profit), data.total_profit >= 0);
    updateMetric('returnPct', formatPercentage(data.return_pct), data.return_pct >= 0);
    updateMetric('totalTrades', data.n_trades.toString());
    
    const winRate = data.n_trades > 0 ? (data.winning_trades / data.n_trades) * 100 : 0;
    updateMetric('winRate', formatPercentage(winRate));

    // Update detailed statistics
    document.getElementById('initialCapitalDisplay').textContent = formatCurrency(data.initial_capital);
    document.getElementById('totalEntries').textContent = data.n_entries.toString();
    document.getElementById('totalExits').textContent = data.n_exits.toString();
    document.getElementById('buyActions').textContent = data.total_buy_actions.toString();
    document.getElementById('sellActions').textContent = data.total_sell_actions.toString();
    document.getElementById('winningTrades').textContent = data.winning_trades.toString();
    document.getElementById('losingTrades').textContent = data.losing_trades.toString();

    // Create charts
    createPnLChart(data);
    createActivityChart(data);

    showResults();
}

// Update metric with color coding
function updateMetric(elementId, value, isPositive = null) {
    const element = document.getElementById(elementId);
    element.textContent = value;
    
    // Remove existing color classes
    element.classList.remove('positive', 'negative');
    
    // Add color class if specified
    if (isPositive !== null) {
        element.classList.add(isPositive ? 'positive' : 'negative');
    }
}

// Create Profit/Loss distribution chart
function createPnLChart(data) {
    const ctx = document.getElementById('pnlChart').getContext('2d');
    
    // Destroy existing chart if it exists
    if (pnlChart) {
        pnlChart.destroy();
    }

    const labels = ['Winning Trades', 'Losing Trades'];
    const values = [data.winning_trades, data.losing_trades];
    const colors = ['#00d4aa', '#ff6b6b'];

    pnlChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 12,
                            family: 'Inter'
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: 'white',
                    bodyColor: 'white',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: true
                }
            }
        }
    });
}

// Create Trading Activity chart
function createActivityChart(data) {
    const ctx = document.getElementById('activityChart').getContext('2d');
    
    // Destroy existing chart if it exists
    if (activityChart) {
        activityChart.destroy();
    }

    const labels = ['Buy Actions', 'Sell Actions', 'Entries', 'Exits'];
    const values = [
        data.total_buy_actions,
        data.total_sell_actions,
        data.n_entries,
        data.n_exits
    ];
    const colors = ['#667eea', '#764ba2', '#00d4aa', '#ff6b6b'];

    activityChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 0,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: 'white',
                    bodyColor: 'white',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        font: {
                            family: 'Inter',
                            size: 12
                        },
                        color: '#666'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            family: 'Inter',
                            size: 12
                        },
                        color: '#666'
                    }
                }
            }
        }
    });
}

// Utility functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatPercentage(value) {
    return `${value.toFixed(2)}%`;
}

function showLoading() {
    loading.style.display = 'block';
}

function hideLoading() {
    loading.style.display = 'none';
}

function showResults() {
    resultsSection.style.display = 'block';
}

function hideResults() {
    resultsSection.style.display = 'none';
}

function showError(message) {
    error.querySelector('p').textContent = message;
    error.style.display = 'block';
}

function hideError() {
    error.style.display = 'none';
}

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    // Set default value and focus
    initialCapitalInput.focus();
    
    // Add some sample data visualization on page load (optional)
    // This could show a welcome message or sample chart
    console.log('Fortune Trading Dashboard loaded successfully!');
});

// Add some interactive features
document.addEventListener('DOMContentLoaded', function() {
    // Add smooth scrolling for better UX
    const smoothScroll = (target) => {
        target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    };

    // Auto-scroll to results when they appear
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                if (resultsSection.style.display === 'block') {
                    setTimeout(() => smoothScroll(resultsSection), 100);
                }
            }
        });
    });

    observer.observe(resultsSection, {
        attributes: true,
        attributeFilter: ['style']
    });
}); 