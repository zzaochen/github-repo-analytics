import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

export default function StarsChart({ data }) {
  // Sample data for performance, but always include the last data point
  const step = Math.max(1, Math.floor(data.length / 100));
  const sampledData = data.filter((_, i) => i % step === 0);
  // Ensure last data point is included
  if (data.length > 0 && sampledData[sampledData.length - 1] !== data[data.length - 1]) {
    sampledData.push(data[data.length - 1]);
  }
  const chartData = sampledData;

  // Check if we have any star data
  const hasStarData = data.some(d => d.totalStars > 0);

  if (!hasStarData) {
    return (
      <ChartCard title="Stars Over Time">
        <div className="h-full flex items-center justify-center text-gray-400">
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
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#6B7280', fontSize: 10 }}
            tickFormatter={(val) => {
              const date = new Date(val);
              const month = date.toLocaleDateString('en-US', { month: 'short' });
              const year = date.getFullYear().toString().slice(-2);
              return `${month}-${year}`;
            }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 10 }}
            tickFormatter={(val) => val.toLocaleString('en-US')}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            labelStyle={{ color: '#374151' }}
            formatter={(value) => [value.toLocaleString('en-US'), 'Total Stars']}
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
