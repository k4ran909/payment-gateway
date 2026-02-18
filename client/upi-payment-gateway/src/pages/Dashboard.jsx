import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AUTH_KEY = 'payqr-auth';
const SETTINGS_KEY = 'payqr-settings';
const CRED_KEY = 'payqr-credentials';

function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
}

function Dashboard() {
    const navigate = useNavigate();

    useEffect(() => {
        if (localStorage.getItem(AUTH_KEY) !== 'true') navigate('/admin', { replace: true });
    }, [navigate]);

    const [settings, setSettings] = useState(getSettings());
    const [transactions, setTransactions] = useState([]);
    const [toast, setToast] = useState('');
    const [loading, setLoading] = useState(true);

    // UPI Settings
    const [upiId, setUpiId] = useState(settings.upiId || '');
    const [payeeName, setPayeeName] = useState(settings.payeeName || '');

    // Credentials
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');

    const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

    // Fetch transactions
    const fetchTxns = async () => {
        try {
            const res = await fetch('/api/transactions');
            const data = await res.json();
            if (data.success) setTransactions(data.transactions || []);
        } catch { }
        setLoading(false);
    };

    useEffect(() => {
        fetchTxns();
        const iv = setInterval(fetchTxns, 5000);
        return () => clearInterval(iv);
    }, []);

    const handleDelete = async (orderId) => {
        try {
            await fetch(`/api/transactions/${orderId}`, { method: 'DELETE' });
            setTransactions(prev => prev.filter(t => t.orderId !== orderId));
        } catch { showToast('Failed'); }
    };

    const handleClearAll = async () => {
        try {
            await fetch('/api/transactions', { method: 'DELETE' });
            setTransactions([]);
            showToast('🗑️ Cleared');
        } catch { showToast('Failed'); }
    };

    const handleSaveSettings = (e) => {
        e.preventDefault();
        if (!upiId || !payeeName) return;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ upiId, payeeName }));
        setSettings({ upiId, payeeName });
        showToast('✅ Settings saved!');
    };

    const handleChangeCredentials = (e) => {
        e.preventDefault();
        if (!newUsername || !newPassword) return;
        localStorage.setItem(CRED_KEY, JSON.stringify({ username: newUsername, password: newPassword }));
        setNewUsername(''); setNewPassword('');
        showToast('🔐 Updated!');
    };

    const handleLogout = () => {
        localStorage.removeItem(AUTH_KEY);
        navigate('/admin', { replace: true });
    };

    // Stats
    const total = transactions.length;
    const confirmed = transactions.filter(t => t.status === 'confirmed').length;
    const pending = transactions.filter(t => t.status === 'pending').length;
    const totalAmt = transactions.filter(t => t.status === 'confirmed').reduce((s, t) => s + (t.amount || 0), 0);

    const formatDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const getStatusBadge = (status, confirmedBy) => {
        const map = {
            pending: { cls: 'pending', label: '⏳ Pending' },
            confirmed: {
                cls: 'confirmed',
                label: confirmedBy === 'customer-utr' ? '🤖 Auto-Confirmed'
                    : confirmedBy === 'customer-self' ? '✅ Self-Confirmed'
                        : '✅ Confirmed'
            },
            rejected: { cls: 'failed', label: '❌ Rejected' },
        };
        const s = map[status] || map.pending;
        return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
    };

    return (
        <>
            <div className="page-container fade-in">
                {/* Stats */}
                <div className="dash-grid">
                    <div className="stat-card">
                        <div className="stat-icon blue">📊</div>
                        <div className="stat-info">
                            <span className="stat-value">{total}</span>
                            <span className="stat-label">Total Orders</span>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.12)' }}>⏳</div>
                        <div className="stat-info">
                            <span className="stat-value" style={{ color: pending > 0 ? 'var(--warning)' : undefined }}>{pending}</span>
                            <span className="stat-label">Pending</span>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon green">✅</div>
                        <div className="stat-info">
                            <span className="stat-value">{confirmed}</span>
                            <span className="stat-label">Confirmed</span>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon cyan">💰</div>
                        <div className="stat-info">
                            <span className="stat-value">₹{totalAmt.toLocaleString('en-IN')}</span>
                            <span className="stat-label">Received</span>
                        </div>
                    </div>
                </div>

                {/* Auto-Confirm Info Banner */}
                <div className="dash-section">
                    <div className="glass-card" style={{
                        border: '1px solid rgba(16,185,129,0.3)',
                    }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '4px 0',
                        }}>
                            <span style={{ fontSize: '1.5rem' }}>🤖</span>
                            <div>
                                <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.95rem' }}>
                                    Auto-Confirmation Active
                                </p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 }}>
                                    Payments are auto-confirmed when customers submit their UTR number after paying.
                                </p>
                            </div>
                            <span style={{
                                padding: '4px 14px', borderRadius: 100, marginLeft: 'auto',
                                background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                                fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                                whiteSpace: 'nowrap',
                            }}>
                                <span className="pulse-icon" style={{ fontSize: '0.5rem' }}>🟢</span> Live
                            </span>
                        </div>
                    </div>
                </div>

                {/* UPI Settings */}
                <div className="dash-section">
                    <div className="glass-card">
                        <div className="section-header">
                            <h3 className="section-title">⚙️ UPI Settings</h3>
                            {settings.upiId && <span style={{
                                padding: '4px 12px', borderRadius: 100,
                                background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                                fontSize: '0.72rem', fontWeight: 600,
                            }}>Configured ✓</span>}
                        </div>
                        <form onSubmit={handleSaveSettings}>
                            <div className="settings-grid">
                                <div className="form-group">
                                    <label className="form-label">🏦 UPI ID</label>
                                    <input type="text" className="form-input" placeholder="e.g. 9876543210@paytm"
                                        value={upiId} onChange={e => setUpiId(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">👤 Payee Name</label>
                                    <input type="text" className="form-input" placeholder="e.g. Karan"
                                        value={payeeName} onChange={e => setPayeeName(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <button type="submit" className="btn-primary">💾 Save Settings</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Credentials */}
                <div className="dash-section">
                    <div className="glass-card">
                        <div className="section-header">
                            <h3 className="section-title">🔐 Change Credentials</h3>
                        </div>
                        <form onSubmit={handleChangeCredentials}>
                            <div className="settings-grid">
                                <div className="form-group">
                                    <label className="form-label">👤 New Username</label>
                                    <input type="text" className="form-input" placeholder="New username"
                                        value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">🔑 New Password</label>
                                    <input type="password" className="form-input" placeholder="New password"
                                        value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                                </div>
                                <div className="form-group">
                                    <button type="submit" className="btn-primary" style={{ background: 'var(--accent-gradient-2)' }}>
                                        🔄 Update
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Transactions */}
                <div className="dash-section">
                    <div className="glass-card">
                        <div className="section-header">
                            <h3 className="section-title">📋 Payment Orders</h3>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn-outline" onClick={fetchTxns}
                                    style={{ padding: '6px 14px', fontSize: '0.78rem' }}>🔄 Refresh</button>
                                {transactions.length > 0 && (
                                    <button className="btn-danger" onClick={handleClearAll}>🗑️ Clear All</button>
                                )}
                            </div>
                        </div>

                        {loading ? (
                            <div className="empty-state"><div className="empty-icon">⏳</div><p>Loading...</p></div>
                        ) : transactions.length === 0 ? (
                            <div className="empty-state"><div className="empty-icon">📭</div><p>No orders yet</p></div>
                        ) : (
                            <div className="table-wrap">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Amount</th>
                                            <th>Note</th>
                                            <th>UTR</th>
                                            <th>Date</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((txn, i) => (
                                            <tr key={txn.orderId}>
                                                <td>{i + 1}</td>
                                                <td className="amt">₹{(txn.amount || 0).toLocaleString('en-IN')}</td>
                                                <td>{txn.note || '—'}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: txn.upiRef ? 'var(--accent-2)' : 'var(--text-muted)' }}>
                                                    {txn.upiRef || '—'}
                                                </td>
                                                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(txn.createdAt)}</td>
                                                <td>{getStatusBadge(txn.status, txn.confirmedBy)}</td>
                                                <td>
                                                    <button className="btn-danger" onClick={() => handleDelete(txn.orderId)}
                                                        style={{ padding: '4px 10px', fontSize: '0.75rem' }}>✕</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <button className="btn-outline" onClick={handleLogout}
                        style={{ color: 'var(--error)', borderColor: 'rgba(239,68,68,0.2)' }}>🚪 Logout</button>
                </div>
            </div>

            <div className={`toast-container ${toast ? 'show' : ''}`}>{toast}</div>
        </>
    );
}

export default Dashboard;
