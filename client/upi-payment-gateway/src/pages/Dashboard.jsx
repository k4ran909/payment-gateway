import { useState, useEffect, useRef } from 'react';
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

    // Paytm linking
    const [paytmStatus, setPaytmStatus] = useState(null);
    const [paytmStep, setPaytmStep] = useState('idle'); // idle | loading | qr | connected
    const [qrImage, setQrImage] = useState(null);
    const [paytmLoading, setPaytmLoading] = useState(false);
    const loginPollRef = useRef(null);

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

    // Fetch Paytm status
    const fetchPaytmStatus = async () => {
        try {
            const res = await fetch('/api/paytm/status');
            const data = await res.json();
            setPaytmStatus(data);
            if (data.isLoggedIn) {
                setPaytmStep('connected');
                stopLoginPolling();
            }
        } catch { }
    };

    useEffect(() => {
        fetchTxns();
        fetchPaytmStatus();
        const iv = setInterval(fetchTxns, 5000);
        const iv2 = setInterval(fetchPaytmStatus, 10000);
        return () => { clearInterval(iv); clearInterval(iv2); stopLoginPolling(); };
    }, []);

    // ── Paytm QR Login ──
    const handleStartQRLogin = async () => {
        setPaytmLoading(true);
        setPaytmStep('loading');
        try {
            const res = await fetch('/api/paytm/start-qr-login', { method: 'POST' });
            const data = await res.json();
            if (data.success && data.qrImage) {
                setQrImage(data.qrImage);
                setPaytmStep('qr');
                startLoginPolling();
                showToast('📱 Scan the QR code with your Paytm app');
            } else {
                setPaytmStep('idle');
                showToast('❌ ' + (data.error || 'Failed to load Paytm login'));
            }
        } catch (err) {
            setPaytmStep('idle');
            showToast('❌ Server error');
        }
        setPaytmLoading(false);
    };

    // Poll for QR scan completion
    const startLoginPolling = () => {
        stopLoginPolling();
        loginPollRef.current = setInterval(async () => {
            try {
                const res = await fetch('/api/paytm/check-login');
                const data = await res.json();
                if (data.loggedIn) {
                    setPaytmStep('connected');
                    stopLoginPolling();
                    showToast('🎉 Paytm connected! Verification active.');
                    fetchPaytmStatus();
                }
            } catch { }
        }, 3000);
    };

    const stopLoginPolling = () => {
        if (loginPollRef.current) {
            clearInterval(loginPollRef.current);
            loginPollRef.current = null;
        }
    };

    const handleDisconnect = async () => {
        try {
            await fetch('/api/paytm/disconnect', { method: 'POST' });
            setPaytmStep('idle');
            setPaytmStatus(null);
            setQrImage(null);
            stopLoginPolling();
            showToast('🔌 Paytm disconnected');
        } catch { showToast('Failed to disconnect'); }
    };

    const handleCheckNow = async () => {
        showToast('🔍 Checking passbook...');
        try {
            const res = await fetch('/api/paytm/check-now', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast(data.matches > 0
                    ? `✅ Verified ${data.matches} payment(s)!`
                    : '📋 No new matching payments found');
                fetchTxns();
            } else {
                showToast('❌ ' + (data.error || 'Check failed'));
            }
        } catch { showToast('❌ Server error'); }
    };

    // ── Admin actions ──
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
    const pending = transactions.filter(t => t.status === 'pending' || t.status === 'verifying').length;
    const totalAmt = transactions.filter(t => t.status === 'confirmed').reduce((s, t) => s + (t.amount || 0), 0);

    const formatDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const getStatusBadge = (status, confirmedBy) => {
        const map = {
            pending: { cls: 'pending', label: '⏳ Pending' },
            verifying: { cls: 'pending', label: '🔍 Verifying' },
            confirmed: {
                cls: 'confirmed',
                label: confirmedBy === 'paytm-verified' ? '🤖 Paytm Verified'
                    : confirmedBy === 'timeout-fallback' ? '⏰ Fallback'
                        : '✅ Confirmed'
            },
            rejected: { cls: 'failed', label: '❌ Rejected' },
        };
        const s = map[status] || map.pending;
        return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
    };

    const isConnected = paytmStep === 'connected';

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

                {/* ═══ Paytm Verification ═══ */}
                <div className="dash-section">
                    <div className="glass-card" style={{
                        border: isConnected ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--glass-border)'
                    }}>
                        <div className="section-header">
                            <h3 className="section-title">
                                {isConnected ? '🟢' : '🔴'} Paytm Payment Verification
                            </h3>
                            {isConnected && (
                                <span style={{
                                    padding: '4px 14px', borderRadius: 100,
                                    background: 'rgba(16,185,129,0.1)', color: 'var(--success)',
                                    fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                    <span className="pulse-icon" style={{ fontSize: '0.5rem' }}>🟢</span> Live
                                </span>
                            )}
                        </div>

                        {/* IDLE — show connect button */}
                        {paytmStep === 'idle' && (
                            <div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
                                    Connect your Paytm account to automatically verify payments. Scan a QR code with your Paytm app.
                                </p>
                                <button className="btn-primary" onClick={handleStartQRLogin}
                                    disabled={paytmLoading} style={{ maxWidth: 300 }}>
                                    {paytmLoading ? '⏳ Loading...' : '🔗 Connect Paytm'}
                                </button>
                            </div>
                        )}

                        {/* LOADING */}
                        {paytmStep === 'loading' && (
                            <div style={{ textAlign: 'center', padding: 30 }}>
                                <div className="pulse-icon" style={{ fontSize: '2.5rem' }}>🌐</div>
                                <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>Opening Paytm login page...</p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>This takes ~10 seconds</p>
                            </div>
                        )}

                        {/* QR CODE */}
                        {paytmStep === 'qr' && qrImage && (
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ color: 'var(--accent-2)', fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>
                                    📱 Scan with Paytm App
                                </p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 20 }}>
                                    Open Paytm → Tap Scan → Point at this QR code
                                </p>
                                <div style={{
                                    display: 'inline-block', background: 'white', padding: 16,
                                    borderRadius: 'var(--radius-lg)',
                                    boxShadow: '0 0 40px rgba(79,70,229,0.15)',
                                }}>
                                    <img src={qrImage} alt="Paytm Login QR"
                                        style={{ width: 220, height: 220, display: 'block' }} />
                                </div>
                                <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center' }}>
                                    <span className="pulse-icon" style={{
                                        padding: '6px 16px', borderRadius: 100,
                                        background: 'rgba(245,158,11,0.1)', color: 'var(--warning)',
                                        fontSize: '0.78rem', fontWeight: 600,
                                    }}>
                                        ⏳ Waiting for scan...
                                    </span>
                                    <button className="btn-outline" onClick={() => { setPaytmStep('idle'); stopLoginPolling(); }}
                                        style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                                        ✕ Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* CONNECTED */}
                        {paytmStep === 'connected' && (
                            <div>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: 16, background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-md)',
                                    border: '1px solid rgba(16,185,129,0.15)', marginBottom: 16,
                                }}>
                                    <div>
                                        <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: '0.95rem' }}>
                                            ✅ Paytm Connected
                                        </p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 }}>
                                            Payments auto-verified via Paytm passbook
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="btn-outline" onClick={handleCheckNow}
                                            style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                                            🔍 Check Now
                                        </button>
                                        <button className="btn-danger" onClick={handleDisconnect}
                                            style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                                            🔌 Disconnect
                                        </button>
                                    </div>
                                </div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                    💡 When someone pays and enters their UTR, the system checks your Paytm passbook for matching credits and confirms automatically.
                                </p>
                            </div>
                        )}
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
