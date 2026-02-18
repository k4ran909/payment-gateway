import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

const PRESETS = [3, 50, 100, 200, 500, 1000, 2000];
const SETTINGS_KEY = 'payqr-settings';

function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
}

function PaymentPage() {
    const settings = getSettings();
    const upiId = settings.upiId || '';
    const payeeName = settings.payeeName || '';

    const [amount, setAmount] = useState('');
    const [activePreset, setActivePreset] = useState(null);
    const [customerNote, setCustomerNote] = useState('');
    const [toast, setToast] = useState('');

    const [loading, setLoading] = useState(false);
    const [order, setOrder] = useState(null);
    const [upiLink, setUpiLink] = useState('');
    const [paymentStatus, setPaymentStatus] = useState('idle');
    // idle → pending (QR shown) → paid (customer clicked "I've Paid") → confirmed / rejected
    const [copied, setCopied] = useState(false);
    const pollingRef = useRef(null);

    const isConfigured = upiId && payeeName;

    useEffect(() => {
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, []);

    const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const handlePreset = (val) => {
        setActivePreset(val);
        setAmount(val.toString());
        resetOrder();
    };

    const handleAmountChange = (e) => {
        setAmount(e.target.value);
        setActivePreset(PRESETS.includes(Number(e.target.value)) ? Number(e.target.value) : null);
        resetOrder();
    };

    const resetOrder = () => {
        setOrder(null);
        setPaymentStatus('idle');
        setUpiLink('');
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };

    const buildUpiLink = (amt) => {
        const p = new URLSearchParams();
        p.set('pa', upiId);
        p.set('pn', payeeName);
        if (amt && Number(amt) > 0) p.set('am', amt);
        p.set('cu', 'INR');
        if (customerNote) p.set('tn', customerNote);
        return 'upi://pay?' + p.toString();
    };

    // Poll server for admin confirmation
    const startPolling = useCallback((orderId) => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(async () => {
            try {
                const res = await fetch(`/api/check-status/${orderId}`);
                const data = await res.json();
                if (data.status === 'confirmed') {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setPaymentStatus('confirmed');
                    showToast('✅ Payment confirmed by admin!');
                } else if (data.status === 'rejected') {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setPaymentStatus('rejected');
                    showToast('❌ Payment was rejected');
                }
            } catch (err) { /* server offline, keep trying */ }
        }, 3000);
    }, []);

    // Generate QR → create order on server
    const handleGenerate = async (e) => {
        e.preventDefault();
        if (!amount || Number(amount) <= 0) return;

        const link = buildUpiLink(amount);
        setUpiLink(link);
        setLoading(true);

        try {
            const res = await fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, note: customerNote || '' }),
            });
            const data = await res.json();
            if (data.success) {
                setOrder(data);
                setPaymentStatus('pending');
                startPolling(data.orderId);
            }
        } catch {
            // Server offline — still show QR, just no real-time tracking
            setOrder({ orderId: 'OFFLINE', amount });
            setPaymentStatus('pending');
        }
        setLoading(false);
    };

    // Customer clicks "I've Paid"
    const handleMarkPaid = async () => {
        if (!order || !order.orderId || order.orderId === 'OFFLINE') {
            setPaymentStatus('paid');
            showToast('✅ Noted! Admin will verify.');
            return;
        }
        try {
            await fetch(`/api/mark-paid/${order.orderId}`, { method: 'POST' });
        } catch { }
        setPaymentStatus('paid');
        showToast('📩 Payment notification sent to admin!');
    };

    // Copy UPI link
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(upiLink);
            setCopied(true);
            showToast('📋 UPI link copied!');
            setTimeout(() => setCopied(false), 2000);
        } catch { showToast('Failed to copy'); }
    };

    // Download QR
    const handleDownload = () => {
        const canvas = document.querySelector('.qr-canvas canvas');
        if (!canvas) return;
        const dlCanvas = document.createElement('canvas');
        const pad = 40, brand = 55;
        dlCanvas.width = canvas.width + pad * 2;
        dlCanvas.height = canvas.height + pad * 2 + brand;
        const ctx = dlCanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, dlCanvas.width, dlCanvas.height);
        ctx.drawImage(canvas, pad, pad);
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Pay ₹${Number(amount).toLocaleString('en-IN')} to ${payeeName}`,
            dlCanvas.width / 2, canvas.height + pad + 28);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText('Scan with any UPI app', dlCanvas.width / 2, canvas.height + pad + 46);
        const a = document.createElement('a');
        a.href = dlCanvas.toDataURL('image/png');
        a.download = `upi_qr_₹${amount}.png`;
        a.click();
        showToast('⬇️ QR downloaded!');
    };

    // Not configured
    if (!isConfigured) {
        return (
            <div className="page-container">
                <div className="login-page" style={{ minHeight: 'calc(100vh - 200px)' }}>
                    <div className="glass-card login-card fade-in" style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚠️</div>
                        <h2 style={{ fontFamily: 'Outfit', marginBottom: 12, color: 'var(--text-heading)' }}>
                            Payment Gateway Not Configured
                        </h2>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
                            Admin needs to set up UPI ID and payee name.
                        </p>
                        <a href="/admin" className="btn-primary" style={{
                            display: 'inline-block', textDecoration: 'none', padding: '12px 32px',
                            borderRadius: 'var(--radius-md)', fontFamily: 'Outfit', fontWeight: 700,
                        }}>Go to Admin Setup →</a>
                    </div>
                </div>
            </div>
        );
    }

    // Status display
    const StatusBox = () => {
        const configs = {
            pending: { icon: '📲', label: 'Scan QR and pay', sub: 'Then click the button below', color: 'var(--accent-2)', bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.15)' },
            paid: { icon: '⏳', label: 'Waiting for admin confirmation...', sub: 'Admin will verify your payment from their UPI app', color: 'var(--warning)', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.15)' },
            confirmed: { icon: '🎉', label: 'Payment Confirmed!', sub: 'Thank you for your payment!', color: 'var(--success)', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.15)' },
            rejected: { icon: '❌', label: 'Payment Rejected', sub: 'Please contact admin or try again', color: 'var(--error)', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)' },
        };
        const c = configs[paymentStatus];
        if (!c) return null;

        return (
            <div className="fade-in" style={{
                textAlign: 'center', padding: 18, background: c.bg,
                borderRadius: 'var(--radius-md)', border: `1px solid ${c.border}`, width: '100%',
            }}>
                <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>
                    {paymentStatus === 'paid' ? <span className="pulse-icon">{c.icon}</span> : c.icon}
                </div>
                <p style={{ color: c.color, fontWeight: 700, fontSize: '1rem' }}>{c.label}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>{c.sub}</p>
                {paymentStatus === 'rejected' && (
                    <button className="btn-outline" style={{ marginTop: 10 }} onClick={resetOrder}>🔄 Try Again</button>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="page-container">
                <div className="payment-grid">
                    {/* Left — Amount Entry */}
                    <section className="glass-card fade-in">
                        <div className="panel-header">
                            <h2 className="panel-title">💰 Pay {payeeName}</h2>
                            <p className="panel-desc">Choose amount and scan QR to pay via UPI</p>
                        </div>
                        <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <div className="form-group">
                                <label className="form-label">Quick Amount</label>
                                <div className="amount-presets">
                                    {PRESETS.map(p => (
                                        <button key={p} type="button"
                                            className={`preset-btn ${activePreset === p ? 'active' : ''}`}
                                            onClick={() => handlePreset(p)}>₹{p.toLocaleString('en-IN')}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Or enter custom amount</label>
                                <div className="amount-input-wrap">
                                    <span className="currency-symbol">₹</span>
                                    <input type="number" className="form-input currency-input"
                                        placeholder="0" min="1" step="1"
                                        value={amount} onChange={handleAmountChange} required />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">📝 Note <span style={{
                                    fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem'
                                }}>(optional)</span></label>
                                <input type="text" className="form-input" placeholder="e.g. Order #123"
                                    value={customerNote} onChange={e => { setCustomerNote(e.target.value); resetOrder(); }} />
                            </div>
                            <button type="submit" className="btn-primary"
                                disabled={!amount || Number(amount) <= 0 || loading}>
                                {loading ? '⏳ Creating...' : '⚡ Generate QR Code'}
                            </button>
                        </form>
                    </section>

                    {/* Right — QR Display */}
                    <section className="glass-card qr-panel fade-in">
                        <div className="panel-header">
                            <h2 className="panel-title">📱 Payment QR</h2>
                            <p className="panel-desc">Scan with any UPI app to pay</p>
                        </div>

                        {!order ? (
                            <div className="empty-state" style={{ padding: '60px 20px' }}>
                                <div className="empty-icon">📲</div>
                                <p>Select amount and click <strong style={{ color: 'var(--accent-2)' }}>"Generate QR Code"</strong></p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }} className="fade-in">
                                {/* Status */}
                                <StatusBox />

                                {/* QR (hide after confirmed) */}
                                {paymentStatus !== 'confirmed' && (
                                    <div className="qr-container">
                                        <div className="qr-glow"></div>
                                        <div className="qr-frame">
                                            <div className="qr-corner tl"></div>
                                            <div className="qr-corner tr"></div>
                                            <div className="qr-corner bl"></div>
                                            <div className="qr-corner br"></div>
                                            <div className="qr-canvas">
                                                <QRCodeCanvas value={upiLink} size={200} level="H"
                                                    bgColor="#ffffff" fgColor="#0f172a" style={{ borderRadius: 4 }} />
                                            </div>
                                            {paymentStatus === 'pending' && <div className="scan-line"></div>}
                                        </div>
                                    </div>
                                )}

                                {/* Summary */}
                                <div className="payment-summary">
                                    <div className="summary-row">
                                        <span className="summary-label">Receiver</span>
                                        <span className="summary-value">{payeeName}</span>
                                    </div>
                                    <div className="summary-row">
                                        <span className="summary-label">UPI ID</span>
                                        <span className="summary-value" style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{upiId}</span>
                                    </div>
                                    <div className="summary-row" style={{ background: 'rgba(79,70,229,0.04)' }}>
                                        <span className="summary-label">Amount</span>
                                        <span className="summary-value summary-amount">₹{Number(amount).toLocaleString('en-IN')}</span>
                                    </div>
                                    {customerNote && (
                                        <div className="summary-row">
                                            <span className="summary-label">Note</span>
                                            <span className="summary-value">{customerNote}</span>
                                        </div>
                                    )}
                                </div>

                                {/* UPI Link */}
                                <div className="upi-link-box">
                                    <code className="upi-link-text">{upiLink}</code>
                                    <button className="btn-copy" onClick={handleCopy}>{copied ? '✅' : '📋'}</button>
                                </div>

                                {/* Actions */}
                                <div className="qr-actions">
                                    <button className="btn-outline" onClick={handleDownload}>⬇️ Download</button>
                                    <button className="btn-outline" onClick={handleCopy}>{copied ? '✅ Copied' : '📋 Copy'}</button>
                                </div>

                                {/* "I've Paid" button */}
                                {paymentStatus === 'pending' && (
                                    <button className="btn-success" onClick={handleMarkPaid}
                                        style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: '1rem' }}>
                                        ✅ I've Completed the Payment
                                    </button>
                                )}

                                {/* App badges */}
                                <div style={{ textAlign: 'center' }}>
                                    <span style={{
                                        fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                                        letterSpacing: '1.5px', fontWeight: 600,
                                    }}>Works with</span>
                                    <div className="app-badges" style={{ marginTop: 8 }}>
                                        {['Google Pay', 'PhonePe', 'Paytm', 'BHIM', '+ All UPI'].map(a => (
                                            <span className="app-badge" key={a}>{a}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
            <div className={`toast-container ${toast ? 'show' : ''}`}>{toast}</div>
        </>
    );
}

export default PaymentPage;
