import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRight } from '@carbon/icons-react';
import StrategyEditorTab from './StrategyEditorPage';
import StrategyTestTab from './StrategyTestPage';
import './StrategyEditorPage.css';
import './StrategyTestPage.css';
import './StrategyTabsPage.css';

const StrategyTabsPage = () => {
  const { strategyId } = useParams();
  const [activeTab, setActiveTab] = useState('editor');

  return (
    <div className="strategy-tabs-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol className="breadcrumb-list">
          <li className="breadcrumb-item">
            <Link to="/strategies" className="breadcrumb-link">
              Strategies
            </Link>
          </li>
          <li className="breadcrumb-item">
            <ChevronRight size={16} className="breadcrumb-separator" />
            <span className="breadcrumb-current">Edit Strategy</span>
          </li>
        </ol>
      </nav>
      <div className="tabs-header">
        <button
          className={`tab-btn${activeTab === 'editor' ? ' active' : ''}`}
          onClick={() => setActiveTab('editor')}
        >
          Editor
        </button>
        <button
          className={`tab-btn${activeTab === 'test' ? ' active' : ''}`}
          onClick={() => setActiveTab('test')}
        >
          Test
        </button>
      </div>
      <div className="tab-content">
        {activeTab === 'editor' ? (
          <StrategyEditorTab key="editor" strategyId={strategyId} />
        ) : (
          <StrategyTestTab key="test" strategyId={strategyId} />
        )}
      </div>
    </div>
  );
};

export default StrategyTabsPage; 