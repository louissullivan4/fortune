import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Add,
  Settings,
  Save,
  ArrowLeft,
  Warning,
  ChevronRight
} from '@carbon/icons-react';
import { createStrategy } from '../services/api';
import {
  LoadingSpinner,
  ErrorMessage,
  SuccessMessage
} from '../components/common/CommonComponents';
import Button from '../components/common/Button';
import Card, { ContentCard } from '../components/common/Card';
import './CreateStrategyPage.css';
import { FIELD_TIPS, ALGORITHM_DESCRIPTIONS } from '../utils/constants';

const CreateStrategyPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    config: {
      algorithm: 'PairTrading',
      symbol1: '',
      symbol2: '',
      window: 60,
      entry_z: 2.5,
      exit_z: 0.25,
      risk_per_trade: 20      // integer percent 1–100
    }
  });
  const [validationErrors, setErrors] = useState({});

  const validateForm = () => {
    const errs = {};
    if (!formData.name.trim()) errs.name = 'Strategy name is required';
    if (!formData.description.trim()) errs.description = 'Description is required';
    if (!formData.config.symbol1.trim()) errs.symbol1 = 'Symbol 1 is required';
    if (!formData.config.symbol2.trim()) errs.symbol2 = 'Symbol 2 is required';
    if (formData.config.symbol1 === formData.config.symbol2)
      errs.symbol2 = 'Symbol 2 must differ';
    if (formData.config.window < 10)
      errs.window = 'Window must be ≥ 10';
    if (formData.config.entry_z <= 0)
      errs.entry_z = 'Entry Z-score > 0';
    if (formData.config.exit_z < 0)
      errs.exit_z = 'Exit Z-score ≥ 0';
    if (
      formData.config.risk_per_trade < 1 ||
      formData.config.risk_per_trade > 100
    ) {
      errs.risk_per_trade = 'Must be between 1 and 100';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFormChange = (field, value) => {
    setFormData(fd => ({ ...fd, [field]: value }));
    if (validationErrors[field]) {
      setErrors(e => ({ ...e, [field]: null }));
    }
  };
  const handleConfigChange = (key, value) => {
    setFormData(fd => ({
      ...fd,
      config: { ...fd.config, [key]: value }
    }));
    if (validationErrors[key]) {
      setErrors(e => ({ ...e, [key]: null }));
    }
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
        config: formData.config
      };
      const result = await createStrategy(payload);
      setSuccess('Created!');
      setTimeout(() => {
        navigate(
          result.id
            ? `/strategies/${result.id}/edit`
            : '/strategies',
          { state: { message: 'Strategy created' } }
        );
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

      {error   && <ErrorMessage message={error} />}
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
                  onChange={e => handleFormChange('name', e.target.value)}
                  className={`form-input ${validationErrors.name ? 'error' : ''}`}
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
                  onChange={e => handleFormChange('description', e.target.value)}
                  className={`form-textarea ${validationErrors.description ? 'error' : ''}`}
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
                <label htmlFor="algorithm" className="form-label">Algorithm</label>
                <select
                  id="algorithm"
                  value={formData.config.algorithm}
                  onChange={e => handleConfigChange('algorithm', e.target.value)}
                  className="form-select"
                >
                  <option value="PairTrading">Pair Trading</option>
                  <option value="HedgedPairTrading">Hedged Pair Trading</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="symbol1" className="form-label">
                  Symbol 1 <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="symbol1"
                  value={formData.config.symbol1}
                  onChange={e => handleConfigChange('symbol1', e.target.value)}
                  className={`form-input ${validationErrors.symbol1 ? 'error' : ''}`}
                  placeholder="e.g., AAPL"
                />
                {validationErrors.symbol1 && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.symbol1}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="symbol2" className="form-label">
                  Symbol 2 <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="symbol2"
                  value={formData.config.symbol2}
                  onChange={e => handleConfigChange('symbol2', e.target.value)}
                  className={`form-input ${validationErrors.symbol2 ? 'error' : ''}`}
                  placeholder="e.g., MSFT"
                />
                {validationErrors.symbol2 && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.symbol2}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="window" className="form-label">
                  Window <span className="required">*</span>
                </label>
                <input
                  type="number"
                  id="window"
                  value={formData.config.window}
                  onChange={e => handleConfigChange('window', parseInt(e.target.value, 10) || 0)}
                  className={`form-input ${validationErrors.window ? 'error' : ''}`}
                  min="10"
                />
                {validationErrors.window && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.window}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="entry_z" className="form-label">
                  Entry Z-Score <span className="required">*</span>
                </label>
                <input
                  type="number"
                  id="entry_z"
                  value={formData.config.entry_z}
                  onChange={e => handleConfigChange('entry_z', parseFloat(e.target.value) || 0)}
                  className={`form-input ${validationErrors.entry_z ? 'error' : ''}`}
                  step="0.1"
                  min="0"
                />
                {validationErrors.entry_z && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.entry_z}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="exit_z" className="form-label">
                  Exit Z-Score <span className="required">*</span>
                </label>
                <input
                  type="number"
                  id="exit_z"
                  value={formData.config.exit_z}
                  onChange={e => handleConfigChange('exit_z', parseFloat(e.target.value) || 0)}
                  className={`form-input ${validationErrors.exit_z ? 'error' : ''}`}
                  step="0.1"
                  min="0"
                />
                {validationErrors.exit_z && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.exit_z}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="risk_per_trade" className="form-label">
                  Risk per Trade (%) <span className="required">*</span>
                </label>
                <input
                  type="number"
                  id="risk_per_trade"
                  value={formData.config.risk_per_trade}
                  onChange={e => handleConfigChange('risk_per_trade', parseInt(e.target.value, 10) || 0)}
                  className={`form-input ${validationErrors.risk_per_trade ? 'error' : ''}`}
                  min="1"
                  max="100"
                />
                {validationErrors.risk_per_trade && (
                  <div className="error-message">
                    <Warning size={12} className="mr-1" />
                    {validationErrors.risk_per_trade}
                  </div>
                )}
              </div>
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
          <ContentCard title="Strategy Tips">
            <ul className="tips-list">
              {Object.entries(FIELD_TIPS).map(([field, tip]) => (
                <li key={field} className="tip-item">
                  <span className="tip-label">{field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:</span> {tip}
                </li>
              ))}
            </ul>
          </ContentCard>
          <ContentCard title="Algorithm Types">
            <ul className="tips-list">
              {Object.entries(ALGORITHM_DESCRIPTIONS).map(([alg, desc]) => (
                <li key={alg} className="tip-item">
                  <span className="tip-label">{alg.replace(/([A-Z])/g, ' $1').trim()}:</span> {desc}
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
