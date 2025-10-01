// src/App.js
import { useEffect, useMemo, useRef, useState } from 'react';
import html2pdf from 'html2pdf.js';

function App() {
  const [doors, setDoors] = useState([]);
  const [selectedDoorId, setSelectedDoorId] = useState('');
  const [minMinutes, setMinMinutes] = useState(45);
  const [date, setDate] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const [loadingDoors, setLoadingDoors] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);

  const resultsRef = useRef(null);

  useEffect(() => {
    const fetchDoors = async () => {
      setLoadingDoors(true);
      setError(null);
      try {
        const res = await fetch('http://localhost:3001/api/doors');
        if (!res.ok) throw new Error(`Failed to fetch doors (${res.status})`);
        const data = await res.json();
        const ds = data?.doors || [];
        setDoors(ds);

        const preferred = ds.find((d) => (d.name || '').toLowerCase().includes('break'));
        if (preferred) setSelectedDoorId(preferred.door_id);
        else if (ds[0]) setSelectedDoorId(ds[0].door_id);
      } catch (e) {
        setError(e.message || 'Failed to load doors');
      } finally {
        setLoadingDoors(false);
      }
    };
    fetchDoors();
  }, []);

  const suggestedDoors = useMemo(
    () => doors.filter((d) => (d.name || '').toLowerCase().includes('break')),
    [doors]
  );
  const allDoors = doors;

  const handleGenerate = async (e) => {
    e?.preventDefault?.();
    if (!selectedDoorId) {
      setError('Please select a door.');
      return;
    }
    setLoadingReport(true);
    setError(null);
    setReport(null);
    try {
      const params = new URLSearchParams({
        door_id: selectedDoorId,
        date,
        min_minutes: String(minMinutes || 45),
      });
      const res = await fetch(`http://localhost:3001/api/break-report?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch report (${res.status})`);
      const data = await res.json();
      setReport(data);
    } catch (e) {
      setError(e.message || 'Failed to generate report');
    } finally {
      setLoadingReport(false);
    }
  };

  const getDoorDisplay = (d) => (d ? `${d.name} — ${d.site_name || 'Unknown Site'}` : '');

  const handleExportPDF = () => {
    if (!report || !resultsRef.current) return;

    const filenameDoor =
      (report?.door?.name || 'door').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

    const opt = {
      margin: 10,
      filename: `break-report_${filenameDoor}_${date}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' }, // avoid splitting table rows
    };

    html2pdf().set(opt).from(resultsRef.current).save();
  };

  return (
    <div style={{ backgroundColor: '#f6f7f9', minHeight: '100vh', fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif' }}>
      <header style={{ backgroundColor: '#1f2937', padding: '1rem 2rem', color: '#fff', fontSize: '1.5rem', fontWeight: 600 }}>
        Break Times Dashboard
      </header>

      <main style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1rem' }}>
        <form
          onSubmit={handleGenerate}
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '1rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1rem',
              alignItems: 'end',
            }}
          >
            {/* Door selector with suggested first */}
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Door</label>
              <select
                value={selectedDoorId}
                onChange={(e) => setSelectedDoorId(e.target.value)}
                disabled={loadingDoors}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#fff',
                }}
              >
                <option value="" disabled>
                  {loadingDoors ? 'Loading doors…' : '-- Select a Door --'}
                </option>

                {suggestedDoors.length > 0 && (
                  <optgroup label="Suggested (Break)">
                    {suggestedDoors.map((d) => (
                      <option key={`s-${d.door_id}`} value={d.door_id}>
                        {getDoorDisplay(d)}
                      </option>
                    ))}
                  </optgroup>
                )}

                {allDoors.length > 0 && (
                  <optgroup label="All Doors">
                    {allDoors.map((d) => (
                      <option key={`a-${d.door_id}`} value={d.door_id}>
                        {getDoorDisplay(d)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Min minutes */}
            <div style={{ minWidth: 280 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                Total Break Time ≥ (minutes)
              </label>
              <input
                type="number"
                min={1}
                value={minMinutes}
                onChange={(e) => setMinMinutes(Number(e.target.value))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#fff',
                }}
              />
            </div>

            {/* Date */}
            <div style={{ minWidth: 280 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#fff',
                }}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <button
                type="submit"
                disabled={loadingReport || loadingDoors || !selectedDoorId}
                style={{
                  padding: '0.65rem 1rem',
                  borderRadius: 8,
                  border: '1px solid #1f2937',
                  backgroundColor: '#1f2937',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loadingReport ? 'wait' : 'pointer',
                  width: '100%',
                  whiteSpace: 'nowrap',
                }}
              >
                {loadingReport ? 'Generating…' : 'Generate Report'}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '0.75rem 1rem',
              borderRadius: 8,
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Report */}
        <section
          ref={resultsRef}
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '1rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          <header style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Results</h2>
              {report?.door && (
                <p style={{ margin: '0.25rem 0', color: '#6b7280' }}>
                  Door: <strong>{report.door.name}</strong> — Site:{' '}
                  <strong>{report.door.site_name}</strong> — TZ:{' '}
                  <strong>{report.door.timezone}</strong>
                  <br />
                  Date: <strong>{date}</strong> • Threshold:{' '}
                  <strong>{minMinutes} min</strong>
                </p>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={handleExportPDF}
                disabled={!report || loadingReport}
                style={{
                  padding: '0.5rem 0.9rem',
                  borderRadius: 8,
                  border: '1px solid #111827',
                  background: '#111827',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: !report ? 'not-allowed' : 'pointer',
                  opacity: !report ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
                aria-label="Export results to PDF"
                title="Export results to PDF"
              >
                Export PDF
              </button>
            </div>
          </header>

          {!report && !loadingReport && (
            <p style={{ color: '#6b7280' }}>Run a report to see results here.</p>
          )}

          {report && report.users?.length === 0 && (
            <p style={{ color: '#6b7280' }}>
              No users exceeded {minMinutes} minutes on {date}.
            </p>
          )}

          {report?.users?.map((u) => (
            <div
              key={u.userId}
              style={{
                marginBottom: '1.5rem',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: '#f9fafb',
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{u.userName}</strong>
                  <span style={{ color: '#6b7280' }}>• {u.siteName}</span>
                  {u.violations?.length > 0 && (
                    <span
                      title="This user has area violations on this day"
                      style={{
                        background: '#fff7ed',
                        color: '#9a3412',
                        border: '1px solid #fed7aa',
                        padding: '2px 6px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Violations: {u.violations.length}
                    </span>
                  )}
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Total:</span>{' '}
                  <strong>{u.totalLabel}</strong>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f3f4f6' }}>
                      <th style={th}>User</th>
                      <th style={th}>Site</th>
                      <th style={th}>Area</th>
                      <th style={th}>Date</th>
                      <th style={th}>Time In</th>
                      <th style={th}>At Location</th>
                      <th style={th}>Date</th>
                      <th style={th}>Time Out</th>
                      <th style={th}>At Location</th>
                      <th style={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.pairs.map((p, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={td}>{u.userName}</td>
                        <td style={td}>{u.siteName}</td>
                        <td style={td}>{p.area}</td>
                        <td style={td}>{p.in.date}</td>
                        <td style={td}>{new Date(`${p.in.date}T${p.in.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</td>
                        <td style={td}>{p.in.atLocation}</td>
                        <td style={td}>{p.out.date}</td>
                        <td style={td}>{new Date(`${p.out.date}T${p.out.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</td>
                        <td style={td}>{p.out.atLocation}</td>
                        <td style={td}>{p.totalLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {u.violations?.length > 0 && (
                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e5e7eb', background: '#fff' }}>
                  <strong>Area Violations</strong>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                    {u.violations.map((v, i) => (
                      <li key={i} style={{ lineHeight: 1.6 }}>
                        <span style={{ color: '#6b7280' }}>
                          {v.date}{' '}
                          {new Date(`${v.date}T${v.time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} —{' '}
                        </span>
                        <span>
                          Area Violation: {v.message}{' '}
                          <span style={{ color: '#9ca3af' }}>({v.event_type})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

const th = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  fontWeight: 600,
  fontSize: 14,
  whiteSpace: 'nowrap',
};

const td = {
  padding: '0.5rem 0.75rem',
  fontSize: 14,
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

export default App;
