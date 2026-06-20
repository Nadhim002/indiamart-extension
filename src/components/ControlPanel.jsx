function ControlPanel({ intervalSeconds, setIntervalSeconds, onStart, onStop, active }) {
  return (
    <section className="section controls">
      <label htmlFor="intervalInput">Interval (seconds):</label>
      <div className="control-row">
        <input
          id="intervalInput"
          type="number"
          min="1"
          max="300"
          value={intervalSeconds}
          onChange={(event) => setIntervalSeconds(Number(event.target.value))}
          disabled={active}
        />
        <button onClick={onStart} className="btn btn-primary" disabled={active}>
          START
        </button>
        <button onClick={onStop} className="btn btn-secondary" disabled={!active}>
          STOP
        </button>
      </div>
    </section>
  );
}

export default ControlPanel;
