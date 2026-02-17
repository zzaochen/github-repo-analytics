import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

export default function ForksChart({ data }) {
  // Sample data for performance, but always include the last data point
  const step = Math.max(1, Math.floor(data.length / 100));
  const sampledData = data.filter((_, i) => i % step === 0);
  // Ensure last data point is included
  if (data.length > 0 && sampledData[sampledData.length - 1] !== data[data.length - 1]) {
    sampledData.push(data[data.length - 1]);
  }
  const chartData = sampledData;

  return (
    <ChartCard title="Forks Over Time">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => {
              const date = new Date(val);
              const month = date.toLocaleDateString('en-US', { month: 'short' });
              const year = date.getFullYear().toString().slice(-2);
              return `${month}-${year}`;
            }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => val.toLocaleString('en-US')}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            labelStyle={{ color: '#374151' }}
            formatter={(value) => [value.toLocaleString('en-US'), 'Total Forks']}
          />
          <Line
            type="monotone"
            dataKey="totalForks"
            stroke="#60A5FA"
            strokeWidth={2}
            dot={false}
            name="Total Forks"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
