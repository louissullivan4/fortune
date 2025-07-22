import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Add,
  Edit,
  Play,
  Upload,
  Download,
  TrashCan,
  Filter,
  Search,
  Document,
  Calendar,
  ChartLine,
  OverflowMenuVertical,
  ChevronRight,
  Home
} from '@carbon/icons-react';
import { getStrategies, deleteStrategy, publishStrategy, unpublishStrategy } from '../services/api';
import { LoadingSpinner, ErrorMessage, SuccessMessage } from '../components/common/CommonComponents';
import Button from '../components/common/Button';
import './StrategiesPage.css';

function ActionMenu({ strategy, isOpen, onToggle, onAction }) {
  const buttonRef = useRef();
  const dropdownRef = useRef();
  const [alignLeft, setAlignLeft] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = dropdownRef.current ? dropdownRef.current.offsetWidth : 160;
      let left = buttonRect.left;
      let top = buttonRect.bottom + window.scrollY;
      let alignLeftNow = false;
      if (buttonRect.left + dropdownWidth > window.innerWidth) {
        left = buttonRect.right - dropdownWidth;
        alignLeftNow = true;
      }
      setDropdownPosition({ top, left });
      setAlignLeft(alignLeftNow);
    }
  }, [isOpen]);

  if (strategy.status === 'deleted') return null;

  return (
    <div className="action-menu" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => onToggle(strategy.id)}
        className="action-menu-toggle"
        title="Actions"
      >
        <OverflowMenuVertical size={16} />
      </Button>
      {isOpen && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className={`action-dropdown${alignLeft ? ' action-dropdown--left' : ''}`}
          style={{
            position: 'absolute',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            zIndex: 9999,
            maxWidth: '100px'
          }}
        >
          <button
            onClick={() => onAction(strategy, 'edit')}
            className="dropdown-item"
          >
            <Edit size={16} className="mr-2" />
            Edit
          </button>
          <button
            onClick={() => onAction(strategy, 'test')}
            className="dropdown-item"
          >
            <Play size={16} className="mr-2" />
            Test
          </button>
          {strategy.status === 'draft' && (
            <button
              onClick={() => onAction(strategy, 'publish')}
              className="dropdown-item"
            >
              <Upload size={16} className="mr-2" />
              Publish
            </button>
          )}
          {strategy.status === 'published' && (
            <button
              onClick={() => onAction(strategy, 'unpublish')}
              className="dropdown-item"
            >
              <Download size={16} className="mr-2" />
              Unpublish
            </button>
          )}
          <button
            onClick={() => onAction(strategy, 'delete')}
            className="dropdown-item dropdown-item-danger"
          >
            <TrashCan size={16} className="mr-2" />
            Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

const StrategiesPage = () => {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [filter, setFilter] = useState('all');
  const [openDropdown, setOpenDropdown] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchStrategies();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Check if click is inside the action menu or the dropdown (even if in portal)
      const actionMenu = document.querySelector('.action-menu');
      const dropdown = document.querySelector('.action-dropdown');
      if (
        openDropdown &&
        !(
          (actionMenu && actionMenu.contains(event.target)) ||
          (dropdown && dropdown.contains(event.target))
        )
      ) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openDropdown]);

  const fetchStrategies = async () => {
    try {
      setLoading(true);
      const data = await getStrategies();
      setStrategies(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch strategies');
      console.error('Error fetching strategies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (strategyId, newStatus) => {
    try {
      if (newStatus === 'published') {
        await publishStrategy(strategyId);
        setSuccess('Strategy published successfully');
      } else if (newStatus === 'draft') {
        await unpublishStrategy(strategyId);
        setSuccess('Strategy unpublished successfully');
      }
      fetchStrategies(); // Refresh the list
    } catch (err) {
      setError(`Failed to update strategy status: ${err.message}`);
    }
  };

  const handleDelete = async (strategyId, strategyName) => {
    if (window.confirm(`Are you sure you want to delete strategy "${strategyName}"?`)) {
      try {
        await deleteStrategy(strategyId);
        setSuccess('Strategy deleted successfully');
        fetchStrategies(); // Refresh the list
      } catch (err) {
        setError(`Failed to delete strategy: ${err.message}`);
      }
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      draft: { class: 'status-draft', label: 'Draft', color: 'text-warning' },
      published: { class: 'status-published', label: 'Published', color: 'text-success' },
      deleted: { class: 'status-deleted', label: 'Deleted', color: 'text-danger' }
    };
    
    const config = statusConfig[status] || statusConfig.draft;
    return (
      <span className={`status-badge ${config.class} ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const handleDropdownToggle = (strategyId) => {
    setOpenDropdown(openDropdown === strategyId ? null : strategyId);
  };

  const handleDropdownAction = async (strategy, action) => {
    setOpenDropdown(null);
    
    try {
      switch (action) {
        case 'edit':
          navigate(`/strategies/${strategy.id}/edit`);
          break;
        case 'test':
          navigate(`/strategies/${strategy.id}/test`);
          break;
        case 'publish':
          await handleStatusChange(strategy.id, 'published');
          break;
        case 'unpublish':
          await handleStatusChange(strategy.id, 'draft');
          break;
        case 'delete':
          await handleDelete(strategy.id, strategy.name);
          break;
      }
    } catch (err) {
      setError(`Failed to ${action} strategy: ${err.message}`);
    }
  };

  const filteredStrategies = strategies.filter(strategy => {
    const matchesFilter = filter === 'all' ? strategy.status !== 'deleted' : strategy.status === filter;
    const matchesSearch = strategy.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (strategy.description && strategy.description.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  if (loading) {
    return (
      <div className="strategies-page">
        <LoadingSpinner message="Loading strategies..." />
      </div>
    );
  }

  return (
    <div className="strategies-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol className="breadcrumb-list">
          <li className="breadcrumb-item">
            <Link to="/live" className="breadcrumb-link">
              Dashboard
            </Link>
          </li>
          <li className="breadcrumb-item">
            <ChevronRight size={16} className="breadcrumb-separator" />
            <span className="breadcrumb-current">Strategies</span>
          </li>
        </ol>
      </nav>

      <div className="strat-page-header">
        <div className="header-content">
          <div className="header-title-section">
            <div className="header-text">
              <h1 className="page-title">Strategy Management</h1>
            </div>
          </div>
        </div>
        
        <div className="page-actions">
          <Button
            variant="primary"
            onClick={() => navigate('/strategies/create')}
            className="create-button"
          >
            <Add size={16} className="mr-2" />
            New Strategy
          </Button>
        </div>
      </div>

      {error && <ErrorMessage message={error} />}
      {success && <SuccessMessage message={success} />}

      <div className="filters-section">
        
        <div className="filter-tabs">
          <Button
            variant={filter === 'all' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('all')}
            className="filter-tab"
          >
            All Strategies
            <span className="filter-count">({strategies.filter(s => s.status !== 'deleted').length})</span>
          </Button>
          <Button
            variant={filter === 'draft' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('draft')}
            className="filter-tab"
          >
            Draft
            <span className="filter-count">({strategies.filter(s => s.status === 'draft').length})</span>
          </Button>
          <Button
            variant={filter === 'published' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('published')}
            className="filter-tab"
          >
            Published
            <span className="filter-count">({strategies.filter(s => s.status === 'published').length})</span>
          </Button>
        </div>
      </div>

      <div className="strategies-container">
        {filteredStrategies.length === 0 ? (
        <div></div>
        ) : (
          <div className="strategies-table-container">
            <table className="strategies-table">
              <thead>
                <tr>
                  <th>Strategy Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStrategies.map((strategy) => (
                  <tr 
                    key={strategy.id} 
                    className="strategy-row"
                    onClick={() => navigate(`/strategies/${strategy.id}/edit`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="strategy-name-cell">
                      <h3 className="strategy-name">{strategy.name}</h3>
                    </td>
                    <td className="strategy-description-cell">
                      <p className="strategy-description">
                        {strategy.description || 'No description provided'}
                      </p>
                    </td>
                    <td className="strategy-status-cell">
                      {getStatusBadge(strategy.status)}
                    </td>
                    <td className="strategy-date-cell">
                      <div className="date-item">
                        <p>{new Date(strategy.created_at).toLocaleDateString()}</p>
                      </div>
                    </td>
                    <td className="strategy-date-cell">
                      <div className="date-item">
                        <p>{new Date(strategy.updated_at).toLocaleDateString()}</p>
                      </div>
                    </td>
                    <td className="strategy-actions-cell" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        strategy={strategy}
                        isOpen={openDropdown === strategy.id}
                        onToggle={handleDropdownToggle}
                        onAction={handleDropdownAction}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategiesPage; 