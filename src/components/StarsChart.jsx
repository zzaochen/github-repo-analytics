import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

export default function StarsChart({ data }) {
  const chartData = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);

  // Check if we have any star data
  const hasStarData = data.some(d => d.totalStars > 0);

  if (!hasStarData) {
    return (
      <ChartCard title="Stars Over Time">
        <div style={{ height: '250px' }} className="flex items-center justify-center text-gray-400">
          <div className="text-center">
            <p>Historical star data unavailable</p>
            <p className="text-sm mt-1">Click "Continue Fetching" to retrieve star history</p>
          </div>
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Stars Over Time">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => val.slice(5)}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            labelStyle={{ color: '#374151' }}
          />
          <Line
            type="monotone"
            dataKey="totalStars"
            stroke="#FBBF24"
            strokeWidth={2}
            dot={false}
            name="Total Stars"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
