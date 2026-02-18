import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const AUTH_KEY = 'payqr-auth';
const CRED_KEY = 'payqr-credentials';

function getCredentials() {
    try {
        const creds = JSON.parse(localStorage.getItem(CRED_KEY));
        if (creds && creds.username && creds.password) return creds;
    } catch { }
    return { username: 'admin', password: 'admin123' };
}

function AdminLogin() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Already logged in?
    const isLoggedIn = localStorage.getItem(AUTH_KEY) === 'true';
    if (isLoggedIn) {
        navigate('/dashboard', { replace: true });
        return null;
    }

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');

        const creds = getCredentials();
        if (username === creds.username && password === creds.password) {
            localStorage.setItem(AUTH_KEY, 'true');
            navigate('/dashboard', { replace: true });
        } else {
            setError('Invalid username or password');
        }
    };

    return (
        <div className="page-container">
            <div className="login-page">
                <div className="glass-card login-card fade-in">
                    <div style={{ textAlign: 'center', marginBottom: 28 }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔐</div>
                        <h2 style={{
                            fontFamily: 'Outfit', fontWeight: 800, fontSize: '1.5rem',
                            color: 'var(--text-heading)', marginBottom: 6,
                        }}>Admin Login</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Sign in to manage your payment gateway
                        </p>
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group" style={{ marginBottom: 18 }}>
                            <label className="form-label">👤 Username</label>
                            <input type="text" className="form-input"
                                placeholder="Enter username"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                required autoFocus />
                        </div>

                        <div className="form-group" style={{ marginBottom: 18 }}>
                            <label className="form-label">🔑 Password</label>
                            <div style={{ position: 'relative' }}>
                                <input type={showPassword ? 'text' : 'password'}
                                    className="form-input"
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    style={{ paddingRight: 44 }} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: 12, top: '50%',
                                        transform: 'translateY(-50%)', background: 'none',
                                        border: 'none', cursor: 'pointer', fontSize: '1rem',
                                        color: 'var(--text-muted)',
                                    }}>
                                    {showPassword ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="btn-primary" style={{ marginTop: 8 }}>
                            🚀 Sign In
                        </button>
                    </form>

                    <p style={{
                        textAlign: 'center', color: 'var(--text-muted)',
                        fontSize: '0.72rem', marginTop: 20,
                    }}>
                        Default: admin / admin123
                    </p>
                </div>
            </div>
        </div>
    );
}

export default AdminLogin;
