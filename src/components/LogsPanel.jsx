function LogsPanel({ logs, onClear, hasLogs }) {
  return (
    <section className="section logs-section">
      <div className="logs-header">
        <h3>Logs</h3>
        <button onClick={onClear} className="btn btn-small" disabled={!hasLogs}>
          Clear
        </button>
      </div>
      <div className="logs-container">
        {hasLogs ? (
          logs.map((log, index) => {
            const isError = log.includes('ERROR');
            const isWarn = log.includes('WARN');
            const className = isError ? 'log-entry error' : isWarn ? 'log-entry warn' : 'log-entry info';
            return (
              <p key={index} className={className}>
                {log}
              </p>
            );
          })
        ) : (
          <p className="placeholder">Ready to start. Enter interval and click START.</p>
        )}
      </div>
    </section>
  );
}

export default LogsPanel;
