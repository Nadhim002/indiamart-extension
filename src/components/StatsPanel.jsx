function StatsPanel({ state }) {
  return (
    <section className="section stats-section">
      <p className="stats">Last call: {state.last_call_time ? new Date(state.last_call_time).toLocaleTimeString() : '--'}</p>
      <p className="stats">Calls made: {state.call_count}</p>
      <p className="stats">Success: {state.success_count} | Errors: {state.error_count}</p>
    </section>
  );
}

export default StatsPanel;
