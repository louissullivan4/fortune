import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Warning, ChevronRight, CaretDown } from "@carbon/icons-react";
import { createStrategy } from "../services/api";
import {
  ErrorMessage,
  SuccessMessage,
} from "../components/common/CommonComponents";
import Button from "../components/common/Button";
import Card, { ContentCard } from "../components/common/Card";
import "./styling/CreateStrategyPage.css";
import { FIELD_TIPS, ALGORITHM_DESCRIPTIONS } from "../utils/constants";

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

const CreateStrategyPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    config: {
      algorithm: "PairTrading",
      symbol1: "",
      symbol2: "",
      window: 60,
      entry_z: 2.5,
      exit_z: 0.25,
      risk_per_trade: 20, // integer percent 1–100
    },
  });
  const [validationErrors, setErrors] = useState({});

  const validateForm = () => {
    const errs = {};
    if (!formData.name || !formData.name.trim())
      errs.name = "Strategy name is required";
    if (!formData.description || !formData.description.trim())
      errs.description = "Description is required";
    const algo = formData.config.algorithm;
    const fields = ALGO_FIELDS[algo] || [];
    for (const field of fields) {
      const val = formData.config[field.key];
      if (
        field.required &&
        (val === undefined || (typeof val === "string" && !val.trim()))
      ) {
        errs[field.key] = `${field.label} is required`;
      }
      if (
        field.type === "number" &&
        field.min !== undefined &&
        val < field.min
      ) {
        errs[field.key] = `${field.label} must be ≥ ${field.min}`;
      }
      if (
        field.type === "number" &&
        field.max !== undefined &&
        val > field.max
      ) {
        errs[field.key] = `${field.label} must be ≤ ${field.max}`;
      }
    }
    // Algorithm-specific validation
    if (algo === "PairTrading") {
      if (formData.config.symbol1 === formData.config.symbol2)
        errs.symbol2 = "Symbol 2 must differ";
      if (formData.config.entry_z !== undefined && formData.config.entry_z <= 0)
        errs.entry_z = "Entry Z-score > 0";
      if (formData.config.exit_z !== undefined && formData.config.exit_z < 0)
        errs.exit_z = "Exit Z-score ≥ 0";
      if (
        formData.config.risk_per_trade !== undefined &&
        (formData.config.risk_per_trade < 1 ||
          formData.config.risk_per_trade > 100)
      )
        errs.risk_per_trade = "Must be between 1 and 100";
    } else if (algo === "BollingerReversionStrategy") {
      if (
        formData.config.num_std !== undefined &&
        formData.config.num_std < 0.1
      )
        errs.num_std = "Num Std Dev must be ≥ 0.1";
      if (
        formData.config.risk_per_trade !== undefined &&
        formData.config.risk_per_trade < 1
      )
        errs.risk_per_trade = "Must be at least 1";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFormChange = (field, value) => {
    setFormData((fd) => ({ ...fd, [field]: value }));
    if (validationErrors[field]) {
      setErrors((e) => ({ ...e, [field]: null }));
    }
  };
  const handleConfigChange = (key, value) => {
    setFormData((fd) => ({
      ...fd,
      config: { ...fd.config, [key]: value },
    }));
    if (validationErrors[key]) {
      setErrors((e) => ({ ...e, [key]: null }));
    }
  };

  const handleAlgorithmChange = (algo) => {
    setFormData((fd) => ({
      ...fd,
      config: getDefaultConfig(algo),
    }));
    setErrors({});
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const payload = {
        name: formData.name,
        description: formData.description,
        config: formData.config,
      };
      const result = await createStrategy(payload);
      setSuccess("Created!");
      setTimeout(() => {
        navigate(result.id ? `/strategies/${result.id}/edit` : "/strategies", {
          state: { message: "Strategy created" },
        });
      }, 1200);
    } catch (err) {
      setError(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-strategy-page">
      <header>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol className="breadcrumb-list">
            <li className="breadcrumb-item">
              <Link to="/strategies" className="breadcrumb-link">
                Strategies
              </Link>
            </li>
            <li className="breadcrumb-item">
              <ChevronRight size={16} className="breadcrumb-separator" />
              <span className="breadcrumb-current">New Strategy</span>
            </li>
          </ol>
        </nav>
      </header>

      {error && <ErrorMessage message={error} />}
      {success && <SuccessMessage message={success} />}

      <div className="form-tips-layout">
        <div className="form-main-col">
          <Card variant="content" className="form-card">
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="name" className="form-label">
                  Strategy Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleFormChange("name", e.target.value)}
                  className={`form-input ${validationErrors.name ? "error" : ""}`}
                  placeholder="Enter strategy name"
                />
                {validationErrors.name && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.name}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="description" className="form-label">
                  Description <span className="required">*</span>
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    handleFormChange("description", e.target.value)
                  }
                  className={`form-textarea ${validationErrors.description ? "error" : ""}`}
                  placeholder="Enter strategy description"
                  rows="3"
                />
                {validationErrors.description && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.description}
                  </div>
                )}
              </div>
            </div>
            <div className="config-three-col-grid">
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
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center create-strategy-btn"
            >
              <span className="ml-2">Create Strategy</span>
            </Button>
          </Card>
        </div>
        <div className="tips-section-wrapper">
          <ContentCard
            title={
              <div className="flex items-center justify-between">
                <span>Strategy Tips</span>
              </div>
            }
          >
            <ul className="tips-list">
              {ALGO_FIELDS[formData.config.algorithm].map(
                (field) =>
                  FIELD_TIPS[field.key] && (
                    <li key={field.key} className="tip-item">
                      <span className="tip-label">{field.label}:</span>{" "}
                      {FIELD_TIPS[field.key]}
                    </li>
                  ),
              )}
            </ul>
            <div className="caret-down">
              <CaretDown size={25} className="text-gray-400" />
            </div>
          </ContentCard>
          <ContentCard title="Algorithm Types">
            <ul className="tips-list">
              {Object.entries(ALGORITHM_DESCRIPTIONS).map(([alg, desc]) => (
                <li key={alg} className="tip-item">
                  <span className="tip-label">
                    {alg.replace(/([A-Z])/g, " $1").trim()}:
                  </span>{" "}
                  {desc}
                </li>
              ))}
            </ul>
          </ContentCard>
        </div>
      </div>
    </div>
  );
};

export default CreateStrategyPage;
