// Edit these records to exercise revisions. Keys describe identity, never position
// or mutable values. These are synthetic examples, not an annotation adapter.
export const categoryData = [
  { id: 'search', label: 'Search', requests: 42, color: '#2563eb' },
  { id: 'billing', label: 'Billing', requests: 31, color: '#0d9488' },
  { id: 'reports', label: 'Reports', requests: 56, color: '#d97706' },
  { id: 'storage', label: 'Storage', requests: 24, color: '#9333ea' },
  { id: 'identity', label: 'Identity', requests: 37, color: '#e11d48' },
];

export const dailyData = [
  { date: '2026-09-01', requests: 42 }, { date: '2026-09-02', requests: 48 },
  { date: '2026-09-03', requests: 39 }, { date: '2026-09-04', requests: 61 },
  { date: '2026-09-05', requests: 54 }, { date: '2026-09-06', requests: 70 },
  { date: '2026-09-07', requests: 66 }, { date: '2026-09-08', requests: 58 },
  { date: '2026-09-09', requests: 73 }, { date: '2026-09-10', requests: 65 },
  { date: '2026-09-11', requests: 81 }, { date: '2026-09-12', requests: 76 },
];

// A formatted date is a label; the ISO calendar date and series key are identity.
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dayLabel = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`));
export const dailyLabel = (date: string) => `Requests · ${dayLabel(date)}, ${date.slice(0, 4)}`;

export const observationData = [
  { id: 'obs-a1', latency: 22, utilization: 18 }, { id: 'obs-a2', latency: 35, utilization: 29 },
  { id: 'obs-a3', latency: 41, utilization: 24 }, { id: 'obs-a4', latency: 48, utilization: 38 },
  { id: 'obs-a5', latency: 55, utilization: 33 }, { id: 'obs-a6', latency: 62, utilization: 46 },
  { id: 'obs-b1', latency: 73, utilization: 42 }, { id: 'obs-b2', latency: 81, utilization: 53 },
  { id: 'obs-b3', latency: 87, utilization: 61 }, { id: 'obs-b4', latency: 95, utilization: 49 },
  { id: 'obs-b5', latency: 102, utilization: 68 }, { id: 'obs-b6', latency: 108, utilization: 56 },
  { id: 'obs-c1', latency: 119, utilization: 72 }, { id: 'obs-c2', latency: 126, utilization: 65 },
  { id: 'obs-c3', latency: 133, utilization: 79 }, { id: 'obs-c4', latency: 141, utilization: 70 },
  { id: 'obs-c5', latency: 151, utilization: 85 }, { id: 'obs-c6', latency: 161, utilization: 77 },
  { id: 'obs-d1', latency: 34, utilization: 72 }, { id: 'obs-d2', latency: 55, utilization: 81 },
  { id: 'obs-d3', latency: 79, utilization: 20 }, { id: 'obs-d4', latency: 111, utilization: 29 },
  { id: 'obs-d5', latency: 145, utilization: 36 }, { id: 'obs-d6', latency: 173, utilization: 51 },
];

// The same graph is drawn as a force layout and as a Sankey. Names are display
// labels; ids survive renaming and relayout. Edge ids are explicit too.
export const graphNodes = [
  { id: 'web', label: 'Web' }, { id: 'mobile', label: 'Mobile' },
  { id: 'api', label: 'API' }, { id: 'worker', label: 'Worker' },
  { id: 'billing', label: 'Billing' }, { id: 'reports', label: 'Reports' },
  { id: 'ledger', label: 'Ledger' }, { id: 'archive', label: 'Archive' },
];
export const graphLinks = [
  { id: 'web-api', source: 'web', target: 'api', value: 40 },
  { id: 'web-worker', source: 'web', target: 'worker', value: 15 },
  { id: 'mobile-api', source: 'mobile', target: 'api', value: 25 },
  { id: 'mobile-worker', source: 'mobile', target: 'worker', value: 10 },
  { id: 'api-billing', source: 'api', target: 'billing', value: 35 },
  { id: 'api-reports', source: 'api', target: 'reports', value: 30 },
  { id: 'worker-billing', source: 'worker', target: 'billing', value: 10 },
  { id: 'worker-reports', source: 'worker', target: 'reports', value: 15 },
  { id: 'billing-ledger', source: 'billing', target: 'ledger', value: 45 },
  { id: 'reports-archive', source: 'reports', target: 'archive', value: 45 },
];
