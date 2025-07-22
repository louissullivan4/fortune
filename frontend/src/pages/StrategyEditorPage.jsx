import React, { useState, useEffect } from "react";
import { Warning } from "@carbon/icons-react";
import { getStrategy, updateStrategy } from "../services/api";
import {
  LoadingSpinner,
  // ErrorMessage,
  // SuccessMessage,
} from "../components/common/CommonComponents";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import "./styling/StrategyEditorPage.css";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ALGO_FIELDS = {
  PairTrading: [
    {
      key: "symbol1",
      label: "Symbol 1",
      type: "text",
      required: true,
      placeholder: "e.g., AAPL",
    },
    {
      key: "symbol2",
      label: "Symbol 2",
      type: "text",
      required: true,
      placeholder: "e.g., MSFT",
    },
    { key: "window", label: "Window", type: "number", required: true, min: 10 },
    {
      key: "entry_z",
      label: "Entry Z-Score",
      type: "number",
      required: true,
      step: 0.1,
      min: 0,
    },
    {
      key: "exit_z",
      label: "Exit Z-Score",
      type: "number",
      required: true,
      step: 0.1,
      min: 0,
    },
    {
      key: "risk_per_trade",
      label: "Risk per Trade (%)",
      type: "number",
      required: true,
      min: 1,
      max: 100,
    },
  ],
  BollingerReversionStrategy: [
    {
      key: "symbol",
      label: "Symbol",
      type: "text",
      required: true,
      placeholder: "e.g., AAPL",
    },
    { key: "window", label: "Window", type: "number", required: true, min: 10 },
    {
      key: "num_std",
      label: "Num Std Dev",
      type: "number",
      required: true,
      step: 0.1,
      min: 0.1,
    },
    {
      key: "risk_per_trade",
      label: "Risk per Trade ($)",
      type: "number",
      required: true,
      min: 1,
    },
  ],
};

const ALGO_OPTIONS = [
  { value: "PairTrading", label: "Pair Trading" },
  { value: "BollingerReversionStrategy", label: "Bollinger Reversion" },
];

function getDefaultConfig(algo) {
  if (algo === "PairTrading") {
    return {
      algorithm: "PairTrading",
      symbol1: "",
      symbol2: "",
      window: 60,
      entry_z: 2.5,
      exit_z: 0.25,
      risk_per_trade: 20,
    };
  } else if (algo === "BollingerReversionStrategy") {
    return {
      algorithm: "BollingerReversionStrategy",
      symbol: "",
      window: 20,
      num_std: 2.0,
      risk_per_trade: 1000,
    };
  }
  return {};
}

const StrategyEditorTab = ({ strategyId }) => {
  if (!strategyId)
    return <div style={{ color: "red" }}>No strategyId provided</div>;
  const [strategy, setStrategy] = useState(null);
  const [formData, setFormData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    fetchStrategy();
  }, [strategyId]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      const timer = setTimeout(() => setError(null), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      toast.success(success);
      const timer = setTimeout(() => setSuccess(null), 500);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const fetchStrategy = async () => {
    try {
      setLoading(true);
      const data = await getStrategy(strategyId);
      setStrategy(data);
      setFormData({
        name: data.name,
        description: data.description,
        config: data.config,
      });
    } catch (e) {
      setError(`Fetch failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateStrategy(strategyId, formData);
      setSuccess("Saved!");
      fetchStrategy();
    } catch (e) {
      setError(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfigChange = (key, val) =>
    setFormData((fd) => ({
      ...fd,
      config: { ...fd.config, [key]: val },
    }));

  const handleAlgorithmChange = (algo) => {
    setFormData((fd) => ({
      ...fd,
      config: getDefaultConfig(algo),
    }));
  };

  if (loading || !formData) return <LoadingSpinner message="Loading..." />;

  return (
    <Card variant="content" className="form-card">
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
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="name" className="form-label">
            Strategy Name
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) =>
              setFormData((fd) => ({ ...fd, name: e.target.value }))
            }
            className="form-input"
            placeholder="Enter strategy name"
          />
        </div>
        <div className="form-group">
          <label htmlFor="description" className="form-label">
            Description
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) =>
              setFormData((fd) => ({ ...fd, description: e.target.value }))
            }
            className="form-textarea"
            placeholder="Enter strategy description"
            rows="3"
          />
        </div>
      </div>
      <div className="config-grid">
        <div className="form-group">
          <label htmlFor="algorithm" className="form-label">
            Algorithm
          </label>
          <select
            id="algorithm"
            value={formData.config.algorithm}
            onChange={(e) => handleAlgorithmChange(e.target.value)}
            className="form-select"
          >
            {ALGO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {ALGO_FIELDS[formData.config.algorithm].map((field) => (
          <div className="form-group" key={field.key}>
            <label htmlFor={field.key} className="form-label">
              {field.label}
              {field.required && <span className="required">*</span>}
            </label>
            <input
              type={field.type}
              id={field.key}
              value={formData.config[field.key] ?? ""}
              onChange={(e) =>
                handleConfigChange(
                  field.key,
                  field.type === "number"
                    ? parseFloat(e.target.value) || 0
                    : e.target.value,
                )
              }
              className={`form-input ${validationErrors[field.key] ? "error" : ""}`}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              step={field.step}
            />
            {validationErrors[field.key] && (
              <div className="error-message">
                <Warning size={12} className="mr-1" />
                {validationErrors[field.key]}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="form-actions">
        <Button onClick={handleSave} disabled={saving}>
          <span className="ml-2">Save Changes</span>
        </Button>
      </div>
      {/* Removed ErrorMessage and SuccessMessage components */}
    </Card>
  );
};

export default StrategyEditorTab;
