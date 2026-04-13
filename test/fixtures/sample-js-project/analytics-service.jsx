import React from 'react';

export function trackEvent(name, metadata) {
    console.log(`[analytics] ${name}:`, metadata);
}

export function AnalyticsDashboard({ events }) {
    return (
        <div className="dashboard">
            <h1>Analytics</h1>
            <ul>
                {events.map((e, i) => (
                    <li key={i}>{e.name}: {JSON.stringify(e.metadata)}</li>
                ))}
            </ul>
        </div>
    );
}

export default AnalyticsDashboard;
