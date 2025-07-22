import React, { useState, useEffect } from "react";
import {
  Play,
  Stop,
  Pause,
  Security,
  Calendar,
  ConnectionSignal,
} from "@carbon/icons-react";
import { LoadingSpinner } from "../components/common/CommonComponents";
import Button from "../components/common/Button";
import "./styling/LiveTradingPage.css";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import {
  startLiveTrading,
  stopLiveTrading,
  pauseLiveTrading,
  resumeLiveTrading,
  getLiveTradingStatus,
  getRiskLevel,
  getMarketStatus,
} from "../services/api";

const Card = ({ icon, title, children }) => (
  <div className="settings-card settings-card-row">
    <div className="settings-card-header">
      {icon}
      <h2>{title}</h2>
    </div>
    <div className="settings-card-content">{children}</div>
  </div>
);

const StatusBadge = ({ status }) => {
  let color = "#888";
  if (status === "running") color = "#16a34a";
  else if (status === "paused") color = "#eab308";
  else if (status === "stopped") color = "#dc2626";
  return (
    <span className="settings-status-badge" style={{ background: color }}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown"}
    </span>
  );
};

const SettingsPage = () => {
  const [liveStatus, setLiveStatus] = useState(null);
  const [risk, setRisk] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    if (success) toast.success(success);
  }, [success]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, riskData, market] = await Promise.all([
        getLiveTradingStatus(),
        getRiskLevel(),
        getMarketStatus(),
      ]);
      setLiveStatus(status);
      setRisk(riskData);
      setMarketStatus(market);
    } catch (e) {
      setError("Failed to load settings data.");
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await startLiveTrading();
      setSuccess("Live trading started.");
      fetchAll();
    } catch (e) {
      setError("Failed to start live trading.");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await stopLiveTrading();
      setSuccess("Live trading stopped.");
      fetchAll();
    } catch (e) {
      setError("Failed to stop live trading.");
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await pauseLiveTrading();
      setSuccess("Live trading paused.");
      fetchAll();
    } catch (e) {
      setError("Failed to pause live trading.");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await resumeLiveTrading();
      setSuccess("Live trading resumed.");
      fetchAll();
    } catch (e) {
      setError("Failed to resume live trading.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-page modern-settings settings-page-rows">
      <h1 className="settings-title">Settings</h1>
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
      <div className="settings-row-list">
        <Card icon={<ConnectionSignal size={22} />} title="Live Trading">
          <div className="settings-controls-row">
            <Button
              onClick={handleStart}
              variant="primary"
              disabled={loading || liveStatus?.status === "running"}
            >
              <Play size={16} className="mr-1" /> Start
            </Button>
            <Button
              onClick={handleStop}
              variant="danger"
              disabled={loading || liveStatus?.status === "stopped"}
            >
              <Stop size={16} className="mr-1" /> Stop
            </Button>
            <Button
              onClick={handlePause}
              variant="secondary"
              disabled={loading || liveStatus?.status !== "running"}
            >
              <Pause size={16} className="mr-1" /> Pause
            </Button>
            <Button
              onClick={handleResume}
              variant="primary"
              disabled={loading || liveStatus?.status !== "paused"}
            >
              <Play size={16} className="mr-1" /> Resume
            </Button>
          </div>
          <div className="settings-info-row">
            <div>
              <strong>Status:</strong>{" "}
              <StatusBadge status={liveStatus?.status} />
            </div>
            <div>
              <strong>Active Strategies:</strong>{" "}
              {liveStatus?.active_strategies?.length || 0}
            </div>
            <div>
              <strong>Paper Mode:</strong>{" "}
              {liveStatus?.paper_mode ? "Yes" : "No"}
            </div>
          </div>
        </Card>
        <div className="settings-last-row-list">
          <Card icon={<Security size={22} />} title="Risk Overview">
            <div className="settings-info-row">
              <div>
                <strong>Current Risk Level:</strong>{" "}
                <StatusBadge status={risk?.risk_level} />
              </div>
              <div>
                <strong>Risk Score:</strong>{" "}
                {risk?.risk_score != null ? risk.risk_score : "N/A"}
              </div>
              <div>
                <strong>Total Market Value:</strong>{" "}
                {risk?.total_market_value != null
                  ? `$${risk.total_market_value.toLocaleString()}`
                  : "N/A"}
              </div>
              <div>
                <strong>Total Unrealized PnL:</strong>{" "}
                {risk?.total_unrealized_pnl != null
                  ? `$${risk.total_unrealized_pnl.toLocaleString()}`
                  : "N/A"}
              </div>
            </div>
          </Card>
          <Card icon={<Calendar size={22} />} title="Market Status">
            <div className="settings-info-row">
              <div>
                <strong>Status:</strong>{" "}
                <StatusBadge status={marketStatus?.status} />
              </div>
              <div>
                <strong>Current Time (ET):</strong>{" "}
                {marketStatus?.current_time_et || "-"}
              </div>
              <div>
                <strong>Market Open:</strong>{" "}
                {marketStatus?.market_open_time || "-"}
              </div>
              <div>
                <strong>Market Close:</strong>{" "}
                {marketStatus?.market_close_time || "-"}
              </div>
              {marketStatus?.time_until_open && (
                <div>
                  <strong>Time Until Open:</strong>{" "}
                  {marketStatus.time_until_open.hours}h{" "}
                  {marketStatus.time_until_open.minutes}m
                </div>
              )}
              {marketStatus?.time_until_close && (
                <div>
                  <strong>Time Until Close:</strong>{" "}
                  {marketStatus.time_until_close.hours}h{" "}
                  {marketStatus.time_until_close.minutes}m
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
