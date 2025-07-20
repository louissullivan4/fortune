import React, { useState, useEffect } from 'react';
import {
  Edit,
  Save,
  Play,
  Calendar
} from '@carbon/icons-react';
import {
  getStrategy,
  updateStrategy
} from '../services/api';
import {
  LoadingSpinner,
  ErrorMessage,
  SuccessMessage
} from '../components/common/CommonComponents';
import Button from '../components/common/Button';
import Card from '../components/common/Card';
import './StrategyEditorPage.css';

const StrategyEditorTab = ({ strategyId }) => {
  if (!strategyId) return <div style={{color: 'red'}}>No strategyId provided</div>;
  const [strategy, setStrategy] = useState(null);
  const [formData, setFormData] = useState(null);
  const [loading, setLoading]    = useState(true);
  const [saving, setSaving]      = useState(false);
  const [error, setError]        = useState(null);
  const [success, setSuccess]    = useState(null);

  useEffect(() => {
    fetchStrategy();
  }, [strategyId]);

  const fetchStrategy = async () => {
    try {
      setLoading(true);
      const data = await getStrategy(strategyId);
      setStrategy(data);
      setFormData({
        name: data.name,
        description: data.description,
        config: data.config
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
      setSuccess('Saved!');
      fetchStrategy();
    } catch (e) {
      setError(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfigChange = (key, val) =>
    setFormData(fd => ({
      ...fd,
      config: { ...fd.config, [key]: val }
    }));

  if (loading || !formData) return <LoadingSpinner message="Loading..." />;

  return (
    <Card variant="content" className="form-card">
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="name" className="form-label">Strategy Name</label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={e => setFormData(fd => ({ ...fd, name: e.target.value }))}
            className="form-input"
            placeholder="Enter strategy name"
          />
        </div>
        <div className="form-group">
          <label htmlFor="description" className="form-label">Description</label>
          <textarea
            id="description"
            value={formData.description}
            onChange={e => setFormData(fd => ({ ...fd, description: e.target.value }))}
            className="form-textarea"
            placeholder="Enter strategy description"
            rows="3"
          />
        </div>
      </div>
      <div className="config-grid">
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
          <label htmlFor="symbol1" className="form-label">Symbol 1</label>
          <input
            type="text"
            id="symbol1"
            value={formData.config.symbol1}
            onChange={e => handleConfigChange('symbol1', e.target.value)}
            className="form-input"
            placeholder="e.g., AAPL"
          />
        </div>
        <div className="form-group">
          <label htmlFor="symbol2" className="form-label">Symbol 2</label>
          <input
            type="text"
            id="symbol2"
            value={formData.config.symbol2}
            onChange={e => handleConfigChange('symbol2', e.target.value)}
            className="form-input"
            placeholder="e.g., MSFT"
          />
        </div>
        <div className="form-group">
          <label htmlFor="window" className="form-label">Window</label>
          <input
            type="number"
            id="window"
            value={formData.config.window}
            onChange={e => handleConfigChange('window', parseInt(e.target.value, 10) || 0)}
            className="form-input"
            min="10"
          />
        </div>
        <div className="form-group">
          <label htmlFor="entry_z" className="form-label">Entry Z-Score</label>
          <input
            type="number"
            id="entry_z"
            value={formData.config.entry_z}
            onChange={e => handleConfigChange('entry_z', parseFloat(e.target.value) || 0)}
            className="form-input"
            step="0.1"
            min="0"
          />
        </div>
        <div className="form-group">
          <label htmlFor="exit_z" className="form-label">Exit Z-Score</label>
          <input
            type="number"
            id="exit_z"
            value={formData.config.exit_z}
            onChange={e => handleConfigChange('exit_z', parseFloat(e.target.value) || 0)}
            className="form-input"
            step="0.1"
            min="0"
          />
        </div>
        <div className="form-group">
          <label htmlFor="risk_per_trade" className="form-label">Risk per Trade (%)</label>
          <input
            type="number"
            id="risk_per_trade"
            value={formData.config.risk_per_trade}
            onChange={e => handleConfigChange('risk_per_trade', parseInt(e.target.value, 10) || 0)}
            className="form-input"
            min="1"
            max="100"
          />
        </div>
      </div>
      <div className="form-actions">
        <Button onClick={handleSave} disabled={saving}>
          <span className="ml-2">Save Changes</span>
        </Button>
      </div>
      {error   && <ErrorMessage message={error} />}
      {success && <SuccessMessage message={success} />}
    </Card>
  );
};

export default StrategyEditorTab;
