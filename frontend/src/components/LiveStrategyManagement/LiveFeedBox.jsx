import React, { useEffect, useRef, useState } from "react";
import "./LiveStrategyManagement.css";

const WS_URL =
  window.location.protocol === "https:"
    ? `wss://${window.location.host}/live-trading/ws/live-feed`
    : `ws://${window.location.hostname}:8000/live-trading/ws/live-feed`;

function getPriceDirection(prev, curr) {
  if (prev == null || curr == null) return null;
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "same";
}

function formatPrice(price) {
  if (price == null) return "-";
  return Number(price).toFixed(2);
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  try {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  } catch {
    return "-";
  }
}

export default function LiveFeedBox({ className = "", isLiveTradingRunning = false }) {
  const [currentQuote, setCurrentQuote] = useState(null);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const prevPrices = useRef({});
  const wsRef = useRef(null);

  useEffect(() => {
    if (!isLiveTradingRunning) {
      setCurrentQuote(null);
      setError(null);
      setIsConnected(false);
      setLastUpdateTime(null);
      return;
    }

    wsRef.current = new window.WebSocket(WS_URL);
    
    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      setError(null);
      setIsConnected(true);
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "quote" && msg.data) {
          setCurrentQuote(msg.data);
          setLastUpdateTime(Date.now());
          setIsConnected(true);
        } else if (msg.type === "error" && msg.message) {
          setError(msg.message);
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
      setIsConnected(false);
    };
    
    wsRef.current.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setIsConnected(false);
      if (event.code !== 1000) {
        setError('WebSocket connection lost');
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, [isLiveTradingRunning]);

  // Check if we're receiving live data (received update in last 10 seconds)
  const isReceivingLiveFeed = isConnected && lastUpdateTime && (Date.now() - lastUpdateTime) < 10000;

  // Process current quote
  const processedQuote = currentQuote ? (() => {
    const symbol = currentQuote.symbol || currentQuote.S || "?";
    const bidPrice = currentQuote.bp || currentQuote.bid_price || null;
    const askPrice = currentQuote.ap || currentQuote.ask_price || null;
    
    // Use mid-price for direction calculation
    const midPrice = bidPrice && askPrice ? (bidPrice + askPrice) / 2 : null;
    const prev = prevPrices.current[symbol];
    const direction = getPriceDirection(prev, midPrice);
    prevPrices.current[symbol] = midPrice;

    return {
      symbol,
      bidPrice,
      askPrice,
      direction,
      timestamp: currentQuote.timestamp || currentQuote.t
    };
  })() : null;

  return (
    <div className={`live-feed-compact ${className}`}>
      {/* Status indicator dot */}
      <div className={`status-dot ${isReceivingLiveFeed ? 'status-dot-green' : 'status-dot-red'}`}></div>
      
      {error ? (
        <div className="live-feed-error-compact">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      ) : (
        <div className="live-feed-content-compact">
          {!processedQuote ? (
            <div className="live-feed-empty-compact">
              <span className="empty-icon">📊</span>
              <span className="empty-text">
                {isLiveTradingRunning ? "Waiting..." : "Not running"}
              </span>
            </div>
          ) : (
            <div className="live-feed-quote-compact quote-animate">
              <div className="quote-header">
                <span className="quote-symbol-compact">{processedQuote.symbol}</span>
                <span className="quote-time-compact">{formatTime(processedQuote.timestamp)}</span>
              </div>
              <div className="quote-prices">
                <span className={`quote-price-compact price-${processedQuote.direction || "same"}`}>
                  {processedQuote.direction === "up" && <span className="arrow-compact">▲</span>}
                  {processedQuote.direction === "down" && <span className="arrow-compact">▼</span>}
                  <span className="bid-price">{formatPrice(processedQuote.bidPrice)}</span>
                  <span className="separator">/</span>
                  <span className="ask-price">{formatPrice(processedQuote.askPrice)}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 